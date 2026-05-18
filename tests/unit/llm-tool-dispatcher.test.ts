import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LlmChatToolCall } from '../../src/llm/types.js';
import type { Broker, BrokeredTool, ConsumerContext } from '../../src/services/mcp-broker/index.js';

type ToolDispatcherModule = {
  dispatchToolCalls: (options: Record<string, unknown>) => Promise<{
    messages: Array<{ role: 'tool'; tool_call_id: string; content?: string; name?: never }>;
    logEntries: Array<Record<string, unknown>>;
  }>;
};

type NativeToolDispatchContext = {
  signal: AbortSignal;
  traceId: string | null;
  instanceId: string;
  logger: Record<string, unknown>;
  logContext: Record<string, unknown>;
};

async function loadDispatcher(): Promise<ToolDispatcherModule> {
  return import('../../src/llm/tool-dispatcher.js') as Promise<ToolDispatcherModule>;
}

function toolCall(name: string, args: Record<string, unknown> = {}, id = `call_${name}`): LlmChatToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: args },
  };
}

function buildDispatcherOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const handler = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Document body with literal {{ref:Secret/plan.md}} left as data.' }],
  });

  return {
    toolCalls: [toolCall('get_document', { identifier: 'Research/ATL.md' })],
    nativeToolNames: ['get_document'],
    catalog: new Map([
      ['get_document', {
        name: 'get_document',
        inputSchema: z.object({ identifier: z.string() }),
        handler,
      }],
      ['search_documents', {
        name: 'search_documents',
        inputSchema: z.object({ query: z.string() }),
        handler: vi.fn(),
      }],
    ]),
    context: {
      signal: new AbortController().signal,
      traceId: 'trace-dispatch',
      instanceId: 'instance-dispatch',
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      logContext: { request_id: 'req-1' },
    } satisfies NativeToolDispatchContext,
    ...overrides,
  };
}

function brokeredTool(overrides: Partial<BrokeredTool> = {}): BrokeredTool {
  return {
    serverId: 'basic',
    toolName: 'echo',
    registryKey: 'basic__echo',
    description: 'Echo through broker',
    inputSchema: { type: 'object', properties: { value: {} } },
    tofuHash: 'hash-basic-echo',
    costPerCall: 0,
    ...overrides,
  };
}

function makeBroker(tools: BrokeredTool[], callTool = vi.fn()): Broker {
  return {
    ensureConnected: vi.fn(),
    callTool,
    isConnected: vi.fn(),
    listToolsForConsumer: vi.fn(async (_ctx: ConsumerContext) => tools),
    shutdown: vi.fn(),
  };
}

describe('TOOL-05 internal native tool dispatch contract', () => {
  it('routes registry-key tool calls to Broker.callTool after consumer visibility passes', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const args = { value: { stringNumber: '42', number: 42, nullish: null, array: [1, 'two'] } };
    const rawResult = {
      content: [{ type: 'text' as const, text: JSON.stringify({ value: args.value }) }],
      structuredContent: { value: args.value },
    };
    const callTool = vi.fn(async () => rawResult);
    const consumerContext: ConsumerContext = { kind: 'purpose', purposeId: 'research', traceId: 'trace-dispatch' };
    const broker = makeBroker([brokeredTool()], callTool);

    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [toolCall('basic__echo', args)],
      nativeToolNames: [],
      broker,
      consumerContext,
    }));

    expect(broker.listToolsForConsumer).toHaveBeenCalledWith(consumerContext);
    expect(callTool).toHaveBeenCalledWith({ serverId: 'basic', toolName: 'echo' }, args, consumerContext);
    expect(result.messages[0].content).toBe(JSON.stringify({ ok: true, result: { content: rawResult.content } }));
    expect(result.logEntries[0]).toMatchObject({
      kind: 'brokered',
      tool_call_id: 'call_basic__echo',
      tool_name: 'basic__echo',
      status: 'success',
    });
  });

  it('rejects registry-key tool calls that are not visible to the consumer', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const callTool = vi.fn();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [toolCall('basic__echo', { value: 'hidden' })],
      nativeToolNames: [],
      broker: makeBroker([], callTool),
      consumerContext: { kind: 'purpose', purposeId: 'research', traceId: 'trace-hidden' } satisfies ConsumerContext,
    }));

    expect(callTool).not.toHaveBeenCalled();
    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: 'tool_not_in_registry', recoverable: true },
    });
  });

  it('wraps brokered isError results without a native help footer', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'upstream rejected input' }],
      isError: true,
    }));
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [toolCall('basic__echo', { value: 'bad' })],
      nativeToolNames: [],
      broker: makeBroker([brokeredTool()], callTool),
      consumerContext: { kind: 'purpose', purposeId: 'research', traceId: 'trace-error' } satisfies ConsumerContext,
    }));

    const payload = JSON.parse(result.messages[0].content ?? '{}');
    expect(payload).toMatchObject({
      ok: false,
      error: {
        code: 'is_error_result',
        message: 'upstream rejected input',
        recoverable: true,
      },
    });
    expect(payload.error.message).not.toContain('help');
  });

  it('TOOL-05 dispatches only tools in the immutable nativeToolNames snapshot', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [
        toolCall('get_document', { identifier: 'Research/ATL.md' }),
        toolCall('search_documents', { query: 'not exposed' }),
      ],
      nativeToolNames: ['get_document'],
    }));

    expect(result.messages).toEqual([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_get_document' }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_search_documents',
        content: expect.stringContaining('tool_not_in_registry'),
      }),
    ]);
  });

  it('TOOL-05 returns recoverable JSON error payloads for unknown/unexposed tools rather than throwing', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [toolCall('call_model', { resolver: 'purpose' }, 'call_forbidden')],
      nativeToolNames: ['get_document'],
    }));

    expect(result.messages[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_forbidden',
    });
    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: false,
      error: {
        code: 'tool_not_in_registry',
        recoverable: true,
      },
    });
  });

  it('TOOL-05 validates raw Zod-shape arguments before handler invocation', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const handler = vi.fn();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [toolCall('get_document', { identifier: 123 })],
      catalog: new Map([
        ['get_document', { name: 'get_document', inputSchema: z.object({ identifier: z.string() }), handler }],
      ]),
    }));

    expect(handler).not.toHaveBeenCalled();
    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: 'invalid_tool_arguments', recoverable: true },
    });
  });

  it('TOOL-05 passes NativeToolDispatchContext with AbortSignal, traceId, instanceId, logger, and log context to handlers', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const controller = new AbortController();
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const context: NativeToolDispatchContext = {
      signal: controller.signal,
      traceId: 'trace-abc',
      instanceId: 'instance-123',
      logger: { debug: vi.fn() },
      logContext: { request_id: 'req-abc' },
    };

    await dispatchToolCalls(buildDispatcherOptions({
      context,
      catalog: new Map([
        ['get_document', { name: 'get_document', inputSchema: z.object({ identifier: z.string() }), handler }],
      ]),
    }));

    expect(handler).toHaveBeenCalledWith(
      { identifier: 'Research/ATL.md' },
      expect.objectContaining({
        signal: controller.signal,
        traceId: 'trace-abc',
        instanceId: 'instance-123',
        logger: context.logger,
        logContext: context.logContext,
      })
    );
  });

  it.each([
    ['handler isError true', { content: [{ type: 'text', text: 'bad input' }], isError: true }, 'handler_error'],
    ['thrown error', new Error('boom'), 'handler_error'],
  ])('TOOL-05 turns %s into recoverable tool error content', async (_label, handlerOutcome, expectedCode) => {
    const { dispatchToolCalls } = await loadDispatcher();
    const handler = handlerOutcome instanceof Error
      ? vi.fn().mockRejectedValue(handlerOutcome)
      : vi.fn().mockResolvedValue(handlerOutcome);
    const result = await dispatchToolCalls(buildDispatcherOptions({
      catalog: new Map([
        ['get_document', { name: 'get_document', inputSchema: z.object({ identifier: z.string() }), handler }],
      ]),
    }));

    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: expectedCode, recoverable: true },
    });
  });

  it('TOOL-05 preserves successful sibling tool results when another sibling handler fails', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [
        toolCall('get_document', { identifier: 'Research/ATL.md' }, 'call_success'),
        toolCall('search_documents', { query: 'boom' }, 'call_failure'),
      ],
      nativeToolNames: ['get_document', 'search_documents'],
      catalog: new Map([
        ['get_document', {
          name: 'get_document',
          inputSchema: z.object({ identifier: z.string() }),
          handler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok sibling' }] }),
        }],
        ['search_documents', {
          name: 'search_documents',
          inputSchema: z.object({ query: z.string() }),
          handler: vi.fn().mockRejectedValue(new Error('sibling failed')),
        }],
      ]),
    }));

    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: true,
      result: { content: [{ type: 'text', text: 'ok sibling' }] },
    });
    expect(JSON.parse(result.messages[1].content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: 'handler_error', recoverable: true },
    });
  });

  it.each(['timeout', 'shutdown'])('TOOL-05 turns dispatch-time aborts into recoverable %s tool error content', async (reason) => {
    const { dispatchToolCalls } = await loadDispatcher();
    const controller = new AbortController();
    controller.abort(reason);
    const result = await dispatchToolCalls(buildDispatcherOptions({
      context: {
        signal: controller.signal,
        traceId: 'trace-abort',
        instanceId: 'instance-abort',
        logger: { debug: vi.fn() },
        logContext: {},
      } satisfies NativeToolDispatchContext,
    }));

    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: false,
      error: { code: reason, recoverable: true },
    });
  });
});

describe('TOOL-06 OpenAI-compatible tool result message contract', () => {
  it('TOOL-06 emits role tool messages keyed by matching tool_call_id with no name field', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions());

    expect(result.messages[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_get_document',
    });
    expect('name' in result.messages[0]).toBe(false);
  });

  it('TOOL-06 serializes stable success payloads exactly as content === JSON.stringify(payload)', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const rawHandlerResult = {
      content: [{ type: 'text', text: 'Result body with literal {{ref:Secret/plan.md}} not hydrated.' }],
    };
    const result = await dispatchToolCalls(buildDispatcherOptions({
      catalog: new Map([
        ['get_document', {
          name: 'get_document',
          inputSchema: z.object({ identifier: z.string() }),
          handler: vi.fn().mockResolvedValue(rawHandlerResult),
        }],
      ]),
    }));

    expect(result.messages[0].content).toBe(JSON.stringify({ ok: true, result: rawHandlerResult }));
  });

  it('TOOL-06 records calls-log metadata with tool_call_id, tool name, argument object, status, and result summary', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions());

    expect(result.logEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool_call_id: 'call_get_document',
        tool_name: 'get_document',
        arguments: { identifier: 'Research/ATL.md' },
        status: expect.any(String),
        result_summary: expect.any(String),
      }),
    ]));
  });
});

describe('ATL-U-15 mixed native/template dispatcher contracts', () => {
  it('routes generated flashquery template names through templateReverseMap before native fallback and records kind=template', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [
        toolCall('flashquery_skill_research_skill', { topic: 'Phase 118' }, 'call_template'),
      ],
      nativeToolNames: [],
      templateReverseMap: new Map([['flashquery_skill_research_skill', 'Templates/Research-Skill.md']]),
      templateTools: new Map([
        ['Templates/Research-Skill.md', {
          body: 'Research {{topic}}',
          frontmatter: {
            fq_template: true,
            fq_expose_as_tool: true,
            fq_namespace: 'skill',
            fq_desc: 'Research skill',
            fq_params: { topic: { type: 'string', required: true } },
          },
        }],
      ]),
    }));

    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: true,
      result: { template_path: 'Templates/Research-Skill.md', content: 'Research Phase 118' },
    });
    expect(result.logEntries[0]).toMatchObject({
      kind: 'template',
      tool_call_id: 'call_template',
      tool_name: 'flashquery_skill_research_skill',
      status: 'success',
    });
  });

  it('preserves kind discrimination for mixed native/template sibling calls', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [
        toolCall('get_document', { identifier: 'Research/ATL.md' }, 'call_native'),
        toolCall('flashquery_skill_research_skill', { topic: 'Phase 118' }, 'call_template'),
      ],
      nativeToolNames: ['get_document'],
      templateReverseMap: new Map([['flashquery_skill_research_skill', 'Templates/Research-Skill.md']]),
    }));

    expect(result.logEntries.map((entry) => entry.kind)).toEqual(['native', 'template']);
  });

  it('routes generated flashquery names absent from the reverse map through native fallback parity', async () => {
    const { dispatchToolCalls } = await loadDispatcher();
    const result = await dispatchToolCalls(buildDispatcherOptions({
      toolCalls: [
        toolCall('flashquery_skill_research_skill', { topic: 'Phase 118' }, 'call_template_missing'),
      ],
      nativeToolNames: [],
      templateReverseMap: new Map(),
    }));

    expect(JSON.parse(result.messages[0].content ?? '{}')).toMatchObject({
      ok: false,
      error: {
        code: 'tool_not_in_registry',
        recoverable: true,
      },
    });
    expect(result.logEntries[0]).toMatchObject({
      kind: 'native',
      tool_call_id: 'call_template_missing',
      tool_name: 'flashquery_skill_research_skill',
      status: 'error',
      error_code: 'tool_not_in_registry',
    });
  });
});
