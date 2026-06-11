---
phase: 167-lifecycle-operations-and-validation
plan: 03
subsystem: maintenance
tags: [maintain-vault, embeddings, lifecycle, backfill, rebuild]

requires:
  - phase: 167-lifecycle-operations-and-validation
    provides: lifecycle input validation, max_rows contract, durable jobs, locks, status, and abort from Plans 167-01 and 167-02
provides:
  - Core document and memory `backfill_embeddings` processor
  - Core document and memory `rebuild_embeddings` processor
  - Public directed scenarios D-104 through D-110
  - maintain_vault dispatch for foreground, dry-run, and background backfill/rebuild
affects: [maintain_vault, lifecycle-processors, embedding-operator-recipes]

tech-stack:
  added: []
  patterns:
    - Direct PostgreSQL lifecycle row selection with stamped writes delegated to updateTargetEmbedding
    - Shared core lifecycle processor with action-specific selection predicates
    - Directed lifecycle tests using public maintain_vault calls and managed embedding-enabled servers

key-files:
  created:
    - src/embedding/lifecycle/backfill.ts
    - src/embedding/lifecycle/rebuild.ts
    - src/embedding/lifecycle/core-processor.ts
    - tests/scenarios/directed/testcases/lifecycle_embedding_scenario_helpers.py
    - tests/scenarios/directed/testcases/test_backfill_embeddings_full_scope.py
    - tests/scenarios/directed/testcases/test_backfill_embeddings_dry_run.py
    - tests/scenarios/directed/testcases/test_backfill_embeddings_background.py
    - tests/scenarios/directed/testcases/test_backfill_embeddings_failures.py
    - tests/scenarios/directed/testcases/test_rebuild_embeddings_stale_only.py
    - tests/scenarios/directed/testcases/test_rebuild_embeddings_confirm_mismatch.py
    - tests/scenarios/directed/testcases/test_rebuild_embeddings_max_rows_required.py
  modified:
    - src/services/maintenance.ts
    - src/embedding/lifecycle/types.ts
    - src/mcp/utils/response-formats.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md

key-decisions:
  - "Core lifecycle processors require direct PostgreSQL access before mutation because durable jobs, lock invariants, row selection, and HNSW reindexing require databaseUrl."
  - "Records scope remains explicitly unsupported in this plan and deferred to the planned records-scope lifecycle work."
  - "Dry-run estimates report cost_usd as null with cost_basis unavailable_provider_pricing_metadata because catalog endpoint pricing is not present in config."

patterns-established:
  - "Lifecycle processor preflight: resolve catalog entry, count selected rows, enforce max_rows, then acquire durable job before mutation."
  - "Backfill selection is NULL-only and rebuild selection uses stamping columns for stale_only and mismatched_width_only with AND semantics."

requirements-completed: [REQ-035, REQ-036]

duration: ~37min
completed: 2026-06-11
---

# Phase 167 Plan 03: Lifecycle Backfill and Rebuild Summary

**Core document and memory embedding lifecycle processors for backfill and rebuild through maintain_vault**

## Performance

- **Duration:** ~37 min
- **Started:** 2026-06-11T13:41:36Z
- **Completed:** 2026-06-11T14:18:40Z
- **Tasks:** 3
- **Files modified:** 15

## Accomplishments

- Implemented `backfill_embeddings` for core documents and memories, including NULL-only selection, dry-run estimates, row failures, durable counts, background jobs, abort checkpoints, and HNSW reindex.
- Implemented `rebuild_embeddings` for core documents and memories, including confirm/max_rows guards, stale-only model predicates, mismatched-width predicates, overwrite writes, and shared lifecycle status handling.
- Wired `maintain_vault` foreground, dry-run, and background dispatch for both processors.
- Added and passed directed scenarios D-104 through D-110 using public `maintain_vault` calls.

## Task Commits

1. **Task 1: Implement backfill_embeddings for core documents and memories** - `f2cdb2b` (feat)
2. **Task 2: Implement rebuild_embeddings for core documents and memories** - `9fa7c9f` (feat)
3. **Task 3: Register public directed scenario coverage** - `94a4041` (docs)
4. **Auto-fix: Validate lifecycle background scope before lock** - `36fdcc3` (fix)

## Files Created/Modified

- `src/embedding/lifecycle/backfill.ts` - Public backfill processor entry point.
- `src/embedding/lifecycle/rebuild.ts` - Public rebuild processor entry point.
- `src/embedding/lifecycle/core-processor.ts` - Shared core document/memory lifecycle row selection, provider calls, stamped writes, dry-run estimates, durable job heartbeats, and reindexing.
- `src/services/maintenance.ts` - Concrete `maintain_vault` dispatch for backfill/rebuild/status/abort lifecycle paths.
- `src/embedding/lifecycle/types.ts` - Lifecycle failure and estimate shapes extended for public error text and cost-basis metadata.
- `src/mcp/utils/response-formats.ts` - Maintenance lifecycle response shape extended for nullable cost and failure error text.
- `tests/scenarios/directed/testcases/lifecycle_embedding_scenario_helpers.py` - Shared directed scenario setup helpers.
- `tests/scenarios/directed/testcases/test_backfill_embeddings_*.py` - D-104 through D-107 coverage.
- `tests/scenarios/directed/testcases/test_rebuild_embeddings_*.py` - D-108 through D-110 coverage.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - D-104 through D-110 matrix rows.

## Decisions Made

- Used direct PostgreSQL for lifecycle selection and reindexing while preserving `updateTargetEmbedding` for atomic vector/stamp writes.
- Returned `unsupported` for records scope with explicit Plan 5 deferral details, keeping this plan scoped to core documents and memories.
- Kept dry-run cost unknown rather than inventing pricing data.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added background preflight before durable job acquisition**
- **Found during:** Task 3 close-out
- **Issue:** The first background dispatch path acquired a durable job before repeating scope count and `max_rows` validation in the processor.
- **Fix:** Added `prepareCoreLifecycleJob` to resolve/count/validate before job insertion, then pass the preflighted job to the async processor.
- **Files modified:** `src/embedding/lifecycle/core-processor.ts`, `src/services/maintenance.ts`
- **Verification:** `npm run build`, `npm run typecheck`, and both directed suites passed after the fix.
- **Committed in:** `36fdcc3`

---

**Total deviations:** 1 auto-fixed missing critical guard.
**Impact on plan:** Strengthened REQ-040 compliance for background lifecycle actions without expanding scope.

## Issues Encountered

- The task-level `tdd="true"` RED/GREEN split was not preserved as separate failing-test commits; implementation and directed coverage were committed by task boundary instead. The plan itself is `type: execute`, and final behavioral verification passed.

## TDD Gate Compliance

- Warning: task-level TDD RED commits are missing. Scenario coverage was added and verified, but not committed as failing tests before implementation.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: provider_content_processing | `src/embedding/lifecycle/core-processor.ts` | Core document and memory text is sent to configured embedding endpoints during lifecycle operations. |
| threat_flag: lifecycle_direct_postgres | `src/embedding/lifecycle/core-processor.ts` | Lifecycle row selection, max_rows counts, and HNSW reindexing require direct PostgreSQL access. |

## Authentication Gates

None.

## Verification

- `npm run build` - passed.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_backfill_embeddings_*"` - passed, 4/4 tests.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_rebuild_embeddings_*"` - passed, 3/3 tests.
- `npm run typecheck` - passed.

## Self-Check: PASSED

- Created files exist: `src/embedding/lifecycle/backfill.ts`, `src/embedding/lifecycle/rebuild.ts`, `src/embedding/lifecycle/core-processor.ts`, and D-104 through D-110 scenario files.
- Modified files exist: `src/services/maintenance.ts`, `src/embedding/lifecycle/types.ts`, `src/mcp/utils/response-formats.ts`, `tests/scenarios/directed/DIRECTED_COVERAGE.md`.
- Commits exist: `f2cdb2b`, `9fa7c9f`, `94a4041`, `36fdcc3`.
- Required plan checks passed: build, backfill directed suite, rebuild directed suite, and typecheck.

## User Setup Required

None - no new external service configuration required. The directed verification used `.env.test` credentials and managed embedding-enabled servers.

## Next Phase Readiness

Core document and memory lifecycle work is ready for downstream retire, records-scope, lock/abort expansion, and operator recipe plans. Records-scope lifecycle remains intentionally deferred to later Phase 167 work.

---
*Phase: 167-lifecycle-operations-and-validation*
*Completed: 2026-06-11*
