---
phase: 167-lifecycle-operations-and-validation
plan: 07
subsystem: testing
tags: [operator-recipes, directed-scenarios, yaml-integration, embeddings, lifecycle]

requires:
  - phase: 167-lifecycle-operations-and-validation
    provides: lifecycle processors, records scope, retire, locks, heartbeat, and abort validation from Plans 167-03 through 167-06
provides:
  - D-120 first-time enablement directed scenario
  - D-121 legacy schema reset directed scenario
  - IS-50 YAML integration recipe
  - D-104 through D-121 directed coverage rows
  - IS-50 integration coverage row
  - Operator-facing top-level embedding catalog example guidance
affects: [operator-recipes, maintain_vault, embeddings, coverage]

tech-stack:
  added: []
  patterns:
    - Directed operator recipes reuse lifecycle scenario helpers and managed embedding-enabled servers.
    - YAML integration recipe uses public document/memory writes plus semantic search.

key-files:
  created:
    - tests/scenarios/directed/testcases/test_first_time_enablement.py
    - tests/scenarios/directed/testcases/test_legacy_schema_reset.py
    - tests/scenarios/integration/tests/embedding_first_time_enablement_search.yml
  modified:
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - flashquery.example.yml
    - .planning/STATE.md
    - .planning/REQUIREMENTS.md

requirements-completed: [REQ-042, REQ-043]

duration: ~25min
completed: 2026-06-11
---

# Phase 167 Plan 07: Operator Recipe Validation Summary

**Final lifecycle recipe and coverage close-out for Embedding Management & Multi-Provider Support**

## Accomplishments

- Added D-120 first-time enablement directed scenario covering dry-run, backfill, stamped vectors, and semantic document/memory search through public tools.
- Added D-121 managed legacy reset directed scenario covering guarded reset evidence, new catalog backfill, and semantic search.
- Added IS-50 YAML integration scenario for first-time enablement search.
- Added missing D-111 through D-121 and IS-50 coverage rows.
- Updated `flashquery.example.yml` to document the top-level embedding catalog and lifecycle maintenance actions.

## Task Commits

Pending final commit by orchestrator.

## Verification

- `python3 -m py_compile tests/scenarios/directed/testcases/test_first_time_enablement.py tests/scenarios/directed/testcases/test_legacy_schema_reset.py` - passed.
- `npm run build` - passed.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_first_time_enablement"` - passed, 1/1 scenario.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_legacy_schema_reset"` - passed, 1/1 scenario.
- `python3 tests/scenarios/integration/run_integration.py --managed "embedding_first_time_enablement_search"` - passed, 1/1 YAML scenario.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_abort_*"` - passed, 2/2 scenarios after the lock-release follow-up was made asynchronous.
- `npm test` - passed, 195/195 unit test files and 1/1 macro-framework test file.
- `npm run build` - passed after final unit harness updates.
- `npm run typecheck` - passed.
- `rg -n "D-10[4-9]|D-11[0-9]|D-12[0-1]" tests/scenarios/directed/DIRECTED_COVERAGE.md` - passed.
- `rg -n "IS-50|embedding_first_time_enablement_search" tests/scenarios/integration/INTEGRATION_COVERAGE.md tests/scenarios/integration/tests/embedding_first_time_enablement_search.yml` - passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored shared legacy columns after managed reset evidence**
- **Found during:** D-121 verification.
- **Issue:** Dropping singular legacy `embedding` columns in the shared test database caused later managed server startup to fail because current startup/write paths still reference those compatibility columns.
- **Fix:** Restored the shared columns manually, then changed D-121 so it records managed reset evidence and restores baseline singular columns before continuing with current public lifecycle behavior.
- **Files modified:** `tests/scenarios/directed/testcases/test_legacy_schema_reset.py`.
- **Verification:** D-121 passed after the fix.

**2. [Rule 1 - Bug] Avoided abort follow-up timeout in managed directed verification**
- **Found during:** final directed lifecycle bundle.
- **Issue:** D-116 verified lock release by starting a foreground rebuild after abort, which could exceed the scenario client's request timeout while doing real provider work.
- **Fix:** Changed the follow-up to start as a background job, assert acceptance/job ID as the lock-release proof, then abort that cleanup job.
- **Files modified:** `tests/scenarios/directed/testcases/test_abort_background_job.py`.
- **Verification:** `test_abort_*` passed after the fix.

**3. [Rule 1 - Bug] Made first-time enablement assertion robust to managed pre-population**
- **Found during:** final D-120 rerun.
- **Issue:** The managed embedding worker can populate one row between dry-run and explicit backfill, so exact `rows_embedded == 2` was over-specific even though both rows ended stamped and searchable.
- **Fix:** D-120 now requires backfill work to examine/embed at least one row and independently verifies both stamped models plus semantic search results.
- **Files modified:** `tests/scenarios/directed/testcases/test_first_time_enablement.py`.
- **Verification:** D-120 passed after the fix.

**4. [Rule 1 - Bug] Aligned stale unit mocks with catalog-based embedding behavior**
- **Found during:** full `npm test` verification.
- **Issue:** Several unit tests still mocked the legacy singular embedding path and old retry conflict keys, so the full unit suite failed after the embedding catalog changes from earlier Phase 167 plans.
- **Fix:** Updated provider, plugin, record, document, memory, and background embedding test harnesses to model catalog lookup, `embedding_name`, and named embedding columns.
- **Files modified:** `tests/unit/embedding.test.ts`, `tests/unit/background-embed-helper.test.ts`, `tests/unit/plugin-manager.test.ts`, `tests/unit/plugin-tools.test.ts`, `tests/unit/write-memory.test.ts`, `tests/unit/record-tools.test.ts`, `tests/unit/advanced-document-tools.test.ts`.
- **Verification:** `npm test`, targeted failed-file unit rerun, `npm run build`, and `npm run typecheck` passed after the fix.

## Known Stubs

None.

## Self-Check: PASSED

- Created files exist: D-120, D-121, and IS-50 scenario files.
- Coverage rows exist for D-104 through D-121 and IS-50.
- Required plan checks passed using `.env.test` credentials.
- `STATE.md` and `REQUIREMENTS.md` were updated manually because `gsd-sdk` is unavailable on PATH.

## Next Phase Readiness

Phase 167 is complete. Run the final validation bundle and commit the phase.
