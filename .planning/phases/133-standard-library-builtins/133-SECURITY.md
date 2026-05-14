---
phase: 133-standard-library-builtins
security_reviewed: 2026-05-14
asvs_level: 1
threats_total: 9
threats_closed: 9
threats_open: 0
block_on: open
---

# Phase 133 Security Verification

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-133-01 | Tampering | mitigate | CLOSED | `src/macro/preflight.ts:114-120` rejects non-literal `input_var` keys with `details.reason: "input_var_key_must_be_literal"` before execution. |
| T-133-02 | Information Disclosure | mitigate | CLOSED | `src/macro/evaluator.ts:235-239` runs `preflightProgram`, `collectInputVarContract`, and `validateInputVars` before `execBlock`; tests at `tests/unit/macro-preflight.test.ts:15-27` and `tests/unit/macro-builtins.test.ts:315-330` assert no trace before missing-input failure. |
| T-133-03 | Tampering | mitigate | CLOSED | `src/macro/preflight.ts:149-151`, `src/macro/builtins.ts:36-40`, and `src/macro/evaluator.ts:547-551` use `Object.prototype.hasOwnProperty.call` presence checks so explicit `null` is not treated as missing. |
| T-133-04 | Tampering | mitigate | CLOSED | `src/macro/builtins.ts:31-39` validates `input_var` arity and key type; `src/macro/builtins.ts:181-188` validates `task_id` and `list_tasks` zero-arity; `src/macro/builtins.ts:200-215` validates `sleep`/`slow_op` arity, duration type, and label type; `src/macro/builtins.ts:254-266` emits stable arity `details.reason` values through `requireArgCount`; `src/macro/builtins.ts:268-280`, `src/macro/builtins.ts:245-252`, `src/macro/builtins.ts:292-303`, and `src/macro/builtins.ts:306-314` reject unsupported named args and invalid value types with stable reasons. Tests at `tests/unit/macro-builtins.test.ts:48-55`, `tests/unit/macro-builtins.test.ts:131-151`, and `tests/unit/macro-termination.test.ts:40-57` assert representative count/type reason stability. |
| T-133-05 | Denial of Service | mitigate | CLOSED | `src/macro/builtins.ts:222-234` rejects non-integer operands and zero step before loops; `src/macro/builtins.ts:236-242` loops only after validation. |
| T-133-06 | Tampering | mitigate | CLOSED | `src/macro/builtins.ts:69-75` returns a fresh `unique` output array, `src/macro/builtins.ts:86` returns `[...list, ...items]`, and `src/macro/builtins.ts:94-95` returns a new flattened list for list `concat`; tests at `tests/unit/macro-builtins.test.ts:71-84` assert originals remain unchanged. |
| T-133-07 | Information Disclosure | mitigate | CLOSED | `src/macro/builtins.ts:186-198` uses `context.listTasks(context)` or a current-invocation fallback; no `taskRegistry` import or process-global task registry reference exists in `src/macro/builtins.ts` or `src/macro/evaluator.ts`. |
| T-133-08 | Information Disclosure | mitigate | CLOSED | `src/macro/builtins.ts:149-154` implements `echo` as log-only, while `src/macro/builtins.ts:156-179` implements `status` as progress/progressSink-only; tests at `tests/unit/macro-builtins.test.ts:184-197` assert channel separation. |
| T-133-09 | Denial of Service | mitigate | CLOSED | `src/macro/builtins.ts:292-303` validates finite non-negative duration; `src/macro/builtins.ts:316-325` sleeps in `Math.min(remaining, CHUNK_MS)` chunks with `CHUNK_MS = 100` at `src/macro/builtins.ts:10` and calls `checkCancelled('inside sleep')` after each chunk. |

## Open Threats

None.

## Unregistered Flags

None. The required summary files do not contain `## Threat Flags` sections.

## SECURED
