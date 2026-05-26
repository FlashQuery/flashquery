// ─────────────────────────────────────────────────────────────────────────────
// Typed LLM runtime errors
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
