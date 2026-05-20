// Response envelopes for macro execution (REQ-052 / REQ-053 / REQ-054).
//
// v0.3.0: refactored to align with the spec's envelope shape (REQ-052/053).
//
//   - Success envelope uses `parsed_ok: true` + `result` field; no `ok` flag.
//   - Error envelope (runtime/preflight) uses `parsed_ok: true` + `error`
//     field-presence discriminator.
//   - Parse-failure envelope uses `parsed_ok: false`.
//   - Dry-run extends the real-run shape with `input_var_contract`,
//     `tool_references`, `server_references`.
//
// `parsed_ok: true` vs `parsed_ok: false` discriminates between
// "parsing succeeded; this is a runtime/preflight outcome" and
// "parsing itself failed." Success vs error within `parsed_ok: true`
// is discriminated by presence of `result` vs presence of `error`.

import type { Value, VaultWrite, ToolCallRecord, PermissionDecision } from "./types.ts";
import type { TaskTraceStep } from "./taskregistry.ts";
import type { StateNote } from "./statenotes.ts";

// MACRO_ERROR_CODES — canonical error keys (REQ-054).
//
// v0.3.0 additions (gap-6, audit §E.6):
//   - `template_masquerade_tools_not_callable_from_macro` — top-level code
//     for REQ-031. Pre-scan emits this when a template-masqueraded tool is
//     referenced; previously collapsed into `forbidden_tools`.
//   - `timeout` — separate code for timeout-class budget exhaustion per
//     REQ-060 ac1. Distinct from non-timeout `budget_exceeded` (token,
//     model-call, external-tool counter caps).
//   - `tool_call_failed` — brokered-tool failure (REQ-024 ac5 / REQ-107).
//     Distinct from author-initiated `macro_aborted` (REQ-024 ac3 / `fail`).
export const MACRO_ERROR_CODES = {
  parse_error: "parse_error",
  invalid_input: "invalid_input",
  macro_aborted: "macro_aborted",
  forbidden_path: "forbidden_path",
  forbidden_shell_flag: "forbidden_shell_flag",
  forbidden_tools: "forbidden_tools",
  template_masquerade_tools_not_callable_from_macro:
    "template_masquerade_tools_not_callable_from_macro",
  cancelled: "cancelled",
  unknown_server: "unknown_server",
  unknown_tool: "unknown_tool",
  permission_denied: "permission_denied",
  budget_exceeded: "budget_exceeded",
  timeout: "timeout",
  tool_call_failed: "tool_call_failed",
  // GG-005 (2026-05-20): removed `runtime_error` from the canonical list.
  // REQ-054 / `MACRO_ERROR_CODES` (line 1188 of Macro Language Requirements)
  // does not include it; the spec collapses unexpected runtime errors into
  // `tool_call_failed` with a `details.reason` discriminator. Production
  // followed this rule from day one (src/macro/evaluator.ts:448-457). The
  // golden's translator at snapshot.ts:262 now emits `tool_call_failed` for
  // `MacroRuntimeError`, matching production. Matt approved Reading 1
  // (golden conforms to spec) on 2026-05-20.
  // Tier 2 (REQ-105): fifth termination class. Emitted by the
  // `needs_user_input` builtin and by the brokered-tool nested-propagation
  // path (broker emits a needs_user_input envelope per REQ-042).
  needs_user_input: "needs_user_input",
} as const;

export type MacroErrorCode = keyof typeof MACRO_ERROR_CODES;

// Dry-run "what the macro would call" inventory (REQ-053).
export type ToolReference = {
  server: string;
  tool: string;
};

// Dry-run input contract (REQ-053). Mirrors the pre-flight collector's
// {required, optional} partition produced by `collectInputVarContract`.
export type InputVarContract = {
  required: string[];
  optional: string[];
};

// REQ-052: real-run SUCCESS envelope. `parsed_ok: true` and `result`
// field present. `error` is ABSENT (field-presence discriminates success
// vs runtime/preflight error). `trace`/`warnings`/counter fields are
// optional per ac1.
export type MacroExecutionResult = {
  parsed_ok: true;
  task_id: string;
  result: Value;
  trace?: TaskTraceStep[];
  warnings?: string[];
  token_total?: number;
  model_calls?: number;
  external_tool_calls?: number;
  elapsed_ms?: number;
};

// REQ-052: real-run ERROR envelope (runtime / preflight). `parsed_ok: true`
// because parsing succeeded — the failure is downstream. `error` field
// carries the code; `message` and optional `details` describe it.
export type MacroExecutionError = {
  parsed_ok: true;
  task_id: string;
  error: MacroErrorCode;
  message: string;
  details?: Record<string, Value>;
  trace?: TaskTraceStep[];
  warnings?: string[];
};

// REQ-053: parse-FAILURE envelope. `parsed_ok: false` — parsing itself
// did not produce a runnable AST. `error: "parse_error"` is the only
// allowed top-level code; details carry the reason / location.
export type MacroParseError = {
  parsed_ok: false;
  error: "parse_error";
  message: string;
  details: {
    reason: string;
    at_line?: number;
    near_token?: string | null;
    [k: string]: Value | undefined;
  };
};

// REQ-053: dry-run envelope. Extends the real-run shape with the static
// pre-flight inventory. `result` is null (dry-run doesn't execute).
export type MacroDryRunResult = {
  parsed_ok: true;
  task_id: string;
  result: null;
  input_var_contract: InputVarContract;
  tool_references: ToolReference[];
  server_references: string[];
  trace?: TaskTraceStep[];
  warnings?: string[];
};

// Helper: build a real-run success envelope.
export function macroResult(
  task_id: string,
  result: Value,
  opts: {
    trace?: TaskTraceStep[];
    warnings?: string[];
    token_total?: number;
    model_calls?: number;
    external_tool_calls?: number;
    elapsed_ms?: number;
  } = {},
): MacroExecutionResult {
  const env: MacroExecutionResult = { parsed_ok: true, task_id, result };
  if (opts.trace !== undefined) env.trace = opts.trace;
  if (opts.warnings !== undefined && opts.warnings.length > 0) env.warnings = opts.warnings;
  if (opts.token_total !== undefined) env.token_total = opts.token_total;
  if (opts.model_calls !== undefined) env.model_calls = opts.model_calls;
  if (opts.external_tool_calls !== undefined) env.external_tool_calls = opts.external_tool_calls;
  if (opts.elapsed_ms !== undefined) env.elapsed_ms = opts.elapsed_ms;
  return env;
}

// Helper: build a runtime/preflight error envelope. `parsed_ok: true`.
export function macroError(
  task_id: string,
  code: MacroErrorCode,
  message: string,
  opts: {
    details?: Record<string, Value>;
    trace?: TaskTraceStep[];
    warnings?: string[];
  } = {},
): MacroExecutionError {
  const env: MacroExecutionError = { parsed_ok: true, task_id, error: code, message };
  if (opts.details !== undefined) env.details = opts.details;
  if (opts.trace !== undefined) env.trace = opts.trace;
  if (opts.warnings !== undefined && opts.warnings.length > 0) env.warnings = opts.warnings;
  return env;
}

// Helper: build a parse-failure envelope. `parsed_ok: false`.
export function macroParseError(
  message: string,
  details: { reason: string; at_line?: number; near_token?: string | null; [k: string]: Value | undefined },
): MacroParseError {
  return {
    parsed_ok: false,
    error: "parse_error",
    message,
    details,
  };
}

// ----- Golden-only snapshot envelope -----
//
// State_notes are NOT in the production envelope (asymmetric instrumentation);
// the snapshot envelope keeps them so testgen assertions can verify
// intermediate state. The embedded `result_envelope` is the spec-shape
// MacroExecutionResult / MacroExecutionError / MacroParseError that the
// production engine would emit.
//
// `trace` is also retained here for parity with prior snapshot consumers;
// when the engine ran with `trace: "none"`, the array is empty (per
// REQ-047 ac3). Consumers checking for "trace absent" should look at the
// EMBEDDED `result_envelope.trace` field-presence.
export type GoldenSnapshot = {
  return: Value | null;
  trace: TaskTraceStep[];
  side_effects: {
    vault_writes: VaultWrite[];
    tool_calls: ToolCallRecord[];
  };
  state_notes: StateNote[];
  permission_decisions: PermissionDecision[];
  warnings: string[];
  golden_version: string;
  golden_run_at: string; // ISO 8601
  // The spec-shape engine envelope embedded into the snapshot. Production
  // tests can compare against this directly; framework-level oracle
  // assertions read from the outer GoldenSnapshot fields.
  result_envelope: MacroExecutionResult | MacroExecutionError | MacroParseError | MacroDryRunResult;
  // Error info if the macro halted abnormally. Kept for back-compat with
  // v0.2.0 snapshot consumers; the same code is reflected in
  // `result_envelope.error` when applicable.
  error?: {
    code: MacroErrorCode;
    message: string;
    details?: Record<string, Value>;
  };
};
