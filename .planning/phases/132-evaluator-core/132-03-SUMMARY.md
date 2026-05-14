---
phase: 132-evaluator-core
plan: 03
subsystem: macro
tags: [macro, evaluator, termination, toolresult, errors]
requires:
  - phase: 132-evaluator-core
    provides: Evaluator expression and pipeline execution from plans 01 and 02.
provides:
  - Fall-off, exit, fail, expected tool value, and runtime failure envelope mapping.
  - Tool dispatch normalization for injected tool handlers.
affects: [macro-evaluator, macro-runtime, mcp-response-formats]
tech-stack:
  added: []
  patterns: [control-flow errors, canonical ToolResult mapping, tool payload normalization]
key-files:
  created: [tests/unit/macro-termination.test.ts]
  modified: [src/macro/evaluator.ts]
key-decisions:
  - "exit and fail are evaluator control calls for Phase 132 so bare parsed Pipeline statements terminate correctly."
  - "ToolResult isError:false payloads continue as MacroValue objects; isError:true or thrown handlers become runtime errors."
patterns-established:
  - "Terminal evaluator conditions are mapped at one evaluateProgram boundary."
requirements-completed: [MACRO-EVAL-06]
duration: 68min
completed: 2026-05-14
---

# Phase 132-03: Evaluator Termination Summary

**Canonical macro success, expected abort, and runtime failure ToolResult envelopes for evaluator termination paths**

## Performance

- **Duration:** 68 min
- **Started:** 2026-05-14T13:31:13Z
- **Completed:** 2026-05-14T13:38:23Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Exported `MacroExitError` and `MacroFailError`.
- Implemented fall-off success, `exit`, `fail`, multi-argument `exit` validation, and terminal trace entries.
- Added tool call dispatch normalization for expected envelopes and fatal tool failures.

## Task Commits

Executed inline in this runtime; implementation and summaries are included in the final Phase 132 commit.

## Files Created/Modified

- `src/macro/evaluator.ts` - Termination classes, envelope mapping, tool dispatch evaluation.
- `tests/unit/macro-termination.test.ts` - T-U-084 through T-U-091 coverage.

## Decisions Made

- Mapped multi-argument `exit` to `jsonExpectedError` with `error: "invalid_input"` and `details.reason: "exit_argument_count"`.
- Parsed first JSON text payload from ToolResult-like tool responses for macro-visible values and underlying error details.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04 can verify per-invocation isolation and cooperative cancellation safe-point hooks.

---
*Phase: 132-evaluator-core*
*Completed: 2026-05-14*
