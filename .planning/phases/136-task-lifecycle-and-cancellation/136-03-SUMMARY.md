---
phase: 136-task-lifecycle-and-cancellation
plan: 03
subsystem: macro
tags: [macro, cancellation, task-registry, safe-points, vitest]

requires:
  - phase: 136-task-lifecycle-and-cancellation
    provides: Instance-scoped MacroTaskRegistry and runMacroSource lifecycle wiring from 136-02
provides:
  - Dedicated MacroCancellationError with task and safe-point metadata
  - Canonical non-error cancellation envelope for evaluateProgram and runMacroSource
  - Distinct before-statement cancellation safe point coverage
  - Verified tool-call cancellation safe point after arg evaluation and before dispatch
affects: [136-task-lifecycle-and-cancellation, macro-support, call_macro, macro-builtins]

tech-stack:
  added: []
  patterns:
    - Cancellation is an internal control-flow signal, not a MacroRuntimeError
    - Safe-point labels are surfaced through snake_case cancellation envelope details
    - TDD RED coverage can extend Wave 0 tests when a planned safe-point class is under-specified

key-files:
  created:
    - .planning/phases/136-task-lifecycle-and-cancellation/136-03-SUMMARY.md
  modified:
    - src/macro/evaluator.ts
    - src/mcp/tools/macro.ts
    - tests/unit/macro-cancellation.test.ts

key-decisions:
  - "MacroCancellationError carries taskId and atSafePoint and is caught before runtime-error mapping."
  - "The evaluator keeps the existing between-statements probe before each statement and adds a distinct before-statement probe immediately before execution."
  - "runMacroSource registry cancellation now throws MacroCancellationError so lifecycle cleanup classifies it as cancelled."

patterns-established:
  - "Cancellation envelope: { error: 'cancelled', message: 'Macro cancelled', details: { task_id, at_safe_point } } with isError false."
  - "Builtin-thrown cancellation must be rethrown by evalCall instead of wrapped as builtin_failed."

requirements-completed:
  - MACRO-OBS-05
  - MACRO-OBS-04

duration: 3m13s
completed: 2026-05-14
---

# Phase 136 Plan 03: Dedicated Cancellation Signaling Summary

**Macro cancellation now returns a canonical expected-error envelope and checks every required cooperative safe-point class.**

## Performance

- **Duration:** 3m13s
- **Started:** 2026-05-14T22:17:46Z
- **Completed:** 2026-05-14T22:20:59Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added exported `MacroCancellationError` with `taskId` and `atSafePoint`.
- Mapped observed cancellation to `{ error: "cancelled", message: "Macro cancelled", details: { task_id, at_safe_point } }` with `isError: false`.
- Updated registry-backed `runMacroSource` cancellation checks to throw the dedicated signal and preserve cancelled lifecycle cleanup.
- Added RED/GREEN coverage for the distinct `before statement` safe point and implemented the probe before statement execution.
- Verified the tool-call cancellation check remains after argument evaluation and before `dispatchMacroTool`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add MacroCancellationError and canonical envelope mapping** - `7675c9f` (feat)
2. **Task 2 RED: Add before-statement cancellation coverage** - `df92781` (test)
3. **Task 2 GREEN: Complete safe-point placement** - `244fca5` (feat)

**Plan metadata:** pending final docs commit.

## Files Created/Modified

- `src/macro/evaluator.ts` - Adds `MacroCancellationError`, expected-error mapping, builtin cancellation propagation, and `before statement` safe-point checks.
- `src/mcp/tools/macro.ts` - Throws `MacroCancellationError` from registry-backed cancellation checks.
- `tests/unit/macro-cancellation.test.ts` - Adds T-U-178b coverage for cancellation before a statement side effect.
- `.planning/phases/136-task-lifecycle-and-cancellation/136-03-SUMMARY.md` - Captures plan execution results.

## Decisions Made

- Kept the existing `between statements` check before each statement so prior envelope expectations and post-tool safe-point behavior remain stable.
- Added `before statement` as a separate immediate pre-execution check, giving tests distinguishable safe-point evidence without changing macro semantics.
- Treated cancellation thrown from async builtins as the same control-flow signal as evaluator safe-point cancellation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved builtin-thrown cancellation as cancellation**
- **Found during:** Task 1 (Add MacroCancellationError and canonical envelope mapping)
- **Issue:** `sleep` threw the dedicated cancellation signal, but `evalCall` wrapped it as a runtime `builtin_failed` error.
- **Fix:** Added `MacroCancellationError` to the evaluator's builtin rethrow list.
- **Files modified:** `src/macro/evaluator.ts`
- **Verification:** `npm test -- --reporter=verbose macro-cancellation macro-task-registry` passed.
- **Committed in:** `7675c9f`

**2. [Rule 2 - Missing Critical] Added explicit before-statement RED coverage**
- **Found during:** Task 2 (Complete safe-point placement and move tool cancellation check)
- **Issue:** Existing cancellation tests did not independently prove the required `before statement` safe-point class.
- **Fix:** Added T-U-178b to assert cancellation before a statement prevents that statement's side effect.
- **Files modified:** `tests/unit/macro-cancellation.test.ts`
- **Verification:** The test failed before implementation and passed after adding the evaluator check.
- **Committed in:** `df92781`, `244fca5`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes directly enforce REQ-050 cancellation correctness. No architectural or out-of-scope changes were introduced.

## Issues Encountered

- The Task 1 GREEN attempt initially left T-U-182 red because builtin cancellation was wrapped as a runtime error. This was fixed in the Task 1 commit.
- The Task 2 RED test failed as intended before adding the `before statement` check.

## Verification

- `npm test -- --reporter=verbose macro-cancellation macro-task-registry` - passed, 2 files / 13 tests.
- `npm test -- --reporter=verbose macro-cancellation` - passed, 1 file / 8 tests.
- `npm test -- --reporter=verbose macro-cancellation macro-task-registry macro-session-scope` - passed, 3 files / 17 tests.
- Acceptance greps for `MacroCancellationError`, canonical cancellation envelope fields, absence of old cancellation runtime details, safe-point labels, and tool-call source order all passed.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - this plan used unit tests only and did not require external service configuration.

## Next Phase Readiness

Plan 136-04 can add concurrency integration and directed cancellation coverage on top of the completed registry lifecycle, session scoping, and canonical cancellation safe-point behavior.

## Self-Check: PASSED

- Key files exist: `src/macro/evaluator.ts`, `src/macro/builtins.ts`, `src/mcp/tools/macro.ts`, `tests/unit/macro-cancellation.test.ts`, and `136-03-SUMMARY.md`.
- Task commits exist: `7675c9f`, `df92781`, and `244fca5`.
- Required focused verification commands passed.

---
*Phase: 136-task-lifecycle-and-cancellation*
*Completed: 2026-05-14*
