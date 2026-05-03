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
});

// ─── U-DISC-01..13: discovery resolvers + body guard ────────────────────────

const DISC_LLM_CONFIG = {
  providers: [
    { name: 'openai', type: 'openai-compatible' as const, endpoint: 'https://api.openai.com', apiKey: 'sk-test' },
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
    expect(body.models).toHaveLength(3);
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

  it('[U-DISC-07] search with parameters.query case-insensitive matches model name (substring)', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'search', parameters: { query: 'FAST' } });
    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(body.query).toBe('FAST');
    expect(body.results).toHaveProperty('purposes');
    expect(body.results).toHaveProperty('models');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(body.results.models.find((m: any) => m.name === 'fast')).toBeTruthy();
  });

  it('[U-DISC-08] search with no purpose match returns purposes: [] (empty array, not omitted)', async () => {
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
});
