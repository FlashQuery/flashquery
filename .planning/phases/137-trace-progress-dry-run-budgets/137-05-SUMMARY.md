---
phase: 137-trace-progress-dry-run-budgets
plan: 05
subsystem: testing
tags: [macro, directed-scenarios, validation]
requires:
  - phase: 137-trace-progress-dry-run-budgets
    provides: trace, progress, dry-run, and budget implementation
provides:
  - Directed public trace/progress/timeout scenarios
  - Phase 137 validation evidence
affects: [directed-scenarios, validation]
tech-stack:
  added: []
  patterns: [managed directed macro scenarios, progress notification capture]
key-files:
  created: [tests/scenarios/directed/testcases/test_macro_trace_full_summary_none.py, tests/scenarios/directed/testcases/test_macro_progress_milestones.py, tests/scenarios/directed/testcases/test_macro_budget_timeout.py]
  modified: [tests/scenarios/framework/fqc_client.py, tests/scenarios/directed/DIRECTED_COVERAGE.md, .planning/phases/137-trace-progress-dry-run-budgets/137-VALIDATION.md]
key-decisions:
  - "Used ML-18, ML-19, and ML-20 to avoid collisions with existing macro lifecycle and memory rows."
patterns-established:
  - "FQCClient.call_tool_with_progress sends params._meta.progressToken and captures matching notifications/progress messages."
requirements-completed: [MACRO-OBS-02, MACRO-OBS-03, MACRO-RESP-05, MACRO-INT-04, MACRO-INT-07]
duration: 1h 20m
completed: 2026-05-15
---

# Phase 137 Plan 05: Directed Validation Summary

**Public call_macro scenarios for trace modes, progress tokens, and timeout budgets with validation evidence**

## Accomplishments

- Added three managed directed scenarios for T-S-016, T-S-017, and T-S-018.
- Registered ML-18, ML-19, and ML-20 coverage rows without colliding with existing IDs.
- Recorded unit, integration, directed, and build validation in `137-VALIDATION.md`.

## Task Commits

Completed as part of the final Phase 137 implementation commit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The directed runner reported shared DB cleanup timeout warnings; all three directed scenarios passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 137 is ready for phase-level verification and roadmap closure.
