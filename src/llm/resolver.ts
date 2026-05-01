import type { FlashQueryConfig } from '../config/loader.js';
import {
  mergeParameters,
  LlmHttpError,
  LlmNetworkError,
  type ChatMessage,
  type LlmCompletionResult,
} from './client.js';

// ─────────────────────────────────────────────────────────────────────────────
// LlmFallbackError — D-06
// Thrown by PurposeResolver.completeByPurpose() when all models in the chain
// fail, OR when the purpose's models list is empty (PURP-02).
// Attempts array preserves the order of attempts; downstream code (Phase 101)
// formats this for the MCP response envelope.
// ─────────────────────────────────────────────────────────────────────────────

export class LlmFallbackError extends Error {
  readonly purposeName: string;
  readonly attempts: Array<{
    modelName: string;
    providerName: string;
    error: LlmHttpError | LlmNetworkError | Error;
  }>;

  constructor(
    purposeName: string,
    attempts: Array<{ modelName: string; providerName: string; error: Error }>
  ) {
    super(`Purpose '${purposeName}' failed — all ${attempts.length} models exhausted`);
    this.name = 'LlmFallbackError';
    this.purposeName = purposeName;
    this.attempts = attempts;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// delay — internal helper
// Promise-wrapped setTimeout. Used by completeByPurpose() to apply 429 back-off.
// ─────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// PurposeResolver — D-01
// Orchestration layer over OpenAICompatibleLlmClient.complete().
// Walks a purpose's ordered fallback chain (D-03), classifies errors via
// instanceof + status code, applies 429 back-off (D-04), and merges parameters
// (caller wins over purpose defaults — D-05 / LLM-03).
//
// The constructor takes a `completeFn` reference rather than the full client,
// which keeps the class testable without instantiating a live HTTP client.
// OpenAICompatibleLlmClient (in client.ts) instantiates this with a binding
// of its own `complete()` method.
// ─────────────────────────────────────────────────────────────────────────────

export class PurposeResolver {
  private config: NonNullable<FlashQueryConfig['llm']>;
  private completeFn: (
    modelName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>
  ) => Promise<LlmCompletionResult>;

  constructor(
    config: NonNullable<FlashQueryConfig['llm']>,
    completeFn: (
      modelName: string,
      messages: ChatMessage[],
      parameters?: Record<string, unknown>
    ) => Promise<LlmCompletionResult>
  ) {
    this.config = config;
    this.completeFn = completeFn;
  }

  // LLM-02 + LLM-03: walk the chain, classify errors, merge params.
  // Return type adds purposeName (lowercased) and fallbackPosition (1-indexed).
  async completeByPurpose(
    purposeName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmCompletionResult & { purposeName: string; fallbackPosition: number }> {
    const normalizedName = purposeName.toLowerCase(); // CONF-07 normalization at runtime
    const purpose = this.config.purposes.find((p) => p.name === normalizedName);

    if (!purpose) {
      throw new Error(`LLM error: Purpose '${normalizedName}' not found in configuration.`);
    }

    const attempts: Array<{ modelName: string; providerName: string; error: Error }> = [];

    for (let i = 0; i < purpose.models.length; i++) {
      const modelName = purpose.models[i];
      // D-05 / LLM-03: caller wins over purpose defaults; mergeParameters does shallow merge.
      const mergedParams = mergeParameters(parameters ?? {}, purpose.defaults ?? {});

      try {
        const result = await this.completeFn(modelName, messages, mergedParams);
        return { ...result, purposeName: normalizedName, fallbackPosition: i + 1 };
      } catch (err: unknown) {
        const model = this.config.models.find((m) => m.name === modelName);
        const providerName = model?.providerName ?? 'unknown';
        const error = err instanceof Error ? err : new Error(String(err));
        attempts.push({ modelName, providerName, error });

        // D-03: permanent — stop chain immediately on 400, 401, or 403
        if (err instanceof LlmHttpError && [400, 401, 403].includes(err.status)) {
          throw new LlmFallbackError(normalizedName, attempts);
        }

        // D-04: 429 — wait min(retryAfterMs ?? 1000, 30000) ms then advance
        if (err instanceof LlmHttpError && err.status === 429) {
          const delayMs = Math.min(err.retryAfterMs ?? 1000, 30000);
          await delay(delayMs);
        }

        // All other errors (LlmHttpError 5xx/other, LlmNetworkError, plain Error)
        // are transient — fall through to next iteration.
      }
    }

    // All models exhausted (or empty models list — PURP-02 returns 0-attempt LlmFallbackError)
    throw new LlmFallbackError(normalizedName, attempts);
  }

  // LLM-04: pure config lookup — no network call.
  // Returns null for: unknown purpose, empty models list, or first model entry
  // missing from config.models (defensive against config drift).
  getModelForPurpose(
    purposeName: string
  ): {
    modelName: string;
    providerName: string;
    config: NonNullable<FlashQueryConfig['llm']>['models'][number];
  } | null {
    const normalizedName = purposeName.toLowerCase();
    const purpose = this.config.purposes.find((p) => p.name === normalizedName);
    if (!purpose || purpose.models.length === 0) return null;

    const modelName = purpose.models[0];
    const modelConfig = this.config.models.find((m) => m.name === modelName);
    if (!modelConfig) return null;

    return {
      modelName,
      providerName: modelConfig.providerName,
      config: modelConfig,
    };
  }
}
