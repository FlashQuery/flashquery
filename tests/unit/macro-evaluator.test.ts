import { describe, expect, it } from 'vitest';
import { evaluateProgram, isTruthy, MacroRuntimeError } from '../../src/macro/evaluator.js';
import type { Program } from '../../src/macro/types.js';
import { basicBuiltins, parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

describe('macro evaluator expression semantics', () => {
  it('T-U-035 deep equality matches same-typed equal values', async () => {
    for (const source of ['exit 5 == 5', 'exit "x" == "x"', 'exit [1,2] == [1,2]', 'exit null == null']) {
      const result = await evaluateProgram(parseProgram(source), { builtins: basicBuiltins() });
      expect(resultOf(parseToolPayload(result))).toBe(true);
    }
  });

  it('T-U-036 cross-type equality has no implicit coercion', async () => {
    const result = await evaluateProgram(parseProgram('exit "5" == 5'), { builtins: basicBuiltins() });
    expect(resultOf(parseToolPayload(result))).toBe(false);
  });

  it('T-U-037 numeric ordering comparisons are deterministic', async () => {
    for (const source of ['exit 5 < 10', 'exit 5 <= 5', 'exit 10 > 5', 'exit 5 >= 5']) {
      const result = await evaluateProgram(parseProgram(source), { builtins: basicBuiltins() });
      expect(resultOf(parseToolPayload(result))).toBe(true);
    }
  });

  it('T-U-038 string ordering raises comparison_type_mismatch', async () => {
    const result = await evaluateProgram(parseProgram('exit "a" < "b"'), { builtins: basicBuiltins() });
    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'tool_call_failed',
      details: { reason: 'comparison_type_mismatch' },
    });
  });

  it('T-U-039 && short-circuit skips RHS when LHS is falsy', async () => {
    let calls = 0;
    const result = await evaluateProgram(parseProgram('exit 0 && bump'), {
      builtins: basicBuiltins({
        bump: () => {
          calls += 1;
          return true;
        },
      }),
    });

    expect(resultOf(parseToolPayload(result))).toBe(false);
    expect(calls).toBe(0);
  });

  it('T-U-040 || short-circuit skips RHS when LHS is truthy', async () => {
    let calls = 0;
    const result = await evaluateProgram(parseProgram('exit "yes" || bump'), {
      builtins: basicBuiltins({
        bump: () => {
          calls += 1;
          return false;
        },
      }),
    });

    expect(resultOf(parseToolPayload(result))).toBe(true);
    expect(calls).toBe(0);
  });

  it('T-U-041 unary ! negates truthiness', async () => {
    const truthy = await evaluateProgram(parseProgram('exit !"x"'), { builtins: basicBuiltins() });
    const falsy = await evaluateProgram(parseProgram('exit !0'), { builtins: basicBuiltins() });
    expect(resultOf(parseToolPayload(truthy))).toBe(false);
    expect(resultOf(parseToolPayload(falsy))).toBe(true);
  });

  it('T-U-044 evaluates 0..5 as an end-exclusive range', async () => {
    const result = await evaluateProgram(parseProgram('exit 0..5'), { builtins: basicBuiltins() });
    expect(resultOf(parseToolPayload(result))).toEqual([0, 1, 2, 3, 4]);
  });

  it('T-U-045 evaluates start..$end ranges from variables', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        start = 2
        end = 5
        exit $start..$end
      `),
      { builtins: basicBuiltins() }
    );
    expect(resultOf(parseToolPayload(result))).toEqual([2, 3, 4]);
  });

  it('T-U-046 rejects non-integer range operands with range_operand_type_mismatch', async () => {
    const result = await evaluateProgram(parseProgram('exit 1.5..5'), { builtins: basicBuiltins() });
    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'tool_call_failed',
      details: { reason: 'range_operand_type_mismatch' },
    });
  });

  it('T-U-058 iterates equivalently over range builtin, range operator, list literal, and list variable', async () => {
    const cases = [
      {
        label: 'range builtin',
        source: `
          for item in range 3 do
            observe $item
          done
          exit "done"
        `,
      },
      {
        label: 'range operator',
        source: `
          for item in 0..3 do
            observe $item
          done
          exit "done"
        `,
      },
      {
        label: 'list literal',
        source: `
          for item in [0,1,2] do
            observe $item
          done
          exit "done"
        `,
      },
      {
        label: 'list variable',
        source: `
          items = [0,1,2]
          for item in $items do
            observe $item
          done
          exit "done"
        `,
      },
    ];

    for (const { label, source } of cases) {
      const observed: unknown[] = [];
      const result = await evaluateProgram(parseProgram(source), {
        builtins: basicBuiltins({
          observe: (args) => {
            observed.push(args[0]);
            return null;
          },
          range: (args) => Array.from({ length: Number(args[0] ?? 0) }, (_, index) => index),
        }),
      });

      expect(resultOf(parseToolPayload(result)), label).toBe('done');
      expect(observed, label).toEqual([0, 1, 2]);
    }
  });

  it('T-U-042 continue inside a for loop skips to the next iteration', async () => {
    const observed: unknown[] = [];
    const result = await evaluateProgram(
      parseProgram(`
        for item in [1,2,3] do
          if $item == 2 then
            continue
          fi
          observe $item
        done
        exit "done"
      `),
      {
        builtins: basicBuiltins({
          observe: (args) => {
            observed.push(args[0]);
            return null;
          },
        }),
      }
    );

    expect(resultOf(parseToolPayload(result))).toBe('done');
    expect(observed).toEqual([1, 3]);
  });

  it('T-U-043 break inside a while loop exits past done and following statements run', async () => {
    const observed: unknown[] = [];
    const result = await evaluateProgram(
      parseProgram(`
        counter = 0
        while $counter < 5 do
          counter = add $counter 1
          if $counter == 3 then
            break
          fi
          observe $counter
        done
        exit { counter: $counter, observed: "after" }
      `),
      {
        builtins: basicBuiltins({
          observe: (args) => {
            observed.push(args[0]);
            return null;
          },
        }),
      }
    );

    expect(resultOf(parseToolPayload(result))).toEqual({ counter: 3, observed: 'after' });
    expect(observed).toEqual([1, 2]);
  });

  it('T-U-073 treats null, 0, 0.0, "", [], and {} as falsy in if', async () => {
    for (const falsy of ['null', '0', '0.0', '""', '[]', '{}']) {
      const result = await evaluateProgram(
        parseProgram(`if ${falsy} then\n  exit "then"\nelse\n  exit "else"\nfi`),
        { builtins: basicBuiltins() }
      );
      expect(resultOf(parseToolPayload(result))).toBe('else');
    }
  });

  it('T-U-074 treats "false" and "0" strings as truthy in if', async () => {
    for (const truthy of ['"false"', '"0"']) {
      const result = await evaluateProgram(
        parseProgram(`if ${truthy} then\n  exit "then"\nelse\n  exit "else"\nfi`),
        { builtins: basicBuiltins() }
      );
      expect(resultOf(parseToolPayload(result))).toBe('then');
    }
  });

  it('T-U-075 treats negative numbers as truthy in if', async () => {
    const result = await evaluateProgram(
      parseProgram('if -1 then\n  exit "then"\nelse\n  exit "else"\nfi'),
      { builtins: basicBuiltins() }
    );
    expect(resultOf(parseToolPayload(result))).toBe('then');
  });

  it('keeps direct isTruthy helper semantics aligned with truthiness consumers', () => {
    expect([null, 0, 0.0, '', [], {}].map((value) => isTruthy(value))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(isTruthy('false')).toBe(true);
    expect(isTruthy('0')).toBe(true);
    expect(isTruthy(-1)).toBe(true);
  });

  it('T-U-076 interpolates simple $name references', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        name = "Ada"
        exit "hello $name"
      `),
      { builtins: basicBuiltins() }
    );
    expect(resultOf(parseToolPayload(result))).toBe('hello Ada');
  });

  it('T-U-077 interpolates chained $obj.field.nested references', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        obj = { field: { nested: "leaf" } }
        exit "path: $obj.field.nested"
      `),
      { builtins: basicBuiltins() }
    );
    expect(resultOf(parseToolPayload(result))).toBe('path: leaf');
  });

  it('T-U-078 interpolates braced ${var.field} references', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        obj = { field: "leaf" }
        exit "\${obj.field}"
      `),
      { builtins: basicBuiltins() }
    );
    expect(resultOf(parseToolPayload(result))).toBe('leaf');
  });

  it('T-U-079 preserves escaped dollars as literal $name text', async () => {
    const result = await evaluateProgram(parseProgram(String.raw`exit "\$name"`), {
      builtins: basicBuiltins(),
    });
    expect(resultOf(parseToolPayload(result))).toBe('$name');
  });

  it('T-U-080 leaves single-quoted non-interpolated strings literal', async () => {
    const result = await evaluateProgram(parseProgram(String.raw`exit '$name'`), {
      builtins: basicBuiltins(),
    });
    expect(resultOf(parseToolPayload(result))).toBe('$name');
  });

  it('T-U-081 resolves chained field access to the leaf value', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        obj = { a: { b: { c: 42 } } }
        exit $obj.a.b.c
      `),
      { builtins: basicBuiltins() }
    );
    expect(resultOf(parseToolPayload(result))).toBe(42);
  });

  it('T-U-082 rejects field access on null', async () => {
    const result = await evaluateProgram(parseProgram('obj = null\nexit $obj.a'), {
      builtins: basicBuiltins(),
    });
    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({ details: { reason: 'invalid_field_target' } });
  });

  it('T-U-083 rejects field access on numbers', async () => {
    const result = await evaluateProgram(parseProgram('obj = 1\nexit $obj.a'), {
      builtins: basicBuiltins(),
    });
    expect(result.isError).toBe(true);
    expect(parseToolPayload(result)).toMatchObject({ details: { reason: 'invalid_field_target' } });
  });

  it('T-U-095 captures RHS values at assignment evaluation time', async () => {
    const result = await evaluateProgram(parseProgram('x = 1\ny = $x\nx = 2\nexit $y'), {
      builtins: basicBuiltins(),
    });
    expect(resultOf(parseToolPayload(result))).toBe(1);
  });

  it('T-U-096 keeps stub append/unique/concat builtins immutable', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        source = [1,2]
        appended = append $source 3
        unique_items = unique [1,1,2]
        joined = concat $source [4]
        exit { source: $source, appended: $appended, unique: $unique_items, joined: $joined }
      `),
      {
        builtins: basicBuiltins({
          append: (args) => [...(args[0] as unknown[]), args[1]] as never,
          unique: (args) => Array.from(new Set(args[0] as unknown[])) as never,
          concat: (args) => [...(args[0] as unknown[]), ...(args[1] as unknown[])] as never,
        }),
      }
    );

    expect(resultOf(parseToolPayload(result))).toEqual({
      source: [1, 2],
      appended: [1, 2, 3],
      unique: [1, 2],
      joined: [1, 2, 4],
    });
  });

  it('exposes MacroRuntimeError for expression callers', () => {
    expect(new MacroRuntimeError('boom', 1, { reason: 'test' }).details).toEqual({ reason: 'test' });
  });
});

describe('macro evaluator direct AST support', () => {
  it('supports direct program construction for expression tests', async () => {
    const program: Program = { kind: 'Program', statements: [{ kind: 'Pipeline', line: 1, stages: [{ kind: 'Call', name: 'exit', line: 1, args: [{ kind: 'PositionalArg', value: { kind: 'NumLit', value: 1 } }] }] }] };
    const result = await evaluateProgram(program, { builtins: basicBuiltins() });
    expect(resultOf(parseToolPayload(result))).toBe(1);
  });
});
