import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { buildToolRegistry } from '../../src/macro/registry.js';
import type {
  MacroCallerContext,
  ServerEntry,
  ToolFn,
  ToolRegistry,
} from '../../src/macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { NullBroker, type Broker, type ConsumerContext } from '../../src/services/mcp-broker.js';
import {
  clearBrokeredToolCallTrace,
  getBrokeredToolCallTraceSnapshot,
} from '../../src/services/mcp-broker/trace.js';

function makeConfig(overrides: Partial<FlashQueryConfig> = {}): FlashQueryConfig {
  return {
    instance: {
      name: 'Macro Registry Test',
      id: 'macro-registry-test',
      vault: { path: '/tmp/macro-registry-test', markdownExtensions: ['.md'] },
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
    hostMcpTools: { tools: ['search', 'write_document', 'call_model', 'call_macro'] },
    llm: {
      providers: [],
      models: [],
      purposes: [
        {
          name: 'research',
          description: 'Research purpose',
          models: [],
          tools: ['search', 'archive_document', 'call_model', 'call_macro'],
        },
      ],
    },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    ...overrides,
  } as FlashQueryConfig;
}

function nativeTool(
  name: string,
  handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ ok: true, name }) }] }),
  inputSchema: NativeToolDefinition['inputSchema'] = z.object({})
): NativeToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    inputSchema,
    handler,
  };
}

function nativeDispatchContext(): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'macro-registry-test',
    traceId: 'trace-registry',
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logContext: { test: 'macro-registry' },
  };
}

const catalog = [
  nativeTool('search'),
  nativeTool('write_document'),
  nativeTool('archive_document'),
  nativeTool('call_model'),
  nativeTool('call_macro'),
];

function brokeredSearchTool(costPerCall = 0) {
  return {
    serverId: 'brave_search',
    toolName: 'web_search',
    registryKey: 'brave_search__web_search',
    description: 'Search',
    inputSchema: { type: 'object' },
    tofuHash: 'hash',
    costPerCall,
  };
}

describe('macro ToolRegistry construction', () => {
  it('records brokered macro tool_calls trace entries using visible broker tool cost', async () => {
    clearBrokeredToolCallTrace('trace-registry');
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(async () => ({
        structuredContent: { ok: true, secret: 'payload-secret' },
        content: [{ type: 'text' as const, text: '{"ok":true}' }],
      })),
      listToolsForConsumer: vi.fn(async () => [
        {
          serverId: 'brave_search',
          toolName: 'web_search',
          registryKey: 'brave_search__web_search',
          description: 'Search',
          inputSchema: { type: 'object' },
          tofuHash: 'hash',
          costPerCall: 0.005,
        },
      ]),
      shutdown: vi.fn(),
    };
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    await result.registry.brave_search.tools.web_search({ query: 'arg-secret' }, {} as Parameters<ToolFn>[1]);

    expect(getBrokeredToolCallTraceSnapshot('trace-registry')).toEqual([
      { server: 'brave_search', tool: 'web_search', count: 1, cost: 0.005 },
    ]);
    expect(JSON.stringify(getBrokeredToolCallTraceSnapshot('trace-registry'))).not.toContain('arg-secret');
    expect(JSON.stringify(getBrokeredToolCallTraceSnapshot('trace-registry'))).not.toContain('payload-secret');
  });

  it('does not record brokered macro tool_calls cost when broker dispatch throws before an upstream result', async () => {
    clearBrokeredToolCallTrace('trace-registry');
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(async () => {
        throw {
          kind: 'server_timeout',
          message: 'Tool call timed out.',
          serverId: 'brave_search',
          toolName: 'web_search',
        };
      }),
      listToolsForConsumer: vi.fn(async () => [brokeredSearchTool(0.005)]),
      shutdown: vi.fn(),
    };
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    await expect(
      result.registry.brave_search.tools.web_search({ query: 'timeout' }, {} as Parameters<ToolFn>[1])
    ).rejects.toMatchObject({
      error: 'tool_call_failed',
      details: expect.objectContaining({ kind: 'server_timeout' }),
    });
    expect(getBrokeredToolCallTraceSnapshot('trace-registry')).toEqual([]);
  });

  it('builds fq registry entries from host exposure using resolveHostToolExposure for origin: host', async () => {
    const callerContext: MacroCallerContext = { origin: 'host' };
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext,
      broker: new NullBroker(),
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
    });

    const registry: ToolRegistry = result.registry;
    const fqEntry: ServerEntry = registry.fq;
    const searchTool: ToolFn = fqEntry.tools.search;

    expect(fqEntry.label).toBe('FlashQuery');
    expect(Object.keys(fqEntry.tools)).toEqual(expect.arrayContaining(['search', 'write_document', 'call_model']));
    expect(Object.keys(fqEntry.tools)).not.toContain('call_macro');
    expect(result.allowedToolNames).toEqual(expect.arrayContaining(['fq.search', 'fq.write_document', 'fq.call_model']));
    expect(await searchTool({}, {} as Parameters<ToolFn>[1])).toMatchObject({ ok: true, name: 'search' });
  });

  it('keeps fq.tools at full native catalog breadth while host allowlist stays narrowed', async () => {
    const result = await buildToolRegistry({
      config: makeConfig({ hostMcpTools: { tools: ['search'] } }),
      callerContext: { origin: 'host' },
      broker: new NullBroker(),
      catalog: [nativeTool('search'), nativeTool('archive_document'), nativeTool('call_macro')],
      nativeDispatchContext: nativeDispatchContext(),
    });

    expect(Object.keys(result.registry.fq.tools).sort()).toEqual(['archive_document', 'search']);
    expect(result.allowedToolNames).toEqual(['fq.search']);
  });

  it('builds delegated fq registry entries from assembleNativeToolRegistry nativeToolNames for origin: delegated', async () => {
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      broker: new NullBroker(),
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
    });

    expect(Object.keys(result.registry.fq.tools)).toEqual(expect.arrayContaining(['search', 'archive_document']));
    expect(Object.keys(result.registry.fq.tools)).not.toContain('call_macro');
    expect(Object.keys(result.registry.fq.tools)).not.toContain('call_model');
    expect(result.allowedToolNames).toEqual(expect.arrayContaining(['fq.search', 'fq.archive_document']));
    expect(result.hardExcludedReasons.get('fq.call_model')).toBe('recursive_model_excluded_from_delegated_macros');
  });

  it('omits call_macro and exposes template masquerade metadata without direct src/mcp/tools imports or callerKind', async () => {
    const templateReverseMap = new Map([['flashquery_template_brief', 'Templates/Brief.md']]);

    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker: new NullBroker(),
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      templateReverseMap,
    });

    expect(result.registry.fq.tools.call_macro).toBeUndefined();
    expect(result.templateToolNames).toContain('flashquery_template_brief');
    expect(result.allowedToolNames).not.toContain('fq.call_macro');
  });

  it('dispatches brokered macro tools through raw Broker.callTool and coerces successful CallToolResult values', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ hits: ['flashquery'] }) }],
    }));
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(async (serverId: string) => serverId === 'brave_search'),
      callTool,
      listToolsForConsumer: vi.fn(async (_ctx: ConsumerContext) => [brokeredSearchTool()]),
      shutdown: vi.fn(),
    };

    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    expect(result.registry.brave_search.tools.web_search).toEqual(expect.any(Function));
    await expect(
      result.registry.brave_search.tools.web_search({ query: 'FlashQuery', limit: 3 }, {} as Parameters<ToolFn>[1])
    ).resolves.toEqual({ hits: ['flashquery'] });
    expect(callTool).toHaveBeenCalledWith(
      { serverId: 'brave_search', toolName: 'web_search' },
      { query: 'FlashQuery', limit: 3 },
      { kind: 'host', traceId: 'trace-registry' }
    );
  });

  it('raises tool_call_failed for brokered isError results before coercion', async () => {
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'upstream rejected' }],
        isError: true,
      })),
      listToolsForConsumer: vi.fn(async () => [brokeredSearchTool()]),
      shutdown: vi.fn(),
    };

    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    await expect(
      result.registry.brave_search.tools.web_search({ query: 'FlashQuery' }, {} as Parameters<ToolFn>[1])
    ).rejects.toMatchObject({
      error: 'tool_call_failed',
      details: expect.objectContaining({ kind: 'is_error_result' }),
    });
  });

  it('registers configured broker tools without probing getToolHandler', async () => {
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(async () => ({
        structuredContent: { ok: true },
        content: [{ type: 'text' as const, text: '{"ok":true}' }],
      })),
      listToolsForConsumer: vi.fn(async () => [brokeredSearchTool()]),
      shutdown: vi.fn(),
    };
    const brokerWithExplodingLegacyProbe = Object.assign(broker, {
      getToolHandler: vi.fn(() => {
        throw new Error('legacy probe should not run');
      }),
    });

    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker: brokerWithExplodingLegacyProbe,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    expect(result.allowedToolNames).toContain('brave_search.web_search');
    expect(brokerWithExplodingLegacyProbe.getToolHandler).not.toHaveBeenCalled();
  });

  it('passes delegated purpose consumer context to brokered macro calls', async () => {
    const callTool = vi.fn(async () => ({
      structuredContent: { ok: true },
      content: [{ type: 'text' as const, text: '{"ok":true}' }],
    }));
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool,
      listToolsForConsumer: vi.fn(async () => [brokeredSearchTool()]),
      shutdown: vi.fn(),
    };
    const context = nativeDispatchContext();
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      broker,
      catalog,
      nativeDispatchContext: context,
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    await result.registry.brave_search.tools.web_search({ query: 'FlashQuery' }, {} as Parameters<ToolFn>[1]);
    expect(callTool).toHaveBeenCalledWith(
      { serverId: 'brave_search', toolName: 'web_search' },
      { query: 'FlashQuery' },
      { kind: 'purpose', purposeId: 'research', traceId: 'trace-registry' }
    );
  });

  it('validates native inputSchema before invoking handlers and returns invalid_tool_arguments', async () => {
    const handler = vi.fn();
    const result = await buildToolRegistry({
      config: makeConfig({ hostMcpTools: { tools: ['search'] } }),
      callerContext: { origin: 'host' },
      broker: new NullBroker(),
      catalog: [nativeTool('search', handler, z.object({ query: z.string() }))],
      nativeDispatchContext: nativeDispatchContext(),
    });

    await expect(result.registry.fq.tools.search({ query: 123 }, {} as Parameters<ToolFn>[1])).rejects.toMatchObject({
      error: 'invalid_tool_arguments',
    });
    expect(handler).toHaveBeenCalledTimes(0);
  });
});
