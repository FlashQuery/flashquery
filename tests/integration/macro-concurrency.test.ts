import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import { createBroker, NullMcpBroker, type McpBroker } from '../../src/services/mcp-broker.js';
import type { BrokerClientConfig } from '../../src/services/mcp-broker/types.js';

const fixtureDir = resolve(fileURLToPath(new URL('../fixtures/mcp-servers', import.meta.url)));
const basicServer = resolve(fixtureDir, 'server-basic.ts');
const quirkyServer = resolve(fixtureDir, 'server-quirky.ts');
const brokers: McpBroker[] = [];

afterEach(async () => {
  await Promise.allSettled(brokers.splice(0).map((broker) => broker.shutdown(50)));
});

function testConfig(): FlashQueryConfig {
  return {
    instance: {
      id: 'macro-concurrency-integration',
      vault: { path: process.cwd() },
    },
    server: {},
    hostMcpTools: { tools: ['search'] },
  } as FlashQueryConfig;
}

function nativeDispatchContext(): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'macro-concurrency-integration',
    traceId: 'trace-macro-concurrency',
    logContext: { tool: 'call_macro' },
  };
}

function basicConfig(): BrokerClientConfig {
  return {
    serverId: 'basic',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', basicServer],
    env: {},
    costPerCall: 0,
    perCallTimeoutMs: 30_000,
    toolOverrides: {},
  };
}

function quirkyListChangedConfig(): BrokerClientConfig {
  const mutableV1 = {
    name: 'mutable',
    description: 'Mutable concurrent fixture tool.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
  };
  const mutableV2 = {
    name: 'mutable',
    description: 'Mutable concurrent fixture tool with token.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' }, token: { type: 'string' } },
      required: ['value', 'token'],
    },
  };
  const added = {
    name: 'added',
    description: 'Added concurrent fixture tool.',
    inputSchema: { type: 'object', properties: {} },
  };
  return {
    serverId: 'quirky',
    transport: 'stdio',
    command: process.execPath,
    args: ['--import', 'tsx', quirkyServer],
    env: {
      QUIRK_INITIAL_TOOLS: JSON.stringify([mutableV1]),
      QUIRK_LATER_TOOLS: JSON.stringify([mutableV2, added]),
      QUIRK_EMIT_LIST_CHANGED_MS: '25',
    },
    costPerCall: 0,
    perCallTimeoutMs: 30_000,
    toolOverrides: {},
  };
}

function parseToolText(result: Awaited<ReturnType<typeof runMacroSource>>['result']): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started > 2_000) {
      throw new Error('Timed out waiting for concurrent macro state');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('macro concurrency integration', () => {
  it('T-E-002 keeps host and delegated calls isolated across mid-flight list_changed', async () => {
    const driftEvents: unknown[] = [];
    const broker = createBroker({
      mcpServers: { quirky: quirkyListChangedConfig() },
      host: { mcpServers: ['quirky'] },
      llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: [], mcpServers: ['quirky'], toolSearch: 'disabled' }] },
      onTofuDrift: (bundle) => driftEvents.push(bundle),
    });
    brokers.push(broker);
    const hostCtx = { kind: 'host' as const, traceId: 'trace-host-list-changed' };
    const brokerTools = [{ server: 'quirky', label: 'Quirky Fixture', tools: ['mutable'] }];

    await broker.listToolsForConsumer(hostCtx);
    const [hostResult, purposeRun] = await Promise.all([
      broker.callTool({ serverId: 'quirky', toolName: 'mutable' }, { value: 'host' }, hostCtx),
      runMacroSource({
        source: 'result = quirky.mutable({ value: "purpose" })\nexit $result',
        sessionId: 'macro-list-changed-purpose',
        config: testConfig(),
        catalog: [],
        broker,
        brokerTools,
        nativeDispatchContext: nativeDispatchContext(),
        trace: 'summary',
        callerContext: { origin: 'delegated', purposeName: 'researcher' },
      }),
    ]);

    expect(JSON.parse(hostResult.content[0]?.text ?? '{}')).toEqual({
      tool: 'mutable',
      arguments: { value: 'host' },
    });
    expect(parseToolText(purposeRun.result)).toMatchObject({
      result: { tool: 'mutable', arguments: { value: 'purpose' } },
      external_tool_calls: 1,
    });

    await waitFor(() => driftEvents.length > 0);
    expect(broker.getClientDebugSnapshot('quirky')).toMatchObject({
      spawnCount: 1,
      restartCount: 0,
    });
    expect(await broker.listToolsForConsumer(hostCtx)).toEqual([
      expect.objectContaining({ registryKey: 'quirky__added' }),
    ]);
  });

  it('T-I-050 keeps concurrent macros isolated while sharing one brokered server process', async () => {
    const broker = createBroker({
      mcpServers: { basic: basicConfig() },
      host: { mcpServers: ['basic'] },
      llm: { purposes: [] },
    });
    brokers.push(broker);
    const taskRegistry = new MacroTaskRegistry();
    const brokerTools = [{ server: 'basic', label: 'Basic Fixture', tools: ['slow', 'echo'] }];
    await broker.listToolsForConsumer({ kind: 'host', traceId: 'trace-macro-concurrency' });
    expect(broker.getClientDebugSnapshot('basic')).toMatchObject({
      spawnCount: 1,
      restartCount: 0,
    });

    const slowSource = `
      slow_result = basic.slow({ ms: 200 })
      status --progress 1 --total 1 "m1-slow-complete"
      exit {
        label: "m1",
        slow_result: $slow_result,
        task_id: task_id
      }
    `;
    const echoSource = `
      echo_result = basic.echo({ value: { msg: "m2" } })
      status --progress 1 --total 1 "m2-echo-complete"
      exit {
        label: "m2",
        echo_result: $echo_result,
        task_id: task_id
      }
    `;

    const [slowRun, echoRun] = await Promise.all([
      runMacroSource({
        source: slowSource,
        sessionId: 'macro-shared-server-m1',
        taskRegistry,
        config: testConfig(),
        catalog: [],
        broker,
        brokerTools,
        nativeDispatchContext: nativeDispatchContext(),
        trace: 'full',
      }),
      runMacroSource({
        source: echoSource,
        sessionId: 'macro-shared-server-m2',
        taskRegistry,
        config: testConfig(),
        catalog: [],
        broker,
        brokerTools,
        nativeDispatchContext: nativeDispatchContext(),
        trace: 'full',
      }),
    ]);

    const slowPayload = parseToolText(slowRun.result);
    const echoPayload = parseToolText(echoRun.result);
    const slowValue = slowPayload['result'] as Record<string, unknown>;
    const echoValue = echoPayload['result'] as Record<string, unknown>;
    const slowTrace = slowPayload['trace'] as Array<Record<string, unknown>>;
    const echoTrace = echoPayload['trace'] as Array<Record<string, unknown>>;

    expect(slowValue).toMatchObject({
      label: 'm1',
      slow_result: 'waited:200',
      task_id: slowPayload['task_id'],
    });
    expect(echoValue).toMatchObject({
      label: 'm2',
      echo_result: { value: { msg: 'm2' } },
      task_id: echoPayload['task_id'],
    });
    expect(slowPayload['task_id']).not.toBe(echoPayload['task_id']);

    expect(slowTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          name: 'basic.slow',
          args: { ms: 200 },
          result: 'waited:200',
        }),
        expect.objectContaining({ kind: 'progress', message: 'm1-slow-complete' }),
        expect.objectContaining({ kind: 'exit' }),
      ])
    );
    expect(echoTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          name: 'basic.echo',
          args: { value: { msg: 'm2' } },
          result: { value: { msg: 'm2' } },
        }),
        expect.objectContaining({ kind: 'progress', message: 'm2-echo-complete' }),
        expect.objectContaining({ kind: 'exit' }),
      ])
    );
    expect(JSON.stringify(slowTrace)).not.toContain('m2-echo-complete');
    expect(JSON.stringify(slowTrace)).not.toContain('basic.echo');
    expect(JSON.stringify(echoTrace)).not.toContain('m1-slow-complete');
    expect(JSON.stringify(echoTrace)).not.toContain('basic.slow');
    expect(broker.getClientDebugSnapshot('basic')).toMatchObject({
      spawnCount: 1,
      restartCount: 0,
    });
    expect(taskRegistry.list('macro-shared-server-m1')).toEqual([]);
    expect(taskRegistry.list('macro-shared-server-m2')).toEqual([]);
  });

  it('T-I-002 isolates variables, trace, task_id, progress, budgets, and list_tasks across sessions', async () => {
    const taskRegistry = new MacroTaskRegistry();
    const activeAtBarrier = new Set<string>();
    let releaseBarrier!: () => void;
    const barrierReleased = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const catalog: NativeToolDefinition[] = [
      {
        name: 'search',
        description: 'test barrier search',
        inputSchema: { query: z.string() },
        handler: vi.fn(async (args) => {
          const query = String(args['query']);
          if (query.startsWith('ready:')) {
            activeAtBarrier.add(query.slice('ready:'.length));
            await waitFor(() => activeAtBarrier.size === 2);
            await barrierReleased;
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ query, seen: activeAtBarrier.size }) }],
          };
        }),
      },
    ];

    const source = `
      label = input_var "label"
      first_result = fq.search({ query: $label })
      status --progress 1 --total 2 "progress-$label"
      visible = list_tasks
      second = fq.search({ query: "ready:$label" })
      sleep 50
      exit {
        label: $label,
        first: $first_result,
        second: $second,
        task_id: task_id,
        visible: $visible
      }
    `;

    const firstRun = runMacroSource({
      source,
      inputVars: { label: 'session-a' },
      sessionId: 'session-a',
      taskRegistry,
      config: testConfig(),
      catalog,
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
    });
    const secondRun = runMacroSource({
      source,
      inputVars: { label: 'session-b' },
      sessionId: 'session-b',
      taskRegistry,
      config: testConfig(),
      catalog,
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
    });

    await waitFor(() => activeAtBarrier.size === 2);
    const sessionATasks = taskRegistry.list('session-a');
    const sessionBTasks = taskRegistry.list('session-b');
    expect(sessionATasks).toHaveLength(1);
    expect(sessionBTasks).toHaveLength(1);
    expect(sessionATasks[0]?.status).toBe('working');
    expect(sessionBTasks[0]?.status).toBe('working');
    expect(sessionATasks[0]?.task_id).not.toBe(sessionBTasks[0]?.task_id);

    releaseBarrier();
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    const firstPayload = parseToolText(firstResult.result);
    const secondPayload = parseToolText(secondResult.result);
    const firstValue = firstPayload['result'] as Record<string, unknown>;
    const secondValue = secondPayload['result'] as Record<string, unknown>;

    expect(firstPayload).toMatchObject({
      task_id: sessionATasks[0]?.task_id,
    });
    expect(secondPayload).toMatchObject({
      task_id: sessionBTasks[0]?.task_id,
    });
    expect(firstPayload['task_id']).not.toBe(secondPayload['task_id']);
    expect(firstValue['label']).toBe('session-a');
    expect(secondValue['label']).toBe('session-b');
    expect(firstValue['task_id']).toBe(firstPayload['task_id']);
    expect(secondValue['task_id']).toBe(secondPayload['task_id']);

    const firstVisible = firstValue['visible'] as Array<Record<string, unknown>>;
    const secondVisible = secondValue['visible'] as Array<Record<string, unknown>>;
    expect(firstVisible.map((task) => task['task_id'])).toEqual([firstPayload['task_id']]);
    expect(secondVisible.map((task) => task['task_id'])).toEqual([secondPayload['task_id']]);
    expect(JSON.stringify(firstVisible)).not.toContain(String(secondPayload['task_id']));
    expect(JSON.stringify(secondVisible)).not.toContain(String(firstPayload['task_id']));

    expect(firstPayload['trace']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'tool_call', name: 'fq.search' }),
        expect.objectContaining({ kind: 'progress', message: 'progress-session-a' }),
        expect.objectContaining({ kind: 'exit' }),
      ])
    );
    expect(secondPayload['trace']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'tool_call', name: 'fq.search' }),
        expect.objectContaining({ kind: 'progress', message: 'progress-session-b' }),
        expect.objectContaining({ kind: 'exit' }),
      ])
    );
    expect(JSON.stringify(firstPayload['trace'])).not.toContain('progress-session-b');
    expect(JSON.stringify(secondPayload['trace'])).not.toContain('progress-session-a');
    expect(taskRegistry.list('session-a')).toEqual([]);
    expect(taskRegistry.list('session-b')).toEqual([]);
  });

  it('T-I-002 keeps cancellation requests scoped to the cancelled session', async () => {
    const taskRegistry = new MacroTaskRegistry();
    const activeAtBarrier = new Set<string>();
    let releaseBarrier!: () => void;
    const barrierReleased = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const catalog: NativeToolDefinition[] = [
      {
        name: 'search',
        description: 'test cancellation barrier',
        inputSchema: { query: z.string() },
        handler: vi.fn(async (args) => {
          const query = String(args['query']);
          activeAtBarrier.add(query);
          await waitFor(() => activeAtBarrier.size === 2);
          await barrierReleased;
          return {
            content: [{ type: 'text', text: JSON.stringify({ query }) }],
          };
        }),
      },
    ];

    const source = `
      label = input_var "label"
      fq.search({ query: $label })
      sleep 50
      exit { label: $label, task_id: task_id }
    `;

    const firstRun = runMacroSource({
      source,
      inputVars: { label: 'session-a' },
      sessionId: 'session-a',
      taskRegistry,
      config: testConfig(),
      catalog,
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
    });
    const secondRun = runMacroSource({
      source,
      inputVars: { label: 'session-b' },
      sessionId: 'session-b',
      taskRegistry,
      config: testConfig(),
      catalog,
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
    });

    await waitFor(() => activeAtBarrier.size === 2);
    const sessionATask = taskRegistry.list('session-a')[0];
    const sessionBTask = taskRegistry.list('session-b')[0];
    expect(sessionATask?.task_id).toBeDefined();
    expect(sessionBTask?.task_id).toBeDefined();
    expect(taskRegistry.cancel(String(sessionBTask?.task_id), 'session-a')).toBe(false);
    expect(taskRegistry.cancel(String(sessionATask?.task_id), 'session-a')).toBe(true);

    releaseBarrier();
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    const firstPayload = parseToolText(firstResult.result);
    const secondPayload = parseToolText(secondResult.result);

    expect(firstPayload).toMatchObject({
      error: 'cancelled',
      message: 'Macro cancelled',
      details: {
        task_id: sessionATask?.task_id,
        at_safe_point: 'between_statements',
      },
    });
    expect(secondPayload).toMatchObject({
      task_id: sessionBTask?.task_id,
      result: {
        label: 'session-b',
        task_id: sessionBTask?.task_id,
      },
    });
    expect(secondPayload['error']).toBeUndefined();
    expect(taskRegistry.list('session-a')).toEqual([]);
    expect(taskRegistry.list('session-b')).toEqual([]);
  });
});
