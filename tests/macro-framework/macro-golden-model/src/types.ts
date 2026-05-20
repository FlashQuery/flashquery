// AST and runtime value types for the FlashQuery macro language prototype.

// ----- AST nodes -----

export type Program = {
  kind: "Program";
  statements: Statement[];
};

export type Statement =
  | Binding
  | Pipeline
  | ForLoop
  | WhileLoop
  | IfStmt
  | ToolCall
  | ContinueStmt
  | BreakStmt;

// REQ-104 (Tier 2): `continue` and `break` loop-control statements. Both
// are statement-only — they cannot appear in expression position. The
// parser admits them anywhere but `enforceStaticChecks` rejects any
// occurrence outside a `for` / `while` body at parse time.
export type ContinueStmt = {
  kind: "ContinueStmt";
  line: number;
};

export type BreakStmt = {
  kind: "BreakStmt";
  line: number;
};

export type Binding = {
  kind: "Binding";
  name: string;
  value: Expr;
  line: number;
};

export type Call = {
  kind: "Call";
  name: string;
  args: Arg[];
  line: number;
};

// A pipeline is a sequence of calls connected with `|`. The output of each
// stage is threaded as the implicit "stdin" of the next. A pipeline with one
// stage is just that single call (no piping).
export type Pipeline = {
  kind: "Pipeline";
  stages: Call[];
  line: number;
};

export type ForLoop = {
  kind: "ForLoop";
  varName: string;
  iterable: Expr;
  body: Statement[];
  line: number;
};

// `while <condition> do <body> done` — REQ-015 (added 2026-05-18, item 17).
export type WhileLoop = {
  kind: "WhileLoop";
  cond: Expr;
  body: Statement[];
  line: number;
};

export type IfStmt = {
  kind: "IfStmt";
  cond: Expr;
  thenBody: Statement[];
  elseBody: Statement[] | null;
  line: number;
};

export type Arg = NamedArg | PositionalArg;

export type NamedArg = {
  kind: "NamedArg";
  name: string;
  value: Expr;
  // For short-flag bundles, the original token image (e.g. "-delete",
  // "-exec", "-iv") is preserved on EVERY NamedArg the bundle expanded
  // to, so a downstream pre-scan can recognize the original spelling
  // regardless of bundled-letter ordering. Used by the shell-verb flag
  // rejection pre-scan (OQ #25, 2026-05-12) to reject `find -exec`,
  // `find -delete`, etc. Optional because long-flag NamedArgs don't
  // need it.
  rawShortFlag?: string;
};

export type PositionalArg = {
  kind: "PositionalArg";
  value: Expr;
};

export type Expr =
  | StringLit
  | NumLit
  | BoolLit
  | NullLit
  | VarRef
  | ListLit
  | ObjectLit
  | FieldAccess
  | Pipeline
  | ToolCall
  | Negation
  | BinaryOp
  | RangeOp;

// Logical-not of an expression. Used inside `if ! ... then ...` conditions.
// Truthiness rules match the macro engine's `isTruthy` (null/0/empty list/
// empty string/empty object → false; everything else → true).
export type Negation = {
  kind: "Negation";
  expr: Expr;
};

// Binary operator — comparison (REQ-012) and boolean combinator (REQ-013).
// All four comparison ops + && / || share this node with an `op` discriminator.
// Added 2026-05-18 (golden patch item 17). Left-to-right associativity, no
// precedence groups in v0 — authors must parenthesize if they want grouping.
export type BinaryOp = {
  kind: "BinaryOp";
  op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
  left: Expr;
  right: Expr;
};

// `..` range operator (REQ-014). `0..5` evaluates to the list [0,1,2,3,4]
// (EXCLUSIVE end endpoint, integer step), matching the `range` builtin per
// REQ-014 ac4. Both operands must evaluate to integers; floats / negatives
// are validated at evaluation time. Descending ranges (e.g. `5..0`) are
// also exclusive of the end (`5..0` -> [5,4,3,2,1]).
export type RangeOp = {
  kind: "RangeOp";
  start: Expr;
  end: Expr;
};

// Object literal: { key1: value1, key2: value2, ... }
// Keys are bare identifiers or quoted strings (we accept both). Values are
// arbitrary expressions, so a literal can include $var references, nested
// objects, lists, or even tool calls.
export type ObjectLit = {
  kind: "ObjectLit";
  entries: ObjectEntry[];
};

export type ObjectEntry = {
  key: string;
  value: Expr;
};

// Tool call: namespace.tool({...JSON object...})
// This is the localized exception to the otherwise-shell-style surface.
// Every registered MCP tool (FlashQuery's native + brokered) is invoked this
// way. The single argument is an object literal, a previously-built var
// holding an object, or absent — `arg: undefined` represents a zero-arg
// invocation like the introspection methods `server._exists()`.
//
// Tool names starting with `_` (e.g. `_exists`, `_list_tools`,
// `_capabilities`) are *introspection* methods: the macro engine resolves
// them itself against the registry, without dispatching to the broker
// handler. They expose metadata about the server, not data from it.
export type ToolCall = {
  kind: "ToolCall";
  server: string; // resolved server name. For the bare-Identifier form
                  // (`svc.tool(...)`), this is the literal name verbatim.
                  // For the Broker REQ-112a VarRef form (`$svc._exists()`),
                  // this is the variable name and `serverVarRef` is true.
  serverVarRef?: boolean; // true when the source used `$server.tool(...)`
                          // (variable-stored server name resolved at call
                          // time). REQ-112a allows this form for
                          // introspection methods only — enforced at
                          // static-check.
  tool: string;   // e.g. "write_document"; if it starts with "_", treated as
                  // an engine-resolved introspection method
  arg: ObjectLit | VarRef | undefined;
  line: number;
};

export type BoolLit = {
  kind: "BoolLit";
  value: boolean;
};

// `null` literal expression. Added 2026-05-12 for the OQ #23 `input_var`
// default-value grammar (so `--default null` is valid syntax). Boolean
// literals (true/false) were initially deferred per §5 of the research
// doc but shipped first-class on 2026-05-19 per REQ-112c (MCP Broker
// Requirements §7.15) — see BoolLit above. REQ-112e (also §7.15)
// confirms `--default true` and `--default false` are valid syntax.
export type NullLit = {
  kind: "NullLit";
};

export type StringLit = {
  kind: "StringLit";
  // Raw text between the quotes. For double-quoted strings, $var
  // interpolation is performed at evaluation time. Single-quoted
  // strings have `interpolated: false` and are taken literally.
  raw: string;
  interpolated: boolean;
};

export type NumLit = {
  kind: "NumLit";
  value: number;
};

export type VarRef = {
  kind: "VarRef";
  name: string;
};

export type ListLit = {
  kind: "ListLit";
  items: Expr[];
};

export type FieldAccess = {
  kind: "FieldAccess";
  // The target may be a bare variable or another field access, which lets
  // us represent chained dotted access like $doc.frontmatter.related_to
  // as FieldAccess(FieldAccess(VarRef("doc"), "frontmatter"), "related_to").
  target: VarRef | FieldAccess;
  field: string;
};

// ----- Runtime values -----

export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value };

// ----- Tool / built-in registration -----

export type CallContext = {
  // Logger for mock tools to print their trace lines.
  log: (line: string) => void;
  // When the call is the RHS of a pipe, the LHS's output value is passed in
  // as `stdin`. For the first (or only) stage of a pipeline, stdin is undefined.
  stdin?: Value;
  // Caller-supplied `input_vars` map. The `input_var` builtin (per OQ #23,
  // resolved 2026-05-12) reads from this rather than from scope-level
  // bindings. The earlier mechanism (binding `input_vars` keys directly to
  // outer-scope variables) was replaced by the explicit `input_var "key"`
  // builtin so the input contract is declared, not implicit.
  inputVars?: Record<string, Value>;
  // Vault root — set at evaluator start (per OQ #25 vault-jail, 2026-05-12).
  // Every shell verb resolves path arguments through this root and refuses
  // to escape it. Optional in the prototype so non-shell-verb tests run
  // without a configured vault.
  vaultRoot?: string;
  // Per-invocation execution context. Replaces the global taskRegistry
  // singleton (golden patch item 10 / REQ-025). Wires the per-run task
  // registry, side-effect recorder, budget counter, and state_notes
  // emitter through call dispatch.
  exec?: ExecContext;
  // Source line of the active builtin call. Set by `applyCall` before
  // invoking the builtin so builtins (notably `fail`) can populate
  // `details.line` per REQ-024 ac3.
  callLine?: number;
};

export type BuiltinFn = (
  positional: Value[],
  named: Record<string, Value>,
  ctx: CallContext,
) => Value | Promise<Value>;

// ----- Tool registry -----
// The macro engine treats FlashQuery as an "internal broker" — its tools live
// in the same registry shape as future brokered MCP servers. Per the OQ #1
// resolution, every registered MCP tool is invoked via `server.tool({...})`,
// where `server` is the registry key (e.g. "fq" for FlashQuery, "brave_search"
// for a Brave Search broker). The dispatcher resolves (server, tool) -> handler
// and calls it with the JSON object argument that the macro author wrote inside
// the parens.

// A tool handler takes a JSON-shaped argument value and returns a result.
// This is intentionally a different shape from BuiltinFn: tools have one
// structured arg (matching their schema), not flag/positional shell args.
export type ToolFn = (
  arg: Record<string, Value>,
  ctx: CallContext,
) => Value | Promise<Value>;

export type ServerEntry = {
  // Human-readable label (e.g. "FlashQuery (in-process)" or "Brave Search MCP").
  label: string;
  // In v0 the prototype only has the in-process "fq" handler. When the MCP
  // Broker feature ships, brokered servers add entries here with stdio
  // handlers instead of in-process function references.
  tools: Record<string, ToolFn>;
};

export type ToolRegistry = Record<string, ServerEntry>;

// ----- ExecContext (per-invocation isolation) -----
//
// Golden patch item 10 (REQ-025): the original POC used a process-global
// `taskRegistry` singleton plus a `currentTaskId` accessor. That model
// breaks per-invocation isolation under concurrency. The golden refactors
// to a per-invocation `ExecContext` that is constructed for each
// `evaluate()` call and threaded through `CallContext.exec`.
//
// Carries:
//   - taskRegistry — per-invocation task registry (REQ-051 session scoping)
//   - taskId — the current macro's task id within that registry
//   - sideEffects — vault writes + tool calls observed during this run
//   - budget — running token / model-call / external-tool counters + caps
//   - permissionDecisions — pre-scan results (allowed/denied per tool ref)
//   - stateNotes — emission accumulator (per §5.6.1)
//   - traceMode / progressMode — verbosity controls (REQ-047 / REQ-048)
//   - dryRun — when true, no tool dispatch actually occurs (REQ-052/53)

import type { StateNote } from "./statenotes.ts";

export type VaultWrite = {
  kind: "create" | "update" | "delete" | "move" | "directory";
  path?: string;
  identifier?: string;
  destination_path?: string;
  details?: Record<string, Value>;
  at: string; // ISO 8601
};

export type ToolCallRecord = {
  server: string;
  tool: string;
  arg: Value;
  result: Value;
  elapsed_ms: number;
  at: string; // ISO 8601
};

export type BudgetCaps = {
  max_total_tokens?: number;
  max_model_calls?: number;
  max_external_tool_calls?: number;
  timeout_ms?: number;
};

export type BudgetCounters = {
  tokens: number;
  model_calls: number;
  external_tool_calls: number;
  started_at: number; // ms since epoch
};

export type PermissionDecision = {
  tool: string; // "server.tool"
  decision: "allowed" | "denied";
  reason?: string;
};

export type TraceMode = "full" | "summary" | "none";
export type ProgressMode = "full" | "milestones" | "silent";

export interface ExecContext {
  // Per-invocation task registry (instance, not singleton).
  taskRegistry: import("./taskregistry.ts").TaskRegistry;
  // Active task id for this evaluation.
  taskId: string;
  // Side-effect manifest captured during execution.
  sideEffects: {
    vault_writes: VaultWrite[];
    tool_calls: ToolCallRecord[];
  };
  // Budget enforcement.
  budgetCaps: BudgetCaps;
  budgetCounters: BudgetCounters;
  // Static permission pre-scan results.
  permissionDecisions: PermissionDecision[];
  // state_notes emission buffer (per §5.6.1).
  stateNotes: StateNote[];
  // Verbosity controls.
  traceMode: TraceMode;
  progressMode: ProgressMode;
  // Dry-run mode (REQ-052/53).
  dryRun: boolean;
  // Optional MCP broker for live `_exists` probes / brokered dispatch
  // (REQ-062 / patch item 21).
  broker?: import("./broker.ts").McpBroker;
  // Permission set assembled at pre-scan time; runtime-dispatch backstop
  // (REQ-029, item 18).
  allowedTools: Set<string>;
  // Warnings collected during execution (REQ-056).
  warnings: string[];
  // REQ-053 dry-run inventory. Populated by `evaluate()` before execution
  // so the dry-run envelope can surface the `input_var_contract`,
  // `tool_references`, and `server_references` fields. Always populated
  // (even in non-dry-run mode) for symmetry; consumed only in dry-run.
  dryRunInventory?: {
    input_var_contract: { required: string[]; optional: string[] };
    tool_references: Array<{ server: string; tool: string }>;
    server_references: string[];
  };
}
