---
phase: 136-task-lifecycle-and-cancellation
plan: 01
subsystem: macro
tags: [macro, task-registry, cancellation, session-scope, vitest, red-tests]

requires:
  - phase: 135-tool-registry-dispatch-permissions
    provides: runMacroSource, registry-backed macro dispatch, and public call_macro wiring
provides:
  - Wave 0 red-test contract for MacroTaskRegistry lifecycle behavior
  - Wave 0 red-test contract for cooperative cancellation safe points
  - Wave 0 red-test contract for session-scoped task listing and cancellation
  - Registry-backed list_tasks builtin coverage extension
affects: [136-task-lifecycle-and-cancellation, macro-support, call_macro, macro-builtins]

tech-stack:
  added: []
  patterns:
    - Wave 0 tests intentionally fail until Phase 136 production registry and cancellation behavior land
    - Session-scope tests assert both registry filtering and defensive builtin output stripping

key-files:
  created:
    - tests/unit/macro-task-registry.test.ts
    - tests/unit/macro-cancellation.test.ts
    - tests/unit/macro-session-scope.test.ts
  modified:
    - tests/unit/macro-builtins.test.ts

key-decisions:
  - "Wave 0 tests import the planned instance-scoped MacroTaskRegistry from src/macro/task-registry.js, leaving the suite red until Plan 136-02 creates the production module."
  - "Cancellation tests pin MacroCancellationError as a non-error envelope path instead of accepting the current runtime-error mapping."
  - "Existing T-U-124/T-U-125 builtin coverage was extended with a registry-backed provider because the prior provider-only test did not prove real session filtering."

patterns-established:
  - "Task lifecycle tests assert immediate terminal-record removal and explicitly exclude persistence, TTL, and external MCP task protocol scope."
  - "Cancellation tests capture post-cancel side-effect boundaries with marker arrays and tool-call counters."

requirements-completed:
  - MACRO-OBS-04
  - MACRO-OBS-05
  - MACRO-OBS-06

duration: 4m
completed: 2026-05-14
---

# Phase 136 Plan 01: Task Lifecycle And Cancellation Red-Test Summary

**Wave 0 Vitest contracts now define task registry lifecycle, cooperative cancellation safe points, and session-scoped task visibility before production implementation.**

## Performance

- **Duration:** 4m
- **Started:** 2026-05-14T22:02:51Z
- **Completed:** 2026-05-14T22:06:51Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added lifecycle red tests for T-U-172 through T-U-177, including UUID task IDs, state vocabulary, terminal cleanup, and no persistence/task-protocol coupling.
- Added cancellation red tests for T-U-178 through T-U-184, including safe-point placement, post-cancel side-effect boundaries, chunked sleep cancellation, and the canonical non-error envelope.
- Added session-scope red tests for T-U-185/T-U-186, including cross-session list filtering and cancellation refusal.
- Extended `macro-builtins` T-U-125 coverage to require a real `MacroTaskRegistry.list(sessionId)` provider.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add lifecycle registry red tests** - `7ce2350` (test)
2. **Task 2: Add cancellation safe-point red tests** - `41da795` (test)
3. **Task 3: Add session scope red tests and builtin gaps** - `e87af3e` (test)

## Files Created/Modified

- `tests/unit/macro-task-registry.test.ts` - Defines T-U-172 through T-U-177 lifecycle and immediate cleanup contract.
- `tests/unit/macro-cancellation.test.ts` - Defines T-U-178 through T-U-184 safe-point and cancellation envelope contract.
- `tests/unit/macro-session-scope.test.ts` - Defines T-U-185/T-U-186 session-scoped list/cancel contract.
- `tests/unit/macro-builtins.test.ts` - Keeps T-U-124/T-U-125 coverage and adds registry-backed `list_tasks` provider coverage.

## Decisions Made

- Imported the planned `MacroTaskRegistry` module directly so the registry/session tests fail clearly until the production module lands.
- Used the planned `MacroCancellationError` path to make the current runtime-error cancellation behavior visibly red.
- Left external MCP Tasks protocol, durable persistence, TTLs, and terminal-record retention out of the test contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Focused Wave 0 tests are intentionally red:
  - `macro-task-registry` and `macro-session-scope` fail because `src/macro/task-registry.js` is not implemented yet.
  - `macro-cancellation` fails because cancellation still maps to a runtime `isError: true` result instead of the required `{ error: "cancelled", message: "Macro cancelled", details: { task_id, at_safe_point } }` envelope with `isError: false`.

## Verification

- `npm test -- --reporter=verbose macro-task-registry` - red as expected: missing planned `src/macro/task-registry.js`.
- `npm test -- --reporter=verbose macro-cancellation` - red as expected: seven tests execute and fail on current `isError: true` cancellation behavior.
- `npm test -- --reporter=verbose macro-session-scope macro-builtins` - red as expected: missing planned `src/macro/task-registry.js`.
- `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope` - red as expected for the same Wave 0 reasons.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - this plan added unit tests only and did not require external services.

## Next Phase Readiness

Plan 136-02 can implement `src/macro/task-registry.ts`, registry injection into `runMacroSource`, terminal cleanup, and registry-backed `list_tasks` behavior against these tests. Plan 136-03 can then make the cancellation suite green by adding a dedicated cancellation signal and moving the tool-call safe point after arg evaluation.

## Self-Check: PASSED

- Key files exist: `tests/unit/macro-task-registry.test.ts`, `tests/unit/macro-cancellation.test.ts`, `tests/unit/macro-session-scope.test.ts`, `tests/unit/macro-builtins.test.ts`, and `136-01-SUMMARY.md`.
- Task commits exist: `7ce2350`, `41da795`, and `e87af3e`.
- Required Wave 0 verification commands ran and failed only on the planned missing production exports/behavior.

---
*Phase: 136-task-lifecycle-and-cancellation*
*Completed: 2026-05-14*
