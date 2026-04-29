---
phase: 102-cost-tracking
plan: 01
subsystem: api
tags: [llm, cost-tracking, fire-and-forget, sigterm-drain, supabase, typescript]

# Dependency graph
requires:
  - phase: 102-00
    provides: Wave 0 RED-state tests (U-32..U-35) for cost-tracker contract
  - phase: 101-call-model-mcp-tool
    provides: call_model MCP tool handler, fqc_llm_usage schema, synchronous insert (removed here)
provides:
  - src/llm/cost-tracker.ts — LlmUsageRecord, recordLlmUsage (fire-and-forget), drainCostWrites, computeCost
  - recordLlmUsage wired from src/llm/client.ts at end of complete() and completeByPurpose() success paths
  - _direct sentinel for resolver=model calls (COST-02)
  - drainCostWrites(5000) in ShutdownCoordinator Step 2.5 (COST-04)
  - trace_cumulative query-then-add-in-memory pattern (D-11)
affects: [103-embedding-migration, 104-config-template-updates, any future internal LLM callers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget void function with module-level Set<Promise<void>> for SIGTERM drain"
    - "Private HTTP-only internal method (completeHttpOnly) to prevent double-recording on fallback chains"
    - "Dynamic import in ShutdownCoordinator for soft dependency on cost-tracker module"
    - "Query-then-add-in-memory pattern for eventual-consistent trace_cumulative aggregation"

key-files:
  created:
    - src/llm/cost-tracker.ts
    - tests/unit/llm-cost-tracker.test.ts
    - tests/scenarios/directed/testcases/test_llm_cost_tracking.py
    - tests/scenarios/integration/tests/llm_cost_accumulation.yml
  modified:
    - src/llm/client.ts
    - src/mcp/tools/llm.ts
    - src/server/shutdown.ts
    - tests/unit/llm-tool.test.ts
    - tests/unit/llm-client.test.ts

key-decisions:
  - "recordLlmUsage wired from src/llm/client.ts (not mcp/tools/llm.ts) so all future internal callers get cost tracking automatically (D-03)"
  - "completeHttpOnly private method prevents double-writing: resolver gets HTTP-only binding, outer public methods record once on success (D-07)"
  - "computeCost relocated to cost-tracker.ts (D-02) — llm.ts imports instead of redeclaring"
  - "query-then-add-in-memory (D-11) replaces selectIncludesCurrent race-condition detection"
  - "5_000ms drain timeout in ShutdownCoordinator Step 2.5 between drainMcpRequests and closeHttpServer (D-10)"

patterns-established:
  - "Pattern 1: Fire-and-forget with Set<Promise<void>> — module-level Set tracks in-flight promises; finally() removes on settle; drainCostWrites uses Promise.race(allSettled, sleep)"
  - "Pattern 2: Dynamic import in shutdown steps — keeps cost-tracker dependency soft; shutdown proceeds even if module load fails"
  - "Pattern 3: Private *HttpOnly method on LlmClient — separates HTTP work from recording to enable single-recording guarantee"

requirements-completed: [COST-01, COST-02, COST-03, COST-04]

# Metrics
duration: 10min
completed: 2026-04-29
---

# Phase 102 Plan 01: Cost Tracking Implementation Summary

**Fire-and-forget LLM cost tracking in src/llm/cost-tracker.ts with _direct sentinel, write-failure isolation, and SIGTERM drain integrated into ShutdownCoordinator**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-29T14:56:16Z
- **Completed:** 2026-04-29T15:06:35Z
- **Tasks:** 4 (plus Wave 0 prerequisite)
- **Files modified:** 9

## Accomplishments

- Created `src/llm/cost-tracker.ts` with fire-and-forget `recordLlmUsage()` (void return, never throws), `drainCostWrites()` (Promise.race with sleep), and `computeCost()` relocated from llm.ts
- Extended `LlmClient` interface with `traceId?: string | null`; wired `recordLlmUsage` from `client.ts` with `_direct` sentinel for `complete()` and actual purpose name for `completeByPurpose()` — no double-writing via `completeHttpOnly` private method
- Removed synchronous `fqc_llm_usage` insert from `mcp/tools/llm.ts`; adapted trace_cumulative to query-then-add-in-memory (D-11)
- Added `drainCostWritesStep()` to `ShutdownCoordinator.execute()` as Step 2.5 with 5000ms timeout between MCP drain and HTTP close

## Task Commits

Wave 0 prerequisite (RED-state test scaffolds):

0. **Wave 0: RED-state test scaffolds** - `be5621b` (test)

Plan 102-01 tasks:

1. **Task 1: Create src/llm/cost-tracker.ts** - `cc56169` (feat)
2. **Task 2: Extend LlmClient with traceId; wire recordLlmUsage** - `0ab1db8` (feat)
3. **Task 3: Remove sync insert from llm.ts; adapt trace_cumulative** - `efa7482` (feat)
4. **Task 4: Add drainCostWritesStep() to ShutdownCoordinator** - `e92928e` (feat)

## Files Created/Modified

- `src/llm/cost-tracker.ts` (NEW) — LlmUsageRecord interface, recordLlmUsage (void/fire-and-forget), drainCostWrites, computeCost
- `src/llm/client.ts` — Added traceId param to LlmClient interface, completeHttpOnly private method, instanceId field, recordLlmUsage call sites
- `src/mcp/tools/llm.ts` — Removed sync insert, added computeCost import from cost-tracker.js, trace_cumulative D-11 pattern
- `src/server/shutdown.ts` — New drainCostWritesStep() method + Step 2.5 call in execute()
- `tests/unit/llm-cost-tracker.test.ts` (NEW) — U-32..U-35 covering LlmUsageRecord insert, _direct sentinel, fallback_position, write isolation
- `tests/unit/llm-tool.test.ts` — computeCost import updated to cost-tracker.js, insertMock removed (D-06)
- `tests/unit/llm-client.test.ts` — Fixed U-21 test to include instance.id in config (required by new constructor)
- `tests/scenarios/directed/testcases/test_llm_cost_tracking.py` (NEW) — L-16, L-17 directed scenario stubs
- `tests/scenarios/integration/tests/llm_cost_accumulation.yml` (NEW) — IL-03 integration scenario stub

## Decisions Made

- `recordLlmUsage` wired from `src/llm/client.ts` (not `mcp/tools/llm.ts`) so all future internal callers (Projections, Auto-Tags, plugins) get cost tracking automatically without rewiring (D-03)
- `completeHttpOnly` private method created to prevent double-writing in resolver fallback chains; resolver receives the HTTP-only binding, only the outer public methods call `recordLlmUsage`
- `computeCost` relocated to `cost-tracker.ts` (D-02) — llm.ts imports it instead of redeclaring; the export was not kept in llm.ts
- `trace_cumulative` computation replaced with deterministic query-then-add-in-memory (D-11) — always adds current call once regardless of whether fire-and-forget write has committed yet
- `drainCostWrites` called with `5_000` numeric separator (consistent with MAX_SHUTDOWN_MS = 30_000 in shutdown.ts)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed U-21 test config missing instance.id**
- **Found during:** Task 2 (Extend LlmClient)
- **Issue:** Existing U-21 test in `tests/unit/llm-client.test.ts` provided `{ llm: TEST_LLM_CONFIG }` without `instance` field. The new `OpenAICompatibleLlmClient(config.llm, config.instance.id)` constructor call in `initLlm()` throws `TypeError: Cannot read properties of undefined (reading 'id')`
- **Fix:** Added `instance: { id: 'test-instance-u21' }` to the U-21 test config fixture
- **Files modified:** `tests/unit/llm-client.test.ts`
- **Verification:** All 57 client/resolver/cost-tracker tests pass
- **Committed in:** `0ab1db8` (Task 2 commit)

**2. [Rule 1 - Bug] Wave 0 test scaffolds not present (dependency not executed)**
- **Found during:** Pre-task check
- **Issue:** 102-00-PLAN.md (Wave 0) had not been executed; llm-cost-tracker.test.ts, llm-tool.test.ts updates, and scenario stubs were all missing
- **Fix:** Executed Wave 0 tasks inline before implementing source code (created all 4 files per 102-00-PLAN.md spec)
- **Files modified:** see Files Created/Modified above
- **Verification:** npm test confirmed RED state (module-not-found) before implementation
- **Committed in:** `be5621b` (Wave 0 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes necessary for test correctness and plan executability. No scope creep.

## Issues Encountered

- Pre-existing TypeScript errors in `src/mcp/tools/documents.ts`, `src/mcp/tools/files.ts`, and `src/mcp/tools/memory.ts` — confirmed pre-existing (in deferred 20 failures list from STATE.md), not caused by Phase 102 changes. Phase 102 files compile cleanly.

## Known Stubs

None — all functions are fully implemented and connected to live Supabase inserts.

## Threat Flags

No new security-relevant surface introduced. `recordLlmUsage` writes to the existing `fqc_llm_usage` table using the Supabase JS client (parameterized queries). `trace_id` stored as-is in TEXT column via `.eq('trace_id', ...)` parameterized form (T-102-01 mitigated). See plan STRIDE register for full analysis.

## Test Results

- **Before Phase 102:** 1,272 tests passing (baseline per STATE.md)
- **After Phase 102:** 1,279 tests passing (68 test files)
- **New tests added:** U-32, U-33, U-34, U-34b, U-35, U-29-ct, U-29-ct-b (7 new in cost-tracker.test.ts)
- **Regressions:** 0

## Pre-existing Deferred Failures

Confirmed unchanged — 20 pre-existing deferred unit test failures from v2.8 remain at their same positions. No accidental fixes or new failures introduced.

## Phase 102 Requirement Verification

| Requirement | Status | Test |
|------------|--------|------|
| COST-01: every LLM call records full row | DONE | U-32, shutdown log shows Cost writes drained |
| COST-02: _direct sentinel for resolver=model | DONE | U-33 |
| COST-03: write failures never affect LLM result | DONE | U-35 |
| COST-04: SIGTERM drains pending writes | DONE | ShutdownCoordinator Step 2.5, shutdown.test.ts |

## Next Phase Readiness

- Phase 103 (Embedding Migration): `OpenAICompatibleLlmClient` now automatically records cost for any caller; no extra wiring needed when routing embedding through LLM client
- Phase 104 (Config Template Updates): `computeCost` canonical location is now `src/llm/cost-tracker.ts`
- `resolver.ts` was NOT modified — the `completeHttpOnly` bind in the constructor handles forwarding cleanly without changes to `PurposeResolver`

---
*Phase: 102-cost-tracking*
*Completed: 2026-04-29*

## Self-Check: PASSED

All created files exist:
- `src/llm/cost-tracker.ts` - FOUND
- `tests/unit/llm-cost-tracker.test.ts` - FOUND
- `tests/scenarios/directed/testcases/test_llm_cost_tracking.py` - FOUND
- `tests/scenarios/integration/tests/llm_cost_accumulation.yml` - FOUND
- `.planning/phases/102-cost-tracking/102-01-SUMMARY.md` - FOUND

All commits exist:
- `be5621b` (Wave 0) - FOUND
- `cc56169` (Task 1) - FOUND
- `0ab1db8` (Task 2) - FOUND
- `efa7482` (Task 3) - FOUND
- `e92928e` (Task 4) - FOUND
