import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerLlmTools } from '../../src/mcp/tools/llm.js';
import { computeCost } from '../../src/llm/cost-tracker.js';
import { NullLlmClient, type LlmClient, type LlmCompletionResult } from '../../src/llm/client.js';
import { LlmFallbackError } from '../../src/llm/resolver.js';

// Logger mock — same pattern as tests/unit/llm-resolver.test.ts
vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// getIsShuttingDown mock — handler reads this first
vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

// supabaseManager mock — chainable .from().insert() and .from().select().eq().eq()
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
