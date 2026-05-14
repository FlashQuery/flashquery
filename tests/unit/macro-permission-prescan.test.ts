import { describe, expect, it, vi } from 'vitest';
import { preScanToolReferences } from '../../src/macro/permission-prescan.js';
import { buildToolRegistry } from '../../src/macro/registry.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import type { ToolFn, ToolRegistry } from '../../src/macro/types.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
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

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro Permission Prescan Test',
      id: 'macro-permission-prescan-test',
      vault: { path: '/tmp/macro-permission-prescan-test', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://postgres:test@localhost:5432/postgres',
      skipDdl: true,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio', tokenLifetime: 24 },
    locking: { enabled: false, ttlSeconds: 30 },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    hostMcpTools: { tools: ['search', 'write_document'] },
    llm: {
      providers: [],
      models: [],
      purposes: [
        {
          name: 'research',
          description: 'Research purpose',
          models: [],
          tools: ['search'],
        },
      ],
    },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
  } as FlashQueryConfig;
}

const catalog: NativeToolDefinition[] = [
  { name: 'search', description: 'search', inputSchema: {}, handler: vi.fn() },
  { name: 'write_document', description: 'write', inputSchema: {}, handler: vi.fn() },
];

function nativeDispatchContext(): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'macro-permission-prescan-test',
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

  it('does not treat fq._exists() as dispatch during permission pre-scan', () => {
    const result = preScanToolReferences({
      program: parseProgram(`
        exists = fq._exists()
        exit fq.search({ query: "ok" })
      `),
      registry: makeRegistry(),
      allowlist: new Set(['fq.search']),
    });

    expect(result).toBeUndefined();
  });

  it('T-U-164 uses assembleNativeToolRegistry nativeToolNames as delegated pre-scan allowlist', async () => {
    const built = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      broker: new NullMcpBroker(),
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
    });

    expect(built.allowedToolNames).toEqual(['fq.search']);

    const result = preScanToolReferences({
      program: parseProgram(`
        ok = fq.search({ query: "allowed" })
        exit fq.write_document({ path: "blocked.md", content: "blocked" })
      `),
      registry: built.registry,
      allowlist: new Set(built.allowedToolNames),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.write_document'],
        allowed: ['fq.search'],
      },
    });
  });

  it('classifies catalog tools outside the allowlist as forbidden and true typos as unknown_tool', async () => {
    const built = await buildToolRegistry({
      config: makeConfig({ hostMcpTools: { tools: ['search'] } }),
      callerContext: { origin: 'host' },
      broker: new NullMcpBroker(),
      catalog: [
        { name: 'search', description: 'search', inputSchema: {}, handler: vi.fn() },
        { name: 'archive_document', description: 'archive', inputSchema: {}, handler: vi.fn() },
      ],
      nativeDispatchContext: nativeDispatchContext(),
    });

    const result = preScanToolReferences({
      program: parseProgram('exit fq.archive_document({ identifier: "draft.md" })'),
      registry: built.registry,
      allowlist: new Set(built.allowedToolNames),
    });
    const typo = preScanToolReferences({
      program: parseProgram('exit fq.foobar({ query: "x" })'),
      registry: built.registry,
      allowlist: new Set(built.allowedToolNames),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.archive_document'],
        allowed: ['fq.search'],
      },
    });
    expect(parseEnvelope(typo)).toMatchObject({
      error: 'unknown_tool',
      details: {
        server: 'fq',
        tool: 'foobar',
        available: ['archive_document', 'search'],
      },
    });
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
