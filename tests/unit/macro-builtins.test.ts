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

    const extra = await run('exit count [1] "unexpected"');
    expect(extra.result.isError).toBe(true);
    expect(extra.payload).toMatchObject({ details: { reason: 'count_argument_count' } });
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

describe('macro standard library channel and task builtins', () => {
  it('T-U-120 echo appends a log trace step with stringified args', async () => {
    const { payload } = await run('echo "a" 1 null\nexit null');
    expect(payload['trace']).toEqual([
      { kind: 'log', message: 'a 1 null', at: expect.any(String) },
      { kind: 'exit', result: null, at: expect.any(String) },
    ]);
    expect(payload['log']).toEqual(['a 1 null']);
  });

  it('T-U-121 status appends progress trace and calls the progress sink', async () => {
    const emitted: unknown[] = [];
    const { payload } = await run('status --progress 5 --total 10 "msg"\nexit null', {
      progressSink: async (entry) => emitted.push(entry),
    });

    expect(payload['trace']).toEqual([
      {
        kind: 'progress',
        message: 'msg',
        result: { progress: 5, total: 10 },
        at: expect.any(String),
      },
      { kind: 'exit', result: null, at: expect.any(String) },
    ]);
    expect(payload['progress']).toEqual([{ message: 'msg', progress: 5, total: 10 }]);
    expect(emitted).toEqual([{ message: 'msg', progress: 5, total: 10 }]);
  });

  it('T-U-122 keeps echo and status channels separate', async () => {
    const emitted: unknown[] = [];
    const { payload } = await run('status "working"\necho "log-only"\nexit null', {
      progressSink: async (entry) => emitted.push(entry),
    });

    expect(payload['log']).toEqual(['log-only']);
    expect(payload['progress']).toEqual([{ message: 'working' }]);
    expect(emitted).toEqual([{ message: 'working' }]);
    expect(payload['trace']).toMatchObject([
      { kind: 'progress', message: 'working' },
      { kind: 'log', message: 'log-only' },
      { kind: 'exit' },
    ]);
  });

  it('T-U-123 status works without a progress sink or progress token', async () => {
    const { payload } = await run('status "just-message"\nexit null');
    expect(payload['progress']).toEqual([{ message: 'just-message' }]);
    expect(payload['trace']).toMatchObject([
      { kind: 'progress', message: 'just-message', result: {} },
      { kind: 'exit' },
    ]);
  });

  it('T-U-124 task_id returns the invocation task id exactly', async () => {
    const { payload } = await run('exit task_id', { taskId: 'task-123' });
    expect(resultOf(payload)).toBe('task-123');
  });

  it('T-U-125 list_tasks returns injected session records or the current invocation fallback', async () => {
    const injected = await run('exit list_tasks', {
      taskId: 'task-abc',
      listTasks: async () => [{ task_id: 'session-task', status: 'working' }],
    });
    const fallback = await run('status --progress 1 --total 2 "half"\nexit list_tasks', {
      taskId: 'task-fallback',
    });

    expect(resultOf(injected.payload)).toEqual([{ task_id: 'session-task', status: 'working' }]);
    expect(resultOf(fallback.payload)).toEqual([
      { task_id: 'task-fallback', status: 'working', progress: { message: 'half', progress: 1, total: 2 } },
    ]);
  });
});

describe('macro POC builtin fragments', () => {
  it('POC 01-hello executes the full production-compatible builtin example', async () => {
    const { payload } = await run(`
      name = "FlashQuery"
      version = 1
      echo "hello from $name v$version"
      items = ["alpha", "beta", "gamma"]
      total = count $items
      echo "items:" $items
      echo "count:" $total
      exit $total
    `);

    expect(resultOf(payload)).toBe(3);
    expect(payload['log']).toEqual([
      'hello from FlashQuery v1',
      'items: ["alpha","beta","gamma"]',
      'count: 3',
    ]);
  });

  it('POC 05-counter executes the math/echo fragment excluding deferred fq.search dispatch', async () => {
    const { payload } = await run(`
      i = 0
      total_lines = 0
      drafts = [{ fq_id: "a" }, { fq_id: "b" }]
      for d in $drafts do
        i = add $i 1
        doc_lines = 10
        total_lines = add $total_lines $doc_lines
        echo "iteration $i: processing $d.fq_id"
      done
      sum = add 2 3 5
      diff = sub 10 3
      product = mul 4 5
      quot = div 17 5
      rem = mod 17 5
      exit { i: $i, total_lines: $total_lines, sum: $sum, diff: $diff, product: $product, quot: $quot, rem: $rem }
    `);

    expect(resultOf(payload)).toEqual({
      i: 2,
      total_lines: 20,
      sum: 10,
      diff: 7,
      product: 20,
      quot: 3,
      rem: 2,
    });
  });

  it('POC 06-status-and-tasks executes the status/task fragment excluding deferred fq.* tools', async () => {
    const { payload } = await run(`
      status "Starting draft review workflow"
      status --progress 0 --total 3 "Found drafts; beginning review"
      my_task = task_id
      tasks = list_tasks
      exit { task: $my_task, tasks: $tasks }
    `, { taskId: 'poc-task' });

    expect(resultOf(payload)).toEqual({
      task: 'poc-task',
      tasks: [{ task_id: 'poc-task', status: 'working', progress: { message: 'Found drafts; beginning review', progress: 0, total: 3 } }],
    });
  });

  it('POC 13-input-vars executes the input/default fragment excluding deferred search/write tools', async () => {
    const { payload } = await run(`
      search_phrases = input_var "search_phrases"
      output_path = input_var "output_path" --default "Research/web-output.md"
      hits_per_topic = input_var "hits_per_topic" --default 2
      reviewer_email = input_var "reviewer_email" --default null
      total_queries = count $search_phrases
      if $reviewer_email then
        echo "will notify reviewer: $reviewer_email"
      else
        echo "no reviewer email supplied - skipping notification"
      fi
      exit { count: $total_queries, path: $output_path, hits: $hits_per_topic, reviewer_email: $reviewer_email }
    `, { inputVars: { search_phrases: ['AI safety', 'model alignment'] } });

    expect(resultOf(payload)).toEqual({
      count: 2,
      path: 'Research/web-output.md',
      hits: 2,
      reviewer_email: null,
    });
  });

  it('POC 17-input-var-missing fails before its deferred fq.write_document call', async () => {
    const { result, payload } = await run(`
      topic = input_var "topic"
      output_path = input_var "output_path"
      notes_prefix = input_var "notes_prefix" --default "Auto-generated notes about"
      echo "topic: $topic"
      saved = fq.write_document({ path: $output_path })
      exit $saved
    `, { inputVars: { topic: 'AI' } });

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'invalid_input',
      details: { missing_inputs: ['output_path'] },
    });
    expect(payload['trace']).toBeUndefined();
  });
});

describe('macro standard builtin registry source contract', () => {
  it('does not register deferred shell verbs in Phase 133', () => {
    const source = readFileSync('src/macro/builtins.ts', 'utf8');
    expect(source).not.toMatch(/\b(?:grep|find|sed|cat|wc|head|tail|ls):/);
  });
});
