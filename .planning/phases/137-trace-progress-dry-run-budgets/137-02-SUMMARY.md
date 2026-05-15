---
phase: 137-trace-progress-dry-run-budgets
plan: 02
subsystem: macro
tags: [macro, trace, warnings]
requires:
  - phase: 137-trace-progress-dry-run-budgets
    provides: Phase 137 trace and warning contract tests
provides:
  - TraceBuilder with full, summary, and none modes
  - Trace truncation warnings and broker_unavailable warning propagation
affects: [macro-engine, response-formats]
tech-stack:
  added: []
  patterns: [per-invocation helper state, warning collection]
key-files:
  created: [src/macro/trace-builder.ts]
  modified: [src/macro/evaluator.ts, src/macro/builtins.ts, src/mcp/utils/response-formats.ts]
key-decisions:
  - "Applied trace filtering at write time through TraceBuilder rather than at response serialization."
patterns-established:
  - "Warnings are collected per invocation and attached with withWarnings only when non-empty."
requirements-completed: [MACRO-OBS-02, MACRO-RESP-05]
duration: 1h 20m
completed: 2026-05-15
---

# Phase 137 Plan 02: Trace And Warnings Summary

**Mode-aware macro trace writer with 2KB value truncation and per-invocation warning propagation**

## Accomplishments

- Created `TraceBuilder` for `full`, `summary`, and `none` behavior.
- Routed evaluator and builtin trace writes through the builder.
- Added `trace_value_truncated`, `progress_throttled`, and `broker_unavailable` warning codes.

## Task Commits

Completed as part of the final Phase 137 implementation commit.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

An async `_exists()` warning path initially missed `await`; fixed before final validation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for progress emitter integration in Plan 03.
