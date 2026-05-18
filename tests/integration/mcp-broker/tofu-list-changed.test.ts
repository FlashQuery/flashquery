import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createBroker, hashToolSchema, type BrokerClientConfig, type McpBroker } from '../../../src/services/mcp-broker/index.js';
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

function brokeredTool(serverId: string, tool: Tool): BrokeredTool {
  return {
    serverId,
    toolName: tool.name,
    registryKey: `${serverId}__${tool.name}`,
    ...(tool.description === undefined ? {} : { description: tool.description, upstreamDescription: tool.description }),
    inputSchema: tool.inputSchema,
    tofuHash: hashToolSchema({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }),
    costPerCall: 0,
  };
}

function createTrackedBroker(options: {
  initialTools: Tool[];
  laterTools: Tool[];
  onTofuDrift?: (bundle: TofuDriftBundle) => void;
  onAudit?: (event: unknown) => void;
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
    onAudit: options.onAudit,
  });
  brokers.push(broker);
  return { broker, sinkEvents };
}

function createManualBroker(options: {
  onTofuDrift?: (bundle: TofuDriftBundle) => void;
  onAudit?: (event: unknown) => void;
} = {}): { broker: McpBroker; sinkEvents: SinkEvent[] } {
  const sinkEvents: SinkEvent[] = [];
  const broker = createBroker({
    mcpServers: {},
    host: { mcpServers: ['quirky'] },
    llm: { purposes: [] },
    indexSink: {
      addTools: (tools) => sinkEvents.push({ type: 'add', keys: tools.map((tool) => tool.registryKey) }),
      removeTools: (keys) => sinkEvents.push({ type: 'remove', keys }),
    },
    onTofuDrift: options.onTofuDrift,
    onAudit: options.onAudit,
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

  it('T-I-013 silently trusts first observation without prompting', async () => {
    const driftBundles: TofuDriftBundle[] = [];
    const { broker } = createTrackedBroker({
      initialTools: [toolSnapshot('trusted')],
      laterTools: [toolSnapshot('trusted')],
      onTofuDrift: (bundle) => driftBundles.push(bundle),
    });

    const tools = await broker.listToolsForConsumer(ctx);

    expect(tools).toMatchObject([{ registryKey: 'quirky__trusted', tofuHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(driftBundles).toEqual([]);
    expect(broker.getPendingSchemaDrift()).toEqual([]);
  });

  it('T-I-014 and T-I-015 emits full drift payload and removes the changed tool from callable and indexed surfaces', async () => {
    const driftBundles: TofuDriftBundle[] = [];
    const { broker, sinkEvents } = createTrackedBroker({
      initialTools: [toolSnapshot('payload', ['value'])],
      laterTools: [toolSnapshot('payload', ['value', 'token'])],
      onTofuDrift: (bundle) => driftBundles.push(bundle),
    });

    const [initialTool] = await broker.listToolsForConsumer(ctx);
    await waitForCondition(() => driftBundles.length === 1);

    expect(await visibleKeys(broker)).toEqual([]);
    expect(sinkEvents.filter((event) => event.type === 'remove').flatMap((event) => event.keys)).toContain('quirky__payload');
    expect(driftBundles.length).toBeGreaterThanOrEqual(1);
    expect(driftBundles[0]).toEqual({
      event: 'schema_drift_detected',
      server: 'quirky',
      changes: [
        expect.objectContaining({
          event: 'schema_drift_detected',
          server: 'quirky',
          tool: 'payload',
          old_schema: { name: 'payload', description: 'payload description', inputSchema: expect.objectContaining({ required: ['value'] }) },
          new_schema: {
            name: 'payload',
            description: 'payload description',
            inputSchema: expect.objectContaining({ required: ['value', 'token'] }),
          },
          diff_summary: expect.stringContaining('Added required parameter: token'),
          options: ['approve', 'reject'],
          answer_shape: 'frontmatter.user_decisions.quirky__payload.tofu_decision',
        }),
      ],
    });
    expect(driftBundles[0]?.changes[0]?.old_schema).not.toEqual(driftBundles[0]?.changes[0]?.new_schema);
    expect(broker.getPendingSchemaDrift()[0]?.old_schema).toEqual(driftBundles[0]?.changes[0]?.old_schema);
    expect(initialTool?.tofuHash).not.toBeUndefined();
  });

  it('T-I-016 approval replaces the old hash and restores registry plus index sink', async () => {
    const auditEvents: unknown[] = [];
    const { broker, sinkEvents } = createTrackedBroker({
      initialTools: [toolSnapshot('approvable', ['value'])],
      laterTools: [toolSnapshot('approvable', ['value', 'token'])],
      onAudit: (event) => auditEvents.push(event),
    });

    const [trustedTool] = await broker.listToolsForConsumer(ctx);
    await waitForCondition(() => broker.getPendingSchemaDrift().length === 1);
    const pendingHash = hashToolSchema({
      name: 'approvable',
      description: 'approvable description',
      inputSchema: toolSnapshot('approvable', ['value', 'token']).inputSchema,
    });

    const resolved = broker.resolveSchemaDrift(
      [{ server: 'quirky', tool: 'approvable', decision: 'approve' }],
      { traceId: 'trace-approve' }
    );

    expect(resolved).toEqual([{ server: 'quirky', tool: 'approvable', decision: 'approve' }]);
    const [approvedTool] = await broker.listToolsForConsumer(ctx);
    expect(approvedTool).toMatchObject({ registryKey: 'quirky__approvable', tofuHash: pendingHash });
    expect(approvedTool?.tofuHash).not.toBe(trustedTool?.tofuHash);
    expect(sinkEvents.at(-1)).toEqual({ type: 'add', keys: ['quirky__approvable'] });
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        type: 'mcp_broker_tofu_decision',
        server: 'quirky',
        tool: 'approvable',
        decision: 'approve',
        old_hash: trustedTool?.tofuHash,
        new_hash: pendingHash,
      })
    );
  });

  it('T-I-017 rejection preserves the old hash and keeps the changed tool blocked until schema reverts', async () => {
    const auditEvents: unknown[] = [];
    const initial = toolSnapshot('rejectable', ['value']);
    const changed = toolSnapshot('rejectable', ['value', 'token']);
    const { broker } = createManualBroker({
      onAudit: (event) => auditEvents.push(event),
    });

    await broker.applyToolListSnapshot('quirky', [brokeredTool('quirky', initial)]);
    const [trustedTool] = await broker.listToolsForConsumer(ctx);
    await broker.applyToolListSnapshot('quirky', [brokeredTool('quirky', changed)]);
    const changedHash = hashToolSchema({ name: changed.name, description: changed.description, inputSchema: changed.inputSchema });

    broker.resolveSchemaDrift([{ server: 'quirky', tool: 'rejectable', decision: 'reject' }], { traceId: 'trace-reject' });

    expect(await visibleKeys(broker)).toEqual([]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        type: 'mcp_broker_tofu_decision',
        server: 'quirky',
        tool: 'rejectable',
        decision: 'reject',
        old_hash: trustedTool?.tofuHash,
        new_hash: changedHash,
      })
    );

    await broker.applyToolListSnapshot('quirky', [brokeredTool('quirky', initial)]);
    const [revertedTool] = await broker.listToolsForConsumer(ctx);
    expect(revertedTool).toMatchObject({ registryKey: 'quirky__rejectable', tofuHash: trustedTool?.tofuHash });
  });

  it('T-I-018 bundles multiple changed tools from one notification into one needs-user-input payload', async () => {
    const driftBundles: TofuDriftBundle[] = [];
    const { broker } = createTrackedBroker({
      initialTools: [toolSnapshot('first', ['value']), toolSnapshot('second', ['value'])],
      laterTools: [toolSnapshot('first', ['value', 'token']), toolSnapshot('second', ['value', 'token'])],
      onTofuDrift: (bundle) => driftBundles.push(bundle),
    });

    expect(await visibleKeys(broker)).toEqual(['quirky__first', 'quirky__second']);
    await waitForCondition(() => driftBundles.length === 1);

    expect(driftBundles).toHaveLength(1);
    expect(driftBundles[0]?.changes.map((change) => change.tool).sort()).toEqual(['first', 'second']);
    expect(await visibleKeys(broker)).toEqual([]);
  });

  it('T-I-019 a fresh broker with a changed command resets in-memory TOFU and silently trusts the changed server shape', async () => {
    const firstDrifts: TofuDriftBundle[] = [];
    const changed = toolSnapshot('restart_reset', ['value', 'token']);
    const first = createTrackedBroker({
      initialTools: [toolSnapshot('restart_reset', ['value'])],
      laterTools: [changed],
      onTofuDrift: (bundle) => firstDrifts.push(bundle),
    });
    expect(await visibleKeys(first.broker)).toEqual(['quirky__restart_reset']);
    await waitForCondition(() => firstDrifts.length === 1);
    expect(await visibleKeys(first.broker)).toEqual([]);
    await first.broker.shutdown(50);
    brokers.splice(brokers.indexOf(first.broker), 1);

    const secondDrifts: TofuDriftBundle[] = [];
    const second = createTrackedBroker({
      initialTools: [changed],
      laterTools: [changed],
      onTofuDrift: (bundle) => secondDrifts.push(bundle),
      serverConfig: {
        command: '/usr/bin/env',
        args: [process.execPath, '--import', 'tsx', quirkyServer],
      },
    });

    const [trustedAfterRestart] = await second.broker.listToolsForConsumer(ctx);
    expect(trustedAfterRestart).toMatchObject({ registryKey: 'quirky__restart_reset' });
    expect(secondDrifts).toEqual([]);
    expect(second.broker.getPendingSchemaDrift()).toEqual([]);
  });

  it('T-I-020 same broker process preserves TOFU pins across reconnect-style refreshes', async () => {
    const driftBundles: TofuDriftBundle[] = [];
    const { broker } = createManualBroker({
      onTofuDrift: (bundle) => driftBundles.push(bundle),
    });

    await broker.applyToolListSnapshot('quirky', [brokeredTool('quirky', toolSnapshot('reconnect_pin', ['value']))]);
    const [trustedTool] = await broker.listToolsForConsumer(ctx);
    await broker.applyToolListSnapshot('quirky', [brokeredTool('quirky', toolSnapshot('reconnect_pin', ['value', 'token']))]);

    expect(await visibleKeys(broker)).toEqual([]);
    expect(driftBundles).toHaveLength(1);
    expect(driftBundles[0]?.changes[0]).toMatchObject({
      tool: 'reconnect_pin',
      old_schema: expect.objectContaining({ inputSchema: expect.objectContaining({ required: ['value'] }) }),
      new_schema: expect.objectContaining({ inputSchema: expect.objectContaining({ required: ['value', 'token'] }) }),
    });
    expect(driftBundles[0]?.changes[0]?.old_schema).toMatchObject({ name: 'reconnect_pin' });
    expect(trustedTool?.tofuHash).toBe(
      hashToolSchema({
        name: 'reconnect_pin',
        description: 'reconnect_pin description',
        inputSchema: toolSnapshot('reconnect_pin', ['value']).inputSchema,
      })
    );
  });

  it('T-I-027 description_override changes do not affect the upstream TOFU hash or trigger drift', async () => {
    const upstream = toolSnapshot('overridden');
    const first = createTrackedBroker({
      initialTools: [upstream],
      laterTools: [upstream],
      serverConfig: {
        toolOverrides: {
          overridden: { costPerCall: 0, descriptionOverride: 'First downstream description' },
        },
      },
    });
    const second = createTrackedBroker({
      initialTools: [upstream],
      laterTools: [upstream],
      serverConfig: {
        toolOverrides: {
          overridden: { costPerCall: 0, descriptionOverride: 'Second downstream description' },
        },
      },
    });

    const [firstTool] = await first.broker.listToolsForConsumer(ctx);
    const [secondTool] = await second.broker.listToolsForConsumer(ctx);

    expect(firstTool).toMatchObject({
      registryKey: 'quirky__overridden',
      description: 'First downstream description',
      upstreamDescription: 'overridden description',
    });
    expect(secondTool).toMatchObject({
      registryKey: 'quirky__overridden',
      description: 'Second downstream description',
      upstreamDescription: 'overridden description',
    });
    expect(firstTool?.tofuHash).toBe(hashToolSchema({ name: upstream.name, description: upstream.description, inputSchema: upstream.inputSchema }));
    expect(secondTool?.tofuHash).toBe(firstTool?.tofuHash);
    expect(hashToolSchema({ name: upstream.name, description: undefined, inputSchema: upstream.inputSchema })).toBe(
      hashToolSchema({ name: upstream.name, description: null as unknown as undefined, inputSchema: upstream.inputSchema })
    );
    expect(first.broker.getPendingSchemaDrift()).toEqual([]);
    expect(second.broker.getPendingSchemaDrift()).toEqual([]);
  });

  it('T-I-032a removing description_override between starts does not trigger TOFU re-approval', async () => {
    const upstream = toolSnapshot('override_removed');
    const withOverride = createTrackedBroker({
      initialTools: [upstream],
      laterTools: [upstream],
      serverConfig: {
        toolOverrides: {
          override_removed: { costPerCall: 0, descriptionOverride: 'Temporary downstream description' },
        },
      },
    });
    const withoutOverride = createTrackedBroker({
      initialTools: [upstream],
      laterTools: [upstream],
    });

    const [overriddenTool] = await withOverride.broker.listToolsForConsumer(ctx);
    const [plainTool] = await withoutOverride.broker.listToolsForConsumer(ctx);

    expect(overriddenTool).toMatchObject({
      registryKey: 'quirky__override_removed',
      description: 'Temporary downstream description',
      upstreamDescription: 'override_removed description',
    });
    expect(plainTool).toMatchObject({
      registryKey: 'quirky__override_removed',
      description: 'override_removed description',
    });
    expect(plainTool?.tofuHash).toBe(overriddenTool?.tofuHash);
    expect(withoutOverride.broker.getPendingSchemaDrift()).toEqual([]);
  });

  it('REQ-101 and REQ-102 keep TOFU hash call sites pinned to upstream schema fields', () => {
    const brokerIndexSource = readFileSync(resolve('src/services/mcp-broker/index.ts'), 'utf8');
    const registrySource = readFileSync(resolve('src/services/mcp-broker/registry.ts'), 'utf8');

    expect(brokerIndexSource).toContain('description: tool.upstreamDescription ?? tool.description');
    expect(brokerIndexSource).not.toContain('description: registered.description');
    expect(registrySource).toContain('upstreamDescription');
  });

  it('T-I-032b autonomous drift records blocked_on_user and emits no needs_user_input prompt', async () => {
    const driftBundles: TofuDriftBundle[] = [];
    const auditEvents: unknown[] = [];
    const { broker } = createManualBroker({
      onTofuDrift: (bundle) => driftBundles.push(bundle),
      onAudit: (event) => auditEvents.push(event),
    });
    const trusted = toolSnapshot('autonomous', ['value']);
    const changed = toolSnapshot('autonomous', ['value', 'token']);

    await broker.applyToolListSnapshot('quirky', [brokeredTool('quirky', trusted)]);
    await broker.applyToolListSnapshot('quirky', [brokeredTool('quirky', changed)], {
      interactive: false,
      traceId: 'trace-autonomous',
      purposeId: 'scheduled-purpose',
    });

    expect(await visibleKeys(broker)).toEqual([]);
    expect(driftBundles).toEqual([]);
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        type: 'mcp_broker_tofu_blocked',
        ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        server: 'quirky',
        tool: 'autonomous',
        status: 'blocked_on_user',
        trace_id: 'trace-autonomous',
        purpose_id: 'scheduled-purpose',
        old_hash: hashToolSchema({ name: trusted.name, description: trusted.description, inputSchema: trusted.inputSchema }),
        new_hash: hashToolSchema({ name: changed.name, description: changed.description, inputSchema: changed.inputSchema }),
      })
    );
    expect(JSON.stringify(auditEvents)).not.toContain('needs_user_input');
  });
});
