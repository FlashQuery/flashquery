import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  MACRO_TASK_STATUSES,
  MacroTaskRegistry,
} from '../../src/macro/task-registry.js';
import { runMacroSource } from '../../src/mcp/tools/macro.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';

function testConfig(): FlashQueryConfig {
  return {
    instance: {
      id: 'test-instance',
      vault: { path: process.cwd() },
    },
    server: {},
  } as FlashQueryConfig;
}

function nativeDispatchContext(): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: 'test-instance',
    logContext: { tool: 'call_macro' },
  };
}

describe('macro task registry lifecycle', () => {
  it('T-U-172 creating a task stores working state, UUID task_id, and session_id', () => {
    const registry = new MacroTaskRegistry();

    const record = registry.create({ sessionId: 'session-a', source: 'exit "ok"' });

    expect(record.task_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(record.status).toBe('working');
    expect(record.session_id).toBe('session-a');
    expect(registry.get(record.task_id, 'session-a')).toMatchObject({
      task_id: record.task_id,
      status: 'working',
      session_id: 'session-a',
    });
  });

  it('T-U-173 successful macro completion transitions to completed and removes the record immediately', async () => {
    const registry = new MacroTaskRegistry();
    const observed: string[] = [];

    await runMacroSource({
      source: 'exit "done"',
      sessionId: 'session-a',
      taskRegistry: registry,
      config: testConfig(),
      catalog: [] satisfies NativeToolDefinition[],
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
      onTaskTransition: (record) => observed.push(record.status),
    });

    expect(observed).toEqual(['working', 'completed']);
    const completedTaskId = observed.length > 0 ? registry.list()[0]?.task_id : undefined;
    expect(completedTaskId).toBeUndefined();
    expect(registry.list('session-a')).toEqual([]);
  });

  it('T-U-174 fail and runtime-error paths transition to failed and remove the record immediately', async () => {
    const registry = new MacroTaskRegistry();
    const observed: string[] = [];

    await runMacroSource({
      source: 'fail "stop"',
      sessionId: 'session-a',
      taskRegistry: registry,
      config: testConfig(),
      catalog: [] satisfies NativeToolDefinition[],
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
      onTaskTransition: (record) => observed.push(record.status),
    });

    await runMacroSource({
      source: 'exit $missing',
      sessionId: 'session-a',
      taskRegistry: registry,
      config: testConfig(),
      catalog: [] satisfies NativeToolDefinition[],
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
      onTaskTransition: (record) => observed.push(record.status),
    });

    expect(observed).toEqual(['working', 'failed', 'working', 'failed']);
    expect(registry.list('session-a')).toEqual([]);
  });

  it('T-U-175 cancellation observed at a safe point transitions to cancelled and removes the record immediately', async () => {
    const registry = new MacroTaskRegistry();
    const observed: string[] = [];
    const created = registry.create({ sessionId: 'session-a', source: 'sleep 200\nexit "late"' });

    registry.cancel(created.task_id, 'session-a');

    await runMacroSource({
      source: 'sleep 200\nexit "late"',
      sessionId: 'session-a',
      taskId: created.task_id,
      taskRegistry: registry,
      config: testConfig(),
      catalog: [] satisfies NativeToolDefinition[],
      broker: new NullMcpBroker(),
      nativeDispatchContext: nativeDispatchContext(),
      onTaskTransition: (record) => observed.push(record.status),
    });

    expect(observed).toContain('cancelled');
    expect(registry.get(created.task_id, 'session-a')).toBeUndefined();
  });

  it('T-U-176 registry construction and lifecycle operations do not touch storage modules', () => {
    const storageSource = readFileSync('src/macro/task-registry.ts', 'utf8');
    expect(storageSource).not.toMatch(/Supabase|supabase|fqc_|tasks\/get|tasks\/cancel/);

    const registry = new MacroTaskRegistry();
    const record = registry.create({ sessionId: 'session-a', source: 'exit null' });
    registry.complete(record.task_id);

    expect(registry.get(record.task_id, 'session-a')).toBeUndefined();
  });

  it('T-U-177 exposes exactly the public task status vocabulary', () => {
    expect(MACRO_TASK_STATUSES).toEqual(['working', 'completed', 'failed', 'cancelled']);
  });
});

vi.mock('../../src/storage/supabase.js', () => {
  throw new Error('macro task registry must not import Supabase storage');
});
