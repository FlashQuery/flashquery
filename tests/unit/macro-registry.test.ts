import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { buildToolRegistry } from '../../src/macro/registry.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import type {
  MacroCallerContext,
  ServerEntry,
  ToolFn,
  ToolRegistry,
} from '../../src/macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import {
  McpBroker,
  NullBroker,
  SchemaDriftNeedsUserInputError,
  type Broker,
  type BrokerAuditEvent,
  type BrokeredTool,
  type ConsumerContext,
} from '../../src/services/mcp-broker.js';
import {
  clearBrokeredToolCallTrace,
  getBrokeredToolCallTraceSnapshot,
} from '../../src/services/mcp-broker/trace.js';
import { parseProgram, parseToolPayload } from './macro-test-helpers.js';
import type { TofuDriftPayload } from '../../src/services/mcp-broker/types.js';

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
    locking: { enabled: false },
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

function brokeredSearchSnapshot(input: {
  description: string;
  hash: string;
  required?: string[];
}): BrokeredTool {
  return {
    serverId: 'brave_search',
    toolName: 'web_search',
    registryKey: 'brave_search__web_search',
    description: input.description,
    upstreamDescription: input.description,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: input.required ?? [],
    },
    tofuHash: input.hash,
    costPerCall: 0.005,
  };
}

function driftPayload(tool: string): TofuDriftPayload {
  return {
    event: 'schema_drift_detected',
    server: 'brave_search',
    tool,
    question: 'Review schema drift.',
    old_schema: { name: tool, description: 'old', inputSchema: { type: 'object' } },
    new_schema: { name: tool, description: 'new', inputSchema: { type: 'object', required: ['query'] } },
    diff_summary: 'Added required parameter: query',
    options: ['approve', 'reject'],
    answer_shape: `frontmatter.user_decisions.brave_search__${tool}.tofu_decision`,
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
      {
        server: 'brave_search',
        tool: 'web_search',
        count: 1,
        cost: 0.005,
        consumer_kind: 'host',
        trace_id: 'trace-registry',
      },
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
    expect(Object.keys(fqEntry.tools)).toEqual(expect.arrayContaining(['call_macro']));
    expect(result.allowedToolNames).toEqual(expect.arrayContaining(['fq.search', 'fq.write_document', 'fq.call_model', 'fq.call_macro']));
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
    expect(Object.keys(result.registry.fq.tools)).toContain('call_macro');
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

    expect(result.registry.fq.tools.call_macro).toEqual(expect.any(Function));
    expect(result.templateToolNames).toContain('flashquery_template_brief');
    expect(result.allowedToolNames).toContain('fq.call_macro');
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

  it('propagates broker schema drift as a needs_user_input macro result', async () => {
    const driftPayload = {
      event: 'schema_drift_detected',
      server: 'brave_search',
      tool: 'web_search',
      question: 'Review changed schema.',
      old_schema: { name: 'web_search', inputSchema: { type: 'object' } },
      new_schema: {
        name: 'web_search',
        inputSchema: { type: 'object', required: ['query'] },
      },
      diff_summary: 'Added required parameter: query (string)',
      options: ['approve', 'reject'],
      answer_shape: 'frontmatter.user_decisions.brave_search__web_search.tofu_decision',
    } as const;
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(async () => {
        throw new SchemaDriftNeedsUserInputError(driftPayload);
      }),
      listToolsForConsumer: vi.fn(async () => [brokeredSearchTool()]),
      shutdown: vi.fn(),
    };
    const registry = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    const result = await evaluateProgram(parseProgram('brave_search.web_search({ query: "FlashQuery" })'), {
      toolRegistry: registry.registry,
      allowedToolNames: registry.allowedToolNames,
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      reason: 'needs_user_input',
      payload: {
        event: 'schema_drift_detected',
        server: 'brave_search',
        tool: 'web_search',
        old_schema: driftPayload.old_schema,
        new_schema: driftPayload.new_schema,
      },
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

  it('T-U-033 preserves native FlashQuery tool response valid JSON parsing behavior', async () => {
    const result = await buildToolRegistry({
      config: makeConfig({ hostMcpTools: { tools: ['search'] } }),
      callerContext: { origin: 'host' },
      broker: new NullBroker(),
      catalog: [
        nativeTool('search', vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"ok":true,"items":["alpha",2,null]}' }],
        })),
      ],
      nativeDispatchContext: nativeDispatchContext(),
    });

    await expect(result.registry.fq.tools.search({}, {} as Parameters<ToolFn>[1])).resolves.toEqual({
      ok: true,
      items: ['alpha', 2, null],
    });
  });

  it('T-U-034 preserves native FlashQuery tool response raw-text fallback behavior', async () => {
    const result = await buildToolRegistry({
      config: makeConfig({ hostMcpTools: { tools: ['search'] } }),
      callerContext: { origin: 'host' },
      broker: new NullBroker(),
      catalog: [
        nativeTool('search', vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'plain native response' }],
        })),
      ],
      nativeDispatchContext: nativeDispatchContext(),
    });

    await expect(result.registry.fq.tools.search({}, {} as Parameters<ToolFn>[1])).resolves.toBe(
      'plain native response'
    );
  });

  it('approves pending TOFU schema drift and restores registry plus index state', async () => {
    const added: BrokeredTool[][] = [];
    const removed: string[][] = [];
    const auditEvents: BrokerAuditEvent[] = [];
    const broker = new McpBroker({
      host: { mcpServers: ['brave_search'] },
      indexSink: {
        addTools: (tools) => added.push(tools),
        removeTools: (keys) => removed.push(keys),
      },
      onAudit: (event) => auditEvents.push(event),
    });

    await broker.applyToolListSnapshot('brave_search', [
      brokeredSearchSnapshot({ description: 'old search', hash: 'old-hash' }),
    ]);
    await broker.applyToolListSnapshot('brave_search', [
      brokeredSearchSnapshot({ description: 'new search', hash: 'new-hash', required: ['query'] }),
    ]);

    expect(await broker.listToolsForConsumer({ kind: 'host', traceId: 'trace-approve' })).toHaveLength(0);

    const resolved = broker.resolveSchemaDrift(
      [{ server: 'brave_search', tool: 'web_search', decision: 'approve' }],
      { traceId: 'trace-approve' }
    );

    expect(resolved).toEqual([{ server: 'brave_search', tool: 'web_search', decision: 'approve' }]);
    expect(await broker.listToolsForConsumer({ kind: 'host', traceId: 'trace-approve' })).toMatchObject([
      { serverId: 'brave_search', toolName: 'web_search', description: 'new search' },
    ]);
    expect(added.at(-1)?.[0]).toMatchObject({ serverId: 'brave_search', toolName: 'web_search' });
    expect(removed.flat()).toContain('brave_search__web_search');
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        type: 'mcp_broker_tofu_decision',
        server: 'brave_search',
        tool: 'web_search',
        decision: 'approve',
        old_hash: expect.any(String),
        new_hash: expect.any(String),
        trace_id: 'trace-approve',
      })
    );
  });

  it('rejects pending TOFU schema drift and keeps the changed tool blocked', async () => {
    const added: BrokeredTool[][] = [];
    const auditEvents: BrokerAuditEvent[] = [];
    const broker = new McpBroker({
      host: { mcpServers: ['brave_search'] },
      indexSink: {
        addTools: (tools) => added.push(tools),
        removeTools: vi.fn(),
      },
      onAudit: (event) => auditEvents.push(event),
    });

    await broker.applyToolListSnapshot('brave_search', [
      brokeredSearchSnapshot({ description: 'old search', hash: 'old-hash' }),
    ]);
    await broker.applyToolListSnapshot('brave_search', [
      brokeredSearchSnapshot({ description: 'new search', hash: 'new-hash', required: ['query'] }),
    ]);

    broker.resolveSchemaDrift(
      [{ server: 'brave_search', tool: 'web_search', decision: 'reject' }],
      { traceId: 'trace-reject' }
    );

    expect(await broker.listToolsForConsumer({ kind: 'host', traceId: 'trace-reject' })).toHaveLength(0);
    expect(added).toHaveLength(1);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        type: 'mcp_broker_tofu_decision',
        server: 'brave_search',
        tool: 'web_search',
        decision: 'reject',
        trace_id: 'trace-reject',
      })
    );
  });

  it('records autonomous TOFU drift as blocked_on_user without emitting a prompt payload', async () => {
    const driftCallback = vi.fn();
    const auditEvents: BrokerAuditEvent[] = [];
    const broker = new McpBroker({
      host: { mcpServers: ['brave_search'] },
      onTofuDrift: driftCallback,
      onAudit: (event) => auditEvents.push(event),
    });

    await broker.applyToolListSnapshot('brave_search', [
      brokeredSearchSnapshot({ description: 'old search', hash: 'old-hash' }),
    ]);
    await broker.applyToolListSnapshot(
      'brave_search',
      [brokeredSearchSnapshot({ description: 'new search', hash: 'new-hash', required: ['query'] })],
      { interactive: false, traceId: 'trace-autonomous' }
    );

    expect(driftCallback).not.toHaveBeenCalled();
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        type: 'mcp_broker_tofu_blocked',
        server: 'brave_search',
        tool: 'web_search',
        status: 'blocked_on_user',
        trace_id: 'trace-autonomous',
      })
    );
  });

  it('surfaces all same-server pending drifts as one bundled needs_user_input payload', async () => {
    const pending = [driftPayload('web_search'), driftPayload('image_search')];
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(),
      listToolsForConsumer: vi.fn(async () => []),
      getPendingSchemaDrift: vi.fn(() => pending),
      resolveSchemaDrift: vi.fn(() => []),
      shutdown: vi.fn(),
    };
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search', 'image_search'] }],
    });

    await expect(
      result.registry.brave_search.tools.web_search({ query: 'x' }, {} as Parameters<ToolFn>[1])
    ).rejects.toMatchObject({
      name: 'MacroNeedsUserInputError',
      payload: {
        event: 'schema_drift_detected',
        server: 'brave_search',
        changes: pending,
      },
    });
  });

  it('does not emit needs_user_input for pending drift in a non-interactive delegated macro context', async () => {
    const pending = [driftPayload('web_search')];
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(),
      listToolsForConsumer: vi.fn(async () => []),
      getPendingSchemaDrift: vi.fn(() => pending),
      resolveSchemaDrift: vi.fn(() => []),
      shutdown: vi.fn(),
    };
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'delegated', purposeName: 'research', interactive: false },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    await expect(
      result.registry.brave_search.tools.web_search({ query: 'x' }, {} as Parameters<ToolFn>[1])
    ).rejects.toMatchObject({
      name: 'MacroExpectedError',
      error: 'tool_unavailable_pending_user_decision',
    });
  });

  it('returns unknown_tool when a brokered macro ref is not visible and has no pending drift', async () => {
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(),
      listToolsForConsumer: vi.fn(async () => []),
      getPendingSchemaDrift: vi.fn(() => []),
      resolveSchemaDrift: vi.fn(() => []),
      shutdown: vi.fn(),
    };
    const result = await buildToolRegistry({
      config: makeConfig(),
      callerContext: {
        origin: 'host',
        consumerContext: { kind: 'host', traceId: 'trace-hidden', interactive: true },
      },
      broker,
      catalog,
      nativeDispatchContext: nativeDispatchContext(),
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    await expect(
      result.registry.brave_search.tools.web_search({ query: 'x' }, {} as Parameters<ToolFn>[1])
    ).rejects.toMatchObject({
      name: 'MacroExpectedError',
      error: 'unknown_tool',
      details: {
        server: 'brave_search',
        tool: 'web_search',
      },
    });
    expect(broker.callTool).not.toHaveBeenCalled();
  });

  it('preserves host trace scope across nested fq.call_macro re-entry', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: '{"ok":true}' }],
      structuredContent: { ok: true },
    }));
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool,
      listToolsForConsumer: vi.fn(async () => [brokeredSearchTool()]),
      getPendingSchemaDrift: vi.fn(() => []),
      resolveSchemaDrift: vi.fn(() => []),
      shutdown: vi.fn(),
    };
    const config = makeConfig();
    let nestedCallMacro!: NativeToolDefinition;
    nestedCallMacro = nativeTool('call_macro', async (args, context) => {
      const callerContext = (context as NativeToolDispatchContext & { macroCallerContext?: MacroCallerContext }).macroCallerContext;
      const nested = await runMacroSource({
        source: String(args.source ?? ''),
        callerContext,
        config,
        catalog: [nestedCallMacro],
        broker,
        nativeDispatchContext: context,
        brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
      });
      return nested.result;
    }, z.object({ source: z.string() }));

    const result = await runMacroSource({
      source: 'exit fq.call_macro({ source: "brave_search.web_search({})" })',
      callerContext: { origin: 'host' },
      config,
      catalog: [nestedCallMacro],
      broker,
      nativeDispatchContext: { ...nativeDispatchContext(), traceId: 'outer-host-trace' },
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    expect(result.result.isError).not.toBe(true);
    expect(callTool).toHaveBeenCalledWith(
      { serverId: 'brave_search', toolName: 'web_search' },
      {},
      { kind: 'host', traceId: 'outer-host-trace', interactive: true }
    );
  });

  it('preserves delegated autonomous interactive false across nested fq.call_macro pending drift', async () => {
    const pending = [driftPayload('web_search')];
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool: vi.fn(),
      listToolsForConsumer: vi.fn(async () => []),
      getPendingSchemaDrift: vi.fn(() => pending),
      resolveSchemaDrift: vi.fn(() => []),
      shutdown: vi.fn(),
    };
    const config = makeConfig();
    let nestedCallMacro!: NativeToolDefinition;
    nestedCallMacro = nativeTool('call_macro', async (args, context) => {
      const callerContext = (context as NativeToolDispatchContext & { macroCallerContext?: MacroCallerContext }).macroCallerContext;
      const nested = await runMacroSource({
        source: String(args.source ?? ''),
        callerContext,
        config,
        catalog: [nestedCallMacro],
        broker,
        nativeDispatchContext: context,
        brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
      });
      return nested.result;
    }, z.object({ source: z.string() }));

    const result = await runMacroSource({
      source: 'exit fq.call_macro({ source: "brave_search.web_search({})" })',
      callerContext: { origin: 'delegated', purposeName: 'research', interactive: false },
      config,
      catalog: [nestedCallMacro],
      broker,
      nativeDispatchContext: { ...nativeDispatchContext(), traceId: 'delegated-autonomous-trace' },
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    expect(result.result.isError).not.toBe(true);
    expect(parseToolPayload(result.result)).toMatchObject({
      result: {
        error: 'tool_unavailable_pending_user_decision',
      },
    });
    expect(JSON.stringify(parseToolPayload(result.result))).not.toContain('needs_user_input');
  });

  it('keeps host-only broker servers hidden from nested delegated fq.call_macro', async () => {
    const callTool = vi.fn();
    const broker: Broker = {
      ensureConnected: vi.fn(),
      isConnected: vi.fn(),
      callTool,
      listToolsForConsumer: vi.fn(async (ctx: ConsumerContext) =>
        ctx.kind === 'purpose' ? [brokeredSearchTool()] : [
          {
            serverId: 'host_only',
            toolName: 'web',
            registryKey: 'host_only__web',
            description: 'Host only',
            inputSchema: { type: 'object' },
            tofuHash: 'hash-host-only',
            costPerCall: 0,
          },
        ]
      ),
      getPendingSchemaDrift: vi.fn(() => []),
      resolveSchemaDrift: vi.fn(() => []),
      shutdown: vi.fn(),
    };
    const config = makeConfig({
      host: { mcpServers: ['host_only'] },
      llm: {
        providers: [],
        models: [],
        purposes: [{
          name: 'research',
          description: 'Research purpose',
          models: [],
          tools: ['call_macro'],
          mcpServers: ['brave_search'],
        }],
      },
    } as Partial<FlashQueryConfig>);
    let nestedCallMacro!: NativeToolDefinition;
    nestedCallMacro = nativeTool('call_macro', async (args, context) => {
      const callerContext = (context as NativeToolDispatchContext & { macroCallerContext?: MacroCallerContext }).macroCallerContext;
      const nested = await runMacroSource({
        source: String(args.source ?? ''),
        callerContext,
        config,
        catalog: [nestedCallMacro],
        broker,
        nativeDispatchContext: context,
        brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
      });
      return nested.result;
    }, z.object({ source: z.string() }));

    const result = await runMacroSource({
      source: 'exit fq.call_macro({ source: "host_only.web({})" })',
      callerContext: { origin: 'delegated', purposeName: 'research', interactive: false },
      config,
      catalog: [nestedCallMacro],
      broker,
      nativeDispatchContext: { ...nativeDispatchContext(), traceId: 'delegated-hidden-trace' },
      brokerTools: [{ server: 'brave_search', label: 'Brave Search', tools: ['web_search'] }],
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(parseToolPayload(result.result)).toMatchObject({
      result: {
        error: 'unknown_server',
        details: {
          server: 'host_only',
        },
      },
    });
  });
});
