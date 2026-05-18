// Built-in operators and shell-style mocks for the macro language golden.
//
// Golden patch item 10 (REQ-025): all task-registry references now read from
// `ctx.exec.taskRegistry` (per-invocation), not a module-global singleton.
//
// Golden patch item 17 / REQ-038: `range` builtin (mirrors `0..N` syntax).
//
// Built-ins:
//   echo, count, unique, append, concat
//   add/sub/mul/div/mod    arithmetic
//   range                  REQ-038
//   status/task_id/list_tasks    SEP-1686 task introspection
//   sleep/slow_op    cancel-aware async helpers
//   fail/exit         four-way termination
//   input_var         input contract
//   grep/find/sed/cat/wc/head/tail/ls    shell verbs (shellbuiltins.ts)

import type { Builtins } from "./evaluator.ts";
import {
  stringifyValue,
  MacroCancellationError,
  MacroFailError,
  MacroExitError,
  MacroNeedsUserInputError,
  MacroRuntimeError,
} from "./evaluator.ts";
import type { Value } from "./types.ts";
import { shellBuiltins } from "./shellbuiltins.ts";

export const builtins: Builtins = {
  ...shellBuiltins,

  // input_var: per-invocation read from ctx.inputVars.
  input_var: (positional, named, ctx) => {
    if (positional.length < 1) {
      throw new MacroRuntimeError(`input_var: missing required key argument`);
    }
    const keyRaw = positional[0];
    if (typeof keyRaw !== "string") {
      throw new MacroRuntimeError(
        `input_var: key must be a string literal (got ${describe(keyRaw)})`,
      );
    }
    const key = keyRaw;
    const inputVars = ctx.inputVars ?? {};
    if (key in inputVars) {
      return inputVars[key];
    }
    if ("default" in named) {
      return named.default;
    }
    throw new MacroRuntimeError(
      `input_var: required input "${key}" not provided (and no --default). ` +
      `This should have been caught by the pre-flight check.`,
    );
  },

  // ----- Operators -----

  echo: (positional, _named, ctx) => {
    const message = positional.map(stringifyValue).join(" ");
    ctx.log(message);
    ctx.exec?.taskRegistry.appendTrace({ kind: "log", message });
    return null;
  },

  // ----- Termination -----

  fail: (positional, _named, ctx) => {
    const message = positional.length > 0
      ? positional.map(stringifyValue).join(" ")
      : "macro aborted by fail()";
    ctx.exec?.taskRegistry.appendTrace({ kind: "fail", message });
    // REQ-024 ac3: include the source line of the `fail` call in
    // `details.line`. `callLine` is threaded through CallContext by
    // `applyCall` before invoking the builtin.
    throw new MacroFailError(message, ctx.callLine);
  },

  // Tier 2 / REQ-105: fifth termination class. Raises
  // `MacroNeedsUserInputError` with the spec-required payload. The runner
  // (run.ts) and snapshot capture (snapshot.ts) render the JSON envelope
  // `{ error: "needs_user_input", details: { question, ... } }`.
  //
  // Calling pattern from macro source:
  //   needs_user_input \
  //     --question "Which workspace?" \
  //     --answer_shape "frontmatter.workspace" \
  //     --options ["personal", "team"] \
  //     --context "We can't infer from the doc; need a manual call" \
  //     --resume_hint "On answer, write to frontmatter.workspace and re-run"
  //
  // `question` and `answer_shape` are REQUIRED per REQ-105; the runtime
  // raises `MacroRuntimeError` if either is absent.
  needs_user_input: (_positional, named, ctx) => {
    const question = typeof named.question === "string" ? named.question : null;
    const answer_shape = typeof named.answer_shape === "string" ? named.answer_shape : null;
    if (!question) {
      throw new MacroRuntimeError(
        `needs_user_input: --question is required (REQ-105)`,
      );
    }
    if (!answer_shape) {
      throw new MacroRuntimeError(
        `needs_user_input: --answer_shape is required (REQ-105)`,
      );
    }
    const payload: ConstructorParameters<typeof MacroNeedsUserInputError>[0] = {
      question,
      answer_shape,
    };
    if (typeof named.context === "string") payload.context = named.context;
    if (Array.isArray(named.options)) {
      payload.options = named.options.filter((s): s is string => typeof s === "string");
    }
    if (typeof named.resume_hint === "string") payload.resume_hint = named.resume_hint;
    ctx.exec?.taskRegistry.appendTrace({
      kind: "exit",
      message: `needs_user_input: ${question}`,
    });
    throw new MacroNeedsUserInputError(payload);
  },

  exit: (positional, _named, ctx) => {
    if (positional.length > 1) {
      throw new Error(
        `exit: takes at most one value argument, got ${positional.length}. ` +
        `To return multiple values, package them into a list or object.`,
      );
    }
    const value = positional.length === 0 ? null : positional[0];
    ctx.exec?.taskRegistry.appendTrace({ kind: "exit", message: stringifyValue(value) });
    throw new MacroExitError(value);
  },

  // ----- Status & task introspection -----

  status: (positional, named, ctx) => {
    const messageParts = positional.map(stringifyValue);
    const message = messageParts.length > 0 ? messageParts.join(" ") : null;
    const progress = typeof named.progress === "number" ? named.progress : null;
    const total = typeof named.total === "number" ? named.total : null;
    // REQ-048 ac3: `progress: "silent"` MUST silence ALL progress events,
    // including author-explicit `status` calls. We still update the task
    // registry's progress snapshot (so list_tasks reflects the intended
    // state), but we DO NOT emit anything to stderr or the trace.
    //
    // REQ-048 ac2 milestones mode: `status` calls with an explicit
    // `--milestone true` flag emit; otherwise they're throttled. The
    // throttle policy matches the for-loop auto-progress emission logic.
    const mode = ctx.exec?.progressMode ?? "full";
    // REQ-048 ac3: silent mode emits NO progress events (registry + stderr).
    // We still update the task record's snapshot state in non-silent modes
    // so `list_tasks` reflects intended progress.
    const milestoneFlag = named.milestone === true;
    const emitTrace = mode === "full" || (mode === "milestones" && milestoneFlag);
    ctx.exec?.taskRegistry.updateProgress(progress, total, message, { emitTrace });
    if (mode === "silent") return null;
    if (mode === "milestones" && !milestoneFlag) return null;

    const out: string[] = ["[STATUS]"];
    if (progress !== null && total !== null) out.push(`[${progress}/${total}]`);
    else if (progress !== null) out.push(`[${progress}]`);
    if (message) out.push(message);
    process.stderr.write(out.join(" ") + "\n");
    return null;
  },

  task_id: (_positional, _named, ctx) => {
    return ctx.exec?.taskRegistry.getCurrentTaskId() ?? "";
  },

  sleep: async (positional, _named, ctx) => {
    const ms = Number(positional[0] ?? 0);
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`sleep: invalid duration ${positional[0]}`);
    }
    const stepMs = 100;
    let remaining = ms;
    while (remaining > 0) {
      const chunk = Math.min(remaining, stepMs);
      await new Promise<void>((resolve) => setTimeout(resolve, chunk));
      remaining -= chunk;
      const reg = ctx.exec?.taskRegistry;
      const tid = ctx.exec?.taskId;
      if (reg && tid) {
        const t = reg.get(tid);
        if (t && t.status === "cancelled") {
          throw new MacroCancellationError(
            `sleep cancelled at ${ms - remaining}ms of ${ms}ms`,
            "sleep",
          );
        }
      }
    }
    return null;
  },

  slow_op: async (positional, _named, ctx) => {
    const ms = Number(positional[0] ?? 1000);
    const label = positional.length > 1 ? String(positional[1]) : "slow_op";
    autoProgress(ctx, `${label}: starting (will take ${ms}ms)`);
    const stepMs = 100;
    let remaining = ms;
    while (remaining > 0) {
      const chunk = Math.min(remaining, stepMs);
      await new Promise<void>((resolve) => setTimeout(resolve, chunk));
      remaining -= chunk;
      const reg = ctx.exec?.taskRegistry;
      const tid = ctx.exec?.taskId;
      if (reg && tid) {
        const t = reg.get(tid);
        if (t && t.status === "cancelled") {
          throw new MacroCancellationError(
            `${label} cancelled at ${ms - remaining}ms of ${ms}ms`,
            label,
          );
        }
      }
    }
    autoProgress(ctx, `${label}: done`);
    ctx.log(`[mock] ${label} completed after ${ms}ms`);
    return { ok: true, label, elapsed_ms: ms };
  },

  list_tasks: (_positional, _named, ctx) => {
    const tasks = ctx.exec?.taskRegistry.list() ?? [];
    const summaries = tasks.map((t) => {
      const created = Date.parse(t.createdAt);
      const updated = Date.parse(t.lastUpdatedAt);
      const dur = `${Math.max(0, updated - created)}ms`;
      const prog =
        t.progress.progress !== null && t.progress.total !== null
          ? `[${t.progress.progress}/${t.progress.total}]`
          : t.progress.message
            ? "[msg]"
            : "[—]";
      return {
        taskId: t.taskId,
        status: t.status,
        duration: dur,
        progress: prog,
        latest: t.progress.message ?? t.statusMessage ?? "",
        preview: t.macro_source_preview,
      };
    });
    ctx.log("");
    ctx.log("Task list:");
    for (const s of summaries) {
      ctx.log(
        `  ${s.taskId.slice(0, 8)}…  status=${s.status}  ${s.progress}  age=${s.duration}  ${s.latest}`,
      );
    }
    return summaries as unknown as Value[];
  },

  count: (positional) => {
    const v = positional[0];
    if (Array.isArray(v)) return v.length;
    if (typeof v === "string") return v.length;
    throw new Error(`count expects a list or string, got ${describe(v)}`);
  },

  add: (positional) => {
    let total = 0;
    for (const v of positional) {
      if (typeof v !== "number") throw new Error(`add expects numbers, got ${describe(v)}`);
      total += v;
    }
    return total;
  },

  sub: (positional) => {
    if (positional.length === 0) throw new Error("sub: need at least one number");
    const nums = positional.map((v) => {
      if (typeof v !== "number") throw new Error(`sub expects numbers, got ${describe(v)}`);
      return v;
    });
    if (nums.length === 1) return -nums[0];
    return nums.slice(1).reduce((acc, n) => acc - n, nums[0]);
  },

  mul: (positional) => {
    if (positional.length === 0) return 1;
    let total = 1;
    for (const v of positional) {
      if (typeof v !== "number") throw new Error(`mul expects numbers, got ${describe(v)}`);
      total *= v;
    }
    return total;
  },

  div: (positional) => {
    if (positional.length < 2) throw new Error("div: need at least two numbers");
    const nums = positional.map((v) => {
      if (typeof v !== "number") throw new Error(`div expects numbers, got ${describe(v)}`);
      return v;
    });
    return nums.slice(1).reduce((acc, n) => {
      if (n === 0) throw new Error("div: division by zero");
      return Math.trunc(acc / n);
    }, nums[0]);
  },

  mod: (positional) => {
    if (positional.length !== 2) throw new Error("mod: takes exactly two numbers");
    const [a, b] = positional;
    if (typeof a !== "number" || typeof b !== "number") {
      throw new Error(`mod expects numbers, got ${describe(a)} and ${describe(b)}`);
    }
    if (b === 0) throw new Error("mod: division by zero");
    return ((a % b) + b) % b;
  },

  concat: (positional) => {
    if (positional.length === 0) return "";
    if (positional.every((v) => typeof v === "string")) {
      return (positional as string[]).join("");
    }
    if (positional.every((v) => Array.isArray(v))) {
      const out: Value[] = [];
      for (const arr of positional as Value[][]) out.push(...arr);
      return out;
    }
    throw new Error("concat expects all strings or all lists");
  },

  unique: (positional) => {
    if (positional.length !== 1) {
      throw new Error("unique: takes exactly one list argument");
    }
    const v = positional[0];
    if (!Array.isArray(v)) {
      throw new Error(`unique expects a list, got ${describe(v)}`);
    }
    const seen = new Set<string>();
    const out: Value[] = [];
    for (const item of v) {
      const key = stringifyValue(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  },

  append: (positional) => {
    if (positional.length < 2) {
      throw new Error("append: takes a list and at least one item");
    }
    const list = positional[0];
    if (!Array.isArray(list)) {
      throw new Error(`append expects a list as first arg, got ${describe(list)}`);
    }
    const items = positional.slice(1);
    return [...list, ...items];
  },

  // REQ-038 (item 17): `range N` => [0..N-1]; `range A B` => [A..B-1];
  // `range A B step` => [A, A+step, ...] (excluding B). All endpoints integer.
  range: (positional) => {
    const nums = positional.map((v) => {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        throw new Error(`range expects integers, got ${describe(v)}`);
      }
      return v;
    });
    let start: number, end: number, step: number;
    if (nums.length === 1) {
      start = 0;
      end = nums[0];
      step = 1;
    } else if (nums.length === 2) {
      start = nums[0];
      end = nums[1];
      step = 1;
    } else if (nums.length === 3) {
      start = nums[0];
      end = nums[1];
      step = nums[2];
      if (step === 0) throw new Error(`range: step cannot be 0`);
    } else {
      throw new Error(`range: takes 1, 2, or 3 args; got ${nums.length}`);
    }
    const out: Value[] = [];
    if (step > 0) {
      for (let i = start; i < end; i += step) out.push(i);
    } else {
      for (let i = start; i > end; i += step) out.push(i);
    }
    return out;
  },
};

import type { CallContext } from "./types.ts";

function autoProgress(ctx: CallContext, message: string): void {
  const mode = ctx.exec?.progressMode ?? "full";
  if (mode === "silent") return;
  process.stderr.write(`[PROGRESS] ${message}\n`);
  ctx.exec?.taskRegistry.appendTrace({ kind: "progress", message });
}

function describe(v: Value): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  return typeof v;
}
