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
  valueEquals,
  MacroCancellationError,
  MacroFailError,
  MacroExitError,
  MacroRuntimeError,
} from "./evaluator.ts";
import type { Value } from "./types.ts";
import { shellBuiltins } from "./shellbuiltins.ts";

// §14.3.1 — the six comparison operators `filter` (and, later, any/all) accept.
const FILTER_OPS = new Set(["==", "!=", "<", ">", "<=", ">="]);

// §4 field resolution for the `$field` argument: dotted nested path, split on
// `.` and walked left to right. A missing leaf yields null (REQ-112d); a step
// through null / a non-object / a list throws `invalid_field_target` — matching
// production's `stepField` (src/macro/evaluator.ts). Used by `filter`.
function resolveFieldPath(target: Value, path: string): Value {
  let cur: Value = target;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      throw new MacroRuntimeError(
        `Cannot access .${part} on ${describe(cur)}`,
        undefined,
        { reason: "invalid_field_target", field: part },
      );
    }
    const next = (cur as Record<string, Value>)[part];
    cur = next === undefined ? null : next;
  }
  return cur;
}

// §14.3.2 — raised when a `sort` field's non-null values are not uniformly
// orderable (a mix of number and string, or any non-scalar/boolean value).
function sortFieldMismatch(): MacroRuntimeError {
  return new MacroRuntimeError(
    "sort field values must be uniformly orderable (all numbers or all strings)",
    undefined,
    { reason: "sort_field_type_mismatch" },
  );
}

// Apply one of the six comparison operators with the language's existing
// semantics (§14.3.0): ==/!= are recursive deepEqual (no coercion); the
// ordering ops require BOTH operands numeric, else `comparison_type_mismatch`
// (the shared code `evalBinaryOp` raises for `$x < "a"`).
function compareWithOp(fieldValue: Value, op: string, value: Value): boolean {
  if (op === "==") return valueEquals(fieldValue, value);
  if (op === "!=") return !valueEquals(fieldValue, value);
  if (typeof fieldValue !== "number" || typeof value !== "number") {
    throw new MacroRuntimeError(
      `comparison operator '${op}' requires numeric operands; got ${describe(fieldValue)} ${op} ${describe(value)}`,
      undefined,
      { reason: "comparison_type_mismatch", op },
    );
  }
  return op === "<"
    ? fieldValue < value
    : op === "<="
      ? fieldValue <= value
      : op === ">"
        ? fieldValue > value
        : fieldValue >= value;
}

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
    // REQ-064 (8-Jun-2026): echo is value-producing. It still logs to the
    // trace/liveness channel, but ALSO returns its rendered string so it can
    // seed a pipeline (`echo $v | sed ...`) or bind to a variable. Previously
    // returned null, which made `echo $v | sed` fail with stdin_type_mismatch.
    const message = positional.map(stringifyValue).join(" ");
    ctx.log(message);
    ctx.exec?.taskRegistry.appendTrace({ kind: "log", message });
    return message;
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

  // REMOVED 2026-05-19 — `needs_user_input` is NOT a spec-defined macro
  // builtin. Per MCP Broker Requirements §7.8 REQ-060:
  //
  //   "Brokered tools CANNOT trigger `needs_user_input` in v1. Only two
  //    sources emit `needs_user_input` exits in v1: (a) a FlashQuery-
  //    native tool, (b) the broker layer itself on TOFU drift (§7.5)."
  //
  // A macro author wanting the fifth termination MUST call an FQ-native
  // tool or trigger a brokered dispatch that hits TOFU drift. The
  // previous builtin let macro authors raise the termination directly,
  // which contradicted REQ-060 and caused the golden to mispredict
  // production behavior. This stub remains in the registry so any
  // straggler macro still calling `needs_user_input` fails cleanly with
  // a spec-aligned error instead of an opaque "unknown builtin" mystery.
  needs_user_input: (_positional, _named, _ctx) => {
    throw new MacroRuntimeError(
      `'needs_user_input' is not a macro builtin. Per MCP Broker REQ-060, ` +
        `only (a) FQ-native tools and (b) the broker layer (TOFU drift) emit ` +
        `the fifth termination. Call an fq.* tool or rely on broker TOFU drift.`,
    );
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
    // GG-012 fix (2026-05-20): per REQ-048 ac2 "milestones (default):
    // author-explicit `status` calls + auto-emissions at model-call
    // start/finish only" — author-explicit `status` calls emit
    // UNCONDITIONALLY in milestones mode (no `--milestone true` flag
    // required). The previous gate required `--milestone true` which
    // contradicted the spec text. Only `silent` mode silences explicit
    // status calls. Production emits all explicit status calls in
    // milestones mode; the golden now matches.
    const mode = ctx.exec?.progressMode ?? "full";
    const emitTrace = mode !== "silent";
    ctx.exec?.taskRegistry.updateProgress(progress, total, message, { emitTrace });
    if (mode === "silent") return null;

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
    if (positional.length === 0) {
      // §14.3.0 rename: arithmetic_argument_count → sub_argument_count.
      throw new MacroRuntimeError("sub: need at least one number", undefined, { reason: "sub_argument_count" });
    }
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
      // §14.3.0 rename: unique_argument_type → unique_type_mismatch.
      throw new MacroRuntimeError(`unique expects a list, got ${describe(v)}`, undefined, { reason: "unique_type_mismatch" });
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
      // §14.3.0 rename: append_argument_type → append_type_mismatch.
      throw new MacroRuntimeError(`append expects a list as first arg, got ${describe(list)}`, undefined, { reason: "append_type_mismatch" });
    }
    const items = positional.slice(1);
    return [...list, ...items];
  },

  // §14.3.1 `filter $list $field $op $value` → list. Returns the subset of a
  // list of objects whose `$field $op $value` is true. Arity, named-args, and a
  // *literal* bad operator are caught upstream at preflight (preflightBuiltins
  // → invalid_input); the value-dependent faults below surface at runtime as
  // tool_call_failed. Empty input → []. Non-mutating.
  filter: (positional, _named) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    const opRaw = positional[2];
    const value = positional[3];

    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(
        `filter expects a list as its first argument, got ${describe(list)}`,
        undefined,
        { reason: "filter_type_mismatch" },
      );
    }
    if (typeof fieldRaw !== "string") {
      throw new MacroRuntimeError(
        `filter field must be a string, got ${describe(fieldRaw)}`,
        undefined,
        { reason: "filter_field_type" },
      );
    }
    if (typeof opRaw !== "string" || !FILTER_OPS.has(opRaw)) {
      throw new MacroRuntimeError(
        `filter operator must be one of ==, !=, <, >, <=, >= (got ${describe(opRaw)})`,
        undefined,
        { reason: "filter_operator_invalid" },
      );
    }

    const out: Value[] = [];
    for (const row of list) {
      const fieldValue = resolveFieldPath(row, fieldRaw);
      if (compareWithOp(fieldValue, opRaw, value)) out.push(row);
    }
    return out;
  },

  // §14.3.2 `sort $list $field $direction` → list. Stable, non-mutating. Numeric
  // fields sort numerically; string fields lexicographically; null field values
  // (incl. missing leaf) sort to the END under both directions (NULLS LAST),
  // preserving input order. Mixed/ non-scalar non-null field values →
  // sort_field_type_mismatch.
  sort: (positional) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    const directionRaw = positional[2];
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`sort expects a list as its first argument, got ${describe(list)}`, undefined, { reason: "sort_type_mismatch" });
    }
    if (typeof fieldRaw !== "string") {
      throw new MacroRuntimeError(`sort field must be a string, got ${describe(fieldRaw)}`, undefined, { reason: "sort_field_type" });
    }
    if (directionRaw !== "asc" && directionRaw !== "desc") {
      throw new MacroRuntimeError(`sort direction must be "asc" or "desc", got ${describe(directionRaw)}`, undefined, { reason: "sort_direction_invalid" });
    }
    const decorated = list.map((row, i) => ({ row, i, key: resolveFieldPath(row, fieldRaw) }));
    let kind: "number" | "string" | null = null;
    for (const d of decorated) {
      if (d.key === null) continue;
      if (typeof d.key === "number") {
        if (kind === "string") throw sortFieldMismatch();
        kind = "number";
      } else if (typeof d.key === "string") {
        if (kind === "number") throw sortFieldMismatch();
        kind = "string";
      } else {
        throw sortFieldMismatch();
      }
    }
    const asc = directionRaw === "asc";
    decorated.sort((a, b) => {
      const an = a.key === null;
      const bn = b.key === null;
      if (an && bn) return a.i - b.i;
      if (an) return 1; // nulls last (both directions)
      if (bn) return -1;
      let cmp: number;
      if (kind === "number") cmp = (a.key as number) - (b.key as number);
      else cmp = (a.key as string) < (b.key as string) ? -1 : (a.key as string) > (b.key as string) ? 1 : 0;
      if (cmp === 0) return a.i - b.i; // stable
      return asc ? cmp : -cmp;
    });
    return decorated.map((d) => d.row);
  },

  // §14.3.3 `first $list` → item | null. Non-mutating.
  first: (positional) => {
    const list = positional[0];
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`first expects a list, got ${describe(list)}`, undefined, { reason: "first_type_mismatch" });
    }
    return list.length > 0 ? list[0] : null;
  },

  // §14.3.4 `last $list` → item | null. Non-mutating.
  last: (positional) => {
    const list = positional[0];
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`last expects a list, got ${describe(list)}`, undefined, { reason: "last_type_mismatch" });
    }
    return list.length > 0 ? list[list.length - 1] : null;
  },

  // §14.3.5 `keys $object` → list of strings (insertion order). Empty → [].
  keys: (positional) => {
    const obj = positional[0];
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      throw new MacroRuntimeError(`keys expects a record, got ${describe(obj)}`, undefined, { reason: "keys_type_mismatch" });
    }
    return Object.keys(obj as Record<string, Value>);
  },

  // §14.3.6 `contains $list $value` → boolean. Recursive deepEqual membership.
  contains: (positional) => {
    const list = positional[0];
    const value = positional[1];
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`contains expects a list as its first argument, got ${describe(list)}`, undefined, { reason: "contains_type_mismatch" });
    }
    return list.some((item) => valueEquals(item, value));
  },

  // §14.3.7 `join $list $separator` → string. Every element must be a string
  // (no implicit stringification). Empty → "".
  join: (positional) => {
    const list = positional[0];
    const separator = positional[1];
    if (typeof separator !== "string") {
      throw new MacroRuntimeError(`join separator must be a string, got ${describe(separator)}`, undefined, { reason: "join_separator_type" });
    }
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`join expects a list as its first argument, got ${describe(list)}`, undefined, { reason: "join_type_mismatch" });
    }
    const parts: string[] = [];
    for (const item of list) {
      if (typeof item !== "string") {
        throw new MacroRuntimeError(`join elements must all be strings, got ${describe(item)}`, undefined, { reason: "join_element_type" });
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
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`map expects a list as its first argument, got ${describe(list)}`, undefined, { reason: "map_type_mismatch" });
    }
    if (typeof fieldRaw !== "string") {
      throw new MacroRuntimeError(`map field must be a string, got ${describe(fieldRaw)}`, undefined, { reason: "map_field_type" });
    }
    return list.map((row) => resolveFieldPath(row, fieldRaw));
  },

  // §14.3.9 `any $list $field $op $value` → boolean. Short-circuits on first match. Empty → false.
  any: (positional) => {
    const list = positional[0];
    const fieldRaw = positional[1];
    const opRaw = positional[2];
    const value = positional[3];
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`any expects a list as its first argument, got ${describe(list)}`, undefined, { reason: "any_type_mismatch" });
    }
    if (typeof fieldRaw !== "string") {
      throw new MacroRuntimeError(`any field must be a string, got ${describe(fieldRaw)}`, undefined, { reason: "any_field_type" });
    }
    if (typeof opRaw !== "string" || !FILTER_OPS.has(opRaw)) {
      throw new MacroRuntimeError(`any operator must be one of ==, !=, <, >, <=, >= (got ${describe(opRaw)})`, undefined, { reason: "any_operator_invalid" });
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
    if (!Array.isArray(list)) {
      throw new MacroRuntimeError(`all expects a list as its first argument, got ${describe(list)}`, undefined, { reason: "all_type_mismatch" });
    }
    if (typeof fieldRaw !== "string") {
      throw new MacroRuntimeError(`all field must be a string, got ${describe(fieldRaw)}`, undefined, { reason: "all_field_type" });
    }
    if (typeof opRaw !== "string" || !FILTER_OPS.has(opRaw)) {
      throw new MacroRuntimeError(`all operator must be one of ==, !=, <, >, <=, >= (got ${describe(opRaw)})`, undefined, { reason: "all_operator_invalid" });
    }
    for (const row of list) {
      if (!compareWithOp(resolveFieldPath(row, fieldRaw), opRaw, value)) return false;
    }
    return true;
  },

  // REQ-038 (item 17): `range N` => [0..N-1]; `range A B` => [A..B-1];
  // `range A B step` => [A, A+step, ...] (excluding B). All endpoints integer.
  range: (positional) => {
    const nums = positional.map((v) => {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        // §14.3.0 rename: range_operand_type_mismatch → range_type_mismatch.
        throw new MacroRuntimeError(`range expects integers, got ${describe(v)}`, undefined, { reason: "range_type_mismatch" });
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
