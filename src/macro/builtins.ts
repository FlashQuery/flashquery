import {
  MacroExitError,
  MacroExpectedError,
  MacroFailError,
  MacroRuntimeError,
  type MacroBuiltin,
  type MacroValue,
} from './evaluator.js';
import { MACRO_SAFE_POINTS } from './safe-points.js';

const CHUNK_MS = 100;

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
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError('unique expects exactly one list argument.', undefined, {
        reason: 'unique_argument_type',
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
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError('append first argument must be a list.', undefined, {
        reason: 'append_argument_type',
      });
    }
    return [...list, ...positional.slice(1)];
  },
  concat: (positional, named) => {
    requireNamedArgs('concat', named, []);
    if (positional.length === 0) return '';
    if (positional.every((value) => typeof value === 'string')) {
      return positional.join('');
    }
    if (positional.every((value) => Array.isArray(value))) {
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
    requireArgCount('sub', positional, 1, Number.POSITIVE_INFINITY, 'arithmetic_argument_count');
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
    requireNamedArgs('echo', named, []);
    const message = positional.map(stringifyMacroValue).join(' ');
    context.log.push(message);
    context.traceBuilder.add({ kind: 'log', message });
    return null;
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
        reason: 'range_operand_type_mismatch',
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
      reason: 'range_operand_type_mismatch',
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
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
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
