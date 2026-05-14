import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

describe('macro input_var preflight', () => {
  it('T-U-097 binds a required input_var when key is present', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x"\nexit $x'), {
      inputVars: { x: 5 },
    });

    expect(result.isError).toBeUndefined();
    expect(resultOf(parseToolPayload(result))).toBe(5);
  });

  it('T-U-098 reports a missing required input before execution', async () => {
    const result = await evaluateProgram(parseProgram('echo "before"\nx = input_var "x"\nexit $x'), {
      inputVars: {},
    });

    expect(result.isError).toBe(false);
    const payload = parseToolPayload(result);
    expect(payload).toMatchObject({
      error: 'invalid_input',
      details: { missing_inputs: ['x'] },
    });
    expect((payload['trace'] as unknown[] | undefined) ?? []).toEqual([]);
  });

  it('T-U-099 reports all missing required input_var keys together', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x"\ny = input_var "y"\nexit $x'), {
      inputVars: {},
    });

    expect(parseToolPayload(result)).toMatchObject({
      error: 'invalid_input',
      details: { missing_inputs: ['x', 'y'] },
    });
  });

  it('T-U-100 applies a default only when the key is absent', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x" --default 5\nexit $x'), {
      inputVars: {},
    });

    expect(resultOf(parseToolPayload(result))).toBe(5);
  });

  it('T-U-101 treats explicit null as present instead of applying a default', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x" --default 5\nexit $x'), {
      inputVars: { x: null },
    });

    expect(resultOf(parseToolPayload(result))).toBeNull();
  });

  it('T-U-102 rejects non-literal input_var keys during preflight', async () => {
    const result = await evaluateProgram(parseProgram('name = "x"\nx = input_var $name\nexit $x'), {
      inputVars: { x: 1 },
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'input_var_key_must_be_literal' },
    });
  });

  it('T-U-103 rejects boolean-shaped input_var defaults before execution', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x" --default true\nexit $x'), {
      inputVars: {},
    });

    expect(result.isError).toBe(false);
    expect(parseToolPayload(result)).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'input_var_default_must_be_literal' },
    });
  });

  it('T-U-104 binds list defaults', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x" --default [1,2,3]\nexit $x'), {
      inputVars: {},
    });

    expect(resultOf(parseToolPayload(result))).toEqual([1, 2, 3]);
  });

  it('T-U-105 binds object defaults', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x" --default { k: "v" }\nexit $x'), {
      inputVars: {},
    });

    expect(resultOf(parseToolPayload(result))).toEqual({ k: 'v' });
  });

  it('T-U-106 silently accepts undeclared extra input_vars keys', async () => {
    const result = await evaluateProgram(parseProgram('x = input_var "x"\nexit $x'), {
      inputVars: { x: 1, extra: 2 },
    });

    expect(resultOf(parseToolPayload(result))).toBe(1);
  });

  it('T-U-107 iterates list input_vars in for loops', async () => {
    const result = await evaluateProgram(
      parseProgram(`
        phrases = input_var "phrases"
        last = null
        for phrase in $phrases do
          last = $phrase
        done
        exit $last
      `),
      { inputVars: { phrases: ['a', 'b', 'c'] } }
    );

    expect(resultOf(parseToolPayload(result))).toBe('c');
  });

  it('T-U-108 accesses nested object input_vars via field access', async () => {
    const result = await evaluateProgram(parseProgram('obj = input_var "obj"\nexit $obj.deep.value'), {
      inputVars: { obj: { deep: { value: 'ok' } } },
    });

    expect(resultOf(parseToolPayload(result))).toBe('ok');
  });
});
