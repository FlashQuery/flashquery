import { describe, expect, it, vi } from 'vitest';
import {
  evaluateProgram,
  MacroCancellationError,
  type MacroBuiltin,
  type MacroValue,
} from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload } from './macro-test-helpers.js';

function cancellationAt(taskId: string, atSafePoint: string): never {
  throw new MacroCancellationError(taskId, atSafePoint);
}

function cancellationBuiltins(markers: string[]): Record<string, MacroBuiltin> {
  return {
    mark: (positional) => {
      markers.push(String(positional[0]));
      return positional[0] ?? null;
    },
    value: (positional) => {
      markers.push(`arg:${String(positional[0])}`);
      return positional[0] ?? null;
    },
    echo: (positional) => {
      markers.push(String(positional[0]));
      return positional[0] ?? null;
    },
  };
}

describe('macro cooperative cancellation safe points', () => {
  it('T-U-178 cancellation between statements halts before the next side effect', async () => {
    const markers: string[] = [];
    let statementsSeen = 0;

    const result = await evaluateProgram(parseProgram('mark "first"\nmark "second"'), {
      taskId: 'task-cancel-statements',
      builtins: cancellationBuiltins(markers),
      checkCancelled: (where) => {
        if (where === 'between statements') {
          statementsSeen += 1;
          if (statementsSeen === 2) {
            cancellationAt('task-cancel-statements', where);
          }
        }
      },
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'cancelled',
      message: 'Macro cancelled',
      details: {
        task_id: 'task-cancel-statements',
        at_safe_point: expect.stringContaining('between statements'),
      },
    });
    expect(markers).toEqual(['first']);
  });

  it('T-U-178b cancellation before a statement halts before that statement side effect', async () => {
    const markers: string[] = [];

    const result = await evaluateProgram(parseProgram('mark "never"'), {
      taskId: 'task-cancel-before-statement',
      builtins: cancellationBuiltins(markers),
      checkCancelled: (where) => {
        if (where === 'before statement') {
          cancellationAt('task-cancel-before-statement', where);
        }
      },
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'cancelled',
      message: 'Macro cancelled',
      details: {
        task_id: 'task-cancel-before-statement',
        at_safe_point: 'before statement',
      },
    });
    expect(markers).toEqual([]);
  });

  it('T-U-179 checks cancellation after tool arg evaluation and before dispatch', async () => {
    const markers: string[] = [];
    const toolCalls: string[] = [];

    const result = await evaluateProgram(parseProgram('fq.write({ value: value "arg-side-effect" })'), {
      taskId: 'task-cancel-tool',
      builtins: cancellationBuiltins(markers),
      dispatchTool: async (_server, tool) => {
        toolCalls.push(tool);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
      checkCancelled: (where) => {
        if (where.includes('before tool call')) {
          cancellationAt('task-cancel-tool', where);
        }
      },
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'cancelled',
      details: {
        task_id: 'task-cancel-tool',
        at_safe_point: expect.stringContaining('before tool call'),
      },
    });
    expect(markers).toEqual(['arg:arg-side-effect']);
    expect(toolCalls).toEqual([]);
  });

  it('T-U-180 cancellation between for-loop iterations prevents the next iterator binding/body', async () => {
    const markers: string[] = [];
    let iterationsSeen = 0;

    const result = await evaluateProgram(
      parseProgram(`
        for item in ["first", "second"] do
          mark $item
        done
      `),
      {
        taskId: 'task-cancel-loop',
        builtins: cancellationBuiltins(markers),
        checkCancelled: (where) => {
          if (where === 'for-loop iteration') {
            iterationsSeen += 1;
            if (iterationsSeen === 2) {
              cancellationAt('task-cancel-loop', where);
            }
          }
        },
      }
    );

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'cancelled',
      details: { at_safe_point: expect.stringContaining('for-loop iteration') },
    });
    expect(markers).toEqual(['first']);
  });

  it('T-U-181 cancellation between pipeline stages prevents the next stage', async () => {
    const markers: string[] = [];

    const result = await evaluateProgram(parseProgram('mark "first" | mark "second"'), {
      taskId: 'task-cancel-pipeline',
      builtins: cancellationBuiltins(markers),
      checkCancelled: (where) => {
        if (where === 'between pipeline stages') {
          cancellationAt('task-cancel-pipeline', where);
        }
      },
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'cancelled',
      details: { at_safe_point: expect.stringContaining('between pipeline stages') },
    });
    expect(markers).toEqual(['first']);
  });

  it('T-U-182 observes cancellation inside sleep after a 100 ms async chunk', async () => {
    vi.useFakeTimers();
    const source = parseProgram('sleep 250\nmark "late"');
    const run = evaluateProgram(source, {
      taskId: 'task-cancel-sleep',
      builtins: cancellationBuiltins([]),
      checkCancelled: (where) => {
        if (where === 'inside sleep') {
          cancellationAt('task-cancel-sleep', where);
        }
      },
    });

    await vi.advanceTimersByTimeAsync(100);
    const result = await run;
    vi.useRealTimers();

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'cancelled',
      details: { at_safe_point: expect.stringContaining('inside sleep') },
    });
  });

  it('T-U-183 returns the canonical non-error cancellation envelope', async () => {
    const result = await evaluateProgram(parseProgram('mark "never"'), {
      taskId: 'task-cancel-envelope',
      builtins: cancellationBuiltins([]),
      checkCancelled: (where) => cancellationAt('task-cancel-envelope', where),
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toEqual({
      error: 'cancelled',
      message: 'Macro cancelled',
      details: {
        task_id: 'task-cancel-envelope',
        at_safe_point: 'between statements',
      },
    });
  });

  it('T-U-184 cancellation during an in-flight tool call waits for the next safe point', async () => {
    const markers: string[] = [];
    let toolCompleted = false;
    let cancelAfterTool = false;

    const result = await evaluateProgram(parseProgram('fq.slow({})\nmark "after"'), {
      taskId: 'task-cancel-inflight-tool',
      builtins: cancellationBuiltins(markers),
      dispatchTool: async (): Promise<{ content: [{ type: 'text'; text: string }] }> => {
        cancelAfterTool = true;
        await Promise.resolve();
        toolCompleted = true;
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
      checkCancelled: (where) => {
        if (cancelAfterTool && where === 'between statements') {
          cancellationAt('task-cancel-inflight-tool', where);
        }
      },
    });

    expect(result.isError).toBe(false);
    expect(toolCompleted).toBe(true);
    expect(markers).toEqual([]);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'cancelled',
      message: 'Macro cancelled',
      details: {
        task_id: 'task-cancel-inflight-tool',
        at_safe_point: expect.stringContaining('between statements'),
      },
    });
  });
});
