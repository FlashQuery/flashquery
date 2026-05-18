import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.shutdown(50)));
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
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

    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        serverId: 'quirky',
        method: 'sampling/createMessage',
        status: 'rejected_unsupported',
        traceId: 'trace-test',
      })
    );
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

  it('public broker creates lazy clients, filters registry tools, returns raw CallToolResult, and shuts down', async () => {
    const broker = createBroker({
      mcpServers: {
        basic: config(),
      },
      host: { mcpServers: ['basic'] },
      llm: { purposes: [{ name: 'research', mcpServers: ['basic'] }] },
    });
    brokers.push(broker);

    expect(broker).toBeInstanceOf(McpBroker);
    expect(await broker.isConnected('basic', { deepProbe: false })).toBe(false);

    const result = await broker.callTool({ serverId: 'basic', toolName: 'echo' }, { value: 'broker' }, ctx);
    const hostTools = await broker.listToolsForConsumer(ctx);

    expect(result).toHaveProperty('content');
    expect(hostTools.map((tool) => tool.registryKey)).toContain('basic__echo');
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
