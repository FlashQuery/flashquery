import * as http from 'node:http';
import * as https from 'node:https';
import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';
import { isFinishReason } from '../constants/llm.js';
import { computeCost, recordLlmUsage } from './cost-tracker.js';
import { syncLlmConfigToDb } from './config-sync.js';
import { validatePersistedPurposeTemplateAdmissions } from './purpose-template-bindings.js';
import { PurposeResolver } from './resolver.js';
import type { LlmChatMessage, LlmChatResult, LlmChatToolCall } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Typed error classes — D-02 (Phase 100)
// LlmHttpError: thrown by complete() for any non-OK HTTP response.
// LlmNetworkError: thrown by complete() for AbortError/connection-refused.
// The classes carry no logic — error classification (permanent vs transient)
// and 30,000ms cap on retryAfterMs are policy decisions made by the resolver
// layer in src/llm/resolver.ts.
// ─────────────────────────────────────────────────────────────────────────────

export class LlmHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class LlmNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmNetworkError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LlmCompletionResult {
  text: string;
  modelName: string;
  providerName: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LlmClient {
  chat(
    modelName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmChatResult>;

  complete(
    modelName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmCompletionResult>;

  completeByPurpose(
    purposeName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmCompletionResult & { purposeName: string; fallbackPosition: number }>;

  chatByPurpose(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }>;

  chatByPurposeUnrecorded(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }>;

  getModelForPurpose(
    purposeName: string
  ): {
    modelName: string;
    providerName: string;
    config: NonNullable<FlashQueryConfig['llm']>['models'][number];
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// nodeFetch — module-private HTTP client using node:http / node:https
// Copied from src/storage/supabase.ts and extended to honor AbortSignal.
// ─────────────────────────────────────────────────────────────────────────────

function nodeFetch(input: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(input);
    const requester = url.protocol === 'https:' ? https : http;
    const body = init?.body as string | Buffer | undefined;
    // Normalize headers — may be a Headers instance, array, or plain object
    let headers: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers as string[][]) {
          headers[key] = value;
        }
      } else {
        headers = { ...init.headers };
      }
    }

    const req = requester.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: init?.method ?? 'GET',
        headers,
        family: 4, // Force IPv4 to avoid IPv6 timeout on Linux systems with broken IPv6
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 200;
          const safeHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            safeHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            headers: new Headers(safeHeaders),
            text: () => Promise.resolve(text),
            json: () => {
              try {
                return Promise.resolve(JSON.parse(text) as unknown);
              } catch {
                return Promise.reject(
                  new Error(`LLM error: response from ${url.hostname} was not valid JSON. Body: ${text.slice(0, 200)}`)
                );
              }
            },
          } as Response);
        });
        res.on('error', reject);
      }
    );

    // AbortSignal support — reject the promise and destroy the request when the signal fires
    if (init?.signal) {
      const signal = init.signal;
      const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (signal.aborted) {
        reject(abortErr);
        if (typeof (req as { destroy?: (e: Error) => void }).destroy === 'function') {
          (req as { destroy: (e: Error) => void }).destroy(abortErr);
        }
      } else {
        signal.addEventListener('abort', () => {
          reject(abortErr);
          if (typeof (req as { destroy?: (e: Error) => void }).destroy === 'function') {
            (req as { destroy: (e: Error) => void }).destroy(abortErr);
          }
        });
      }
    }

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeParameters — D-12: caller wins over purpose defaults
// ─────────────────────────────────────────────────────────────────────────────

export function mergeParameters(
  callerParams: Record<string, unknown>,
  purposeDefaults: Record<string, unknown>
): Record<string, unknown> {
  return { ...purposeDefaults, ...callerParams };
}

function normalizeProviderParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...parameters };
  if (Array.isArray(normalized['tools']) && normalized['tools'].length === 0) {
    delete normalized['tools'];
  }
  return normalized;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAICompatibleLlmClient
// ─────────────────────────────────────────────────────────────────────────────

export class OpenAICompatibleLlmClient implements LlmClient {
  private config: NonNullable<FlashQueryConfig['llm']>;
  private resolver: PurposeResolver;
  private instanceId: string;

  constructor(config: NonNullable<FlashQueryConfig['llm']>, instanceId: string) {
    this.config = config;
    this.instanceId = instanceId;
    // Bind chatHttpOnly so the resolver can call it as a function reference
    // without losing the `this` context. Using the HTTP-only internal method
    // prevents double-writing: the resolver never triggers recordLlmUsage;
    // the outer public complete()/completeByPurpose() handle recording.
    this.resolver = new PurposeResolver(config, this.chatHttpOnly.bind(this));
  }

  /**
   * Internal HTTP-only implementation — no cost tracking.
   * Used by the PurposeResolver via constructor bind so failed fallback attempts
   * do not produce cost rows. Only the SUCCESSFUL final attempt is recorded
   * (by the public complete() or completeByPurpose() wrappers).
   */
  private normalizeToolCallArguments(
    providerName: string,
    args: unknown
  ): Record<string, unknown> {
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        throw new Error(`LLM error: ${providerName} returned invalid tool call arguments JSON.`);
      }
      throw new Error(`LLM error: ${providerName} returned invalid tool call arguments JSON.`);
    }

    if (args && typeof args === 'object' && !Array.isArray(args)) {
      return args as Record<string, unknown>;
    }

    return {};
  }

  private normalizeToolCalls(providerName: string, rawToolCalls: unknown): LlmChatToolCall[] | undefined {
    if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return undefined;

    return rawToolCalls.map((toolCall) => {
      const raw = toolCall as {
        id?: unknown;
        type?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      return {
        id: typeof raw.id === 'string' ? raw.id : '',
        type: 'function',
        function: {
          name: typeof raw.function?.name === 'string' ? raw.function.name : '',
          arguments: this.normalizeToolCallArguments(providerName, raw.function?.arguments),
        },
      };
    });
  }

  private toTextCompletion(result: LlmChatResult): LlmCompletionResult {
    if ((result.message.tool_calls?.length ?? 0) > 0) {
      throw new Error('LLM error: text completion wrapper received tool calls; use chat() for tool-capable responses.');
    }
    if (typeof result.message.content !== 'string' || result.message.content.length === 0) {
      throw new Error(
        `LLM error: ${result.providerName} returned a 200 response with no completion choices. ` +
        `Raw: ${JSON.stringify({ message: result.message }).slice(0, 200)}`
      );
    }

    return {
      text: result.message.content,
      modelName: result.modelName,
      providerName: result.providerName,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    };
  }

  private async chatHttpOnly(
    modelName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmChatResult> {
    const normalizedName = modelName.toLowerCase(); // D-08

    const model = this.config.models.find((m) => m.name === normalizedName);
    if (!model) {
      throw new Error(`LLM error: Model '${normalizedName}' not found in configuration.`);
    }

    const provider = this.config.providers.find((p) => p.name === model.providerName);
    if (!provider) {
      throw new Error(
        `LLM error: Provider '${model.providerName}' not found for model '${normalizedName}'.`
      );
    }

    const apiKey = provider.apiKey;
    const mergedParams = parameters ? normalizeProviderParameters(mergeParameters(parameters, {})) : {};

    // T-99-02: timeout-bounded execution
    // Phase 99 default: 30000ms. Per-provider config deferred to a later phase.
    const timeoutMs = (provider as { timeoutMs?: number }).timeoutMs ?? 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = performance.now(); // D-10

    try {
      let response: Response;
      try {
        response = await nodeFetch(`${provider.endpoint.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...mergedParams, model: model.model, messages }), // D-07
          signal: controller.signal,
        });
      } catch (err: unknown) {
        const name = (err as { name?: string }).name;
        if (name === 'AbortError') {
          throw new LlmNetworkError(
            `LLM error: ${provider.name} request exceeded ${timeoutMs}ms timeout.`,
            { cause: err }
          );
        }
        // Re-throw if already a typed error (e.g., from nested catch — defensive)
        if (err instanceof LlmHttpError || err instanceof LlmNetworkError) {
          throw err;
        }
        throw new LlmNetworkError(
          `LLM error: Could not reach ${provider.name} API. Check your internet connection.`,
          { cause: err }
        );
      }

      if (!response.ok) {
        // D-04: Parse Retry-After header for 429 responses (in seconds; convert to ms).
        // The 30,000ms cap is NOT applied here — that is resolver-layer policy.
        const retryAfterHeader = response.headers.get('Retry-After');
        let retryAfterMs: number | undefined;
        if (retryAfterHeader) {
          const seconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(seconds) && seconds >= 0) {
            retryAfterMs = seconds * 1000;
          }
        }

        if (response.status === 401) {
          throw new LlmHttpError(
            `LLM error: ${provider.name} API returned 401 Unauthorized. Check the API key in flashquery.yml.`,
            401
          );
        }
        if (response.status === 429) {
          throw new LlmHttpError(
            `LLM error: ${provider.name} rate limit exceeded. Wait and retry.`,
            429,
            retryAfterMs
          );
        }
        let errorDetail = '';
        try {
          errorDetail = await response.text();
        } catch {
          /* ignore */
        }
        throw new LlmHttpError(
          `LLM error: ${provider.name} API returned ${response.status}. ${errorDetail}`.trim(),
          response.status
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            role?: string;
            content?: string | null;
            name?: string;
            tool_calls?: unknown;
          };
          finish_reason?: unknown;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const choice = data.choices?.[0];
      const rawMessage = choice?.message;
      const toolCalls = this.normalizeToolCalls(provider.name, rawMessage?.tool_calls);
      const hasToolCalls = (toolCalls?.length ?? 0) > 0;
      const content = rawMessage?.content ?? null;

      if (!data.choices || data.choices.length === 0 || !rawMessage) {
        throw new Error(
          `LLM error: ${provider.name} returned a 200 response with no completion choices. ` +
          `Raw: ${JSON.stringify(data).slice(0, 200)}`
        );
      }
      if ((content === null || content === '') && !hasToolCalls) {
        throw new Error(
          `LLM error: ${provider.name} returned a 200 response with no completion choices. ` +
          `Raw: ${JSON.stringify(data).slice(0, 200)}`
        );
      }
      if (typeof data.usage?.prompt_tokens !== 'number' || typeof data.usage?.completion_tokens !== 'number') {
        const message = hasToolCalls
          ? `LLM error: ${provider.name} returned a tool-call response without usage; check model capabilities. Raw: ${JSON.stringify(data).slice(0, 200)}`
          : `LLM error: ${provider.name} returned a 200 response with no usage field. Raw: ${JSON.stringify(data).slice(0, 200)}`;
        throw new Error(message);
      }

      let finishReason = typeof choice.finish_reason === 'string' && isFinishReason(choice.finish_reason)
        ? choice.finish_reason
        : choice.finish_reason === 'function_call'
          ? 'tool_calls'
          : 'unknown';
      if (hasToolCalls) finishReason = 'tool_calls';

      const latencyMs = Math.round(performance.now() - startTime); // D-10
      logger.debug(
        `LLM: ${provider.name}/${normalizedName} completed in ${latencyMs}ms ` +
          `(${data.usage.prompt_tokens}+${data.usage.completion_tokens} tokens)`
      );

      return {
        message: {
          role: 'assistant',
          content,
          ...(rawMessage.name ? { name: rawMessage.name } : {}),
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        modelName: normalizedName, // the lowercased alias (D-25)
        providerName: provider.name,
        inputTokens: data.usage.prompt_tokens, // D-10 wire mapping
        outputTokens: data.usage.completion_tokens,
        latencyMs,
        finishReason,
      };
    } finally {
      clearTimeout(timeoutId); // avoid keeping the event loop alive
    }
  }

  async complete(
    modelName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmCompletionResult> {
    const chatResult = await this.chatHttpOnly(modelName, messages, parameters);
    const result = this.toTextCompletion(chatResult);
    // D-03/D-07: fire-and-forget cost recording — _direct sentinel for direct model calls.
    // Per D-03 this call site lives in client.ts (NOT mcp/tools/llm.ts) so all future
    // internal callers automatically get cost tracking.
    const model = this.config.models.find((m) => m.name === result.modelName);
    const costUsd = model
      ? computeCost(result.inputTokens, result.outputTokens, model.costPerMillion)
      : 0;
    recordLlmUsage({
      instanceId: this.instanceId,
      purposeName: '_direct',
      modelName: result.modelName,
      providerName: result.providerName,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd,
      latencyMs: result.latencyMs,
      fallbackPosition: null,
      traceId: traceId ?? null,
    });
    return result;
  }

  async chat(
    modelName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>,
    _traceId?: string | null
  ): Promise<LlmChatResult> {
    return this.chatHttpOnly(modelName, messages, parameters);
  }

  async completeByPurpose(
    purposeName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmCompletionResult & { purposeName: string; fallbackPosition: number }> {
    const chatResult = await this.resolver.chatByPurpose(purposeName, messages, parameters);
    const completion = this.toTextCompletion(chatResult);
    const result = { ...completion, purposeName: chatResult.purposeName, fallbackPosition: chatResult.fallbackPosition };
    // D-03: fire-and-forget cost recording — actual purpose name for purpose-resolved calls.
    // This call site lives in client.ts (per D-03 architectural decision).
    const model = this.config.models.find((m) => m.name === result.modelName);
    const costUsd = model
      ? computeCost(result.inputTokens, result.outputTokens, model.costPerMillion)
      : 0;
    recordLlmUsage({
      instanceId: this.instanceId,
      purposeName,                       // actual user-supplied name, NOT '_direct'
      modelName: result.modelName,
      providerName: result.providerName,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd,
      latencyMs: result.latencyMs,
      fallbackPosition: result.fallbackPosition,  // 1-indexed
      traceId: traceId ?? null,
    });
    return result;
  }

  async chatByPurpose(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }> {
    const result = await this.resolver.chatByPurpose(purposeName, messages, parameters);
    const model = this.config.models.find((m) => m.name === result.modelName);
    const costUsd = model
      ? computeCost(result.inputTokens, result.outputTokens, model.costPerMillion)
      : 0;
    recordLlmUsage({
      instanceId: this.instanceId,
      purposeName,
      modelName: result.modelName,
      providerName: result.providerName,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd,
      latencyMs: result.latencyMs,
      fallbackPosition: result.fallbackPosition,
      traceId: traceId ?? null,
    });
    return result;
  }

  async chatByPurposeUnrecorded(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }> {
    return this.resolver.chatByPurpose(purposeName, messages, parameters);
  }

  getModelForPurpose(
    purposeName: string
  ): {
    modelName: string;
    providerName: string;
    config: NonNullable<FlashQueryConfig['llm']>['models'][number];
  } | null {
    return this.resolver.getModelForPurpose(purposeName);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NullLlmClient — used when no llm: section is present in config
// ─────────────────────────────────────────────────────────────────────────────

export class NullLlmClient implements LlmClient {
  // eslint-disable-next-line @typescript-eslint/require-await
  async chat(
    _modelName: string,
    _messages: LlmChatMessage[],
    _parameters?: Record<string, unknown>,
    _traceId?: string | null
  ): Promise<LlmChatResult> {
    throw new Error(
      'No LLM configuration found. Add an llm: section to flashquery.yml to use this tool.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async complete(
    _modelName: string,
    _messages: ChatMessage[],
    _parameters?: Record<string, unknown>,
    _traceId?: string | null
  ): Promise<LlmCompletionResult> {
    throw new Error(
      'No LLM configuration found. Add an llm: section to flashquery.yml to use this tool.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async completeByPurpose(
    _purposeName: string,
    _messages: ChatMessage[],
    _parameters?: Record<string, unknown>,
    _traceId?: string | null
  ): Promise<LlmCompletionResult & { purposeName: string; fallbackPosition: number }> {
    throw new Error(
      'No LLM configuration found. Add an llm: section to flashquery.yml to use this tool.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async chatByPurpose(
    _purposeName: string,
    _messages: LlmChatMessage[],
    _parameters?: Record<string, unknown>,
    _traceId?: string | null
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }> {
    throw new Error(
      'No LLM configuration found. Add an llm: section to flashquery.yml to use this tool.'
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async chatByPurposeUnrecorded(
    _purposeName: string,
    _messages: LlmChatMessage[],
    _parameters?: Record<string, unknown>
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }> {
    throw new Error(
      'No LLM configuration found. Add an llm: section to flashquery.yml to use this tool.'
    );
  }

  // Phase 106 fix: honor the LlmClient.getModelForPurpose contract — return null
  // when no LLM is configured, instead of throwing. The OpenAICompatibleLlmClient
  // signals "purpose has no models" by also returning null, so callers should
  // check for null. The previous throw-based behavior was a latent interface
  // violation flagged in v3.0-MILESTONE-AUDIT.md.
  getModelForPurpose(
    _purposeName: string
  ): {
    modelName: string;
    providerName: string;
    config: NonNullable<FlashQueryConfig['llm']>['models'][number];
  } | null {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton — assigned by initLlm() in Plan 02.
// Until then, downstream imports will see `undefined` if accessed before init.
// ─────────────────────────────────────────────────────────────────────────────

export let llmClient: LlmClient | undefined;

// ─────────────────────────────────────────────────────────────────────────────
// initLlm — top-level LLM initialization (D-02, D-03)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level LLM initialization. Called once at startup from src/index.ts
 * after initEmbedding(). Assigns the module-level `llmClient` singleton
 * to either a NullLlmClient (when no llm: section configured — CONF-05)
 * or an OpenAICompatibleLlmClient (when configured), then syncs the
 * three-layer config to Supabase.
 *
 * Exact log messages are part of the contract — L-03 directed scenario
 * asserts on the substrings "N provider(s), M purpose(s)" and
 * "not configured" via the FQC ready banner.
 */
export async function initLlm(config: FlashQueryConfig): Promise<void> {
  if (!config.llm) {
    llmClient = new NullLlmClient();
    logger.info('LLM: not configured');
    return;
  }
  llmClient = new OpenAICompatibleLlmClient(config.llm, config.instance.id);
  await syncLlmConfigToDb(config);
  await validatePersistedPurposeTemplateAdmissions(config);
  logger.info(
    `LLM: ${config.llm.providers.length} provider(s), ${config.llm.purposes.length} purpose(s) configured`
  );
}
