# Phase 132: Evaluator Core - Research

**Researched:** 2026-05-14 [VERIFIED: gsd init + current date]
**Domain:** FlashQuery macro language async tree-walking evaluator [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: primary requirements doc + test plan + POC + local code inspection]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Source Of Truth

- Downstream agents MUST read the Macro Language requirements doc before planning, implementing, reviewing, or verifying Phase 132.
- Downstream agents MUST read the Macro Language test plan before planning, implementing, reviewing, or verifying Phase 132.
- Downstream agents MUST inspect the frozen macro POC files cited by evaluator requirements before implementing evaluator behavior.
- Where the requirements document and POC disagree, the requirements document is authoritative.
- Where the requirements document and test plan disagree, stop and surface the discrepancy rather than silently choosing one.

### Evaluator Scope

- Implement production evaluator code inside `src/macro/`, using the AST/type surface produced by Phase 131.
- Preserve FlashQuery conventions: ESM TypeScript, strict typing, `.js` extension imports in tests, no CommonJS, and Vitest patterns already used in this repository.
- Design the evaluator around an invocation context object rather than process-global state.
- Make builtins and tool dispatch injectable/stubbable so this phase can test evaluator semantics without owning later builtin/dispatch phases.
- Include cancellation safe-point hooks at the semantic boundaries required by the spec even if external cancellation is wired later.

### Testing Expectations

- Unit tests are the primary proof layer for Phase 132.
- The plan must map MACRO-EVAL-01 through MACRO-EVAL-08 to concrete test files and test IDs from the Macro Language test plan.
- Required unit test files include `tests/unit/macro-scope.test.ts`, `tests/unit/macro-evaluator.test.ts`, `tests/unit/macro-termination.test.ts`, and `tests/unit/macro-isolation.test.ts` unless the planner identifies a stronger local naming split.
- Include `tests/integration/macro-concurrency.test.ts` only if the implementation surface is ready for meaningful simulated-session concurrency in this phase; otherwise the plan must defer that integration item explicitly to the phase that exposes the needed invocation boundary.
- Include explicit acceptance criteria that verify no implementation agent can skip source-doc reading.

### the agent's Discretion
## Specific Ideas

- Plan evaluator work as test-first vertical slices: environment/scope, expression truthiness/interpolation/field access, statement execution/loops, termination envelopes, and isolation/cancellation hooks.
- Keep the first evaluator surface small but real: `evaluateProgram(program, options)` or equivalent should accept parsed AST, input vars, injectable builtins/tool dispatcher, cancellation checker, and trace/progress sinks.
- Use dependency injection for builtin calls so Phase 132 can stub `add`, `append`, `echo`, `exit`, `fail`, and tool-call behavior while leaving the full standard library to Phase 133.
- Runtime errors should be typed enough for tests to assert stable macro error codes/details without relying on raw thrown exception messages.
- Treat `fail` as deliberate abort with `isError: false` and `macro_aborted`; treat unexpected evaluator/tool runtime failures as `isError: true`.
- Make state isolation visible in tests by constructing fresh invocation contexts for sequential runs and by checking trace/budget/task/progress containers are not reused.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Full standard-library builtin implementation belongs to Phase 133.
- Shell verb execution, vault jail, and forbidden-flag pre-scan belong to Phase 134.
- Namespaced tool dispatch, permission pre-scan, `_exists()`, and broker/native registry integration belong to Phase 135.
- Task registry external behavior, progress channels, budget enforcement, dry-run, and final `call_macro` source resolution are later macro-support phases unless the roadmap changes.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-EVAL-01 | Variable assignment uses walk-up scope mutation. [VERIFIED: .planning/REQUIREMENTS.md] | Implement `Env.set` with owner lookup; verify T-U-067..T-U-070. [CITED: Macro Requirements §6.3.1; CITED: Macro Test Plan §4.3.1; VERIFIED: POC evaluator.ts Env] |
| MACRO-EVAL-02 | For-loop iterator variables remain local to each iteration. [VERIFIED: .planning/REQUIREMENTS.md] | Use child scope plus `setLocal` for iterator only; verify T-U-071..T-U-072. [CITED: Macro Requirements §6.3.2; CITED: Macro Test Plan §4.3.2; VERIFIED: POC evaluator.ts for-loop] |
| MACRO-EVAL-03 | Truthiness rules are deterministic for strings, numbers, lists, objects, and `null`. [VERIFIED: .planning/REQUIREMENTS.md] | Export/test `isTruthy`; apply same function to `if`, `while`, `&&`, `||`, and `!`; verify T-U-073..T-U-075. [CITED: Macro Requirements §6.3.3; CITED: Macro Test Plan §4.3.3] |
| MACRO-EVAL-04 | Double-quoted string interpolation supports variable and chained field references. [VERIFIED: .planning/REQUIREMENTS.md] | Evaluate `StringLit.interpolated` only for double-quoted strings; support `$var`, `$var.field`, and `${var.field}`; verify T-U-076..T-U-080. [CITED: Macro Requirements §6.3.4; VERIFIED: src/macro/types.ts; VERIFIED: POC evaluator.ts interpolate] |
| MACRO-EVAL-05 | Chained field access traverses structured values and reports missing fields predictably. [VERIFIED: .planning/REQUIREMENTS.md] | Implement recursive `FieldAccess` evaluation; runtime-error on `null`, primitive, list non-index, or missing field; verify T-U-081..T-U-083. [CITED: Macro Requirements §6.3.5; VERIFIED: src/macro/types.ts] |
| MACRO-EVAL-06 | The four termination paths are implemented: fall-off success, `exit`, `fail`, and runtime error. [VERIFIED: .planning/REQUIREMENTS.md] | Return `macroResult` for success, `jsonExpectedError` for deliberate `fail`, `jsonRuntimeError` for runtime/tool failure; verify T-U-084..T-U-091. [CITED: Macro Requirements §6.3.6; VERIFIED: src/mcp/utils/response-formats.ts] |
| MACRO-EVAL-07 | Every invocation has isolated scope, trace, budget, task, and progress state. [VERIFIED: .planning/REQUIREMENTS.md] | Require `createInvocationContext`/fresh context per `evaluateProgram`; no singleton registry or global mutable env; verify T-U-092..T-U-094 and defer or add T-I-002 based on boundary readiness. [CITED: Macro Requirements §6.3.7; CITED: Macro Test Plan §4.3.6] |
| MACRO-EVAL-08 | Assignment RHS evaluation completes before the target binding is mutated. [VERIFIED: .planning/REQUIREMENTS.md] | Evaluate RHS into a local value before `env.set`; preserve immutable list/object helper expectations in stubs; verify T-U-095..T-U-096. [CITED: Macro Requirements §6.3.8; CITED: Macro Test Plan §4.3.7] |
</phase_requirements>

## Summary

Phase 132 should create a production evaluator module under `src/macro/` that consumes the Phase 131 AST and returns FlashQuery macro response contracts already exported from `src/mcp/utils/response-formats.ts`. [VERIFIED: src/macro/types.ts; VERIFIED: src/mcp/utils/response-formats.ts; CITED: Macro Requirements §8.5] The evaluator should be async and tree-walking, with an invocation context carrying scope, input vars, trace, progress sink, budget counters, task id, and cancellation hook, but this phase should not implement the final task registry, standard library, shell verbs, permission pre-scan, dry-run, or final MCP `call_macro` handler. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; CITED: Macro Requirements §8.5]

The POC is useful for the `Env` class, statement/expression dispatch, interpolation, truthiness, and deliberate termination error classes. [VERIFIED: macro-prototype/src/evaluator.ts; VERIFIED: macro-prototype/src/builtins.ts] Production must diverge from the POC by avoiding process-global task state, mapping `fail` to the canonical `macro_aborted` expected-error envelope, and adapting to Phase 131's AST names (`IfStmt.condition`, `WhileLoop`, `BinaryExpr`, `UnaryExpr`, `ToolExistsCall`) instead of the POC's older shapes. [CITED: Macro Requirements §5.4; VERIFIED: src/macro/types.ts; VERIFIED: macro-prototype/src/run.ts]

**Primary recommendation:** Plan four test-first vertical slices: `macro-scope`, `macro-evaluator`, `macro-termination`, and `macro-isolation`, all using injected stub builtins/tool handlers and a single `src/macro/evaluator.ts` runtime contract. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; CITED: Macro Test Plan §4.3]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| AST evaluation | API / Backend | — | Macro execution runs in-process inside FlashQuery's MCP server, not browser/client code. [CITED: Macro Requirements §1; VERIFIED: AGENTS.md] |
| Scope and control flow | API / Backend | — | Variables, loops, branches, truthiness, and termination are evaluator semantics over server-side ASTs. [CITED: Macro Requirements §6.3] |
| Tool/builtin invocation interface | API / Backend | Broker / external MCP later | Phase 132 owns injectable call boundaries; later phases own real builtin registration and broker/native dispatch. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; CITED: Macro Requirements §8.5-§8.7] |
| Response envelopes | API / Backend | MCP transport | Existing `macroResult`, `jsonExpectedError`, and `jsonRuntimeError` helpers define JSON MCP text envelopes. [VERIFIED: src/mcp/utils/response-formats.ts] |
| Per-invocation state isolation | API / Backend | Database / Storage only through later tools | Evaluator-visible state must be fresh per invocation; vault/tool registry infrastructure is explicitly outside engine state. [CITED: Macro Requirements §6.3.7] |
| Cancellation safe points | API / Backend | MCP task/progress later | Phase 132 should call a hook at safe points; later lifecycle phase wires external cancellation. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; CITED: Macro Requirements §8.5] |

## Project Constraints (from AGENTS.md)

- Node.js >= 20 LTS is required by `package.json` engines. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- Use TypeScript strict mode and ESM; do not use CommonJS `require`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- MCP tool responses use `{ content: [{ type: "text", text: "..." }] }`; errors set `isError: true` only for runtime errors. [VERIFIED: AGENTS.md; VERIFIED: src/mcp/utils/response-formats.ts]
- Use `async/await` throughout. [VERIFIED: AGENTS.md]
- Use typed errors at module boundaries; MCP handlers catch internally and return `isError: true` on failure. [VERIFIED: AGENTS.md]
- Use Zod for external input validation, but Phase 132 is evaluator-internal and should not add external schemas unless a boundary is introduced. [VERIFIED: AGENTS.md; VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]
- Unit tests live in `tests/unit/*.test.ts`; integration tests live in `tests/integration/*.test.ts`; scenario tests have separate directed/integration skill workflows. [VERIFIED: AGENTS.md; VERIFIED: tests/config/vitest.unit.config.ts]
- Do not build a web UI and do not implement server-side session state; MCP is stateless and project context is per call. [VERIFIED: AGENTS.md]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | package `^6.0.2`; npm current `6.0.3`, modified 2026-04-16 | Strict ESM implementation language. | Existing project standard and Phase 131 code is TypeScript ESM. [VERIFIED: package.json; VERIFIED: npm registry] |
| Vitest | package `^4.1.1`; npm current `4.1.6`, modified 2026-05-11 | Unit proof for evaluator semantics. | Existing unit config includes `tests/unit/**/*.test.ts`; Vitest CLI supports verbose reporter and file-pattern filtering. [VERIFIED: package.json; VERIFIED: tests/config/vitest.unit.config.ts; CITED: Context7 /vitest-dev/vitest] |
| Chevrotain | package/current `12.0.0`, modified 2026-03-13 | Parser dependency that already produced the AST. | Phase 132 should consume parsed AST, not parse text itself. [VERIFIED: package.json; VERIFIED: npm registry; VERIFIED: src/macro/parser.ts] |
| FlashQuery macro response helpers | local | `macroResult`, `jsonExpectedError`, `jsonRuntimeError`, `TraceStep`, `MacroExecutionResult`. | Phase 130 already established macro response contracts. [VERIFIED: src/mcp/utils/response-formats.ts; VERIFIED: .planning/STATE.md] |

### Supporting
| Library / API | Version | Purpose | When to Use |
|---------------|---------|---------|-------------|
| `node:crypto.randomUUID` | Node v24.7.0 local, project requires Node >=20 | Generate task IDs for isolated invocation contexts. | Use for evaluator-created task IDs unless later task-registry phase supplies IDs. [VERIFIED: environment audit; VERIFIED: macro-envelopes.test.ts] |
| Injected builtin functions | local type to add | Test `add`, `append`, `echo`, `exit`, `fail`, `range` without owning Phase 133. | Use in unit tests and evaluator call path. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md] |
| Injected tool dispatcher | local type to add | Simulate expected vs unexpected tool envelopes for REQ-024. | Use only as a stub boundary in Phase 132; real dispatch is Phase 135. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; CITED: Macro Requirements §8.7] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tree-walking evaluator | Bytecode / interpreter IR | Overkill for v0; spec explicitly calls for tree-walking async evaluator. [CITED: Macro Requirements §8.5] |
| Injectable builtins | Full `src/macro/builtins.ts` implementation now | Full builtins belong to Phase 133; adding them here risks scope creep. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; CITED: Macro Requirements §8.6] |
| Local invocation context | POC singleton `taskRegistry` | POC singleton leaks current-task assumptions and must diverge for production isolation. [CITED: Macro Requirements §6.3.7; VERIFIED: macro-prototype/src/taskregistry.ts] |
| Custom test runner | Vitest + existing configs | Existing repo already uses Vitest and filtering supports the required quick commands. [VERIFIED: tests/config/vitest.unit.config.ts; CITED: Context7 /vitest-dev/vitest] |

**Installation:** No new packages are required for Phase 132. [VERIFIED: package.json; VERIFIED: npm registry]

**Version verification commands run:**
```bash
npm view chevrotain version time.modified --json
npm view vitest version time.modified --json
npm view tsx version time.modified --json
npm view typescript version time.modified --json
```
[VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
parseMacroSource(source)
  -> Program AST
  -> evaluateProgram(program, options)
       -> create fresh InvocationContext
       -> Env root scope
       -> statement loop
            -> checkCancelled()
            -> Binding: eval RHS -> Env.set walk-up
            -> ForLoop: eval iterable -> child Env -> iterator setLocal -> body
            -> WhileLoop: eval condition via truthiness -> child Env -> body
            -> IfStmt: eval condition via truthiness -> branch child Env -> body
            -> Pipeline/Call: eval args -> injected builtin
            -> ToolCall/ToolExistsCall: injected dispatcher/introspection stub
       -> termination branch
            -> fall off: macroResult({ result: null, task_id, trace? })
            -> MacroExit: macroResult({ result: value, task_id, trace? })
            -> MacroFail: jsonExpectedError({ error: "macro_aborted", ... })
            -> Runtime/tool/cancel: jsonRuntimeError({ error: "...", ... })
```
[VERIFIED: src/macro/types.ts; VERIFIED: src/mcp/utils/response-formats.ts; CITED: Macro Requirements §6.3.6]

### Recommended Project Structure
```text
src/macro/
├── evaluator.ts          # evaluator, Env, runtime errors, public evaluateProgram surface
├── types.ts              # add runtime Value / BuiltinFn / ToolFn types if not kept in evaluator.ts
└── errors.ts             # optionally add evaluator runtime envelope detail types

tests/unit/
├── macro-scope.test.ts
├── macro-evaluator.test.ts
├── macro-termination.test.ts
└── macro-isolation.test.ts
```
[VERIFIED: AGENTS.md file organization; VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]

### Pattern 1: Invocation Context Over Globals
**What:** `evaluateProgram` should create or accept a fresh `MacroInvocationContext` with `taskId`, `trace`, `progress`, `budget`, `inputVars`, `cancelled`, `checkCancelled`, and injected call hooks. [CITED: Macro Requirements §6.3.7]

**When to use:** Always; no evaluator-visible state should live in module-level variables. [CITED: Macro Requirements §6.3.7]

**Example:**
```typescript
// Source: Macro Requirements §6.3.7 + POC evaluator.ts adapted for production isolation.
export interface MacroInvocationContext {
  taskId: string;
  inputVars: Record<string, MacroValue>;
  trace: TraceStep[];
  budget: { modelCalls: number; tokenTotal: number; externalToolCalls: number };
  progress: Array<{ message?: string; progress?: number; total?: number }>;
  checkCancelled: (where: string) => void | Promise<void>;
}
```
[CITED: Macro Requirements §6.3.7; VERIFIED: src/mcp/utils/response-formats.ts]

### Pattern 2: Walk-Up Env With Iterator `setLocal`
**What:** `Env.set` mutates the nearest owner scope if found; `Env.setLocal` writes only the current scope. [VERIFIED: macro-prototype/src/evaluator.ts]

**When to use:** Use `set` for assignments and `setLocal` only for the loop iterator binding. [CITED: Macro Requirements §6.3.1-§6.3.2]

**Example:**
```typescript
// Source: POC evaluator.ts: Env class, adapted to FlashQuery TypeScript style.
class Env {
  private readonly bindings = new Map<string, MacroValue>();

  constructor(private readonly parent: Env | null = null) {}

  set(name: string, value: MacroValue): void {
    const owner = this.findOwner(name);
    (owner ?? this).bindings.set(name, value);
  }

  setLocal(name: string, value: MacroValue): void {
    this.bindings.set(name, value);
  }
}
```
[VERIFIED: macro-prototype/src/evaluator.ts; CITED: Macro Requirements §6.3.1]

### Pattern 3: Runtime Errors Are Typed Control Signals
**What:** Use distinct classes for deliberate `exit`, deliberate `fail`, runtime failure, and cancellation, then map them to response helpers at one boundary. [VERIFIED: macro-prototype/src/evaluator.ts; VERIFIED: src/mcp/utils/response-formats.ts]

**When to use:** Builtin stubs for `exit`/`fail` should throw evaluator-owned errors so tests can verify no later statement runs. [CITED: Macro Requirements §6.3.6]

**Example:**
```typescript
// Source: Macro Requirements §6.3.6 + response-formats.ts.
if (error instanceof MacroFailError) {
  return jsonExpectedError({
    error: 'macro_aborted',
    message: error.message,
    details: { line: error.line },
  });
}
```
[CITED: Macro Requirements §6.3.6; VERIFIED: src/mcp/utils/response-formats.ts]

### Anti-Patterns to Avoid
- **Copying the POC singleton task registry:** It uses process-global current task state; production isolation requires context-owned state. [CITED: Macro Requirements §6.3.7; VERIFIED: macro-prototype/src/taskregistry.ts]
- **Implementing all standard builtins in Phase 132:** Full builtin implementation is Phase 133; this phase should use stubs and runtime contracts. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]
- **Letting raw thrown messages become test assertions:** Runtime errors should carry stable codes/details so tests do not depend on incidental text. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]
- **Treating any `error` field as fatal:** Tool envelopes with `isError: false` and `error` are expected values; only `isError: true` or thrown handlers halt. [CITED: Macro Requirements §6.3.6]
- **Mutating assignment target before RHS completes:** `x = expr` must evaluate `expr` once before `Env.set('x', value)`. [CITED: Macro Requirements §6.3.8]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing macro source inside evaluator tests | Ad hoc parser/string splitting | Existing `parseMacroSource` or direct AST builders | Phase 131 owns parser behavior and currently passes macro parser tests. [VERIFIED: src/macro/parser.ts; VERIFIED: local test run] |
| MCP response serialization | Custom JSON text envelopes | `macroResult`, `jsonExpectedError`, `jsonRuntimeError` | Phase 130 response helpers already encode expected vs runtime error semantics. [VERIFIED: src/mcp/utils/response-formats.ts] |
| Test harness | Custom runner | Vitest with existing unit config | Existing config covers `tests/unit/**/*.test.ts`; CLI filtering is supported. [VERIFIED: tests/config/vitest.unit.config.ts; CITED: Context7 /vitest-dev/vitest] |
| Real tool dispatch | Direct imports of MCP tool handlers | Injected `dispatchTool` stub | Real dispatch/permission pre-scan is Phase 135. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md] |
| Cross-invocation storage | Module-level maps/singletons | Fresh invocation context per run | Isolation is a core invariant. [CITED: Macro Requirements §6.3.7] |

**Key insight:** The evaluator should be real enough to execute ASTs end-to-end with stubbed calls, but every external dependency must be injectable so later phases can add builtins, shell verbs, dispatch, tasks, progress, and budgets without rewriting core control flow. [CITED: Macro Requirements §8.5-§8.8]

## Common Pitfalls

### Pitfall 1: POC Shape Drift
**What goes wrong:** The implementation copies POC field names such as `IfStmt.cond` or POC `Negation`, but Phase 131 uses `IfStmt.condition`, `UnaryExpr`, `WhileLoop`, `BinaryExpr`, `RangeExpr`, and `ToolExistsCall`. [VERIFIED: src/macro/types.ts; VERIFIED: macro-prototype/src/types.ts]
**Why it happens:** The POC is authoritative for semantics, not for exact production AST shape after Phase 131. [CITED: Macro Requirements §5.3-§5.4]
**How to avoid:** Start each plan with `src/macro/types.ts` and add exhaustive `switch` checks over current union types. [VERIFIED: src/macro/types.ts]
**Warning signs:** Type narrowing gaps, `default` branches swallowing unknown `kind`, or references to `cond` in new code. [VERIFIED: src/macro/types.ts]

### Pitfall 2: Tool Expected-Error Path Gets Treated As Runtime Failure
**What goes wrong:** A tool result like `{ isError: false, error: "not_found" }` halts execution instead of becoming a macro value. [CITED: Macro Requirements §6.3.6]
**Why it happens:** FlashQuery has both expected JSON error envelopes and runtime `isError: true` errors. [VERIFIED: src/mcp/utils/response-formats.ts]
**How to avoid:** Normalize injected tool results with a two-path rule: `isError: false` returns parsed payload; `isError: true` or throw raises `MacroRuntimeError`/`tool_call_failed`. [CITED: Macro Requirements §6.3.6]
**Warning signs:** T-U-088 fails or branches cannot inspect `.error`. [CITED: Macro Test Plan §4.3.5]

### Pitfall 3: Phase 133 Builtins Leak Into Phase 132
**What goes wrong:** Planner asks executor to build `input_var`, full arithmetic/data builtins, shell verbs, or task listing now. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]
**Why it happens:** POC evaluator and builtins are closely coupled. [VERIFIED: macro-prototype/src/evaluator.ts; VERIFIED: macro-prototype/src/builtins.ts]
**How to avoid:** Define `BuiltinFn` and use local test stubs for only evaluator proof. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]
**Warning signs:** New `src/macro/builtins.ts` contains the full v0 list or shell verb behavior. [CITED: Macro Requirements §8.6-§8.7]

### Pitfall 4: Isolation Tests Only Check Variables
**What goes wrong:** Scope is fresh but trace/progress/budget/task containers are reused. [CITED: Macro Requirements §6.3.7]
**Why it happens:** Variable isolation is easiest to observe; context object references can still be shared accidentally. [ASSUMED]
**How to avoid:** T-U-092..T-U-094 should assert distinct arrays/objects and no trace carryover across sequential runs. [CITED: Macro Test Plan §4.3.6]
**Warning signs:** Second run trace includes first run's log/exit/fail step. [CITED: Macro Test Plan §4.3.6]

### Pitfall 5: Boolean Operators Do Not Short-Circuit
**What goes wrong:** `$a && fail "x"` evaluates RHS when `$a` is falsy, or `$a || fail "x"` evaluates RHS when `$a` is truthy. [CITED: Macro Requirements §6.3.3]
**Why it happens:** Evaluating `BinaryExpr` left and right eagerly is simpler but violates normal boolean semantics implied by operators. [ASSUMED]
**How to avoid:** Implement `&&` and `||` as special cases that evaluate RHS only when needed; compare operators can evaluate both operands. [CITED: Macro Requirements §6.3.3]
**Warning signs:** Cancellation or fail stubs fire from skipped boolean branches. [ASSUMED]

## Code Examples

### Evaluate Assignment Without Early Mutation
```typescript
// Source: Macro Requirements §6.3.8.
case 'Binding': {
  const value = await evalExpr(stmt.value, env, context);
  env.set(stmt.name, cloneMacroValue(value));
  return;
}
```
[CITED: Macro Requirements §6.3.8]

### Implement Truthiness Once
```typescript
// Source: Macro Requirements §6.3.3 and POC evaluator.ts isTruthy.
export function isTruthy(value: MacroValue): boolean {
  if (value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}
```
[CITED: Macro Requirements §6.3.3; VERIFIED: macro-prototype/src/evaluator.ts]

### Tool Result Normalization
```typescript
// Source: Macro Requirements §6.3.6.
const result = await options.dispatchTool(call.server, call.tool, args, context);
if (result.isError === true) {
  throw new MacroRuntimeError('tool_call_failed', {
    server: call.server,
    tool: call.tool,
    line: call.line,
    underlying_error: parseToolPayload(result),
  });
}
return parseToolPayload(result);
```
[CITED: Macro Requirements §6.3.6; VERIFIED: src/mcp/utils/response-formats.ts]

## State of the Art

| Old / POC Approach | Current / Production Approach | When Changed | Impact |
|--------------------|-------------------------------|--------------|--------|
| POC task registry keeps terminal records and uses singleton current task. | Production evaluator context must be per invocation; later task registry removes terminal records immediately. | Spec frozen by 2026-05-13; requirements gathered 2026-05-14. | Do not copy `taskRegistry` global into Phase 132. [CITED: Macro Requirements §5.4; VERIFIED: macro-prototype/src/taskregistry.ts] |
| POC standalone runner prints `MacroFailError` to stderr. | Production maps `fail` to `{ error: "macro_aborted", ... }` with `isError: false`. | Spec §5.4 divergence. | Termination tests must assert canonical expected-error response. [CITED: Macro Requirements §5.4; VERIFIED: macro-prototype/src/run.ts] |
| POC parser lacks `while`, comparisons, boolean combinators, and production loop `do`. | Phase 131 parser has `WhileLoop`, `BinaryExpr`, `UnaryExpr`, `RangeExpr`, `ForLoop` requiring `do`. | Phase 131 complete before Phase 132. | Evaluator must implement the production AST, not the POC parser surface. [VERIFIED: src/macro/types.ts; VERIFIED: src/macro/parser.ts; VERIFIED: local test run] |
| POC `_exists()` is a special `ToolCall` with tool name starting `_`. | Phase 131 represents it as `ToolExistsCall`. | Phase 131 parser implementation. | Phase 132 should implement or stub `ToolExistsCall` separately; real broker live probe is Phase 135. [VERIFIED: src/macro/types.ts; CITED: Macro Requirements §5.4] |

**Deprecated/outdated:**
- POC singleton task state for production evaluator planning. [CITED: Macro Requirements §6.3.7]
- POC `fail` stderr mapping for production response envelopes. [CITED: Macro Requirements §5.4]
- POC AST field names where Phase 131 already differs. [VERIFIED: src/macro/types.ts]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Isolation bugs often hide in shared trace/progress/budget containers after variable scope tests pass. | Common Pitfalls | Tests may under-cover MACRO-EVAL-07. |
| A2 | Boolean operator short-circuiting is required by normal `&&`/`||` semantics even though the requirement emphasizes truthiness more than evaluation order. | Common Pitfalls | If full eager evaluation is intended, short-circuit-specific tests would need user/spec confirmation. |

## Open Questions (RESOLVED)

1. **RESOLVED: Phase 132 exposes `evaluateProgram` returning `ToolResult`.** [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; VERIFIED: .planning/phases/132-evaluator-core/132-01-PLAN.md; VERIFIED: .planning/phases/132-evaluator-core/132-03-PLAN.md]
   - What we know: Phase 132 must test termination envelopes and existing helpers are available. [CITED: Macro Requirements §6.3.6; VERIFIED: src/mcp/utils/response-formats.ts]
   - Resolution: Plans 132-01 and 132-03 require `export async function evaluateProgram(program: Program, options?: EvaluateProgramOptions): Promise<ToolResult>` and map fall-off, `exit`, `fail`, and runtime/tool failures through `macroResult`, `jsonExpectedError`, and `jsonRuntimeError`. This gives Phase 132 tests the exact envelope behavior required by REQ-024 while later MCP handler phases can call the same evaluator surface. [RESOLVED]

2. **RESOLVED: Runtime value and invocation types live in `src/macro/evaluator.ts` for Phase 132.** [VERIFIED: src/macro/types.ts; VERIFIED: .planning/phases/132-evaluator-core/132-01-PLAN.md]
   - What we know: Phase 131 intentionally excluded evaluator runtime state and `Value`; POC has `Value`, `BuiltinFn`, and `ToolRegistry` types. [VERIFIED: .planning/phases/131-lexer-parser-fence-extraction/131-01-SUMMARY.md; VERIFIED: macro-prototype/src/types.ts]
   - Resolution: Plan 132-01 requires concrete exports from `src/macro/evaluator.ts`, including `MacroValue`, `MacroBuiltin`, `MacroInvocationContext`, `createInvocationContext`, `evaluateProgram`, and `MacroRuntimeError`. Parser-only AST types remain in `src/macro/types.ts`; runtime types stay with the evaluator until later phases justify a split. [RESOLVED]

3. **RESOLVED: T-I-002 integration concurrency is deferred; Phase 132 covers isolation with unit tests and a unit concurrency smoke.** [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md; VERIFIED: .planning/phases/132-evaluator-core/132-04-PLAN.md]
   - What we know: Context says include `tests/integration/macro-concurrency.test.ts` only if the invocation boundary is meaningful in this phase. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]
   - Resolution: Plan 132-04 explicitly leaves `tests/integration/macro-concurrency.test.ts` out of Phase 132 because the public/session invocation boundary lands later. Phase 132 still proves MACRO-EVAL-07 through T-U-092 through T-U-094 plus a `Promise.all` unit-level concurrency smoke in `tests/unit/macro-isolation.test.ts`. [RESOLVED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript/Vitest execution | yes | v24.7.0 | Project minimum is >=20. [VERIFIED: environment audit; VERIFIED: package.json] |
| npm | Scripts and package metadata | yes | 11.5.1 | — [VERIFIED: environment audit] |
| Git | GSD docs commit | yes | Apple Git 2.50.1 | — [VERIFIED: environment audit] |
| Python 3 | Scenario skills only, not core unit work | yes | 3.12.3 | Skip scenario runner for Phase 132 unless needed. [VERIFIED: environment audit; VERIFIED: .agents/skills/flashquery-directed-run/SKILL.md] |
| `.env.test` | Integration/E2E tests | yes | present | Unit tests do not need it. [VERIFIED: environment audit; VERIFIED: AGENTS.md] |
| Docker | Preflight docker compose validation | not checked as required for this phase | — | `preflight:docker` script skips automatically if Docker is absent. [VERIFIED: package.json; VERIFIED: .agents/skills/pre-push/SKILL.md] |

**Missing dependencies with no fallback:** None for unit-level Phase 132 work. [VERIFIED: environment audit]

**Missing dependencies with fallback:** Docker is not required for the evaluator unit plan; preflight has a documented skip path. [VERIFIED: .agents/skills/pre-push/SKILL.md]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest package `^4.1.1`, local run reports v4.1.1; npm current 4.1.6. [VERIFIED: package.json; VERIFIED: local test run; VERIFIED: npm registry] |
| Config file | `tests/config/vitest.unit.config.ts` includes `tests/unit/**/*.test.ts`. [VERIFIED: tests/config/vitest.unit.config.ts] |
| Quick run command | `npm test -- --reporter=verbose macro-evaluator macro-scope macro-termination macro-isolation` [CITED: Macro Requirements §8.5; CITED: Context7 /vitest-dev/vitest] |
| Full suite command | `npm test` and before push `npm run preflight`. [VERIFIED: package.json; VERIFIED: .agents/skills/pre-push/SKILL.md] |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MACRO-EVAL-01 | Walk-up scope assignment. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --run tests/unit/macro-scope.test.ts` | no, Wave 0 |
| MACRO-EVAL-02 | Iterator local scope. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --run tests/unit/macro-scope.test.ts` | no, Wave 0 |
| MACRO-EVAL-03 | Truthiness rules. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --run tests/unit/macro-evaluator.test.ts` | no, Wave 0 |
| MACRO-EVAL-04 | String interpolation. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --run tests/unit/macro-evaluator.test.ts` | no, Wave 0 |
| MACRO-EVAL-05 | Field access. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --run tests/unit/macro-evaluator.test.ts` | no, Wave 0 |
| MACRO-EVAL-06 | Four-way termination. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --run tests/unit/macro-termination.test.ts` | no, Wave 0 |
| MACRO-EVAL-07 | Invocation isolation. [VERIFIED: .planning/REQUIREMENTS.md] | unit, optional integration | `npm test -- --run tests/unit/macro-isolation.test.ts` and optionally `npm run test:integration -- --run tests/integration/macro-concurrency.test.ts` | no, Wave 0 |
| MACRO-EVAL-08 | RHS evaluation order. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --run tests/unit/macro-evaluator.test.ts` | no, Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --reporter=verbose macro-evaluator macro-scope macro-termination macro-isolation` [CITED: Macro Requirements §8.5]
- **Per wave merge:** `npm test -- --reporter=verbose macro-parser macro-evaluator macro-scope macro-termination macro-isolation macro-envelopes macro-trace` [VERIFIED: existing tests; VERIFIED: local test run]
- **Phase gate:** `npm test` and `npm run build`; run `npm run preflight` before any push. [VERIFIED: package.json; VERIFIED: .agents/skills/pre-push/SKILL.md]

### Wave 0 Gaps
- [ ] `tests/unit/macro-scope.test.ts` covers T-U-067..T-U-072. [CITED: Macro Test Plan §4.3.1-§4.3.2]
- [ ] `tests/unit/macro-evaluator.test.ts` covers T-U-073..T-U-083 and T-U-095..T-U-096. [CITED: Macro Test Plan §4.3.3-§4.3.4, §4.3.7]
- [ ] `tests/unit/macro-termination.test.ts` covers T-U-084..T-U-091. [CITED: Macro Test Plan §4.3.5]
- [ ] `tests/unit/macro-isolation.test.ts` covers T-U-092..T-U-094 and may include a concurrent unit smoke. [CITED: Macro Test Plan §4.3.6]
- [ ] Optional `tests/integration/macro-concurrency.test.ts` only if meaningful without final `call_macro` handler; otherwise defer T-I-002 explicitly. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 132 does not authenticate users or sessions. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md] |
| V3 Session Management | no | MCP remains stateless; do not add session state. [VERIFIED: AGENTS.md] |
| V4 Access Control | partial later | Phase 132 only defines injectable dispatch; permission pre-scan/backstop is Phase 135. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md] |
| V5 Input Validation | yes | Consume typed AST from Phase 131; runtime validate field access, loops, call args, and termination arity. [VERIFIED: src/macro/types.ts; CITED: Macro Requirements §6.3] |
| V6 Cryptography | no | No cryptographic operation in evaluator core. [VERIFIED: .planning/phases/132-evaluator-core/132-CONTEXT.md] |

### Known Threat Patterns for Macro Evaluator

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| State leakage across macro invocations | Information Disclosure / Tampering | Fresh invocation context, no module-level env/task/trace state, isolation tests. [CITED: Macro Requirements §6.3.7] |
| Unexpected tool error hidden as expected value | Tampering / Repudiation | Honor `isError: true` as fatal and preserve structured `tool_call_failed` details. [CITED: Macro Requirements §6.3.6] |
| Prototype singleton copied into production | Elevation of Privilege / Information Disclosure | Explicitly ban POC `taskRegistry` singleton pattern in plans. [CITED: Macro Requirements §5.4] |
| Unbounded loops | Denial of Service | Include cancellation safe-point hooks now; real budget/time caps are later phase. [CITED: Macro Requirements §8.5; CITED: Macro Requirements §6.7.2] |
| Runtime type confusion on field access | Tampering | Deterministic runtime errors for `null`, primitives, list non-integer keys, and missing fields. [CITED: Macro Requirements §6.3.5] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/132-evaluator-core/132-CONTEXT.md` - user decisions, boundaries, canonical references, required tests. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - REQ-019 through REQ-026, POC divergences, Phase 3 evaluator scope. [CITED: local primary requirements doc]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - T-U-067 through T-U-096 and T-I-002. [CITED: local primary test plan]
- `src/macro/types.ts`, `src/macro/parser.ts`, `src/macro/errors.ts`, `src/mcp/utils/response-formats.ts` - current production AST, parser, errors, response helpers. [VERIFIED: codebase grep/read]
- `macro-prototype/src/evaluator.ts`, `macro-prototype/src/builtins.ts`, `macro-prototype/src/taskregistry.ts`, `macro-prototype/src/run.ts` - POC evaluator semantics and divergences. [VERIFIED: local POC read]
- `AGENTS.md` - project constraints and testing conventions. [VERIFIED: file read]
- `package.json`, `tests/config/vitest.unit.config.ts` - scripts, package versions, test configuration. [VERIFIED: file read]
- npm registry - package current versions and modification dates for Chevrotain, Vitest, TypeScript, tsx, MCP SDK, Zod, uuid. [VERIFIED: npm view]
- Context7 `/vitest-dev/vitest` - Vitest CLI reporter and filtering behavior. [CITED: Context7]

### Secondary (MEDIUM confidence)
- `.agents/skills/*/SKILL.md` - FlashQuery directed/integration/pre-push skill patterns. [VERIFIED: local skill read]
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` - phase placement and requirement mapping. [VERIFIED: file read]
- `.planning/phases/131-lexer-parser-fence-extraction/*` - previous phase AST/parser history and validation conventions. [VERIFIED: rg/read]

### Tertiary (LOW confidence)
- None. [VERIFIED: research log]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions verified from local `package.json`, npm registry, and local test run. [VERIFIED: package.json; VERIFIED: npm registry; VERIFIED: local test run]
- Architecture: HIGH - source-of-truth requirements and POC agree on evaluator core, with explicit divergences documented. [CITED: Macro Requirements §5.3-§5.4; VERIFIED: POC files]
- Pitfalls: HIGH for POC divergence and envelope handling; MEDIUM for shared-container and boolean short-circuit warnings because they are partly inferred from normal implementation failure modes. [VERIFIED: src/macro/types.ts; CITED: Macro Requirements §6.3; ASSUMED]

**Research date:** 2026-05-14 [VERIFIED: current date]
**Valid until:** 2026-06-13 for local architecture; re-check npm versions after 30 days. [ASSUMED]
