# Phase 137: Trace, Progress, Dry-Run, Budgets - Research

**Researched:** 2026-05-14 [VERIFIED: system date]  
**Domain:** FlashQuery macro engine observability, execution controls, MCP progress notifications, and Vitest/scenario coverage [VERIFIED: .planning/phases/137-trace-progress-dry-run-budgets/137-CONTEXT.md]  
**Confidence:** HIGH [VERIFIED: codebase grep + canonical macro requirements + Context7 MCP SDK docs + npm registry]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Locked Source Documents
- Downstream research, planning, execution, verification, and review agents MUST read the Macro Language Requirements document and Macro Language Test Plan before making Phase 137 decisions.
- Treat those documents as the canonical source for requirement details, test IDs, response envelope shape, warnings, dry-run behavior, and budget/progress semantics.
- If local `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md` is less specific, prefer the Macro Language Requirements and Test Plan unless the user explicitly overrides them.

### Phase 137 Scope
- Implement Spec REQ-047 trace modes: `full`, `summary`, and `none`, including the 2KB per-value cap and truncation sentinel behavior.
- Implement Spec REQ-048 progress modes: `full`, `milestones`, and `silent`, including throttling, no-token no-op behavior, and mode-aware explicit and auto-emitted progress.
- Implement REQ-039 ac3 ownership carried forward from Phase 133: auto-progress at for-loop iteration and model-call boundaries must route through the same progress emission path and respect the configured mode.
- Implement Spec REQ-053 dry-run: parse, run the full pre-flight chain, return `MacroDryRunResult`, and execute no side-effecting tools.
- Implement Spec REQ-056 warnings: carry truncation, throttle, and broker warnings through the canonical `warnings[]` array.
- Implement Spec REQ-060 budgets: `max_total_tokens`, `max_model_calls`, `max_external_tool_calls`, and `timeout_ms`, each halting with the required envelope.
- Implement Spec REQ-063 progress-token capture from the MCP request metadata and thread it into the engine context.

### Prior-Phase Reminders
- Phase 131's test-file relocation means Phase 137 should extend `tests/unit/macro-trace.test.ts` with `T-U-187` through `T-U-190` and `T-U-193` rather than introducing a competing trace test location.
- Phase 132 closed `exit a b` at parse time, but Phase 137 dry-run must still prove the complete pre-flight chain runs before any execution.
- Phase 132's `T-U-094` isolation labels must remain intact; Phase 137 budget and progress state must stay per-invocation and must not move to shared module state.
- Phase 136 provides the task registry and cancellation foundation. Phase 137 should build on it rather than redefining task lifecycle behavior.

### the agent's Discretion
- The exact internal module split is implementation discretion, but the requirements suggest focused modules such as `trace-builder`, `progress-emitter`, and `budget` if they fit the existing `src/macro/` shape.
- The plan may choose task boundaries, but every plan must include explicit test rows from the Test Plan and executable verification commands.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Phase 138 owns remaining `source_ref`, final handler/source-resolution integration, and broader scenario closure not required to satisfy Phase 137.
- External MCP Tasks protocol surface, durable task records, and direct macro-to-macro nesting remain out of scope for macro v0.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-OBS-02 | Trace verbosity modes and per-value truncation are enforced. [VERIFIED: .planning/REQUIREMENTS.md] | Use a mode-aware `TraceBuilder` at write time, not response filtering, and extend `tests/unit/macro-trace.test.ts` with T-U-187..T-U-190 and T-U-193. [CITED: FlashQuery Macro Language Requirements.md §6.7.2][VERIFIED: tests/unit/macro-trace.test.ts] |
| MACRO-OBS-03 | Progress verbosity modes are enforced and degrade cleanly without a progress token, including REQ-039 ac3 auto-emitted progress. [VERIFIED: .planning/REQUIREMENTS.md] | Use a `ProgressEmitter` that gates explicit `status` and auto progress by mode/token and throttles at 100 ms. [CITED: FlashQuery Macro Language Requirements.md §6.7.3][CITED: Context7 /modelcontextprotocol/typescript-sdk docs] |
| MACRO-RESP-05 | `warnings[]` follows the shared XC-16 response convention. [VERIFIED: .planning/REQUIREMENTS.md] | Reuse existing `WarningCode` and `withWarnings`; populate warning codes only on success payloads. [VERIFIED: src/mcp/utils/response-formats.ts] |
| MACRO-INT-04 | Budget enforcement covers total tokens, model calls, external tool calls, and timeout. [VERIFIED: .planning/REQUIREMENTS.md] | Add per-invocation budget limit state plus pre-dispatch and post-dispatch checks at tool/model call boundaries and safe points. [CITED: FlashQuery Macro Language Requirements.md §6.9.4][VERIFIED: src/macro/evaluator.ts] |
| MACRO-INT-07 | `_meta.progressToken` is captured and used for progress emission. [VERIFIED: .planning/REQUIREMENTS.md] | Extract `ctx.mcpReq._meta?.progressToken` / SDK-equivalent from the tool handler `extra` object and call `ctx.mcpReq.notify({ method: 'notifications/progress', ... })` when present. [CITED: Context7 /modelcontextprotocol/typescript-sdk docs] |
</phase_requirements>

## Summary

Phase 137 should be planned as an engine-internal completion pass around the already-shipped macro parser, evaluator, registry, task registry, and inline `call_macro` handler. [VERIFIED: src/macro/evaluator.ts][VERIFIED: src/mcp/tools/macro.ts][VERIFIED: .planning/phases/136-task-lifecycle-and-cancellation/136-04-SUMMARY.md] Current code already has `MacroInvocationContext.trace`, `progress`, `budget`, `taskId`, `sessionId`, cancellation checking, and success payload fields, but these are raw mutable arrays/counters with no trace mode, no progress mode, no runtime budget limits, no warnings propagation, and no dry-run execution branch. [VERIFIED: src/macro/evaluator.ts:74][VERIFIED: src/macro/evaluator.ts:903][VERIFIED: src/mcp/tools/macro.ts:22]

The canonical macro spec says Phase 137 corresponds to Spec Phase 8 and owns REQ-047, REQ-048, REQ-053, REQ-056, REQ-060, and REQ-063. [CITED: FlashQuery Macro Language Requirements.md §8.10] The Test Plan pins required unit rows T-U-187..T-U-198, T-U-199..T-U-204 where applicable, T-U-209..T-U-215, and T-U-233..T-U-234, plus directed scenarios T-S-016..T-S-018. [CITED: FlashQuery Macro Language Test Plan.md §4.8][CITED: FlashQuery Macro Language Test Plan.md §4.10.3][CITED: FlashQuery Macro Language Test Plan.md §4.10.5]

**Primary recommendation:** Implement Phase 137 in four waves: (1) trace builder + warnings, (2) progress emitter + progressToken capture + auto boundaries, (3) dry-run + budget tracker, and (4) scenario/matrix/final regression gates. [VERIFIED: canonical test dependencies + current code inspection]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trace mode shaping and truncation | API / Backend | MCP response wrapper | Trace steps are produced during macro evaluation and returned in the `MacroExecutionResult` payload. [VERIFIED: src/macro/evaluator.ts:916][CITED: FlashQuery Macro Language Requirements.md §6.7.2] |
| Live progress notifications | API / Backend | MCP transport | Macro execution decides emission boundaries; the MCP SDK sends `notifications/progress` via request context when a token exists. [CITED: Context7 /modelcontextprotocol/typescript-sdk docs][CITED: FlashQuery Macro Language Requirements.md §6.7.3] |
| Dry-run response | API / Backend | MCP tool handler | Dry-run must parse and run pre-flight checks before selecting `MacroDryRunResult`, and must not register a live task. [CITED: FlashQuery Macro Language Requirements.md §6.8.2][VERIFIED: src/mcp/tools/macro.ts:92] |
| Budget enforcement | API / Backend | Native tool dispatch wrappers | Budget counters are per macro invocation and are checked before/after tool/model calls plus timeout safe points. [CITED: FlashQuery Macro Language Requirements.md §6.9.4][VERIFIED: src/macro/evaluator.ts:767] |
| Warning propagation | API / Backend | Shared response utilities | `warnings[]` belongs on macro success payloads using the existing `WarningCode` convention. [VERIFIED: src/mcp/utils/response-formats.ts:137][CITED: FlashQuery Macro Language Requirements.md §6.8.5] |

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS, enforced by `package.json` `engines`. [VERIFIED: AGENTS.md][VERIFIED: package.json]
- TypeScript is strict-mode ESM; do not introduce CommonJS `require`. [VERIFIED: AGENTS.md][VERIFIED: package.json]
- MCP transport is stdio-spawned server process behavior; do not add a web UI. [VERIFIED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md][VERIFIED: package.json]
- Use Zod for external input validation. [VERIFIED: AGENTS.md][VERIFIED: src/mcp/tools/macro.ts:22]
- MCP tool handlers must catch/convert failures and return MCP text content; runtime failures use `isError: true`. [VERIFIED: AGENTS.md][VERIFIED: src/mcp/utils/response-formats.ts:166]
- Unit tests live under `tests/unit/*.test.ts`, integration tests under `tests/integration/*.test.ts`, E2E under `tests/e2e/*.test.ts`, and directed scenarios under `tests/scenarios/directed/`. [VERIFIED: AGENTS.md][VERIFIED: tests/config/vitest.unit.config.ts]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]
- Files are `kebab-case.ts`, types/interfaces are `PascalCase`, functions/variables are `camelCase`, constants are `SCREAMING_SNAKE_CASE`, and internal Supabase tables use `fqc_` prefix. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | >=20 required; local v24.7.0 | Runtime for TypeScript/ESM FlashQuery server and tests. [VERIFIED: package.json][VERIFIED: `node --version`] | Existing project runtime and AGENTS prerequisite. [VERIFIED: AGENTS.md] |
| TypeScript | project range `^6.0.2` | Type checking for macro engine modules. [VERIFIED: package.json] | Existing project language and strict ESM stack. [VERIFIED: AGENTS.md] |
| @modelcontextprotocol/sdk | project range `^1.27.1`; registry latest 1.29.0, modified 2026-03-30 | MCP server registration and request context for progress notifications. [VERIFIED: package.json][VERIFIED: npm registry][CITED: Context7 /modelcontextprotocol/typescript-sdk docs] | Existing project SDK and official TypeScript SDK path for `ctx.mcpReq.notify`. [VERIFIED: AGENTS.md][CITED: Context7 /modelcontextprotocol/typescript-sdk docs] |
| zod | project range `^4.3.6`; registry latest 4.4.3, modified 2026-05-04 | `call_macro` input validation and native tool argument validation. [VERIFIED: package.json][VERIFIED: npm registry][VERIFIED: src/mcp/tools/macro.ts:22] | Existing project convention for external input validation. [VERIFIED: AGENTS.md] |
| Vitest | project range `^4.1.1`; registry latest 4.1.6, modified 2026-05-11 | Unit/integration test runner. [VERIFIED: package.json][VERIFIED: npm registry] | Existing unit/integration test framework and config. [VERIFIED: tests/config/vitest.unit.config.ts][VERIFIED: tests/config/vitest.integration.config.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | project range `^4.21.0`; registry latest 4.22.0, modified 2026-05-14 | Run TypeScript helpers and dev server without a build. [VERIFIED: package.json][VERIFIED: npm registry] | Use for any test-only macro harness scripts similar to Phase 136. [VERIFIED: .planning/phases/136-task-lifecycle-and-cancellation/136-04-SUMMARY.md] |
| tsup | project range `^8.5.1`; registry latest 8.5.1, modified 2025-11-12 | ESM production build and declarations. [VERIFIED: package.json][VERIFIED: npm registry] | Run `npm run build` as a final gate. [VERIFIED: package.json] |
| Python 3 | local 3.12.3 | Directed scenario runner runtime. [VERIFIED: `python3 --version`] | Use for Phase 137 directed scenarios T-S-016..T-S-018 if planned in this phase. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md][CITED: FlashQuery Macro Language Test Plan.md §4.10.5] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New tracing library | Existing `TraceStep` + `TraceBuilder` module | The spec already defines the trace shape and the project already exports `TraceStep`; adding a tracing dependency would increase surface area without solving an external integration problem. [VERIFIED: src/mcp/utils/response-formats.ts:127][CITED: FlashQuery Macro Language Requirements.md §6.7.1] |
| External rate limiter package | Small per-invocation timestamp throttle in `ProgressEmitter` | The requirement is a single 100 ms per-invocation emission throttle; a dependency would be disproportionate. [CITED: FlashQuery Macro Language Requirements.md §6.7.3] |
| Durable task/progress store | Existing in-process `MacroTaskRegistry` and per-invocation context | Durable task records and external Tasks protocol are explicitly out of v0 scope. [VERIFIED: 137-CONTEXT.md][VERIFIED: src/macro/task-registry.ts] |

**Installation:**
```bash
# No new npm packages are recommended for Phase 137. [VERIFIED: package.json + requirements]
```

**Version verification:**
```bash
npm view @modelcontextprotocol/sdk version time.modified  # 1.29.0, 2026-03-30 [VERIFIED: npm registry]
npm view vitest version time.modified                    # 4.1.6, 2026-05-11 [VERIFIED: npm registry]
npm view zod version time.modified                       # 4.4.3, 2026-05-04 [VERIFIED: npm registry]
npm view tsx version time.modified                       # 4.22.0, 2026-05-14 [VERIFIED: npm registry]
npm view tsup version time.modified                      # 8.5.1, 2025-11-12 [VERIFIED: npm registry]
```

## Architecture Patterns

### System Architecture Diagram

```text
MCP client call_macro request
  |
  | params: source/input_vars/budget/dry_run/trace/progress
  | _meta.progressToken
  v
src/mcp/tools/macro.ts registerTool handler
  |
  +--> validate exactly one source now; source_ref remains Phase 138
  |
  +--> build native/broker tool registry and template metadata
  |
  +--> parse inline source
        |
        +--> parse error -> jsonExpectedError(parse_error)
        |
        +--> dry_run=true
        |     |
        |     +--> preScanForbiddenShellFlags -> preflightProgram -> collect/validate input vars
        |     +--> preScanToolReferences
        |     +--> collect tool/server refs
        |     +--> MacroDryRunResult, no task registry registration
        |
        +--> dry_run=false
              |
              +--> taskRegistry.create working
              +--> createInvocationContext with TraceBuilder, ProgressEmitter, BudgetTracker, warnings
              +--> evaluator execution
                    |
                    +--> statements/loops/pipelines -> cancellation + timeout checks
                    +--> status/auto-progress -> ProgressEmitter -> ctx.mcpReq.notify if token
                    +--> tool/model dispatch -> budget pre/post checks + trace step
                    |
                    +--> success/fail/expected/runtime/cancel/timeout/budget envelope
              +--> taskRegistry terminal transition and removal
```

This data flow matches current handler/evaluator boundaries and adds mode-aware helpers at the points where current code directly mutates `trace`, `progress`, and `budget`. [VERIFIED: src/mcp/tools/macro.ts:67][VERIFIED: src/macro/evaluator.ts:228][VERIFIED: src/macro/evaluator.ts:903]

### Recommended Project Structure

```text
src/macro/
├── trace-builder.ts       # mode-aware TraceStep write path, 2KB cap, truncation warnings [CITED: Requirements §8.10]
├── progress-emitter.ts    # progress modes, 100 ms throttle, token-aware notifications [CITED: Requirements §8.10]
├── budget.ts              # budget limits, counters, timeout checks, canonical error builders [CITED: Requirements §8.10]
├── dry-run.ts             # full pre-flight chain + MacroDryRunResult builder [CITED: Requirements §8.10]
├── evaluator.ts           # call helper modules at execution boundaries [VERIFIED: src/macro/evaluator.ts]
└── types.ts               # shared option/value types if needed [VERIFIED: src/macro/types.ts]
```

### Pattern 1: Mode-Aware Trace Builder

**What:** Write trace steps through a helper that applies `full`/`summary`/`none` at append time and emits `trace_value_truncated` when serialized `args` or `result` exceed 2KB. [CITED: FlashQuery Macro Language Requirements.md §6.7.2]

**When to use:** Every current `pushTrace` call and every new auto-progress trace insertion should call the builder instead of mutating `context.trace` directly. [VERIFIED: src/macro/evaluator.ts:916][VERIFIED: src/macro/builtins.ts:171]

**Example:**
```typescript
// Source: FlashQuery Macro Language Requirements.md §6.7.2 + current pushTrace at src/macro/evaluator.ts:916.
trace.add({
  kind: 'tool_call',
  name: 'fq.search',
  args,
  result,
  elapsed_ms,
});
```

### Pattern 2: Progress Emitter Owns Both Explicit And Auto Progress

**What:** Funnel explicit `status` calls and auto progress through one emitter that knows `progress` mode, `progressToken`, throttle timing, and warning collection. [CITED: FlashQuery Macro Language Requirements.md §6.5.6][CITED: FlashQuery Macro Language Requirements.md §6.7.3]

**When to use:** `status` builtin, for-loop iteration start, model-call start/finish, and tool-call start should all call this same emitter. [CITED: FlashQuery Macro Language Requirements.md §6.7.3][VERIFIED: src/macro/evaluator.ts:767]

**Example:**
```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk docs.
await ctx.mcpReq.notify({
  method: 'notifications/progress',
  params: { progressToken, progress, total, message },
});
```

### Pattern 3: Dry-Run Is A Pre-Flight Pipeline, Not A Partial Evaluation

**What:** Dry-run should parse and run the same static pre-flight checks as real execution, then return collected contracts/references without `execBlock`. [CITED: FlashQuery Macro Language Requirements.md §6.8.2]

**When to use:** In `runMacroSource`, branch after parse and registry build but before `taskRegistry.create`. [VERIFIED: src/mcp/tools/macro.ts:79][VERIFIED: src/mcp/tools/macro.ts:92]

**Example:**
```typescript
// Source: FlashQuery Macro Language Requirements.md §6.8.2 + current preflight chain in src/macro/evaluator.ts:286.
preScanForbiddenShellFlags(program);
preflightProgram(program);
const inputVarContract = collectInputVarContract(program);
validateInputVars(inputVarContract, inputVars);
const permissionError = preScanToolReferences(...);
if (permissionError) return permissionError;
return macroResult(buildDryRunPayload(...));
```

### Pattern 4: Budget Tracker Checks Before Dispatch And After Model Results

**What:** Enforce `max_model_calls` and `max_external_tool_calls` before dispatch; enforce `max_total_tokens` after a `fq.call_model` result because token usage is only known after the call; enforce `timeout_ms` at safe points. [CITED: FlashQuery Macro Language Requirements.md §6.9.4]

**When to use:** Around `evalToolCall`, where current code evaluates args, checks cancellation, dispatches, then increments `external_tool_calls`. [VERIFIED: src/macro/evaluator.ts:767]

**Example:**
```typescript
// Source: FlashQuery Macro Language Requirements.md §6.9.4.
budget.beforeToolCall({ server, tool });
const result = await dispatch();
budget.afterToolCall({ server, tool, result });
budget.checkTimeout('after tool call');
```

### Anti-Patterns to Avoid

- **Collect-then-filter trace:** The spec requires the builder to consult mode as it writes each step so `summary` and `none` stay memory bounded. [CITED: FlashQuery Macro Language Requirements.md §6.7.2]
- **Module-level progress/budget state:** T-U-094 pins trace, budget, progress, cancellation, and task IDs as per-invocation objects. [VERIFIED: tests/unit/macro-isolation.test.ts:37][CITED: Gap Analysis Phase 137 reminders]
- **Registering dry-run tasks:** Dry-run task IDs are generated but not registered in the task registry. [CITED: FlashQuery Macro Language Requirements.md §6.8.2]
- **Treating missing progressToken as an error:** The spec and SDK docs both require no-op behavior when no token exists. [CITED: FlashQuery Macro Language Requirements.md §6.7.3][CITED: Context7 /modelcontextprotocol/typescript-sdk docs]
- **Planning public task/cancel APIs:** Phase 136 deliberately kept cancellation in-process and Phase 137 must build on it, not define external Tasks protocol. [VERIFIED: 136-04-SUMMARY.md][VERIFIED: 137-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP progress notification transport | Custom JSON-RPC transport writes | `ctx.mcpReq.notify({ method: 'notifications/progress', params })` from the MCP SDK request context. [CITED: Context7 /modelcontextprotocol/typescript-sdk docs] | The SDK already exposes token-aware notification helpers. [CITED: Context7 /modelcontextprotocol/typescript-sdk docs] |
| Response wrapper format | New macro-specific MCP result wrapper | Existing `macroResult`, `jsonExpectedError`, `jsonRuntimeError`, and `withWarnings`. [VERIFIED: src/mcp/utils/response-formats.ts:158] | REQ-055 requires additive integration with existing response helpers. [CITED: FlashQuery Macro Language Requirements.md §6.8.4] |
| Tool reference collection for dry-run | New AST walk | Existing `collectToolReferences` from permission pre-scan. [VERIFIED: src/macro/permission-prescan.ts] | The existing walker already covers nested statements and expressions. [VERIFIED: src/macro/permission-prescan.ts] |
| Task lifecycle | New task store or durable records | Existing `MacroTaskRegistry`. [VERIFIED: src/macro/task-registry.ts] | Phase 136 validated lifecycle, session scoping, cancellation, and terminal cleanup. [VERIFIED: 136-04-SUMMARY.md] |
| Parser/pre-flight validation | Partial duplicate validators in dry-run | Existing parser, forbidden flag scan, `preflightProgram`, input-var contract, and permission pre-scan. [VERIFIED: src/macro/evaluator.ts:286] | Dry-run must run the complete pre-flight chain before execution. [CITED: Gap Analysis Phase 137 reminders] |

**Key insight:** Phase 137 is not a new subsystem; it is the missing policy layer around already-existing macro execution state. [VERIFIED: src/macro/evaluator.ts][CITED: FlashQuery Macro Language Requirements.md §8.10]

## Common Pitfalls

### Pitfall 1: Trace Filtering At Response Time

**What goes wrong:** `trace: "summary"` or `trace: "none"` still accumulates full args/results in memory, then strips them from the payload. [CITED: FlashQuery Macro Language Requirements.md §6.7.2]

**Why it happens:** Current `pushTrace` appends raw steps directly to `context.trace`. [VERIFIED: src/macro/evaluator.ts:916]

**How to avoid:** Replace direct trace mutation with `TraceBuilder.add()` and make `buildSuccessPayload` ask the builder for an optional trace. [CITED: FlashQuery Macro Language Requirements.md §6.7.2]

**Warning signs:** Tests for T-U-193 fail, or `trace: "none"` still creates large internal trace arrays. [CITED: FlashQuery Macro Language Test Plan.md §4.8.1]

### Pitfall 2: Explicit `status` Bypasses Progress Modes

**What goes wrong:** `progress: "silent"` suppresses auto progress but still emits explicit `status` notifications. [CITED: FlashQuery Macro Language Requirements.md §6.7.3]

**Why it happens:** Current `status` builtin directly pushes to `context.progress`, `pushTrace`, and `progressSink`. [VERIFIED: src/macro/builtins.ts:164]

**How to avoid:** Move explicit `status` through the same `ProgressEmitter` as auto-emissions. [CITED: FlashQuery Macro Language Requirements.md §6.5.6]

**Warning signs:** T-U-196 or T-U-198 fail. [CITED: FlashQuery Macro Language Test Plan.md §4.8.2]

### Pitfall 3: Dry-Run Accidentally Creates Tasks Or Side Effects

**What goes wrong:** `dry_run: true` registers a live task or executes `fq.write_document` after producing static metadata. [CITED: FlashQuery Macro Language Requirements.md §6.8.2]

**Why it happens:** Current `runMacroSource` creates the task immediately after parse and before calling `evaluateProgram`. [VERIFIED: src/mcp/tools/macro.ts:92]

**How to avoid:** Branch dry-run before `taskRegistry.create` and before `execBlock`; reuse only parse/pre-flight/reference collectors. [CITED: FlashQuery Macro Language Requirements.md §6.8.2][VERIFIED: src/mcp/tools/macro.ts:92]

**Warning signs:** T-U-202 fails, or directed dry-run scenario leaves a vault document behind. [CITED: FlashQuery Macro Language Test Plan.md §4.8.3][CITED: FlashQuery Macro Language Test Plan.md §4.10.5]

### Pitfall 4: Budget Counters Misclassify Native `fq.call_model`

**What goes wrong:** Every native `fq.*` call increments only `external_tool_calls`, so model budgets never fire or call_model double-counts. [VERIFIED: src/macro/evaluator.ts:786][CITED: FlashQuery Macro Language Requirements.md §6.9.4]

**Why it happens:** Current code increments `external_tool_calls` after dispatch and has no distinction for `fq.call_model`. [VERIFIED: src/macro/evaluator.ts:786]

**How to avoid:** Treat `server === "fq" && tool === "call_model"` as a model call for `model_calls` and `token_total`, while brokered non-fq tools feed `external_tool_calls`. [CITED: FlashQuery Macro Language Requirements.md §6.9.4]

**Warning signs:** T-U-212 or T-U-213 fail, or `external_tool_calls` includes `fq.call_model`. [CITED: FlashQuery Macro Language Test Plan.md §4.8.5]

### Pitfall 5: Directed Coverage ID Collisions

**What goes wrong:** The Test Plan's proposed `M-16`, `M-17`, and `M-18` IDs collide with the current directed matrix naming history, where macro rows use `ML-*` and `ML-16`/`ML-17` are already occupied. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]

**Why it happens:** Earlier macro phases adjusted IDs to avoid memory-lifecycle `M-*` collisions. [VERIFIED: 136-04-SUMMARY.md][VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]

**How to avoid:** Add non-colliding Phase 137 macro coverage rows, likely `ML-18`, `ML-19`, and `ML-20`, while preserving Test Plan labels T-S-016, T-S-017, and T-S-018 in row descriptions and test docstrings. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md][CITED: FlashQuery Macro Language Test Plan.md §4.10.5]

**Warning signs:** A plan tries to add `M-16` or reuses `ML-16`/`ML-17`. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]

## Code Examples

Verified patterns from current code and official sources:

### Capturing And Emitting MCP Progress

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk docs.
const progressToken = ctx.mcpReq._meta?.progressToken;
if (progressToken !== undefined) {
  await ctx.mcpReq.notify({
    method: 'notifications/progress',
    params: {
      progressToken,
      progress: 1,
      total: 3,
      message: 'working',
    },
  });
}
```

### Current Pre-Flight Chain To Reuse For Dry-Run

```typescript
// Source: src/macro/evaluator.ts:286 and src/macro/preflight.ts.
preScanForbiddenShellFlags(program);
preflightProgram(program);
const inputVarContract = collectInputVarContract(program);
validateInputVars(inputVarContract, context.inputVars);
const permissionError = preScanToolReferences({
  program,
  registry: context.toolRegistry,
  allowlist: context.allowedToolNames,
});
```

### Success Payload Must Become Conditional

```typescript
// Source: current src/macro/evaluator.ts:903; adjust in Phase 137.
return {
  task_id: context.taskId,
  result,
  ...(tracePayload === undefined ? {} : { trace: tracePayload }),
  ...(warnings.length === 0 ? {} : { warnings }),
  ...budget.summary(),
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct `context.trace.push(...)` | Mode-aware trace builder at write time | Required by REQ-047 for Phase 137 [CITED: FlashQuery Macro Language Requirements.md §6.7.2] | Planner should create a foundational trace module before modifying evaluator call sites. [VERIFIED: src/macro/evaluator.ts:916] |
| Direct `progressSink` from `status` | MCP SDK `ctx.mcpReq.notify` using `_meta.progressToken` plus mode/throttle policy | MCP SDK docs current in Context7; Phase 137 owns REQ-063 [CITED: Context7 /modelcontextprotocol/typescript-sdk docs][CITED: FlashQuery Macro Language Requirements.md §6.9.7] | Handler must pass notification capability into engine context; tests can inject a fake emitter. [VERIFIED: src/mcp/tools/macro.ts:183] |
| Budget counters only as output counters | Per-invocation limit tracker with pre/post checks | Required by REQ-060 for Phase 137 [CITED: FlashQuery Macro Language Requirements.md §6.9.4] | Planner should distinguish model calls from external broker/native tool calls. [VERIFIED: src/macro/evaluator.ts:786] |
| Dry-run schema accepted but ignored | Full dry-run path returning `MacroDryRunResult` | `dry_run` currently marked input-schema-only in handler comments. [VERIFIED: src/mcp/tools/macro.ts:26] | Planner must branch before task registration and execution. [CITED: FlashQuery Macro Language Requirements.md §6.8.2] |

**Deprecated/outdated:**
- The current comments saying `budget`, `dry_run`, and `progress` are input-schema-only are now outdated for Phase 137 implementation. [VERIFIED: src/mcp/tools/macro.ts:25][VERIFIED: 137-CONTEXT.md]
- The current success payload always includes `trace`, `token_total`, `model_calls`, and `external_tool_calls`, but REQ-052/REQ-047 require trace absence for `trace: "none"` and optional counter fields based on whether model/broker calls ran. [VERIFIED: src/macro/evaluator.ts:903][CITED: FlashQuery Macro Language Requirements.md §6.8.1]

## Recommended Plan Waves

| Wave | Scope | Required Tests | Notes |
|------|-------|----------------|-------|
| Wave 0 | Add failing/contract tests for trace/progress/dry-run/budget/warnings/handler rows. [CITED: FlashQuery Macro Language Test Plan.md §4.8] | T-U-187..T-U-198, T-U-201..T-U-204, T-U-209..T-U-215, T-U-233..T-U-234. [CITED: FlashQuery Macro Language Test Plan.md §4.8][CITED: FlashQuery Macro Language Test Plan.md §4.10.3] | Keep T-U-191/T-U-192 in `macro-trace.test.ts`; do not create duplicate trace files. [VERIFIED: tests/unit/macro-trace.test.ts] |
| Wave 1 | Implement `trace-builder.ts`, warning collector, and evaluator trace integration. [CITED: FlashQuery Macro Language Requirements.md §8.10] | `npm test -- --reporter=verbose macro-trace macro-warnings macro-isolation` [VERIFIED: tests/config/vitest.unit.config.ts] | Preserve T-U-094 labels and per-invocation containers. [VERIFIED: tests/unit/macro-isolation.test.ts:37] |
| Wave 2 | Implement `progress-emitter.ts`, progressToken threading, explicit `status` gating, auto progress boundaries, and throttle warnings. [CITED: FlashQuery Macro Language Requirements.md §6.7.3] | `npm test -- --reporter=verbose macro-progress macro-builtins macro-handler macro-concurrency` [VERIFIED: tests/unit/macro-builtins.test.ts][VERIFIED: tests/integration/macro-concurrency.test.ts] | Use Context7 SDK notification shape and inject fake notification sink in unit tests. [CITED: Context7 /modelcontextprotocol/typescript-sdk docs] |
| Wave 3 | Implement `dry-run.ts` and `budget.ts`, wire handler options, canonical budget/timeout envelopes. [CITED: FlashQuery Macro Language Requirements.md §6.8.2][CITED: FlashQuery Macro Language Requirements.md §6.9.4] | `npm test -- --reporter=verbose macro-envelopes macro-budget macro-task-registry macro-cancellation` [VERIFIED: tests/unit/macro-envelopes.test.ts][VERIFIED: tests/unit/macro-task-registry.test.ts] | Branch dry-run before `taskRegistry.create`; run timeout checks at Phase 136 safe points. [VERIFIED: src/mcp/tools/macro.ts:92][VERIFIED: src/macro/evaluator.ts:462] |
| Wave 4 | Add/adjust directed coverage rows and scenario tests for T-S-016..T-S-018, then run build/focused gates. [CITED: FlashQuery Macro Language Test Plan.md §4.10.5] | `python3 tests/scenarios/directed/run_suite.py --managed test_macro_trace_full_summary_none test_macro_progress_milestones test_macro_budget_timeout` and `npm run build`. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md][VERIFIED: package.json] | Use non-colliding directed IDs because `ML-16`/`ML-17` are occupied. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | All implementation-shaping claims in this research were verified from local code, canonical docs, npm registry, or Context7. | — | — |

## Open Questions (RESOLVED)

1. **What is the default `timeout_ms` when the request omits it?** [CITED: FlashQuery Macro Language Requirements.md §6.9.4]
   - What we know: REQ-060 says `timeout_ms` defaults from server config, but current config grep did not find a macro-specific timeout key. [CITED: FlashQuery Macro Language Requirements.md §6.9.4][VERIFIED: `rg "macro|defaultTimeout|timeout_ms" src/config`]
   - Resolution: Add `macro.default_timeout_ms` to the YAML/config schema and expose it as `config.macro.defaultTimeoutMs` in `FlashQueryConfig`, defaulting to `60000` ms. This matches the spec placeholder spelling while preserving the local camelCase runtime convention. [VERIFIED: src/config/loader.ts strict schema][CITED: FlashQuery Macro Language Requirements.md §6.9.4]
   - Planning implication: Plan 04 must include config loader/schema work plus unit coverage for omitted `budget.timeout_ms` using `config.macro.defaultTimeoutMs`.

2. **How exactly should macro token totals be extracted from `fq.call_model` responses?** [CITED: FlashQuery Macro Language Requirements.md §6.9.4]
   - What we know: Existing `call_model` envelopes expose token metadata under `metadata.tokens` in tests. [VERIFIED: tests/unit/llm-tool.test.ts]
   - Resolution: For a single `fq.call_model` dispatch result, read current-call usage from `metadata.tokens.input + metadata.tokens.output`. Use `metadata.trace_cumulative.total_tokens` only as a fallback when `metadata.tokens` is absent, summing its `input + output` values. [VERIFIED: src/mcp/tools/llm.ts][VERIFIED: tests/unit/llm-agent-loop.test.ts][CITED: FlashQuery Macro Language Requirements.md §6.9.4]
   - Planning implication: `budget.ts` tests must pin both primary extraction and fallback extraction before evaluator wiring.

3. **Which warning codes are final for v0?** [CITED: FlashQuery Macro Language Requirements.md §6.8.5]
   - What we know: The spec reserves `trace_value_truncated`, `progress_throttled`, and `broker_unavailable`, while the Test Plan explicitly names T-U-209 and T-U-210. [CITED: FlashQuery Macro Language Requirements.md §6.8.5][CITED: FlashQuery Macro Language Test Plan.md §4.8.4]
   - Resolution: Implement all three v0 warning codes: `trace_value_truncated`, `progress_throttled`, and `broker_unavailable`. The first two are directly owned by Phase 137 trace/progress behavior; `broker_unavailable` is already in the Test Plan as T-U-210. [VERIFIED: 137-CONTEXT.md][CITED: FlashQuery Macro Language Requirements.md §6.8.5]
   - Planning implication: Plan 01/02/03 must include `progress_throttled` coverage in addition to Test Plan rows T-U-209 and T-U-210.

4. **What directed coverage IDs should replace Test Plan `M-16`..`M-18`?** [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]
   - What we know: Current macro directed rows use `ML-*`, and `ML-16`/`ML-17` are already occupied. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]
   - Resolution: Use `ML-18`, `ML-19`, and `ML-20` for Phase 137 directed rows, while preserving the Test Plan labels `T-S-016`, `T-S-017`, and `T-S-018` in test descriptions/docstrings. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md][VERIFIED: .planning/phases/136-task-lifecycle-and-cancellation/136-04-SUMMARY.md]
   - Planning implication: Plan 05 must explicitly name `ML-18`, `ML-19`, and `ML-20`.

5. **What exact MCP SDK fields carry progress tokens and emit progress notifications?** [CITED: FlashQuery Macro Language Requirements.md §6.9.7]
   - Resolution: Tool handlers receive `extra: RequestHandlerExtra<ServerRequest, ServerNotification>`. The progress token is at `extra._meta?.progressToken`. Progress notifications should be emitted with `extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress, total?, message? } })`. [VERIFIED: node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts][VERIFIED: node_modules/@modelcontextprotocol/sdk/dist/esm/spec.types.d.ts]
   - Planning implication: Plan 03 must type the macro handler `extra` as `RequestHandlerExtra<ServerRequest, ServerNotification>` or an equivalent local narrowed type that includes `_meta`, `signal`, `sessionId`, and `sendNotification`.

6. **How should directed scenarios capture `notifications/progress`?** [CITED: FlashQuery Macro Language Test Plan.md §4.10.5]
   - Resolution: The current Python directed client only implements request/response `call_tool` and does not capture out-of-band notifications. Plan 05 must add a helper, likely `FQCClient.call_tool_with_progress(...)`, that sends a `tools/call` request with `params._meta.progressToken`, reads the streamable HTTP response/event stream, collects `notifications/progress` messages tied to that token, and returns both the `ToolResult` and captured notifications. [VERIFIED: tests/scenarios/framework/fqc_client.py]
   - Planning implication: Directed progress scenario work is not executable until that helper exists or the scenario uses an equivalent explicit helper.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, unit tests, integration tests, directed managed server | yes [VERIFIED: `node --version`] | v24.7.0 [VERIFIED: `node --version`] | Required; no fallback. [VERIFIED: AGENTS.md] |
| npm | Package scripts and registry checks | yes [VERIFIED: `npm --version`] | 11.5.1 [VERIFIED: `npm --version`] | Required; no fallback. [VERIFIED: package.json] |
| Python 3 | Directed scenario runner | yes [VERIFIED: `python3 --version`] | 3.12.3 [VERIFIED: `python3 --version`] | Required for directed scenarios. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md] |
| git | Scenario/test cleanup patterns and final commits | yes [VERIFIED: `git --version`] | 2.50.1 Apple Git-155 [VERIFIED: `git --version`] | Required for repo workflow. [VERIFIED: AGENTS.md] |
| ripgrep | Codebase investigation and planner/executor searches | yes [VERIFIED: `command -v rg`] | installed at VS Code extension path [VERIFIED: `command -v rg`] | Use shell alternatives if unavailable. [VERIFIED: tool output] |
| `.env.test` | Integration/E2E tests and managed scenarios that need test config | yes [VERIFIED: filesystem check] | — | Copy `.env.test.example` if missing. [VERIFIED: AGENTS.md] |
| Docker / pg_isready / psql | Not required for Phase 137 unit tests; may help broader DB triage | not found in command probes [VERIFIED: command probes] | — | Directed/integration runners can still use configured `.env.test` when services are external. [VERIFIED: AGENTS.md] |

**Missing dependencies with no fallback:**
- None for the research and likely unit-test implementation path. [VERIFIED: environment audit]

**Missing dependencies with fallback:**
- Docker/psql CLI probes returned no tool output; Phase 137 should not require them unless the planner adds DB-heavy scenario validation. [VERIFIED: command probes]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest project range `^4.1.1`, registry latest 4.1.6. [VERIFIED: package.json][VERIFIED: npm registry] |
| Config file | `tests/config/vitest.unit.config.ts` for unit tests; `tests/config/vitest.integration.config.ts` for selected integration tests. [VERIFIED: tests/config/vitest.unit.config.ts][VERIFIED: tests/config/vitest.integration.config.ts] |
| Quick run command | `npm test -- --reporter=verbose macro-trace macro-progress macro-envelopes macro-warnings macro-budget macro-handler` [VERIFIED: package.json] |
| Full suite command | `npm test && npm run test:integration && npm run build` plus directed scenario command if Wave 4 lands. [VERIFIED: package.json][VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MACRO-OBS-02 | Trace modes and truncation. [VERIFIED: .planning/REQUIREMENTS.md] | unit + directed | `npm test -- --reporter=verbose macro-trace`; directed `test_macro_trace_full_summary_none` after creation. [CITED: Test Plan §4.8.1] | `tests/unit/macro-trace.test.ts` exists; directed file missing. [VERIFIED: filesystem] |
| MACRO-OBS-03 | Progress modes, throttling, no-token no-op, auto progress. [VERIFIED: .planning/REQUIREMENTS.md] | unit + directed | `npm test -- --reporter=verbose macro-progress macro-builtins macro-handler`; directed `test_macro_progress_milestones` after creation. [CITED: Test Plan §4.8.2] | Unit file missing; directed file missing. [VERIFIED: filesystem] |
| MACRO-RESP-05 | Warnings array for truncation/throttle/broker degradation. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `npm test -- --reporter=verbose macro-warnings response-formats` [CITED: Test Plan §4.8.4] | `macro-warnings.test.ts` missing; `response-formats.test.ts` exists. [VERIFIED: filesystem] |
| MACRO-INT-04 | Budgets for token/model/external-tool/timeout and per-invocation isolation. [VERIFIED: .planning/REQUIREMENTS.md] | unit + directed | `npm test -- --reporter=verbose macro-budget macro-isolation macro-cancellation`; directed `test_macro_budget_timeout` after creation. [CITED: Test Plan §4.8.5] | `macro-budget.test.ts` missing; isolation/cancellation files exist. [VERIFIED: filesystem] |
| MACRO-INT-07 | Progress token capture and no-token no-op. [VERIFIED: .planning/REQUIREMENTS.md] | unit / handler | `npm test -- --reporter=verbose macro-handler macro-progress` [CITED: Test Plan §4.10.3] | `macro-handler.test.ts` missing. [VERIFIED: filesystem] |

### Sampling Rate

- **Per task commit:** Run the narrow Vitest file/pattern for the changed module, e.g. `npm test -- --reporter=verbose macro-trace`. [VERIFIED: package.json]
- **Per wave merge:** Run all Phase 137 unit patterns plus any touched integration file. [VERIFIED: tests/config/vitest.unit.config.ts]
- **Phase gate:** Run `npm test -- --reporter=verbose macro-trace macro-progress macro-envelopes macro-warnings macro-budget macro-handler macro-builtins macro-isolation macro-cancellation macro-task-registry`, then directed scenarios if added, then `npm run build`. [VERIFIED: package.json][VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md]

### Wave 0 Gaps

- [ ] `tests/unit/macro-progress.test.ts` — covers T-U-194..T-U-198 and REQ-039 ac3. [CITED: Test Plan §4.8.2]
- [ ] `tests/unit/macro-budget.test.ts` — covers T-U-211..T-U-215. [CITED: Test Plan §4.8.5]
- [ ] `tests/unit/macro-warnings.test.ts` — covers T-U-209, T-U-210, and likely `progress_throttled`. [CITED: Test Plan §4.8.4][VERIFIED: 137-CONTEXT.md]
- [ ] `tests/unit/macro-handler.test.ts` — covers T-U-233 and T-U-234. [CITED: Test Plan §4.10.3]
- [ ] Extend `tests/unit/macro-trace.test.ts` — covers T-U-187..T-U-190 and T-U-193. [CITED: Test Plan §4.8.1][VERIFIED: tests/unit/macro-trace.test.ts]
- [ ] Extend `tests/unit/macro-envelopes.test.ts` — covers T-U-201..T-U-204 if Phase 137 closes dry-run envelopes now. [CITED: Test Plan §4.8.3][VERIFIED: tests/unit/macro-envelopes.test.ts]
- [ ] Add directed coverage rows and files for T-S-016..T-S-018 using non-colliding matrix IDs. [CITED: Test Plan §4.10.5][VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 137 does not change authentication or bearer token validation. [VERIFIED: phase scope][VERIFIED: src/mcp/tools/macro.ts] |
| V3 Session Management | yes | Preserve existing per-session `MacroTaskRegistry` and session ID filtering. [VERIFIED: src/macro/task-registry.ts][VERIFIED: tests/unit/macro-session-scope.test.ts] |
| V4 Access Control | yes | Reuse `preScanToolReferences`, allowlists, template hard exclusions, and dispatch-time backstop. [VERIFIED: src/macro/permission-prescan.ts][VERIFIED: src/macro/dispatcher.ts] |
| V5 Input Validation | yes | Keep Zod handler schema and pre-flight validation for dry-run and real-run. [VERIFIED: src/mcp/tools/macro.ts:22][VERIFIED: src/macro/preflight.ts] |
| V6 Cryptography | no | Phase 137 does not implement cryptographic primitives. [VERIFIED: phase scope] |

### Known Threat Patterns For This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Progress/task leakage across sessions | Information Disclosure | Keep progress, budget, trace, task state in `MacroInvocationContext` and registry session filters. [VERIFIED: tests/unit/macro-isolation.test.ts:37][VERIFIED: src/macro/task-registry.ts] |
| Dry-run executing side effects | Tampering | Branch before `taskRegistry.create` and `execBlock`; test with a side-effecting fake/native tool. [CITED: FlashQuery Macro Language Requirements.md §6.8.2] |
| Budget bypass through delayed checks | Denial of Service | Check timeout at safe points and count model/external calls before dispatch where specified. [CITED: FlashQuery Macro Language Requirements.md §6.9.4][VERIFIED: src/macro/evaluator.ts cancellation safe points] |
| Sensitive data in full trace | Information Disclosure | Enforce 2KB truncation now; redaction remains reserved and out of v0. [CITED: FlashQuery Macro Language Requirements.md §6.7.2] |
| Tool permission bypass in dry-run | Elevation of Privilege | Dry-run must call the same permission pre-scan as real-run. [CITED: FlashQuery Macro Language Requirements.md §6.8.2][VERIFIED: src/macro/permission-prescan.ts] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/137-trace-progress-dry-run-budgets/137-CONTEXT.md` - locked decisions, prior-phase reminders, test-row scope. [VERIFIED: filesystem]
- `.planning/REQUIREMENTS.md` - local requirement rows and phase mapping. [VERIFIED: filesystem]
- `.planning/ROADMAP.md` - Phase 137 goal and success criteria. [VERIFIED: filesystem]
- `.planning/STATE.md` - current project position at Phase 137. [VERIFIED: filesystem]
- `.planning/phases/136-task-lifecycle-and-cancellation/136-04-SUMMARY.md` - immediate predecessor handoff. [VERIFIED: filesystem]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - canonical macro spec, especially §6.5.6, §6.7.1..§6.7.3, §6.8.1..§6.8.5, §6.9.4, §6.9.7, §8.10. [CITED: local canonical docs]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - required test rows and scenario mapping. [CITED: local canonical docs]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Gap Analysis.md` - Phase 137 forward-looking reminders. [CITED: local canonical docs]
- `src/macro/evaluator.ts`, `src/mcp/tools/macro.ts`, `src/mcp/utils/response-formats.ts`, `src/macro/task-registry.ts`, `src/macro/preflight.ts`, `src/macro/permission-prescan.ts`. [VERIFIED: codebase grep]
- Context7 `/modelcontextprotocol/typescript-sdk` - `ctx.mcpReq._meta?.progressToken` and `ctx.mcpReq.notify({ method: 'notifications/progress' })`. [CITED: Context7]
- npm registry - package current versions and modified times. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- None used for core implementation claims. [VERIFIED: research process]

### Tertiary (LOW confidence)

- None. [VERIFIED: research process]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions were read from `package.json` and current registry data. [VERIFIED: package.json][VERIFIED: npm registry]
- Architecture: HIGH - canonical docs match current handler/evaluator boundaries. [CITED: FlashQuery Macro Language Requirements.md §8.10][VERIFIED: src/mcp/tools/macro.ts][VERIFIED: src/macro/evaluator.ts]
- Pitfalls: HIGH - each pitfall maps to a current code location or explicit canonical requirement. [VERIFIED: codebase grep][CITED: canonical docs]

**Research date:** 2026-05-14 [VERIFIED: system date]  
**Valid until:** 2026-06-13 for local architecture; re-check npm/Context7 before implementation if SDK APIs change. [VERIFIED: npm registry modified dates]
