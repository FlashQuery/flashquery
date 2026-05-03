import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerLlmTools } from '../../src/mcp/tools/llm.js';
import { computeCost } from '../../src/llm/cost-tracker.js';
import { NullLlmClient, type LlmClient, type LlmCompletionResult } from '../../src/llm/client.js';
import { LlmFallbackError } from '../../src/llm/resolver.js';
import {
  parseReferences,
  resolveReferences,
  hydrateMessages,
  buildInjectedReferences,
  computePromptChars,
} from '../../src/llm/reference-resolver.js';

// Logger mock — same pattern as tests/unit/llm-resolver.test.ts
vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// getIsShuttingDown mock — handler reads this first
vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

// supabaseManager mock — chainable .from().select().eq().eq() (insert removed — D-06: llm.ts no longer calls .insert() directly)
const selectEqEqMock = vi.fn().mockResolvedValue({ data: [], error: null });
const selectEqMock = vi.fn(() => ({ eq: selectEqEqMock }));
const selectMock = vi.fn(() => ({ eq: selectEqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => ({ from: fromMock })),
  },
}));

// llm/client.js mock — expose a mutable llmClient so tests can swap implementations
// The mocked module re-exports NullLlmClient for the instanceof check to work.
let _llmClientValue: LlmClient | undefined = undefined;
vi.mock('../../src/llm/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/llm/client.js')>();
  return {
    ...original,
    get llmClient() {
      return _llmClientValue;
    },
  };
});

// reference-resolver mock — allows tests to control parseReferences / resolveReferences / hydrateMessages
vi.mock('../../src/llm/reference-resolver.js', () => ({
  parseReferences: vi.fn(),
  resolveReferences: vi.fn(),
  hydrateMessages: vi.fn(),
  buildInjectedReferences: vi.fn(),
  computePromptChars: vi.fn(),
}));

// embeddingProvider mock — new llm.ts import must resolve cleanly in tests
vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: { embed: vi.fn() },
}));

// ─── Test fixtures ──────────────────────────────────────────────────────────

const TEST_LLM_CONFIG = {
  providers: [
    { name: 'openai', type: 'openai-compatible' as const, endpoint: 'https://api.openai.com', apiKey: 'sk-test' },
  ],
  models: [
    { name: 'fast', providerName: 'openai', model: 'gpt-4o-mini', type: 'language' as const, costPerMillion: { input: 0.15, output: 0.6 } },
    { name: 'slow', providerName: 'openai', model: 'gpt-4o', type: 'language' as const, costPerMillion: { input: 2.5, output: 10.0 } },
  ],
  purposes: [
    { name: 'general', description: 'General', models: ['fast'], defaults: { temperature: 0.7 } },
  ],
};

const TEST_CONFIG = {
  instance: { id: 'test-instance-123', name: 'Test', vault: { path: '/tmp/vault', markdownExtensions: ['.md'] } },
  llm: TEST_LLM_CONFIG,
} as unknown as import('../../src/config/loader.js').FlashQueryConfig;

const SAMPLE_RESULT: LlmCompletionResult = {
  text: 'hello world',
  modelName: 'fast',
  providerName: 'openai',
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 150,
};

beforeEach(() => {
  vi.clearAllMocks();
  _llmClientValue = undefined;
  selectEqEqMock.mockResolvedValue({ data: [], error: null });
  // Default: no patterns in messages (REFS-07 path) — existing tests are unaffected
  vi.mocked(parseReferences).mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── U-29: computeCost ──────────────────────────────────────────────────────

describe('computeCost (U-29)', () => {
  it('U-29: computeCost(10, 5, { input: 2.5, output: 10 }) returns (10*2.5 + 5*10) / 1_000_000', () => {
    expect(computeCost(10, 5, { input: 2.5, output: 10 })).toBeCloseTo((10 * 2.5 + 5 * 10) / 1_000_000, 12);
  });

  it('U-29b: computeCost(0, 0, { input: 1, output: 1 }) returns 0', () => {
    expect(computeCost(0, 0, { input: 1, output: 1 })).toBe(0);
  });

  it('U-29c: computeCost(1_000_000, 1_000_000, { input: 1, output: 2 }) returns 3', () => {
    expect(computeCost(1_000_000, 1_000_000, { input: 1, output: 2 })).toBeCloseTo(3, 10);
  });

  it('U-29d: computeCost works with cost rate 0 (free/local model)', () => {
    expect(computeCost(100, 200, { input: 0, output: 0 })).toBe(0);
  });
});

// ─── U-30: NullLlmClient guard returns clean unconfigured error ─────────────

describe('call_model handler — unconfigured detection (U-30)', () => {
  it('U-30: when llmClient is a NullLlmClient instance, handler returns isError:true with "LLM is not configured. Add an llm: section to flashquery.yml to use this tool."', async () => {
    // Set active client to NullLlmClient via the module-level variable
    _llmClientValue = new NullLlmClient();

    // Use a registerTool spy to capture the registered handler.
    const handlers = new Map<string, (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    const fakeServer = {
      registerTool: vi.fn((name: string, _spec: unknown, handler: (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>) => {
        handlers.set(name, handler);
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerLlmTools(fakeServer as any, TEST_CONFIG);
    const handler = handlers.get('call_model');
    expect(handler).toBeDefined();

    const result = await handler!({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user' as const, content: 'hi' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'LLM is not configured. Add an llm: section to flashquery.yml to use this tool.'
    );
  });
});

// ─── U-31: trace_id envelope shape (present vs omitted) ─────────────────────

describe('call_model handler — trace_id envelope shape (U-31)', () => {
  it('U-31a: when trace_id is provided, response envelope.metadata contains trace_id and trace_cumulative', async () => {
    // Stub a working LlmClient that returns SAMPLE_RESULT.
    const workingClient: LlmClient = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn().mockResolvedValue({ ...SAMPLE_RESULT, purposeName: 'general', fallbackPosition: 1 }),
      getModelForPurpose: vi.fn().mockReturnValue({ modelName: 'fast', providerName: 'openai', config: TEST_LLM_CONFIG.models[0] }),
    };
    _llmClientValue = workingClient;

    const handlers = new Map<string, (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    const fakeServer = {
      registerTool: vi.fn((name: string, _spec: unknown, handler: (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>) => {
        handlers.set(name, handler);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerLlmTools(fakeServer as any, TEST_CONFIG);
    const handler = handlers.get('call_model')!;

    const result = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user' as const, content: 'hi' }],
      trace_id: 'trace-abc-123',
    });

    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(result.content[0].text) as any;
    expect(envelope.metadata.trace_id).toBe('trace-abc-123');
    expect(envelope.metadata.trace_cumulative).toBeDefined();
    expect(envelope.metadata.trace_cumulative.total_calls).toBeGreaterThanOrEqual(1);
    expect(envelope.metadata.trace_cumulative.total_tokens).toBeDefined();
    expect(envelope.metadata.trace_cumulative.total_cost_usd).toBeGreaterThanOrEqual(0);
    expect(envelope.metadata.trace_cumulative.total_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('U-31b: when trace_id is NOT provided, response envelope.metadata omits BOTH trace_id and trace_cumulative entirely (not null)', async () => {
    const workingClient: LlmClient = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn().mockResolvedValue({ ...SAMPLE_RESULT, purposeName: 'general', fallbackPosition: 1 }),
      getModelForPurpose: vi.fn().mockReturnValue({ modelName: 'fast', providerName: 'openai', config: TEST_LLM_CONFIG.models[0] }),
    };
    _llmClientValue = workingClient;

    const handlers = new Map<string, (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    const fakeServer = {
      registerTool: vi.fn((name: string, _spec: unknown, handler: (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>) => {
        handlers.set(name, handler);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerLlmTools(fakeServer as any, TEST_CONFIG);
    const handler = handlers.get('call_model')!;

    const result = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user' as const, content: 'hi' }],
    });

    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(result.content[0].text) as any;
    // D-02: omitted (not null)
    expect('trace_id' in envelope.metadata).toBe(false);
    expect('trace_cumulative' in envelope.metadata).toBe(false);
  });

  it('U-31c: envelope.metadata.fallback_position is null when resolver === "model" (explicit null, not omitted)', async () => {
    const workingClient: LlmClient = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn().mockResolvedValue({ ...SAMPLE_RESULT, purposeName: 'general', fallbackPosition: 1 }),
      getModelForPurpose: vi.fn().mockReturnValue({ modelName: 'fast', providerName: 'openai', config: TEST_LLM_CONFIG.models[0] }),
    };
    _llmClientValue = workingClient;

    const handlers = new Map<string, (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    const fakeServer = {
      registerTool: vi.fn((name: string, _spec: unknown, handler: (params: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>) => {
        handlers.set(name, handler);
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerLlmTools(fakeServer as any, TEST_CONFIG);
    const handler = handlers.get('call_model')!;

    const result = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user' as const, content: 'hi' }],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(result.content[0].text) as any;
    expect('fallback_position' in envelope.metadata).toBe(true);
    expect(envelope.metadata.fallback_position).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: capture the call_model handler from registerLlmTools
// ─────────────────────────────────────────────────────────────────────────────
type HandlerFn = (params: unknown) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>;

function captureCallModelHandler(config: typeof TEST_CONFIG): HandlerFn {
  const handlers = new Map<string, HandlerFn>();
  const fakeServer = {
    registerTool: vi.fn((name: string, _spec: unknown, handler: HandlerFn) => {
      handlers.set(name, handler);
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerLlmTools(fakeServer as any, config);
  const handler = handlers.get('call_model');
  if (!handler) throw new Error('call_model handler not registered');
  return handler;
}

// ─── U-RR-INT: Handler-level Step 1.5 reference resolution tests ─────────────

describe('call_model handler — Step 1.5 reference resolution (U-RR-INT)', () => {
  it('[U-RR-INT-01] no patterns in messages → handler forwards unchanged, no injected_references / prompt_chars in metadata', async () => {
    // Arrange: parseReferences returns [] (already set in beforeEach default)
    vi.mocked(parseReferences).mockReturnValue([]);
    _llmClientValue = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);

    // Act
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user', content: 'no references here' }],
    });

    // Assert: success, no isError, no injection fields in metadata
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(res.content[0].text) as any;
    expect(envelope.metadata).not.toHaveProperty('injected_references');
    expect(envelope.metadata).not.toHaveProperty('prompt_chars');
    expect(hydrateMessages).not.toHaveBeenCalled();
    expect(buildInjectedReferences).not.toHaveBeenCalled();
    // The dispatch was made with the ORIGINAL messages (parsed.length === 0 path)
    expect((_llmClientValue as LlmClient & { complete: ReturnType<typeof vi.fn> }).complete).toHaveBeenCalledWith(
      'fast',
      [{ role: 'user', content: 'no references here' }],
      undefined,
      null
    );
  });

  it('[U-RR-INT-02b] caller-array-not-mutated invariant — handler does NOT mutate the caller-supplied messages array even when references ARE present (TC3-M2)', async () => {
    // TC3-M2: [U-RR-INT-01] verifies the no-op path forwards the caller's
    // messages array unchanged, but does NOT cover the hydrated path. This
    // test passes a frozen messages array containing a reference; the
    // handler must dispatch with a NEW (hydrated) array and leave the
    // original untouched. We freeze the array AND its message objects so
    // any in-place mutation (including .content reassignment) would throw.
    const parsedRef = { placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', identifierType: 'ref' as const, identifier: 'doc.md', messageIndex: 0 };
    const resolvedRef = { kind: 'resolved' as const, placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', content: 'BODY', chars: 4, messageIndex: 0 };
    vi.mocked(parseReferences).mockReturnValue([parsedRef]);
    vi.mocked(resolveReferences).mockResolvedValue([resolvedRef]);
    vi.mocked(hydrateMessages).mockReturnValue([{ role: 'user', content: 'BODY' }]);
    vi.mocked(buildInjectedReferences).mockReturnValue([{ ref: '{{ref:doc.md}}', chars: 4 }]);
    vi.mocked(computePromptChars).mockReturnValue(4);

    const completeMock = vi.fn().mockResolvedValue(SAMPLE_RESULT);
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);

    const originalMessage = Object.freeze({ role: 'user' as const, content: '{{ref:doc.md}}' });
    const originalArray = Object.freeze([originalMessage]);
    const captured = originalArray;

    // Act: the call must succeed without throwing on the frozen array.
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: originalArray,
    });

    expect(res.isError).toBeUndefined();
    // Caller-array invariants: same length, same identity, same message text.
    expect(captured).toBe(originalArray);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toBe(originalMessage);
    expect(captured[0].content).toBe('{{ref:doc.md}}');
    // The dispatched array must be the HYDRATED one, not the caller's.
    const dispatched = completeMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(dispatched).not.toBe(originalArray);
    expect(dispatched[0].content).toBe('BODY');
  });

  it('[U-RR-INT-02-invariant] prompt_chars and injected_references[].chars track the REAL sum-of-content-lengths invariant (TC3-W2 un-mocked helpers)', async () => {
    // TC3-W2: the handler-level [U-RR-INT-02] test mocks all four
    // reference-resolver helpers, so it cannot verify the actual REFS-05
    // invariant (prompt_chars >= sum(injected_references[i].chars)). Here
    // we import the REAL helpers via vi.importActual and exercise them on
    // realistic hydrated fixtures, locking down the invariant
    // independently of the handler wiring.
    const real = await vi.importActual<typeof import('../../src/llm/reference-resolver.js')>(
      '../../src/llm/reference-resolver.js'
    );

    const hydratedMessages = [
      { role: 'system', content: 'You are a helpful assistant.' }, // 29
      { role: 'user', content: 'BODY-A and also BODY-B-EXTRA after.' }, // 35
    ];
    const resolvedFixture = [
      {
        kind: 'resolved' as const,
        placeholder: '{{ref:a.md}}',
        ref: '{{ref:a.md}}',
        content: 'BODY-A',
        chars: 6,
        messageIndex: 1,
      },
      {
        kind: 'resolved' as const,
        placeholder: '{{ref:b.md}}',
        ref: '{{ref:b.md}}',
        content: 'BODY-B-EXTRA',
        chars: 12,
        messageIndex: 1,
      },
    ];

    const promptChars = real.computePromptChars(hydratedMessages);
    const injected = real.buildInjectedReferences(resolvedFixture);

    // Real invariant 1: prompt_chars equals the sum of message-content lengths.
    const expectedSum = hydratedMessages.reduce((acc, m) => acc + m.content.length, 0);
    expect(promptChars).toBe(expectedSum);

    // Real invariant 2: each injected_references[].chars is a non-negative integer
    // that equals the matching ResolvedRef.content.length, NOT a token count.
    expect(injected).toHaveLength(2);
    expect(injected[0]).toMatchObject({ ref: '{{ref:a.md}}', chars: 6 });
    expect(injected[1]).toMatchObject({ ref: '{{ref:b.md}}', chars: 12 });
    expect(injected[0].chars).toBe(resolvedFixture[0].content.length);
    expect(injected[1].chars).toBe(resolvedFixture[1].content.length);

    // Real invariant 3 (REFS-05): prompt_chars >= sum(injected[i].chars).
    const sumInjected = injected.reduce((acc, e) => acc + e.chars, 0);
    expect(promptChars).toBeGreaterThanOrEqual(sumInjected);
  });

  it('[U-RR-INT-02] references resolved → handler dispatches with hydrated messages, metadata includes injected_references and prompt_chars', async () => {
    // Arrange
    const parsedRef = { placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', identifierType: 'ref' as const, identifier: 'doc.md', messageIndex: 0 };
    const resolvedRef = { kind: 'resolved' as const, placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', content: 'BODY', chars: 4, messageIndex: 0 };
    vi.mocked(parseReferences).mockReturnValue([parsedRef]);
    vi.mocked(resolveReferences).mockResolvedValue([resolvedRef]);
    vi.mocked(hydrateMessages).mockReturnValue([{ role: 'user', content: 'BODY rest' }]);
    vi.mocked(buildInjectedReferences).mockReturnValue([{ ref: '{{ref:doc.md}}', chars: 4 }]);
    vi.mocked(computePromptChars).mockReturnValue(9);

    const completeMock = vi.fn().mockResolvedValue(SAMPLE_RESULT);
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);

    // Act
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user', content: '{{ref:doc.md}} rest' }],
    });

    // Assert: dispatch used hydrated messages, metadata has injection fields
    expect(res.isError).toBeUndefined();
    expect(completeMock).toHaveBeenCalledWith(
      'fast',
      [{ role: 'user', content: 'BODY rest' }],   // hydrated, NOT original
      undefined,
      null
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(res.content[0].text) as any;
    expect(envelope.metadata.injected_references).toEqual([{ ref: '{{ref:doc.md}}', chars: 4 }]);
    expect(envelope.metadata.prompt_chars).toBe(9);
  });

  it('[U-RR-INT-03] resolveReferences returns FailedRef → handler returns reference_resolution_failed, no LLM call made (REFS-06)', async () => {
    const parsedRef = { placeholder: '{{ref:missing.md}}', ref: '{{ref:missing.md}}', identifierType: 'ref' as const, identifier: 'missing.md', messageIndex: 0 };
    const failedRef = { kind: 'failed' as const, ref: '{{ref:missing.md}}', reason: 'Document not found: missing.md' };
    vi.mocked(parseReferences).mockReturnValue([parsedRef]);
    vi.mocked(resolveReferences).mockResolvedValue([failedRef]);

    const completeMock = vi.fn();
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user', content: '{{ref:missing.md}}' }],
    });

    expect(res.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(body.error).toBe('reference_resolution_failed');
    expect(body.failed_references).toEqual([{ ref: '{{ref:missing.md}}', reason: 'Document not found: missing.md' }]);
    // CRITICAL: client.complete must NOT have been called (REFS-06)
    expect(completeMock).not.toHaveBeenCalled();
    expect(hydrateMessages).not.toHaveBeenCalled();
  });

  it('[U-RR-INT-04] parseReferences returns ParseRefError → handler returns reference_resolution_failed, no LLM call made (REFS-02)', async () => {
    vi.mocked(parseReferences).mockReturnValue({
      error: 'invalid_reference_syntax',
      ref: '{{ref:doc.md#Sec->ptr}}',
      reason: 'invalid reference syntax: # and -> are mutually exclusive',
    });

    const completeMock = vi.fn();
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user', content: '{{ref:doc.md#Sec->ptr}}' }],
    });

    expect(res.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(body.error).toBe('reference_resolution_failed');
    expect(body.failed_references).toEqual([
      { ref: '{{ref:doc.md#Sec->ptr}}', reason: 'invalid reference syntax: # and -> are mutually exclusive' },
    ]);
    expect(completeMock).not.toHaveBeenCalled();
    // resolveReferences must NOT have been called either (parse error short-circuits)
    expect(resolveReferences).not.toHaveBeenCalled();
  });

  it('[U-RR-INT-05] resolver=purpose dispatches via completeByPurpose with hydrated messages', async () => {
    const parsedRef = { placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', identifierType: 'ref' as const, identifier: 'doc.md', messageIndex: 0 };
    const resolvedRef = { kind: 'resolved' as const, placeholder: '{{ref:doc.md}}', ref: '{{ref:doc.md}}', content: 'X', chars: 1, messageIndex: 0 };
    vi.mocked(parseReferences).mockReturnValue([parsedRef]);
    vi.mocked(resolveReferences).mockResolvedValue([resolvedRef]);
    vi.mocked(hydrateMessages).mockReturnValue([{ role: 'user', content: 'X' }]);
    vi.mocked(buildInjectedReferences).mockReturnValue([{ ref: '{{ref:doc.md}}', chars: 1 }]);
    vi.mocked(computePromptChars).mockReturnValue(1);

    const completeByPurposeMock = vi.fn().mockResolvedValue({
      text: 'ok', modelName: 'fast', providerName: 'openai',
      inputTokens: 1, outputTokens: 1, latencyMs: 50,
      fallbackPosition: 1,
    });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    await handler({
      resolver: 'purpose',
      name: 'general',
      messages: [{ role: 'user', content: '{{ref:doc.md}}' }],
    });

    expect(completeByPurposeMock).toHaveBeenCalledWith(
      'general',
      [{ role: 'user', content: 'X' }],   // hydrated
      undefined,
      null
    );
  });

  it('[U-RR-INT-06] resolveReferences returns 2+ FailedRef → handler aggregates ALL failures in failed_references[], no LLM call (Phase 3 Gap 1, REFS-06, OQ #7)', async () => {
    // Phase 3 Gap 1: handler-level companion to the [U-RR-19] resolver test
    // and the L-31a directed step. The fail-fast contract (REFS-06) requires
    // the handler to surface EVERY failed reference in a single response —
    // not just the first — so the AI consumer sees all problems at once
    // rather than fixing them one-at-a-time across retries. A handler that
    // returned only failed[0] (or coalesced into a single entry) would pass
    // [U-RR-INT-03] but silently break two-failure aggregation.
    const parsedRefs = [
      { placeholder: '{{ref:missing/a.md}}', ref: '{{ref:missing/a.md}}', identifierType: 'ref' as const, identifier: 'missing/a.md', messageIndex: 0 },
      { placeholder: '{{ref:b.md#Ghost}}', ref: '{{ref:b.md#Ghost}}', identifierType: 'ref' as const, identifier: 'b.md', section: 'Ghost', messageIndex: 0 },
    ];
    const failedRefs = [
      { kind: 'failed' as const, ref: '{{ref:missing/a.md}}', reason: 'Document not found: missing/a.md' },
      { kind: 'failed' as const, ref: '{{ref:b.md#Ghost}}', reason: "No heading matching 'Ghost' found in document" },
    ];
    vi.mocked(parseReferences).mockReturnValue(parsedRefs);
    vi.mocked(resolveReferences).mockResolvedValue(failedRefs);

    const completeMock = vi.fn();
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user', content: '{{ref:missing/a.md}} and {{ref:b.md#Ghost}}' }],
    });

    expect(res.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(body.error).toBe('reference_resolution_failed');
    // Both failures present, in input order (positional correspondence with parsedRefs)
    expect(body.failed_references).toEqual([
      { ref: '{{ref:missing/a.md}}', reason: 'Document not found: missing/a.md' },
      { ref: '{{ref:b.md#Ghost}}', reason: "No heading matching 'Ghost' found in document" },
    ]);
    // CRITICAL: client.complete must NOT have been called (REFS-06 fail-fast)
    expect(completeMock).not.toHaveBeenCalled();
    expect(hydrateMessages).not.toHaveBeenCalled();
  });
});

// ─── U-DISC-01..13: discovery resolvers + body guard ────────────────────────

const DISC_LLM_CONFIG = {
  providers: [
    { name: 'openai', type: 'openai-compatible' as const, endpoint: 'https://api.openai.com', apiKey: 'sk-test' },
    { name: 'local-ollama', type: 'ollama' as const, endpoint: 'http://localhost:11434' },
  ],
  models: [
    {
      name: 'fast',
      providerName: 'openai',
      model: 'gpt-4o-mini',
      type: 'language' as const,
      costPerMillion: { input: 0.15, output: 0.6 },
      description: 'Fast small model',
      contextWindow: 131072,
      capabilities: ['tools', 'vision'],
    },
    {
      name: 'bare',
      providerName: 'openai',
      model: 'gpt-4o',
      type: 'language' as const,
      costPerMillion: { input: 2.5, output: 10.0 },
      // description/contextWindow/capabilities all absent
    },
    {
      name: 'empty-caps',
      providerName: 'openai',
      model: 'gpt-3.5-turbo',
      type: 'language' as const,
      costPerMillion: { input: 0.5, output: 1.5 },
      capabilities: [],
    },
    {
      name: 'local',
      providerName: 'local-ollama',
      model: 'llama3.2:latest',
      type: 'language' as const,
      costPerMillion: { input: 0, output: 0 },
    },
  ],
  purposes: [
    {
      name: 'general',
      description: 'General-purpose chat',
      models: ['fast', 'bare'],
      defaults: { temperature: 0.7 },
    },
    {
      name: 'minimal',
      description: 'Minimal purpose with no defaults',
      models: ['bare'],
      // defaults absent
    },
  ],
};

const DISC_CONFIG = {
  instance: { id: 'test-instance-disc', name: 'Test', vault: { path: '/tmp/vault', markdownExtensions: ['.md'] } },
  llm: DISC_LLM_CONFIG,
} as unknown as import('../../src/config/loader.js').FlashQueryConfig;

function makeNonNullClient(): LlmClient {
  return {
    complete: vi.fn(),
    completeByPurpose: vi.fn(),
    getModelForPurpose: vi.fn(),
  } as unknown as LlmClient;
}

describe('call_model handler — discovery resolvers (U-DISC)', () => {
  beforeEach(() => {
    _llmClientValue = makeNonNullClient();
  });

  it('[U-DISC-01] resolver=list_models returns {models: [...]} with required fields per model', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models).toHaveLength(4);
    // Spec §8.3 contract fields ONLY. The implementation also emits `type` —
    // see Verification Deviation 8. We DO NOT assert `type` here so that if a
    // future fix removes it to align with spec, this contract test still passes.
    expect(body.models[0]).toMatchObject({
      name: 'fast',
      provider: 'openai',
      model_id: 'gpt-4o-mini',
      input_cost_per_million: 0.15,
      output_cost_per_million: 0.6,
    });
  });

  it('[U-DISC-NEW] list_models marks Ollama-backed models with local: true and OMITS the key for non-Ollama models (Verification Correction 3)', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const localEntry = body.models.find((m: any) => m.name === 'local');
    expect(localEntry).toBeDefined();
    expect(localEntry.local).toBe(true);
    // Non-Ollama-backed models MUST omit the `local` key (no null, no false default).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fast = body.models.find((m: any) => m.name === 'fast');
    expect(fast).toBeDefined();
    expect('local' in fast).toBe(false);
  });

  it('[U-DISC-02] list_models includes declared optional fields description/context_window/capabilities verbatim', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fast = body.models.find((m: any) => m.name === 'fast');
    expect(fast.description).toBe('Fast small model');
    expect(fast.context_window).toBe(131072);
    expect(fast.capabilities).toEqual(['tools', 'vision']);
  });

  it('[U-DISC-03] list_models OMITS optional fields when undeclared (the keys are absent, not present-with-undefined)', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bare = body.models.find((m: any) => m.name === 'bare');
    expect('description' in bare).toBe(false);
    expect('context_window' in bare).toBe(false);
    expect('capabilities' in bare).toBe(false);
  });

  it('[U-DISC-04] list_models PRESERVES capabilities: [] (declared empty array, not omitted)', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empty = body.models.find((m: any) => m.name === 'empty-caps');
    expect('capabilities' in empty).toBe(true);
    expect(empty.capabilities).toEqual([]);
  });

  it('[U-DISC-05] list_purposes returns {purposes: [...]} with cost rates from the primary model (models[0])', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_purposes' });
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(body.purposes).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const general = body.purposes.find((p: any) => p.name === 'general');
    expect(general).toMatchObject({
      name: 'general',
      description: 'General-purpose chat',
      models: ['fast', 'bare'],
      input_cost_per_million: 0.15,   // from primary model 'fast'
      output_cost_per_million: 0.6,   // from primary model 'fast'
    });
  });

  it('[U-DISC-05b] list_purposes cost rates come from the PRIMARY model (models[0]), not aggregated — swapping order changes the rates (TC4-W1)', async () => {
    // TC4-W1: [U-DISC-05] passes implicitly because the primary's cost
    // rates happen to be the lowest, so even an aggregator that picked
    // min/max could pass the same assertions. Here we run the same
    // resolver against a config whose `general` purpose lists models in
    // the opposite order — `bare` first, then `fast`. The primary-model
    // rule (§8.3) says the response must reflect `bare`'s cost rates
    // (2.5 / 10.0), not `fast`'s (0.15 / 0.6) and not an aggregate.
    const SWAPPED_LLM_CONFIG = {
      ...DISC_LLM_CONFIG,
      purposes: [
        // bare is now models[0] — primary
        { name: 'general', description: 'General-purpose chat', models: ['bare', 'fast'], defaults: { temperature: 0.7 } },
        { name: 'minimal', description: 'Minimal purpose with no defaults', models: ['bare'] },
      ],
    };
    const SWAPPED_CONFIG = {
      instance: { id: 'test-instance-disc-swap', name: 'Test', vault: { path: '/tmp/vault', markdownExtensions: ['.md'] } },
      llm: SWAPPED_LLM_CONFIG,
    } as unknown as import('../../src/config/loader.js').FlashQueryConfig;

    const handler = captureCallModelHandler(SWAPPED_CONFIG);
    const res = await handler({ resolver: 'list_purposes' });
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const general = body.purposes.find((p: any) => p.name === 'general');
    expect(general).toMatchObject({
      name: 'general',
      models: ['bare', 'fast'],
      input_cost_per_million: 2.5,   // from new primary model 'bare'
      output_cost_per_million: 10.0, // from new primary model 'bare'
    });
    // Negative assertion: must NOT be the original primary's rates.
    expect(general.input_cost_per_million).not.toBe(0.15);
    expect(general.output_cost_per_million).not.toBe(0.6);
  });

  it('[U-DISC-06] list_purposes includes defaults only when declared in config', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_purposes' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const general = body.purposes.find((p: any) => p.name === 'general');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const minimal = body.purposes.find((p: any) => p.name === 'minimal');
    expect(general.defaults).toEqual({ temperature: 0.7 });
    expect('defaults' in minimal).toBe(false);
  });

  it('[U-DISC-07] search with parameters.query case-insensitive matches model name (substring) — full per-entry shape locked down (TC4-W2)', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'search', parameters: { query: 'FAST' } });
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(body.query).toBe('FAST');
    expect(body.results).toHaveProperty('purposes');
    expect(body.results).toHaveProperty('models');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matched = body.results.models.find((m: any) => m.name === 'fast');
    expect(matched).toBeTruthy();
    // TC4-W2: the prior `.toBeTruthy()` only proved presence — it would
    // have passed even if the entry shape diverged from list_models.
    // §8.3 requires search.results.models[i] to carry the same fields
    // as list_models. Lock down the full shape for the matched entry.
    expect(matched).toMatchObject({
      name: 'fast',
      provider: 'openai',
      model_id: 'gpt-4o-mini',
      input_cost_per_million: 0.15,
      output_cost_per_million: 0.6,
      description: 'Fast small model',
      context_window: 131072,
      capabilities: ['tools', 'vision'],
    });
  });

  it('[U-DISC-08] search does NOT match against purpose.models[] (only name and description) — TC4-M1 rename', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    // 'fast' appears in model name 'fast' and description 'Fast small model',
    // but neither purpose name nor purpose description contains the substring 'fast',
    // so purposes result must be empty (purpose.models arrays are not searched).
    const res = await handler({ resolver: 'search', parameters: { query: 'fast' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(Array.isArray(body.results.purposes)).toBe(true);
    expect(body.results.purposes).toEqual([]);
    expect(Array.isArray(body.results.models)).toBe(true);
    expect(body.results.models.length).toBeGreaterThanOrEqual(1);
  });

  it('[U-DISC-09] search with no parameters.query returns isError with the documented message', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'search' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('search requires parameters.query (non-empty string)');
  });

  it('[U-DISC-10] search with parameters.query: "" (empty string) returns isError', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'search', parameters: { query: '' } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('search requires parameters.query (non-empty string)');
  });

  it('[U-DISC-11] resolver=model with missing name returns isError "name is required..."', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'model', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("name is required for resolver='model' or resolver='purpose'");
  });

  it('[U-DISC-12] resolver=purpose with missing messages returns isError "messages is required..."', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'purpose', name: 'general' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("messages is required (non-empty array) for resolver='model' or resolver='purpose'");
  });

  it('[U-DISC-13] resolver=list_models WITHOUT name and WITHOUT messages succeeds (DISC-04)', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(Array.isArray(body.models)).toBe(true);
  });

  it('[U-DISC-13b] resolver=list_models with NullLlmClient inherits the unconfigured guard (DISC-06)', async () => {
    _llmClientValue = new NullLlmClient();
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('LLM is not configured. Add an llm: section to flashquery.yml to use this tool.');
  });

  it('[U-DISC-13c] resolver=list_purposes with NullLlmClient inherits the unconfigured guard (TC4-W4 — §8.5 + OQ #15 uniformity)', async () => {
    // TC4-W4: §8.5 + OQ #15 require all five resolver values to share
    // the same NullLlmClient guard behaviour. Only list_models had a
    // unit test ([U-DISC-13b]); list_purposes was covered only at the
    // directed level. Lock it down here at the unit level.
    _llmClientValue = new NullLlmClient();
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_purposes' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('LLM is not configured. Add an llm: section to flashquery.yml to use this tool.');
  });

  it('[U-DISC-13d] resolver=search with NullLlmClient inherits the unconfigured guard (TC4-W4 — §8.5 + OQ #15 uniformity)', async () => {
    // TC4-W4 second variant: same uniformity rule for the search resolver.
    _llmClientValue = new NullLlmClient();
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'search', parameters: { query: 'fast' } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('LLM is not configured. Add an llm: section to flashquery.yml to use this tool.');
  });

  it('[U-DISC-13e] discovery resolvers IGNORE messages when provided — no LLM call is made (TC4-W3, OQ #6)', async () => {
    // TC4-W3: [U-DISC-13] only proves discovery succeeds when messages
    // are OMITTED — it doesn't exercise the "ignore-when-provided" half
    // of OQ #6. Here we pass a populated messages array AND name (which
    // would normally route to model dispatch) but with resolver=list_models;
    // the handler must answer the discovery query and never invoke the
    // LLM client's complete*/getModelForPurpose methods.
    const completeMock = vi.fn();
    const completeByPurposeMock = vi.fn();
    const getModelForPurposeMock = vi.fn();
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: getModelForPurposeMock,
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(DISC_CONFIG);

    for (const resolver of ['list_models', 'list_purposes'] as const) {
      const res = await handler({
        resolver,
        name: 'fast',
        messages: [{ role: 'user', content: 'should be ignored' }],
      });
      expect(res.isError).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = JSON.parse(res.content[0].text) as any;
      if (resolver === 'list_models') {
        expect(Array.isArray(body.models)).toBe(true);
      } else {
        expect(Array.isArray(body.purposes)).toBe(true);
      }
    }
    // search (which requires parameters.query) — same rule, but messages
    // must still be ignored alongside parameters.
    const searchRes = await handler({
      resolver: 'search',
      parameters: { query: 'fast' },
      name: 'fast',
      messages: [{ role: 'user', content: 'should be ignored' }],
    });
    expect(searchRes.isError).toBeUndefined();

    // CRITICAL: not a single LLM dispatch may have happened.
    expect(completeMock).not.toHaveBeenCalled();
    expect(completeByPurposeMock).not.toHaveBeenCalled();
    expect(getModelForPurposeMock).not.toHaveBeenCalled();
  });
});
