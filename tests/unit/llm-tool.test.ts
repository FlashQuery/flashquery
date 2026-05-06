import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { callModelMessageSchema, hasModelVisibleTools, registerLlmTools } from '../../src/mcp/tools/llm.js';
import { computeCost } from '../../src/llm/cost-tracker.js';
import { NullLlmClient, type LlmClient, type LlmCompletionResult } from '../../src/llm/client.js';
import { LlmFallbackError } from '../../src/llm/resolver.js';
import { LLM_PARTICIPANT_NAMES } from '../../src/constants/llm.js';
import { getNativeToolCatalog } from '../../src/mcp/tool-catalog.js';
import { executeAgentLoop } from '../../src/llm/agent-loop.js';
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

vi.mock('../../src/llm/agent-loop.js', () => ({
  executeAgentLoop: vi.fn(),
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
type CapturedServer = {
  registerTool: ReturnType<typeof vi.fn>;
};

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

function captureCallModelRegistration(config: typeof TEST_CONFIG): { spec: unknown; handler: HandlerFn; server: CapturedServer } {
  let capturedSpec: unknown;
  let capturedHandler: HandlerFn | undefined;
  const fakeServer = {
    registerTool: vi.fn((name: string, spec: unknown, handler: HandlerFn) => {
      if (name === 'call_model') {
        capturedSpec = spec;
        capturedHandler = handler;
      }
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerLlmTools(fakeServer as any, config);
  if (!capturedHandler) throw new Error('call_model handler not registered');
  return { spec: capturedSpec, handler: capturedHandler, server: fakeServer };
}

function seedNativeToolCatalog(server: CapturedServer): void {
  const catalog = getNativeToolCatalog(server as never);
  catalog.push(
    {
      name: 'get_document',
      description: 'Read one or more documents',
      inputSchema: {
        identifiers: z.union([z.string(), z.array(z.string())]).describe('Document identifier(s)'),
      },
    },
    {
      name: 'call_model',
      description: 'Call any configured LLM model',
      inputSchema: {
        resolver: z.string(),
      },
    }
  );
}

// ─── U-RR-INT: Handler-level Step 1.5 reference resolution tests ─────────────

describe('call_model handler — Step 1.5 reference resolution (U-RR-INT)', () => {
  it('[U-TMPL-07] call_model schema admits template_params and passes it to resolveReferences as the sixth argument', async () => {
    const parsedRef = {
      placeholder: '{{ref:Templates/greeting.md}}',
      ref: '{{ref:Templates/greeting.md}}',
      identifierType: 'ref' as const,
      identifier: 'Templates/greeting.md',
      messageIndex: 0,
    };
    const resolvedRef = {
      kind: 'resolved' as const,
      placeholder: '{{ref:Templates/greeting.md}}',
      ref: '{{ref:Templates/greeting.md}}',
      content: 'Hello Ada',
      chars: 9,
      messageIndex: 0,
    };
    const template_params = {
      'Templates/greeting.md': { name: 'Ada' },
    };
    vi.mocked(parseReferences).mockReturnValue([parsedRef]);
    vi.mocked(resolveReferences).mockResolvedValue([resolvedRef]);
    vi.mocked(hydrateMessages).mockReturnValue([{ role: 'user', content: 'Hello Ada' }]);
    vi.mocked(buildInjectedReferences).mockReturnValue([
      {
        ref: '{{ref:Templates/greeting.md}}',
        chars: 9,
        template_params_used: { name: { type: 'string', chars: 3 } },
      } as never,
    ]);
    vi.mocked(computePromptChars).mockReturnValue(9);

    _llmClientValue = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const { spec, handler } = captureCallModelRegistration(TEST_CONFIG);
    expect((spec as { inputSchema: Record<string, unknown> }).inputSchema).toHaveProperty('template_params');

    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user', content: '{{ref:Templates/greeting.md}}' }],
      template_params,
    });

    expect(res.isError).toBeUndefined();
    expect(resolveReferences).toHaveBeenCalledWith(
      [parsedRef],
      TEST_CONFIG,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      template_params
    );
  });

  it('[U-TMPL-08] discovery resolvers ignore template_params and reference-looking messages before parsing', async () => {
    const completeMock = vi.fn();
    const completeByPurposeMock = vi.fn();
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);

    for (const resolver of ['list_models', 'list_purposes'] as const) {
      const res = await handler({
        resolver,
        messages: [{ role: 'user', content: '{{ref:Templates/greeting.md}}' }],
        template_params: { 'Templates/greeting.md': { name: 'Ada' } },
      });
      expect(res.isError).toBeUndefined();
    }

    const search = await handler({
      resolver: 'search',
      parameters: { query: 'fast' },
      messages: [{ role: 'user', content: '{{ref:@background}}' }],
      template_params: { background: { _items: ['Research/a.md'], _separator: '\n\n' } },
    });

    expect(search.isError).toBeUndefined();
    expect(parseReferences).not.toHaveBeenCalled();
    expect(resolveReferences).not.toHaveBeenCalled();
    expect(hydrateMessages).not.toHaveBeenCalled();
    expect(buildInjectedReferences).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
    expect(completeByPurposeMock).not.toHaveBeenCalled();
  });

  it('[U-TMPL-11] template resolver failures return reference_resolution_failed and do not call the provider', async () => {
    const parsedRef = {
      placeholder: '{{ref:Templates/greeting.md}}',
      ref: '{{ref:Templates/greeting.md}}',
      identifierType: 'ref' as const,
      identifier: 'Templates/greeting.md',
      messageIndex: 0,
    };
    const failedRef = {
      kind: 'failed' as const,
      ref: '{{ref:Templates/greeting.md}}',
      reason: 'template_missing_required_param',
      detail: "Required template parameter 'name' is missing",
    };
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
      messages: [{ role: 'user', content: '{{ref:Templates/greeting.md}}' }],
      template_params: { 'Templates/greeting.md': {} },
    });

    expect(res.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    expect(body.error).toBe('reference_resolution_failed');
    expect(body.failed_references).toEqual([
      {
        ref: '{{ref:Templates/greeting.md}}',
        reason: 'template_missing_required_param',
        detail: "Required template parameter 'name' is missing",
      },
    ]);
    expect(completeMock).not.toHaveBeenCalled();
    expect(hydrateMessages).not.toHaveBeenCalled();
  });

  it('[U-RR-INT-00] discovery resolvers return before reference parsing', async () => {
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);

    const res = await handler({
      resolver: 'list_models',
      messages: [{ role: 'user', content: '{{ref:secret.md}}' }],
    });

    expect(res.isError).toBeUndefined();
    expect(parseReferences).not.toHaveBeenCalled();
  });

  it('[U-RR-INT-00b] only host-authored system/user string content is scanned for references', async () => {
    vi.mocked(parseReferences).mockReturnValue([]);
    _llmClientValue = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);

    await handler({
      resolver: 'model',
      name: 'fast',
      messages: [
        { role: 'system', content: 'system {{ref:system.md}}' },
        { role: 'user', content: 'user {{ref:user.md}}' },
        {
          role: 'assistant',
          content: 'assistant {{ref:assistant-secret.md}}',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'search_documents', arguments: { query: '{{ref:tool-call-secret.md}}' } },
            },
          ],
        },
        { role: 'tool', content: 'tool result {{ref:tool-secret.md}}', tool_call_id: 'call_1' },
      ],
    });

    expect(parseReferences).toHaveBeenCalledWith([
      { role: 'system', content: 'system {{ref:system.md}}' },
      { role: 'user', content: 'user {{ref:user.md}}' },
    ]);
  });

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
    const failedRef = { kind: 'failed' as const, ref: '{{ref:missing.md}}', reason: 'document_not_found', detail: 'Document not found: missing.md' };
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
    expect(body.failed_references).toEqual([{ ref: '{{ref:missing.md}}', reason: 'document_not_found', detail: 'Document not found: missing.md' }]);
    // CRITICAL: client.complete must NOT have been called (REFS-06)
    expect(completeMock).not.toHaveBeenCalled();
    expect(hydrateMessages).not.toHaveBeenCalled();
  });

  it('[U-RR-INT-04] parseReferences returns ParseRefError → handler returns reference_resolution_failed, no LLM call made (REFS-02)', async () => {
    vi.mocked(parseReferences).mockReturnValue({
      error: 'invalid_reference_syntax',
      ref: '{{ref:doc.md#Sec->ptr}}',
      reason: 'invalid reference syntax: # and -> are mutually exclusive',
      detail: 'The # and -> operators are mutually exclusive',
    } as never);

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
      {
        ref: '{{ref:doc.md#Sec->ptr}}',
        reason: 'invalid_reference_syntax',
        detail: 'The # and -> operators are mutually exclusive',
      },
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
      { kind: 'failed' as const, ref: '{{ref:missing/a.md}}', reason: 'document_not_found', detail: 'Document not found: missing/a.md' },
      { kind: 'failed' as const, ref: '{{ref:b.md#Ghost}}', reason: 'section_not_found', detail: "No heading matching 'Ghost' found in document" },
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
      { ref: '{{ref:missing/a.md}}', reason: 'document_not_found', detail: 'Document not found: missing/a.md' },
      { ref: '{{ref:b.md#Ghost}}', reason: 'section_not_found', detail: "No heading matching 'Ghost' found in document" },
    ]);
    // CRITICAL: client.complete must NOT have been called (REFS-06 fail-fast)
    expect(completeMock).not.toHaveBeenCalled();
    expect(hydrateMessages).not.toHaveBeenCalled();
  });
});

describe('call_model handler — Phase 112 return_messages envelope', () => {
  it('callModelMessageSchema rejects role=tool messages with name at the schema layer', () => {
    const parsed = callModelMessageSchema.safeParse({
      role: 'tool',
      name: 'search_documents',
      content: '{"ok":true}',
      tool_call_id: 'call_1',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects role=tool messages that carry provider-wire name attribution', async () => {
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
      messages: [
        { role: 'tool', name: 'search_documents', content: '{"ok":true}', tool_call_id: 'call_1' },
      ],
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('role=tool messages cannot include name');
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('default model envelope includes messages: [] and accepts nullable round-trip message fields', async () => {
    const completeMock = vi.fn().mockResolvedValue(SAMPLE_RESULT);
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      messages: [
        {
          role: 'assistant',
          content: null,
          name: 'general',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'search_documents', arguments: { query: 'alpha' } },
            },
          ],
        },
        { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_1' },
        { role: 'user', content: 'continue' },
      ],
    });

    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(res.content[0].text) as any;
    expect(envelope.response).toBe('hello world');
    expect(envelope.messages).toEqual([]);
    expect(completeMock).toHaveBeenCalledWith(
      'fast',
      expect.arrayContaining([
        expect.objectContaining({
          content: null,
          tool_calls: [expect.objectContaining({ id: 'call_1' })],
        }),
      ]),
      undefined,
      null
    );
  });

  it('return_messages: true returns hydrated input messages plus final assistant message', async () => {
    const parsedRef = {
      placeholder: '{{ref:doc.md}}',
      ref: '{{ref:doc.md}}',
      identifierType: 'ref' as const,
      identifier: 'doc.md',
      messageIndex: 0,
    };
    const resolvedRef = {
      kind: 'resolved' as const,
      placeholder: '{{ref:doc.md}}',
      ref: '{{ref:doc.md}}',
      content: 'ATL-RETURN-MESSAGES-MARKER-112',
      chars: 30,
      messageIndex: 0,
    };
    vi.mocked(parseReferences).mockReturnValue([parsedRef]);
    vi.mocked(resolveReferences).mockResolvedValue([resolvedRef]);
    vi.mocked(hydrateMessages).mockReturnValue([
      { role: 'user', content: 'Read ATL-RETURN-MESSAGES-MARKER-112 and reply.' },
    ]);
    vi.mocked(buildInjectedReferences).mockReturnValue([{ ref: '{{ref:doc.md}}', chars: 30 }]);
    vi.mocked(computePromptChars).mockReturnValue(54);

    _llmClientValue = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      return_messages: true,
      messages: [{ role: 'user', content: 'Read {{ref:doc.md}} and reply.' }],
    });

    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(res.content[0].text) as any;
    expect(envelope.response).toBe('hello world');
    expect(envelope.messages).toHaveLength(2);
    expect(envelope.messages[0].content).toContain('ATL-RETURN-MESSAGES-MARKER-112');
    expect(envelope.messages[0].content).not.toContain('{{ref:');
    expect(envelope.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'hello world',
      name: 'fast',
    });
  });

  it('return_messages: true applies host attribution by default and preserves caller-supplied participant names', async () => {
    _llmClientValue = {
      complete: vi.fn().mockResolvedValue(SAMPLE_RESULT),
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    const res = await handler({
      resolver: 'model',
      name: 'fast',
      return_messages: true,
      messages: [
        { role: 'system', content: 'system instruction' },
        { role: 'user', name: 'caller-1', content: 'hello' },
      ],
    });

    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(res.content[0].text) as any;
    expect(envelope.messages[0]).toMatchObject({
      role: 'system',
      name: LLM_PARTICIPANT_NAMES.host,
    });
    expect(envelope.messages[1]).toMatchObject({
      role: 'user',
      name: 'caller-1',
    });
    expect(envelope.messages[2]).toMatchObject({
      role: 'assistant',
      name: 'fast',
    });
  });

  it('return_messages: true tags final assistant messages with the purpose name on purpose calls', async () => {
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn().mockResolvedValue({ ...SAMPLE_RESULT, purposeName: 'general', fallbackPosition: 1 }),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);
    const res = await handler({
      resolver: 'purpose',
      name: 'general',
      return_messages: true,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(res.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(res.content[0].text) as any;
    expect(envelope.messages.at(-1)).toMatchObject({
      role: 'assistant',
      name: 'general',
    });
  });

  it('discovery resolvers ignore return_messages and keep raw shapes', async () => {
    const completeMock = vi.fn();
    const completeByPurposeMock = vi.fn();
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(TEST_CONFIG);

    const models = JSON.parse((await handler({ resolver: 'list_models', return_messages: true })).content[0].text) as Record<string, unknown>;
    const purposes = JSON.parse((await handler({ resolver: 'list_purposes', return_messages: true })).content[0].text) as Record<string, unknown>;
    const search = JSON.parse((await handler({
      resolver: 'search',
      parameters: { query: 'general' },
      return_messages: true,
    })).content[0].text) as Record<string, unknown>;

    expect(models.models).toBeDefined();
    expect(models.messages).toBeUndefined();
    expect(purposes.purposes).toBeDefined();
    expect(purposes.messages).toBeUndefined();
    expect(search.query).toBe('general');
    expect(search.results).toBeDefined();
    expect(search.messages).toBeUndefined();
    expect(completeMock).not.toHaveBeenCalled();
    expect(completeByPurposeMock).not.toHaveBeenCalled();
  });
});

describe('call_model handler — Phase 116 native tool registry wiring', () => {
  const TOOL_PURPOSE_CONFIG = {
    instance: { id: 'test-instance-tools', name: 'Test', vault: { path: '/tmp/vault', markdownExtensions: ['.md'] } },
    llm: {
      providers: TEST_LLM_CONFIG.providers,
      models: [
        {
          ...TEST_LLM_CONFIG.models[0],
          capabilities: {
            tool_calling: true,
            usage_on_tool_calls: true,
            strict_tools: true,
            structured_outputs_with_tools: true,
          },
        },
      ],
      purposes: [
        {
          name: 'documented',
          description: 'Documented purpose',
          models: ['fast'],
          tools: ['get_document'],
        },
        {
          name: 'unsafe',
          description: 'Unsafe purpose',
          models: ['fast'],
          tools: ['call_model'],
        },
        {
          name: 'excluded',
          description: 'Excluded purpose',
          models: ['fast'],
          tools: ['get_document'],
          excludedTools: ['get_document'],
        },
      ],
    },
  } as unknown as import('../../src/config/loader.js').FlashQueryConfig;

  it('[TOOL-04] purpose calls with tools: [get_document] pass one provider function tool and expose metadata.tools.native_tool_names', async () => {
    vi.mocked(executeAgentLoop).mockResolvedValue({
      response: SAMPLE_RESULT.text,
      messages: [],
      metadata: {
        resolver: 'purpose',
        name: 'documented',
        resolved_model_name: SAMPLE_RESULT.modelName,
        provider_name: SAMPLE_RESULT.providerName,
        fallback_position: 1,
        tokens: { input: SAMPLE_RESULT.inputTokens, output: SAMPLE_RESULT.outputTokens },
        cost_usd: 0,
        latency_ms: SAMPLE_RESULT.latencyMs,
        tools: {
          native_tool_names: ['get_document'],
          diagnostics: { explicit_tools: ['get_document'] },
          stop_reason: 'final_response',
          iterations: 1,
          calls_log: [],
          aggregate_usage: { tokens: { input: SAMPLE_RESULT.inputTokens, output: SAMPLE_RESULT.outputTokens }, cost_usd: 0, latency_ms: SAMPLE_RESULT.latencyMs },
        },
      },
    });
    const chatByPurposeMock = vi.fn();
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      chatByPurpose: chatByPurposeMock,
      chatByPurposeUnrecorded: vi.fn(),
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'documented',
      messages: [{ role: 'user', content: 'Read the document.' }],
    });

    expect(result.isError).toBeUndefined();
    expect(chatByPurposeMock).not.toHaveBeenCalled();
    expect(executeAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
      providerParameters: expect.objectContaining({
        tools: [expect.objectContaining({ function: expect.objectContaining({ name: 'get_document' }) })],
      }),
      toolRegistry: expect.objectContaining({ nativeToolNames: ['get_document'] }),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(result.content[0].text) as any;
    expect(envelope.metadata.tools.native_tool_names).toEqual(['get_document']);
    expect(envelope.metadata.tools.diagnostics.explicit_tools).toEqual(['get_document']);
  });

  it('[TOOL-04] purpose native tools execute the loop instead of returning assistant tool_calls as the durable response', async () => {
    vi.mocked(executeAgentLoop).mockResolvedValue({
      response: 'final after native dispatch',
      messages: [],
      metadata: {
        resolver: 'purpose',
        name: 'documented',
        resolved_model_name: SAMPLE_RESULT.modelName,
        provider_name: SAMPLE_RESULT.providerName,
        fallback_position: 1,
        tokens: { input: SAMPLE_RESULT.inputTokens, output: SAMPLE_RESULT.outputTokens },
        cost_usd: 0,
        latency_ms: SAMPLE_RESULT.latencyMs,
        tools: {
          native_tool_names: ['get_document'],
          diagnostics: {},
          stop_reason: 'final_response',
          iterations: 2,
          calls_log: [],
          aggregate_usage: { tokens: { input: SAMPLE_RESULT.inputTokens, output: SAMPLE_RESULT.outputTokens }, cost_usd: 0, latency_ms: SAMPLE_RESULT.latencyMs },
        },
      },
    });
    const chatByPurposeMock = vi.fn();
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      chatByPurpose: chatByPurposeMock,
      chatByPurposeUnrecorded: vi.fn(),
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'documented',
      messages: [{ role: 'user', content: 'Read the document.' }],
    });

    expect(result.isError).toBeUndefined();
    expect(chatByPurposeMock).not.toHaveBeenCalled();
    const envelope = JSON.parse(result.content[0].text) as { response: string; messages: unknown[] };
    expect(envelope.response).toBe('final after native dispatch');
    expect(envelope.messages).toEqual([]);
  });

  it('[TOOL-04] purpose native tools reject caller-supplied provider tools while Mode 3 is deferred', async () => {
    const callerTool = {
      type: 'function',
      function: {
        name: 'caller_tool',
        description: 'Caller-provided provider tool',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    };
    const chatByPurposeMock = vi.fn();
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      chatByPurpose: chatByPurposeMock,
      chatByPurposeUnrecorded: vi.fn(),
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'documented',
      messages: [{ role: 'user', content: 'Read the document.' }],
      parameters: { tools: [callerTool] },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Mode 3 caller-provided tools are deferred');
    expect(chatByPurposeMock).not.toHaveBeenCalled();
  });

  it('[TOOL-03] purpose calls with tools: [call_model] omit provider tools and expose hard_excluded diagnostics', async () => {
    const completeByPurposeMock = vi.fn().mockResolvedValue({
      ...SAMPLE_RESULT,
      purposeName: 'unsafe',
      fallbackPosition: 1,
    });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'unsafe',
      messages: [{ role: 'user', content: 'Try a nested call.' }],
    });

    expect(result.isError).toBeUndefined();
    expect(completeByPurposeMock.mock.calls[0][2]).not.toHaveProperty('tools');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const envelope = JSON.parse(result.content[0].text) as any;
    expect(envelope.metadata.tools.native_tool_names).toEqual([]);
    expect(envelope.metadata.tools.diagnostics.hard_excluded).toEqual([
      expect.objectContaining({ tool: 'call_model' }),
    ]);
  });

  it('[TOOL-02] purpose calls with excludedTools removing the final tool do not pass tools: []', async () => {
    const completeByPurposeMock = vi.fn().mockResolvedValue({
      ...SAMPLE_RESULT,
      purposeName: 'excluded',
      fallbackPosition: 1,
    });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    await handler({
      resolver: 'purpose',
      name: 'excluded',
      messages: [{ role: 'user', content: 'No tools remain.' }],
    });

    expect(completeByPurposeMock.mock.calls[0][2]).not.toHaveProperty('tools');
  });

  it('[T-116-13] direct model calls preserve explicit caller provider parameters only', async () => {
    const completeMock = vi.fn().mockResolvedValue(SAMPLE_RESULT);
    _llmClientValue = {
      complete: completeMock,
      completeByPurpose: vi.fn(),
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    await handler({
      resolver: 'model',
      name: 'fast',
      messages: [{ role: 'user', content: 'Direct call.' }],
      parameters: { temperature: 0.2 },
    });

    expect(completeMock).toHaveBeenCalledWith(
      'fast',
      [{ role: 'user', content: 'Direct call.' }],
      { temperature: 0.2 },
      null
    );
  });

  it('[LOOP-01] routes purpose calls with native tools through executeAgentLoop and non-recording purpose chat', async () => {
    vi.mocked(executeAgentLoop).mockResolvedValue({
      response: 'final loop answer',
      messages: [],
      metadata: {
        resolver: 'purpose',
        name: 'documented',
        resolved_model_name: 'fast',
        provider_name: 'openai',
        fallback_position: 1,
        tokens: { input: 12, output: 8 },
        cost_usd: 0.0000066,
        latency_ms: 90,
        tools: {
          native_tool_names: ['get_document'],
          diagnostics: { explicit_tools: ['get_document'] },
          stop_reason: 'final_response',
          iterations: 1,
          calls_log: [],
          aggregate_usage: { tokens: { input: 12, output: 8 }, cost_usd: 0.0000066, latency_ms: 90 },
        },
      },
    });
    const chatByPurposeMock = vi.fn();
    const chatByPurposeUnrecordedMock = vi.fn();
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      chatByPurpose: chatByPurposeMock,
      chatByPurposeUnrecorded: chatByPurposeUnrecordedMock,
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'documented',
      messages: [{ role: 'user', content: 'Read the document.' }],
      trace_id: 'trace-loop-1',
    });

    expect(result.isError).toBeUndefined();
    expect(chatByPurposeMock).not.toHaveBeenCalled();
    expect(executeAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
      purposeName: 'documented',
      initialMessages: [{ role: 'user', content: 'Read the document.' }],
      providerParameters: expect.objectContaining({
        tools: [expect.objectContaining({ function: expect.objectContaining({ name: 'get_document' }) })],
      }),
      nativeToolCatalog: expect.any(Array),
      toolRegistry: expect.objectContaining({
        nativeToolNames: ['get_document'],
        providerTools: [expect.objectContaining({ function: expect.objectContaining({ name: 'get_document' }) })],
      }),
      instanceId: 'test-instance-tools',
      traceId: 'trace-loop-1',
      chatByPurpose: expect.any(Function),
      modelCostLookup: expect.any(Function),
      initialModelName: 'fast',
    }));
    await vi.mocked(executeAgentLoop).mock.calls.at(-1)?.[0].chatByPurpose('documented', [], {
      signal: new AbortController().signal,
    });
    expect(chatByPurposeUnrecordedMock).toHaveBeenCalledWith('documented', [], {
      signal: expect.any(AbortSignal),
    });
    const envelope = JSON.parse(result.content[0].text) as { response: string; messages: unknown[]; metadata: { tools: { stop_reason: string } } };
    expect(envelope.response).toBe('final loop answer');
    expect(envelope.messages).toEqual([]);
    expect(envelope.metadata.tools.stop_reason).toBe('final_response');
  });

  it('[LOOP-01] rejects caller-provided tools while Mode 3 cooperative dispatch is deferred', async () => {
    const callerTool = {
      type: 'function',
      function: {
        name: 'caller_tool',
        description: 'Caller-provided provider tool',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    };
    const chatByPurposeMock = vi.fn();
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      chatByPurpose: chatByPurposeMock,
      chatByPurposeUnrecorded: vi.fn(),
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'documented',
      messages: [{ role: 'user', content: 'Read the document.' }],
      parameters: { tools: [callerTool] },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Mode 3 caller-provided tools are deferred');
    expect(chatByPurposeMock).not.toHaveBeenCalled();
    expect(executeAgentLoop).not.toHaveBeenCalled();
  });

  it('[LOOP-01] hasModelVisibleTools selects Mode 2 from the final registry, not native-tool count only', () => {
    const templateTool = {
      type: 'function' as const,
      function: {
        name: 'flashquery.template.brief',
        description: 'Template masquerade',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    };
    const diagnostics = { expandedTiers: [], explicitTools: [], excluded: [], hardExcluded: [], unknown: [] };

    expect(hasModelVisibleTools({
      nativeToolNames: ['get_document'],
      providerTools: [{ ...templateTool, function: { ...templateTool.function, name: 'get_document' } }],
      diagnostics,
    })).toBe(true);
    expect(hasModelVisibleTools({ nativeToolNames: [], providerTools: [templateTool], diagnostics })).toBe(true);
    expect(hasModelVisibleTools({
      nativeToolNames: ['get_document'],
      providerTools: [
        { ...templateTool, function: { ...templateTool.function, name: 'get_document' } },
        templateTool,
      ],
      diagnostics,
    })).toBe(true);
    expect(hasModelVisibleTools({ nativeToolNames: [], providerTools: [templateTool], diagnostics })).toBe(true);
    expect(hasModelVisibleTools({ nativeToolNames: [], providerTools: [], diagnostics })).toBe(false);
    expect(hasModelVisibleTools({ nativeToolNames: [], diagnostics })).toBe(false);
  });

  it('[LOOP-07] Mode 2 default envelope maps loop metadata and keeps messages empty', async () => {
    selectEqEqMock.mockResolvedValue({
      data: [{ input_tokens: 5, output_tokens: 7, cost_usd: 0.0001, latency_ms: 10 }],
      error: null,
    });
    vi.mocked(executeAgentLoop).mockResolvedValue({
      response: 'final loop answer',
      messages: [
        { role: 'user', content: 'Read the document.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_doc', type: 'function', function: { name: 'get_document', arguments: { identifiers: 'Doc.md' } } }],
        },
        { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_doc' },
        { role: 'assistant', content: 'final loop answer' },
      ],
      metadata: {
        resolver: 'purpose',
        name: 'documented',
        resolved_model_name: 'fast',
        provider_name: 'openai',
        fallback_position: 1,
        tokens: { input: 12, output: 8 },
        cost_usd: 0.0000066,
        latency_ms: 90,
        tools: {
          native_tool_names: ['get_document'],
          diagnostics: { explicitTools: ['get_document'] },
          stop_reason: 'final_response',
          iterations: 2,
          calls_log: [{
            iteration: 1,
            model_name: 'fast',
            provider_name: 'openai',
            fallback_position: 1,
            finish_reason: 'tool_calls',
            tokens: { input: 12, output: 8 },
            cost_usd: 0.0000066,
            latency_ms: 90,
            assistant: { content: null },
            tool_calls: [{ tool_call_id: 'call_doc', tool_name: 'get_document', status: 'success' }],
          }],
          aggregate_usage: { tokens: { input: 12, output: 8 }, cost_usd: 0.0000066, latency_ms: 90 },
        },
      },
    });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      chatByPurpose: vi.fn(),
      chatByPurposeUnrecorded: vi.fn(),
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'documented',
      messages: [{ role: 'user', content: 'Read the document.' }],
      trace_id: 'trace-loop-2',
    });

    expect(result.isError).toBeUndefined();
    const envelope = JSON.parse(result.content[0].text) as {
      messages: unknown[];
      metadata: {
        trace_cumulative: { total_calls: number; total_tokens: { input: number; output: number }; total_cost_usd: number; total_latency_ms: number };
        tools: Record<string, unknown>;
      };
    };
    expect(envelope.messages).toEqual([]);
    expect(envelope.metadata.trace_cumulative).toEqual({
      total_calls: 2,
      total_tokens: { input: 17, output: 15 },
      total_cost_usd: 0.0001066,
      total_latency_ms: 100,
    });
    expect(envelope.metadata.tools).toMatchObject({
      native_tool_names: ['get_document'],
      diagnostics: { explicit_tools: ['get_document'] },
      stop_reason: 'final_response',
      iterations: 2,
      calls_log: expect.any(Array),
      aggregate_usage: { tokens: { input: 12, output: 8 }, cost_usd: 0.0000066, latency_ms: 90 },
    });
    for (const key of ['stop_reason', 'iterations', 'calls_log', 'aggregate_usage', 'diagnostics', 'native_tool_names']) {
      expect(envelope.metadata.tools).toHaveProperty(key);
    }
  });

  it('[LOOP-07] Mode 2 return_messages true prepends hydrated host messages and removes tool message names', async () => {
    vi.mocked(executeAgentLoop).mockResolvedValue({
      response: 'final loop answer',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_doc', type: 'function', function: { name: 'get_document', arguments: { identifiers: 'Doc.md' } } }],
        },
        { role: 'tool', name: 'get_document' as never, content: '{"ok":true}', tool_call_id: 'call_doc' },
        { role: 'assistant', content: 'final loop answer' },
      ],
      metadata: {
        resolver: 'purpose',
        name: 'documented',
        resolved_model_name: 'fast',
        provider_name: 'openai',
        fallback_position: 1,
        tokens: { input: 12, output: 8 },
        cost_usd: 0.0000066,
        latency_ms: 90,
        tools: {
          native_tool_names: ['get_document'],
          diagnostics: {},
          stop_reason: 'final_response',
          iterations: 2,
          calls_log: [],
          aggregate_usage: { tokens: { input: 12, output: 8 }, cost_usd: 0.0000066, latency_ms: 90 },
        },
      },
    });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: vi.fn(),
      chatByPurpose: vi.fn(),
      chatByPurposeUnrecorded: vi.fn(),
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: TOOL_PURPOSE_CONFIG.llm?.models[0],
      }),
    } as unknown as LlmClient;

    const { handler, server } = captureCallModelRegistration(TOOL_PURPOSE_CONFIG as typeof TEST_CONFIG);
    seedNativeToolCatalog(server);

    const result = await handler({
      resolver: 'purpose',
      name: 'documented',
      return_messages: true,
      messages: [{ role: 'user', content: 'Read the document.' }],
    });

    expect(result.isError).toBeUndefined();
    const envelope = JSON.parse(result.content[0].text) as { messages: Array<Record<string, unknown>> };
    expect(envelope.messages[0]).toMatchObject({ role: 'user', name: LLM_PARTICIPANT_NAMES.host, content: 'Read the document.' });
    expect(envelope.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_doc' }),
      expect.objectContaining({ role: 'assistant', content: 'final loop answer' }),
    ]));
    const toolMessage = envelope.messages.find((message) => message.role === 'tool');
    expect(toolMessage).not.toHaveProperty('name');
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
      tags: ['vision'],
      capabilities: {
        tool_calling: true,
        usage_on_tool_calls: true,
        strict_tools: true,
        parallel_tool_calls: true,
        structured_outputs_with_tools: true,
      },
    },
    {
      name: 'bare',
      providerName: 'openai',
      model: 'gpt-4o',
      type: 'language' as const,
      costPerMillion: { input: 2.5, output: 10.0 },
      // description/contextWindow/tags/capabilities all absent
    },
    {
      name: 'empty-caps',
      providerName: 'openai',
      model: 'gpt-3.5-turbo',
      type: 'language' as const,
      costPerMillion: { input: 0.5, output: 1.5 },
      tags: [],
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

  it('[U-DISC-02] list_models includes declared optional fields description/context_window/tags/capabilities verbatim', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fast = body.models.find((m: any) => m.name === 'fast');
    expect(fast.description).toBe('Fast small model');
    expect(fast.context_window).toBe(131072);
    expect(fast.tags).toEqual(['vision']);
    expect(fast.capabilities).toEqual({
      tool_calling: true,
      usage_on_tool_calls: true,
      strict_tools: true,
      parallel_tool_calls: true,
      structured_outputs_with_tools: true,
    });
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
    expect('tags' in bare).toBe(false);
    expect('capabilities' in bare).toBe(false);
  });

  it('[U-DISC-04] list_models PRESERVES tags: [] (declared empty array, not omitted)', async () => {
    const handler = captureCallModelHandler(DISC_CONFIG);
    const res = await handler({ resolver: 'list_models' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse(res.content[0].text) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empty = body.models.find((m: any) => m.name === 'empty-caps');
    expect('tags' in empty).toBe(true);
    expect(empty.tags).toEqual([]);
    expect('capabilities' in empty).toBe(false);
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
      tags: ['vision'],
      capabilities: {
        tool_calling: true,
        usage_on_tool_calls: true,
        strict_tools: true,
        parallel_tool_calls: true,
        structured_outputs_with_tools: true,
      },
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

describe('call_model handler — CAP-05 response_format with tools guard', () => {
  it('[CAP-05] returns isError before provider dispatch when structured_outputs_with_tools is declared unsupported', async () => {
    const guardedConfig = {
      ...TEST_CONFIG,
      llm: {
        providers: TEST_LLM_CONFIG.providers,
        models: [
          {
            ...TEST_LLM_CONFIG.models[0],
            capabilities: {
              tool_calling: true,
              usage_on_tool_calls: true,
              structured_outputs_with_tools: false,
            },
          },
        ],
        purposes: [
          {
            name: 'agentic',
            description: 'Tool purpose',
            models: ['fast'],
            tools: ['read'],
            defaults: { response_format: { type: 'json_object' } },
          },
        ],
      },
    } as unknown as import('../../src/config/loader.js').FlashQueryConfig;

    const completeByPurposeMock = vi.fn().mockResolvedValue({ ...SAMPLE_RESULT, purposeName: 'agentic', fallbackPosition: 1 });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'fast',
        providerName: 'openai',
        config: guardedConfig.llm!.models[0],
      }),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(guardedConfig as typeof TEST_CONFIG);
    const result = await handler({
      resolver: 'purpose',
      name: 'agentic',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('response_format');
    expect(result.content[0].text).toContain('structured_outputs_with_tools');
    expect(result.content[0].text).toContain('declared unsupported');
    expect(completeByPurposeMock).not.toHaveBeenCalled();
  });

  it('[CR-03] rejects response_format when any fallback model cannot combine structured outputs with tools', async () => {
    const guardedConfig = {
      ...TEST_CONFIG,
      llm: {
        providers: TEST_LLM_CONFIG.providers,
        models: [
          {
            ...TEST_LLM_CONFIG.models[0],
            name: 'primary',
            capabilities: {
              tool_calling: true,
              usage_on_tool_calls: true,
              structured_outputs_with_tools: true,
            },
          },
          {
            ...TEST_LLM_CONFIG.models[0],
            name: 'fallback',
            capabilities: {
              tool_calling: true,
              usage_on_tool_calls: true,
              structured_outputs_with_tools: false,
            },
          },
        ],
        purposes: [
          {
            name: 'agentic',
            description: 'Tool purpose',
            models: ['primary', 'fallback'],
            tools: ['read'],
            defaults: { response_format: { type: 'json_object' } },
          },
        ],
      },
    } as unknown as import('../../src/config/loader.js').FlashQueryConfig;

    const completeByPurposeMock = vi.fn().mockResolvedValue({ ...SAMPLE_RESULT, purposeName: 'agentic', fallbackPosition: 1 });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn().mockReturnValue({
        modelName: 'primary',
        providerName: 'openai',
        config: guardedConfig.llm!.models[0],
      }),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(guardedConfig as typeof TEST_CONFIG);
    const result = await handler({
      resolver: 'purpose',
      name: 'agentic',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('fallback');
    expect(result.content[0].text).toContain('structured_outputs_with_tools');
    expect(completeByPurposeMock).not.toHaveBeenCalled();
  });

  it('[CR-03] rejects response_format fallback bypass when caller uses mixed-case purpose name', async () => {
    const guardedConfig = {
      ...TEST_CONFIG,
      llm: {
        providers: TEST_LLM_CONFIG.providers,
        models: [
          {
            ...TEST_LLM_CONFIG.models[0],
            name: 'primary',
            capabilities: {
              tool_calling: true,
              usage_on_tool_calls: true,
              structured_outputs_with_tools: true,
            },
          },
          {
            ...TEST_LLM_CONFIG.models[0],
            name: 'fallback',
            capabilities: {
              tool_calling: true,
              usage_on_tool_calls: true,
              structured_outputs_with_tools: false,
            },
          },
        ],
        purposes: [
          {
            name: 'agentic',
            description: 'Tool purpose',
            models: ['primary', 'fallback'],
            tools: ['read'],
            defaults: { response_format: { type: 'json_object' } },
          },
        ],
      },
    } as unknown as import('../../src/config/loader.js').FlashQueryConfig;

    const completeByPurposeMock = vi.fn().mockResolvedValue({ ...SAMPLE_RESULT, purposeName: 'agentic', fallbackPosition: 1 });
    _llmClientValue = {
      complete: vi.fn(),
      completeByPurpose: completeByPurposeMock,
      getModelForPurpose: vi.fn(),
    } as unknown as LlmClient;

    const handler = captureCallModelHandler(guardedConfig as typeof TEST_CONFIG);
    const result = await handler({
      resolver: 'purpose',
      name: 'Agentic',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('fallback');
    expect(result.content[0].text).toContain('structured_outputs_with_tools');
    expect(completeByPurposeMock).not.toHaveBeenCalled();
  });
});
