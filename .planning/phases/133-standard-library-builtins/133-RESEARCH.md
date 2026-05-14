# Phase 133: Standard Library Builtins - Research

**Researched:** 2026-05-14 [VERIFIED: current_date + gsd init]
**Domain:** FlashQuery macro standard-library builtins and input preflight [VERIFIED: .planning/phases/133-standard-library-builtins/133-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: mandatory product requirements + test plan + POC + local code inspection]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Source Of Truth

- Downstream agents MUST read the Macro Language requirements doc before planning, implementing, reviewing, or verifying Phase 133.
- Downstream agents MUST read the Macro Language test plan before planning, implementing, reviewing, or verifying Phase 133.
- Downstream agents MUST inspect the frozen macro POC files cited by builtin requirements before implementing builtin behavior.
- Where the requirements document and POC disagree, the requirements document is authoritative.
- Where the requirements document and test plan disagree, stop and surface the discrepancy rather than silently choosing one.

### Builtin Scope

- Implement production builtin code inside `src/macro/`, preserving the evaluator contract produced by Phase 132.
- Prefer a registry-style builtin module, likely `src/macro/builtins.ts`, exporting the v0 builtin map consumed by `evaluateProgram`.
- Add a focused preflight module, likely `src/macro/preflight.ts`, for `collectInputVarContract(program)` and missing-input validation before statement execution.
- Keep builtin functions pure where the spec requires immutability: `append`, `unique`, and `concat` must not mutate input lists/objects.
- Use typed macro runtime/preflight/termination errors at module boundaries rather than ad hoc thrown strings.
- Preserve FlashQuery conventions: ESM TypeScript, strict typing, `.js` extension imports in tests, no CommonJS, and existing Vitest patterns.

### Testing Expectations

- Unit tests are the primary proof layer for Phase 133.
- The plan must map MACRO-SRC-07, MACRO-SRC-08, and MACRO-BI-01 through MACRO-BI-07 to concrete test files and test IDs from the Macro Language test plan.
- Required unit test files include `tests/unit/macro-builtins.test.ts` and `tests/unit/macro-preflight.test.ts` unless the planner identifies a stronger local naming split.
- Include POC examples that exercise builtins in the production evaluator harness where practical, but keep shell/tool-dispatch examples deferred to their later phases.
- Include explicit acceptance criteria that verify no implementation agent can skip source-doc reading.

### the agent's Discretion
## Specific Ideas

- Plan builtin work as test-first vertical slices: preflight/input vars, data/range/arithmetic, termination, and channel/task introspection.
- Keep `input_var` contract collection separate from the runtime `input_var` builtin so missing required inputs can be reported before any statement executes.
- Return all missing required inputs at once; do not fail on the first missing input.
- Treat explicit `null` in `input_vars` as a provided value, not as missing.
- Implement `div` as integer-truncated division and `mod` as a positive-result modulo, with division/modulo by zero as runtime errors.
- Make `range` match the spec/test plan examples: one-arg, two-arg, three-arg forms, negative steps, zero-step error, and half-open output.
- Keep `echo` trace/log behavior separate from `status` progress behavior; `status` must be a no-op for external notifications when no progress token/sink exists.
- For `task_id` and `list_tasks`, adapt to the current evaluator context without implementing the later full task lifecycle phase.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Shell verbs, vault jail, and forbidden-flag pre-scan belong to Phase 134.
- Namespaced tool dispatch, permission pre-scan, `_exists()`, and broker/native registry integration belong to Phase 135.
- Full task lifecycle, external cancellation surface, and durable task semantics belong to later macro lifecycle phases.
- Trace/progress transport, dry-run, budgets, source_ref handling, and final `call_macro` end-to-end handler are later macro-support phases unless the roadmap changes.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-SRC-07 | `input_var` declarations are collected before execution and missing required inputs are reported together. [VERIFIED: .planning/REQUIREMENTS.md] | Add `src/macro/preflight.ts`, run it before `execBlock`, and return `invalid_input` with all `missing_inputs`. [CITED: Macro Requirements §6.1.7; CITED: Macro Test Plan §4.4.1; VERIFIED: POC evaluator.ts collectInputVarContract] |
| MACRO-SRC-08 | `input_vars` support the v0 value domain, including `null` and default-literal semantics. [VERIFIED: .planning/REQUIREMENTS.md] | Preserve evaluator `MacroValue` JSON-shaped domain, explicit `null` as present, and literal defaults for strings/numbers/null/lists/objects. [CITED: Macro Requirements §6.1.8; VERIFIED: src/macro/evaluator.ts; CITED: Macro Test Plan §4.4.2] |
| MACRO-BI-01 | Data builtins `count`, `unique`, `append`, and `concat` match the spec and POC semantics. [VERIFIED: .planning/REQUIREMENTS.md] | Implement immutable list/string helpers with deep equality for `unique`. [CITED: Macro Requirements §6.5.1; VERIFIED: POC builtins.ts] |
| MACRO-BI-02 | Arithmetic builtins `add`, `sub`, `mul`, `div`, and `mod` validate numeric inputs and return deterministic results. [VERIFIED: .planning/REQUIREMENTS.md] | Implement numeric-only helpers, integer-truncated `div`, positive-result `mod`, and zero-divisor errors. [CITED: Macro Requirements §6.5.2; VERIFIED: POC builtins.ts] |
| MACRO-BI-03 | `fail` and `exit` halt execution with canonical envelopes. [VERIFIED: .planning/REQUIREMENTS.md] | Keep evaluator-owned `MacroFailError`/`MacroExitError`; add standard-library registration compatibility and verify T-U-084..T-U-091 stay green. [CITED: Macro Requirements §6.5.3; VERIFIED: src/macro/evaluator.ts] |
| MACRO-BI-04 | Runtime `input_var` reads caller bindings and defaults consistently with preflight. [VERIFIED: .planning/REQUIREMENTS.md] | Register `input_var`, pass named args into builtins, and defensive-check key/default contract. [CITED: Macro Requirements §6.5.4; VERIFIED: POC builtins.ts] |
| MACRO-BI-05 | `range` supports one-, two-, and three-argument forms including negative steps. [VERIFIED: .planning/REQUIREMENTS.md] | Add `range` builtin and share range-list semantics with parser-produced `RangeExpr` where possible. [CITED: Macro Requirements §6.5.5; VERIFIED: src/macro/evaluator.ts RangeExpr support] |
| MACRO-BI-06 | `echo` and `status` write to distinct trace/progress channels. [VERIFIED: .planning/REQUIREMENTS.md] | Add context-owned log/progress sinks; `echo` pushes `kind:"log"`, `status` pushes `kind:"progress"` and no-ops external notification without token/sink. [CITED: Macro Requirements §6.5.6; VERIFIED: src/mcp/utils/response-formats.ts TraceStep] |
| MACRO-BI-07 | `task_id` and `list_tasks` expose only the current invocation/session scope. [VERIFIED: .planning/REQUIREMENTS.md] | Return `context.taskId`; use an injectable task-list provider/default current-invocation record rather than POC singleton registry. [CITED: Macro Requirements §6.5.7; VERIFIED: Phase 132 isolation summaries] |
</phase_requirements>

## Summary

Phase 133 should add the production v0 builtin registry under `src/macro/builtins.ts` and a syntactic input-contract preflight module under `src/macro/preflight.ts`. [CITED: Macro Requirements §8.6; VERIFIED: .planning/phases/133-standard-library-builtins/133-CONTEXT.md] The existing Phase 132 evaluator already owns `MacroValue`, invocation context creation, trace buffers, budget counters, task IDs, cancellation hooks, and canonical ToolResult envelope mapping, so Phase 133 should extend that evaluator contract instead of introducing another execution path. [VERIFIED: src/macro/evaluator.ts; VERIFIED: 132-01-SUMMARY.md through 132-04-SUMMARY.md]

The implementation-sensitive gap is that `evalCall` currently evaluates only positional args and invokes `MacroBuiltin(args, context)`, while Phase 133 needs named args for `input_var --default` and `status --progress/--total`. [VERIFIED: src/macro/evaluator.ts lines 383-446; VERIFIED: src/macro/parser.ts lines 377-403] Plan the first slice to add named-arg evaluation and default builtin registration before the individual builtin tests. [CITED: Macro Requirements §6.1.7 and §6.5.6]

**Primary recommendation:** Use test-first vertical slices in this order: evaluator builtin-call contract and preflight, `input_var`, data/range/arithmetic, termination compatibility, echo/status channels, then task introspection. [VERIFIED: .planning/phases/133-standard-library-builtins/133-CONTEXT.md; CITED: Macro Test Plan §4.4]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Builtin dispatch | API / Backend | — | Macro execution runs inside FlashQuery's MCP server/evaluator process. [VERIFIED: AGENTS.md; CITED: Macro Requirements §1] |
| Input contract preflight | API / Backend | MCP handler later | The evaluator can validate `inputVars` against AST declarations before statement execution; final request schema/source resolution is Phase 138. [CITED: Macro Requirements §6.1.7; VERIFIED: ROADMAP.md] |
| Data/arithmetic/range builtins | API / Backend | — | These are pure deterministic value transforms over `MacroValue`. [CITED: Macro Requirements §6.5.1-§6.5.5] |
| Termination builtins | API / Backend | MCP response helpers | Evaluator maps control-flow errors to canonical ToolResult envelopes. [VERIFIED: src/macro/evaluator.ts; VERIFIED: src/mcp/utils/response-formats.ts] |
| Echo/status channels | API / Backend | MCP progress transport later | This phase owns trace/log/progress state separation; final progress-token transport modes are later Phase 137. [CITED: Macro Requirements §6.5.6; VERIFIED: ROADMAP.md] |
| Task introspection | API / Backend | Task registry later | Phase 133 can expose current invocation/task-list injection without implementing durable/full lifecycle semantics. [VERIFIED: 133-CONTEXT.md; CITED: Macro Requirements §6.5.7] |

## Project Constraints (from AGENTS.md)

- Use Node.js >=20 LTS; the local environment is Node v24.7.0 and npm 11.5.1. [VERIFIED: AGENTS.md; VERIFIED: environment audit]
- Use TypeScript strict mode and ESM imports with `.js` extensions in tests/source. [VERIFIED: AGENTS.md; VERIFIED: package.json; VERIFIED: current macro tests]
- Do not use CommonJS `require`. [VERIFIED: AGENTS.md]
- Use `async/await` throughout. [VERIFIED: AGENTS.md]
- Use typed errors at module boundaries; MCP tool handlers return `isError: true` responses for runtime failures. [VERIFIED: AGENTS.md; VERIFIED: src/mcp/utils/response-formats.ts]
- Use Zod for external input validation, but Phase 133 is evaluator-internal unless it introduces a public request schema. [VERIFIED: AGENTS.md; VERIFIED: ROADMAP.md]
- Unit tests live in `tests/unit/*.test.ts` and run with `npm test`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- Do not build a web UI. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per-call. [VERIFIED: AGENTS.md]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | package `^6.0.2`; npm current `6.0.3`, modified 2026-04-16 | Strict ESM implementation. | Existing project language and macro modules are TypeScript ESM. [VERIFIED: package.json; VERIFIED: npm registry] |
| Vitest | package `^4.1.1`; npm current `4.1.6`, modified 2026-05-11 | Unit validation for builtin/preflight behavior. | Existing unit config targets `tests/unit/**/*.test.ts`; Vitest supports config files and file/name filtering. [VERIFIED: package.json; VERIFIED: tests/config/vitest.unit.config.ts; CITED: Context7 /vitest-dev/vitest] |
| Chevrotain | package/current `12.0.0`, modified 2026-03-13 | Existing lexer/parser dependency. | Phase 133 consumes parser-produced AST and should only make parser refinements for `input_var` preflight compatibility. [VERIFIED: package.json; VERIFIED: npm registry; VERIFIED: src/macro/parser.ts] |
| FlashQuery macro response helpers | local | Canonical `macroResult`, `jsonExpectedError`, `jsonRuntimeError`, `TraceStep`. | Phase 130 established additive macro response contracts and Phase 132 uses them directly. [VERIFIED: src/mcp/utils/response-formats.ts; VERIFIED: .planning/STATE.md] |

### Supporting
| Library / API | Version | Purpose | When to Use |
|---------------|---------|---------|-------------|
| `node:crypto.randomUUID` | Node v24.7.0 local; project requires Node >=20 | Existing task ID generation. | Keep using evaluator `createInvocationContext`; do not add `uuid` usage for this phase. [VERIFIED: src/macro/evaluator.ts; VERIFIED: environment audit] |
| `structuredClone` | Node runtime API | Existing defensive clone/coercion of input vars. | Preserve context-owned `inputVars` and immutable builtin outputs. [VERIFIED: src/macro/evaluator.ts] |
| Local `MacroRuntimeError` / `MacroExitError` / `MacroFailError` | local | Stable typed runtime and control-flow failures. | Builtins should throw these errors, not raw strings. [VERIFIED: src/macro/evaluator.ts; VERIFIED: 133-CONTEXT.md] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Local builtin registry | POC singleton `builtins` + `taskRegistry` copy | POC semantics are useful, but singleton task state violates Phase 132 isolation. [VERIFIED: POC builtins.ts; VERIFIED: POC taskregistry.ts; CITED: Macro Requirements §6.3.7] |
| Dedicated dependency for deep equality | `fast-deep-equal` or similar | Not needed; macro values are JSON-shaped and current evaluator already uses JSON-like equality. [VERIFIED: src/macro/evaluator.ts; VERIFIED: package.json] |
| Implement final MCP progress transport now | Direct JSON-RPC notifications | Out of scope; Phase 137 owns trace/progress modes and `_meta.progressToken`. [VERIFIED: ROADMAP.md; CITED: Macro Requirements §6.5.6] |
| Implement full task registry now | POC `TaskRegistry` port | Out of scope; Phase 136 owns lifecycle, external cancellation, and session scoping. [VERIFIED: ROADMAP.md; VERIFIED: 133-CONTEXT.md] |

**Installation:** No new npm packages are required for Phase 133. [VERIFIED: package.json; VERIFIED: npm registry]

**Version verification commands run:**
```bash
npm view vitest version time.modified --json
npm view typescript version time.modified --json
npm view tsx version time.modified --json
npm view chevrotain version time.modified --json
```
[VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Program AST + EvaluateProgramOptions(inputVars, builtins?, taskId?, sinks?)
  -> createInvocationContext(...)
       -> inputVars cloned/coerced
       -> trace/log/progress/task state initialized
       -> builtins = standardBuiltins + caller overrides
  -> collectInputVarContract(program)
       -> walk all statements/expressions/calls
       -> reject non-literal input_var key/default shapes
       -> required[] / optional[{ key, default }]
  -> validateInputVars(contract, context.inputVars)
       -> if missing: jsonExpectedError({ error: "invalid_input", details.missing_inputs })
       -> else continue
  -> execBlock(...)
       -> evalCall(...)
            -> evaluate positional args
            -> evaluate named args
            -> dispatch standard builtin
            -> builtin may push trace/log/progress or throw typed control/runtime error
  -> termination boundary
       -> success/exit: macroResult(...)
       -> fail/preflight expected: jsonExpectedError(...)
       -> runtime builtin error: jsonRuntimeError(...)
```
[VERIFIED: src/macro/evaluator.ts; CITED: Macro Requirements §6.1.7 and §6.5]

### Recommended Project Structure
```text
src/macro/
├── builtins.ts          # standardBuiltins map and builtin helper functions
├── preflight.ts         # collectInputVarContract + validateInputVars
├── evaluator.ts         # add standard builtin defaulting, named args, log/progress/task hooks
└── types.ts             # keep AST types; add shared runtime types only if needed

tests/unit/
├── macro-builtins.test.ts
└── macro-preflight.test.ts
```
[VERIFIED: AGENTS.md; VERIFIED: 133-CONTEXT.md; CITED: Macro Requirements §8.6]

### Pattern 1: Builtin Registry With Named Args
**What:** Expand the runtime builtin signature to receive positional values, named values, and context. [VERIFIED: src/macro/parser.ts named args; VERIFIED: current evaluator positional-only call path]

**When to use:** Required for `input_var --default`, `status --progress`, and `status --total`. [CITED: Macro Requirements §6.1.7; CITED: Macro Requirements §6.5.6]

**Example:**
```typescript
// Source: POC builtins.ts adapted to current evaluator contract.
export type MacroNamedArgs = Record<string, MacroValue>;

export type MacroBuiltin = (
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
) => MacroValue | Promise<MacroValue>;
```
[VERIFIED: POC builtins.ts; VERIFIED: src/macro/evaluator.ts]

### Pattern 2: Preflight Is A Pure AST Walk
**What:** `collectInputVarContract(program)` should scan every possible `input_var` call without executing conditions, loops, tools, or builtins. [CITED: Macro Requirements §6.1.7; VERIFIED: POC evaluator.ts]

**When to use:** Run before `execBlock`; return all missing required keys in one expected `invalid_input` envelope. [CITED: Macro Requirements §6.1.7; CITED: Macro Test Plan §4.4.1]

**Example:**
```typescript
// Source: POC evaluator.ts collectInputVarContract, adapted to current AST names.
export interface InputVarContract {
  required: string[];
  optional: Array<{ key: string; default: MacroValue }>;
}
```
[VERIFIED: POC evaluator.ts; VERIFIED: src/macro/types.ts]

### Pattern 3: Immutable Value Helpers
**What:** `append`, `unique`, and `concat` should return new lists/strings and never mutate input arrays. [CITED: Macro Requirements §6.5.1]

**When to use:** All data builtins; tests should prove aliasing does not mutate an earlier binding. [CITED: Macro Test Plan §4.4.3; VERIFIED: tests/unit/macro-evaluator.test.ts T-U-096 pattern]

**Example:**
```typescript
// Source: POC builtins.ts append + Macro Requirements §6.5.1.
function appendBuiltin([list, ...items]: MacroValue[]): MacroValue[] {
  assertList(list, 'append');
  return [...list, ...items];
}
```
[VERIFIED: POC builtins.ts; CITED: Macro Requirements §6.5.1]

### Pattern 4: Channel Separation Is Context-Owned
**What:** `echo` writes to log trace only; `status` writes to progress trace/progress state only. [CITED: Macro Requirements §6.5.6]

**When to use:** Builtins should mutate only `context.trace`, `context.progress`, and optional injected sinks; no process-global stderr/stdout writes in production tests. [VERIFIED: src/macro/evaluator.ts context state; VERIFIED: POC builtins.ts as prototype-only stderr/log behavior]

**Example:**
```typescript
// Source: Macro Requirements §6.5.6 + response-formats.ts TraceStep.
echo: (args, _named, context) => {
  const message = args.map(stringifyMacroValue).join(' ');
  context.log?.(message);
  context.trace.push({ kind: 'log', message, at: new Date().toISOString() });
  return null;
}
```
[CITED: Macro Requirements §6.5.6; VERIFIED: src/mcp/utils/response-formats.ts]

### Anti-Patterns to Avoid
- **Copying POC `taskRegistry` singleton:** It stores current task ID in module state; Phase 132 established invocation-owned isolation. [VERIFIED: POC taskregistry.ts; VERIFIED: 132-04-SUMMARY.md]
- **Dropping named args:** `input_var --default` and `status --progress/--total` cannot be implemented correctly with positional-only dispatch. [VERIFIED: src/macro/evaluator.ts; CITED: Macro Requirements §6.1.7 and §6.5.6]
- **Evaluating defaults through arbitrary expressions:** Default values are literal-only in v0; rejecting non-literal defaults avoids side effects and aligns with boolean-literal deferral. [CITED: Macro Requirements §6.1.7]
- **Treating explicit `null` as missing:** `Object.hasOwn`/`key in inputVars` semantics are required; truthiness checks are wrong for this. [CITED: Macro Requirements §6.1.8; VERIFIED: POC builtins.ts]
- **Using raw `Error` from builtins:** Runtime errors need stable details/reasons for tests and downstream envelopes. [VERIFIED: src/macro/evaluator.ts; VERIFIED: 133-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Macro response envelopes | Custom MCP text JSON | `macroResult`, `jsonExpectedError`, `jsonRuntimeError` | Existing helpers encode expected vs runtime error semantics. [VERIFIED: src/mcp/utils/response-formats.ts] |
| Parser or AST scanner from strings | Regex over macro source | Existing AST from `parseMacroSource` and `Program` walk | Parser already emits structured `Call`, `NamedArg`, `RangeExpr`, loops, and object/list nodes. [VERIFIED: src/macro/parser.ts; VERIFIED: src/macro/types.ts] |
| Task registry | New singleton map | Context-owned task ID + injectable task-list provider | Full task lifecycle/session scoping is Phase 136. [VERIFIED: ROADMAP.md; VERIFIED: 133-CONTEXT.md] |
| Deep equality package | New dependency | Local JSON-shaped recursive equality/canonical keying | Macro values are constrained to JSON-shaped values. [VERIFIED: src/macro/evaluator.ts; VERIFIED: package.json] |
| Progress transport | Direct MCP notifications | Context progress array/sink placeholder | `_meta.progressToken` and verbosity modes are later Phase 137. [VERIFIED: ROADMAP.md] |

**Key insight:** This phase is not just "add functions"; it must first make evaluator builtin dispatch rich enough for named args, preflight, context-owned side channels, and injectable task introspection. [VERIFIED: src/macro/evaluator.ts; CITED: Macro Requirements §8.6]

## Common Pitfalls

### Pitfall 1: Preflight Runs Too Late
**What goes wrong:** A macro can emit logs or mutate context before missing inputs are reported. [CITED: Macro Requirements §6.1.7]
**Why it happens:** Implementing `input_var` only as a runtime builtin misses the pre-execution contract scan. [VERIFIED: POC evaluator.ts]
**How to avoid:** Run `collectInputVarContract` and missing-input validation before `execBlock`. [CITED: Macro Requirements §6.1.7]
**Warning signs:** Tests for missing `input_var` produce trace/log entries or fail only on the first missing key. [CITED: Macro Test Plan §4.4.1]

### Pitfall 2: Named Args Are Ignored
**What goes wrong:** `input_var "x" --default 5` and `status --progress 5 --total 10 "msg"` lose their flags. [CITED: Macro Requirements §6.1.7; CITED: Macro Requirements §6.5.6]
**Why it happens:** Current evaluator only calls `evalPositionalArgs` and passes positional values to builtins. [VERIFIED: src/macro/evaluator.ts]
**How to avoid:** Add `evalNamedArgs` and update `MacroBuiltin` signature before builtin implementation. [VERIFIED: src/macro/parser.ts NamedArg]
**Warning signs:** Tests T-U-100, T-U-121, or T-U-122 cannot be expressed without ad hoc special cases. [CITED: Macro Test Plan §4.4]

### Pitfall 3: POC Semantics Copied Without Production Divergence
**What goes wrong:** Process-global task/log/progress state leaks across invocations. [VERIFIED: POC taskregistry.ts]
**Why it happens:** The POC uses singleton task registry and stderr/stdout for standalone demos. [VERIFIED: POC builtins.ts; VERIFIED: POC taskregistry.ts]
**How to avoid:** Use `MacroInvocationContext` fields and injected providers/sinks only. [VERIFIED: src/macro/evaluator.ts]
**Warning signs:** `src/macro/builtins.ts` imports a `taskRegistry` singleton. [VERIFIED: POC builtins.ts]

### Pitfall 4: `unique` Uses Naive `JSON.stringify`
**What goes wrong:** Structurally equal objects with different key insertion order may not dedupe consistently. [ASSUMED]
**Why it happens:** POC uses stringification and notes production can use real deep equality. [VERIFIED: POC builtins.ts]
**How to avoid:** Use recursive value equality or stable key canonicalization for `unique`. [CITED: Macro Requirements §6.5.1]
**Warning signs:** `unique [{a:1,b:2},{b:2,a:1}]` keeps both values. [ASSUMED]

### Pitfall 5: `range` Direction Or Step Semantics Drift
**What goes wrong:** Descending ranges, zero step, or half-open end behavior differs between `range` builtin and `..` operator. [CITED: Macro Requirements §6.5.5]
**Why it happens:** Phase 132 implemented `RangeExpr` internally while Phase 133 adds separate `range` builtin. [VERIFIED: src/macro/evaluator.ts]
**How to avoid:** Share a helper for integer half-open range list construction. [CITED: Macro Requirements §6.2.6; CITED: Macro Requirements §6.5.5]
**Warning signs:** `range 10 0 -1` works but `10..0` differs unexpectedly, or `range 0 10 0` hangs. [CITED: Macro Test Plan §4.1.6]

## Code Examples

### Preflight Missing Input Envelope
```typescript
// Source: Macro Requirements §6.1.7 + response-formats.ts.
return jsonExpectedError({
  error: 'invalid_input',
  message: `Macro is missing required input(s): ${missing.join(', ')}`,
  details: {
    required_inputs: contract.required,
    optional_inputs: contract.optional.map((entry) => entry.key),
    provided_inputs: Object.keys(context.inputVars),
    missing_inputs: missing,
  },
});
```
[CITED: Macro Requirements §6.1.7; VERIFIED: src/mcp/utils/response-formats.ts]

### Positive Modulo
```typescript
// Source: Macro Requirements §6.5.2 + POC builtins.ts.
function positiveModulo(a: number, b: number): number {
  if (b === 0) throw new MacroRuntimeError('mod divisor must not be zero.', undefined, { reason: 'mod_by_zero' });
  return ((a % b) + b) % b;
}
```
[CITED: Macro Requirements §6.5.2; VERIFIED: POC builtins.ts]

### Status Trace Shape
```typescript
// Source: Macro Requirements §6.5.6 + response-formats.ts TraceStep.
context.progress.push({ message, progress, total });
context.trace.push({
  kind: 'progress',
  message,
  result: { progress, total },
  at: new Date().toISOString(),
});
```
[CITED: Macro Requirements §6.5.6; VERIFIED: src/mcp/utils/response-formats.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| POC singleton `taskRegistry` for `task_id`, `list_tasks`, trace, and progress | Invocation-owned `MacroInvocationContext` with injected task-list/progress/log hooks | Phase 132 completion on 2026-05-14 | Prevents cross-invocation leakage and keeps Phase 136 lifecycle work isolated. [VERIFIED: 132-04-SUMMARY.md; VERIFIED: src/macro/evaluator.ts] |
| Positional-only evaluator builtins | Named + positional builtin arguments | Needed in Phase 133 | Required for `input_var --default` and `status --progress/--total`. [VERIFIED: src/macro/evaluator.ts; CITED: Macro Requirements §8.6] |
| POC `range` missing | Production `RangeExpr` already exists; `range` builtin still needed | Phase 132 implemented RangeExpr | Reuse helper semantics so parser operator and builtin agree. [VERIFIED: 132-02-SUMMARY.md; CITED: Macro Requirements §6.5.5] |

**Deprecated/outdated:**
- POC stdout/stderr live channels are demo-only and should not be copied into production unit behavior. [VERIFIED: POC builtins.ts; CITED: Macro Requirements §6.5.6]
- POC task registry terminal-record retention is demo-only; production lifecycle cleanup is later Phase 136. [VERIFIED: POC taskregistry.ts; VERIFIED: ROADMAP.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `unique` should treat differently ordered object keys as structurally equal. | Common Pitfalls | Planner may need an explicit user/spec confirmation or a narrower equality test if v0 means insertion-order JSON equality. |
| A2 | Default current-invocation task record is acceptable for `list_tasks` until Phase 136 provides session registry. | Architecture Patterns / Phase Requirements | Planner may need to require an injectable provider only and avoid a default record if user expects an empty list without registry. |

## Open Questions

1. **Should boolean `input_var --default true/false` be rejected in parser or preflight?**
   - What we know: Requirements say boolean defaults fail at parse time; the test plan says parse/preflight for non-literal key and parse error for boolean default. [CITED: Macro Requirements §6.1.7; CITED: Macro Test Plan §4.4.1]
   - What's unclear: Current parser treats bare identifiers as calls, so `true`/`false` may parse as zero-arg calls unless parser is refined. [VERIFIED: src/macro/parser.ts]
   - Recommendation: Plan a small parser/preflight refinement and assert the final public envelope matches the test plan; stop if parser-wide `true`/`false` rejection conflicts with earlier parse requirements. [VERIFIED: parser inspection]

2. **What should `list_tasks` return before Phase 136 registry exists?**
   - What we know: Requirement says current-session tasks only; context says adapt to the current evaluator surface without full lifecycle. [CITED: Macro Requirements §6.5.7; VERIFIED: 133-CONTEXT.md]
   - What's unclear: There is no production session/task registry yet in Phase 133. [VERIFIED: src/macro/evaluator.ts; VERIFIED: ROADMAP.md]
   - Recommendation: Add an injectable `listTasks(context)` hook and default to current invocation only or empty list, then document that Phase 136 replaces it. [ASSUMED]

3. **Should `sleep` and `slow_op` be implemented in Phase 133 despite not being in MACRO-BI IDs?**
   - What we know: Roadmap success criteria list sleep and slow-op builtins as registered; phase requirement IDs only list MACRO-BI-01 through MACRO-BI-07. [VERIFIED: ROADMAP.md; VERIFIED: .planning/REQUIREMENTS.md]
   - What's unclear: Test Plan §4.4 does not list dedicated T-U IDs for sleep/slow_op in Phase 133. [VERIFIED: Macro Test Plan §4.4]
   - Recommendation: Include lightweight registrations if easy, but keep cancellation/lifecycle behavior deferred to Phase 136 and avoid making them central proof points. [VERIFIED: 133-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript/Vitest runtime | Yes | v24.7.0 | Project minimum is Node >=20. [VERIFIED: environment audit; VERIFIED: package.json] |
| npm | scripts and package version checks | Yes | 11.5.1 | None needed. [VERIFIED: environment audit] |
| npx | Context7 CLI fallback if MCP unavailable | Yes | 11.5.1 | Context7 MCP available. [VERIFIED: environment audit; VERIFIED: Context7 calls] |
| gsd-sdk | init and optional commit | Yes | v1.41.2 | Manual git commit if needed. [VERIFIED: environment audit] |
| Supabase / `.env.test` | Integration/E2E only | Not required for Phase 133 unit proof | — | Unit tests skip external services. [VERIFIED: AGENTS.md; VERIFIED: Test Plan §4.4] |

**Missing dependencies with no fallback:** None for planned Phase 133 unit implementation. [VERIFIED: environment audit]

**Missing dependencies with fallback:** Supabase may be unavailable, but Phase 133 primary validation is unit tests. [VERIFIED: AGENTS.md; CITED: Macro Test Plan §4.4]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest package `^4.1.1`, npm current `4.1.6`. [VERIFIED: package.json; VERIFIED: npm registry] |
| Config file | `tests/config/vitest.unit.config.ts`. [VERIFIED: local file] |
| Quick run command | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-builtins.test.ts tests/unit/macro-preflight.test.ts` [CITED: Context7 /vitest-dev/vitest; VERIFIED: package.json] |
| Full suite command | `npm test` [VERIFIED: package.json] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MACRO-SRC-07 | Preflight collects `input_var` and reports all missing keys. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-preflight.test.ts -t "T-U-097|T-U-098|T-U-099"` | No - Wave 0. [VERIFIED: file scan] |
| MACRO-SRC-08 | `input_vars` support null, lists, objects, nested values. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-preflight.test.ts -t "T-U-101|T-U-107|T-U-108"` | No - Wave 0. [VERIFIED: file scan] |
| MACRO-BI-01 | Data builtins `count`, `unique`, `append`, `concat`. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-builtins.test.ts -t "T-U-109|T-U-110|T-U-111|T-U-112|T-U-113|T-U-114"` | No - Wave 0. [VERIFIED: file scan] |
| MACRO-BI-02 | Arithmetic builtins. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-builtins.test.ts -t "T-U-115|T-U-116|T-U-117|T-U-118|T-U-119"` | No - Wave 0. [VERIFIED: file scan] |
| MACRO-BI-03 | Termination builtins preserve canonical envelopes. | unit regression | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-termination.test.ts` | Yes. [VERIFIED: file scan] |
| MACRO-BI-04 | Runtime `input_var` reads present/default values. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-preflight.test.ts -t "T-U-100|T-U-101|T-U-104|T-U-105"` | No - Wave 0. [VERIFIED: file scan] |
| MACRO-BI-05 | `range` builtin one/two/three arg forms. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-builtins.test.ts -t "T-U-047|T-U-048|T-U-049|T-U-050|T-U-051"` | No - Wave 0. [VERIFIED: file scan] |
| MACRO-BI-06 | Echo/status trace and channel separation. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-builtins.test.ts -t "T-U-120|T-U-121|T-U-122|T-U-123"` | No - Wave 0. [VERIFIED: file scan] |
| MACRO-BI-07 | `task_id` and `list_tasks` scoped to invocation/session. | unit | `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-builtins.test.ts -t "T-U-124|T-U-125"` | No - Wave 0. [VERIFIED: file scan] |

### Sampling Rate
- **Per task commit:** Run the focused file for that slice. [VERIFIED: Vitest docs via Context7]
- **Per wave merge:** Run all macro unit tests: `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-*.test.ts`. [VERIFIED: tests/config/vitest.unit.config.ts]
- **Phase gate:** Run `npm test`; then run focused POC-example evaluator tests for examples 01, 05, 06, 13, and 17 if added. [VERIFIED: ROADMAP.md success criteria]

### Wave 0 Gaps
- [ ] `tests/unit/macro-builtins.test.ts` - covers T-U-047..T-U-051, T-U-109..T-U-125. [CITED: Macro Test Plan §4.1.6 and §4.4]
- [ ] `tests/unit/macro-preflight.test.ts` - covers T-U-097..T-U-108. [CITED: Macro Test Plan §4.4.1-§4.4.2]
- [ ] `src/macro/builtins.ts` - standard builtin registry. [CITED: Macro Requirements §8.6]
- [ ] `src/macro/preflight.ts` - input contract collector and validation. [CITED: Macro Requirements §8.6]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No | Phase 133 has no auth boundary; `call_macro` public request/session work is later. [VERIFIED: ROADMAP.md] |
| V3 Session Management | Limited | Do not implement process-global session/task state; use context injection only. [VERIFIED: AGENTS.md; VERIFIED: 132-04-SUMMARY.md] |
| V4 Access Control | Limited | Do not add tool/shell dispatch; those phases own permission and vault-jail controls. [VERIFIED: ROADMAP.md] |
| V5 Input Validation | Yes | AST preflight, literal-only `input_var` keys/defaults, numeric/list/string type guards, stable runtime reasons. [CITED: Macro Requirements §6.1.7 and §6.5] |
| V6 Cryptography | No | No cryptographic operations in Phase 133. [VERIFIED: phase scope] |

### Known Threat Patterns for Macro Builtins

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Input contract bypass by dynamic key | Tampering | Reject non-literal `input_var` keys during preflight. [CITED: Macro Requirements §6.1.7] |
| Cross-invocation/session task leakage | Information Disclosure | No singleton registry; use context/task-list injection and current-session filtering. [CITED: Macro Requirements §6.5.7; VERIFIED: 132-04-SUMMARY.md] |
| Progress/log channel confusion | Information Disclosure | Keep `echo` and `status` channels separate; status no-ops external notification without progress sink/token. [CITED: Macro Requirements §6.5.6] |
| Runtime type confusion | Tampering | Validate builtin argument counts/types and return canonical runtime errors. [CITED: Macro Requirements §6.5.1-§6.5.5] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/133-standard-library-builtins/133-CONTEXT.md` - phase boundary, locked decisions, canonical refs. [VERIFIED: local file]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - REQ-007, REQ-008, REQ-034 through REQ-040, §8.6. [CITED: local product doc]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - T-U-047..T-U-051 and T-U-097..T-U-125. [CITED: local product doc]
- `src/macro/evaluator.ts`, `src/macro/parser.ts`, `src/macro/types.ts`, `src/mcp/utils/response-formats.ts` - current production surfaces. [VERIFIED: local code]
- POC `macro-prototype/src/builtins.ts`, `evaluator.ts`, `taskregistry.ts` - builtin/preflight/task reference with documented divergences. [VERIFIED: local POC]
- Context7 `/vitest-dev/vitest` - Vitest config/filtering docs. [CITED: Context7]

### Secondary (MEDIUM confidence)
- npm registry version metadata for TypeScript, Vitest, tsx, Chevrotain. [VERIFIED: npm registry]
- Phase 132 summaries and pattern map for evaluator decisions. [VERIFIED: local planning docs]

### Tertiary (LOW confidence)
- None. [VERIFIED: sources audit]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages; versions verified against local `package.json` and npm registry. [VERIFIED: package.json; VERIFIED: npm registry]
- Architecture: HIGH - based on current evaluator/parser code, Phase 132 summaries, and authoritative macro requirements. [VERIFIED: local code; CITED: Macro Requirements]
- Pitfalls: MEDIUM - core pitfalls are verified; `unique` object-key-order concern is assumed and flagged. [VERIFIED: POC builtins.ts; ASSUMED]

**Research date:** 2026-05-14 [VERIFIED: current_date]
**Valid until:** 2026-06-13 for local architecture; re-check npm docs/versions after 30 days. [ASSUMED]
