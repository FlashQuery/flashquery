import { describe, expect, it } from 'vitest';
import { MacroTaskRegistry } from '../../src/macro/task-registry.js';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

describe('macro task session scoping', () => {
  it('T-U-185 list_tasks returns only records for the active session and strips session markers', async () => {
    const taskRegistry = new MacroTaskRegistry();
    const ownTask = taskRegistry.create({ sessionId: 'session-a', source: 'exit list_tasks' });
    const otherTask = taskRegistry.create({ sessionId: 'session-b', source: 'sleep 1000' });

    const result = await evaluateProgram(parseProgram('exit list_tasks'), {
      taskId: ownTask.task_id,
      sessionId: 'session-a',
      listTasks: () => taskRegistry.list('session-a'),
    });

    const visibleTasks = resultOf(parseToolPayload(result));
    expect(visibleTasks).toEqual([
      expect.objectContaining({
        task_id: ownTask.task_id,
        status: 'working',
      }),
    ]);
    expect(JSON.stringify(visibleTasks)).not.toContain(otherTask.task_id);
    expect(JSON.stringify(visibleTasks)).not.toContain('session-a');
    expect(JSON.stringify(visibleTasks)).not.toContain('session-b');
  });

  it('T-U-186 taskRegistry.cancel refuses cross-session cancellation and leaves the target working', () => {
    const taskRegistry = new MacroTaskRegistry();
    const ownTask = taskRegistry.create({ sessionId: 'session-a', source: 'sleep 1000' });
    const otherTask = taskRegistry.create({ sessionId: 'session-b', source: 'sleep 1000' });

    expect(taskRegistry.cancel(otherTask.task_id, 'session-a')).toBe(false);
    expect(taskRegistry.get(otherTask.task_id, 'session-b')).toMatchObject({
      task_id: otherTask.task_id,
      status: 'working',
      session_id: 'session-b',
    });

    expect(taskRegistry.cancel(ownTask.task_id, 'session-a')).toBe(true);
    expect(taskRegistry.get(ownTask.task_id, 'session-a')).toBeUndefined();
  });

  it('T-U-185/T-U-186 cross-session visibility and cancellation are forbidden together', () => {
    const taskRegistry = new MacroTaskRegistry();
    const sessionATask = taskRegistry.create({ sessionId: 'session-a', source: 'sleep 1000' });
    const sessionBTask = taskRegistry.create({ sessionId: 'session-b', source: 'sleep 1000' });

    expect(taskRegistry.list('session-a').map((task) => task.task_id)).toEqual([sessionATask.task_id]);
    expect(taskRegistry.list('session-a').map((task) => task.task_id)).not.toContain(sessionBTask.task_id);
    expect(taskRegistry.cancel(sessionBTask.task_id, 'session-a')).toBe(false);
    expect(taskRegistry.cancel(sessionATask.task_id, 'session-a')).toBe(true);
  });
});
