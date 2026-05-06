import { describe, expect, it, vi } from 'vitest';
import type { LlmChatMessage, LlmChatResult, LlmChatToolCall } from '../../src/llm/types.js';

type AgentLoopModule = {
  executeAgentLoop: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
  DEFAULT_OUTPUT_TOKEN_ESTIMATE: number;
};

type ScriptedChat = (messages: LlmChatMessage[], parameters?: Record<string, unknown>) => Promise<LlmChatResult>;

const MODE_2_TOOL: LlmChatToolCall = {
  id: 'call_get_document_1',
  type: 'function',
  function: {
    name: 'get_document',
    arguments: { identifier: 'Research/ATL.md' },
  },
};

const SECOND_TOOL: LlmChatToolCall = {
  id: 'call_search_documents_1',
  type: 'function',
  function: {
    name: 'search_documents',
    arguments: { query: 'agent loop' },
  },
};

function chatResult(overrides: Partial<LlmChatResult> = {}): LlmChatResult {
  return {
    message: { role: 'assistant', content: 'final answer' },
    modelName: 'fast',
    providerName: 'openai',
    inputTokens: 11,
    outputTokens: 7,
    latencyMs: 31,
    finishReason: 'stop',
    ...overrides,
  };
}

async function loadAgentLoop(): Promise<AgentLoopModule> {
  return import('../../src/llm/agent-loop.js') as Promise<AgentLoopModule>;
}

function buildOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const chat: ScriptedChat = vi.fn()
    .mockResolvedValueOnce(chatResult({
      message: { role: 'assistant', content: null, tool_calls: [MODE_2_TOOL] },
      finishReason: 'tool_calls',
      inputTokens: 13,
      outputTokens: 5,
    }))
    .mockResolvedValueOnce(chatResult());

  return {
    purposeName: 'research',
    initialMessages: [{ role: 'user', content: 'Read the ATL document.' }],
    nativeToolNames: ['get_document'],
    providerTools: [{ type: 'function', function: { name: 'get_document', parameters: {} } }],
    toolDispatcher: vi.fn().mockResolvedValue({
      messages: [{ role: 'tool', tool_call_id: 'call_get_document_1', content: JSON.stringify({ ok: true }) }],
      logEntries: [{ tool_name: 'get_document', tool_call_id: 'call_get_document_1', tokens: { input: 0, output: 0 } }],
    }),
    chat,
    parameters: { max_tokens: 128 },
    models: [
      { name: 'fast', providerName: 'openai', costPerMillion: { input: 1, output: 2 } },
      { name: 'fallback', providerName: 'openrouter', costPerMillion: { input: 10, output: 20 } },
    ],
    recordUsage: vi.fn(),
    now: vi.fn(() => 1_000),
    getIsShuttingDown: vi.fn(() => false),
    ...overrides,
  };
}

describe('ATL-U-13 loop executor state machine contract', () => {
  it('ATL-U-13 selects Mode 2 when the final model-visible registry is non-empty and returns stop_reason final_response', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions());

    expect(result.metadata).toMatchObject({
      tools: {
        stop_reason: 'final_response',
        native_tool_names: ['get_document'],
      },
    });
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', tool_calls: [MODE_2_TOOL] }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_get_document_1' }),
    ]));
  });

  it('ATL-U-13 treats native-only, template-only/provider-tool-only, permissive template exposure, and restrictive no-visible-tool cases as mode-selection inputs', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const cases = [
      { label: 'native-only', nativeToolNames: ['get_document'], providerTools: [{ type: 'function' }] },
      { label: 'template-only/provider-tool-only', nativeToolNames: [], providerTools: [{ type: 'function' }] },
      { label: 'permissive template exposure', nativeToolNames: [], providerTools: [{ type: 'function' }], templatesDefaultAccess: 'all' },
      { label: 'restrictive/no-visible-tool', nativeToolNames: [], providerTools: [], expectMode1: true },
    ];

    for (const entry of cases) {
      const result = await executeAgentLoop(buildOptions(entry));
      if (entry.expectMode1) {
        expect(result, entry.label).toHaveProperty('mode', 'mode_1');
      } else {
        expect(result, entry.label).toHaveProperty('metadata.tools.stop_reason');
      }
    }
  });

  it('ATL-U-13 rejects caller-provided tools as deferred Mode 3 and does not enter loop execution', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    await expect(executeAgentLoop(buildOptions({
      callerProvidedTools: [{ type: 'function', function: { name: 'external_search' } }],
    }))).rejects.toMatchObject({
      code: 'mode_3_deferred',
      message: expect.stringContaining('caller-provided tools'),
    });
  });

  it('ATL-U-13 appends assistant tool_calls before role tool messages and preserves tool_call_id history for fallback', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions());
    const roles = (result.messages as Array<{ role: string }>).map((message) => message.role);

    expect(roles.indexOf('assistant')).toBeLessThan(roles.indexOf('tool'));
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_get_document_1', name: undefined }),
    ]));
    expect(result.metadata).toMatchObject({
      tools: {
        calls_log: expect.arrayContaining([
          expect.objectContaining({ tool_call_id: 'call_get_document_1' }),
        ]),
      },
    });
  });

  it('ATL-U-13 dispatches multiple tool calls with Promise.allSettled semantics and returns sibling successes plus recoverable errors', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const toolDispatcher = vi.fn().mockResolvedValue({
      messages: [
        { role: 'tool', tool_call_id: 'call_get_document_1', content: JSON.stringify({ ok: true }) },
        { role: 'tool', tool_call_id: 'call_search_documents_1', content: JSON.stringify({ ok: false, error: { code: 'tool_failed' } }) },
      ],
      logEntries: [
        { tool_name: 'get_document', status: 'fulfilled' },
        { tool_name: 'search_documents', status: 'rejected' },
      ],
      dispatchPolicy: 'Promise.allSettled',
    });
    const chat: ScriptedChat = vi.fn()
      .mockResolvedValueOnce(chatResult({
        message: { role: 'assistant', content: null, tool_calls: [MODE_2_TOOL, SECOND_TOOL] },
        finishReason: 'tool_calls',
      }))
      .mockResolvedValueOnce(chatResult());

    const result = await executeAgentLoop(buildOptions({ chat, toolDispatcher }));

    expect(toolDispatcher).toHaveBeenCalledWith(expect.objectContaining({
      toolCalls: [MODE_2_TOOL, SECOND_TOOL],
      dispatchPolicy: 'Promise.allSettled',
    }));
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_get_document_1' }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_search_documents_1' }),
    ]));
  });

  it.each([
    'max_iterations',
    'timeout',
    'max_tokens',
    'max_cost',
    'shutdown',
    'error',
  ])('ATL-U-13 stops before the next model call with stop_reason %s', async (stopReason) => {
    const { executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions({ forceStopBeforeNextCall: stopReason }));

    expect(result.metadata).toMatchObject({
      tools: {
        stop_reason: stopReason,
      },
    });
  });

  it('ATL-U-13 maps provider error/content-filter failures to stop_reason error without writing invented usage for an incomplete iteration', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const recordUsage = vi.fn();
    const chat = vi.fn()
      .mockResolvedValueOnce(chatResult({
        message: { role: 'assistant', content: null, tool_calls: [MODE_2_TOOL] },
        finishReason: 'tool_calls',
        inputTokens: 17,
        outputTokens: 3,
      }))
      .mockRejectedValueOnce(new Error('provider error: content_filter'));

    const result = await executeAgentLoop(buildOptions({ chat, recordUsage }));

    expect(result.metadata).toMatchObject({
      tools: {
        stop_reason: 'error',
        calls_log: [expect.objectContaining({ tokens: { input: 17, output: 3 } })],
      },
      tokens: { input: 17, output: 3 },
    });
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 17, outputTokens: 3 }));
  });

  it('ATL-U-13 handles dispatch-time timeout as stop_reason timeout and preserves completed usage only', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions({
      toolDispatcher: vi.fn().mockResolvedValue({
        messages: [{ role: 'tool', tool_call_id: 'call_get_document_1', content: JSON.stringify({ ok: false, error: { code: 'timeout' } }) }],
        logEntries: [{ tool_name: 'get_document', status: 'timeout' }],
      }),
      forceStopAfterDispatch: 'timeout',
    }));

    expect(result.metadata).toMatchObject({
      tools: {
        stop_reason: 'timeout',
        calls_log: expect.arrayContaining([expect.objectContaining({ status: 'timeout' })]),
      },
    });
  });

  it('ATL-U-13 passes the loop AbortSignal into in-flight model calls so timeout_ms can abort them', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const observedSignals: AbortSignal[] = [];
    const chat = vi.fn((_messages: LlmChatMessage[], parameters?: Record<string, unknown>) => {
      const signal = parameters?.['signal'];
      expect(signal).toBeInstanceOf(AbortSignal);
      observedSignals.push(signal as AbortSignal);
      return new Promise<LlmChatResult>((_resolve, reject) => {
        (signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted by loop timeout')), { once: true });
      });
    });

    const result = await executeAgentLoop(buildOptions({
      chat,
      parameters: { timeout_ms: 1, max_tokens: 128 },
    }));

    expect(chat).toHaveBeenCalledTimes(1);
    expect(observedSignals[0].aborted).toBe(true);
    expect(result.metadata.tools.stop_reason).toBe('timeout');
  });
});

describe('ATL-U-14 cost, budget, and usage aggregation contract', () => {
  it('ATL-U-14 writes one aggregate usage row and zero per-iteration public usage rows', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const recordUsage = vi.fn();
    await executeAgentLoop(buildOptions({ recordUsage }));

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      purposeName: 'research',
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
    }));
  });

  it('ATL-U-14 records zero public usage when a pre-iteration stop happens before any provider response completes', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const recordUsage = vi.fn();
    const result = await executeAgentLoop(buildOptions({
      recordUsage,
      forceStopBeforeFirstCall: 'max_tokens',
    }));

    expect(recordUsage).not.toHaveBeenCalled();
    expect(result.metadata).toMatchObject({
      tokens: { input: 0, output: 0 },
      tools: { stop_reason: 'max_tokens', calls_log: [] },
    });
  });

  it('ATL-U-14 keeps aggregate tokens equal to metadata.tools.calls_log token sums', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions());
    const callsLog = result.metadata.tools.calls_log as Array<{ tokens: { input: number; output: number } }>;
    const input = callsLog.reduce((sum, entry) => sum + entry.tokens.input, 0);
    const output = callsLog.reduce((sum, entry) => sum + entry.tokens.output, 0);

    expect(result.metadata.tokens).toEqual({ input, output });
  });

  it('ATL-U-14 computes fallback cost as the sum of each completed iteration at that iteration selected model per-model rates', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions({
      chat: vi.fn()
        .mockResolvedValueOnce(chatResult({
          modelName: 'fast',
          message: { role: 'assistant', content: null, tool_calls: [MODE_2_TOOL] },
          finishReason: 'tool_calls',
          inputTokens: 100,
          outputTokens: 10,
        }))
        .mockResolvedValueOnce(chatResult({ modelName: 'fallback', providerName: 'openrouter', inputTokens: 20, outputTokens: 5 })),
      selectedModelsByIteration: ['fast', 'fallback'],
    }));

    expect(result.metadata.cost_usd).toBeCloseTo(((100 * 1) + (10 * 2) + (20 * 10) + (5 * 20)) / 1_000_000, 12);
  });

  it('ATL-U-14 stamps final metadata and aggregate usage with the latest successful fallback result', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const recordUsage = vi.fn();
    const result = await executeAgentLoop(buildOptions({
      recordUsage,
      chat: vi.fn()
        .mockResolvedValueOnce(chatResult({
          modelName: 'fast',
          providerName: 'openai',
          fallbackPosition: 1,
          message: { role: 'assistant', content: null, tool_calls: [MODE_2_TOOL] },
          finishReason: 'tool_calls',
          inputTokens: 100,
          outputTokens: 10,
        }))
        .mockResolvedValueOnce(chatResult({
          modelName: 'fallback',
          providerName: 'openrouter',
          fallbackPosition: 2,
          inputTokens: 20,
          outputTokens: 5,
        })),
    }));

    expect(result.metadata).toMatchObject({
      resolved_model_name: 'fallback',
      provider_name: 'openrouter',
      fallback_position: 2,
    });
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      modelName: 'fallback',
      providerName: 'openrouter',
      fallbackPosition: 2,
    }));
  });

  it('ATL-U-14 uses the selected initial model to enforce max_cost_usd before the first provider call', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const chat = vi.fn();

    const result = await executeAgentLoop(buildOptions({
      chat,
      models: [],
      initialModelName: 'expensive',
      modelCostLookup: (modelName: string) =>
        modelName === 'expensive'
          ? { name: 'expensive', providerName: 'openai', costPerMillion: { input: 1_000_000, output: 1_000_000 } }
          : undefined,
      parameters: { max_tokens: 128, max_cost_usd: 0.000001 },
    }));

    expect(chat).not.toHaveBeenCalled();
    expect(result.metadata.tools.stop_reason).toBe('max_cost');
    expect(result.metadata.tokens).toEqual({ input: 0, output: 0 });
  });

  it('ATL-U-14 covers budget estimate ladders: ceil(message_chars / 4), cumulative average, 0, parameters.max_tokens, purpose default max_tokens, and DEFAULT_OUTPUT_TOKEN_ESTIMATE = 2048', async () => {
    const { DEFAULT_OUTPUT_TOKEN_ESTIMATE, executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions({
      estimateProbe: {
        input: ['ceil(message_chars / 4)', 'cumulative_average_prior_input_tokens', '0'],
        output: ['parameters.max_tokens', 'purpose_default_max_tokens', 'DEFAULT_OUTPUT_TOKEN_ESTIMATE'],
      },
    }));

    expect(DEFAULT_OUTPUT_TOKEN_ESTIMATE).toBe(2048);
    expect(result.metadata.tools.estimate_ladder).toEqual({
      input: ['ceil(message_chars / 4)', 'cumulative_average_prior_input_tokens', '0'],
      output: ['parameters.max_tokens', 'purpose_default_max_tokens', 'DEFAULT_OUTPUT_TOKEN_ESTIMATE'],
    });
  });

  it('ATL-U-14 keeps stop_reason envelope-only and uses completed-iteration calls_log tokens, not database rows', async () => {
    const { executeAgentLoop } = await loadAgentLoop();
    const result = await executeAgentLoop(buildOptions({ forceStopBeforeNextCall: 'shutdown' }));

    expect(result.metadata.tools.stop_reason).toBe('shutdown');
    expect(result.usageRow).not.toHaveProperty('stop_reason');
    expect(result.metadata.tools.calls_log).toEqual(expect.arrayContaining([
      expect.objectContaining({ tokens: expect.objectContaining({ input: expect.any(Number), output: expect.any(Number) }) }),
    ]));
  });
});
