import { describe, expect, it, vi } from 'vitest';
import type { Broker, BrokeredTool, ConsumerContext } from '../../../src/services/mcp-broker/index.js';
import type { NativeToolDefinition } from '../../../src/llm/tool-registry.js';
import { clearBrokerAuditTrace, getBrokerAuditTraceSnapshot } from '../../../src/services/mcp-broker/trace.js';
import { createSearchToolsHandler } from '../../../src/services/tool-search/search-tools-handler.js';
import { ToolSearchService } from '../../../src/services/tool-search/tool-search-service.js';
import { DEFAULT_HELP_HINT, type ToolMeta } from '../../../src/services/tool-search/tool-meta.js';

function nativeTool(overrides: Partial<NativeToolDefinition> = {}): NativeToolDefinition {
  return {
    name: 'get_document',
    description: 'Retrieve a markdown document by path or id.',
    inputSchema: {
      identifier: { type: 'string', description: 'Document path or ID.' },
    },
    handler: vi.fn(),
    ...overrides,
  };
}

function toolMeta(overrides: Partial<ToolMeta> = {}): ToolMeta {
  return {
    name: 'get_document',
    description: 'Read vault documents by identifier. Pass {help: true} for full help.',
    helpHint: DEFAULT_HELP_HINT,
    helpPageBody: 'Full help.',
    tier: 'read-only',
    args: {
      identifier: 'Document path or ID.',
    },
    filePath: 'src/mcp/tools/get_document.tool.md',
    ...overrides,
  };
}

function brokeredTool(overrides: Partial<BrokeredTool> = {}): BrokeredTool {
  return {
    serverId: 'basic',
    toolName: 'echo',
    registryKey: 'basic__echo',
    description: 'Override: repeat text for diagnostics.',
    upstreamDescription: 'Echo a value.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Value to echo.' },
      },
      required: ['value'],
      additionalProperties: false,
    },
    tofuHash: 'hash-basic-echo',
    costPerCall: 0,
    ...overrides,
  };
}

function makeBroker(tools: BrokeredTool[]): Broker {
  return {
    ensureConnected: vi.fn(),
    callTool: vi.fn(),
    isConnected: vi.fn(async () => false),
    listToolsForConsumer: vi.fn(async (_ctx: ConsumerContext) => tools),
    getPendingSchemaDrift: vi.fn(() => []),
    resolveSchemaDrift: vi.fn(() => []),
    shutdown: vi.fn(),
  };
}

describe('fq.search_tools handler', () => {
  it('returns native SearchResult envelopes with downstream metadata and help hints', async () => {
    const consumerContext: ConsumerContext = {
      kind: 'purpose',
      purposeId: 'research',
      traceId: 'trace-native',
      interactive: false,
    };
    const service = await ToolSearchService.buildForConsumer({
      nativeToolCatalog: [nativeTool()],
      nativeToolNames: ['get_document'],
      consumerContext,
      toolMeta: new Map([['get_document', toolMeta()]]),
    });
    const handler = createSearchToolsHandler({ service, consumerContext });

    const response = await handler({ query: 'read vault document', limit: 3 }, {
      signal: new AbortController().signal,
      traceId: 'trace-native',
      instanceId: 'test',
    });
    const results = JSON.parse(response.content[0]?.text ?? 'null');

    expect(results).toEqual([
      expect.objectContaining({
        server: 'flashquery',
        tool: 'get_document',
        registry_key: 'get_document',
        description: 'Read vault documents by identifier. Pass {help: true} for full help.',
        has_help: true,
        help_hint: DEFAULT_HELP_HINT,
        score: expect.any(Number),
        normalizedScore: expect.any(Number),
        arg_summary: [
          expect.objectContaining({ name: 'identifier', description: 'Document path or ID.', required: false }),
        ],
      }),
    ]);
  });

  it('defaults arg_summary description and required fields when schema metadata is absent', async () => {
    const consumerContext: ConsumerContext = {
      kind: 'purpose',
      purposeId: 'research',
      traceId: 'trace-arg-defaults',
      interactive: true,
    };
    const service = await ToolSearchService.buildForConsumer({
      nativeToolCatalog: [],
      nativeToolNames: [],
      broker: makeBroker([brokeredTool({
        description: 'Repeat diagnostics with bare schema metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      })]),
      consumerContext,
      toolMeta: new Map(),
    });

    const [result] = service.search('bare schema metadata', 1);

    expect(result?.arg_summary).toEqual([
      { name: 'value', description: '', required: false },
    ]);
  });

  it('returns brokered SearchResult envelopes with override descriptions and no native help hint', async () => {
    const consumerContext: ConsumerContext = {
      kind: 'purpose',
      purposeId: 'research',
      traceId: 'trace-brokered',
      interactive: true,
    };
    const service = await ToolSearchService.buildForConsumer({
      nativeToolCatalog: [],
      nativeToolNames: [],
      broker: makeBroker([brokeredTool()]),
      consumerContext,
      toolMeta: new Map(),
    });
    const handler = createSearchToolsHandler({ service, consumerContext });

    const response = await handler({ query: 'repeat diagnostics', limit: 8 }, {
      signal: new AbortController().signal,
      traceId: 'trace-brokered',
      instanceId: 'test',
    });
    const results = JSON.parse(response.content[0]?.text ?? 'null');

    expect(results).toEqual([
      expect.objectContaining({
        server: 'basic',
        tool: 'echo',
        registry_key: 'basic__echo',
        description: 'Override: repeat text for diagnostics.',
        has_help: false,
        score: expect.any(Number),
        normalizedScore: expect.any(Number),
      }),
    ]);
    expect(results[0]).not.toHaveProperty('help_hint');
    expect(results[0].description).not.toBe('Echo a value.');
  });

  it('returns [] for empty corpus and records sanitized timestamped search audit', async () => {
    clearBrokerAuditTrace();
    const consumerContext: ConsumerContext = {
      kind: 'purpose',
      purposeId: 'research',
      traceId: 'trace-empty',
      interactive: false,
    };
    const service = await ToolSearchService.buildForConsumer({
      nativeToolCatalog: [],
      nativeToolNames: [],
      consumerContext,
      toolMeta: new Map(),
    });
    const handler = createSearchToolsHandler({ service, consumerContext });

    const response = await handler({ query: 'anything' }, {
      signal: new AbortController().signal,
      traceId: 'trace-empty',
      instanceId: 'test',
    });

    expect(JSON.parse(response.content[0]?.text ?? 'null')).toEqual([]);
    expect(getBrokerAuditTraceSnapshot()).toEqual([
      expect.objectContaining({
        ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        type: 'mcp_broker_search_tools',
        consumer: 'purpose:research',
        purpose_id: 'research',
        query: 'anything',
        result_count: 0,
        latency_us: expect.any(Number),
        trace_id: 'trace-empty',
      }),
    ]);
    expect(JSON.stringify(getBrokerAuditTraceSnapshot())).not.toMatch(/arguments|result_payload|content/);
  });

  it('filters host index sink updates to host-visible brokered servers', () => {
    const service = ToolSearchService.createEmpty();
    const sink = service.createHostIndexSink(['basic']);

    sink.addTools([
      brokeredTool({ serverId: 'basic', registryKey: 'basic__echo' }),
      brokeredTool({
        serverId: 'hidden',
        registryKey: 'hidden__echo',
        description: 'Classified quarantine utility.',
      }),
    ]);

    expect(service.search('repeat diagnostics', 5)).toEqual([
      expect.objectContaining({ registry_key: 'basic__echo' }),
    ]);
    expect(service.search('classified quarantine', 5)).toEqual([]);

    sink.removeTools(['hidden__echo']);
    expect(service.search('repeat diagnostics', 5)).toEqual([
      expect.objectContaining({ registry_key: 'basic__echo' }),
    ]);

    sink.removeTools(['basic__echo']);
    expect(service.search('repeat diagnostics', 5)).toEqual([]);
  });
});
