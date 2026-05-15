import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInvocationContext, evaluateProgram } from '../../src/macro/evaluator.js';
import { basicBuiltins, parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

describe('macro evaluator invocation isolation', () => {
  it('T-U-092 does not leak variables across sequential invocations', async () => {
    await evaluateProgram(parseProgram('counter = 5\nexit $counter'), { builtins: basicBuiltins() });

    const result = await evaluateProgram(parseProgram('exit $counter'), { builtins: basicBuiltins() });

    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({ error: 'tool_call_failed' });
  });

  it('T-U-093 runs the same macro source twice with fresh variables each time', async () => {
    const program = parseProgram('counter = 0\ncounter = add $counter 1\nexit $counter');

    const first = await evaluateProgram(program, { builtins: basicBuiltins() });
    const second = await evaluateProgram(program, { builtins: basicBuiltins() });

    expect(resultOf(parseToolPayload(first))).toBe(1);
    expect(resultOf(parseToolPayload(second))).toBe(1);
  });

  it('T-U-094 keeps trace buffers per invocation', async () => {
    const first = await evaluateProgram(parseProgram('exit "first"'), { builtins: basicBuiltins() });
    const second = await evaluateProgram(parseProgram('exit "second"'), { builtins: basicBuiltins() });

    const firstTrace = parseToolPayload(first)['trace'];
    const secondTrace = parseToolPayload(second)['trace'];
    expect(firstTrace).not.toBe(secondTrace);
    expect(firstTrace).toEqual([expect.objectContaining({ kind: 'exit', result: 'first' })]);
    expect(secondTrace).toEqual([expect.objectContaining({ kind: 'exit', result: 'second' })]);
  });

  it('T-U-094 owns trace, inputVars, budget, progress, cancellation state, and task IDs per invocation', () => {
    const inputVars = { nested: { value: 1 } };
    const first = createInvocationContext({ inputVars, builtins: basicBuiltins() });
    const second = createInvocationContext({ input_vars: inputVars, builtins: basicBuiltins() });

    inputVars.nested.value = 2;

    expect(first.inputVars).toEqual({ nested: { value: 1 } });
    expect(first.inputVars).not.toBe(inputVars);
    expect(first.trace).not.toBe(second.trace);
    expect(first.budget).not.toBe(second.budget);
    expect(first.progress).not.toBe(second.progress);
    expect(first.cancelled).not.toBe(second.cancelled);
    expect(first.taskId).not.toBe(second.taskId);
  });

  it('places cancellation hooks at statement, call, loop, tool, and multi-stage pipeline boundaries', async () => {
    const seen: string[] = [];
    await evaluateProgram(
      parseProgram(`
        i = 0
        for item in [1,2] do
          i = add $i 1
        done
        while $i < 3 do
          i = add $i 1
        done
        echo "a" | echo "b"
        fq.ping({})
        exit $i
      `),
      {
        builtins: basicBuiltins(),
        dispatchTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
        checkCancelled: (where) => {
          seen.push(where);
        },
      }
    );

    expect(seen).toContain('between_statements');
    expect(seen).toContain('before_call:add');
    expect(seen).toContain('before_tool_call:fq.ping');
    expect(seen).toContain('for_loop_iteration');
    expect(seen).toContain('while_loop_iteration');
    expect(seen).toContain('between_pipeline_stages');
  });

  it('T-U-094 concurrent smoke keeps unit invocations isolated; T-I-002 covered by tests/integration/macro-concurrency.test.ts and T-I-002b by macro-call-macro-session.test.ts', async () => {
    const builtins = basicBuiltins({
      capture: async (_args, context) => {
        context.budget.external_tool_calls += 1;
        context.progress.push({ message: String(context.inputVars['label']) });
        await Promise.resolve();
        return {
          label: context.inputVars['label'],
          task: context.taskId,
          progress: [...context.progress],
          calls: context.budget.external_tool_calls,
          cancelled: context.cancelled.value,
        };
      },
    });

    const [first, second] = await Promise.all([
      evaluateProgram(parseProgram('value = capture\nexit $value'), {
        builtins,
        inputVars: { label: 'A' },
      }),
      evaluateProgram(parseProgram('value = capture\nexit $value'), {
        builtins,
        inputVars: { label: 'B' },
      }),
    ]);

    const firstResult = resultOf(parseToolPayload(first)) as Record<string, unknown>;
    const secondResult = resultOf(parseToolPayload(second)) as Record<string, unknown>;
    expect(firstResult['label']).toBe('A');
    expect(secondResult['label']).toBe('B');
    expect(firstResult['task']).not.toBe(secondResult['task']);
    expect(firstResult['progress']).toEqual([{ message: 'A' }]);
    expect(secondResult['progress']).toEqual([{ message: 'B' }]);
    expect(firstResult['calls']).toBe(1);
    expect(secondResult['calls']).toBe(1);
    expect(firstResult['cancelled']).toBe(false);
    expect(secondResult['cancelled']).toBe(false);
  });

  it('does not copy the prototype taskregistry or module-level env/trace state', () => {
    const source = readFileSync('src/macro/evaluator.ts', 'utf8');
    expect(source).not.toContain('taskregistry');
    expect(source).not.toMatch(/^const env =/m);
    expect(source).not.toMatch(/^const trace =/m);
  });
});
