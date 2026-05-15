import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';

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
    logContext: { tool: 'call_macro' },
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
      first = fq.search({ query: $label })
      status --progress 1 --total 2 "progress-$label"
      visible = list_tasks
      second = fq.search({ query: "ready:$label" })
      sleep 50
      exit {
        label: $label,
        first: $first,
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
