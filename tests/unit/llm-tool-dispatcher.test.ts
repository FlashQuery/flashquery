import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LlmChatToolCall } from '../../src/llm/types.js';

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

describe('TOOL-05 internal native tool dispatch contract', () => {
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
