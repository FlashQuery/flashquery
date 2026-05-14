---
phase: 133-standard-library-builtins
verified: 2026-05-14T15:13:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 133: Standard Library Builtins Verification Report

**Phase Goal:** Add data, arithmetic, input, termination, range, echo/status, and task-introspection builtins with pre-flight input validation.
**Verified:** 2026-05-14T15:13:00Z
**Status:** passed
**Re-verification:** Yes - refreshed after post-security arity-validation fixes.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `input_var` contract collection runs before execution and reports all missing inputs at once. | VERIFIED | `evaluateProgram` creates context, runs `preflightProgram`, then `collectInputVarContract(program)` and `validateInputVars(...)` before `execBlock` in `src/macro/evaluator.ts:232-239`; T-U-098/T-U-099 assert no trace before missing-input failure. |
| 2 | Explicit `null` input vars are present values and defaults support string, number, null, list, and object literals. | VERIFIED | `validateInputVars` uses `Object.prototype.hasOwnProperty.call` in `src/macro/preflight.ts:149-151`; runtime `input_var` uses the same presence check in `src/macro/evaluator.ts:544-560`; T-U-100 through T-U-105 cover defaults/null. |
| 3 | Data builtins return deterministic values, preserve immutability, and reject invalid input types. | VERIFIED | `count`, `unique`, `append`, and `concat` are implemented in `src/macro/builtins.ts:51-99`; T-U-109 through T-U-114 cover behavior, type rejection, and immutability. |
| 4 | Arithmetic builtins validate numeric inputs, use integer-truncated `div`, and positive-result `mod`. | VERIFIED | `add`, `sub`, `mul`, `div`, and `mod` are implemented in `src/macro/builtins.ts:101-139`; T-U-115 through T-U-119 cover behavior and invalid inputs. |
| 5 | `range` supports one-, two-, and three-argument half-open ranges including negative steps. | VERIFIED | `range` validates arity and delegates to `buildRange` in `src/macro/builtins.ts:141-147` and `src/macro/builtins.ts:222-243`; T-U-047 through T-U-051 cover all forms and zero-step failure. |
| 6 | Standard builtins are registered for v0 names without deferred shell/tool-dispatch verbs. | VERIFIED | `npx tsx` printed exactly `fail,exit,input_var,count,unique,append,concat,add,sub,mul,div,mod,range,echo,status,task_id,list_tasks,sleep,slow_op`; no `taskRegistry`, `process.stderr`, or `process.stdout` references exist in the macro implementation. |
| 7 | Builtins validate argument counts, named args, value types, and return canonical expected/runtime error envelopes for invalid usage. | VERIFIED | `requireArgCount` and `requireNamedArgs` protect all registry builtins in `src/macro/builtins.ts:254-280`; post-security arity reasons include `input_var_argument_count`, `count_argument_count`, `task_id_argument_count`, `list_tasks_argument_count`, `sleep_argument_count`, and `slow_op_argument_count`; tests assert representative arity/type stability in `tests/unit/macro-builtins.test.ts:48-55`, `tests/unit/macro-builtins.test.ts:131-151`, and `tests/unit/macro-termination.test.ts:40-57`. |
| 8 | `fail` and `exit` still halt execution with canonical evaluator envelopes. | VERIFIED | Evaluator special-cases `exit`, `fail`, and preflight multi-arg `exit` in `src/macro/evaluator.ts:520-541`; registry also exposes both names in `src/macro/builtins.ts:13-30`; T-U-084 through T-U-091 pass. |
| 9 | `echo` and `status` append separate trace/progress/log channel records without leakage. | VERIFIED | `echo` writes `context.log` plus log trace only in `src/macro/builtins.ts:149-154`; `status` writes `context.progress`, progress trace, and optional sink only in `src/macro/builtins.ts:156-179`; T-U-120 through T-U-123 pass. |
| 10 | `task_id` and `list_tasks` expose only current invocation/session scope available in this phase. | VERIFIED | Context initializes per-invocation `taskId`, `progress`, and optional `listTasks` in `src/macro/evaluator.ts:201-213`; `list_tasks` uses injected provider or current invocation fallback in `src/macro/builtins.ts:186-198`; no global task registry import is present. |
| 11 | `sleep` and `slow_op` are registered, validate duration/label inputs, validate arity, and use cancellation checks. | VERIFIED | `sleep`/`slow_op` validate named args, arity, duration, and label in `src/macro/builtins.ts:200-218`; `sleepWithCancellation` chunks by `CHUNK_MS = 100` and calls `checkCancelled('inside sleep')` in `src/macro/builtins.ts:316-327`; L-133-SLEEP and L-133-SLOWOP tests pass. |
| 12 | POC builtin examples that do not require deferred shell/tool dispatch execute in the production evaluator harness. | VERIFIED | POC fragment tests for `01-hello`, `05-counter`, `06-status-and-tasks`, `13-input-vars`, and `17-input-var-missing` are present in `tests/unit/macro-builtins.test.ts:230-336` and execute through `evaluateProgram(parseProgram(source))`. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/macro/preflight.ts` | `collectInputVarContract`, `validateInputVars`, `MacroPreflightError`, literal defaults, missing-input aggregation | VERIFIED | `gsd-sdk query verify.artifacts` passed for Plan 01; exports found at lines 15, 20, 31, and 142; no stub markers. |
| `src/macro/evaluator.ts` | Named-arg builtin contract, default `standardBuiltins` merge, preflight hook, invocation-owned log/progress/task hooks | VERIFIED | `MacroNamedArgs` at line 37; default registry merge at line 209; preflight/input validation at lines 236-238; builtin dispatch at line 572. |
| `src/macro/builtins.ts` | `standardBuiltins` registry and implementation for v0 builtin names with arity validation | VERIFIED | Registry starts at line 12 and includes the exact required builtin list; `requireArgCount`/`requireNamedArgs` enforce post-security validation; `buildRange` exported at line 222. |
| `tests/unit/macro-preflight.test.ts` | T-U-097 through T-U-108 input coverage | VERIFIED | All IDs present; focused phase suite passed. |
| `tests/unit/macro-builtins.test.ts` | T-U-047 through T-U-051, T-U-109 through T-U-125, async local IDs, POC coverage, representative arity tests | VERIFIED | All IDs present; arity assertions added for `count`, `sleep`, and `slow_op`; focused phase suite passed. |
| `tests/unit/macro-termination.test.ts` | T-U-084 through T-U-091 termination regression coverage plus `fail`/`exit` arity validation | VERIFIED | All IDs present; invalid `fail` shape and named-arg `exit` assertions present at lines 40-57; focused phase suite passed. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `src/macro/evaluator.ts` | `src/macro/preflight.ts` | Pre-exec `collectInputVarContract` and `validateInputVars` | WIRED | Manual `rg` found import plus calls at `src/macro/evaluator.ts:21-24` and `src/macro/evaluator.ts:237-238`; this corrects a false negative from escaped-pattern SDK matching. |
| `src/macro/evaluator.ts` | `MacroBuiltin` | Positional plus named args dispatch | WIRED | `MacroBuiltin` accepts `(positional, named, context)` and evaluator calls `builtin(positional, named, context)` at `src/macro/evaluator.ts:39-43` and `src/macro/evaluator.ts:572`. |
| `src/macro/evaluator.ts` | `src/macro/builtins.ts` | Default `standardBuiltins` merge | WIRED | `standardBuiltins` imported and merged into context builtins at `src/macro/evaluator.ts:25` and `src/macro/evaluator.ts:209`. |
| `src/macro/builtins.ts` | `src/macro/evaluator.ts` | Runtime errors, expected errors, builtin contract, invocation context | WIRED | `builtins.ts` imports `MacroRuntimeError`, `MacroExpectedError`, terminal control errors, and `MacroBuiltin`; builtins use context trace/progress/task hooks. |
| `tests/unit/macro-builtins.test.ts` | POC examples | Production evaluator parses and executes non-tool builtin examples | WIRED | POC tests execute through `evaluateProgram(parseProgram(source))`; no test-only builtin replacement. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `src/macro/preflight.ts` | `missingInputs`, `optional` defaults | AST traversal of parsed macro program plus caller `inputVars` | Yes | FLOWING |
| `src/macro/evaluator.ts` | `context.inputVars`, `trace`, `log`, `progress`, `taskId`, `builtins` | `createInvocationContext(options)` fresh per invocation | Yes | FLOWING |
| `src/macro/builtins.ts` | Builtin return values, runtime/expected errors, channel entries | Evaluated positional/named args plus invocation context | Yes | FLOWING |
| `tests/unit/macro-builtins.test.ts` | POC/runtime payload assertions | Production evaluator outputs parsed with `parseToolPayload` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Phase 133 focused tests | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-preflight.test.ts tests/unit/macro-builtins.test.ts tests/unit/macro-termination.test.ts` | Locally rerun: 3 files passed, 55 tests passed | PASS |
| Macro unit regression suite | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-*.test.ts` | Parent final verification: 12 files passed, 159 tests passed | PASS |
| Full unit suite | `npm test` | Parent final verification: 105 files passed, 1624 tests passed | PASS |
| Production build | `npm run build` | Parent final verification passed | PASS |
| Exact standard registry contents | `npx tsx -e "import { standardBuiltins } from './src/macro/builtins.ts'; console.log(Object.keys(standardBuiltins).join(','));"` | Printed the exact 19 v0 builtin names and no extras | PASS |
| Security arity-validation source check | `rg -n "requireArgCount|requireNamedArgs|[a-z_]+_argument_count" src/macro/builtins.ts src/macro/evaluator.ts tests/unit/macro-builtins.test.ts tests/unit/macro-termination.test.ts` | Count/named-arg guards found for standard builtins; representative tests assert stable arity reasons | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| MACRO-SRC-07 | 133-01 | `input_var` declarations are collected before execution and missing required inputs are reported together. | SATISFIED | `collectInputVarContract`/`validateInputVars` wired before `execBlock`; T-U-098/T-U-099 pass. |
| MACRO-SRC-08 | 133-01 | `input_vars` support v0 value domain, including `null` and default-literal semantics. | SATISFIED | Literal conversion supports string/number/null/list/object; T-U-100 through T-U-108 pass. |
| MACRO-BI-01 | 133-02 | Data builtins match spec and POC semantics. | SATISFIED | `count`, `unique`, `append`, `concat` implemented and T-U-109 through T-U-114 pass; invalid count arity is tested. |
| MACRO-BI-02 | 133-02 | Arithmetic builtins validate numeric inputs and return deterministic results. | SATISFIED | `add`, `sub`, `mul`, `div`, `mod` implemented and T-U-115 through T-U-119 pass. |
| MACRO-BI-03 | 133-03 | `fail` and `exit` halt execution with canonical envelopes. | SATISFIED | Evaluator-owned control-flow path preserved; T-U-084 through T-U-091 pass; invalid fail/exit arity/named args return `invalid_input`. |
| MACRO-BI-04 | 133-01 | Runtime `input_var` reads caller bindings and defaults consistently with pre-flight. | SATISFIED | Runtime presence/default checks in evaluator and registry; T-U-097 through T-U-108 pass. |
| MACRO-BI-05 | 133-02 | `range` supports one-, two-, and three-argument forms including negative steps. | SATISFIED | `range` and `buildRange`; T-U-047 through T-U-051 pass. |
| MACRO-BI-06 | 133-03 | `echo` and `status` write to distinct trace/progress channels. | SATISFIED | Channel implementation and T-U-120 through T-U-123 pass. |
| MACRO-BI-07 | 133-03 | `task_id` and `list_tasks` expose only current invocation/session scope. | SATISFIED | Invocation-owned task hooks/fallback and T-U-124/T-U-125 pass; no global `taskRegistry`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `src/macro/builtins.ts` | 154, 179, 205 | `return null` | INFO | Legitimate builtin return value for `echo`, `status`, and `sleep`; not a stub because tests exercise observable trace/progress/sleep behavior. |
| `src/macro/evaluator.ts` | 463, 758 | `return null` / `return {}` | INFO | Legitimate evaluator literal-null/tool-arg behavior; not user-visible placeholder. |
| `src/macro/preflight.ts` | 174 | `return null` | INFO | Literal `null` default conversion; required by MACRO-SRC-08. |

### Human Verification Required

None. This phase is CLI/runtime unit behavior and was programmatically verified with source inspection, artifact/link checks, local focused tests, and parent final suite/build results.

### Gaps Summary

No blocking gaps found. The phase goal is achieved: v0 standard library builtins are present, wired into the production evaluator by default, covered by unit tests, protected by post-security arity/named-argument validation, and scoped away from deferred shell/tool-dispatch/task-lifecycle work.

---

_Verified: 2026-05-14T15:13:00Z_
_Verifier: the agent (gsd-verifier)_
