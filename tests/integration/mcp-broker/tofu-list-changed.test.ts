import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createBroker, type BrokerClientConfig, type McpBroker } from '../../../src/services/mcp-broker/index.js';
import type { BrokeredTool, ConsumerContext, RegistryKey, TofuDriftBundle } from '../../../src/services/mcp-broker/types.js';

const fixtureDir = resolve(fileURLToPath(new URL('../../fixtures/mcp-servers', import.meta.url)));
const quirkyServer = resolve(fixtureDir, 'server-quirky.ts');
const ctx: ConsumerContext = { kind: 'host', traceId: 'trace-tofu-list-changed' };

const brokers: McpBroker[] = [];

afterEach(async () => {
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
});

interface SinkEvent {
  type: 'add' | 'remove';
  keys: RegistryKey[];
}

function toolSnapshot(name: string, required: string[] = []): Tool {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
        token: { type: 'string' },
      },
      required,
    },
  };
}

function brokerConfig(initialTools: Tool[], laterTools: Tool[], overrides: Partial<BrokerClientConfig> = {}): BrokerClientConfig {
  return {
    serverId: 'quirky',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', quirkyServer],
    env: {
      QUIRK_INITIAL_TOOLS: JSON.stringify(initialTools),
      QUIRK_LATER_TOOLS: JSON.stringify(laterTools),
      QUIRK_EMIT_LIST_CHANGED_MS: '50',
    },
    costPerCall: 0,
    perCallTimeoutMs: 30000,
    toolOverrides: {},
    ...overrides,
  };
}

function createTrackedBroker(options: {
  initialTools: Tool[];
  laterTools: Tool[];
  onTofuDrift?: (bundle: TofuDriftBundle) => void;
  serverConfig?: Partial<BrokerClientConfig>;
}): { broker: McpBroker; sinkEvents: SinkEvent[] } {
  const sinkEvents: SinkEvent[] = [];
  const broker = createBroker({
    mcpServers: {
      quirky: brokerConfig(options.initialTools, options.laterTools, options.serverConfig),
    },
    host: { mcpServers: ['quirky'] },
    llm: { purposes: [] },
    indexSink: {
      addTools: (tools) => sinkEvents.push({ type: 'add', keys: tools.map((tool) => tool.registryKey) }),
      removeTools: (keys) => sinkEvents.push({ type: 'remove', keys }),
    },
    onTofuDrift: options.onTofuDrift,
  });
  brokers.push(broker);
  return { broker, sinkEvents };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
}

async function visibleKeys(broker: McpBroker): Promise<string[]> {
  return (await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey).sort();
}

describe('mcp broker TOFU list_changed integration', () => {
  it('T-I-004 and T-I-005 adds a new list_changed tool to registry, TOFU, and index sink', async () => {
    const { broker, sinkEvents } = createTrackedBroker({
      initialTools: [toolSnapshot('first')],
      laterTools: [toolSnapshot('first'), toolSnapshot('second')],
    });

    expect(await visibleKeys(broker)).toEqual(['quirky__first']);
    await waitForCondition(() => sinkEvents.some((event) => event.type === 'add' && event.keys.includes('quirky__second')));

    const tools = await broker.listToolsForConsumer(ctx);
    expect(tools.map((tool) => tool.registryKey).sort()).toEqual(['quirky__first', 'quirky__second']);
    expect(tools.find((tool) => tool.registryKey === 'quirky__second')?.tofuHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sinkEvents.filter((event) => event.type === 'remove').flatMap((event) => event.keys)).not.toContain('quirky__second');
  });

  it('T-I-004 and T-I-006 blocks a changed tool and removes it from the index before drift is restored', async () => {
    const driftBundles: TofuDriftBundle[] = [];
    const { broker, sinkEvents } = createTrackedBroker({
      initialTools: [toolSnapshot('mutable', ['value'])],
      laterTools: [toolSnapshot('mutable', ['value', 'token'])],
      onTofuDrift: (bundle) => driftBundles.push(bundle),
    });

    expect(await visibleKeys(broker)).toEqual(['quirky__mutable']);
    await waitForCondition(() => driftBundles.length === 1);

    expect(await visibleKeys(broker)).toEqual([]);
    expect(sinkEvents.find((event) => event.type === 'remove')?.keys).toEqual(['quirky__mutable']);
    const removalIndex = sinkEvents.findIndex((event) => event.type === 'remove' && event.keys.includes('quirky__mutable'));
    const restoredIndex = sinkEvents.findIndex(
      (event, index) => index > removalIndex && event.type === 'add' && event.keys.includes('quirky__mutable')
    );
    expect(removalIndex).toBeGreaterThanOrEqual(0);
    if (restoredIndex >= 0) {
      expect(removalIndex).toBeLessThan(restoredIndex);
    }
    expect(driftBundles[0]?.changes[0]).toMatchObject({
      event: 'schema_drift_detected',
      server: 'quirky',
      tool: 'mutable',
      old_schema: { inputSchema: expect.objectContaining({ required: ['value'] }) },
      new_schema: { inputSchema: expect.objectContaining({ required: ['value', 'token'] }) },
    });
  });

  it('T-I-004 and T-I-007 removes an absent tool while retaining callable unchanged tools', async () => {
    const { broker, sinkEvents } = createTrackedBroker({
      initialTools: [toolSnapshot('kept'), toolSnapshot('removed')],
      laterTools: [toolSnapshot('kept')],
    });

    expect(await visibleKeys(broker)).toEqual(['quirky__kept', 'quirky__removed']);
    await waitForCondition(() => sinkEvents.some((event) => event.type === 'remove' && event.keys.includes('quirky__removed')));

    expect(await visibleKeys(broker)).toEqual(['quirky__kept']);
    expect(sinkEvents.filter((event) => event.type === 'remove').flatMap((event) => event.keys)).toContain('quirky__removed');
  });
});
