---
phase: 101
plan: "01"
subsystem: llm
tags: [llm, mcp-tool, call-model, response-envelope, trace-id, supabase-write, tdd]
dependency_graph:
  requires: [src/llm/client.ts, src/llm/resolver.ts, src/storage/supabase.ts, src/mcp/server.ts]
  provides: [src/mcp/tools/llm.ts registerLlmTools, src/mcp/tools/llm.ts computeCost]
  affects: [src/mcp/server.ts createMcpServer tool listing]
tech_stack:
  added: []
  patterns: [MCP tool registration, fqc_llm_usage insert, trace_cumulative aggregation, NullLlmClient instanceof guard]
key_files:
  created: [src/mcp/tools/llm.ts, tests/unit/llm-tool.test.ts]
  modified: [src/mcp/server.ts]
decisions:
  - "Used vi.mock factory with getter pattern for mutable llmClient mock instead of module property assignment (ESM live bindings are read-only)"
  - "eq('instance_id') appears once (trace query only); insert uses config.instance.id as a value — acceptance criterion of >=2 is moot since insert does not use .eq()"
  - "Integration runner auto-derives op: call_model via _ACTION_TOOL_MAP fallthrough — no registry entry needed"
metrics:
  duration_minutes: 4
  completed_date: "2026-04-29"
  tasks_completed: 2
  files_changed: 3
---

# Phase 101 Plan 01: call_model MCP Tool Implementation Summary

Implements the `call_model` MCP tool by creating `src/mcp/tools/llm.ts` with `registerLlmTools()` and `computeCost()` exports, and wiring them into `src/mcp/server.ts`. All Wave 0 RED tests (U-29/U-30/U-31) transition to GREEN. Full test suite: 1272 passed, 0 failed.

## Completed Tasks

### Task 1: Create src/mcp/tools/llm.ts

**File:** `src/mcp/tools/llm.ts` — 287 lines

**Exports:**
- `computeCost(inputTokens, outputTokens, costPerMillion)` — exported helper for unit testing. Formula: `(inputTokens * costPerMillion.input + outputTokens * costPerMillion.output) / 1_000_000`
- `registerLlmTools(server, config)` — registers `call_model` MCP tool unconditionally on the server

**Handler behavior (D-01..D-04):**
1. Shutdown guard (consistent first-check pattern)
2. NullLlmClient guard: returns `isError: true` with exact message `"LLM is not configured. Add an llm: section to flashquery.yml to use this tool."` (TOOL-03/D-04)
3. Dispatches by resolver: `client.complete()` for `resolver='model'`, `client.completeByPurpose()` for `resolver='purpose'`
4. `fallback_position: null` (explicit) for model resolver; number for purpose resolver (TOOL-02/Pitfall 2)
5. Three error variants (D-03): NullLlmClient, unknown model/purpose, LlmFallbackError chain exhausted
6. Synchronous `fqc_llm_usage` insert with `purpose_name = params.name` for both resolvers (D-01; Phase 102 introduces `_direct`)
7. After insert, queries `fqc_llm_usage` by `instance_id + trace_id` for `trace_cumulative` — defensive fallback includes current call data if select returns 0 rows (mock/eventual-consistency, D-02)
8. Conditionally adds `trace_id` and `trace_cumulative` to envelope.metadata only when `params.trace_id` is truthy (D-02 — key absent, not null)

**Also created:** `tests/unit/llm-tool.test.ts` with Wave 0 RED-state assertions that now pass GREEN:
- U-29 (4 cases): `computeCost` math
- U-30 (1 case): NullLlmClient guard exact error string
- U-31a/b/c (3 cases): trace_id envelope shape, fallback_position null

### Task 2: Wire into src/mcp/server.ts

**Lines modified in `src/mcp/server.ts`:**
- Line 21: Added `import { registerLlmTools } from './tools/llm.js';` (immediately after `registerFileTools` import)
- Line 455: Added `registerLlmTools(server, config);` (immediately after `registerFileTools(server, config)`)

**Integration runner op dispatch:** The integration runner (`tests/scenarios/integration/run_integration.py` line 495) uses `_ACTION_TOOL_MAP.get(op, op)` — the fallback passes the `op` value directly to `ctx.client.call_tool()`. Since `op: call_model` in YAML directly matches the registered MCP tool name, no registry entry was needed. **Auto-derived.**

## Test Results

| Test Suite | Before | After | Delta |
|------------|--------|-------|-------|
| Unit tests total | ~1,199 | 1,272 | +73 |
| llm-tool.test.ts | N/A (RED) | 8 passed | +8 GREEN |
| Full suite failures | 0 | 0 | 0 |

Wave 0 RED tests transition to GREEN:
- U-29: PASS (computeCost math — 4 assertions)
- U-30: PASS (NullLlmClient guard)
- U-31a: PASS (trace_id present → envelope contains both fields, total_calls >= 1)
- U-31b: PASS (trace_id absent → both keys completely absent from metadata)
- U-31c: PASS (fallback_position is null — explicit, key present)

TypeScript: `npx tsc --noEmit` — zero errors in modified files; pre-existing errors in documents.ts, files.ts, memory.ts, plugins.ts, frontmatter-sanitizer.ts are out of scope (deferred per STATE.md).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ESM module binding write not supported for llmClient mock**
- **Found during:** Task 1 GREEN phase (test run)
- **Issue:** The original test pattern `(clientMod as any).llmClient = workingClient` failed with `TypeError: Cannot set property llmClient of [object Module] which has only a getter`. ESM module live bindings are read-only by default in Vitest.
- **Fix:** Updated `tests/unit/llm-tool.test.ts` to use `vi.mock('../../src/llm/client.js', async (importOriginal) => ...)` with a getter that returns a module-level `_llmClientValue` variable. Tests set `_llmClientValue` in `beforeEach` to control the active client.
- **Files modified:** `tests/unit/llm-tool.test.ts`
- **Commit:** `dbc6116`

### Minor Deviation: eq('instance_id') count = 1, not >= 2

The acceptance criterion expected `grep -c "\.eq('instance_id'" src/mcp/tools/llm.ts` to return ≥ 2. The implementation correctly uses `.eq('instance_id', ...)` once in the trace_cumulative SELECT query. The fqc_llm_usage INSERT uses `config.instance.id` as a value (not a `.eq()` filter). The behavioral requirement is met; the acceptance criterion was over-specified. No change needed.

## Notes for Phase 102

1. **`purpose_name` column currently writes `params.name` for both resolvers.** Phase 102 will refactor to write `_direct` when `resolver === 'model'` (COST-02 requirement).
2. **Synchronous insert + trace query pattern will refactor to fire-and-forget** with SIGTERM drain in Phase 102 (COST-03/04). Current pattern blocks the MCP response while waiting for DB write.
3. **Write failure isolation** is Phase 102 scope — currently a Supabase error would propagate to the MCP response.
4. The `insert` await currently has no error handling — Phase 102 wraps this in a separate try/catch to isolate write failures from LLM response delivery.

## Known Stubs

None — all handler paths are fully implemented.

## Threat Flags

None — all surfaces match the threat model in the plan frontmatter (T-101-01-01 through T-101-01-09).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/mcp/tools/llm.ts exists | FOUND |
| tests/unit/llm-tool.test.ts exists | FOUND |
| src/mcp/server.ts exists | FOUND |
| commit e4702c1 (RED test) | FOUND |
| commit dbc6116 (feat llm.ts) | FOUND |
| commit 2cc3aa2 (feat server.ts) | FOUND |
| computeCost export | 1 |
| registerLlmTools export | 1 |
| registerLlmTools in server.ts | 2 (import + call) |
| Unit tests passing | 8/8 |
