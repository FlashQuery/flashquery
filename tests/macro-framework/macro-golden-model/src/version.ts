// Single source of truth for the golden model's semver. Stamped into every
// snapshot envelope so generated tests record which golden produced them
// (per §5.6 of the Macro Testing Framework Requirements). Bumping requires
// the golden's meta-tests to pass (Phase 1 gate).
//
// ─── Changelog ───────────────────────────────────────────────────────────
// 0.4.0 (2026-06-22) — Graph-EDI §14: macro language data builtins.
//   Adds the ten general-purpose collection builtins and their shared error
//   model / two-tier validation (§14.3):
//     filter, sort, first, last, keys, contains, join, map, any, all
//   New golden infrastructure:
//     - `MacroBuiltinPreflightError` + `preflightBuiltins` static pass
//       (evaluator.ts): arity / named-arg / literal operator·direction·field·
//       separator faults raise at preflight → `invalid_input`; value-dependent
//       faults raise in the builtin body at runtime → `tool_call_failed`.
//     - `filter`/`map`/`sort`/`any`/`all` field resolution (`resolveFieldPath`)
//       and shared `compareWithOp` in builtins.ts; `valueEquals` exported.
//     - Snapshot/run mapping for the new preflight error → `invalid_input`.
//     - Ten names reserved in parser `BUILTIN_NAMES`.
//   §14.3.0 reason-code renames (mechanical; no prior snapshot referenced them):
//     arithmetic_argument_count → sub_argument_count
//     unique_argument_type      → unique_type_mismatch
//     append_argument_type      → append_type_mismatch
//     range_operand_type_mismatch → range_type_mismatch
//   Purely additive to existing behavior — all prior pilots reconcile
//   unchanged; the bump re-stamps every pilot's golden_version.
// 0.3.0 — REQ-052/053/054 envelope shapes; tool_call_failed for MacroRuntimeError.
export const GOLDEN_VERSION = "0.4.0";
