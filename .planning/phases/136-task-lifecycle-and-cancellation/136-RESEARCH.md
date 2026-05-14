# Phase 136: Task Lifecycle And Cancellation - Research

**Researched:** 2026-05-14  
**Domain:** FlashQuery macro engine task lifecycle, cooperative cancellation, session scoping, and concurrent invocation isolation  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Source Of Truth
- Downstream research, planning, implementation, and verification agents MUST read the two macro-language source documents listed in `<canonical_refs>` before making assumptions about this phase.
- If the product requirements/test plan and local code differ, the requirements/test plan define the intended behavior unless the local code has an explicit newer phase decision in `.planning/STATE.md` or prior phase summaries.
- The frozen macro POC is an authoritative behavior reference only where it agrees with the requirements document; documented divergences in Requirements §5.4 override the POC.

#### Task Registry Lifecycle
- Create `src/macro/task-registry.ts` with an instance-scoped `MacroTaskRegistry`, not a singleton.
- The registry must support `create`, `complete`, `fail`, `cancel`, `get`, and `list` operations.
- State names are exactly `working`, `completed`, `failed`, and `cancelled`.
- Every real `call_macro` execution registers a fresh UUID `task_id` in `working` state on start.
- Terminal transitions are `completed` for fall-off-end or `exit`, `failed` for `fail` or runtime error, and `cancelled` for cancellation observed at a safe point.
- Terminal records are removed immediately upon terminal transition. Do not add TTL, garbage collection timers, durable persistence, Supabase storage, or external MCP task methods.
- Dry-run behavior belongs to Phase 137; do not expand this phase into dry-run task registration work.

#### Cooperative Cancellation
- Cancellation is in-process only through `taskRegistry.cancel(taskId)`.
- Cancellation must be checked at every required safe point:
  - between top-level statements;
  - before each statement;
  - before each tool call after arg evaluation and before handler invocation;
  - between for-loop iterations before evaluating the next iterator binding;
  - between pipeline stages before piping output to the next stage;
  - inside `sleep`/`slow_op` between async chunks, using roughly 100 ms granularity.
- On observing cancellation, throw `MacroCancellationError` or an equivalent internal signal and map it to `{ error: "cancelled", message: "Macro cancelled", details: { task_id, at_safe_point } }` with `isError: false`.
- In-flight tool calls are not interrupted mid-call. If cancellation arrives during a tool call, the tool call completes and the next safe point returns the cancellation envelope.

#### Session Scoping And Isolation
- `task_id` returns the current invocation's UUID.
- `list_tasks` returns only currently-running task records visible to the caller's session.
- `taskRegistry.cancel(taskId)` refuses cross-session cancellation.
- Invocation state must be fully isolated: variables, trace, task entry, budget counters, progress stream, and cancellation flag do not leak across invocations or simulated sessions.
- `T-I-002` from the Macro Language Test Plan is in scope for this phase and must stress variable/trace/task/budget isolation across concurrent simulated sessions.

#### Testing Contract
- Unit coverage must include `tests/unit/macro-task-registry.test.ts`, `tests/unit/macro-cancellation.test.ts`, and `tests/unit/macro-session-scope.test.ts`.
- Builtin coverage for `task_id` and `list_tasks` from Test Plan §4.4.8 must be completed or extended if not already fully implemented by Phase 133.
- Integration coverage must include or extend `tests/integration/macro-concurrency.test.ts` for `T-I-002`.
- Directed scenario coverage must include cancellation behavior:
  - `M-01` / `tests/scenarios/directed/testcases/test_macro_cancellation.py`
  - `M-02` / `tests/scenarios/directed/testcases/test_macro_no_partial_side_effects_after_cancel.py`
- Preserve the exact verification command from Requirements §8.9:
  - `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope`

### the agent's Discretion
- The exact internal context shape may follow the existing `src/macro/evaluator.ts` and `src/macro/types.ts` implementation from prior phases, as long as task registry, cancellation, and session identity are per-invocation and testable.
- The exact session identity representation is implementation discretion, but it must be stable enough for unit and integration tests to simulate two sessions.
- The cancellation safe-point labels may be implementation-specific strings, but tests must assert the canonical classes of safe points and the envelope must include `details.at_safe_point`.

### Deferred Ideas (OUT OF SCOPE)
- External MCP Tasks protocol methods (`tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel`) remain out of scope.
- Durable task persistence, TTLs, terminal-record retention, and `input_required` state remain out of scope.
- Trace/progress/dry-run/budget envelope completion belongs to Phase 137 except where minimal scaffolding is needed to preserve isolation.
- MCP handler/source-ref end-to-end wiring belongs to Phase 138 unless needed only as a local test harness for lifecycle behavior.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-OBS-04 | In-process task registry transitions `working` to terminal states and removes terminal records immediately. [VERIFIED: .planning/REQUIREMENTS.md] | Implement `src/macro/task-registry.ts`; wire real runs through create/complete/fail/cancel terminal cleanup. [CITED: Macro Requirements §6.7.4, §8.9] |
| MACRO-OBS-05 | Cooperative cancellation checks every required safe point. [VERIFIED: .planning/REQUIREMENTS.md] | Extend existing evaluator hooks into a typed cancellation signal and move tool-call check to after arg evaluation. [VERIFIED: src/macro/evaluator.ts] [CITED: Macro Requirements §6.7.5] |
| MACRO-OBS-06 | Task visibility and cancellation are scoped to the active session. [VERIFIED: .planning/REQUIREMENTS.md] | Thread explicit `sessionId` through run context and make registry `list`/`cancel` session-filtered. [VERIFIED: src/macro/evaluator.ts] [CITED: Macro Requirements §6.7.6] |
| MACRO-INT-01 | Concurrent macro invocations across sessions do not leak state. [VERIFIED: .planning/REQUIREMENTS.md] | Add `tests/integration/macro-concurrency.test.ts` and register it in the explicit integration include list. [VERIFIED: tests/config/vitest.integration.config.ts] [CITED: Macro Test Plan §4.3.6] |
</phase_requirements>

## Summary

Phase 136 should be planned as a local macro-runtime phase, not an MCP Tasks protocol phase: the product spec requires an in-process, instance-scoped `MacroTaskRegistry`, immediate terminal-record deletion, no persistence, no TTL, and no external task MCP methods. [CITED: Macro Requirements §6.7.4] [VERIFIED: .planning/phases/136-task-lifecycle-and-cancellation/136-CONTEXT.md]

The current code already has most structural seams: `createInvocationContext` carries `taskId`, `sessionId`, per-invocation trace/progress/budget/cancel containers, and a `listTasks` hook; `evaluateProgram` has safe-point hooks for statements, loops, calls, pipelines, and `sleep`/`slow_op`; `runMacroSource` is the public/internal bridge added in Phase 135. The post-gap-fix Phase 135 code also threads `templateReverseMap`, `templateToolNames`, and `hardExcludedReasons` through `runMacroSource` into `evaluateProgram`; Phase 136 lifecycle edits must preserve that dispatch/hard-exclusion metadata while adding task registry/session fields. [VERIFIED: src/macro/evaluator.ts] [VERIFIED: src/macro/builtins.ts] [VERIFIED: src/mcp/tools/macro.ts] [VERIFIED: src/macro/registry.ts] [VERIFIED: .planning/phases/135-tool-registry-dispatch-permissions/135-VERIFICATION.md]

Primary recommendation: create `MacroTaskRegistry` and thread one registry instance through `registerMacroTools`/`runMacroSource` into `evaluateProgram`, then replace the current generic cancelled runtime error with `MacroCancellationError` mapped to the required non-error cancellation envelope. [CITED: Macro Requirements §8.9] [VERIFIED: src/mcp/tools/macro.ts] [VERIFIED: src/macro/evaluator.ts]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20, TypeScript strict mode, ESM modules, and existing npm scripts. [VERIFIED: AGENTS.md] [VERIFIED: package.json]
- Use `@modelcontextprotocol/sdk`; do not use nonexistent `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md] [VERIFIED: package.json]
- Keep FlashQuery CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- Use async/await and Zod for external input validation. [VERIFIED: AGENTS.md]
- MCP tool handlers must catch failures internally and return `{ content: [{ type: "text", text: "..." }] }`, with `isError: true` only for runtime failures; expected macro envelopes use normal ToolResult flow. [VERIFIED: AGENTS.md] [VERIFIED: src/mcp/utils/response-formats.ts]
- Unit tests live in `tests/unit/*.test.ts`; integration tests live in `tests/integration/*.test.ts` and require explicit config inclusion. [VERIFIED: AGENTS.md] [VERIFIED: tests/config/vitest.integration.config.ts]
- Do not implement server-side session state; MCP is stateless and project context is per-call. For this phase, session identity must be an explicit per-invocation value, not ambient server session state. [VERIFIED: AGENTS.md] [VERIFIED: .planning/phases/136-task-lifecycle-and-cancellation/136-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Task registry lifecycle | API / Backend | In-process memory | `call_macro` execution runs inside the MCP server process; registry is explicitly in-memory only. [CITED: Macro Requirements §6.7.4] |
| Cooperative cancellation | API / Backend | Builtin runtime | Safe points live in evaluator and async builtins, not client/browser code. [CITED: Macro Requirements §6.7.5] [VERIFIED: src/macro/evaluator.ts] |
| Session-scoped list/cancel | API / Backend | MCP transport context | Registry filtering is per invocation/session identity; no durable or external task surface exists. [CITED: Macro Requirements §6.7.6] |
| Concurrent isolation test | Test harness | API / Backend | Integration test should run concurrent `call_macro` invocations through current MCP/in-process helper boundary and assert isolated variables, traces, tasks, and counters. [CITED: Macro Test Plan §4.3.6] [VERIFIED: tests/integration/macro-tool-dispatch.test.ts] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | local `v24.7.0`; project requires `>=20` | Runtime, `crypto.randomUUID`, timers, AbortSignal-compatible platform APIs | Existing project runtime. [VERIFIED: node --version] [VERIFIED: package.json] |
| TypeScript | package `^6.0.2`; npm latest `6.0.3`, modified 2026-04-16 | Strict ESM source implementation | Existing project language. [VERIFIED: package.json] [VERIFIED: npm registry] |
| Vitest | package `^4.1.1`; local `4.1.1`; npm latest `4.1.6`, modified 2026-05-11 | Unit/integration tests and focused phase gate | Existing test framework; CLI filters match file path substrings. [VERIFIED: package.json] [VERIFIED: npx vitest --version] [CITED: Context7 /vitest-dev/vitest filtering docs] |
| `@modelcontextprotocol/sdk` | package `^1.27.1`; npm latest `1.29.0`, modified 2026-03-30 | MCP server/client and in-memory transport integration | Existing MCP stack. [VERIFIED: package.json] [VERIFIED: npm registry] |
| `zod` | package `^4.3.6`; npm latest `4.4.3`, modified 2026-05-04 | Existing MCP schema validation | Existing public schemas use Zod. [VERIFIED: package.json] [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tsx` | package `^4.21.0`; npm latest `4.22.0`, modified 2026-05-14 | Dev-time TS execution | Existing dev scripts only; not needed for registry code. [VERIFIED: package.json] [VERIFIED: npm registry] |
| Python 3 | local `3.12.3` | Directed scenario runner | Required for `tests/scenarios/directed/run_suite.py`. [VERIFIED: python3 --version] [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory `MacroTaskRegistry` | Supabase task table | Forbidden by phase context and REQ-049; would add persistence/cleanup semantics out of scope. [CITED: Macro Requirements §6.7.4] |
| Cooperative flag checks | Abort in-flight native tool calls | Spec says in-flight tool calls complete; next safe point returns cancellation envelope. [CITED: Macro Requirements §6.7.5] |
| Process singleton registry | Instance-scoped registry passed from `registerMacroTools` | Singleton is explicitly forbidden by phase context and would break test isolation. [VERIFIED: 136-CONTEXT.md] |

**Installation:**

```bash
# No new package installation is recommended for Phase 136.
```

## Architecture Patterns

### System Architecture Diagram

```text
MCP call_macro request
  -> registerMacroTools(server, config, { taskRegistry? })
  -> runMacroSource({ source, sessionId, registry, callerContext, catalog, broker })
  -> taskRegistry.create({ sessionId, taskId, sourcePreview }) -> working
  -> parse/preflight/permission pre-scan
  -> evaluateProgram(context)
       -> statement/loop/pipeline safe points call context.checkCancelled(where)
       -> sleep/slow_op chunk checks every ~100ms
       -> tool args evaluate
       -> safe point before handler invocation
       -> native/broker tool call runs to completion
       -> next safe point observes cancellation if requested during call
  -> terminal transition:
       success/exit -> complete -> delete record
       fail/runtime -> fail -> delete record
       cancellation -> cancel/observe -> delete record
  -> ToolResult envelope returned to caller
```

### Recommended Project Structure

```text
src/macro/
├── task-registry.ts      # MacroTaskRegistry, task record/state types, session-scoped list/cancel
├── evaluator.ts          # MacroCancellationError, registry-aware lifecycle, safe-point envelope mapping
├── builtins.ts           # task_id/list_tasks registry integration; sleep/slow_op cancellation chunks
└── types.ts              # Shared task/session types only if needed by registry/evaluator

tests/unit/
├── macro-task-registry.test.ts
├── macro-cancellation.test.ts
└── macro-session-scope.test.ts

tests/integration/
└── macro-concurrency.test.ts

tests/scenarios/directed/testcases/
├── test_macro_cancellation.py
└── test_macro_no_partial_side_effects_after_cancel.py
```

### Pattern 1: Instance-Scoped Registry Injection

**What:** `registerMacroTools` should create or accept a `MacroTaskRegistry` instance and pass it into `runMacroSource`; tests can inject their own registry. [VERIFIED: src/mcp/tools/macro.ts]  
**When to use:** All real-run `call_macro` executions in this phase. [CITED: Macro Requirements §8.9]  
**Example:**

```typescript
// Source: phase research recommendation from existing runMacroSource surface.
const taskRegistry = options.taskRegistry ?? new MacroTaskRegistry();
const { result } = await runMacroSource({
  source,
  sessionId,
  taskRegistry,
  config,
  catalog,
  broker,
  nativeDispatchContext,
});
```

### Pattern 2: Cancellation Signal, Not Runtime Error

**What:** Replace the current `MacroRuntimeError` path for cancellation with a dedicated `MacroCancellationError` carrying `taskId` and `atSafePoint`. [VERIFIED: src/macro/evaluator.ts] [CITED: Macro Requirements §6.7.5]  
**When to use:** Any safe point that sees a cancelled registry record or cancelled context flag. [CITED: Macro Requirements §6.7.5]  
**Example:**

```typescript
// Source: Macro Requirements §6.7.5 envelope contract.
throw new MacroCancellationError(context.taskId, atSafePoint);
```

### Pattern 3: Tool-Call Cancellation Check After Args

**What:** Evaluate tool args first, then check cancellation immediately before `dispatchMacroTool` or `dispatchTool`. [CITED: Macro Requirements §6.7.5]  
**Why:** Current code checks before arg evaluation; the spec requires "after arg evaluation, before handler invocation." [VERIFIED: src/macro/evaluator.ts] [CITED: Macro Requirements §6.7.5]  
**Example:**

```typescript
// Source: Macro Requirements §6.7.5.
const arg = await evalToolArg(call, env, context);
await context.checkCancelled(`before tool call ${call.server}.${call.tool}`);
return await dispatchMacroTool(...);
```

### Anti-Patterns to Avoid

- **Singleton `taskRegistry`:** The POC exports a singleton, but Phase 136 explicitly requires an instance-scoped production registry. [VERIFIED: macro-prototype/src/taskregistry.ts] [VERIFIED: 136-CONTEXT.md]
- **Terminal retention for debugging:** POC keeps terminal records for demo inspection; production must delete immediately. [CITED: Macro Requirements §5.4, §6.7.4] [VERIFIED: macro-prototype/src/taskregistry.ts]
- **Mid-call abort semantics:** Do not abort running native handlers for this phase; cancellation is observed at the next safe point after the handler returns. [CITED: Macro Requirements §6.7.5]
- **Using existing `M-01`/`M-02` directed IDs without resolving collision:** Current `DIRECTED_COVERAGE.md` already uses `M-01` and `M-02` for memory lifecycle. The planner must include a coverage-ID reconciliation step before adding macro cancellation rows. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md] [CITED: Macro Test Plan §7]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom ID generator | `crypto.randomUUID()` | Existing evaluator and POC use UUID generation; Node provides it. [VERIFIED: src/macro/evaluator.ts] [VERIFIED: macro-prototype/src/taskregistry.ts] |
| Test runner filtering | Custom test script | Vitest CLI filters and config include | Vitest supports filename filters and existing scripts already use them. [CITED: Context7 /vitest-dev/vitest filtering docs] [VERIFIED: package.json] |
| Scenario harness | New Python harness | Existing directed `TestContext`/`TestRun` and `run_suite.py` | Project-local scenario docs define the public-surface scenario pattern. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md] |
| Registry persistence | Supabase table / background cleanup | Plain in-memory `Map` inside `MacroTaskRegistry` | Persistence, TTL, and GC are out of scope. [CITED: Macro Requirements §6.7.4] |

**Key insight:** This phase is about wiring and semantics around the existing evaluator, not adding a new distributed task system. [VERIFIED: 136-CONTEXT.md] [CITED: Macro Requirements §8.9]

## Common Pitfalls

### Pitfall 1: Cancellation Becomes `tool_call_failed`

**What goes wrong:** The current `checkCancelled` throws `MacroRuntimeError` with `reason: "cancelled"`, and `evaluateProgram` maps `MacroRuntimeError` to a runtime error envelope. [VERIFIED: src/macro/evaluator.ts]  
**How to avoid:** Add `MacroCancellationError` and catch it before `MacroRuntimeError`, returning `{ error: "cancelled", message: "Macro cancelled", details: { task_id, at_safe_point } }` with `isError: false`. [CITED: Macro Requirements §6.7.5]

### Pitfall 2: Wrong Tool Safe-Point Location

**What goes wrong:** Checking cancellation before arg evaluation can skip deterministic arg errors and violates the required safe point. [VERIFIED: src/macro/evaluator.ts] [CITED: Macro Requirements §6.7.5]  
**How to avoid:** In `evalToolCall`, call `evalToolArg` first, then `checkCancelled`, then dispatch. [CITED: Macro Requirements §6.7.5]

### Pitfall 3: Deleting Too Early For In-Flight Cancellation

**What goes wrong:** If `cancel(taskId)` deletes the record immediately before the evaluator observes it, `checkCancelled` may not see cancellation. [ASSUMED]  
**How to avoid:** Separate "request cancellation" from "terminal cleanup": `cancel(taskId, sessionId)` should mark a working record as cancel requested/cancelled so safe points can observe it; deletion should happen when the running invocation handles `MacroCancellationError`. [CITED: Macro Requirements §6.7.5] [VERIFIED: macro-prototype/src/taskregistry.ts]

### Pitfall 4: Directed Coverage ID Collision

**What goes wrong:** Macro Test Plan proposes `M-01`/`M-02` for cancellation, but the current directed matrix already uses those IDs for memory lifecycle. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md] [CITED: Macro Test Plan §7]  
**How to avoid:** Use non-colliding macro lifecycle IDs `MLC-01`/`MLC-02` in the local directed coverage matrix and map them back to Test Plan T-S-001/T-S-002 in row text and scenario comments. Do not overwrite existing memory `M-01`/`M-02` rows. [ASSUMED]

### Pitfall 5: Forgetting Integration Config Include

**What goes wrong:** `tests/config/vitest.integration.config.ts` uses an explicit include list, so a new `tests/integration/macro-concurrency.test.ts` will not run unless added. [VERIFIED: tests/config/vitest.integration.config.ts]  
**How to avoid:** Include config modification in the same plan as creating the test. [VERIFIED: tests/config/vitest.integration.config.ts]

## Code Examples

### Registry Shape

```typescript
// Source: Macro Requirements §8.9 plus POC taskregistry state vocabulary.
export type MacroTaskStatus = 'working' | 'completed' | 'failed' | 'cancelled';

export interface MacroTaskRecord {
  task_id: string;
  status: MacroTaskStatus;
  session_id: string;
  created_at: string;
  updated_at: string;
  progress?: { message?: string; progress?: number; total?: number };
}
```

### Cancellation Envelope

```typescript
// Source: Macro Requirements §6.7.5.
return jsonExpectedError({
  error: 'cancelled',
  message: 'Macro cancelled',
  details: { task_id: error.taskId, at_safe_point: error.atSafePoint },
});
```

### Focused Test Command

```bash
# Source: Macro Requirements §8.9.
npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| POC singleton `taskRegistry` with retained terminal records | Production instance-scoped registry with immediate terminal deletion | Phase 136 scope, 2026-05-14 | Planner must not copy POC registry verbatim. [VERIFIED: 136-CONTEXT.md] [VERIFIED: macro-prototype/src/taskregistry.ts] |
| Unit-only concurrent smoke in Phase 132 | Integration `T-I-002` through meaningful public/session boundary | Phase 136 | Planner must create `tests/integration/macro-concurrency.test.ts`. [VERIFIED: .planning/phases/132-evaluator-core/132-04-SUMMARY.md] [CITED: Macro Test Plan §4.3.6] |
| Phase 135 injected dispatch/test seam | Public `call_macro` builds real native registry, template metadata, hard-exclusion reasons, and dispatch context | Phase 135 complete plus gap-fix commit `1288366` | Cancellation must respect in-flight native handler behavior and must not drop `templateReverseMap`, `templateToolNames`, or `hardExcludedReasons` plumbing. [VERIFIED: .planning/phases/135-tool-registry-dispatch-permissions/135-VERIFICATION.md] [VERIFIED: src/mcp/tools/macro.ts] |

**Deprecated/outdated:**
- POC terminal retention is outdated for production and must not be planned. [CITED: Macro Requirements §5.4] [VERIFIED: macro-prototype/src/taskregistry.ts]
- Public caller identity parameters are not allowed; public `call_macro` derives host identity internally. [VERIFIED: .planning/phases/135-tool-registry-dispatch-permissions/135-VERIFICATION.md] [VERIFIED: src/mcp/tools/macro.ts]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `cancel(taskId)` should mark cancellation for evaluator observation and deletion should happen when the invocation handles cancellation, not at cancel-request time. | Common Pitfalls | If wrong, registry may either delete too early or retain cancelled records contrary to REQ-049. |
| A2 | Directed macro cancellation IDs should use local non-colliding `MLC-01`/`MLC-02` rows while preserving the Test Plan T-S-001/T-S-002 mapping. | Common Pitfalls | If wrong, coverage matrix updates may collide with existing validated memory lifecycle rows. |

## Open Questions (RESOLVED)

1. **What exact session ID source should production use for stdio and in-memory tests? RESOLVED.**
   - What we know: public `call_macro` currently defaults to host caller context and does not expose caller identity. [VERIFIED: src/mcp/tools/macro.ts]
   - Resolution: production must not derive session identity from `host:${config.instance.id}` because that collapses all callers for the same FlashQuery instance. The implementation should use a trusted per-session source in this order: an MCP SDK/transport session identifier from the handler `extra` context if exposed by the installed SDK; otherwise a registration-scoped token generated inside `registerMacroTools`. This fallback is safe because `createMcpServer` is called once per HTTP client session and once for the stdio client process, so the fallback is per registration/client rather than config-instance global. [VERIFIED: src/mcp/server.ts] [ASSUMED]
   - Test strategy: trusted internal tests may pass explicit `sessionId` values to `runMacroSource` to simulate `session-a` and `session-b`; production public calls must use the per-session/per-registration provider above, never a request-schema caller parameter and never `config.instance.id` as the session identity. [CITED: Macro Requirements §6.7.6] [VERIFIED: 136-CONTEXT.md]

2. **How should the directed coverage ID collision be resolved? RESOLVED.**
   - What we know: Test Plan says macro cancellation uses `M-01` and `M-02`; current directed matrix already uses `M-01` and `M-02` for memory lifecycle. [CITED: Macro Test Plan §7] [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]
   - Resolution: preserve existing memory lifecycle `M-01`/`M-02` rows. Add Phase 136 macro lifecycle rows as `MLC-01` and `MLC-02`, and explicitly mention their mapping to Test Plan T-S-001/T-S-002 and the source Test Plan's proposed `M-01`/`M-02` labels. [ASSUMED]
   - Test strategy: the directed scenario files must use `COVERAGE = ["MLC-01"]` and `COVERAGE = ["MLC-02"]`; grep gates must prove no new macro scenario claims `M-01` or `M-02`. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build/unit/integration tests | yes | v24.7.0 | Project minimum is >=20. [VERIFIED: node --version] [VERIFIED: package.json] |
| npm | package scripts and npm version checks | yes | 11.5.1 | none needed. [VERIFIED: npm --version] |
| Vitest | unit/integration tests | yes | 4.1.1 local; 4.1.6 npm latest | use existing npm scripts. [VERIFIED: npx vitest --version] [VERIFIED: npm registry] |
| Python 3 | directed scenario tests | yes | 3.12.3 | none needed. [VERIFIED: python3 --version] |
| Git | scenario/test cleanup and commits | yes | 2.50.1 Apple Git-155 | none needed. [VERIFIED: git --version] |
| Supabase `.env.test` | integration tests with real handlers | available per Phase 135 validation | not applicable | integration tests skip if unavailable where configured. [VERIFIED: .planning/phases/135-tool-registry-dispatch-permissions/135-04-SUMMARY.md] [VERIFIED: AGENTS.md] |

**Missing dependencies with no fallback:**
- None found for research. [VERIFIED: environment probes]

**Missing dependencies with fallback:**
- None found for research. [VERIFIED: environment probes]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 local for unit/integration; Python directed runner for scenario tests. [VERIFIED: npx vitest --version] [VERIFIED: tests/scenarios/directed/run_suite.py] |
| Config file | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`. [VERIFIED: package.json] |
| Quick run command | `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope` [CITED: Macro Requirements §8.9] |
| Full suite command | `npm test && npm run test:integration && npm run build` [VERIFIED: package.json] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MACRO-OBS-04 | Registry lifecycle and terminal cleanup | unit | `npm test -- --reporter=verbose macro-task-registry` | no, Wave 0. [VERIFIED: rg macro-task-registry] |
| MACRO-OBS-05 | Safe-point cancellation envelope/no side effects | unit + directed | `npm test -- --reporter=verbose macro-cancellation`; `python3 tests/scenarios/directed/run_suite.py --managed test_macro_cancellation` | no, Wave 0. [VERIFIED: rg macro-cancellation] |
| MACRO-OBS-06 | Session-scoped list/cancel | unit | `npm test -- --reporter=verbose macro-session-scope` | no, Wave 0. [VERIFIED: rg macro-session] |
| MACRO-INT-01 | Concurrent session isolation | integration | `npm run test:integration -- --reporter=verbose macro-concurrency` | no, Wave 0. [VERIFIED: rg macro-concurrency] |

### Sampling Rate

- **Per task commit:** `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope` after unit work. [CITED: Macro Requirements §8.9]
- **Per wave merge:** add `npm run test:integration -- --reporter=verbose macro-concurrency` once the integration test exists. [CITED: Macro Test Plan §4.3.6]
- **Phase gate:** focused unit command, macro concurrency integration, directed cancellation scenario(s), and `npm run build`. [VERIFIED: package.json] [CITED: Macro Requirements §8.9]

### Wave 0 Gaps

- [ ] `src/macro/task-registry.ts` — production registry implementation. [CITED: Macro Requirements §8.9]
- [ ] `tests/unit/macro-task-registry.test.ts` — covers T-U-172 through T-U-177. [CITED: Macro Test Plan §4.7.1]
- [ ] `tests/unit/macro-cancellation.test.ts` — covers T-U-178 through T-U-184. [CITED: Macro Test Plan §4.7.2]
- [ ] `tests/unit/macro-session-scope.test.ts` — covers T-U-185 and T-U-186. [CITED: Macro Test Plan §4.7.3]
- [ ] `tests/integration/macro-concurrency.test.ts` plus include entry — covers T-I-002. [CITED: Macro Test Plan §4.3.6] [VERIFIED: tests/config/vitest.integration.config.ts]
- [ ] Directed scenario coverage ID reconciliation before creating `test_macro_cancellation.py` and `test_macro_no_partial_side_effects_after_cancel.py`. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md] [CITED: Macro Test Plan §4.7.3]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No new auth surface; no external task MCP methods. [CITED: Macro Requirements §6.7.4] |
| V3 Session Management | yes | Explicit per-invocation `sessionId` for registry visibility/cancellation; no browser/server-side session state. [VERIFIED: AGENTS.md] [CITED: Macro Requirements §6.7.6] |
| V4 Access Control | yes | Cross-session `list` filtering and cancel refusal. [CITED: Macro Requirements §6.7.6] |
| V5 Input Validation | yes | Preserve existing Zod public schema and parser/preflight validation; registry APIs validate state/session arguments internally. [VERIFIED: src/mcp/tools/macro.ts] |
| V6 Cryptography | yes | Use `crypto.randomUUID`; do not hand-roll IDs. [VERIFIED: src/macro/evaluator.ts] |

### Known Threat Patterns for Macro Lifecycle

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-session task enumeration | Information Disclosure | Registry `list(sessionId)` filters to matching session. [CITED: Macro Requirements §6.7.6] |
| Cross-session cancellation | Denial of Service | `cancel(taskId, sessionId)` refuses mismatched session. [CITED: Macro Requirements §6.7.6] |
| Cancellation after side-effect safe point | Tampering | Check after arg evaluation and before handler; assert no post-cancel side effects. [CITED: Macro Requirements §6.7.5] |
| Persistent task data leak | Information Disclosure | Immediate terminal deletion and no persistence. [CITED: Macro Requirements §6.7.4] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/136-task-lifecycle-and-cancellation/136-CONTEXT.md` - locked phase decisions, test contract, deferred scope. [VERIFIED]
- `.planning/ROADMAP.md` - phase goal and success criteria. [VERIFIED]
- `.planning/REQUIREMENTS.md` - MACRO-OBS-04/05/06 and MACRO-INT-01 status. [VERIFIED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - REQ-049, REQ-050, REQ-051, REQ-057, §8.9. [CITED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - T-I-002, T-U-124/125, T-U-172..186, T-S-001/T-S-002, coverage ID proposal. [CITED]
- `src/macro/evaluator.ts`, `src/macro/builtins.ts`, `src/mcp/tools/macro.ts`, `src/macro/registry.ts`, `src/macro/dispatcher.ts` - current implementation seams. [VERIFIED]
- `.planning/phases/135-tool-registry-dispatch-permissions/135-04-SUMMARY.md` and `135-VERIFICATION.md` - predecessor dispatch behavior and validation. [VERIFIED]
- `macro-prototype/src/taskregistry.ts`, `macro-prototype/src/evaluator.ts`, `macro-prototype/src/builtins.ts`, `macro-prototype/examples/07-cancellation.fqm` - POC behavior reference with documented divergences. [VERIFIED]

### Secondary (MEDIUM confidence)

- Context7 `/vitest-dev/vitest` docs - Vitest filtering and include config behavior. [CITED]
- npm registry version checks for `@modelcontextprotocol/sdk`, `zod`, `vitest`, `typescript`, and `tsx`. [VERIFIED]

### Tertiary (LOW confidence)

- None used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions checked in `package.json`, local commands, and npm registry. [VERIFIED]
- Architecture: HIGH - phase scope, product requirements, and current code all align on evaluator/registry wiring. [VERIFIED] [CITED]
- Pitfalls: HIGH for envelope/safe-point/config gaps from source inspection; MEDIUM for the exact registry cancel/delete timing recommendation because it is an implementation design inference. [VERIFIED] [ASSUMED]

**Research date:** 2026-05-14  
**Valid until:** 2026-06-13 for local architecture; recheck npm/tool versions before implementation if delayed more than 30 days.
