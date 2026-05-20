// Tree-walking evaluator for the FlashQuery macro language golden model.
//
// Per-invocation isolation: an ExecContext carries the task registry, side
// effects, budget counters, state_notes accumulator, and broker through the
// CallContext. There is no module-level global registry (item 10 / REQ-025).

import type {
  Arg,
  BinaryOp,
  BuiltinFn,
  Call,
  CallContext,
  ExecContext,
  Expr,
  ForLoop,
  IfStmt,
  Negation,
  ObjectLit,
  Pipeline,
  Program,
  RangeOp,
  Statement,
  ToolCall,
  ToolRegistry,
  Value,
  WhileLoop,
  BudgetCaps,
  TraceMode,
  ProgressMode,
} from "./types.ts";
import type { CallToolResult, McpBroker } from "./broker.ts";
import { NullMcpBroker } from "./broker.ts";
import { TaskRegistry, type TaskTraceStep } from "./taskregistry.ts";
import type { StateNote } from "./statenotes.ts";
import { toSerializable } from "./statenotes.ts";
import { coerceNonError, formatToolError, type CoercePath } from "./coerce.ts";

// ----- Error classes (full set kept here for the four-way termination
// contract: MacroRuntimeError, MacroCancellationError, MacroFailError,
// MacroExitError + the pre-flight / forbidden / budget classes) -----

export class MacroRuntimeError extends Error {
  constructor(message: string, public line?: number) {
    super(line !== undefined ? `${message} (line ${line})` : message);
  }
}

export class MacroCancellationError extends Error {
  constructor(message: string, public readonly at_safe_point?: string) {
    super(message);
    this.name = "MacroCancellationError";
  }
}

export class MacroFailError extends Error {
  // REQ-024 ac5 / REQ-054: `brokered: true` distinguishes brokered-tool
  // failures (envelope code `tool_call_failed`) from author-initiated
  // `fail()` calls (envelope code `macro_aborted`). The runner / snapshot
  // pipeline reads this to choose the right top-level code.
  constructor(
    message: string,
    public readonly line?: number,
    public readonly brokered: boolean = false,
  ) {
    super(message);
    this.name = "MacroFailError";
  }
}

export class MacroPreflightError extends Error {
  constructor(
    message: string,
    public readonly details: {
      required_inputs: string[];
      optional_inputs: string[];
      provided_inputs: string[];
      missing_inputs: string[];
    },
  ) {
    super(message);
    this.name = "MacroPreflightError";
  }
}

export class ForbiddenPathError extends Error {
  constructor(
    public readonly macroPath: string,
    public readonly reason: string,
  ) {
    super(
      `macro shell verbs cannot reach outside the vault root. ` +
      `The path "${macroPath}" ${reason}.`,
    );
    this.name = "ForbiddenPathError";
  }
}

export class MacroForbiddenFlagError extends Error {
  constructor(
    public readonly verb: string,
    public readonly flag: string,
    public readonly reason: string,
  ) {
    super(
      `the flag '${flag}' is not permitted in macro shell verbs (${reason})`,
    );
    this.name = "MacroForbiddenFlagError";
  }
}

export class MacroExitError extends Error {
  constructor(public readonly value: Value) {
    super("macro exited");
    this.name = "MacroExitError";
  }
}

// Tier 2 / REQ-105: fifth termination class. The macro author calls
// `needs_user_input(...)` and the engine raises this to unwind back to
// the runner / host, which is responsible for rendering the question to
// the user and re-invoking the macro with the resolved answer.
//
// Payload shape per REQ-105 / §7.15 Extension 3:
//   question (required)        — free-text
//   context (optional)         — what state the macro is in, why asking
//   options (optional)         — discrete branchable choices
//   answer_shape (required)    — dotted path or section heading where the
//                                resolved answer is written back
//   resume_hint (optional)     — behavior on re-invocation
//
// Nested propagation: when a brokered tool emits `needs_user_input` (the
// broker decided to elicit), the macro engine MUST propagate it as the
// macro's own `needs_user_input` exit (per REQ-105 last paragraph).
export class MacroNeedsUserInputError extends Error {
  constructor(
    public readonly payload: {
      question: string;
      context?: string;
      options?: string[];
      answer_shape: string;
      resume_hint?: string;
      // Optional broker-emitted extension fields (TOFU drift event, etc.).
      event?: string;
      [k: string]: Value | undefined;
    },
  ) {
    super(`needs_user_input: ${payload.question}`);
    this.name = "MacroNeedsUserInputError";
  }
}

// Internal signals for `continue` / `break` loop control (REQ-104). These
// are thrown by `execStatement` when the corresponding AST node is reached
// and caught by the loop-driving switch arms. They are NOT macro
// terminations — they only unwind one loop level. Distinct from
// MacroFailError / MacroExitError so loops can match precisely.
class ContinueSignal {
  // Empty class - thrown bare to signal "skip to next iteration of the
  // innermost enclosing loop." Not a real Error subclass to avoid being
  // caught by generic `catch (e: Error)` paths.
  readonly _signal = "continue" as const;
}
class BreakSignal {
  readonly _signal = "break" as const;
}

// REQ-029: dispatch-time permission backstop. Thrown by the dispatcher if a
// tool wasn't included in the pre-scan allow set.
export class MacroPermissionError extends Error {
  constructor(public readonly tool: string, public readonly reason: string) {
    super(`Permission denied for ${tool}: ${reason}`);
    this.name = "MacroPermissionError";
  }
}

// REQ-028 ac4: pre-scan rejection. One envelope per macro, listing ALL
// violations at once. The `code` field discriminates whether the macro is
// rejected primarily for `unknown_server`, `unknown_tool`, or
// `forbidden_tools`. Per REQ-028 ac3 "config errors (`unknown_server` /
// `unknown_tool`) surface separately from permission errors" — when the
// macro has both, the runner emits the config-error envelope (the one
// listed first below) since the macro is fundamentally not runnable as
// written; the forbidden-tools list is informational in that case.
export class MacroPrescanError extends Error {
  constructor(
    // REQ-054: `template_masquerade_tools_not_callable_from_macro` is a
    // distinct top-level code per the spec. The golden surfaces it when
    // the pre-scan's ONLY violations are template-masquerade references;
    // mixed cases still surface as `forbidden_tools` with the discriminator
    // in details.
    public readonly code:
      | "unknown_server"
      | "unknown_tool"
      | "forbidden_tools"
      | "template_masquerade_tools_not_callable_from_macro",
    message: string,
    public readonly details: {
      unknown_servers: string[];
      unknown_tools: string[];
      forbidden: string[];
      allowed: string[];
    },
  ) {
    super(message);
    this.name = "MacroPrescanError";
  }
}

// REQ-060: budget exceeded.
//
// REQ-054 / REQ-060 ac1: the timeout case surfaces with the dedicated
// top-level `timeout` code, not the generic `budget_exceeded`. The
// runner / snapshot pipeline reads `kind === "timeout_ms"` and picks
// the right top-level error code.
export class MacroBudgetError extends Error {
  constructor(public readonly kind: string, public readonly cap: number, public readonly actual: number) {
    super(`Budget exceeded: ${kind} (cap=${cap}, actual=${actual})`);
    this.name = "MacroBudgetError";
  }
}

// ----- emitStateNote — per-invocation; routes via ExecContext -----

function emitStateNote(exec: ExecContext | undefined, note: StateNote): void {
  if (!exec) return;
  exec.stateNotes.push(note);
  // Also attach to the current task's most-recent trace step if any.
  const reg = exec.taskRegistry;
  const t = reg.get(exec.taskId);
  if (t && t.trace.length > 0) {
    const last = t.trace[t.trace.length - 1];
    if (!last.state_notes) last.state_notes = [];
    last.state_notes.push(note);
  }
}

// ----- Cooperative-cancellation check -----

function checkCancelled(exec: ExecContext | undefined, where: string): void {
  if (!exec) return;
  const t = exec.taskRegistry.get(exec.taskId);
  if (t && t.status === "cancelled") {
    throw new MacroCancellationError(`macro cancelled at ${where}`, where);
  }
}

// ----- Budget enforcement -----

function checkBudget(exec: ExecContext | undefined): void {
  if (!exec) return;
  const { budgetCaps: caps, budgetCounters: counters } = exec;
  if (caps.max_total_tokens !== undefined && counters.tokens > caps.max_total_tokens) {
    throw new MacroBudgetError("max_total_tokens", caps.max_total_tokens, counters.tokens);
  }
  if (caps.max_model_calls !== undefined && counters.model_calls > caps.max_model_calls) {
    throw new MacroBudgetError("max_model_calls", caps.max_model_calls, counters.model_calls);
  }
  if (caps.max_external_tool_calls !== undefined && counters.external_tool_calls > caps.max_external_tool_calls) {
    throw new MacroBudgetError("max_external_tool_calls", caps.max_external_tool_calls, counters.external_tool_calls);
  }
  if (caps.timeout_ms !== undefined) {
    const elapsed = Date.now() - counters.started_at;
    if (elapsed > caps.timeout_ms) {
      throw new MacroBudgetError("timeout_ms", caps.timeout_ms, elapsed);
    }
  }
}

function snapshotBudget(exec: ExecContext): StateNote {
  return {
    kind: "budget",
    tokens: exec.budgetCounters.tokens,
    model_calls: exec.budgetCounters.model_calls,
    external_tool_calls: exec.budgetCounters.external_tool_calls,
    elapsed_ms: Date.now() - exec.budgetCounters.started_at,
  };
}

// ----- Environment -----

class Env {
  private bindings = new Map<string, Value>();
  // Tier 2 (REQ-103): whether `_self` is bound in this evaluation. Tracked
  // on the ROOT env (set via `setSelfBound` in `evaluate()`); child envs
  // walk up. Distinct from "is `_self` in `bindings`" because we want to
  // produce the spec-mandated runtime error message when `_self.*` is
  // accessed on an inline-source macro.
  private _selfBound = false;
  constructor(public parent: Env | null = null) {}

  setSelfBound(b: boolean): void {
    this._selfBound = b;
  }
  isSelfBound(): boolean {
    if (this._selfBound) return true;
    if (this.parent) return this.parent.isSelfBound();
    return false;
  }

  get(name: string): Value {
    if (this.bindings.has(name)) return this.bindings.get(name) as Value;
    if (this.parent) return this.parent.get(name);
    // Tier 2 (REQ-103): the runtime-error message for `_self` access on a
    // macro loaded from inline source is spec-mandated verbatim. Surface
    // it instead of the generic "Unknown variable" message.
    if (name === "_self") {
      throw new MacroRuntimeError(
        "`_self` is only available when the macro was loaded via source_ref.",
      );
    }
    throw new MacroRuntimeError(`Unknown variable: $${name}`);
  }

  has(name: string): boolean {
    if (this.bindings.has(name)) return true;
    if (this.parent) return this.parent.has(name);
    return false;
  }

  // Returns "set" | "update" depending on whether this is a new binding or
  // overwrote an ancestor binding.
  set(name: string, value: Value): "set" | "update" {
    const owner = this.findOwner(name);
    if (owner) {
      owner.bindings.set(name, value);
      return "update";
    } else {
      this.bindings.set(name, value);
      return "set";
    }
  }

  setLocal(name: string, value: Value): void {
    this.bindings.set(name, value);
  }

  private findOwner(name: string): Env | null {
    if (this.bindings.has(name)) return this;
    if (this.parent) return this.parent.findOwner(name);
    return null;
  }

  // Whether the named binding lives in this scope (vs. an ancestor). Used
  // to classify the binding state_note's scope field.
  isLocal(name: string): boolean {
    return this.bindings.has(name);
  }
}

export type Builtins = Record<string, BuiltinFn>;

// Tier 2 (REQ-103): source-document snapshot bound to `_self` when the
// macro was loaded via `source_ref`. Read-only at the macro-language level
// (parser rejects `_self = ...`). When absent, accessing `_self.*` is a
// RUNTIME error with the spec-mandated message.
export type SelfBinding = {
  path: string;
  frontmatter: Record<string, Value>;
  title: string;
  tags: Value[];
  fq_id: string;
};

export type EvaluateOptions = {
  builtins: Builtins;
  tools?: ToolRegistry;
  inputVars?: Record<string, Value>;
  vaultRoot?: string;
  log?: (line: string) => void;
  // Per-invocation context configuration.
  budgetCaps?: BudgetCaps;
  traceMode?: TraceMode;
  progressMode?: ProgressMode;
  dryRun?: boolean;
  broker?: McpBroker;
  caller?: string;
  // Pre-built ExecContext (used by snapshot.ts to thread its own context).
  exec?: ExecContext;
  // Tier 2 (REQ-103): when present, bind `_self` to this snapshot. When
  // absent, the macro is treated as "loaded via inline source" and any
  // `_self.*` access raises a runtime error.
  selfBinding?: SelfBinding;
};

// Construct a fresh ExecContext with the given options.
export function makeExecContext(opts: {
  macroSource: string;
  caller?: string;
  budgetCaps?: BudgetCaps;
  traceMode?: TraceMode;
  progressMode?: ProgressMode;
  dryRun?: boolean;
  broker?: McpBroker;
  allowedTools?: Set<string>;
}): ExecContext {
  const reg = new TaskRegistry();
  const taskId = reg.create({ macroSource: opts.macroSource, caller: opts.caller });
  const now = Date.now();
  return {
    taskRegistry: reg,
    taskId,
    sideEffects: { vault_writes: [], tool_calls: [] },
    budgetCaps: opts.budgetCaps ?? {},
    budgetCounters: { tokens: 0, model_calls: 0, external_tool_calls: 0, started_at: now },
    permissionDecisions: [],
    stateNotes: [],
    traceMode: opts.traceMode ?? "full",
    progressMode: opts.progressMode ?? "full",
    dryRun: opts.dryRun ?? false,
    broker: opts.broker ?? new NullMcpBroker(),
    allowedTools: opts.allowedTools ?? new Set<string>(),
    warnings: [],
  };
}

// Two-KB value truncator for "summary" trace mode (REQ-047).
function truncForTrace(v: Value, mode: TraceMode): Value {
  if (mode === "none") return null;
  if (mode === "full") return v;
  // summary: stringify; cap at 2KB.
  const s = JSON.stringify(v);
  if (s && s.length > 2048) return s.slice(0, 2045) + "...";
  return v;
}

function emitAutoProgress(exec: ExecContext | undefined, message: string, milestone: boolean): void {
  if (!exec) return;
  const mode = exec.progressMode;
  if (mode === "silent") return;
  if (mode === "milestones" && !milestone) return;
  process.stderr.write(`[PROGRESS] ${message}\n`);
  exec.taskRegistry.appendTrace({ kind: "progress", message });
}

export async function evaluate(program: Program, opts: EvaluateOptions): Promise<Value> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const inputVars = opts.inputVars ?? {};

  // Build or reuse the ExecContext (snapshot.ts may pre-build one to capture
  // its own state). When opts.exec is supplied we trust it; otherwise build.
  const exec: ExecContext =
    opts.exec ??
    makeExecContext({
      macroSource: serializeAst(program),
      caller: opts.caller,
      budgetCaps: opts.budgetCaps,
      traceMode: opts.traceMode,
      progressMode: opts.progressMode,
      dryRun: opts.dryRun,
      broker: opts.broker,
    });

  const ctx: CallContext = { log, inputVars, vaultRoot: opts.vaultRoot, exec };
  const env = new Env();
  const tools = opts.tools ?? {};

  // Tier 2 (REQ-103): when the macro was loaded via source_ref, bind
  // `_self` to the source-document snapshot. When absent, `_self.*` access
  // raises a runtime error with the spec-mandated message. The flag is
  // tracked on the env so FieldAccess can distinguish "_self not bound"
  // from "_self bound but field missing".
  if (opts.selfBinding) {
    const sb = opts.selfBinding;
    const selfObj: Record<string, Value> = {
      path: sb.path,
      frontmatter: sb.frontmatter,
      title: sb.title,
      tags: sb.tags,
      fq_id: sb.fq_id,
    };
    env.setLocal("_self", selfObj);
    env.setSelfBound(true);
  } else {
    env.setSelfBound(false);
  }

  // ----- Pre-flight: shell-verb flag rejections (REQ-044) -----
  preScanForbiddenFlags(program);

  // ----- Pre-flight: input_var contract validation (REQ-007) -----
  const { required, optional } = collectInputVarContract(program);
  const provided = Object.keys(inputVars);
  const missing = required.filter((k) => !(k in inputVars));
  if (missing.length > 0) {
    const message = `Macro is missing required input(s): ${missing.join(", ")}`;
    throw new MacroPreflightError(message, {
      required_inputs: required,
      optional_inputs: optional,
      provided_inputs: provided,
      missing_inputs: missing,
    });
  }

  // REQ-053: populate the dry-run inventory now that we've walked the AST
  // for the input-var contract. The tool / server inventories are
  // computed by walking the program for ToolCall references.
  const { toolRefs, serverRefs } = collectToolReferences(program);
  exec.dryRunInventory = {
    input_var_contract: { required, optional },
    tool_references: toolRefs,
    server_references: serverRefs,
  };

  // ----- Pre-flight: static tool permission pre-scan (REQ-028, item 18) -----
  prescanPermissions(program, tools, exec);

  // ----- Execute -----
  try {
    for (const stmt of program.statements) {
      checkCancelled(exec, "between top-level statements");
      checkBudget(exec);
      await execStatement(stmt, env, opts.builtins, tools, ctx);
    }
    return null;
  } catch (e) {
    if (e instanceof MacroExitError) {
      return e.value;
    }
    throw e;
  }
}

// Best-effort AST → source preview (used for the task record's macro preview
// when the original source isn't separately preserved). The first three
// statements' first lines, joined.
function serializeAst(program: Program): string {
  return program.statements
    .slice(0, 3)
    .map((s) => `stmt:${s.kind}`)
    .join(" / ");
}

// ----- input_var contract collector -----

function collectInputVarContract(program: Program): {
  required: string[];
  optional: string[];
} {
  const required: string[] = [];
  const optional: string[] = [];

  function visitStmt(stmt: Statement): void {
    switch (stmt.kind) {
      case "Binding":
        visitExpr(stmt.value);
        return;
      case "Pipeline":
        for (const stage of stmt.stages) visitCall(stage);
        return;
      case "ToolCall":
        if (stmt.arg && stmt.arg.kind === "ObjectLit") visitExpr(stmt.arg);
        return;
      case "ForLoop":
        visitExpr(stmt.iterable);
        for (const s of stmt.body) visitStmt(s);
        return;
      case "WhileLoop":
        visitExpr(stmt.cond);
        for (const s of stmt.body) visitStmt(s);
        return;
      case "IfStmt":
        visitExpr(stmt.cond);
        for (const s of stmt.thenBody) visitStmt(s);
        for (const s of stmt.elseBody ?? []) visitStmt(s);
        return;
      case "ContinueStmt":
      case "BreakStmt":
        // Tier 2: no expressions inside; nothing to collect.
        return;
    }
  }

  function visitExpr(expr: Expr): void {
    switch (expr.kind) {
      case "Pipeline":
        for (const stage of expr.stages) visitCall(stage);
        return;
      case "ListLit":
        for (const it of expr.items) visitExpr(it);
        return;
      case "ObjectLit":
        for (const e of expr.entries) visitExpr(e.value);
        return;
      case "Negation":
        visitExpr(expr.expr);
        return;
      case "BinaryOp":
        visitExpr(expr.left);
        visitExpr(expr.right);
        return;
      case "RangeOp":
        visitExpr(expr.start);
        visitExpr(expr.end);
        return;
      case "ToolCall":
        if (expr.arg && expr.arg.kind === "ObjectLit") visitExpr(expr.arg);
        return;
      default:
        return;
    }
  }

  function visitCall(call: Call): void {
    if (call.name === "input_var") {
      const first = call.args.find((a) => a.kind === "PositionalArg");
      // Parser has already verified this is a literal — we only need the key.
      if (first && first.value.kind === "StringLit") {
        const key = first.value.raw;
        const defaultArg = call.args.find(
          (a) => a.kind === "NamedArg" && a.name === "default",
        );
        if (defaultArg) {
          // REQ-007 ac1 + ac2 (extended by REQ-112e): default MUST be a
          // literal — string, number, null, boolean, list literal, or
          // object literal. Reject non-literals (VarRef, FieldAccess,
          // pipeline result, etc.) at pre-flight with
          // input_var_default_must_be_literal. Resolves GOLDEN_GAPS.md
          // GG-003 (2026-05-19) — golden was previously permissive here.
          const v = defaultArg.value;
          const literalKinds = new Set([
            "StringLit",
            "NumLit",
            "NullLit",
            "BoolLit",
            "ListLit",
            "ObjectLit",
          ]);
          if (!literalKinds.has(v.kind)) {
            throw new MacroPreflightError(
              `input_var "${key}" --default value must be a literal (got ${v.kind}).`,
              {
                required_inputs: required,
                optional_inputs: optional,
                provided_inputs: [],
                missing_inputs: [],
                reason: "input_var_default_must_be_literal",
                key,
                default_kind: v.kind,
              },
            );
          }
          if (!optional.includes(key)) optional.push(key);
        } else {
          if (!required.includes(key)) required.push(key);
        }
      }
    }
    for (const a of call.args) visitExpr(a.value);
  }

  for (const stmt of program.statements) visitStmt(stmt);
  return { required, optional };
}

// REQ-053: collect the static tool / server reference inventory for the
// dry-run envelope. Walks the AST and deduplicates by `<server>.<tool>`.
function collectToolReferences(program: Program): {
  toolRefs: Array<{ server: string; tool: string }>;
  serverRefs: string[];
} {
  const tools: Array<{ server: string; tool: string }> = [];
  const servers = new Set<string>();
  const seen = new Set<string>();

  function visitStmt(stmt: Statement): void {
    switch (stmt.kind) {
      case "Binding":
        visitExpr(stmt.value);
        return;
      case "ToolCall":
        // REQ-112a: VarRef-prefixed server slot (`$x._exists()`) has a
        // dynamic server name — not knowable statically. Skip the
        // static reference inventory; pre-scan and dry-run only see
        // literal-server tool calls.
        if (stmt.serverVarRef !== true) record(stmt.server, stmt.tool);
        if (stmt.arg && stmt.arg.kind === "ObjectLit") visitExpr(stmt.arg);
        return;
      case "Pipeline":
        return;
      case "ForLoop":
        visitExpr(stmt.iterable);
        for (const s of stmt.body) visitStmt(s);
        return;
      case "WhileLoop":
        visitExpr(stmt.cond);
        for (const s of stmt.body) visitStmt(s);
        return;
      case "IfStmt":
        visitExpr(stmt.cond);
        for (const s of stmt.thenBody) visitStmt(s);
        for (const s of stmt.elseBody ?? []) visitStmt(s);
        return;
      case "ContinueStmt":
      case "BreakStmt":
        return;
    }
  }
  function visitExpr(e: Expr): void {
    switch (e.kind) {
      case "ToolCall":
        // REQ-112a: skip VarRef tool calls in static inventory.
        if (e.serverVarRef !== true) record(e.server, e.tool);
        if (e.arg && e.arg.kind === "ObjectLit") visitExpr(e.arg);
        return;
      case "ListLit":
        for (const it of e.items) visitExpr(it);
        return;
      case "ObjectLit":
        for (const en of e.entries) visitExpr(en.value);
        return;
      case "Negation":
        visitExpr(e.expr);
        return;
      case "BinaryOp":
        visitExpr(e.left);
        visitExpr(e.right);
        return;
      case "RangeOp":
        visitExpr(e.start);
        visitExpr(e.end);
        return;
      default:
        return;
    }
  }
  function record(server: string, tool: string): void {
    const full = `${server}.${tool}`;
    if (seen.has(full)) return;
    seen.add(full);
    tools.push({ server, tool });
    servers.add(server);
  }
  for (const s of program.statements) visitStmt(s);
  return { toolRefs: tools, serverRefs: [...servers] };
}

// ----- Static tool permission pre-scan (REQ-028, item 18) -----
//
// Walk the AST, collect every `<server>.<tool>(...)` reference, decide
// allowed / unknown / forbidden vs. the registered tool surface AND the
// caller's allowlist. Emits a "permission" state_note for each decision.
// The dispatcher reads `allowedTools` at runtime as a backstop (REQ-029).
//
// Order matters per REQ-028 ac3:
//   1. Hard exclusions (REQ-031 template-masquerade; REQ-032 delegated
//      `fq.call_model`) — these short-circuit BEFORE registry checks
//      because they're always-denied regardless of whether the server
//      is registered.
//   2. Server registry membership (REQ-027 ac4-5). If the server isn't
//      registered, this is `unknown_server`.
//   3. Tool membership on that server. If the server is registered but
//      the specific tool isn't on it, this is `unknown_tool`.
//   4. Caller's allowlist (REQ-028 ac4). If server+tool exist but
//      aren't in the caller's allowlist, this is `forbidden_tools`.
//
// Introspection methods (REQ-045) — those starting with `_` like
// `_exists()` — are engine-resolved (REQ-045 ac1) and SKIP the registry
// check by design. `_exists()` exists specifically to probe unknown /
// unregistered server names; rejecting it at pre-scan would make the
// method useless. They are recorded as allowed and pass through.
//
// Per REQ-028 ac4, the engine MUST emit ONE envelope per macro listing
// every violation at once — not one envelope per violation. The
// `MacroPrescanError` thrown here carries all four arrays (unknown
// servers, unknown tools, forbidden, allowed) so the runner / snapshot
// API can render the canonical envelope shape.

// Caller allowlist: when no explicit allowlist is supplied (the standalone
// runner case), the allowlist is "everything in the registry" — i.e. no
// `forbidden_tools` violation is possible against registered tools. The
// `delegated_model` caller marker adds `fq.call_model` to the implicit
// exclusion set (REQ-032). A future production engine will replace this
// with `assembleNativeToolRegistry` lookup per REQ-028 ac2.
//
// Tier 2 (REQ-111 / REQ-112): brokered tools have NO TIER. The pre-scan
// makes no distinction between FQ-native tools and brokered tools for
// allow/deny — both go through identical registry-membership checks.
// Tier filtering (read-only / read-write) for FQ-native tools is the
// agent-loop's responsibility and is invisible to the macro engine. The
// pre-scan sees the consumer-filtered registry produced by the broker
// layer and pre-scans against THAT union (REQ-112). This is an
// architectural assertion — the implementation needs no new code paths
// for brokered tools.
function buildAllowlist(
  tools: ToolRegistry,
  caller: string,
  explicitAllowlist?: Set<string>,
): Set<string> {
  if (explicitAllowlist) return explicitAllowlist;
  const all = new Set<string>();
  for (const [server, entry] of Object.entries(tools)) {
    for (const tool of Object.keys(entry.tools)) {
      const full = `${server}.${tool}`;
      // REQ-032: delegated emitters cannot call fq.call_model.
      if (caller === "delegated_model" && full === "fq.call_model") continue;
      // REQ-031: template-masqueraded tools are never callable from macros.
      if (tool.startsWith("template_masquerade_")) continue;
      all.add(full);
    }
  }
  return all;
}

function prescanPermissions(
  program: Program,
  tools: ToolRegistry,
  exec: ExecContext,
): void {
  const caller = exec.taskRegistry.get(exec.taskId)?.caller ?? "standalone-runner";
  const allowlist = buildAllowlist(tools, caller);

  const seen = new Set<string>();
  const unknownServers = new Set<string>();
  const unknownTools = new Set<string>();
  const forbidden = new Set<string>();
  const allowedSet = new Set<string>();

  function decide(server: string, tool: string, _line: number): void {
    const full = `${server}.${tool}`;
    if (seen.has(full)) return;
    seen.add(full);

    // Introspection methods (REQ-045) — engine-resolved, never dispatched
    // to a server handler. `_exists()` is specifically designed to probe
    // unknown / unregistered server names and return false; the pre-scan
    // MUST NOT block it on registry-membership grounds.
    if (tool.startsWith("_")) {
      exec.permissionDecisions.push({ tool: full, decision: "allowed" });
      exec.allowedTools.add(full);
      allowedSet.add(full);
      emitStateNote(exec, { kind: "permission", tool: full, decision: "allowed" });
      return;
    }

    // REQ-031: template-masquerade hard exclusion. Always denied; surfaces
    // as `forbidden_tools` rather than `unknown_tool` to match the spec's
    // hard-exclusion semantics.
    if (tool.startsWith("template_masquerade_")) {
      exec.permissionDecisions.push({
        tool: full,
        decision: "denied",
        reason: "template_masquerade_tools_not_callable_from_macro",
      });
      emitStateNote(exec, {
        kind: "permission",
        tool: full,
        decision: "denied",
        reason: "template_masquerade_tools_not_callable_from_macro",
      });
      forbidden.add(full);
      return;
    }

    // REQ-032: delegated-emitter hard exclusion of `fq.call_model`.
    if (caller === "delegated_model" && full === "fq.call_model") {
      exec.permissionDecisions.push({
        tool: full,
        decision: "denied",
        reason: "delegated_emitter_recursive_model_call",
      });
      emitStateNote(exec, {
        kind: "permission",
        tool: full,
        decision: "denied",
        reason: "delegated_emitter_recursive_model_call",
      });
      forbidden.add(full);
      return;
    }

    // REQ-028 ac3 step 1 — server registry membership.
    const serverEntry = tools[server];
    if (!serverEntry) {
      exec.permissionDecisions.push({
        tool: full,
        decision: "denied",
        reason: "unknown_server",
      });
      emitStateNote(exec, {
        kind: "permission",
        tool: full,
        decision: "denied",
        reason: "unknown_server",
      });
      unknownServers.add(server);
      return;
    }

    // REQ-028 ac3 step 2 — tool membership on the server.
    if (!serverEntry.tools[tool]) {
      exec.permissionDecisions.push({
        tool: full,
        decision: "denied",
        reason: "unknown_tool",
      });
      emitStateNote(exec, {
        kind: "permission",
        tool: full,
        decision: "denied",
        reason: "unknown_tool",
      });
      unknownTools.add(full);
      return;
    }

    // REQ-028 ac3 step 3 — caller's allowlist.
    if (!allowlist.has(full)) {
      exec.permissionDecisions.push({
        tool: full,
        decision: "denied",
        reason: "forbidden_tools",
      });
      emitStateNote(exec, {
        kind: "permission",
        tool: full,
        decision: "denied",
        reason: "forbidden_tools",
      });
      forbidden.add(full);
      return;
    }

    // All checks pass — allowed.
    exec.permissionDecisions.push({ tool: full, decision: "allowed" });
    exec.allowedTools.add(full);
    allowedSet.add(full);
    emitStateNote(exec, { kind: "permission", tool: full, decision: "allowed" });
  }

  function visit(stmt: Statement): void {
    switch (stmt.kind) {
      case "Binding":
        visitExpr(stmt.value);
        return;
      case "Pipeline":
        return;
      case "ToolCall":
        // REQ-112a: VarRef-prefixed server slot is always an
        // introspection call (`_*`) per the static check; introspection
        // calls don't go through tier-based permission pre-scan. Skip.
        if (stmt.serverVarRef !== true) decide(stmt.server, stmt.tool, stmt.line);
        if (stmt.arg && stmt.arg.kind === "ObjectLit") visitExpr(stmt.arg);
        return;
      case "ForLoop":
        visitExpr(stmt.iterable);
        for (const s of stmt.body) visit(s);
        return;
      case "WhileLoop":
        visitExpr(stmt.cond);
        for (const s of stmt.body) visit(s);
        return;
      case "IfStmt":
        visitExpr(stmt.cond);
        for (const s of stmt.thenBody) visit(s);
        for (const s of stmt.elseBody ?? []) visit(s);
        return;
      case "ContinueStmt":
      case "BreakStmt":
        // Tier 2: no tool calls inside; nothing to pre-scan.
        return;
    }
  }
  function visitExpr(e: Expr): void {
    switch (e.kind) {
      case "ToolCall":
        // REQ-112a: skip VarRef tool calls in pre-scan (see above).
        if (e.serverVarRef !== true) decide(e.server, e.tool, e.line);
        if (e.arg && e.arg.kind === "ObjectLit") visitExpr(e.arg);
        return;
      case "ListLit":
        for (const it of e.items) visitExpr(it);
        return;
      case "ObjectLit":
        for (const en of e.entries) visitExpr(en.value);
        return;
      case "Negation":
        visitExpr(e.expr);
        return;
      case "BinaryOp":
        visitExpr(e.left);
        visitExpr(e.right);
        return;
      case "RangeOp":
        visitExpr(e.start);
        visitExpr(e.end);
        return;
      default:
        return;
    }
  }
  for (const s of program.statements) visit(s);

  // REQ-028 ac4 + ac5: if ANY violations collected across the entire AST,
  // throw ONE envelope listing them all. No partial side effects — this
  // runs after parse but before any statement executes.
  const hasUnknownServers = unknownServers.size > 0;
  const hasUnknownTools = unknownTools.size > 0;
  const hasForbidden = forbidden.size > 0;
  if (hasUnknownServers || hasUnknownTools || hasForbidden) {
    // Discriminate the envelope code per REQ-028 ac3 — config errors
    // (`unknown_server` / `unknown_tool`) surface separately from and
    // BEFORE permission errors. When multiple categories are present,
    // we surface the config error first since the macro is not
    // runnable as written; the forbidden list is informational.
    //
    // REQ-054: when the ONLY violations are template-masquerade refs,
    // use the spec's distinct top-level error code rather than the
    // generic `forbidden_tools`.
    const allForbiddenAreTemplateMasquerade =
      hasForbidden &&
      !hasUnknownServers &&
      !hasUnknownTools &&
      [...forbidden].every((full) => {
        const tool = full.split(".").slice(1).join(".");
        return tool.startsWith("template_masquerade_");
      });
    const code:
      | "unknown_server"
      | "unknown_tool"
      | "forbidden_tools"
      | "template_masquerade_tools_not_callable_from_macro" =
      hasUnknownServers ? "unknown_server"
        : hasUnknownTools ? "unknown_tool"
        : allForbiddenAreTemplateMasquerade ? "template_masquerade_tools_not_callable_from_macro"
        : "forbidden_tools";
    const parts: string[] = [];
    if (hasUnknownServers) parts.push(`unknown server(s): ${[...unknownServers].join(", ")}`);
    if (hasUnknownTools) parts.push(`unknown tool(s): ${[...unknownTools].join(", ")}`);
    if (hasForbidden) parts.push(`forbidden tool(s): ${[...forbidden].join(", ")}`);
    const message = `macro pre-scan rejected: ${parts.join("; ")}`;
    throw new MacroPrescanError(code, message, {
      unknown_servers: [...unknownServers],
      unknown_tools: [...unknownTools],
      forbidden: [...forbidden],
      allowed: [...allowedSet],
    });
  }
}

// ----- Forbidden shell-verb flag pre-scan -----

function preScanForbiddenFlags(program: Program): void {
  function visitStmt(stmt: Statement): void {
    switch (stmt.kind) {
      case "Binding":
        visitExpr(stmt.value);
        return;
      case "Pipeline":
        for (const stage of stmt.stages) visitCall(stage);
        return;
      case "ToolCall":
        return;
      case "ForLoop":
        for (const s of stmt.body) visitStmt(s);
        return;
      case "WhileLoop":
        for (const s of stmt.body) visitStmt(s);
        return;
      case "IfStmt":
        for (const s of stmt.thenBody) visitStmt(s);
        for (const s of stmt.elseBody ?? []) visitStmt(s);
        return;
      case "ContinueStmt":
      case "BreakStmt":
        return;
    }
  }
  function visitExpr(expr: Expr): void {
    if (expr.kind === "Pipeline") {
      for (const stage of expr.stages) visitCall(stage);
    }
  }
  function visitCall(call: Call): void {
    if (call.name === "sed") {
      for (const a of call.args) {
        if (a.kind !== "NamedArg") continue;
        if (a.name === "i" && a.rawShortFlag) {
          throw new MacroForbiddenFlagError("sed", "-i", "sed -i mutates files");
        }
        if ((a.name === "in-place" || a.name === "i") && !a.rawShortFlag) {
          throw new MacroForbiddenFlagError("sed", "--" + a.name, "sed in-place mutates files");
        }
      }
    } else if (call.name === "find") {
      for (const a of call.args) {
        if (a.kind !== "NamedArg") continue;
        if (a.rawShortFlag === "-exec") {
          throw new MacroForbiddenFlagError("find", "-exec", "arbitrary command execution");
        }
        if (a.rawShortFlag === "-delete") {
          throw new MacroForbiddenFlagError("find", "-delete", "file mutation via find");
        }
        if (!a.rawShortFlag) {
          if (a.name === "exec") {
            throw new MacroForbiddenFlagError("find", "--exec", "arbitrary command execution");
          }
          if (a.name === "delete") {
            throw new MacroForbiddenFlagError("find", "--delete", "file mutation via find");
          }
        }
      }
    }
  }
  for (const stmt of program.statements) visitStmt(stmt);
}

// ----- Statement / expression execution -----

let loopCounter = 0;
function nextLoopId(kind: string): string {
  return `${kind}_loop_${++loopCounter}`;
}

async function execStatement(stmt: Statement, env: Env, builtins: Builtins, tools: ToolRegistry, ctx: CallContext): Promise<void> {
  checkCancelled(ctx.exec, `before ${stmt.kind} (line ${stmt.line ?? "?"})`);
  checkBudget(ctx.exec);
  switch (stmt.kind) {
    case "Binding": {
      // Emit ast marker for assignments.
      emitStateNote(ctx.exec, {
        kind: "ast",
        node_kind: "assignment",
        line: stmt.line,
        column: 0,
      });
      const value = await evalExpr(stmt.value, env, builtins, tools, ctx);
      const op = env.set(stmt.name, value);
      const scope = env.isLocal(stmt.name) ? "local" : "outer";
      emitStateNote(ctx.exec, {
        kind: "binding",
        op,
        name: stmt.name,
        value: toSerializable(value),
        scope,
      });
      return;
    }
    case "Pipeline": {
      await runPipeline(stmt, env, builtins, tools, ctx);
      return;
    }
    case "ToolCall": {
      emitStateNote(ctx.exec, { kind: "ast", node_kind: "tool_call", line: stmt.line, column: 0 });
      await runToolCall(stmt, env, tools, ctx);
      return;
    }
    case "ForLoop": {
      const iterable = await evalExpr(stmt.iterable, env, builtins, tools, ctx);
      if (!Array.isArray(iterable)) {
        throw new MacroRuntimeError(
          `for loop expects a list, got ${describe(iterable)}`,
          stmt.line,
        );
      }
      const items = iterable as Value[];
      const loopId = nextLoopId("for");
      const total = items.length;
      forIter: for (let i = 0; i < total; i++) {
        checkCancelled(ctx.exec, `for-loop iteration ${i + 1}/${total}`);
        checkBudget(ctx.exec);
        const milestone = i === 0 || i === total - 1 || (total > 4 && i % Math.ceil(total / 4) === 0);
        emitAutoProgress(ctx.exec, `for-loop iteration ${i + 1}/${total}`, milestone);
        emitStateNote(ctx.exec, {
          kind: "loop",
          loop_kind: "for",
          loop_id: loopId,
          iter: i,
          var: stmt.varName,
          value: toSerializable(items[i]),
        });
        emitStateNote(ctx.exec, { kind: "ast", node_kind: "for_iter", line: stmt.line, column: 0 });
        const child = new Env(env);
        child.setLocal(stmt.varName, items[i]);
        emitStateNote(ctx.exec, {
          kind: "binding",
          op: "shadow",
          name: stmt.varName,
          value: toSerializable(items[i]),
          scope: "local",
        });
        // Tier 2 (REQ-104): catch `continue` / `break` signals raised by
        // statements inside the body. `continue` skips to the next
        // iteration; `break` exits the loop. Both emit a marker on the
        // current loop event so snapshot tests can verify the control
        // flow took the expected path.
        try {
          for (const s of stmt.body) {
            await execStatement(s, child, builtins, tools, ctx);
          }
        } catch (e) {
          if (e instanceof ContinueSignal) {
            emitStateNote(ctx.exec, {
              kind: "loop",
              loop_kind: "for",
              loop_id: loopId,
              iter: i,
              var: stmt.varName,
              value: toSerializable(items[i]),
              control: "continue",
            });
            continue forIter;
          }
          if (e instanceof BreakSignal) {
            emitStateNote(ctx.exec, {
              kind: "loop",
              loop_kind: "for",
              loop_id: loopId,
              iter: i,
              var: stmt.varName,
              value: toSerializable(items[i]),
              control: "break",
            });
            break forIter;
          }
          throw e;
        }
      }
      return;
    }
    case "WhileLoop": {
      const loopId = nextLoopId("while");
      let iter = 0;
      // Safety cap (REQ-015 ac2-ish): prevent runaway loops in golden.
      const MAX_ITER = 10000;
      whileLoop: while (true) {
        if (iter >= MAX_ITER) {
          throw new MacroRuntimeError(`while loop exceeded ${MAX_ITER} iterations`, stmt.line);
        }
        checkCancelled(ctx.exec, `while-loop iteration ${iter}`);
        checkBudget(ctx.exec);
        const condVal = await evalExpr(stmt.cond, env, builtins, tools, ctx);
        if (!isTruthy(condVal)) break;
        emitStateNote(ctx.exec, {
          kind: "loop",
          loop_kind: "while",
          loop_id: loopId,
          iter,
        });
        const child = new Env(env);
        try {
          for (const s of stmt.body) {
            await execStatement(s, child, builtins, tools, ctx);
          }
        } catch (e) {
          if (e instanceof ContinueSignal) {
            emitStateNote(ctx.exec, {
              kind: "loop",
              loop_kind: "while",
              loop_id: loopId,
              iter,
              control: "continue",
            });
            iter++;
            continue whileLoop;
          }
          if (e instanceof BreakSignal) {
            emitStateNote(ctx.exec, {
              kind: "loop",
              loop_kind: "while",
              loop_id: loopId,
              iter,
              control: "break",
            });
            break whileLoop;
          }
          throw e;
        }
        iter++;
      }
      return;
    }
    case "IfStmt": {
      emitStateNote(ctx.exec, { kind: "ast", node_kind: "if", line: stmt.line, column: 0 });
      const cond = await evalExpr(stmt.cond, env, builtins, tools, ctx);
      const branch = isTruthy(cond) ? stmt.thenBody : (stmt.elseBody ?? []);
      // REQ-112b: `if`/`else` branches do NOT introduce a new scope.
      // Body statements execute directly in the enclosing env so any
      // new variables they assign persist after `fi`. (Overrides the
      // archived Macro Lang REQ-019 ac3 listing of if/else branches as
      // scope-creating.)
      for (const s of branch) {
        await execStatement(s, env, builtins, tools, ctx);
      }
      return;
    }
    case "ContinueStmt": {
      // Parse-time check already verified we're inside a loop body. Throw
      // the signal; the enclosing loop catches it. REQ-104.
      emitStateNote(ctx.exec, { kind: "ast", node_kind: "continue", line: stmt.line, column: 0 });
      throw new ContinueSignal();
    }
    case "BreakStmt": {
      emitStateNote(ctx.exec, { kind: "ast", node_kind: "break", line: stmt.line, column: 0 });
      throw new BreakSignal();
    }
  }
}

async function evalExpr(expr: Expr, env: Env, builtins: Builtins, tools: ToolRegistry, ctx: CallContext): Promise<Value> {
  switch (expr.kind) {
    case "StringLit": {
      if (expr.interpolated) return interpolate(expr.raw, env);
      return expr.raw;
    }
    case "NumLit":
      return expr.value;
    case "BoolLit":
      return expr.value;
    case "NullLit":
      return null;
    case "VarRef":
      return env.get(expr.name);
    case "ListLit": {
      const items: Value[] = [];
      for (const e of expr.items) {
        items.push(await evalExpr(e, env, builtins, tools, ctx));
      }
      return items;
    }
    case "ObjectLit": {
      const out: Record<string, Value> = {};
      for (const entry of expr.entries) {
        out[entry.key] = await evalExpr(entry.value, env, builtins, tools, ctx);
      }
      return out;
    }
    case "FieldAccess": {
      const target = await evalExpr(expr.target, env, builtins, tools, ctx);
      // REQ-023 ac2-4 unchanged: null / non-object / list field-access
      // still raises. Chained access through null surfaces here too
      // (target === null when a prior step returned null).
      if (target === null || typeof target !== "object" || Array.isArray(target)) {
        throw new MacroRuntimeError(
          `Cannot access .${expr.field} on ${describe(target)}`,
        );
      }
      // REQ-112d: missing key on a present object returns null
      // (lenient leaf-access). Composes with truthiness so authors can
      // write `if $obj.maybe == null then ...` guards. Chained access
      // through the resulting null still throws per REQ-023 ac2 on the
      // next step.
      const v = (target as Record<string, Value>)[expr.field];
      if (v === undefined) {
        return null;
      }
      return v;
    }
    case "Pipeline":
      return runPipeline(expr, env, builtins, tools, ctx);
    case "ToolCall":
      return runToolCall(expr, env, tools, ctx);
    case "Negation": {
      const v = await evalExpr(expr.expr, env, builtins, tools, ctx);
      return !isTruthy(v);
    }
    case "BinaryOp":
      return evalBinaryOp(expr, env, builtins, tools, ctx);
    case "RangeOp":
      return evalRangeOp(expr, env, builtins, tools, ctx);
  }
}

async function evalBinaryOp(
  expr: BinaryOp,
  env: Env,
  builtins: Builtins,
  tools: ToolRegistry,
  ctx: CallContext,
): Promise<Value> {
  const op = expr.op;
  // Short-circuit booleans.
  if (op === "&&") {
    const l = await evalExpr(expr.left, env, builtins, tools, ctx);
    if (!isTruthy(l)) return l;
    return await evalExpr(expr.right, env, builtins, tools, ctx);
  }
  if (op === "||") {
    const l = await evalExpr(expr.left, env, builtins, tools, ctx);
    if (isTruthy(l)) return l;
    return await evalExpr(expr.right, env, builtins, tools, ctx);
  }
  const l = await evalExpr(expr.left, env, builtins, tools, ctx);
  const r = await evalExpr(expr.right, env, builtins, tools, ctx);
  switch (op) {
    case "==":
      return valueEquals(l, r);
    case "!=":
      return !valueEquals(l, r);
    case "<":
    case "<=":
    case ">":
    case ">=":
      // REQ-012 ac4: ordering ops are NUMERIC-ONLY in v0. Non-numeric
      // operands raise a runtime error — string comparison via these
      // operators is NOT supported.
      if (typeof l !== "number" || typeof r !== "number") {
        throw new MacroRuntimeError(
          `comparison operator '${op}' requires numeric operands (REQ-012 ac4); got ${describe(l)} ${op} ${describe(r)}`,
        );
      }
      return op === "<" ? l < r : op === "<=" ? l <= r : op === ">" ? l > r : l >= r;
  }
}

function valueEquals(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!valueEquals(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object") {
    if (Array.isArray(b) || typeof b !== "object") return false;
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!valueEquals((a as Record<string, Value>)[k], (b as Record<string, Value>)[k])) return false;
    }
    return true;
  }
  return false;
}

async function evalRangeOp(
  expr: RangeOp,
  env: Env,
  builtins: Builtins,
  tools: ToolRegistry,
  ctx: CallContext,
): Promise<Value> {
  const startV = await evalExpr(expr.start, env, builtins, tools, ctx);
  const endV = await evalExpr(expr.end, env, builtins, tools, ctx);
  if (typeof startV !== "number" || typeof endV !== "number") {
    throw new MacroRuntimeError(`range expects two integers, got ${describe(startV)}..${describe(endV)}`);
  }
  if (!Number.isInteger(startV) || !Number.isInteger(endV)) {
    throw new MacroRuntimeError(`range expects integer endpoints, got ${startV}..${endV}`);
  }
  // REQ-014 ac1: `..` is EXCLUSIVE of the end endpoint. `0..5` -> [0,1,2,3,4].
  // REQ-014 ac4 requires `0..N` and `range N` to be equivalent; the `range`
  // builtin already uses exclusive-end semantics (builtins.ts), so this
  // exclusive form is the only way to satisfy ac4. The descending form is
  // also exclusive of the end (5..0 -> [5,4,3,2,1]).
  const out: Value[] = [];
  if (startV <= endV) {
    for (let i = startV; i < endV; i++) out.push(i);
  } else {
    for (let i = startV; i > endV; i--) out.push(i);
  }
  return out;
}

// ----- Tool dispatch -----

async function runToolCall(
  call: ToolCall,
  env: Env,
  tools: ToolRegistry,
  ctx: CallContext,
): Promise<Value> {
  // REQ-112a: resolve VarRef-prefixed server slot to a concrete server
  // name. `call.serverVarRef === true` means the source wrote
  // `$<varName>.tool(...)`; `call.server` is the variable name. We
  // resolve it via env and use the resolved name for the remainder of
  // dispatch. Static check has already enforced the introspection-only
  // constraint, so this branch is reached only for `_*` tool names.
  if (call.serverVarRef === true) {
    const resolved = env.get(call.server);
    if (typeof resolved !== "string") {
      throw new MacroRuntimeError(
        `VarRef-prefixed server slot ($${call.server}) resolved to a ` +
          `non-string value (${describe(resolved)}). Per Broker REQ-112a ac2, ` +
          `the variable must hold the server name as a string.`,
        call.line,
      );
    }
    call = { ...call, server: resolved, serverVarRef: false };
  }
  checkCancelled(ctx.exec, `before tool call ${call.server}.${call.tool} (line ${call.line ?? "?"})`);
  checkBudget(ctx.exec);
  const startedAt = Date.now();

  // Introspection methods (leading underscore).
  if (call.tool.startsWith("_")) {
    return await resolveIntrospection(call, tools, ctx);
  }

  // REQ-029 dispatch-time backstop.
  const full = `${call.server}.${call.tool}`;
  if (ctx.exec && !ctx.exec.allowedTools.has(full)) {
    // Permitted to differ when the static pre-scan didn't see the call (e.g.
    // due to dynamic dispatch). For the golden's allow-by-default model the
    // backstop denies only template_masquerade_* and the delegated
    // recursive call_model case; both are recorded as explicit denials.
    const denial = ctx.exec.permissionDecisions.find((p) => p.tool === full && p.decision === "denied");
    if (denial) {
      throw new MacroPermissionError(full, denial.reason ?? "denied at pre-scan");
    }
  }

  const server = tools[call.server];
  if (!server) {
    // REQ-027 ac4 (item 12): envelope return instead of throw.
    const envelope: Value = {
      error: "unknown_server",
      message: `Unknown server: '${call.server}'. Registered: ${Object.keys(tools).join(", ") || "(none)"}`,
      identifier: call.server,
    };
    return envelope;
  }
  const handler = server.tools[call.tool];
  if (!handler) {
    const envelope: Value = {
      error: "unknown_tool",
      message: `Unknown tool: '${call.server}.${call.tool}'. Tools: ${Object.keys(server.tools).join(", ") || "(none)"}`,
      identifier: full,
    };
    return envelope;
  }

  // Evaluate the argument.
  //
  // REQ-108: argument-passthrough invariant. The macro engine MUST NOT
  // coerce macro values when constructing the JSON arg object. JS-native
  // types (string, number, boolean, null, array, nested object) pass
  // through bit-exact. Pre-coercion would mask schema mismatches and
  // hide real broker-side InvalidParams failures (POC Probe 12). We
  // simply assemble the object literal as-is — no number-to-string,
  // string-to-number, or "smart" conversion happens here.
  let arg: Value;
  if (!call.arg) {
    arg = {};
  } else if (call.arg.kind === "ObjectLit") {
    arg = {};
    for (const entry of call.arg.entries) {
      (arg as Record<string, Value>)[entry.key] = await evalExpr(
        entry.value,
        env,
        {},
        tools,
        ctx,
      );
    }
  } else {
    const v = env.get(call.arg.name);
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      throw new MacroRuntimeError(
        `Tool call argument must be an object; $${call.arg.name} is ${describe(v)}`,
        call.line,
      );
    }
    arg = v;
  }

  // Tier 2 (REQ-093 / REQ-098): `help: true` sentinel. When ANY tool call
  // has `help: true` as an argument, the engine MUST NOT dispatch — it
  // returns the tool's help-page body instead. For native fq tools the
  // body lives in `HELP_PAGES` (production: `*.tool.md` files); brokered
  // calls forward upstream unchanged per DELTA-1 (the mock returns a
  // canned text body so the example macro can show the round trip).
  let helpSentinel = false;
  if (
    arg !== null &&
    typeof arg === "object" &&
    !Array.isArray(arg) &&
    (arg as Record<string, Value>).help === true
  ) {
    helpSentinel = true;
  }

  // Dispatch.
  let result: Value;
  if (helpSentinel) {
    // Tier 2 (REQ-093 / REQ-098): help-sentinel shortcut. Engine returns
    // the help-page body wrapped in a CallToolResult-shaped envelope per
    // REQ-093's code sketch:
    //   { content: [{ type: "text", text: <body> }] }
    // For fq-native tools the body lives in HELP_PAGES; brokered help is
    // forwarded upstream by the production broker (DELTA-1) — in the
    // mock we synthesize a short body so example macros can show the
    // round trip.
    const helpBody = lookupHelpBody(call.server, call.tool);
    result = { content: [{ type: "text", text: helpBody }] };
    emitStateNote(ctx.exec, {
      kind: "coerce",
      path: "passthrough",
      raw_summary: `${call.server}.${call.tool} help:true sentinel (no dispatch)`,
    });
  } else if (ctx.exec?.dryRun) {
    // Dry-run: don't actually invoke; record a stub.
    result = { dry_run: true, server: call.server, tool: call.tool, arg };
    emitStateNote(ctx.exec, {
      kind: "coerce",
      path: "passthrough",
      raw_summary: `${call.server}.${call.tool} dry-run`,
    });
  } else {
    // Tier 2 (REQ-107): brokered-tool fail-fast. If the handler throws,
    // raise `fail` via `formatToolError`. The native `fq.*` path is
    // exempt — those handlers return Values directly and don't have
    // CallToolResult wrappers.
    try {
      const raw = await handler(arg as Record<string, Value>, ctx);
      // Tier 2 (REQ-106 + REQ-107): brokered handlers return CallToolResult
      // envelopes; apply the five-step coercion (with isError carve-out).
      // The "is this a CallToolResult?" check is the structural test:
      // presence of `isError`, `content`, or `structuredContent`. Native
      // FQ handlers return plain Value (e.g., a list, object, primitive)
      // and bypass coercion entirely (REQ-106 step 0 by omission).
      if (call.server !== "fq" && isCallToolResultShape(raw)) {
        result = applyBrokerCoercion(raw as unknown as CallToolResult, call, ctx);
      } else {
        result = raw;
        // Native-tool path: emit the existing passthrough state_note for
        // continuity with Phase 1. Brokered path emits its own (more
        // specific) coerce note in applyBrokerCoercion.
        emitStateNote(ctx.exec, {
          kind: "coerce",
          path: "passthrough",
          raw_summary: `${call.server}.${call.tool} returned ${describe(raw)} (native, no coercion)`,
        });
      }
    } catch (e) {
      // REQ-107: thrown errors from brokered handlers → fail-fast.
      if (call.server !== "fq" && !(e instanceof MacroNeedsUserInputError) &&
          !(e instanceof MacroFailError) && !(e instanceof MacroExitError) &&
          !(e instanceof MacroCancellationError)) {
        const norm = formatToolError(e);
        emitStateNote(ctx.exec, {
          kind: "coerce",
          path: "is_error",
          raw_summary: `${call.server}.${call.tool} threw ${norm.kind}: ${norm.message.slice(0, 120)}`,
        });
        throw new MacroFailError(
          `brokered tool ${full} failed (${norm.kind}): ${norm.message}`,
          call.line,
          true, // brokered → tool_call_failed
        );
      }
      throw e;
    }
  }

  const elapsed_ms = Date.now() - startedAt;

  // Side-effect & budget bookkeeping.
  if (ctx.exec) {
    const at = new Date().toISOString();
    ctx.exec.sideEffects.tool_calls.push({
      server: call.server,
      tool: call.tool,
      arg,
      result,
      elapsed_ms,
      at,
    });
    // Track vault writes specifically (REQ-046 side_effects manifest).
    if (call.server === "fq") {
      const argObj = arg as Record<string, Value>;
      if (call.tool === "write_document") {
        ctx.exec.sideEffects.vault_writes.push({
          kind: (argObj.mode === "update" ? "update" : "create"),
          path: typeof argObj.path === "string" ? argObj.path : undefined,
          identifier: typeof argObj.identifier === "string" ? argObj.identifier : undefined,
          at,
        });
      } else if (call.tool === "move_document") {
        ctx.exec.sideEffects.vault_writes.push({
          kind: "move",
          identifier: typeof argObj.identifier === "string" ? argObj.identifier : undefined,
          destination_path: typeof argObj.destination_path === "string" ? argObj.destination_path : undefined,
          at,
        });
      } else if (call.tool === "archive_document" || call.tool === "remove_document") {
        ctx.exec.sideEffects.vault_writes.push({
          kind: "delete",
          identifier: typeof argObj.identifiers === "string" ? argObj.identifiers : undefined,
          at,
        });
      } else if (call.tool === "manage_directory") {
        ctx.exec.sideEffects.vault_writes.push({
          kind: "directory",
          details: { action: argObj.action ?? null, paths: argObj.paths ?? [] },
          at,
        });
      }
    }
    // Budget counters.
    if (call.server === "fq" && call.tool === "call_model") {
      ctx.exec.budgetCounters.model_calls += 1;
      // Tokens, if the result returned a usage block.
      const r = result as Record<string, Value> | null;
      if (r && typeof r === "object" && !Array.isArray(r) && r.usage && typeof r.usage === "object") {
        const usage = r.usage as Record<string, Value>;
        const inT = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
        const outT = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
        ctx.exec.budgetCounters.tokens += inT + outT;
      }
    } else if (call.server !== "fq") {
      // External brokered tool.
      ctx.exec.budgetCounters.external_tool_calls += 1;
    }

    // tool_call trace step with args/result/elapsed_ms (REQ-046 / item 5).
    // Note: the coerce path state_note is emitted upstream (REQ-106
    // dispatch path) — once per call, with the specific path taken.
    //
    // REQ-047 trace verbosity (per ac1-ac3):
    //   - `full`     — args and result included verbatim
    //   - `summary`  — args and result OMITTED ENTIRELY (kind/name/elapsed_ms only)
    //   - `none`     — the trace array is omitted from the envelope; we
    //                  still emit a minimal step here so cancellation /
    //                  task-registry semantics are uniform across modes,
    //                  but envelope assembly strips the entire array.
    const traceMode = ctx.exec.traceMode;
    const traceStep: Omit<TaskTraceStep, "at"> = {
      kind: call.server === "fq" && call.tool === "call_model" ? "model_call" : "tool_call",
      name: full,
      elapsed_ms,
    };
    if (traceMode === "full") {
      traceStep.args = truncForTrace(arg, traceMode);
      traceStep.result = truncForTrace(result, traceMode);
    }
    // summary and none: args/result omitted entirely (REQ-047 ac2/ac3).
    ctx.exec.taskRegistry.appendTrace(traceStep);

    // Budget snapshot after each call.
    emitStateNote(ctx.exec, snapshotBudget(ctx.exec));
    checkBudget(ctx.exec);
  }

  return result;
}

// ----- Introspection methods -----
//
// `_exists()` is special: when a broker is wired up and the server isn't in
// the static registry, fall back to the broker probe (REQ-045, item 22).
async function resolveIntrospection(call: ToolCall, tools: ToolRegistry, ctx: CallContext): Promise<Value> {
  switch (call.tool) {
    case "_exists": {
      if (tools[call.server] !== undefined) {
        emitStateNote(ctx.exec, { kind: "coerce", path: "passthrough", raw_summary: `_exists ${call.server} = true (registry)` });
        return true;
      }
      // Broker probe (NullMcpBroker returns false). REQ-109: deep probe
      // with a 250ms timeout — the macro-engine binding contract.
      if (ctx.exec?.broker) {
        try {
          const ok = await ctx.exec.broker.exists(call.server, { deepProbe: true, timeoutMs: 250 });
          emitStateNote(ctx.exec, { kind: "coerce", path: "passthrough", raw_summary: `_exists ${call.server} = ${ok} (broker, deep)` });
          return ok;
        } catch {
          return false;
        }
      }
      return false;
    }
    default: {
      throw new MacroRuntimeError(
        `Unknown introspection method '${call.server}.${call.tool}()'. ` +
        `Supported in v0: _exists()`,
        call.line,
      );
    }
  }
}

// ----- Tier 2 helpers: CallToolResult coercion + help-sentinel -----

// Structural check for a CallToolResult envelope. We treat any object
// with `isError`, `structuredContent`, or a `content` array as a
// CallToolResult — the canonical fields per the MCP SDK. Native FQ
// handlers return plain Values without these markers and bypass coercion.
function isCallToolResultShape(v: Value): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, Value>;
  return (
    "isError" in o ||
    "structuredContent" in o ||
    (Array.isArray(o.content) && o.content !== undefined)
  );
}

// Apply REQ-106 + REQ-107 to a brokered tool's CallToolResult. Emits the
// `coerce` state_note describing which path was taken. The `is_error` path
// raises `MacroFailError`; the four success paths bind the coerced value.
//
// Special case: `needs_user_input` (REQ-105 nested propagation). If the
// coerced value is an object with `event === "needs_user_input"` AND has
// a `question` + `answer_shape`, propagate as the macro's own
// `MacroNeedsUserInputError`. This makes brokered-emitted user-input
// requests indistinguishable from the macro-author's own
// `needs_user_input` builtin call at the macro frame.
function applyBrokerCoercion(
  envelope: CallToolResult,
  call: ToolCall,
  ctx: CallContext,
): Value {
  // Step 1: isError carve-out (REQ-106 step 1 + REQ-107).
  if (envelope.isError === true) {
    const norm = formatToolError(envelope);
    emitStateNote(ctx.exec, {
      kind: "coerce",
      path: "is_error",
      raw_summary: `${call.server}.${call.tool} isError: ${norm.kind} — ${norm.message.slice(0, 120)}`,
    });
    throw new MacroFailError(
      `brokered tool ${call.server}.${call.tool} failed (${norm.kind}): ${norm.message}`,
      call.line,
      true, // brokered → tool_call_failed
    );
  }
  // Steps 2-5: apply the four success paths.
  const { path, value } = coerceNonError(envelope);
  emitStateNote(ctx.exec, {
    kind: "coerce",
    path,
    raw_summary: `${call.server}.${call.tool} bound via ${path}`,
  });
  // REQ-105 nested propagation. If the coerced value is a
  // needs_user_input envelope (broker-emitted, e.g., TOFU drift), turn
  // it into a macro-level MacroNeedsUserInputError so the chat session
  // sees the same exit as a macro-author-initiated request.
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, Value>).event === "needs_user_input"
  ) {
    const obj = value as Record<string, Value>;
    const question = typeof obj.question === "string" ? obj.question : "(no question)";
    const answer_shape = typeof obj.answer_shape === "string" ? obj.answer_shape : "(no answer_shape)";
    const payload: ConstructorParameters<typeof MacroNeedsUserInputError>[0] = {
      question,
      answer_shape,
      event: "needs_user_input",
    };
    if (typeof obj.context === "string") payload.context = obj.context;
    if (Array.isArray(obj.options)) {
      payload.options = obj.options.filter((s): s is string => typeof s === "string");
    }
    if (typeof obj.resume_hint === "string") payload.resume_hint = obj.resume_hint;
    throw new MacroNeedsUserInputError(payload);
  }
  return value;
}

// Help-page body lookup for the `help: true` sentinel (REQ-093, REQ-098).
// Production: pulls from the per-tool `.tool.md` body via TOOL_META. The
// golden's mock keeps a flat map injected via `setHelpPageProvider` so the
// evaluator avoids a circular import on `mockfq.ts`.
let _helpPageProvider: (key: string) => string | undefined = () => undefined;
export function setHelpPageProvider(fn: (key: string) => string | undefined): void {
  _helpPageProvider = fn;
}
function lookupHelpBody(server: string, tool: string): string {
  const key = `${server}.${tool}`;
  const native = _helpPageProvider(key);
  if (native) return native;
  // Brokered fallback per REQ-098 (DELTA-1): production forwards upstream;
  // mock returns a placeholder so the trace is inspectable.
  return `(brokered) ${key}: help forwarded upstream — mock returns this placeholder.`;
}

// ----- Pipelines -----

async function runPipeline(
  pipeline: Pipeline,
  env: Env,
  builtins: Builtins,
  tools: ToolRegistry,
  ctx: CallContext,
): Promise<Value> {
  let stdin: Value | undefined = undefined;
  let result: Value = null;
  for (let i = 0; i < pipeline.stages.length; i++) {
    checkCancelled(ctx.exec, `pipeline stage ${i + 1}/${pipeline.stages.length}`);
    checkBudget(ctx.exec);
    const stage = pipeline.stages[i];
    const stageCtx: CallContext = { ...ctx, stdin };
    result = await applyCall(stage, env, builtins, tools, stageCtx);
    stdin = result;
  }
  return result;
}

async function applyCall(call: Call, env: Env, builtins: Builtins, tools: ToolRegistry, ctx: CallContext): Promise<Value> {
  checkCancelled(ctx.exec, `before call ${call.name} (line ${call.line ?? "?"})`);
  checkBudget(ctx.exec);
  const fn = builtins[call.name];
  if (!fn) {
    const looksLikeFqTool = !call.name.includes(".") && tools.fq?.tools[call.name];
    const hint = looksLikeFqTool
      ? ` — did you mean 'fq.${call.name}({...})'? (Tool calls use the namespaced JSON-arg form.)`
      : "";
    throw new MacroRuntimeError(`Unknown function: ${call.name}${hint}`, call.line);
  }
  const positional: Value[] = [];
  const named: Record<string, Value> = {};
  for (const arg of call.args) {
    const value = await evalExpr(arg.value, env, builtins, tools, ctx);
    if (arg.kind === "NamedArg") named[arg.name] = value;
    else positional.push(value);
  }
  // Thread the call's source line through CallContext so builtins like
  // `fail` can populate `details.line` per REQ-024 ac3.
  const callCtx: CallContext = { ...ctx, callLine: call.line };
  return await fn(positional, named, callCtx);
}

// ----- String interpolation -----
//
// `\$x` suppresses interpolation (REQ-022 ac4 / item 9). The `\$` survived
// the unquote step (lexer preserves it), and the interpolator detects the
// escape and emits a literal `$x` without variable lookup.

function interpolate(raw: string, env: Env): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    // `\$` escape: emit literal `$` and SKIP further interpolation at this
    // position. We do not consume the following identifier.
    if (ch === "\\" && raw[i + 1] === "$") {
      out += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      if (raw[i + 1] === "{") {
        const end = raw.indexOf("}", i + 2);
        if (end === -1) {
          out += "$";
          i += 1;
          continue;
        }
        const expr = raw.slice(i + 2, end);
        out += stringifyValue(resolveDotted(expr, env));
        i = end + 1;
      } else if (/[a-zA-Z_]/.test(raw[i + 1] ?? "")) {
        let j = i + 1;
        while (j < raw.length && /[a-zA-Z0-9_]/.test(raw[j])) j++;
        const name = raw.slice(i + 1, j);
        let value: Value = env.get(name);
        while (
          j < raw.length &&
          raw[j] === "." &&
          /[a-zA-Z_]/.test(raw[j + 1] ?? "")
        ) {
          let k = j + 1;
          while (k < raw.length && /[a-zA-Z0-9_]/.test(raw[k])) k++;
          const field = raw.slice(j + 1, k);
          value = stepField(value, field);
          j = k;
        }
        out += stringifyValue(value);
        i = j;
      } else {
        out += ch;
        i += 1;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function resolveDotted(expr: string, env: Env): Value {
  const parts = expr.split(".");
  let value: Value = env.get(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    value = stepField(value, parts[i]);
  }
  return value;
}

function stepField(target: Value, field: string): Value {
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new MacroRuntimeError(
      `Cannot access .${field} on ${typeof target} in string interpolation`,
    );
  }
  const next = (target as Record<string, Value>)[field];
  if (next === undefined) {
    throw new MacroRuntimeError(
      `Field .${field} not present in string interpolation`,
    );
  }
  return next;
}

// ----- Value utilities -----

export function isTruthy(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

export function stringifyValue(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return "[" + v.map(stringifyValue).join(", ") + "]";
  return (
    "{" +
    Object.entries(v)
      .map(([k, val]) => `${k}: ${stringifyValue(val)}`)
      .join(", ") +
    "}"
  );
}

function describe(v: Value): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  return typeof v;
}
