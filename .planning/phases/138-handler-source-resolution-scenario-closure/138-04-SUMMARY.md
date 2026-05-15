---
phase: 138-handler-source-resolution-scenario-closure
plan: 04
subsystem: testing
tags: [macro, call_macro, source_ref, archive, write-lock, yaml-scenarios, poc-fixtures]

requires:
  - phase: 138-handler-source-resolution-scenario-closure
    provides: handler source transport closure and prior macro scenario coverage
provides:
  - directed source_ref, archived source_ref, and archive write-lock scenario coverage
  - YAML macro workflow coverage for search/archive, call_model branching, input_vars, and write locks
  - migrated macro POC fixture execution coverage through runMacroSource
affects: [macro-language, scenario-coverage, call_macro, source-resolution]

tech-stack:
  added: []
  patterns:
    - directed managed scenario coverage for macro source resolution edges
    - YAML integration macro workflows with explicit coverage IDs
    - unit-level migrated fixture execution with deterministic native and broker stubs

key-files:
  created:
    - tests/scenarios/directed/testcases/test_macro_source_ref_named_block.py
    - tests/scenarios/directed/testcases/test_macro_source_ref_error_matrix.py
    - tests/scenarios/directed/testcases/test_macro_archived_source_ref.py
    - tests/scenarios/directed/testcases/test_macro_archive_write_lock.py
    - tests/scenarios/integration/tests/macro_search_archive_workflow.yml
    - tests/scenarios/integration/tests/macro_call_model_branch_mutate.yml
    - tests/scenarios/integration/tests/macro_input_vars_iteration.yml
    - tests/scenarios/integration/tests/macro_sequential_write_lock.yml
    - tests/unit/macro-poc-fixtures.test.ts
    - tests/fixtures/macro/poc-examples/
  modified:
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md

key-decisions:
  - "Used positional scenario runner filters because the directed and YAML runners reject the plan's --filter spelling."
  - "Assigned IS-13 and IS-14 to new YAML search/archive and input_vars coverage because IS-09, IS-11, and IS-12 were already occupied by prior macro scenarios."
  - "Kept the POC fixture suite deterministic by executing through runMacroSource with native and broker stubs plus a local sample vault."

patterns-established:
  - "Macro POC examples are preserved under tests/fixtures/macro/poc-examples and executed as fixtures, not only stored as samples."
  - "Scenario coverage files document substituted IDs when the product test-plan slots are already consumed."

requirements-completed: [MACRO-SRC-01, MACRO-SRC-02, MACRO-SRC-03, MACRO-SRC-04, MACRO-INT-02]

duration: 51m
completed: 2026-05-15
---

# Phase 138 Plan 04: Handler Source Resolution Scenario Closure Summary

**Macro scenario closure with directed source_ref/archive coverage, YAML workflow coverage, and 17 migrated POC fixtures executed through runMacroSource**

## Performance

- **Duration:** 51 min
- **Started:** 2026-05-15T04:17:45Z
- **Completed:** 2026-05-15T05:07:58Z
- **Tasks:** 3
- **Files modified:** 35

## Accomplishments

- Added four directed managed scenarios for named source_ref blocks, source_ref errors, archived source resolution, and archive write-lock behavior.
- Added four YAML macro integration workflows covering search/archive, call_model branching, list input_vars iteration, and write-lock-backed writes.
- Added TDD coverage for 17 migrated macro POC fixtures, with RED and GREEN commits and deterministic fixture execution through `runMacroSource`.

## Task Commits

1. **Task 1: Add directed source_ref/archive/write-lock scenarios** - `48843e1` (test)
2. **Task 2: Add YAML workflow scenarios** - `139fe42` (test)
3. **Task 3 RED: Add failing POC fixture execution test** - `82f2ca4` (test)
4. **Task 3 GREEN: Add migrated POC fixtures and passing execution coverage** - `b71e4ff` (feat)

## Verification

- `python3 tests/scenarios/directed/run_suite.py --managed macro` - PASS 15/15. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-15-020129.md`.
- `python3 tests/scenarios/integration/run_integration.py --managed macro` - PASS 7/7. Report: `tests/scenarios/integration/reports/integration-report-2026-05-15-020738.md`.
- `npm test -- --reporter=verbose macro-poc-fixtures` - PASS 2/2.
- `find tests/fixtures/macro/poc-examples -type f | wc -l` - 23 files, including all 17 `.fqm` POC fixtures plus README and sample-vault data.
- `rg -n "17|poc|runMacroSource|it.each|describe.each" tests/unit/macro-poc-fixtures.test.ts tests/fixtures/macro/poc-examples` - PASS.

Directed scenario runs repeatedly emitted non-fatal `clean_test_tables.py` timeout warnings during per-test cleanup. The managed suite still completed successfully with exit code 0.

## Files Created/Modified

- `tests/scenarios/directed/testcases/test_macro_source_ref_named_block.py` - T-S-004 named block source_ref coverage.
- `tests/scenarios/directed/testcases/test_macro_source_ref_error_matrix.py` - T-S-005 source_ref validation and error taxonomy coverage.
- `tests/scenarios/directed/testcases/test_macro_archived_source_ref.py` - T-S-019 archived document source_ref rejection coverage.
- `tests/scenarios/directed/testcases/test_macro_archive_write_lock.py` - T-S-020 macro archive write-lock coverage.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Added ML-21 through ML-24 rows.
- `tests/scenarios/integration/tests/macro_search_archive_workflow.yml` - T-Y-001 search/archive workflow.
- `tests/scenarios/integration/tests/macro_call_model_branch_mutate.yml` - T-Y-002 call_model branch/mutate workflow.
- `tests/scenarios/integration/tests/macro_input_vars_iteration.yml` - T-Y-003 input_vars iteration workflow.
- `tests/scenarios/integration/tests/macro_sequential_write_lock.yml` - T-Y-004 sequential write-lock workflow; parallel contention is covered by `macro-write-lock.integration.test.ts`.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Added IS-10, IS-13, IS-14, and IA-09 rows with substitution note.
- `tests/unit/macro-poc-fixtures.test.ts` - Unit execution suite for migrated POC fixtures.
- `tests/fixtures/macro/poc-examples/` - 17 migrated `.fqm` fixtures, README, and sample vault data.

## Decisions Made

- Used runner-supported positional filters instead of `--filter`; both scenario runners reject `--filter` as an unknown argument.
- Used `IS-13` and `IS-14` for two YAML scenarios because live coverage already occupied the product test-plan slots.
- Reduced POC fixture `slow_op` durations to 1 ms while preserving the cancellation workflow shape so unit execution stays fast and deterministic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced unsupported scenario runner filter flag**
- **Found during:** Task 1 and Task 2 verification
- **Issue:** The plan specified `--filter`, but `run_suite.py` and `run_integration.py` only accept positional filters.
- **Fix:** Ran equivalent positional filters and documented the mismatch.
- **Files modified:** None.
- **Verification:** Directed macro suite passed 15/15; YAML macro suite passed 7/7.
- **Committed in:** Not applicable; verification-only deviation.

**2. [Rule 1 - Bug] Corrected YAML response_format and search assertion behavior**
- **Found during:** Task 2 YAML verification
- **Issue:** The initial call_model YAML used an invalid response_format shape for the live provider path, and the search/archive scenario asserted against echoed query text instead of the structured empty result.
- **Fix:** Switched the YAML to `response_format: { type: "json_object" }`, branched on the returned response, added required cleanup tool exposure, and used `expect_empty` for the archived search result.
- **Files modified:** `tests/scenarios/integration/tests/macro_call_model_branch_mutate.yml`, `tests/scenarios/integration/tests/macro_search_archive_workflow.yml`
- **Verification:** `python3 tests/scenarios/integration/run_integration.py --managed macro` passed 7/7.
- **Committed in:** `139fe42`

---

**Total deviations:** 2 auto-fixed.
**Impact on plan:** Verification and scenario intent were preserved. No architectural changes or scope expansion.

## Issues Encountered

- The directed cleanup helper timed out repeatedly during scenario cleanup, but all directed scenarios passed and the runner exited 0.
- The TDD RED test initially had an invalid top-level `await` pattern; this was corrected before the RED commit so the committed RED failure was the intended missing fixture directory.

## Known Stubs

None blocking. `TODO` strings in macro fixture files and sample-vault specs are intentional fixture data for shell pipeline coverage, not implementation stubs.

## Threat Flags

None. This plan added tests, scenario fixtures, and fixture data only; no new runtime network endpoints, auth paths, file access paths, or trust-boundary schema changes were introduced.

## User Setup Required

None.

## Next Phase Readiness

Phase 138 has scenario closure coverage for handler source resolution, archive behavior, write locks, YAML workflows, and migrated POC fixture execution. The remaining risk is scenario-runner cleanup slowness, which is environmental and did not block pass results.

## Self-Check: PASSED

- Summary file created: `.planning/phases/138-handler-source-resolution-scenario-closure/138-04-SUMMARY.md`
- Task commits found: `48843e1`, `139fe42`, `82f2ca4`, `b71e4ff`
- Key files exist: directed scenarios, YAML scenarios, POC fixture test, and 17 migrated `.fqm` fixtures

---
*Phase: 138-handler-source-resolution-scenario-closure*
*Completed: 2026-05-15*
