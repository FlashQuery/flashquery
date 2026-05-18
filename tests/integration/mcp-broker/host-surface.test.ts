import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import { createMcpServer, initializeHostToolSearchForServer } from '../../../src/mcp/server.js';
import {
  clearBrokeredToolCallTrace,
  createBroker,
  getBrokeredToolCallTraceSnapshot,
  type Broker,
  type BrokerClientConfig,
} from '../../../src/services/mcp-broker/index.js';

const fixtureDir = resolve(fileURLToPath(new URL('../../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(fixtureDir, 'server-basic.ts');
const quirkyServer = resolve(fixtureDir, 'server-quirky.ts');
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
    costPerCall: 0.5,
    perCallTimeoutMs: 30000,
    toolOverrides: {
      echo: { costPerCall: 0.75, descriptionOverride: 'X' },
    },
    ...overrides,
  };
}

function toolSnapshot(name: string, description = `${name} description`): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: { value: {} },
    },
  };
}

function quirkyConfig(initialTools: Tool[], laterTools: Tool[]): BrokerClientConfig {
  return {
    serverId: 'quirky',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', quirkyServer],
    env: {
      QUIRK_INITIAL_TOOLS: JSON.stringify(initialTools),
      QUIRK_LATER_TOOLS: JSON.stringify(laterTools),
      QUIRK_EMIT_LIST_CHANGED_MS: '200',
    },
    costPerCall: 0,
    perCallTimeoutMs: 30000,
    toolOverrides: {},
  };
}

function makeConfig(overrides: Partial<FlashQueryConfig> = {}): FlashQueryConfig {
  return {
    instance: {
      name: 'Host Brokered Surface Integration',
      id: 'host-brokered-surface-integration',
      vault: { path: '/tmp/host-brokered-surface-integration', markdownExtensions: ['.md'] },
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
    llm: { providers: [], models: [], purposes: [] },
    macro: { defaultTimeoutMs: 30000 },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
    ...overrides,
  } as FlashQueryConfig;
}

async function withHostClient<T>(
  config: FlashQueryConfig,
  fn: (client: Client, broker: Broker) => Promise<T>
): Promise<T> {
  const broker = createBroker(config);
  brokers.push(broker);
  const server = createMcpServer(config, 'test', {
    broker,
    hostTraceIdProvider: () => 'trace-host-surface',
  });
  await initializeHostToolSearchForServer(server);
  const client = new Client({ name: 'host-surface-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return await fn(client, broker);
  } finally {
    await client.close().catch(() => undefined);
    await serverTransport.close().catch(() => undefined);
  }
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('Expected text result.');
  return first.text;
}

describe('mcp broker host surface integration', () => {
  it('exposes configured host brokered tools by registry key with overridden descriptions', async () => {
    await withHostClient(makeConfig(), async (client) => {
      const list = await client.listTools();

      expect(list.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'basic__echo',
          description: 'X',
        }),
      ]));
      expect(JSON.stringify(list.tools.find((tool) => tool.name === 'basic__echo'))).not.toContain(
        'Echoes the provided value without mutation.'
      );
    });
  });

  it('does not expose brokered host tools when host config is absent or empty', async () => {
    await withHostClient(makeConfig({ host: { mcpServers: [], toolSearch: 'disabled' } }), async (client) => {
      const list = await client.listTools();

      expect(list.tools.map((tool) => tool.name)).not.toContain('basic__echo');
    });
  });

  it('routes visible host tools/call through the shared broker and records host trace cost', async () => {
    clearBrokeredToolCallTrace('trace-host-surface');
    await withHostClient(makeConfig(), async (client) => {
      const result = await client.callTool({
        name: 'basic__echo',
        arguments: { value: { phrase: 'host-ok', count: 2 } },
      }) as CallToolResult;

      expect(JSON.parse(textOf(result))).toEqual({ value: { phrase: 'host-ok', count: 2 } });
      expect(getBrokeredToolCallTraceSnapshot('trace-host-surface')).toEqual([
        {
          server: 'basic',
          tool: 'echo',
          count: 1,
          cost: 0.75,
          consumer_kind: 'host',
          trace_id: 'trace-host-surface',
        },
      ]);
    });
  });

  it('T-I-030 rejects hidden registry keys with MethodNotFound-shaped semantics without spawning the hidden server', async () => {
    await withHostClient(
      makeConfig({
        mcpServers: {
          basic: basicConfig(),
          hidden: basicConfig({
            serverId: 'hidden',
            command: process.execPath,
            args: ['-e', 'process.exit(99)'],
          }),
        },
        host: { mcpServers: ['basic'], toolSearch: 'disabled' },
      }),
      async (client) => {
        const result = await client.callTool({
          name: 'hidden__echo',
          arguments: { value: 'blocked' },
        }) as CallToolResult;
        expect(result.isError).toBe(true);
        expect(textOf(result)).toMatch(/not found|Method not found|Unknown tool/i);
        expect(getBrokeredToolCallTraceSnapshot('trace-host-surface')).toEqual([]);
      }
    );
  });

  it('updates host tools/list when an upstream list_changed adds and removes brokered tools', async () => {
    await withHostClient(
      makeConfig({
        mcpServers: {
          quirky: quirkyConfig(
            [toolSnapshot('first')],
            [toolSnapshot('second')]
          ),
        },
        host: { mcpServers: ['quirky'], toolSearch: 'enabled' },
      }),
      async (client) => {
        const notifications: unknown[] = [];
        client.setNotificationHandler(ToolListChangedNotificationSchema, (notification) => {
          notifications.push(notification);
        });

        expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('quirky__first');
        await waitForCondition(async () => {
          const names = (await client.listTools()).tools.map((tool) => tool.name);
          return names.includes('quirky__second') && !names.includes('quirky__first');
        });
        const refreshedNames = (await client.listTools()).tools.map((tool) => tool.name);

        expect(refreshedNames).toContain('quirky__second');
        expect(refreshedNames).not.toContain('quirky__first');
        expect(notifications.length).toBeGreaterThan(0);
      }
    );
  });
});
