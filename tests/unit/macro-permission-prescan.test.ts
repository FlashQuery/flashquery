import { describe, expect, it, vi } from 'vitest';
import { preScanToolReferences } from '../../src/macro/permission-prescan.js';
import type { ToolFn, ToolRegistry } from '../../src/macro/types.js';
import { parseProgram } from './macro-test-helpers.js';

function parseEnvelope(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

function makeRegistry(): ToolRegistry {
  const noop: ToolFn = vi.fn(async () => ({ ok: true }));
  return {
    fq: {
      label: 'FlashQuery',
      tools: {
        search: noop,
        write_document: noop,
        archive_document: noop,
        get_document: noop,
      },
    },
    brave_search: {
      label: 'Brave Search',
      tools: {
        web_search: noop,
      },
    },
  };
}

describe('preScanToolReferences', () => {
  it('T-U-160 rejects a tool not in caller allowlist with forbidden_tools, full forbidden and allowed lists', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit fq.archive_document({ identifier: "draft.md" })'),
      registry: makeRegistry(),
      allowlist: new Set(['fq.search']),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.archive_document'],
        allowed: ['fq.search'],
      },
    });
  });

  it('T-U-161 reports multiple forbidden references at once across nested if, for, while, expression and statement ToolCall nodes', () => {
    const result = preScanToolReferences({
      program: parseProgram(`
        if true then
          found = fq.search({ query: "allowed" })
          for item in [1, 2] do
            fq.write_document({ path: "nested.md", content: "mutation" })
          done
        else
          while false do
            archived = fq.archive_document({ identifier: "old.md" })
          done
        fi
      `),
      registry: makeRegistry(),
      allowlist: new Set(['fq.search']),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.write_document', 'fq.archive_document'],
        allowed: ['fq.search'],
      },
    });
  });

  it('T-U-162 reports permission failures before execution so forbidden handlers produce zero side effects', async () => {
    const sideEffect = vi.fn();
    const registry = makeRegistry();
    registry.fq.tools.write_document = vi.fn(async (arg) => {
      sideEffect(arg);
      return { ok: true };
    });

    const result = preScanToolReferences({
      program: parseProgram('fq.write_document({ path: "blocked.md", content: "must not run" })'),
      registry,
      allowlist: new Set(['fq.search']),
    });

    expect(parseEnvelope(result)).toMatchObject({ error: 'forbidden_tools' });
    expect(sideEffect).not.toHaveBeenCalled();
    expect(registry.fq.tools.write_document).not.toHaveBeenCalled();
  });

  it('T-U-164 consults assembleNativeToolRegistry-derived allowlist input and does not treat fq._exists() as dispatch', () => {
    const result = preScanToolReferences({
      program: parseProgram(`
        exists = fq._exists()
        exit fq.search({ query: "ok" })
      `),
      registry: makeRegistry(),
      allowlist: new Set(['fq.search']),
      allowlistSource: 'assembleNativeToolRegistry',
    });

    expect(result).toBeUndefined();
  });

  it('classifies unknown_server before unknown_tool and returns available tools for known servers', () => {
    const unknownServer = preScanToolReferences({
      program: parseProgram('exit unknown_server.search({ query: "x" })'),
      registry: makeRegistry(),
      allowlist: new Set(['fq.search']),
    });
    const unknownTool = preScanToolReferences({
      program: parseProgram('exit fq.unknown_tool({ query: "x" })'),
      registry: makeRegistry(),
      allowlist: new Set(['fq.search']),
    });

    expect(parseEnvelope(unknownServer)).toMatchObject({
      error: 'unknown_server',
      details: { server: 'unknown_server' },
    });
    expect(parseEnvelope(unknownTool)).toMatchObject({
      error: 'unknown_tool',
      details: {
        server: 'fq',
        tool: 'unknown_tool',
        available: ['archive_document', 'get_document', 'search', 'write_document'],
      },
    });
  });
});
