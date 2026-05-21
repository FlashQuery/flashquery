import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { NativeToolDispatchContext } from '../../src/llm/tool-registry.js';

const toolMetaMock = vi.hoisted(() => ({
  loadToolMeta: vi.fn(async () => new Map([
    ['get_document', {
      name: 'get_document',
      description: 'Get a document. Pass {help: true}.',
      helpHint: 'Get document help hint',
      helpPageBody: 'GET_DOCUMENT_RAW_HELP_BODY',
      tier: 'read-only',
      args: { identifier: { type: 'string', required: true } },
      filePath: 'src/mcp/tools/get_document.tool.md',
    }],
  ])),
}));

vi.mock('../../src/services/tool-search/tool-meta.js', () => ({
  loadToolMeta: toolMetaMock.loadToolMeta,
}));

async function loadCore(): Promise<typeof import('../../src/llm/native-tool-core.js')> {
  return await import('../../src/llm/native-tool-core.js');
}

function context(signal = new AbortController().signal): NativeToolDispatchContext {
  return {
    signal,
    traceId: 'trace-native-core',
    instanceId: 'instance-native-core',
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logContext: {},
  };
}

function catalog(handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }))) {
  return new Map([
    ['get_document', {
      name: 'get_document',
      description: 'Get document',
      inputSchema: z.object({ identifier: z.string() }),
      handler,
    }],
  ]);
}

function footerFor(toolName: string): string {
  return `For full documentation, examples, and parameter details, call \`${toolName}\` with \`help: true\`.`;
}

describe('native tool core help convention', () => {
  it('dispatches valid native tool calls through the handler', async () => {
    const { dispatchNativeToolCore } = await loadCore();
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Document body' }] }));

    const result = await dispatchNativeToolCore({
      toolName: 'get_document',
      args: { identifier: 'Research/ATL.md' },
      catalog: catalog(handler),
      nativeToolNames: ['get_document'],
      dispatchContext: context(),
    });

    expect(handler).toHaveBeenCalledWith({ identifier: 'Research/ATL.md' }, expect.objectContaining({ instanceId: 'instance-native-core' }));
    expect(result.payload).toEqual({ ok: true, result: { content: [{ type: 'text', text: 'Document body' }] } });
    expect(result.args).toEqual({ identifier: 'Research/ATL.md' });
  });

  it('returns boolean help before schema validation', async () => {
    const { dispatchNativeToolCore } = await loadCore();
    const handler = vi.fn();

    const result = await dispatchNativeToolCore({
      toolName: 'get_document',
      args: { help: true, identifier: 123 },
      catalog: catalog(handler),
      nativeToolNames: ['get_document'],
      dispatchContext: context(),
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.payload).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'GET_DOCUMENT_RAW_HELP_BODY' }] },
    });
  });

  it.each([{ help: 'true' }, { help: 1 }, { help: false }, {}])('treats %o as normal args, not help', async (args) => {
    const { dispatchNativeToolCore } = await loadCore();
    const handler = vi.fn();

    const result = await dispatchNativeToolCore({
      toolName: 'get_document',
      args,
      catalog: catalog(handler),
      nativeToolNames: ['get_document'],
      dispatchContext: context(),
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.payload).toMatchObject({
      ok: false,
      error: { code: 'invalid_tool_arguments' },
    });
  });

  it('appends footer to native unknown, validation, handler, and abort errors', async () => {
    const { dispatchNativeToolCore } = await loadCore();
    const abortController = new AbortController();
    abortController.abort('shutdown');
    const cases = [
      await dispatchNativeToolCore({
        toolName: 'hidden',
        args: { help: true },
        catalog: catalog(),
        nativeToolNames: ['get_document'],
        dispatchContext: context(),
      }),
      await dispatchNativeToolCore({
        toolName: 'get_document',
        args: { identifier: 123 },
        catalog: catalog(),
        nativeToolNames: ['get_document'],
        dispatchContext: context(),
      }),
      await dispatchNativeToolCore({
        toolName: 'get_document',
        args: { identifier: 'Research/ATL.md' },
        catalog: catalog(vi.fn(async () => {
          throw new Error('boom');
        })),
        nativeToolNames: ['get_document'],
        dispatchContext: context(),
      }),
      await dispatchNativeToolCore({
        toolName: 'get_document',
        args: { identifier: 'Research/ATL.md' },
        catalog: catalog(),
        nativeToolNames: ['get_document'],
        dispatchContext: context(abortController.signal),
      }),
    ];

    for (const result of cases) {
      expect(result.payload.ok).toBe(false);
      if (result.payload.ok) continue;
      expect(result.payload.error.message).toContain(footerFor(result.args === cases[0].args ? 'hidden' : 'get_document'));
    }
  });

  it('passes through handler responses with falsy isError without footer wrapping', async () => {
    const { dispatchNativeToolCore } = await loadCore();
    const result = await dispatchNativeToolCore({
      toolName: 'get_document',
      args: { identifier: 'Research/ATL.md' },
      catalog: catalog(vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'expected body' }],
        isError: false,
      }))),
      nativeToolNames: ['get_document'],
      dispatchContext: context(),
    });

    expect(result.payload).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'expected body' }], isError: false },
    });
    expect(JSON.stringify(result.payload)).not.toContain('help: true');
  });
});
