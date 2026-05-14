import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateProgram } from '../../src/macro/evaluator.js';
import { parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';

async function run(source: string, options: Parameters<typeof evaluateProgram>[1] = {}) {
  const result = await evaluateProgram(parseProgram(source), options);
  return { result, payload: parseToolPayload(result) };
}

describe('macro standard library range builtins', () => {
  it('T-U-047 range 5 returns a half-open zero-based list', async () => {
    const { payload } = await run('exit range 5');
    expect(resultOf(payload)).toEqual([0, 1, 2, 3, 4]);
  });

  it('T-U-048 range 2 8 returns a half-open start/end list', async () => {
    const { payload } = await run('exit range 2 8');
    expect(resultOf(payload)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('T-U-049 range 0 10 2 supports positive custom steps', async () => {
    const { payload } = await run('exit range 0 10 2');
    expect(resultOf(payload)).toEqual([0, 2, 4, 6, 8]);
  });

  it('T-U-050 range 10 0 -1 supports negative custom steps', async () => {
    const { payload } = await run('exit range 10 0 -1');
    expect(resultOf(payload)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('T-U-051 range 0 10 0 returns range_step_zero', async () => {
    const { result, payload } = await run('exit range 0 10 0');
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      error: 'tool_call_failed',
      details: { reason: 'range_step_zero' },
    });
  });
});

describe('macro standard library data builtins', () => {
  it('T-U-109 count supports lists, strings, and null', async () => {
    const { payload } = await run('exit { list: count [1,2,3], text: count "abc", empty: count null }');
    expect(resultOf(payload)).toEqual({ list: 3, text: 3, empty: 0 });
  });

  it('T-U-110 count rejects objects with count_type_mismatch', async () => {
    const { result, payload } = await run('exit count { k: "v" }');
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ details: { reason: 'count_type_mismatch' } });
  });

  it('T-U-111 unique preserves first occurrence order for primitive values', async () => {
    const { payload } = await run('exit unique [1,2,1,3,2,3]');
    expect(resultOf(payload)).toEqual([1, 2, 3]);
  });

  it('T-U-112 unique uses deep equality for objects independent of key order', async () => {
    const { payload } = await run('exit unique [{a:1,b:2}, {b:2,a:1}, {a:2}]');
    expect(resultOf(payload)).toEqual([
      { a: 1, b: 2 },
      { a: 2 },
    ]);
  });

  it('T-U-113 append returns a new list and leaves the original bound value unchanged', async () => {
    const { payload } = await run('source = [1,2]\nappended = append $source 3 4\nexit { source: $source, appended: $appended }');
    expect(resultOf(payload)).toEqual({ source: [1, 2], appended: [1, 2, 3, 4] });
  });

  it('T-U-114 concat supports all strings or all lists and rejects mixed types', async () => {
    const strings = await run('exit concat "a" "b" "c"');
    const lists = await run('source = [1]\njoined = concat $source [2] [3]\nexit { source: $source, joined: $joined }');
    const mixed = await run('exit concat "a" [1]');

    expect(resultOf(strings.payload)).toBe('abc');
    expect(resultOf(lists.payload)).toEqual({ source: [1], joined: [1, 2, 3] });
    expect(mixed.result.isError).toBe(true);
    expect(mixed.payload).toMatchObject({ details: { reason: 'concat_type_mismatch' } });
  });
});

describe('macro standard library arithmetic builtins', () => {
  it('T-U-115 add sums numbers, returns zero for no args, and rejects non-numbers', async () => {
    expect(resultOf((await run('exit add 1 2 3')).payload)).toBe(6);
    expect(resultOf((await run('exit add')).payload)).toBe(0);
    const invalid = await run('exit add "a" 1');
    expect(invalid.result.isError).toBe(true);
    expect(invalid.payload).toMatchObject({ details: { reason: 'arithmetic_operand_type' } });
  });

  it('T-U-116 sub negates one arg and left-folds multiple args', async () => {
    expect(resultOf((await run('exit sub 10')).payload)).toBe(-10);
    expect(resultOf((await run('exit sub 10 3 2')).payload)).toBe(5);
  });

  it('T-U-117 mul multiplies values and returns one for no args', async () => {
    expect(resultOf((await run('exit mul 2 3 4')).payload)).toBe(24);
    expect(resultOf((await run('exit mul')).payload)).toBe(1);
  });

  it('T-U-118 div truncates integer division and rejects divide by zero', async () => {
    expect(resultOf((await run('exit div 10 3')).payload)).toBe(3);
    const invalid = await run('exit div 1 0');
    expect(invalid.result.isError).toBe(true);
    expect(invalid.payload).toMatchObject({ details: { reason: 'div_by_zero' } });
  });

  it('T-U-119 mod returns a positive-result modulus and rejects bad calls', async () => {
    expect(resultOf((await run('exit mod 17 5')).payload)).toBe(2);
    expect(resultOf((await run('exit mod -7 3')).payload)).toBe(2);
    const invalidCount = await run('exit mod 1');
    const invalidZero = await run('exit mod 1 0');
    expect(invalidCount.payload).toMatchObject({ details: { reason: 'mod_argument_count' } });
    expect(invalidZero.payload).toMatchObject({ details: { reason: 'mod_by_zero' } });
  });
});

describe('macro standard library async utility builtins', () => {
  it('L-133-SLEEP-001 sleep 0 returns null without trace/log/progress records', async () => {
    const { payload } = await run('exit sleep 0');
    expect(resultOf(payload)).toBeNull();
    expect(payload['trace']).toEqual([{ kind: 'exit', result: null, at: expect.any(String) }]);
  });

  it('L-133-SLEEP-002 sleep rejects invalid duration values', async () => {
    const negative = await run('exit sleep -1');
    const wrongType = await run('exit sleep "x"');
    expect(negative.payload).toMatchObject({ details: { reason: 'sleep_duration_negative' } });
    expect(wrongType.payload).toMatchObject({ details: { reason: 'sleep_argument_type' } });
  });

  it('L-133-SLOWOP-001 slow_op 0 "label" returns completion metadata', async () => {
    const { payload } = await run('exit slow_op 0 "label"');
    expect(resultOf(payload)).toEqual({ ok: true, label: 'label', elapsed_ms: 0 });
  });

  it('L-133-SLOWOP-002 slow_op rejects invalid duration and label values', async () => {
    const invalidDuration = await run('exit slow_op "x" "label"');
    const invalidLabel = await run('exit slow_op 0 1');
    expect(invalidDuration.payload).toMatchObject({ details: { reason: 'slow_op_argument_type' } });
    expect(invalidLabel.payload).toMatchObject({ details: { reason: 'slow_op_label_type' } });
  });
});

describe('macro standard builtin registry source contract', () => {
  it('does not register deferred shell verbs in Phase 133', () => {
    const source = readFileSync('src/macro/builtins.ts', 'utf8');
    expect(source).not.toMatch(/\b(?:grep|find|sed|cat|wc|head|tail|ls):/);
  });
});
