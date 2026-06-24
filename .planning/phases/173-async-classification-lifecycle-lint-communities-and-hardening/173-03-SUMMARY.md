---
phase: 173-async-classification-lifecycle-lint-communities-and-hardening
plan: 3
subsystem: graph
tags: [graph, pending-worker, staleness, maintenance, scanner, vitest]
requires:
  - phase: 173-01
    provides: graph candidate selection and pending edge enqueueing
  - phase: 173-02
    provides: graph node and edge LLM analysis helpers
provides:
  - Durable graph pending edge worker with retry, dead-letter, shutdown, and count reporting
  - Stale edge completion update/delete/replace lifecycle helpers
  - Scanner and maintain_vault graph_worker trigger path with warnings and counts
affects: [graph-worker, graph-maintenance, graph-staleness, scan-sync]
tech-stack:
  added: []
  patterns:
    - queue-driven worker modeled after pending embeddings
    - stale re-analysis completion without history/supersession rows
    - warning-only graph worker wrapper when classification dependencies are unavailable
key-files:
  created:
    - src/graph/pending-worker.ts
    - tests/unit/graph-pending-worker.test.ts
    - tests/unit/graph-cost-controls.test.ts
    - tests/integration/graph/pending-edge-worker.test.ts
  modified:
    - src/graph/staleness.ts
    - src/services/scanner.ts
    - src/services/maintenance.ts
    - tests/unit/graph-staleness.test.ts
key-decisions:
  - "Expose graph draining as explicit queue-driven work through scanner and maintain_vault graph_worker, not a scheduler/session loop."
  - "When LLM resolver/client dependencies are missing, return graph worker warnings without mutating queued jobs."
requirements-completed: [GR-012, GR-013B, GR-023]
duration: 1h 16m
completed: 2026-06-24
---

# Phase 173 Plan 3: Pending Worker and Stale Completion Summary

**Durable graph pending-edge draining with bounded retries, dead-letter remediation, stale-edge completion, and maintenance-visible worker counts**

## Performance

- **Duration:** 1h 16m
- **Started:** 2026-06-24T13:36:00Z
- **Completed:** 2026-06-24T14:51:36Z
- **Tasks:** 3/3
- **Files modified:** 8

## Accomplishments

- Added `processPendingGraphEdges()` with instance-scoped selection, per-run limits, shutdown checks, retry backoff, dead-letter state, sanitized remediation detail, and count visibility.
- Added stale re-analysis completion helpers that update confirmed relationships in place and delete/replace changed or absent relationships without adding history rows.
- Wired a config-aware graph worker trigger into scanner sync and `maintain_vault` via `graph_worker`, including warnings for skipped work and selected/processed/succeeded/failed/dead_letter/skipped counts.

## Task Commits

1. **Task 1 RED:** `8a4dbd4b` test(173-03): add failing graph pending worker coverage
2. **Task 1 GREEN:** `1715ac49` feat(173-03): implement graph pending edge worker
3. **Task 2 RED:** `60dcadc9` test(173-03): add failing stale completion coverage
4. **Task 2 GREEN:** `782e3fae` feat(173-03): complete stale graph edge reanalysis
5. **Task 2/worker lifecycle fix:** `03619707` fix(173-03): route worker successes through stale completion
6. **Task 3:** `c7d2178f` feat(173-03): expose graph pending worker through maintenance

## Files Created/Modified

- `src/graph/pending-worker.ts` - durable pending edge worker, config-aware wrapper, and dead-letter listing.
- `src/graph/staleness.ts` - stale completion update/delete/replace helpers.
- `src/services/scanner.ts` - graph worker drain hook and scan result warnings/counts.
- `src/services/maintenance.ts` - `maintain_vault` `graph_worker` action and warning propagation.
- `tests/unit/graph-pending-worker.test.ts` - retry, dead-letter, shutdown, and stale-helper coverage.
- `tests/unit/graph-cost-controls.test.ts` - worker count visibility coverage.
- `tests/unit/graph-staleness.test.ts` - stale completion lifecycle coverage.
- `tests/integration/graph/pending-edge-worker.test.ts` - instance isolation, skipped warning, and non-blocking trigger contracts.

## Decisions Made

- Used the existing graph edge classifier as the default worker implementation, with injectable classification for deterministic tests.
- Kept scanner safe when no LLM singleton is initialized: it surfaces warnings through the worker wrapper instead of marking jobs failed.
- Kept stale completion SQL-level and scoped to exact source/target pair plus `instance_id`; no edge history or supersession table was introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added warning-only worker wrapper for unavailable LLM dependencies**
- **Found during:** Task 3
- **Issue:** Scanner has no guaranteed LLM client in all execution modes; blindly invoking the worker would mutate pending rows as failures.
- **Fix:** Added `processPendingGraphEdgesForConfig()` to return skipped-work warnings when graph classification resolver or LLM client is unavailable.
- **Files modified:** `src/graph/pending-worker.ts`, `src/services/scanner.ts`, `src/services/maintenance.ts`
- **Verification:** Focused unit tests, integration test, and typecheck pass.
- **Committed in:** `c7d2178f`

**2. [Rule 3 - Blocking] Fixed TypeScript declaration build issues in worker/maintenance query types**
- **Found during:** Task 3 verification
- **Issue:** DTS build rejected optional insert `.select()` and maintenance background action narrowing.
- **Fix:** Tightened the local insert builder type and narrowed background actions after mode validation.
- **Files modified:** `src/graph/pending-worker.ts`, `src/services/maintenance.ts`
- **Verification:** `npm run typecheck` passed.
- **Committed in:** `c7d2178f`

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking). **Impact on plan:** Both kept the worker safe and buildable without expanding beyond the planned queue/maintenance surface.

## Issues Encountered

- Exact plan unit command `npm test -- --run tests/unit/graph-pending-worker.test.ts tests/unit/graph-cost-controls.test.ts tests/unit/graph-staleness.test.ts` runs the full unit suite first in this repo. The final run failed in unrelated `tests/unit/document-lock-tier2.test.ts` (`expected clients length 1, got 3`) before focused graph assertions could be isolated.
- Earlier exact `npm test -- --run ...` runs also passed the full unit phase, then failed because the script forwards graph unit file paths into `test:macro-framework`, whose include pattern only matches `tests/macro-framework/**`.

## Verification

- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/graph-pending-worker.test.ts tests/unit/graph-cost-controls.test.ts tests/unit/graph-staleness.test.ts` — PASS, 3 files / 12 tests.
- `npm run test:integration -- --run tests/integration/graph/pending-edge-worker.test.ts` — PASS, 1 file / 3 tests.
- `npm run typecheck` — PASS.
- `npm test -- --run tests/unit/graph-pending-worker.test.ts tests/unit/graph-cost-controls.test.ts tests/unit/graph-staleness.test.ts` — FAIL due unrelated full-suite `document-lock-tier2` failure; focused graph unit command above passed.

## Known Stubs

None.

## Threat Flags

None - new worker and maintenance surfaces match the plan threat model and remain instance-scoped.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for subsequent Phase 173 lifecycle/lint/community plans. The graph queue has a bounded worker, stale completion semantics, dead-letter enumeration, and maintenance-visible counts/warnings.

## Self-Check: PASSED

- Summary file exists.
- Task commits exist: `8a4dbd4b`, `1715ac49`, `60dcadc9`, `782e3fae`, `03619707`, `c7d2178f`.
- Key created files exist: `src/graph/pending-worker.ts`, `tests/unit/graph-pending-worker.test.ts`, `tests/unit/graph-cost-controls.test.ts`, `tests/integration/graph/pending-edge-worker.test.ts`.

---
*Phase: 173-async-classification-lifecycle-lint-communities-and-hardening*
*Completed: 2026-06-24*
