import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import { createMcpServer } from '../../../src/mcp/server.js';
import { executeAgentLoop } from '../../../src/llm/agent-loop.js';
import { dispatchToolCalls } from '../../../src/llm/tool-dispatcher.js';
import type { LlmChatMessage, LlmChatResult } from '../../../src/llm/types.js';
import { getNativeToolCatalog } from '../../../src/mcp/tool-catalog.js';
import { createBroker, hashToolSchema, type Broker, type BrokerClientConfig, type McpBroker } from '../../../src/services/mcp-broker/index.js';
import { clearBrokerAuditTrace, getBrokerAuditTraceSnapshot } from '../../../src/services/mcp-broker/trace.js';
import { PureBM25Indexer, type ToolSearchDocument } from '../../../src/services/tool-search/indexer.js';
import { createSearchToolsHandler } from '../../../src/services/tool-search/search-tools-handler.js';
import { ToolSearchService, type SearchResult } from '../../../src/services/tool-search/tool-search-service.js';
import { loadToolMeta, loadToolMetaSync, validateToolMeta } from '../../../src/services/tool-search/tool-meta.js';

type RankingFixture = {
  id: number;
  category: 'obvious' | 'oblique' | 'adversarial' | 'recall_stress';
  query: string;
  relevant_tools: Array<{ server: string; tool: string }>;
};

type CallMacroFixture = {
  id: string;
  category: 'single_shot' | 'compound' | 'borderline' | 'out_of_scope';
  query: string;
  expected_top_tool?: { server: string; tool: string };
  expected_call_macro_top?: boolean;
  call_macro_should_not_be_top?: boolean;
};

const fixtureDir = resolve(fileURLToPath(new URL('../../fixtures', import.meta.url)));
const mcpFixtureDir = resolve(fileURLToPath(new URL('../../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(mcpFixtureDir, 'server-basic.ts');
const rankingFixtures = JSON.parse(readFileSync(resolve(fixtureDir, 'tool-search/queries.json'), 'utf8')) as { queries: RankingFixture[] };
const callMacroFixtures = JSON.parse(readFileSync(resolve(fixtureDir, 'tool-search/queries-call-macro.json'), 'utf8')) as { queries: CallMacroFixture[] };
const brokers: Broker[] = [];

afterEach(async () => {
  clearBrokerAuditTrace();
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
});

function makeConfig(overrides: Partial<FlashQueryConfig> = {}): FlashQueryConfig {
  return {
    instance: {
      name: 'Search Tools Integration',
      id: 'search-tools-integration',
      vault: { path: '/tmp/flashquery-search-tools-integration', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'test', databaseUrl: 'postgres://test', skipDdl: true },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio', tokenLifetime: 24 },
    locking: { enabled: false, ttlSeconds: 30 },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    llm: {
      providers: [],
      models: [],
      purposes: [],
    },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
    macro: { defaultTimeoutMs: 60000 },
    ...overrides,
  } as FlashQueryConfig;
}

function basicConfig(overrides: Partial<BrokerClientConfig> = {}): BrokerClientConfig {
  return {
    serverId: 'basic',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', basicServer],
    env: {},
    costPerCall: 0.005,
    perCallTimeoutMs: 30000,
    toolOverrides: {},
    ...overrides,
  };
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('Expected text MCP content.');
  return first.text;
}

function searchResultsFrom(result: CallToolResult): SearchResult[] {
  return JSON.parse(textOf(result)) as SearchResult[];
}

async function withClient<T>(config: FlashQueryConfig, fn: (client: Client, broker: McpBroker) => Promise<T>): Promise<T> {
  const broker = createBroker(config);
  brokers.push(broker);
  const server = createMcpServer(config, 'test', { broker });
  const client = new Client({ name: 'search-tools-integration', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return await fn(client, broker);
  } finally {
    await client.close().catch(() => undefined);
    await serverTransport.close().catch(() => undefined);
  }
}

function parseCorpusDocuments(path: string): ToolSearchDocument[] {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\n/);
  const documents: ToolSearchDocument[] = [];
  let server = '';

  for (let index = 0; index < lines.length; index++) {
    const serverMatch = lines[index]?.match(/^## Server: (.+)$/);
    if (serverMatch) {
      server = serverMatch[1];
      continue;
    }

    const toolMatch = lines[index]?.match(/^### Tool: (.+)$/);
    if (!toolMatch) continue;
    const tool = toolMatch[1];
    const jsonStart = lines.indexOf('```json', index);
    const jsonEnd = lines.indexOf('```', jsonStart + 1);
    if (jsonStart < 0 || jsonEnd < 0) throw new Error(`Missing JSON schema block for ${server}/${tool}`);

    const parsed = JSON.parse(lines.slice(jsonStart + 1, jsonEnd).join('\n')) as {
      description?: string;
      inputSchema?: { properties?: Record<string, { description?: string }>; required?: string[] };
    };
    const properties = parsed.inputSchema?.properties ?? {};
    const required = new Set(parsed.inputSchema?.required ?? []);
    documents.push({
      server,
      tool,
      registry_key: server === 'flashquery' ? tool : `${server}__${tool}`,
      description: parsed.description ?? '',
      argNames: Object.keys(properties),
      arg_summary: Object.entries(properties).map(([name, property]) => ({
        name,
        description: property.description ?? '',
        required: required.has(name),
      })),
    });
    index = jsonEnd;
  }

  return documents;
}

function fixtureDocuments(): ToolSearchDocument[] {
  return [
    ...parseCorpusDocuments(resolve(fixtureDir, 'tool-search/corpus.md')),
    ...parseCorpusDocuments(resolve(fixtureDir, 'tool-search/corpus-flashquery.md')),
  ];
}

function firstRelevantRank(results: SearchResult[] | ToolSearchDocument[], relevantTools: RankingFixture['relevant_tools']): number {
  const index = results.findIndex((result) => relevantTools.some((relevant) => relevant.server === result.server && relevant.tool === result.tool));
  return index < 0 ? 0 : index + 1;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function syntheticDocuments(count: number): ToolSearchDocument[] {
  return Array.from({ length: count }, (_, index) => ({
    server: `server-${index % 17}`,
    tool: `diagnostic_tool_${index}`,
    registry_key: `server-${index % 17}__diagnostic_tool_${index}`,
    description: `Inspect diagnostic payload ${index} for vault document workflow search ranking and broker routing.`,
    argNames: ['query', 'limit', 'format'],
    arg_summary: [
      { name: 'query', description: 'Natural-language search query.', required: true },
      { name: 'limit', description: 'Maximum results to return.', required: false },
      { name: 'format', description: 'Output format selector.', required: false },
    ],
  }));
}

function chatResult(overrides: Partial<LlmChatResult> = {}): LlmChatResult {
  return {
    message: { role: 'assistant', content: 'done' },
    modelName: 'fast',
    providerName: 'mock',
    inputTokens: 10,
    outputTokens: 3,
    latencyMs: 5,
    finishReason: 'stop',
    ...overrides,
  };
}

describe('Phase C fq.search_tools integration', () => {
  it('T-I-033 registers fq.search_tools with the public MCP signature', async () => {
    const server = createMcpServer(makeConfig(), 'test');
    expect(getNativeToolCatalog(server)).toContainEqual(expect.objectContaining({
      name: 'search_tools',
      description: expect.stringMatching(/search/i),
      inputSchema: expect.objectContaining({
        query: expect.any(Object),
        limit: expect.any(Object),
      }),
    }));
  });

  it('T-I-034 and T-I-035 return the SearchResult envelope with native-only help metadata', async () => {
    const toolMeta = await loadToolMeta();
    const server = createMcpServer(makeConfig(), 'test');
    const service = await ToolSearchService.buildForConsumer({
      nativeToolCatalog: getNativeToolCatalog(server),
      nativeToolNames: ['get_document'],
      toolMeta,
      consumerContext: { kind: 'purpose', purposeId: 'research', traceId: 'trace-search-envelope', interactive: true },
    });
    const results = service.search('read vault document by path', 3);

    expect(results[0]).toMatchObject({
      server: 'flashquery',
      tool: 'get_document',
      registry_key: 'get_document',
      description: expect.stringContaining('Read'),
      arg_summary: expect.arrayContaining([
        expect.objectContaining({
          name: expect.any(String),
          description: expect.any(String),
          required: expect.any(Boolean),
        }),
      ]),
      score: expect.any(Number),
      normalizedScore: expect.any(Number),
      has_help: true,
      help_hint: expect.any(String),
    });
  });

  it('T-I-035 also omits FQ-native help hints from brokered results', async () => {
    const broker = createBroker({
      mcpServers: { basic: basicConfig() },
      host: { mcpServers: [] },
      llm: { purposes: [{ name: 'research', mcpServers: ['basic'] }] },
    });
    brokers.push(broker);
    const service = await ToolSearchService.buildForConsumer({
      nativeToolCatalog: [],
      nativeToolNames: [],
      broker,
      consumerContext: { kind: 'purpose', purposeId: 'research', traceId: 'trace-search-brokered', interactive: true },
    });
    const [result] = service.search('echo provided value', 1);

    expect(result).toMatchObject({
      server: 'basic',
      tool: 'echo',
      registry_key: 'basic__echo',
      arg_summary: expect.arrayContaining([
        expect.objectContaining({
          name: expect.any(String),
          description: expect.any(String),
          required: expect.any(Boolean),
        }),
      ]),
      has_help: false,
    });
    expect(result).not.toHaveProperty('help_hint');
  });

  it('T-I-035a preserves flat-list behavior for tool_search disabled purposes', async () => {
    const broker = createBroker({
      mcpServers: { basic: basicConfig() },
      host: { mcpServers: [] },
      llm: { purposes: [{ name: 'research', mcpServers: ['basic'] }] },
    });
    brokers.push(broker);
    const chat = vi.fn(async (_messages: LlmChatMessage[], parameters?: Record<string, unknown>) => {
      const toolNames = ((parameters?.['tools'] ?? []) as Array<{ function?: { name?: string } }>).map((tool) => tool.function?.name);
      expect(toolNames).toContain('basic__echo');
      expect(toolNames).toContain('get_document');
      expect(toolNames).toContain('search_tools');
      return chatResult();
    });

    await executeAgentLoop({
      purposeName: 'research',
      initialMessages: [{ role: 'user', content: 'flat tool list please' }],
      nativeToolNames: ['get_document', 'search_tools'],
      providerTools: [
        { type: 'function', function: { name: 'get_document', description: 'Get document', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'search_tools', description: 'Search tools', parameters: { type: 'object', properties: {} } } },
      ],
      nativeToolCatalog: [],
      broker,
      chat,
      toolSearch: 'disabled',
      recordUsage: vi.fn(),
      parameters: { max_iterations: 1 },
    });
  });

  it('T-I-036 and T-I-037 build a per-purpose index over visible FQ-native and brokered tools at engine init', async () => {
    const broker = createBroker({
      mcpServers: {
        basic: basicConfig({
          toolOverrides: {
            echo: { costPerCall: 0.01, descriptionOverride: 'High overlap diagnostic echo search target.' },
          },
        }),
      },
      host: { mcpServers: [] },
      llm: { purposes: [{ name: 'research', mcpServers: ['basic'] }] },
    });
    brokers.push(broker);
    const chat = vi.fn()
      .mockImplementationOnce(async (_messages: LlmChatMessage[], parameters?: Record<string, unknown>) => {
      expect(parameters?.['tools']).toEqual([
        expect.objectContaining({ function: expect.objectContaining({ name: 'search_tools' }) }),
      ]);
      return chatResult({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_search_tools',
            type: 'function',
            function: { name: 'search_tools', arguments: { query: 'diagnostic echo search target', limit: 5 } },
          }],
        },
        finishReason: 'tool_calls',
      });
    })
      .mockResolvedValueOnce(chatResult({ message: { role: 'assistant', content: 'final' }, finishReason: 'stop' }));

    const result = await executeAgentLoop({
      purposeName: 'research',
      initialMessages: [{ role: 'user', content: 'find an echo tool' }],
      nativeToolNames: ['get_document'],
      providerTools: [{ type: 'function', function: { name: 'get_document', description: 'Get document', parameters: { type: 'object', properties: {} } } }],
      nativeToolCatalog: [],
      broker,
      chat,
      toolSearch: 'enabled',
      traceId: 'trace-purpose-search',
      recordUsage: vi.fn(),
      parameters: { max_iterations: 2 },
    });
    const toolMessage = result.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call_search_tools');
    const payload = JSON.parse(toolMessage?.content ?? '{}') as { result?: { content?: Array<{ text?: string }> } };
    const searchResults = JSON.parse(payload.result?.content?.[0]?.text ?? '[]') as SearchResult[];

    expect(searchResults).toContainEqual(expect.objectContaining({
      registry_key: 'basic__echo',
      description: 'High overlap diagnostic echo search target.',
      has_help: false,
    }));
  });

  it('T-I-041 runs all 48 queries.json ranking fixtures against the production indexer', () => {
    expect(rankingFixtures.queries).toHaveLength(48);
    const indexer = new PureBM25Indexer(undefined, undefined, true);
    indexer.build(fixtureDocuments());

    let obviousCount = 0;
    let obviousHitAt5 = 0;
    let reciprocalRankTotal = 0;
    let reciprocalRankCount = 0;
    const misses: string[] = [];
    for (const fixture of rankingFixtures.queries) {
      const limit = 8;
      const results = indexer.search(fixture.query, limit);
      if (fixture.relevant_tools.length === 0) {
        expect(results.every((result) => result.normalizedScore < 0.7)).toBe(true);
        continue;
      }
      const rank = firstRelevantRank(results, fixture.relevant_tools);
      if (rank === 0) {
        misses.push(`${fixture.id}:${fixture.query}`);
      } else {
        reciprocalRankTotal += 1 / rank;
        reciprocalRankCount++;
        if (fixture.category === 'obvious' && rank <= 5) obviousHitAt5++;
      }
      if (fixture.category === 'obvious') obviousCount++;
    }

    expect(reciprocalRankCount).toBeGreaterThan(0);
    expect(obviousHitAt5 / obviousCount).toBeGreaterThanOrEqual(0.8);
    expect(reciprocalRankTotal / reciprocalRankCount).toBeGreaterThanOrEqual(0.7);
    expect(misses.length).toBeLessThanOrEqual(9);
  });

  it('T-I-042 runs all 18 queries-call-macro.json placement fixtures against production search', () => {
    expect(callMacroFixtures.queries).toHaveLength(18);
    const indexer = new PureBM25Indexer(undefined, undefined, true);
    indexer.build(fixtureDocuments());

    const failures: string[] = [];
    for (const fixture of callMacroFixtures.queries) {
      const results = indexer.search(fixture.query, 12);
      const first = results[0];
      const callMacroRank = results.findIndex((result) => result.server === 'flashquery' && result.tool === 'call_macro') + 1;
      let ok = true;
      if (fixture.expected_top_tool) {
        const expectedRank = results.findIndex((result) => result.server === fixture.expected_top_tool?.server && result.tool === fixture.expected_top_tool.tool) + 1;
        ok = expectedRank > 0 || fixture.call_macro_should_not_be_top === true;
      }
      if (fixture.expected_call_macro_top === true) {
        ok = first?.server === 'flashquery' && first.tool === 'call_macro';
      }
      if (fixture.call_macro_should_not_be_top === true) {
        ok = ok && callMacroRank !== 1;
      }
      if (fixture.category === 'out_of_scope') {
        ok = ok && results.every((result) => result.normalizedScore < 0.35);
      }
      if (!ok) failures.push(`${fixture.id}:${fixture.query}`);
    }

    expect(failures).toEqual([]);
  });

  it('T-I-043 and T-I-044 keep deterministic search performance within budget', () => {
    const corpus254 = syntheticDocuments(254);
    const indexer254 = new PureBM25Indexer(undefined, undefined, true);
    const buildStart = performance.now();
    indexer254.build(corpus254);
    const buildMs = performance.now() - buildStart;
    const stats254 = indexer254.getStats();
    const timings254 = Array.from({ length: 120 }, (_, index) => {
      const started = performance.now();
      indexer254.search(`diagnostic vault workflow ${index % 31}`, 8);
      return performance.now() - started;
    });

    expect(buildMs).toBeLessThanOrEqual(200);
    expect(stats254.sizeBytes).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(p95(timings254)).toBeLessThanOrEqual(5);

    const indexer1000 = new PureBM25Indexer(undefined, undefined, true);
    indexer1000.build(syntheticDocuments(1000));
    const timings1000 = Array.from({ length: 120 }, (_, index) => {
      const started = performance.now();
      indexer1000.search(`diagnostic payload broker routing ${index % 41}`, 8);
      return performance.now() - started;
    });
    expect(p95(timings1000)).toBeLessThanOrEqual(10);
  });

  it('T-I-045 returns an empty array for empty corpus and cold-start searches', async () => {
    const service = ToolSearchService.createEmpty();
    expect(service.search('anything', 8)).toEqual([]);

    const handler = createSearchToolsHandler({
      service,
      consumerContext: { kind: 'purpose', purposeId: 'research', traceId: 'trace-empty-search', interactive: true },
    });
    const result = await handler({ query: 'anything' }, { signal: new AbortController().signal, instanceId: 'test' });
    expect(JSON.parse(textOf(result))).toEqual([]);
  });

  it('T-I-046 audits search_tools invocations with purpose identity, query, result count, latency, and trace', async () => {
    const service = ToolSearchService.createEmpty();
    service.addBrokeredTools([{
      serverId: 'basic',
      toolName: 'echo',
      registryKey: 'basic__echo',
      description: 'Echo diagnostic value.',
      upstreamDescription: 'Echoes the provided value without mutation.',
      inputSchema: { type: 'object', properties: { value: {} } },
      tofuHash: hashToolSchema({ name: 'echo', description: 'Echoes the provided value without mutation.', inputSchema: { type: 'object', properties: { value: {} } } }),
      costPerCall: 0,
    }]);
    const handler = createSearchToolsHandler({
      service,
      consumerContext: { kind: 'purpose', purposeId: 'research', traceId: 'trace-audit-fallback', interactive: true },
      now: vi.fn().mockReturnValueOnce(1_000_000n).mockReturnValueOnce(1_250_000n),
    });

    await handler({ query: 'echo diagnostic', limit: 3 }, {
      signal: new AbortController().signal,
      instanceId: 'test',
      traceId: 'trace-audit-explicit',
    });

    const auditEvent = getBrokerAuditTraceSnapshot().find(
      (event) => event.type === 'mcp_broker_search_tools',
    );
    expect(auditEvent).toEqual(expect.objectContaining({
      type: 'mcp_broker_search_tools',
      purpose_id: 'research',
      query: 'echo diagnostic',
      result_count: 1,
      latency_us: 250,
      trace_id: 'trace-audit-explicit',
      ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    }));
    expect(auditEvent).not.toHaveProperty('consumer');
  });

  it('T-I-047 returns every FQ-native .tool.md body through help:true dispatch', async () => {
    const toolMeta = await loadToolMeta();
    const server = createMcpServer(makeConfig(), 'test');
    const catalog = getNativeToolCatalog(server);
    for (const [toolName, meta] of toolMeta) {
      const dispatched = await dispatchToolCalls({
        toolCalls: [{ id: `call_${toolName}_help`, type: 'function', function: { name: toolName, arguments: { help: true } } }],
        catalog,
        nativeToolNames: [toolName],
        dispatchContext: { signal: new AbortController().signal, instanceId: 'search-tools-integration' },
      });
      const payload = JSON.parse(dispatched.messages[0]?.content ?? '{}') as { result?: { content?: Array<{ text?: string }> } };
      expect(payload.result?.content?.[0]?.text).toBe(meta.helpPageBody);
    }
  }, 60000);

  it('T-I-048 appends the FQ-native help footer on error paths', async () => {
    const server = createMcpServer(makeConfig(), 'test');
    const dispatched = await dispatchToolCalls({
      toolCalls: [{ id: 'call_get_document_error', type: 'function', function: { name: 'get_document', arguments: {} } }],
      catalog: getNativeToolCatalog(server),
      nativeToolNames: ['get_document'],
      dispatchContext: { signal: new AbortController().signal, instanceId: 'search-tools-integration' },
    });
    expect(dispatched.logEntries[0]).toMatchObject({ status: 'error' });
    expect(dispatched.messages[0]?.content).toContain('For full documentation, examples, and parameter details, call `get_document` with `help: true`.');
  });

  it('T-I-049 fails validation for malformed .tool.md metadata fixtures', () => {
    const result = validateToolMeta([
      {
        filePath: 'src/mcp/tool-help/bad_name.tool.md',
        raw: [
          '---',
          'name: wrong_name',
          'description: Missing the required suffix.',
          'tier: read-only',
          'args: {}',
          '---',
          'Body.',
        ].join('\n'),
      },
      {
        filePath: 'src/mcp/tool-help/minimal_shape.tool.md',
        raw: [
          '---',
          'name: minimal_shape',
          'description: "Minimal REQ-090 shape says Pass {help: true}."',
          '---',
          'Body.',
        ].join('\n'),
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.level === 'error').map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        "frontmatter name 'wrong_name' must match file basename 'bad_name'",
        'description must end with a sentence containing help and true, such as {help: true}.',
      ])
    );
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining("missing optional frontmatter field 'args'"),
      }),
    ]));
  });

  it('T-I-026 substitutes description_override in flat list, search results, and the indexed document', async () => {
    const override = 'Override alpha beta echo ranking target.';
    const config = makeConfig({
      mcpServers: {
        basic: basicConfig({
          toolOverrides: {
            echo: { costPerCall: 0.01, descriptionOverride: override },
          },
        }),
      },
      llm: {
        providers: [],
        models: [],
        purposes: [{ name: 'research', description: 'Research', models: [], tools: ['get_document'], mcpServers: ['basic'], toolSearch: 'enabled' }],
      },
    });
    const broker = createBroker(config);
    brokers.push(broker);
    const flatTools = await broker.listToolsForConsumer({ kind: 'purpose', purposeId: 'research', traceId: 'trace-flat-override', interactive: true });
    expect(flatTools.find((tool) => tool.registryKey === 'basic__echo')).toMatchObject({
      description: override,
      upstreamDescription: 'Echoes the provided value without mutation.',
    });

    const service = await ToolSearchService.buildForConsumer({
      nativeToolCatalog: [],
      nativeToolNames: [],
      broker,
      consumerContext: { kind: 'purpose', purposeId: 'research', traceId: 'trace-search-override', interactive: true },
    });
    const [searchResult] = service.search('override alpha beta echo', 1);
    expect(searchResult).toMatchObject({
      registry_key: 'basic__echo',
      description: override,
    });

    const indexer = new PureBM25Indexer(undefined, undefined, true);
    indexer.build(flatTools.map((tool) => ({
      server: tool.serverId,
      tool: tool.toolName,
      registry_key: tool.registryKey,
      description: tool.description ?? '',
      arg_summary: [],
    })));
    expect(indexer.search('override alpha beta', 1)[0]).toMatchObject({
      registry_key: 'basic__echo',
      description: override,
    });
  });
});
