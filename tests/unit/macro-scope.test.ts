import { describe, expect, it } from 'vitest';
import { evaluateProgram, MacroRuntimeError } from '../../src/macro/evaluator.js';
import { basicBuiltins, parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

describe('macro evaluator scope semantics', () => {
  it('T-U-067 updates nearest existing binding from inside for-loop body', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        i = 0
        for item in [1,2,3] do
          i = add $i 1
        done
        exit $i
      `),
      { builtins: basicBuiltins() }
    );

    expect(resultOf(parseToolPayload(result))).toBe(3);
  });

  it('T-U-068 keeps a new if-branch name local to that branch', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        if 1 == 1 then
          X = "branch"
        fi
        echo $X
      `),
      { builtins: basicBuiltins() }
    );

    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)['error']).toBe('tool_call_failed');
  });

  it('T-U-069 walk-up assignment applies inside if branches', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        X = "outer"
        if 1 == 1 then
          X = "updated"
        fi
        exit $X
      `),
      { builtins: basicBuiltins() }
    );

    expect(resultOf(parseToolPayload(result))).toBe('updated');
  });

  it('T-U-070 walk-up assignment applies inside while body', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        i = 0
        while $i < 3 do
          i = add $i 1
        done
        exit $i
      `),
      { builtins: basicBuiltins() }
    );

    expect(resultOf(parseToolPayload(result))).toBe(3);
  });

  it('T-U-071 keeps for-loop iterator local even when it shadows an outer name', async () => {
    const observed: unknown[] = [];
    const result = await evaluateProgram(
      parseProgram(`
        X = "outer"
        for X in [1,2,3] do
          echo $X
        done
        exit $X
      `),
      {
        builtins: basicBuiltins({
          echo: (args) => {
            observed.push(args[0]);
            return null;
          },
        }),
      }
    );

    expect(observed).toEqual([1, 2, 3]);
    expect(resultOf(parseToolPayload(result))).toBe('outer');
  });

  it('T-U-072 still walk-up mutates non-iterator names inside for-loop bodies', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        counter = 0
        for item in [1,2] do
          counter = add $counter 1
        done
        exit $counter
      `),
      { builtins: basicBuiltins() }
    );

    expect(resultOf(parseToolPayload(result))).toBe(2);
  });

  it('exposes MacroRuntimeError for direct consumers', () => {
    expect(new MacroRuntimeError('boom')).toBeInstanceOf(Error);
  });
});
