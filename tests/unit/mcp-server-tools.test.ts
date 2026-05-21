import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { registerHostBrokeredTools } from '../../src/mcp/host-brokered-tools.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import { registerPendingReviewTools } from '../../src/mcp/tools/pending-review.js';
import { registerFileTools } from '../../src/mcp/tools/files.js';
import { registerLlmTools } from '../../src/mcp/tools/llm.js';
import { registerLlmUsageTools } from '../../src/mcp/tools/llm-usage.js';
import { registerMacroTools } from '../../src/mcp/tools/macro.js';
import { getNativeToolCatalog, wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import { initLogger } from '../../src/logging/logger.js';
import {
  assertRegisteredToolsHaveMetadata,
  requireToolMetadata,
} from '../../src/mcp/tool-metadata.js';
import { resolveHostToolExposure } from '../../src/mcp/tool-exposure.js';
import {
  clearBrokeredToolCallTrace,
  getBrokeredToolCallTraceSnapshot,
  type Broker,
  type BrokeredTool,
  type BrokerToolRef,
  type ConsumerContext,
  type SchemaDriftDecisionInput,
  type SchemaDriftResolution,
  type TofuDriftPayload,
  type ToolListSnapshotOptions,
} from '../../src/services/mcp-broker.js';

const mockConfig: FlashQueryConfig = {
  instance: { id: 'test', vault: { path: '/tmp/vault' } },
  supabase: { url: 'http://localhost:54321', serviceRoleKey: 'test-key', databaseUrl: 'postgresql://localhost' },
  mcp: { port: 3100 },
  embedding: { provider: 'openai', dimensions: 1536, openaiApiKey: 'test-key' },
  logging: { level: 'info', output: 'stderr' },
  locking: { enabled: false },
  trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
  mcpServers: {},
  host: { mcpServers: [], toolSearch: 'disabled' },
  macro: { defaultTimeoutMs: 60000 },
};

initLogger(mockConfig);

function makeCatalogServer(): McpServer {
  return wrapServerWithToolCatalog(new McpServer({ name: 'test', version: '0.1.0' }));
}

function makeMacroDispatchContext(signal = new AbortController().signal, instanceId = 'macro-unit-test'): Record<string, unknown> {
  return {
    signal,
    instanceId,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logContext: {},
  };
}

function registerAllCurrentTools(server: McpServer): void {
  registerMemoryTools(server, mockConfig);
  registerDocumentTools(server, mockConfig);
  registerPluginTools(server, mockConfig);
  registerRecordTools(server, mockConfig);
  registerCompoundTools(server, mockConfig);
  registerScanTools(server, mockConfig);
  registerPendingReviewTools(server, mockConfig);
  registerFileTools(server, mockConfig);
  registerLlmTools(server, mockConfig);
  registerLlmUsageTools(server, mockConfig);
  registerMacroTools(server, mockConfig);
}

function makeBrokeredTool(input: Partial<BrokeredTool> = {}): BrokeredTool {
  return {
    serverId: 'basic',
    toolName: 'echo',
    registryKey: 'basic__echo',
    description: 'Override echo description',
    upstreamDescription: 'Original echo description',
    inputSchema: {},
    tofuHash: 'hash-basic-echo',
    costPerCall: 0.25,
    ...input,
  };
}

function makeDrift(tool: string): TofuDriftPayload {
  return {
    event: 'schema_drift_detected',
    server: 'basic',
    tool,
    question: `Approve ${tool}?`,
    old_schema: { name: tool, inputSchema: {} },
    new_schema: { name: tool, inputSchema: { type: 'object' } },
    diff_summary: `${tool} changed`,
    options: ['approve', 'reject'],
    answer_shape: 'approve|reject',
  };
}

function makeMockBroker(options: {
  visibleTools?: BrokeredTool[];
  callResult?: CallToolResult;
  callError?: unknown;
  pendingDrifts?: TofuDriftPayload[];
} = {}): Broker & {
  listToolsForConsumer: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  getPendingSchemaDrift: ReturnType<typeof vi.fn>;
} {
  const visibleTools = options.visibleTools ?? [];
  return {
    ensureConnected: vi.fn(async (_serverId: string, _options?: ToolListSnapshotOptions) => undefined),
    listToolsForConsumer: vi.fn(async (_ctx: ConsumerContext) => visibleTools),
    callTool: vi.fn(async (_ref: BrokerToolRef, _args: unknown, _ctx: ConsumerContext) => {
      if (options.callError !== undefined) throw options.callError;
      return options.callResult ?? { content: [{ type: 'text' as const, text: 'ok' }] };
    }),
    isConnected: vi.fn(async () => true),
    getPendingSchemaDrift: vi.fn((_ctx?: { traceId?: string; purposeId?: string }) => options.pendingDrifts ?? []),
    resolveSchemaDrift: vi.fn((_decisions: SchemaDriftDecisionInput[]) => [] as SchemaDriftResolution[]),
    shutdown: vi.fn(async () => undefined),
  };
}

function makeCapturingServer(): McpServer & {
  registerTool: ReturnType<typeof vi.fn>;
} {
  return {
    registerTool: vi.fn(),
  } as unknown as McpServer & { registerTool: ReturnType<typeof vi.fn> };
}

describe('MCP tool registration metadata', () => {
  it('keeps host-disabled tools in the native catalog while skipping SDK registration', () => {
    const originalRegisterTool = vi.fn();
    const server = wrapServerWithToolCatalog({
      registerTool: originalRegisterTool,
    } as unknown as McpServer, { hostEnabledToolNames: new Set(['get_document']) });

    server.registerTool('get_document', { description: 'Get document', inputSchema: {} }, vi.fn() as never);
    server.registerTool('write_memory', { description: 'Write memory', inputSchema: {} }, vi.fn() as never);

    expect(getNativeToolCatalog(server).map((tool) => tool.name)).toEqual(['get_document', 'write_memory']);
    expect(originalRegisterTool).toHaveBeenCalledTimes(1);
    expect(originalRegisterTool).toHaveBeenCalledWith('get_document', expect.any(Object), expect.any(Function));
  });

  it('registers all modules against a full native catalog while SDK registration stays host-filtered', () => {
    const server = wrapServerWithToolCatalog(
      new McpServer({ name: 'test', version: '0.1.0' }),
      { hostEnabledToolNames: new Set(resolveHostToolExposure({ tools: ['category:doc-read'] }).hostEnabledToolNames) }
    );

    registerAllCurrentTools(server);

    const names = getNativeToolCatalog(server).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['get_document', 'list_vault']));
    expect(names).toEqual(expect.arrayContaining(['write_memory', 'write_document', 'call_model']));
  });

  it('registers current tool modules into the native catalog', () => {
    const server = makeCatalogServer();

    expect(() => registerAllCurrentTools(server)).not.toThrow();

    const catalog = getNativeToolCatalog(server);
    const registeredNames = catalog.map((tool) => tool.name);

    expect(registeredNames).toContain('get_document');
    expect(registeredNames).toContain('call_model');
    expect(registeredNames).toContain('call_macro');
    expect(registeredNames).toContain('list_vault');
    expect(registeredNames).not.toContain('get_doc_outline');
    expect(registeredNames).not.toContain('list_projects');
    expect(registeredNames).not.toContain('get_project_info');
  });

  it('T-U-230 invokes registerMacroTools from createMcpServer before schema validation', () => {
    const server = createMcpServer(mockConfig, '0.1.0');
    const names = getNativeToolCatalog(server).map((tool) => tool.name);

    expect(names).toContain('get_llm_usage');
    expect(names).toContain('call_macro');
    expect(names.indexOf('call_macro')).toBeGreaterThan(names.indexOf('get_llm_usage'));
  });

  it('has central metadata for every currently registered native tool', () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);
    const catalog = getNativeToolCatalog(server);

    expect(() => assertRegisteredToolsHaveMetadata(catalog)).not.toThrow();
  });

  it('registers call_macro with inline production evaluator execution', async () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    expect(callMacro).toBeDefined();

    const result = await callMacro?.handler({ source: 'exit "hello"' }, makeMacroDispatchContext() as never);
    expect(result?.isError).toBeUndefined();
    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({
      result: 'hello',
    });
  });

  it('rejects call_macro requests that provide both source and source_ref as invalid input', async () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    expect(callMacro).toBeDefined();

    const result = await callMacro?.handler({
      source: 'exit "hello"',
      source_ref: '@doc#macro',
    }, {} as never);
    expect(result?.isError).toBeFalsy();
    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'exactly_one_required' },
    });
  });

  it('T-U-166 wires production template metadata into call_macro hard-exclusion prescan', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'fq-macro-template-'));
    await mkdir(join(vaultRoot, 'Templates'), { recursive: true });
    await writeFile(
      join(vaultRoot, 'Templates', 'Research Skill.md'),
      [
        '---',
        'fq_template: true',
        'fq_expose_as_tool: true',
        'fq_namespace: skill',
        'fq_desc: Research skill',
        'fq_params:',
        '  topic:',
        '    type: string',
        '    required: true',
        '---',
        '',
        'Research {{topic}}',
      ].join('\n'),
      'utf8'
    );
    const server = makeCatalogServer();
    const config = {
      ...mockConfig,
      instance: {
        id: 'macro-template-hard-exclusion-test',
        name: 'Macro Template Hard Exclusion Test',
        vault: { path: vaultRoot, markdownExtensions: ['.md'] },
      },
      templates: { defaultAccess: 'permissive' },
      hostMcpTools: { tools: ['call_macro'] },
    } as FlashQueryConfig;
    delete (config as Partial<FlashQueryConfig>).supabase;
    registerMacroTools(server, config);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    const result = await callMacro?.handler({
      source: 'exit fq.flashquery_skill_research_skill({ topic: "dispatch" })',
    }, makeMacroDispatchContext(new AbortController().signal, config.instance.id) as never);

    expect(result?.isError).toBeFalsy();
    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({
      error: 'template_masquerade_tools_not_callable_from_macro',
      details: {
        server: 'fq',
        tool: 'flashquery_skill_research_skill',
      },
    });
  });

  it('threads the MCP request signal into native macro tool dispatch context', async () => {
    const server = makeCatalogServer();
    const requestController = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    server.registerTool('search', { description: 'Search', inputSchema: {} }, vi.fn(async (_args, context) => {
      capturedSignal = context.signal;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
    }) as never);
    registerMacroTools(server, {
      ...mockConfig,
      hostMcpTools: { tools: ['search', 'call_macro'] },
    } as FlashQueryConfig);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    const result = await callMacro?.handler(
      { source: 'exit fq.search({})' },
      makeMacroDispatchContext(requestController.signal, 'macro-signal-test') as never
    );

    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({ result: { ok: true } });
    expect(capturedSignal).toBe(requestController.signal);
    requestController.abort();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('uses metadata descriptions for the registered native catalog', () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);
    const catalog = getNativeToolCatalog(server);

    for (const tool of catalog) {
      const metadata = requireToolMetadata(tool.name);

      expect(tool.description.trim(), `${tool.name} registered description`).not.toBe('');
      expect(tool.description, `${tool.name} registered description`).toBe(metadata.description);
      expect(metadata.hostEligible, `${tool.name} should be host eligible while registered`).toBe(true);
      expect(tool.description, `${tool.name} registered description`).toContain('Summary:');
      expect(tool.description, `${tool.name} registered description`).toContain('Use when:');
      expect(tool.description, `${tool.name} registered description`).toContain('Do not use when:');
      expect(tool.description, `${tool.name} registered description`).toContain('Example:');
    }
  });
});

describe('host brokered tool registration', () => {
  it('registers zero brokered tools when host config has no mcp servers', async () => {
    const server = makeCapturingServer();
    const broker = makeMockBroker({ visibleTools: [makeBrokeredTool()] });

    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: [], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-empty-host',
    });

    expect(broker.listToolsForConsumer).not.toHaveBeenCalled();
    expect(server.registerTool).not.toHaveBeenCalled();
  });

  it('rejects a hidden guessed registry key without calling the brokered tool', async () => {
    const server = makeCapturingServer();
    const broker = makeMockBroker({ visibleTools: [makeBrokeredTool()] });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-hidden',
    });
    broker.listToolsForConsumer.mockResolvedValueOnce([]);

    const handler = server.registerTool.mock.calls[0]?.[2] as (args: unknown, extra: unknown) => Promise<CallToolResult>;
    const result = await handler({ text: 'hello' }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain("Tool 'basic__echo' is not available.");
    expect(broker.callTool).not.toHaveBeenCalled();
  });

  it('records one trace entry after returned brokered results, including upstream error results', async () => {
    clearBrokeredToolCallTrace('trace-returned-error');
    const server = makeCapturingServer();
    const broker = makeMockBroker({
      visibleTools: [makeBrokeredTool()],
      callResult: { content: [{ type: 'text' as const, text: 'upstream failed' }], isError: true },
    });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-returned-error',
    });

    const handler = server.registerTool.mock.calls[0]?.[2] as (args: unknown, extra: unknown) => Promise<CallToolResult>;
    const result = await handler({ text: 'hello' }, {});

    expect(result.isError).toBe(true);
    expect(broker.callTool).toHaveBeenCalledTimes(1);
    expect(getBrokeredToolCallTraceSnapshot('trace-returned-error')).toEqual([
      {
        trace_id: 'trace-returned-error',
        consumer_kind: 'host',
        server: 'basic',
        tool: 'echo',
        count: 1,
        cost: 0.25,
      },
    ]);
  });

  it('preserves dynamic object arguments for brokered tools that allow additional properties', async () => {
    const server = makeCapturingServer();
    const broker = makeMockBroker({
      visibleTools: [
        makeBrokeredTool({
          inputSchema: {
            type: 'object',
            additionalProperties: true,
          },
        }),
      ],
    });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-dynamic-args',
    });
    const registrationConfig = server.registerTool.mock.calls[0]?.[1] as {
      inputSchema: { safeParse(input: unknown): { success: boolean; data?: unknown } };
    };
    const dynamicArgs = { arbitrary: 'value', nested: { ok: true } };

    expect(registrationConfig.inputSchema.safeParse(dynamicArgs)).toEqual({
      success: true,
      data: dynamicArgs,
    });

    const handler = server.registerTool.mock.calls[0]?.[2] as (args: unknown, extra: unknown) => Promise<CallToolResult>;
    await handler(dynamicArgs, {});

    expect(broker.callTool).toHaveBeenCalledWith(
      { serverId: 'basic', toolName: 'echo' },
      dynamicArgs,
      expect.objectContaining({ kind: 'host' })
    );
  });

  it('preserves extra object arguments when brokered JSON Schema omits additionalProperties', async () => {
    const server = makeCapturingServer();
    const broker = makeMockBroker({
      visibleTools: [
        makeBrokeredTool({
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        }),
      ],
    });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-default-extra-args',
    });
    const registrationConfig = server.registerTool.mock.calls[0]?.[1] as {
      inputSchema: { safeParse(input: unknown): { success: boolean; data?: unknown } };
    };
    const args = { text: 'hello', dynamic: { preserved: true } };

    expect(registrationConfig.inputSchema.safeParse(args)).toEqual({
      success: true,
      data: args,
    });

    const handler = server.registerTool.mock.calls[0]?.[2] as (args: unknown, extra: unknown) => Promise<CallToolResult>;
    await handler(args, {});

    expect(broker.callTool).toHaveBeenCalledWith(
      { serverId: 'basic', toolName: 'echo' },
      args,
      expect.objectContaining({ kind: 'host' })
    );
  });

  it('rejects extra object arguments when brokered JSON Schema sets additionalProperties false', async () => {
    const server = makeCapturingServer();
    const broker = makeMockBroker({
      visibleTools: [
        makeBrokeredTool({
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
        }),
      ],
    });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-strict-extra-args',
    });
    const registrationConfig = server.registerTool.mock.calls[0]?.[1] as {
      inputSchema: { safeParse(input: unknown): { success: boolean; data?: unknown } };
    };

    expect(registrationConfig.inputSchema.safeParse({ text: 'hello', dynamic: true }).success).toBe(false);
    expect(registrationConfig.inputSchema.safeParse({ text: 'hello' })).toEqual({
      success: true,
      data: { text: 'hello' },
    });
  });

  it('returns sanitized errors for thrown broker failures without recording tool-call cost', async () => {
    clearBrokeredToolCallTrace('trace-thrown');
    const server = makeCapturingServer();
    const broker = makeMockBroker({
      visibleTools: [makeBrokeredTool()],
      callError: Object.assign(new Error('spawn ENOENT secret-stderr-buffer'), {
        raw: { stderr: 'do-not-leak' },
      }),
    });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-thrown',
    });

    const handler = server.registerTool.mock.calls[0]?.[2] as (args: unknown, extra: unknown) => Promise<CallToolResult>;
    const result = await handler({ text: 'hello' }, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('secret-stderr-buffer');
    expect(result.content[0]?.text).not.toContain('do-not-leak');
    expect(getBrokeredToolCallTraceSnapshot('trace-thrown')).toEqual([]);
  });

  it('returns one bundled schema_drift_detected payload for multiple same-server pending drifts', async () => {
    const server = makeCapturingServer();
    const broker = makeMockBroker({
      visibleTools: [makeBrokeredTool()],
      pendingDrifts: [makeDrift('echo'), makeDrift('reverse'), { ...makeDrift('other'), server: 'other' }],
    });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-drift',
    });
    broker.listToolsForConsumer.mockResolvedValueOnce([]);

    const handler = server.registerTool.mock.calls[0]?.[2] as (args: unknown, extra: unknown) => Promise<CallToolResult>;
    const result = await handler({ text: 'hello' }, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
      reason?: string;
      payload?: { event?: string; changes?: unknown[] };
    };

    expect(result.isError).toBe(true);
    expect(payload.reason).toBe('needs_user_input');
    expect(payload.payload?.event).toBe('schema_drift_detected');
    expect(payload.payload?.changes).toHaveLength(2);
    expect(broker.callTool).not.toHaveBeenCalled();
  });

  it('records host brokered calls under a default host trace when no session id is available', async () => {
    clearBrokeredToolCallTrace('host:default');
    const server = makeCapturingServer();
    const broker = makeMockBroker({ visibleTools: [makeBrokeredTool()] });
    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
    });

    const handler = server.registerTool.mock.calls[0]?.[2] as (args: unknown, extra: unknown) => Promise<CallToolResult>;
    await handler({ text: 'hello' }, {});

    expect(getBrokeredToolCallTraceSnapshot('host:default')).toEqual([
      {
        trace_id: 'host:default',
        consumer_kind: 'host',
        server: 'basic',
        tool: 'echo',
        count: 1,
        cost: 0.25,
      },
    ]);
  });

  it('registers the brokered description override and never the upstream description', async () => {
    const server = makeCapturingServer();
    const broker = makeMockBroker({
      visibleTools: [
        makeBrokeredTool({
          description: 'Override description from config',
          upstreamDescription: 'Original upstream description',
        }),
      ],
    });

    await registerHostBrokeredTools(server, {
      broker,
      hostConfig: { mcpServers: ['basic'], toolSearch: 'disabled' },
      traceIdProvider: () => 'trace-description',
    });

    expect(server.registerTool).toHaveBeenCalledWith(
      'basic__echo',
      expect.objectContaining({ description: 'Override description from config' }),
      expect.any(Function)
    );
    expect(JSON.stringify(server.registerTool.mock.calls)).not.toContain('Original upstream description');
  });
});
