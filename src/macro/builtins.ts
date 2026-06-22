import {
  MacroExitError,
  MacroExpectedError,
  MacroFailError,
  MacroRuntimeError,
} from './runtime-errors.js';
import type {
  MacroBuiltin,
  MacroValue,
} from './runtime-types.js';
import { MACRO_SAFE_POINTS } from './safe-points.js';

const CHUNK_MS = 100;

function isMacroValueArray(value: MacroValue): value is MacroValue[] {
  return Array.isArray(value);
}

export const standardBuiltins: Record<string, MacroBuiltin> = {
  fail: (positional, named) => {
    requireNamedArgs('fail', named, []);
    if (positional.length > 1 || (positional.length === 1 && typeof positional[0] !== 'string')) {
      throw new MacroExpectedError('invalid_input', 'fail accepts zero or one string argument.', {
        reason: 'fail_argument_shape',
      });
    }
    const message = positional[0];
    throw new MacroFailError(typeof message === 'string' ? message : 'macro aborted');
  },
  exit: (positional, named) => {
    requireNamedArgs('exit', named, []);
    if (positional.length > 1) {
      throw new MacroRuntimeError('exit accepts at most one argument.', undefined, {
        reason: 'exit_argument_count',
      });
    }
    throw new MacroExitError(positional[0] ?? null);
  },
  input_var: (positional, named, context) => {
    if (positional.length !== 1) {
      throw new MacroExpectedError('invalid_input', 'input_var expects exactly one positional argument.', {
        reason: 'input_var_argument_count',
      });
    }
    const unsupportedNamedArgs = Object.keys(named).filter((key) => key !== 'default');
    if (unsupportedNamedArgs.length > 0) {
      throw new MacroExpectedError('invalid_input', 'input_var received unsupported named arguments.', {
        reason: 'input_var_named_argument',
        named_args: unsupportedNamedArgs,
      });
    }
    const key = positional[0];
    if (typeof key !== 'string') {
      throw new MacroRuntimeError('input_var key must be a string.', undefined, {
        reason: 'input_var_key_type',
      });
    }
    if (Object.prototype.hasOwnProperty.call(context.inputVars, key)) {
      return context.inputVars[key];
    }
    if (Object.prototype.hasOwnProperty.call(named, 'default')) {
      return named['default'] ?? null;
    }
    throw new MacroRuntimeError(`Missing required input_var "${key}".`, undefined, {
      reason: 'input_var_missing',
      key,
    });
  },
  count: (positional, named) => {
    requireNamedArgs('count', named, []);
    requireArgCount('count', positional, 1, 1, 'count_argument_count');
    const value = positional[0];
    if (Array.isArray(value) || typeof value === 'string') return value.length;
    if (value === null) return 0;
    throw new MacroRuntimeError('count expects a list, string, or null.', undefined, {
      reason: 'count_type_mismatch',
    });
  },
  unique: (positional, named) => {
    requireNamedArgs('unique', named, []);
    requireArgCount('unique', positional, 1, 1, 'unique_argument_count');
    const list = positional[0];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('unique expects exactly one list argument.', undefined, {
        reason: 'unique_type_mismatch',
      });
    }
    const output: MacroValue[] = [];
    for (const item of list) {
      if (!output.some((existing) => deepEqual(existing, item))) {
        output.push(item);
      }
    }
    return output;
  },
  append: (positional, named) => {
    requireNamedArgs('append', named, []);
    requireArgCount('append', positional, 2, Number.POSITIVE_INFINITY, 'append_argument_count');
    const list = positional[0];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('append first argument must be a list.', undefined, {
        reason: 'append_type_mismatch',
      });
    }
    return [...list, ...positional.slice(1)];
  },
  // §14.3.1 `filter $list $field $op $value` → list. Returns the subset of a
  // list of objects whose `$field $op $value` is true. Arity, named-args, and a
  // *literal* bad operator are caught upstream at preflight (preflightCall →
  // invalid_input); the value-dependent faults below surface at runtime as
  // tool_call_failed. Empty input → []. Non-mutating.
  filter: (positional) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    const opRaw = positional[2];
    const value = positional[3];

    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('filter expects a list as its first argument.', undefined, {
        reason: 'filter_type_mismatch',
      });
    }
    if (typeof fieldRaw !== 'string') {
      throw new MacroRuntimeError('filter field must be a string.', undefined, {
        reason: 'filter_field_type',
      });
    }
    if (typeof opRaw !== 'string' || !FILTER_OPERATORS.has(opRaw)) {
      throw new MacroRuntimeError('filter operator must be one of ==, !=, <, >, <=, >=.', undefined, {
        reason: 'filter_operator_invalid',
      });
    }

    const output: MacroValue[] = [];
    for (const row of list) {
      const fieldValue = resolveFieldPath(row, fieldRaw);
      if (compareWithOp(fieldValue, opRaw, value)) output.push(row);
    }
    return output;
  },
  // §14.3.2 `sort $list $field $direction` → list. Stable, non-mutating. Numeric
  // fields sort numerically; string fields lexicographically; null field values
  // (incl. a missing leaf) sort to the END under both directions (NULLS LAST),
  // preserving input order. Mixed / non-scalar non-null values →
  // sort_field_type_mismatch.
  sort: (positional) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    const directionRaw = positional[2];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('sort expects a list as its first argument.', undefined, {
        reason: 'sort_type_mismatch',
      });
    }
    if (typeof fieldRaw !== 'string') {
      throw new MacroRuntimeError('sort field must be a string.', undefined, {
        reason: 'sort_field_type',
      });
    }
    if (directionRaw !== 'asc' && directionRaw !== 'desc') {
      throw new MacroRuntimeError('sort direction must be "asc" or "desc".', undefined, {
        reason: 'sort_direction_invalid',
      });
    }
    const decorated = list.map((row, index) => ({ row, index, key: resolveFieldPath(row, fieldRaw) }));
    let kind: 'number' | 'string' | null = null;
    for (const item of decorated) {
      if (item.key === null) continue;
      if (typeof item.key === 'number') {
        if (kind === 'string') throw sortFieldMismatch();
        kind = 'number';
      } else if (typeof item.key === 'string') {
        if (kind === 'number') throw sortFieldMismatch();
        kind = 'string';
      } else {
        throw sortFieldMismatch();
      }
    }
    const asc = directionRaw === 'asc';
    decorated.sort((a, b) => {
      const aNull = a.key === null;
      const bNull = b.key === null;
      if (aNull && bNull) return a.index - b.index;
      if (aNull) return 1; // NULLS LAST (both directions)
      if (bNull) return -1;
      let cmp: number;
      if (kind === 'number') cmp = (a.key as number) - (b.key as number);
      else cmp = (a.key as string) < (b.key as string) ? -1 : (a.key as string) > (b.key as string) ? 1 : 0;
      if (cmp === 0) return a.index - b.index; // stable
      return asc ? cmp : -cmp;
    });
    return decorated.map((item) => item.row);
  },
  // §14.3.3 `first $list` → item | null. Non-mutating.
  first: (positional) => {
    const list = positional[0];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('first expects a list.', undefined, { reason: 'first_type_mismatch' });
    }
    return list.length > 0 ? (list[0] ?? null) : null;
  },
  // §14.3.4 `last $list` → item | null. Non-mutating.
  last: (positional) => {
    const list = positional[0];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('last expects a list.', undefined, { reason: 'last_type_mismatch' });
    }
    return list.length > 0 ? (list[list.length - 1] ?? null) : null;
  },
  // §14.3.5 `keys $object` → list of strings (insertion order). Empty → [].
  keys: (positional) => {
    const obj = positional[0];
    if (!isRecord(obj)) {
      throw new MacroRuntimeError('keys expects a record.', undefined, { reason: 'keys_type_mismatch' });
    }
    return Object.keys(obj);
  },
  // §14.3.6 `contains $list $value` → boolean. Recursive deepEqual membership.
  contains: (positional) => {
    const list = positional[0];
    const value = positional[1];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('contains expects a list as its first argument.', undefined, {
        reason: 'contains_type_mismatch',
      });
    }
    return list.some((item) => deepEqual(item, value));
  },
  // §14.3.7 `join $list $separator` → string. Every element must be a string
  // (no implicit stringification). Empty → "".
  join: (positional) => {
    const list = positional[0];
    const separator = positional[1];
    if (typeof separator !== 'string') {
      throw new MacroRuntimeError('join separator must be a string.', undefined, {
        reason: 'join_separator_type',
      });
    }
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('join expects a list as its first argument.', undefined, {
        reason: 'join_type_mismatch',
      });
    }
    const parts: string[] = [];
    for (const item of list) {
      if (typeof item !== 'string') {
        throw new MacroRuntimeError('join elements must all be strings.', undefined, {
          reason: 'join_element_type',
        });
      }
      parts.push(item);
    }
    return parts.join(separator);
  },
  // §14.3.8 `map $list $field` → list. Length-preserving projection: a missing
  // field contributes null; a non-object row throws (invalid_field_target).
  // Dotted nested paths supported. Empty → [].
  map: (positional) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('map expects a list as its first argument.', undefined, {
        reason: 'map_type_mismatch',
      });
    }
    if (typeof fieldRaw !== 'string') {
      throw new MacroRuntimeError('map field must be a string.', undefined, { reason: 'map_field_type' });
    }
    return list.map((row) => resolveFieldPath(row, fieldRaw));
  },
  // §14.3.9 `any $list $field $op $value` → boolean. Short-circuits on first match. Empty → false.
  any: (positional) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    const opRaw = positional[2];
    const value = positional[3];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('any expects a list as its first argument.', undefined, {
        reason: 'any_type_mismatch',
      });
    }
    if (typeof fieldRaw !== 'string') {
      throw new MacroRuntimeError('any field must be a string.', undefined, { reason: 'any_field_type' });
    }
    if (typeof opRaw !== 'string' || !FILTER_OPERATORS.has(opRaw)) {
      throw new MacroRuntimeError('any operator must be one of ==, !=, <, >, <=, >=.', undefined, {
        reason: 'any_operator_invalid',
      });
    }
    for (const row of list) {
      if (compareWithOp(resolveFieldPath(row, fieldRaw), opRaw, value)) return true;
    }
    return false;
  },
  // §14.3.10 `all $list $field $op $value` → boolean. Short-circuits on first failure. Empty → true (vacuous).
  all: (positional) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    const opRaw = positional[2];
    const value = positional[3];
    if (!isMacroValueArray(list)) {
      throw new MacroRuntimeError('all expects a list as its first argument.', undefined, {
        reason: 'all_type_mismatch',
      });
    }
    if (typeof fieldRaw !== 'string') {
      throw new MacroRuntimeError('all field must be a string.', undefined, { reason: 'all_field_type' });
    }
    if (typeof opRaw !== 'string' || !FILTER_OPERATORS.has(opRaw)) {
      throw new MacroRuntimeError('all operator must be one of ==, !=, <, >, <=, >=.', undefined, {
        reason: 'all_operator_invalid',
      });
    }
    for (const row of list) {
      if (!compareWithOp(resolveFieldPath(row, fieldRaw), opRaw, value)) return false;
    }
    return true;
  },
  concat: (positional, named) => {
    requireNamedArgs('concat', named, []);
    if (positional.length === 0) return '';
    if (positional.every((value) => typeof value === 'string')) {
      return positional.join('');
    }
    if (positional.every(isMacroValueArray)) {
      return positional.flatMap((value) => value);
    }
    throw new MacroRuntimeError('concat expects all strings or all lists.', undefined, {
      reason: 'concat_type_mismatch',
    });
  },
  add: (positional, named) => {
    requireNamedArgs('add', named, []);
    return positional.reduce<number>((total, value) => total + requireNumber(value, 'add'), 0);
  },
  sub: (positional, named) => {
    requireNamedArgs('sub', named, []);
    requireArgCount('sub', positional, 1, Number.POSITIVE_INFINITY, 'sub_argument_count');
    const numbers = positional.map((value) => requireNumber(value, 'sub'));
    const first = numbers[0] ?? 0;
    if (numbers.length === 1) return -first;
    return numbers.slice(1).reduce((total, value) => total - value, first);
  },
  mul: (positional, named) => {
    requireNamedArgs('mul', named, []);
    return positional.reduce<number>((total, value) => total * requireNumber(value, 'mul'), 1);
  },
  div: (positional, named) => {
    requireNamedArgs('div', named, []);
    requireArgCount('div', positional, 2, Number.POSITIVE_INFINITY, 'div_argument_count');
    const numbers = positional.map((value) => requireNumber(value, 'div'));
    const first = numbers[0] ?? 0;
    return numbers.slice(1).reduce((total, value) => {
      if (value === 0) {
        throw new MacroRuntimeError('Division by zero.', undefined, { reason: 'div_by_zero' });
      }
      return Math.trunc(total / value);
    }, first);
  },
  mod: (positional, named) => {
    requireNamedArgs('mod', named, []);
    requireArgCount('mod', positional, 2, 2, 'mod_argument_count');
    const left = requireNumber(positional[0], 'mod');
    const right = requireNumber(positional[1], 'mod');
    if (right === 0) {
      throw new MacroRuntimeError('Modulo by zero.', undefined, { reason: 'mod_by_zero' });
    }
    return ((left % right) + right) % right;
  },
  range: (positional, named) => {
    requireNamedArgs('range', named, []);
    requireArgCount('range', positional, 1, 3, 'range_argument_count');
    const numbers = positional.map((value) => requireInteger(value, 'range'));
    if (numbers.length === 1) return buildRange(0, numbers[0], 1);
    if (numbers.length === 2) return buildRange(numbers[0], numbers[1], 1);
    return buildRange(numbers[0], numbers[1], numbers[2]);
  },
  echo: (positional, named, context) => {
    // REQ-064 (8-Jun-2026): echo is value-producing. It still logs to the
    // trace/liveness channel, but ALSO returns its rendered string so it can
    // seed a pipeline (`echo $v | sed ...`) or bind to a variable. Previously
    // returned null, which made `echo $v | sed` fail with stdin_type_mismatch.
    requireNamedArgs('echo', named, []);
    const message = positional.map(stringifyMacroValue).join(' ');
    context.log.push(message);
    context.traceBuilder.add({ kind: 'log', message });
    return message;
  },
  status: async (positional, named, context) => {
    requireNamedArgs('status', named, ['progress', 'total']);
    const message =
      positional.length > 0 ? positional.map(stringifyMacroValue).join(' ') : undefined;
    const progress = optionalNumber(named['progress'], 'status_progress_type');
    const total = optionalNumber(named['total'], 'status_progress_type');
    const entry = {
      ...(message === undefined ? {} : { message }),
      ...(progress === undefined ? {} : { progress }),
      ...(total === undefined ? {} : { total }),
    };
    await context.progressEmitter.emitExplicitStatus(entry);
    await context.progressSink?.(entry, context);
    return null;
  },
  task_id: (positional, named, context) => {
    requireNamedArgs('task_id', named, []);
    requireArgCount('task_id', positional, 0, 0, 'task_id_argument_count');
    return context.taskId;
  },
  list_tasks: async (positional, named, context) => {
    requireNamedArgs('list_tasks', named, []);
    requireArgCount('list_tasks', positional, 0, 0, 'list_tasks_argument_count');
    if (context.listTasks) {
      const tasks = await context.listTasks(context);
      return filterSessionTasks(tasks, context.sessionId);
    }
    return [
      {
        task_id: context.taskId,
        status: 'working',
        progress: context.progress[context.progress.length - 1] ?? null,
      },
    ];
  },
  sleep: async (positional, named, context) => {
    requireNamedArgs('sleep', named, []);
    requireArgCount('sleep', positional, 1, 1, 'sleep_argument_count');
    const duration = requireDuration(positional[0] ?? 0, 'sleep');
    await sleepWithCancellation(duration, MACRO_SAFE_POINTS.insideSleep, (where) => context.checkCancelled(where));
    return null;
  },
  slow_op: async (positional, named, context) => {
    requireNamedArgs('slow_op', named, []);
    requireArgCount('slow_op', positional, 1, 2, 'slow_op_argument_count');
    const duration = requireDuration(positional[0] ?? 1000, 'slow_op');
    const label = positional[1] ?? 'slow_op';
    if (typeof label !== 'string') {
      throw new MacroRuntimeError('slow_op label must be a string.', undefined, {
        reason: 'slow_op_label_type',
      });
    }
    await sleepWithCancellation(duration, MACRO_SAFE_POINTS.insideSlowOp, (where) => context.checkCancelled(where));
    return { ok: true, label, elapsed_ms: duration };
  },
};

export function buildRange(start: number, end: number, step: number): MacroValue[] {
  for (const value of [start, end, step]) {
    if (!Number.isInteger(value)) {
      throw new MacroRuntimeError('Range operands must be integers.', undefined, {
        reason: 'range_type_mismatch',
      });
    }
  }
  if (step === 0) {
    throw new MacroRuntimeError('Range step cannot be zero.', undefined, {
      reason: 'range_step_zero',
    });
  }

  const output: MacroValue[] = [];
  if (step > 0) {
    for (let value = start; value < end; value += step) output.push(value);
  } else {
    for (let value = start; value > end; value += step) output.push(value);
  }
  return output;
}

function requireNumber(value: MacroValue, builtin: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MacroRuntimeError(`${builtin} expects numeric arguments.`, undefined, {
      reason: 'arithmetic_operand_type',
    });
  }
  return value;
}

function requireArgCount(
  builtin: string,
  positional: MacroValue[],
  min: number,
  max: number,
  reason: string
): void {
  if (positional.length < min || positional.length > max) {
    throw new MacroRuntimeError(`${builtin} received the wrong number of arguments.`, undefined, {
      reason,
    });
  }
}

function requireNamedArgs(
  builtin: string,
  named: Record<string, MacroValue>,
  allowed: string[]
): void {
  const unexpected = Object.keys(named).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new MacroRuntimeError(`${builtin} received unsupported named arguments.`, undefined, {
      reason: `${builtin}_named_argument`,
      named_args: unexpected,
    });
  }
}

function requireInteger(value: MacroValue, builtin: string): number {
  const number = requireNumber(value, builtin);
  if (!Number.isInteger(number)) {
    throw new MacroRuntimeError(`${builtin} expects integer arguments.`, undefined, {
      reason: 'range_type_mismatch',
    });
  }
  return number;
}

function requireDuration(value: MacroValue, builtin: 'sleep' | 'slow_op'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MacroRuntimeError(`${builtin} duration must be a finite number.`, undefined, {
      reason: builtin === 'sleep' ? 'sleep_argument_type' : 'slow_op_argument_type',
    });
  }
  if (value < 0) {
    throw new MacroRuntimeError(`${builtin} duration must be non-negative.`, undefined, {
      reason: builtin === 'sleep' ? 'sleep_duration_negative' : 'slow_op_duration_negative',
    });
  }
  return value;
}

function filterSessionTasks(tasks: MacroValue[], sessionId: string | undefined): MacroValue[] {
  if (!sessionId) return tasks;
  return tasks
    .filter((task) => {
      if (!isRecord(task)) return true;
      const marker = task['session_id'] ?? task['sessionId'];
      return marker === undefined || marker === sessionId;
    })
    .map((task) => {
      if (!isRecord(task)) return task;
      const visibleTask = { ...task };
      delete visibleTask['session_id'];
      delete visibleTask['sessionId'];
      return visibleTask;
    });
}

function optionalNumber(value: MacroValue | undefined, reason: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MacroRuntimeError('status progress values must be finite numbers.', undefined, {
      reason,
    });
  }
  return value;
}

async function sleepWithCancellation(
  durationMs: number,
  safePoint: string,
  checkCancelled: (where: string) => void | Promise<void>
): Promise<void> {
  let remaining = durationMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, CHUNK_MS);
    await new Promise<void>((resolve) => setTimeout(resolve, chunk));
    remaining -= chunk;
    await checkCancelled(safePoint);
  }
}

function stringifyMacroValue(value: MacroValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function deepEqual(left: MacroValue, right: MacroValue): boolean {
  if (left === right) return true;
  if (isMacroValueArray(left) && isMacroValueArray(right)) {
    return left.length === right.length && left.every((value, index) => {
      const rightValue = right[index];
      return rightValue !== undefined && deepEqual(value, rightValue);
    });
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]))
    );
  }
  return false;
}

function isRecord(value: MacroValue): value is Record<string, MacroValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// §14.3.1 — the six comparison operators `filter` accepts.
const FILTER_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);

// §4 field resolution for `filter`'s `$field` argument: dotted nested path,
// split on `.` and walked left to right. A missing leaf yields null (REQ-112d);
// a step through null / a non-object / a list throws `invalid_field_target` —
// matching the evaluator's `stepField`.
function resolveFieldPath(target: MacroValue, path: string): MacroValue {
  let current: MacroValue = target;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      throw new MacroRuntimeError(`Cannot access .${part} on ${describeType(current)}.`, undefined, {
        reason: 'invalid_field_target',
        field: part,
      });
    }
    const next = (current as Record<string, MacroValue>)[part];
    current = next === undefined ? null : next;
  }
  return current;
}

// Apply one of the six comparison operators with the language's existing
// semantics (§14.3.0): ==/!= are recursive deepEqual (no coercion); the ordering
// ops require BOTH operands numeric, else the shared `comparison_type_mismatch`.
function compareWithOp(fieldValue: MacroValue, op: string, value: MacroValue): boolean {
  if (op === '==') return deepEqual(fieldValue, value);
  if (op === '!=') return !deepEqual(fieldValue, value);
  if (typeof fieldValue !== 'number' || typeof value !== 'number') {
    throw new MacroRuntimeError('Ordering comparisons require numeric operands.', undefined, {
      reason: 'comparison_type_mismatch',
      op,
    });
  }
  switch (op) {
    case '<':
      return fieldValue < value;
    case '<=':
      return fieldValue <= value;
    case '>':
      return fieldValue > value;
    default:
      return fieldValue >= value;
  }
}

function describeType(value: MacroValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

// §14.3.2 — raised when a `sort` field's non-null values are not uniformly
// orderable (a mix of number and string, or any non-scalar/boolean value).
function sortFieldMismatch(): MacroRuntimeError {
  return new MacroRuntimeError(
    'sort field values must be uniformly orderable (all numbers or all strings).',
    undefined,
    { reason: 'sort_field_type_mismatch' }
  );
}
