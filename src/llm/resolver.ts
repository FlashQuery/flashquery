import type { FlashQueryConfig } from '../config/types.js';
import { LlmFallbackError, LlmHttpError } from './errors.js';
import type { ChatMessage, LlmCompletionResult } from './runtime-types.js';
import type { LlmChatMessage, LlmChatResult } from './types.js';

export { LlmFallbackError } from './errors.js';

function mergeParameters(
  callerParams: Record<string, unknown>,
  purposeDefaults: Record<string, unknown>
): Record<string, unknown> {
  return { ...purposeDefaults, ...callerParams };
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
  private chatFn: (
    modelName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>
  ) => Promise<LlmChatResult | LlmCompletionResult>;

  constructor(
    config: NonNullable<FlashQueryConfig['llm']>,
    chatFn: (
      modelName: string,
      messages: LlmChatMessage[],
      parameters?: Record<string, unknown>
    ) => Promise<LlmChatResult | LlmCompletionResult>
  ) {
    this.config = config;
    this.chatFn = chatFn;
  }

  private async resolveByPurpose<T>(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters: Record<string, unknown> | undefined,
    fn: (
      modelName: string,
      messages: LlmChatMessage[],
      parameters?: Record<string, unknown>
    ) => Promise<T>
  ): Promise<T & { purposeName: string; fallbackPosition: number }> {
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
        const result = await fn(modelName, messages, mergedParams);
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

  // LLM-02 + LLM-03: walk the chain, classify errors, merge params.
  // Return type adds purposeName (lowercased) and fallbackPosition (1-indexed).
  async chatByPurpose(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }> {
    const result = await this.resolveByPurpose(purposeName, messages, parameters, this.chatFn);
    if ('message' in result) return result;
    return {
      message: { role: 'assistant', content: result.text },
      modelName: result.modelName,
      providerName: result.providerName,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      finishReason: 'stop',
      purposeName: result.purposeName,
      fallbackPosition: result.fallbackPosition,
    };
  }

  async completeByPurpose(
    purposeName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmCompletionResult & { purposeName: string; fallbackPosition: number }> {
    return this.resolveByPurpose(purposeName, messages, parameters, async (modelName, chatMessages, mergedParams) => {
      const result = await this.chatFn(modelName, chatMessages, mergedParams);
      if ('text' in result) return result;
      if ((result.message.tool_calls?.length ?? 0) > 0) {
        throw new Error('LLM error: text completion wrapper received tool calls; use chat() for tool-capable responses.');
      }
      if (typeof result.message.content !== 'string' || result.message.content.length === 0) {
        throw new Error(`LLM error: ${result.providerName} returned a 200 response with no completion choices.`);
      }
      return {
        text: result.message.content,
        modelName: result.modelName,
        providerName: result.providerName,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
      };
    });
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
