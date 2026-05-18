import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { BrokerClientConfig, ConsumerContext } from '../../../src/services/mcp-broker/types.js';
import { BrokerClient, McpBroker, NullBroker, createBroker } from '../../../src/services/mcp-broker/index.js';
import { formatToolError } from '../../../src/services/mcp-broker/errors.js';

const fixtureDir = resolve(fileURLToPath(new URL('../../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(fixtureDir, 'server-basic.ts');
const authServer = resolve(fixtureDir, 'server-auth.ts');
const quirkyServer = resolve(fixtureDir, 'server-quirky.ts');
const ctx: ConsumerContext = { kind: 'host', traceId: 'trace-test' };

const clients: BrokerClient[] = [];
const brokers: Array<{ shutdown(graceMs?: number): Promise<void> }> = [];
const sdkClients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.shutdown(50)));
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
  await Promise.allSettled(sdkClients.splice(0).map((client) => client.close()));
});

function config(overrides: Partial<BrokerClientConfig> = {}): BrokerClientConfig {
  return {
    serverId: 'basic',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', basicServer],
    env: {},
    costPerCall: 0,
    perCallTimeoutMs: 30000,
    toolOverrides: {},
    ...overrides,
  };
}

function trackClient(overrides: Partial<BrokerClientConfig> = {}): BrokerClient {
  const client = new BrokerClient(config(overrides));
  clients.push(client);
  return client;
}

function isAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function connectQuirkySdkClient(env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'fixture-list-changed-test', version: '1.0.0' }, { capabilities: {} });
  sdkClients.push(client);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', quirkyServer],
      env: { ...process.env, ...env },
      stderr: 'pipe',
    })
  );
  return client;
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

async function observeQuirkyListChanged(initialTools: Tool[], laterTools: Tool[]): Promise<{ before: Tool[]; after: Tool[] }> {
  const client = await connectQuirkySdkClient({
    QUIRK_INITIAL_TOOLS: JSON.stringify(initialTools),
    QUIRK_LATER_TOOLS: JSON.stringify(laterTools),
    QUIRK_EMIT_LIST_CHANGED_MS: '25',
  });
  const notification = new Promise<void>((resolve) => {
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve());
  });

  const before = (await client.listTools()).tools;
  await notification;
  const after = (await client.listTools()).tools;
  return { before, after };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
}

function quirkyServerConfig(initialTools: Tool[], laterTools: Tool[]): BrokerClientConfig {
  return config({
    serverId: 'quirky',
    args: ['--import', 'tsx', quirkyServer],
    env: {
      QUIRK_INITIAL_TOOLS: JSON.stringify(initialTools),
      QUIRK_LATER_TOOLS: JSON.stringify(laterTools),
      QUIRK_EMIT_LIST_CHANGED_MS: '25',
    },
  });
}

describe('mcp broker client lifecycle integration', () => {
  it('T-I-001 lazily spawns on first reference and shuts down the child', async () => {
    const client = trackClient();
    expect(client.pid).toBeNull();

    const result = await client.callTool('echo', { value: 'hi' }, ctx);

    expect(client.pid).toEqual(expect.any(Number));
    expect(result.content[0]).toMatchObject({ type: 'text', text: JSON.stringify({ value: 'hi' }) });
    const pid = client.pid;
    await client.shutdown(100);
    expect(isAlive(pid)).toBe(false);
  });

  it('T-I-002 shares one cold-start promise for concurrent ensureConnected calls', async () => {
    const client = trackClient();
    await Promise.all(Array.from({ length: 8 }, () => client.ensureConnected()));

    expect(client.spawnCount).toBe(1);
    expect(client.pid).toEqual(expect.any(Number));
  });

  it('T-I-003 discovers tools/list on connect', async () => {
    const client = trackClient();
    const tools = await client.listTools();

    expect(tools.map((tool) => tool.toolName).sort()).toEqual(['crash', 'echo', 'slow', 'stderr_write']);
  });

  it('T-I-008 maps per-call timeout failures to server_timeout', async () => {
    const client = trackClient({ perCallTimeoutMs: 75 });

    await expect(client.callTool('slow', { ms: 500 }, ctx)).rejects.toMatchObject({ kind: 'server_timeout' });
  });

  it('T-I-009 shutdown kills an in-flight slow server within the grace timeout', async () => {
    const client = trackClient({ perCallTimeoutMs: 2000 });
    await client.ensureConnected();
    const call = client.callTool('slow', { ms: 5000 }, ctx);
    const pid = client.pid;
    const callError = call.catch((error: unknown) => error);

    await client.shutdown(50);

    expect(await callError).toMatchObject({ kind: 'transport_closed' });
    expect(isAlive(pid)).toBe(false);
  });

  it('T-I-010 surfaces deterministic stderr on connect failure with env substitution', async () => {
    const client = trackClient({
      serverId: 'auth',
      args: ['--import', 'tsx', authServer],
      env: { POC_API_KEY: '${POC_API_KEY}' },
    });

    await expect(client.ensureConnected()).rejects.toMatchObject({
      kind: 'server_crashed',
      message: expect.stringContaining('FATAL: POC_API_KEY environment variable is required.'),
    });
  });

  it('T-I-011 keeps stderr out of tools/call responses', async () => {
    const client = trackClient();

    const result = await client.callTool('stderr_write', { message: 'side-channel' }, ctx);

    expect(result.content[0]).toMatchObject({ type: 'text', text: 'stderr-written' });
    expect(JSON.stringify(result)).not.toContain('BASIC_STDERR');
    expect(client.stderrText).toContain('BASIC_STDERR:side-channel');
  });

  it('T-I-012 restarts once after process death and serves a later call', async () => {
    const client = trackClient();
    await client.ensureConnected();
    const firstPid = client.pid;
    await client.callTool('crash', { code: 42 }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await client.callTool('echo', { value: 'after-crash' }, ctx);

    expect(client.restartCount).toBe(1);
    expect(client.pid).not.toBe(firstPid);
    expect(result.content[0]).toMatchObject({ type: 'text', text: JSON.stringify({ value: 'after-crash' }) });
  });

  it('T-I-021 and T-S-018 keep capabilities empty and audit rejected reverse requests without payloads', async () => {
    const auditEvents: unknown[] = [];
    const client = trackClient({
      serverId: 'quirky',
      args: ['--import', 'tsx', quirkyServer],
      onAudit: (event) => auditEvents.push(event),
    });

    await client.ensureConnected();
    expect(client.clientCapabilities).toEqual({});
    const result = await client.callTool('trigger_reverse_request', { prompt: 'secret prompt' }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('sampling/createMessage rejected_unsupported'),
    });

    const matchingAuditEvents = auditEvents.filter((event) =>
      typeof event === 'object' &&
      event !== null &&
      (event as Record<string, unknown>).serverId === 'quirky' &&
      (event as Record<string, unknown>).method === 'sampling/createMessage' &&
      (event as Record<string, unknown>).status === 'rejected_unsupported' &&
      (event as Record<string, unknown>).traceId === 'trace-test'
    );
    expect(matchingAuditEvents).toHaveLength(1);
    expect(JSON.stringify(auditEvents)).not.toContain('secret prompt');
  });

  it('T-I-022 handles concurrent brokered calls to the same server', async () => {
    const client = trackClient();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => client.callTool('echo', { value: { index } }, ctx))
    );

    expect(results.map((result) => JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '{}'))).toEqual(
      Array.from({ length: 8 }, (_, index) => ({ value: { index } }))
    );
  });

  it('T-I-023 deep probes are live and return false for hung tools/list while T-I-024 shallow probe remains true', async () => {
    const client = trackClient({ env: { BASIC_HANG_LIST: 'after-first' } });
    await client.ensureConnected();
    await new Promise((resolve) => setTimeout(resolve, 300));

    await expect(client.isConnected({ deepProbe: true, timeoutMs: 75 })).resolves.toBe(false);
    await expect(client.isConnected({ deepProbe: true, timeoutMs: 75 })).resolves.toBe(false);
    await expect(client.isConnected({ deepProbe: false })).resolves.toBe(true);
  });

  it('T-I-025 preserves JSON argument passthrough end-to-end', async () => {
    const client = trackClient();
    const value = {
      string: 'x',
      number: 1,
      boolean: true,
      nullish: null,
      array: [1, 'two', false],
      object: { nested: 'yes' },
    };

    const result = await client.callTool('echo', { value }, ctx);

    expect(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : '{}')).toEqual({ value });
  });

  it('T-I-004 and T-I-005 observes list_changed then sees an added tool in the later snapshot', async () => {
    const initial = [toolSnapshot('first')];
    const later = [toolSnapshot('first'), toolSnapshot('second')];

    const { before, after } = await observeQuirkyListChanged(initial, later);

    expect(before.map((tool) => tool.name)).toEqual(['first']);
    expect(after.map((tool) => tool.name)).toEqual(['first', 'second']);
  });

  it('T-I-004 and T-I-006 observes list_changed then sees a changed tool schema in the later snapshot', async () => {
    const initial = [toolSnapshot('mutable', ['value'])];
    const later = [toolSnapshot('mutable', ['value', 'token'])];

    const { before, after } = await observeQuirkyListChanged(initial, later);

    expect(before[0]?.inputSchema).toMatchObject({ required: ['value'] });
    expect(after[0]?.inputSchema).toMatchObject({ required: ['value', 'token'] });
  });

  it('T-I-004 and T-I-007 observes list_changed then sees a removed tool absent from the later snapshot', async () => {
    const initial = [toolSnapshot('kept'), toolSnapshot('removed')];
    const later = [toolSnapshot('kept')];

    const { before, after } = await observeQuirkyListChanged(initial, later);

    expect(before.map((tool) => tool.name)).toEqual(['kept', 'removed']);
    expect(after.map((tool) => tool.name)).toEqual(['kept']);
  });

  it('T-I-004 BrokerClient reports refreshed brokered tools after list_changed', async () => {
    const changedSnapshots: Array<{ serverId: string; toolNames: string[] }> = [];
    const client = trackClient({
      serverId: 'quirky',
      args: ['--import', 'tsx', quirkyServer],
      env: {
        QUIRK_INITIAL_TOOLS: JSON.stringify([toolSnapshot('before')]),
        QUIRK_LATER_TOOLS: JSON.stringify([toolSnapshot('before'), toolSnapshot('after')]),
        QUIRK_EMIT_LIST_CHANGED_MS: '25',
      },
      onToolListChanged: (serverId, tools) => {
        changedSnapshots.push({ serverId, toolNames: tools.map((tool) => tool.toolName) });
      },
    });

    await client.ensureConnected();
    expect((await client.listTools()).map((tool) => tool.toolName)).toEqual(['before']);
    await waitForCondition(() => changedSnapshots.length === 1);

    expect(changedSnapshots).toEqual([{ serverId: 'quirky', toolNames: ['before', 'after'] }]);
    expect((await client.listTools()).map((tool) => tool.toolName)).toEqual(['before', 'after']);
  });

  it('T-I-005 registers and indexes a new tool from list_changed synchronously', async () => {
    const addedTools: string[][] = [];
    const removedKeys: string[][] = [];
    const broker = createBroker({
      mcpServers: {
        quirky: quirkyServerConfig([toolSnapshot('first')], [toolSnapshot('first'), toolSnapshot('second')]),
      },
      host: { mcpServers: ['quirky'] },
      llm: { purposes: [] },
      indexSink: {
        addTools: (tools) => addedTools.push(tools.map((tool) => tool.registryKey)),
        removeTools: (keys) => removedKeys.push(keys),
      },
    });
    brokers.push(broker);

    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey)).toEqual(['quirky__first']);
    await waitForCondition(() => addedTools.some((keys) => keys.includes('quirky__second')));

    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey).sort()).toEqual([
      'quirky__first',
      'quirky__second',
    ]);
    expect(removedKeys.flat()).not.toContain('quirky__second');
  });

  it('T-I-006 removes a changed tool from registry and index sink immediately', async () => {
    const removedKeys: string[][] = [];
    const broker = createBroker({
      mcpServers: {
        quirky: quirkyServerConfig([toolSnapshot('mutable', ['value'])], [toolSnapshot('mutable', ['value', 'token'])]),
      },
      host: { mcpServers: ['quirky'] },
      llm: { purposes: [] },
      indexSink: {
        addTools: () => undefined,
        removeTools: (keys) => removedKeys.push(keys),
      },
    });
    brokers.push(broker);

    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey)).toEqual(['quirky__mutable']);
    await waitForCondition(() => removedKeys.some((keys) => keys.includes('quirky__mutable')));

    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey)).toEqual([]);
  });

  it('T-I-007 removes a removed tool from registry and index sink while keeping unchanged tools callable', async () => {
    const removedKeys: string[][] = [];
    const broker = createBroker({
      mcpServers: {
        quirky: quirkyServerConfig([toolSnapshot('kept'), toolSnapshot('removed')], [toolSnapshot('kept')]),
      },
      host: { mcpServers: ['quirky'] },
      llm: { purposes: [] },
      indexSink: {
        addTools: () => undefined,
        removeTools: (keys) => removedKeys.push(keys),
      },
    });
    brokers.push(broker);

    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey).sort()).toEqual([
      'quirky__kept',
      'quirky__removed',
    ]);
    await waitForCondition(() => removedKeys.some((keys) => keys.includes('quirky__removed')));

    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey)).toEqual(['quirky__kept']);
  });

  it('T-I-018 stores multiple changed tools from one refresh as one bundled drift event', async () => {
    const driftBundles: string[][] = [];
    const broker = createBroker({
      mcpServers: {
        quirky: quirkyServerConfig(
          [toolSnapshot('first', ['value']), toolSnapshot('second', ['value'])],
          [toolSnapshot('first', ['value', 'token']), toolSnapshot('second', ['value', 'token'])]
        ),
      },
      host: { mcpServers: ['quirky'] },
      llm: { purposes: [] },
      onTofuDrift: (bundle) => driftBundles.push(bundle.changes.map((change) => change.tool).sort()),
    });
    brokers.push(broker);

    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey).sort()).toEqual([
      'quirky__first',
      'quirky__second',
    ]);
    await waitForCondition(() => driftBundles.length === 1);

    expect(driftBundles).toEqual([['first', 'second']]);
    expect((await broker.listToolsForConsumer(ctx)).map((tool) => tool.registryKey)).toEqual([]);
  });

  it('public broker creates lazy clients, filters registry tools, returns raw CallToolResult, and shuts down', async () => {
    const broker = createBroker({
      mcpServers: {
        basic: config(),
      },
      host: { mcpServers: [] },
      llm: { purposes: [{ name: 'research', mcpServers: ['basic'] }] },
    });
    brokers.push(broker);

    expect(broker).toBeInstanceOf(McpBroker);
    expect(await broker.isConnected('basic', { deepProbe: false })).toBe(false);

    const result = await broker.callTool({ serverId: 'basic', toolName: 'echo' }, { value: 'broker' }, ctx);
    const hostTools = await broker.listToolsForConsumer(ctx);
    const purposeTools = await broker.listToolsForConsumer({
      kind: 'purpose',
      purposeId: 'research',
      traceId: 'trace-purpose',
    });

    expect(result).toHaveProperty('content');
    expect(hostTools).toEqual([]);
    expect(purposeTools.map((tool) => tool.registryKey)).toContain('basic__echo');
    await expect(broker.shutdown(100)).resolves.toBeUndefined();
  });

  it('NullBroker returns no tools and fails calls predictably', async () => {
    const broker = new NullBroker();

    await expect(broker.listToolsForConsumer(ctx)).resolves.toEqual([]);
    await expect(broker.callTool({ serverId: 'missing', toolName: 'echo' }, {}, ctx)).rejects.toMatchObject(
      formatToolError(new Error('No MCP broker is configured.'), { serverId: 'missing', toolName: 'echo' })
    );
  });
});
