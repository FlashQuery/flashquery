---
phase: 155-per-file-tier-1-live-defect-close
plan: 03
subsystem: scenarios
tags: [directed-scenarios, vault-write-coherency, validation]
requires:
  - phase: 155-01
    provides: document-lock facade
  - phase: 155-02
    provides: document and compound per-file lock migration
provides:
  - Directed scenario evidence for D-WCO-01, D-WCO-04, and D-WCO-08
  - Final Phase 155 command evidence
affects: [directed-scenarios, validation]
tech-stack:
  added: []
  patterns:
    - Directed lock scenarios force a dedicated managed server with enable_locking=True
key-files:
  created:
    - tests/scenarios/directed/testcases/test_per_file_lock_parallel.py
    - tests/scenarios/directed/testcases/test_apply_tags_no_lost_update.py
    - tests/scenarios/directed/testcases/test_parallel_macros_per_file_lock.py
  modified:
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
key-decisions:
  - "Directed scenarios verify public tool responses and vault state, not private database rows."
requirements-completed: [REQ-001, REQ-010, REQ-025]
duration: 25 min
completed: 2026-05-26
---

# Phase 155 Plan 03: Directed Lock Evidence Summary

**Public directed scenarios prove Phase 155 per-file write locking, apply_tags no-lost-update behavior, and macro per-step lock semantics**

## Performance

- **Duration:** 25 min
- **Started:** 2026-05-26T15:33:00Z
- **Completed:** 2026-05-26T15:57:53Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added D-WCO-01 / T-S-001 public scenario for parallel `write_document` calls to different files.
- Added D-WCO-04 / T-S-004 public scenario for concurrent `apply_tags` preserving disjoint tag updates.
- Added D-WCO-08 / T-S-008 public scenario for parallel `call_macro` invocations relying on per-step locks.
- Registered the three scenarios in `DIRECTED_COVERAGE.md`.

## Task Commits

1. **Task 155-03-01: Add directed lock scenarios and coverage rows** - `1c13908` (test)
2. **Task 155-03-02: Run final Phase 155 evidence and write summary** - this docs commit

## Required Test ID Evidence

- T-U-001, T-U-002: `tests/unit/document-lock-registry.test.ts` — passed in targeted unit runs.
- T-U-016, T-U-017, T-U-018: `tests/unit/with-document-lock.test.ts` — passed in targeted unit runs.
- T-U-019: `tests/unit/lock-helper-only.test.ts` — passed in targeted unit runs.
- T-U-038: `tests/unit/macro-no-lock-imports.test.ts` — passed in targeted unit runs.
- T-I-001, T-I-002, T-I-017, T-I-018: `tests/unit/document-tool-lock-call-sites.test.ts` static migration scaffolding — passed.
- T-I-049, T-I-050, T-I-051: REQ-025 macro boundary covered by `tests/unit/macro-no-lock-imports.test.ts`, `src/mcp/tool-help/call_macro.tool.md`, and D-WCO-08. Phase 155 records T-I-050 version-token threading as deferred boundary behavior per plan.
- T-S-001 / D-WCO-01: `test_per_file_lock_parallel.py` — passed.
- T-S-004 / D-WCO-04: `test_apply_tags_no_lost_update.py` — passed.
- T-S-008 / D-WCO-08: `test_parallel_macros_per_file_lock.py` — passed.

## Verification

- `python3 -m py_compile tests/scenarios/directed/testcases/test_per_file_lock_parallel.py tests/scenarios/directed/testcases/test_apply_tags_no_lost_update.py tests/scenarios/directed/testcases/test_parallel_macros_per_file_lock.py` — passed.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_per_file_lock_parallel.py test_apply_tags_no_lost_update.py test_parallel_macros_per_file_lock.py` — passed in 1m 13.5s; 3 tests passed; 0 failed; 0 residue.
- Scenario report: `tests/scenarios/directed/reports/scenario-report-2026-05-26-125626.md`.

## Deviations from Plan

None - plan executed as directed, with one evidence note: the Vitest integration selector from 155-02 was inconclusive and is documented in `155-02-SUMMARY.md`; directed scenario evidence passed with strict cleanup.

## Issues Encountered

None for the directed scenario run.

## User Setup Required

None - `.env.test` credentials were present and sufficient for the managed directed suite.

## Next Phase Readiness

Phase 155 is ready for phase-level verification and completion gates.

---
*Phase: 155-per-file-tier-1-live-defect-close*
*Completed: 2026-05-26*
