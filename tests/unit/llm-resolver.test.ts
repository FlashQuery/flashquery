import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PurposeResolver, LlmFallbackError } from '../../src/llm/resolver.js';
import {
  LlmHttpError,
  LlmNetworkError,
  type ChatMessage,
  type LlmCompletionResult,
} from '../../src/llm/client.js';

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TEST_LLM_CONFIG = {
  providers: [
    { name: 'openai', type: 'openai-compatible' as const, endpoint: 'https://api.openai.com', apiKey: 'sk-test' },
    { name: 'openrouter', type: 'openai-compatible' as const, endpoint: 'https://openrouter.ai/api', apiKey: 'or-test' },
  ],
  models: [
    { name: 'primary', providerName: 'openai', model: 'gpt-4o', type: 'language' as const, costPerMillion: { input: 2.5, output: 10 } },
    { name: 'fallback', providerName: 'openrouter', model: 'claude-3-haiku', type: 'language' as const, costPerMillion: { input: 0.25, output: 1.25 } },
    { name: 'tertiary', providerName: 'openai', model: 'gpt-4o-mini', type: 'language' as const, costPerMillion: { input: 0.15, output: 0.6 } },
  ],
  purposes: [
    { name: 'chat', description: 'Chat', models: ['primary', 'fallback', 'tertiary'], defaults: { temperature: 0.7, max_tokens: 100 } },
    { name: 'empty', description: 'No models', models: [] },
    { name: 'single', description: 'Single model', models: ['primary'] },
    { name: 'broken', description: 'References missing model', models: ['nonexistent'] },
  ],
};

const SAMPLE_MESSAGES: ChatMessage[] = [
  { role: 'user', content: 'hello' },
];

const SAMPLE_RESULT: LlmCompletionResult = {
  text: 'response text',
  modelName: 'primary',
  providerName: 'openai',
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 100,
};

let mockComplete: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockComplete = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// LlmFallbackError (U-39..U-41)
// RED — src/llm/resolver.ts does not exist yet
// ─────────────────────────────────────────────────────────────────────────────

describe('LlmFallbackError', () => {
  it('U-39: LlmFallbackError(purposeName, []) produces correct name, purposeName, attempts.length=0, message, instanceof Error', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmFallbackError('chat', []);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LlmFallbackError');
    expect(err.purposeName).toBe('chat');
    expect(err.attempts.length).toBe(0);
    expect(err.message).toBe("Purpose 'chat' failed — all 0 models exhausted");
  });

  it('U-40: LlmFallbackError with 2 attempts carries ordered attempts and message says "all 2 models"', () => {
    const attempts = [
      { modelName: 'a', providerName: 'p1', error: new Error('e1') },
      { modelName: 'b', providerName: 'p2', error: new Error('e2') },
    ];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmFallbackError('chat', attempts);
    expect(err.attempts.length).toBe(2);
    expect(err.message).toContain('all 2 models');
    expect(err.attempts[0].modelName).toBe('a');
    expect(err.attempts[1].modelName).toBe('b');
  });

  it('U-41: LlmFallbackError.attempts carries original error objects unchanged (LlmHttpError instanceof check)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const httpErr = new LlmHttpError('unauthorized', 401);
    const attempts = [
      { modelName: 'primary', providerName: 'openai', error: httpErr },
    ];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmFallbackError('chat', attempts);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect(err.attempts[0].error).toBeInstanceOf(LlmHttpError);
    expect((err.attempts[0].error as { status?: number }).status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PurposeResolver.completeByPurpose (U-42..U-57)
// RED — PurposeResolver does not exist yet
// ─────────────────────────────────────────────────────────────────────────────

describe('PurposeResolver.completeByPurpose', () => {
  it('U-42: First model succeeds → returns { ...result, purposeName: "chat", fallbackPosition: 1 }; mockComplete called once', async () => {
    mockComplete.mockResolvedValueOnce(SAMPLE_RESULT);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await resolver.completeByPurpose('chat', SAMPLE_MESSAGES);
    expect(result.purposeName).toBe('chat');
    expect(result.fallbackPosition).toBe(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledWith('primary', SAMPLE_MESSAGES, expect.any(Object));
  });

  it('U-43: First model throws transient LlmHttpError(500) → second model succeeds → fallbackPosition=2; mockComplete called twice', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mockComplete
      .mockRejectedValueOnce(new LlmHttpError('server error', 500))
      .mockResolvedValueOnce({ ...SAMPLE_RESULT, modelName: 'fallback', providerName: 'openrouter' });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await resolver.completeByPurpose('chat', SAMPLE_MESSAGES);
    expect(result.fallbackPosition).toBe(2);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it('U-44: First model throws LlmNetworkError → second model succeeds → fallbackPosition=2', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mockComplete
      .mockRejectedValueOnce(new LlmNetworkError('timeout'))
      .mockResolvedValueOnce({ ...SAMPLE_RESULT, modelName: 'fallback', providerName: 'openrouter' });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await resolver.completeByPurpose('chat', SAMPLE_MESSAGES);
    expect(result.fallbackPosition).toBe(2);
  });

  it('U-45: First model throws permanent LlmHttpError(401) → LlmFallbackError immediately; mockComplete called once; attempts[0].error.status===401', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mockComplete.mockRejectedValueOnce(new LlmHttpError('unauthorized', 401));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await expect(resolver.completeByPurpose('chat', SAMPLE_MESSAGES)).rejects.toBeInstanceOf(LlmFallbackError);
    expect(mockComplete).toHaveBeenCalledTimes(1);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mockComplete.mockRejectedValueOnce(new LlmHttpError('unauthorized', 401));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver2 = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await resolver2.completeByPurpose('chat', SAMPLE_MESSAGES);
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      expect(err).toBeInstanceOf(LlmFallbackError);
      const fallbackErr = err as { attempts: Array<{ error: { status?: number } }> };
      expect(fallbackErr.attempts.length).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      expect(fallbackErr.attempts[0].error).toBeInstanceOf(LlmHttpError);
      expect(fallbackErr.attempts[0].error.status).toBe(401);
    }
  });

  it('U-46: First model throws permanent LlmHttpError(400) → LlmFallbackError immediately; mockComplete called once', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mockComplete.mockRejectedValueOnce(new LlmHttpError('bad request', 400));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await expect(resolver.completeByPurpose('chat', SAMPLE_MESSAGES)).rejects.toBeInstanceOf(LlmFallbackError);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('U-47: First model throws permanent LlmHttpError(403) → LlmFallbackError immediately; mockComplete called once', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mockComplete.mockRejectedValueOnce(new LlmHttpError('forbidden', 403));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await expect(resolver.completeByPurpose('chat', SAMPLE_MESSAGES)).rejects.toBeInstanceOf(LlmFallbackError);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('U-48: 429 with retryAfterMs=5000 waits 5000ms before retrying second model (D-04)', async () => {
    vi.useFakeTimers();
    mockComplete
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      .mockRejectedValueOnce(new LlmHttpError('rate limit', 429, 5000))
      .mockResolvedValueOnce({ ...SAMPLE_RESULT, modelName: 'fallback' });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const promise = resolver.completeByPurpose('chat', SAMPLE_MESSAGES);

    // Allow first call to throw, then advance timers
    await vi.advanceTimersByTimeAsync(4999);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    // After timer fires, second call happens
    const result = await promise;
    expect(result.fallbackPosition).toBe(2);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it('U-49: 429 WITHOUT retryAfterMs waits exactly 1000ms (default per D-04)', async () => {
    vi.useFakeTimers();
    mockComplete
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      .mockRejectedValueOnce(new LlmHttpError('rate limit', 429))
      .mockResolvedValueOnce({ ...SAMPLE_RESULT, modelName: 'fallback' });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const promise = resolver.completeByPurpose('chat', SAMPLE_MESSAGES);

    // Before default 1000ms delay
    await vi.advanceTimersByTimeAsync(999);
    expect(mockComplete).toHaveBeenCalledTimes(1);

    // After 1000ms delay, second call should happen
    await vi.advanceTimersByTimeAsync(2);
    const result = await promise;
    expect(result.fallbackPosition).toBe(2);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it('U-50: 429 with retryAfterMs=60000 caps wait at 30000ms (D-04 cap)', async () => {
    vi.useFakeTimers();
    mockComplete
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      .mockRejectedValueOnce(new LlmHttpError('rate limit', 429, 60000))
      .mockResolvedValueOnce({ ...SAMPLE_RESULT, modelName: 'fallback' });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const promise = resolver.completeByPurpose('chat', SAMPLE_MESSAGES);

    // Should NOT wait 60000ms — capped at 30000ms
    await vi.advanceTimersByTimeAsync(29999);
    expect(mockComplete).toHaveBeenCalledTimes(1);

    // After 30000ms cap, second call should happen
    await vi.advanceTimersByTimeAsync(2);
    const result = await promise;
    expect(result.fallbackPosition).toBe(2);
    expect(mockComplete).toHaveBeenCalledTimes(2);
  });

  it('U-51: All 3 models fail with mixed transient errors → LlmFallbackError with attempts.length===3, entries in order', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    mockComplete
      .mockRejectedValueOnce(new LlmHttpError('server error', 500))
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      .mockRejectedValueOnce(new LlmNetworkError('connection refused'))
      .mockRejectedValueOnce(new LlmHttpError('gateway timeout', 504));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await resolver.completeByPurpose('chat', SAMPLE_MESSAGES);
      throw new Error('Expected LlmFallbackError to be thrown');
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      expect(err).toBeInstanceOf(LlmFallbackError);
      const fallbackErr = err as { attempts: Array<{ modelName: string; providerName: string }> };
      expect(fallbackErr.attempts.length).toBe(3);
      expect(fallbackErr.attempts[0].modelName).toBe('primary');
      expect(fallbackErr.attempts[1].modelName).toBe('fallback');
      expect(fallbackErr.attempts[2].modelName).toBe('tertiary');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // LLM-03: Parameter merge precedence (U-52..U-54)
  // ─────────────────────────────────────────────────────────────────────────────

  it('U-52: caller params override purpose defaults — caller wins on temperature; max_tokens carries through (LLM-03)', async () => {
    mockComplete.mockResolvedValueOnce(SAMPLE_RESULT);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await resolver.completeByPurpose('chat', SAMPLE_MESSAGES, { temperature: 0.2 });
    expect(mockComplete).toHaveBeenCalledWith(
      'primary',
      SAMPLE_MESSAGES,
      { temperature: 0.2, max_tokens: 100 } // temperature overridden, max_tokens preserved from defaults
    );
  });

  it('U-53: Empty caller params + purpose defaults → mockComplete called with purpose defaults', async () => {
    mockComplete.mockResolvedValueOnce(SAMPLE_RESULT);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await resolver.completeByPurpose('chat', SAMPLE_MESSAGES, {});
    expect(mockComplete).toHaveBeenCalledWith(
      'primary',
      SAMPLE_MESSAGES,
      { temperature: 0.7, max_tokens: 100 }
    );
  });

  it('U-54: Purpose with no defaults field + caller params → mockComplete called with caller params (no crash on undefined defaults)', async () => {
    // 'single' purpose has no defaults field
    mockComplete.mockResolvedValueOnce({ ...SAMPLE_RESULT });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await resolver.completeByPurpose('single', SAMPLE_MESSAGES, { temperature: 0.5 });
    expect(mockComplete).toHaveBeenCalledWith(
      'primary',
      SAMPLE_MESSAGES,
      { temperature: 0.5 }
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Edge cases (U-55..U-57)
  // ─────────────────────────────────────────────────────────────────────────────

  it('U-55: Purpose name CHAT (mixed case) lowercased to chat before lookup; returned purposeName === chat', async () => {
    mockComplete.mockResolvedValueOnce(SAMPLE_RESULT);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await resolver.completeByPurpose('CHAT', SAMPLE_MESSAGES);
    expect(result.purposeName).toBe('chat');
  });

  it('U-56: Purpose name not found throws plain Error with /Purpose unknown not found/ (NOT LlmFallbackError)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await expect(resolver.completeByPurpose('unknown', SAMPLE_MESSAGES)).rejects.toThrow(
      /Purpose 'unknown' not found/
    );
    // Must NOT be LlmFallbackError
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await expect(resolver.completeByPurpose('unknown', SAMPLE_MESSAGES)).rejects.not.toBeInstanceOf(LlmFallbackError);
  });

  it('U-57: Purpose empty with models:[] throws LlmFallbackError with attempts.length===0', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await resolver.completeByPurpose('empty', SAMPLE_MESSAGES);
      throw new Error('Expected LlmFallbackError to be thrown');
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      expect(err).toBeInstanceOf(LlmFallbackError);
      const fallbackErr = err as { attempts: unknown[]; message: string };
      expect(fallbackErr.attempts.length).toBe(0);
      expect(fallbackErr.message).toBe("Purpose 'empty' failed — all 0 models exhausted");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PurposeResolver.getModelForPurpose (U-58..U-62)
// RED — PurposeResolver does not exist yet
// ─────────────────────────────────────────────────────────────────────────────

describe('PurposeResolver.getModelForPurpose', () => {
  it('U-58: Existing purpose chat returns first model config; mockComplete NOT called (no network call, LLM-04)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = resolver.getModelForPurpose('chat');
    expect(result).toEqual({
      modelName: 'primary',
      providerName: 'openai',
      config: TEST_LLM_CONFIG.models[0],
    });
    expect(mockComplete).not.toHaveBeenCalled(); // critical: no network call
  });

  it('U-59: Purpose empty (models=[]) returns null', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = resolver.getModelForPurpose('empty');
    expect(result).toBeNull();
  });

  it('U-60: Purpose unknown (not in config) returns null', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = resolver.getModelForPurpose('unknown');
    expect(result).toBeNull();
  });

  it('U-61: Mixed-case CHAT lowercases to chat and returns same as U-58', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = resolver.getModelForPurpose('CHAT');
    expect(result).toEqual({
      modelName: 'primary',
      providerName: 'openai',
      config: TEST_LLM_CONFIG.models[0],
    });
  });

  it('U-62: Purpose references missing model name → returns null (defensive)', () => {
    // 'broken' purpose references 'nonexistent' which is not in models array
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = resolver.getModelForPurpose('broken');
    expect(result).toBeNull();
  });
});
