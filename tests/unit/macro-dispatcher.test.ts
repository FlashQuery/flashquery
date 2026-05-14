import { describe, expect, it, vi } from 'vitest';
import { dispatchMacroTool } from '../../src/macro/dispatcher.js';
import type { ToolFn, ToolRegistry } from '../../src/macro/types.js';

function registry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  const search: ToolFn = vi.fn(async (arg) => ({ ok: true, arg }));
  const archiveDocument: ToolFn = vi.fn(async () => ({ ok: true }));
  const webSearch: ToolFn = vi.fn(async (arg) => ({ results: [arg.query] }));

  return {
    fq: {
      label: 'FlashQuery',
      tools: {
        search,
        archive_document: archiveDocument,
      },
    },
    brave_search: {
      label: 'Brave Search',
      tools: {
        web_search: webSearch,
      },
    },
    ...overrides,
  };
}

function parseText(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('dispatchMacroTool', () => {
  it('T-U-156 dispatches fq.search({...}) to the registered handler with the arg record', async () => {
    const toolRegistry = registry();
    const result = await dispatchMacroTool({
      registry: toolRegistry,
      allowlist: new Set(['fq.search']),
      server: 'fq',
      tool: 'search',
      arg: { query: 'macro dispatch' },
      context: {},
    });

    expect(result).toEqual({ ok: true, arg: { query: 'macro dispatch' } });
    expect(toolRegistry.fq.tools.search).toHaveBeenCalledWith({ query: 'macro dispatch' }, expect.any(Object));
  });

  it('T-U-157 returns unknown_server for an unknown server', async () => {
    const result = await dispatchMacroTool({
      registry: registry(),
      allowlist: new Set(['fq.search']),
      server: 'unknown_server',
      tool: 'search',
      arg: {},
      context: {},
    });

    expect(parseText(result)).toMatchObject({
      error: 'unknown_server',
      details: { server: 'unknown_server' },
    });
  });

  it('T-U-158 returns unknown_tool with available tools for a known server and unknown tool', async () => {
    const result = await dispatchMacroTool({
      registry: registry(),
      allowlist: new Set(['fq.search']),
      server: 'fq',
      tool: 'unknown_tool',
      arg: {},
      context: {},
    });

    expect(parseText(result)).toMatchObject({
      error: 'unknown_tool',
      details: {
        server: 'fq',
        tool: 'unknown_tool',
        available: ['archive_document', 'search'],
      },
    });
  });

  it('T-U-159 dispatches brokered brave_search.web_search through the same ToolFn path', async () => {
    const toolRegistry = registry();
    const result = await dispatchMacroTool({
      registry: toolRegistry,
      allowlist: new Set(['brave_search.web_search']),
      server: 'brave_search',
      tool: 'web_search',
      arg: { query: 'FlashQuery' },
      context: {},
    });

    expect(result).toEqual({ results: ['FlashQuery'] });
    expect(toolRegistry.brave_search.tools.web_search).toHaveBeenCalledWith(
      { query: 'FlashQuery' },
      expect.any(Object)
    );
  });

  it('T-U-163 blocks forbidden fq.archive_document before handler invocation as a white-box allowlist backstop', async () => {
    const toolRegistry = registry();
    const result = await dispatchMacroTool({
      registry: toolRegistry,
      allowlist: new Set(['fq.search']),
      server: 'fq',
      tool: 'archive_document',
      arg: { identifier: 'blocked.md' },
      context: {},
    });

    expect(parseText(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.archive_document'],
        allowed: ['fq.search'],
      },
    });
    expect(toolRegistry.fq.tools.archive_document).not.toHaveBeenCalled();
  });
});
