import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeAgentLoop } from '../../../src/llm/agent-loop.js';
import { buildToolRegistry } from '../../../src/macro/registry.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import type { NativeToolDispatchContext } from '../../../src/llm/tool-registry.js';
import type { LlmChatMessage, LlmChatResult } from '../../../src/llm/types.js';
import { createBroker, type Broker, type BrokerClientConfig } from '../../../src/services/mcp-broker/index.js';
import {
  clearBrokeredToolCallTrace,
  getBrokeredToolCallTraceSnapshot,
} from '../../../src/services/mcp-broker/trace.js';

const fixtureDir = resolve(fileURLToPath(new URL('../../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(fixtureDir, 'server-basic.ts');
const brokers: Broker[] = [];

afterEach(async () => {
  clearBrokeredToolCallTrace();
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
});

function basicConfig(overrides: Partial<BrokerClientConfig> = {}): BrokerClientConfig {
  return {
    serverId: 'basic',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', basicServer],
    env: {},
    costPerCall: 0.005,
    perCallTimeoutMs: 30000,
    toolOverrides: {
      echo: { costPerCall: 0.01 },
    },
    ...overrides,
  };
}

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'Broker Dispatch Integration',
      id: 'broker-dispatch-integration',
      vault: { path: '/tmp/broker-dispatch-integration', markdownExtensions: ['.md'] },
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
    mcpServers: { basic: basicConfig() },
    host: { mcpServers: ['basic'], toolSearch: 'disabled' },
    llm: {
      providers: [],
      models: [],
      purposes: [{ name: 'research', description: 'Research', models: [], mcpServers: ['basic'], toolSearch: 'disabled' }],
    },
    macro: { defaultTimeoutMs: 30000 },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
  } as FlashQueryConfig;
}

function chatResult(overrides: Partial<LlmChatResult> = {}): LlmChatResult {
  return {
    message: { role: 'assistant', content: 'done' },
    modelName: 'fast',
    providerName: 'openai',
    inputTokens: 10,
    outputTokens: 4,
    latencyMs: 5,
    finishReason: 'stop',
    ...overrides,
  };
}

function nativeDispatchContext(traceId: string): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'broker-dispatch-integration',
    traceId,
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logContext: {},
  };
}

describe('mcp broker dispatch seam integration', () => {
  it('exposes visible broker tools to the delegated model and dispatches registry-key calls to the fixture', async () => {
    const broker = createBroker({
      mcpServers: { basic: basicConfig() },
      host: { mcpServers: ['basic'] },
      llm: { purposes: [{ name: 'research', mcpServers: ['basic'] }] },
    });
    brokers.push(broker);
    const rawArgs = { value: { stringNumber: '42', number: 42, bool: true, nullish: null, array: [1, 'two'] } };
    const chat = vi.fn()
      .mockImplementationOnce(async (_messages: LlmChatMessage[], parameters?: Record<string, unknown>) => {
        expect(parameters?.tools).toEqual(expect.arrayContaining([
          expect.objectContaining({ function: expect.objectContaining({ name: 'basic__echo' }) }),
        ]));
        return chatResult({
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_basic_echo', type: 'function', function: { name: 'basic__echo', arguments: rawArgs } }],
          },
          finishReason: 'tool_calls',
        });
      })
      .mockResolvedValueOnce(chatResult({ message: { role: 'assistant', content: 'final' }, finishReason: 'stop' }));

    const result = await executeAgentLoop({
      purposeName: 'research',
      initialMessages: [{ role: 'user', content: 'echo this' }],
      nativeToolNames: [],
      providerTools: [],
      nativeToolCatalog: [],
      broker,
      chat,
      recordUsage: vi.fn(),
      traceId: 'trace-dispatch-integration',
      parameters: { max_iterations: 2 },
    });

    expect(result.metadata.tools.calls_log[0].tool_calls[0]).toMatchObject({
      kind: 'brokered',
      tool_call_id: 'call_basic_echo',
      tool_name: 'basic__echo',
      status: 'success',
    });
    const toolMessage = result.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call_basic_echo');
    const toolPayload = JSON.parse(toolMessage?.content ?? '{}');
    expect(JSON.parse(toolPayload.result.content[0].text)).toEqual(rawArgs);
    expect(getBrokeredToolCallTraceSnapshot('trace-dispatch-integration')).toEqual([
      {
        trace_id: 'trace-dispatch-integration',
        consumer_kind: 'purpose',
        purpose_id: 'research',
        server: 'basic',
        tool: 'echo',
        count: 1,
        cost: 0.01,
      },
    ]);
  });

  it('dispatches dotted macro broker refs to the fixture with inherited trace cost', async () => {
    const broker = createBroker({
      mcpServers: { basic: basicConfig() },
      host: { mcpServers: ['basic'] },
      llm: { purposes: [{ name: 'research', mcpServers: ['basic'] }] },
    });
    brokers.push(broker);
    const registry = buildToolRegistry({
      config: makeConfig(),
      callerContext: { origin: 'host' },
      broker,
      catalog: [],
      nativeDispatchContext: nativeDispatchContext('trace-macro-integration'),
      brokerTools: [{ server: 'basic', label: 'Basic Fixture', tools: ['echo'] }],
    });
    const value = { string: 'x', number: 1, boolean: true, nullish: null, array: [1, 'two'], object: { nested: 'yes' } };

    await expect(
      registry.registry.basic.tools.echo({ value }, {} as Parameters<typeof registry.registry.basic.tools.echo>[1])
    ).resolves.toEqual({ value });

    expect(getBrokeredToolCallTraceSnapshot('trace-macro-integration')).toEqual([
      {
        trace_id: 'trace-macro-integration',
        consumer_kind: 'host',
        server: 'basic',
        tool: 'echo',
        count: 1,
        cost: 0.01,
      },
    ]);
  });
});
