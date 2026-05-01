import * as http from 'node:http';
import * as https from 'node:https';
import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';
import { computeCost, recordLlmUsage } from './cost-tracker.js';
import { syncLlmConfigToDb } from './config-sync.js';
import { PurposeResolver } from './resolver.js';

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
    // Bind completeHttpOnly so the resolver can call it as a function reference
    // without losing the `this` context. Using the HTTP-only internal method
    // prevents double-writing: the resolver never triggers recordLlmUsage;
    // the outer public complete()/completeByPurpose() handle recording.
    this.resolver = new PurposeResolver(config, this.completeHttpOnly.bind(this));
  }

  /**
   * Internal HTTP-only implementation — no cost tracking.
   * Used by the PurposeResolver via constructor bind so failed fallback attempts
   * do not produce cost rows. Only the SUCCESSFUL final attempt is recorded
   * (by the public complete() or completeByPurpose() wrappers).
   */
  private async completeHttpOnly(
    modelName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmCompletionResult> {
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
    const mergedParams = parameters ? mergeParameters(parameters, {}) : {};

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
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      if (!data.choices || data.choices.length === 0 || !data.choices[0]?.message?.content) {
        throw new Error(
          `LLM error: ${provider.name} returned a 200 response with no completion choices. ` +
          `Raw: ${JSON.stringify(data).slice(0, 200)}`
        );
      }
      if (!data.usage) {
        throw new Error(
          `LLM error: ${provider.name} returned a 200 response with no usage field. ` +
          `Raw: ${JSON.stringify(data).slice(0, 200)}`
        );
      }

      const latencyMs = Math.round(performance.now() - startTime); // D-10
      logger.debug(
        `LLM: ${provider.name}/${normalizedName} completed in ${latencyMs}ms ` +
          `(${data.usage.prompt_tokens}+${data.usage.completion_tokens} tokens)`
      );

      return {
        text: data.choices[0].message.content,
        modelName: normalizedName, // the lowercased alias (D-25)
        providerName: provider.name,
        inputTokens: data.usage.prompt_tokens, // D-10 wire mapping
        outputTokens: data.usage.completion_tokens,
        latencyMs,
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
    const result = await this.completeHttpOnly(modelName, messages, parameters);
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

  async completeByPurpose(
    purposeName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmCompletionResult & { purposeName: string; fallbackPosition: number }> {
    const result = await this.resolver.completeByPurpose(purposeName, messages, parameters);
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
  logger.info(
    `LLM: ${config.llm.providers.length} provider(s), ${config.llm.purposes.length} purpose(s) configured`
  );
}
