import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import {
  createMcpServer,
  getHostToolSearchServiceForServer,
  initializeHostToolSearchForServer,
} from '../../../src/mcp/server.js';
import { createBroker, hashToolSchema, type BrokerClientConfig, type McpBroker } from '../../../src/services/mcp-broker/index.js';
import type { BrokeredTool } from '../../../src/services/mcp-broker/types.js';
import { ToolSearchService } from '../../../src/services/tool-search/tool-search-service.js';

const fixtureDir = resolve(fileURLToPath(new URL('../../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(fixtureDir, 'server-basic.ts');

const brokers: McpBroker[] = [];

afterEach(async () => {
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
});

function makeConfig(overrides: Partial<FlashQueryConfig> = {}): FlashQueryConfig {
  const config: FlashQueryConfig = {
    instance: {
      name: 'Host Index Test',
      id: 'host-index-test',
      vault: { path: '/tmp/flashquery-host-index-test', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'test', databaseUrl: 'postgres://test', skipDdl: true },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio', tokenLifetime: 24 },
    locking: { enabled: false, ttlSeconds: 30 },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    logging: { level: 'error', output: 'file', file: '/tmp/flashquery-host-index-test.log' },
    macro: { defaultTimeoutMs: 60000 },
    ...overrides,
  };
  return config;
}

function basicBrokerConfig(overrides: Partial<BrokerClientConfig> = {}): BrokerClientConfig {
  return {
    serverId: 'basic',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', basicServer],
    env: {},
    costPerCall: 0,
    perCallTimeoutMs: 30000,
    toolOverrides: {
      echo: { costPerCall: 0, descriptionOverride: 'Repeat diagnostics payloads for host search.' },
    },
    ...overrides,
  };
}

function toolSnapshot(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string', description: 'Value to echo.' } },
      required: ['value'],
    },
  };
}

function brokeredTool(serverId: string, tool: Tool, description = tool.description): BrokeredTool {
  return {
    serverId,
    toolName: tool.name,
    registryKey: `${serverId}__${tool.name}`,
    ...(description === undefined ? {} : { description, upstreamDescription: tool.description }),
    inputSchema: tool.inputSchema,
    tofuHash: hashToolSchema({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }),
    costPerCall: 0,
  };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
}

describe('host tool-search index lifecycle', () => {
  it('T-I-038 builds a host index with host-visible native and brokered tools when enabled', async () => {
    const config = makeConfig({
      mcpServers: { basic: basicBrokerConfig() },
      host: { mcpServers: ['basic'], toolSearch: 'enabled' },
    });
    const broker = createBroker({
      mcpServers: { basic: basicBrokerConfig() },
      host: { mcpServers: ['basic'] },
      llm: { purposes: [] },
    });
    brokers.push(broker);

    const server = createMcpServer(config, 'test', { broker });
    await initializeHostToolSearchForServer(server);
    const service = getHostToolSearchServiceForServer(server);

    expect(service?.isBuilt()).toBe(true);
    expect(service?.getStats().documents).toBeGreaterThan(1);
    expect(service?.search('read vault document', 5)).toContainEqual(
      expect.objectContaining({ server: 'flashquery', has_help: true })
    );
    expect(service?.search('repeat diagnostics payloads', 5)).toContainEqual(
      expect.objectContaining({
        server: 'basic',
        tool: 'echo',
        registry_key: 'basic__echo',
        description: 'Repeat diagnostics payloads for host search.',
        has_help: false,
      })
    );
  });

  it('T-I-038 does not create or build a host index when host tool_search is disabled', () => {
    const config = makeConfig({
      mcpServers: { basic: basicBrokerConfig() },
      host: { mcpServers: ['basic'], toolSearch: 'disabled' },
    });

    const server = createMcpServer(config, 'test');

    expect(getHostToolSearchServiceForServer(server)).toBeUndefined();
  });

  it('T-I-039 and T-I-040 update host-visible list_changed tools through the existing sink path within 1 second', async () => {
    const service = ToolSearchService.createEmpty();
    const broker = createBroker({
      mcpServers: {},
      host: { mcpServers: ['visible'] },
      llm: { purposes: [{ name: 'research', mcpServers: ['hidden'] }] },
      indexSink: service.createHostIndexSink(['visible']),
    });
    brokers.push(broker);
    await service.buildForHost({
      nativeToolCatalog: [],
      nativeToolNames: [],
      broker,
    });

    await broker.applyToolListSnapshot('visible', [brokeredTool('visible', toolSnapshot('mutable', 'Initial visible description'))]);
    expect(service.search('initial visible', 5)).toEqual([
      expect.objectContaining({ registry_key: 'visible__mutable', description: 'Initial visible description' }),
    ]);

    await broker.applyToolListSnapshot('visible', [brokeredTool('visible', toolSnapshot('mutable', 'Changed visible diagnostic description'))]);
    await waitForCondition(() => service.search('initial visible', 5).length === 0);

    const resolved = broker.resolveSchemaDrift([{ server: 'visible', tool: 'mutable', decision: 'approve' }]);
    expect(resolved).toEqual([{ server: 'visible', tool: 'mutable', decision: 'approve' }]);
    expect(service.search('changed diagnostic', 5)).toEqual([
      expect.objectContaining({ registry_key: 'visible__mutable', description: 'Changed visible diagnostic description' }),
    ]);

    await broker.applyToolListSnapshot('hidden', [brokeredTool('hidden', toolSnapshot('secret', 'Hidden purpose-only description'))]);
    expect(service.search('hidden purpose-only', 5)).toEqual([]);
  });
});
