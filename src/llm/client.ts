import * as http from 'node:http';
import * as https from 'node:https';
import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';

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
    parameters?: Record<string, unknown>
  ): Promise<LlmCompletionResult>;
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
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage ?? '',
            headers: new Headers(res.headers as Record<string, string>),
            text: () => Promise.resolve(text),
            json: () => Promise.resolve(JSON.parse(text) as unknown),
          } as Response);
        });
        res.on('error', reject);
      }
    );

    // AbortSignal support — reject the promise and destroy the request when the signal fires
    if (init?.signal) {
      const signal = init.signal as AbortSignal;
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

  constructor(config: NonNullable<FlashQueryConfig['llm']>) {
    this.config = config;
  }

  async complete(
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
        response = await nodeFetch(`${provider.endpoint}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: model.model, messages, ...mergedParams }), // D-07
          signal: controller.signal,
        });
      } catch (err: unknown) {
        const name = (err as { name?: string }).name;
        if (name === 'AbortError') {
          throw new Error(
            `LLM error: ${provider.name} request exceeded ${timeoutMs}ms timeout.`
          );
        }
        throw new Error(
          `LLM error: Could not reach ${provider.name} API. Check your internet connection.`
        );
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            `LLM error: ${provider.name} API returned 401 Unauthorized. Check the API key in flashquery.yml.`
          );
        }
        if (response.status === 429) {
          throw new Error(
            `LLM error: ${provider.name} rate limit exceeded. Wait and retry.`
          );
        }
        let errorDetail = '';
        try {
          errorDetail = await response.text();
        } catch {
          /* ignore */
        }
        throw new Error(
          `LLM error: ${provider.name} API returned ${response.status}. ${errorDetail}`.trim()
        );
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

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
}

// ─────────────────────────────────────────────────────────────────────────────
// NullLlmClient — used when no llm: section is present in config
// ─────────────────────────────────────────────────────────────────────────────

export class NullLlmClient implements LlmClient {
  // eslint-disable-next-line @typescript-eslint/require-await
  async complete(
    _modelName: string,
    _messages: ChatMessage[],
    _parameters?: Record<string, unknown>
  ): Promise<LlmCompletionResult> {
    throw new Error(
      'No LLM configuration found. Add an llm: section to flashquery.yml to use this tool.'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton — assigned by initLlm() in Plan 02.
// Until then, downstream imports will see `undefined` if accessed before init.
// ─────────────────────────────────────────────────────────────────────────────

export let llmClient: LlmClient;

// ─────────────────────────────────────────────────────────────────────────────
// initLlm — Plan 01 stub. Plan 02 replaces this with the real implementation
// that creates OpenAICompatibleLlmClient or NullLlmClient and calls
// syncLlmConfigToDb() (D-02, D-03).
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/require-await
export async function initLlm(_config: FlashQueryConfig): Promise<void> {
  throw new Error('initLlm not yet implemented — Plan 02 wires this.');
}
