---
phase: 136-task-lifecycle-and-cancellation
plan: 02
subsystem: macro
tags: [macro, task-registry, session-scope, cancellation, call-macro, vitest]

requires:
  - phase: 136-task-lifecycle-and-cancellation
    provides: Wave 0 lifecycle and session-scope tests from 136-01
provides:
  - Instance-scoped MacroTaskRegistry with working/completed/failed/cancelled lifecycle
  - Registry-backed runMacroSource task_id, session_id, list_tasks, and terminal cleanup wiring
  - MCP session identity resolver with registration-scoped fallback token
  - Tool-call cancellation check positioned after arg evaluation and before dispatch
affects: [136-task-lifecycle-and-cancellation, macro-support, call_macro, macro-builtins]

tech-stack:
  added: []
  patterns:
    - Macro task registry instances are injected into registerMacroTools/runMacroSource rather than exported as process singletons
    - Terminal task transitions notify observers then immediately remove records from the registry
    - Public call_macro uses a registration-scoped UUID fallback for session identity when MCP extra metadata has no session id

key-files:
  created:
    - src/macro/task-registry.ts
  modified:
    - src/mcp/tools/macro.ts
    - src/macro/evaluator.ts

key-decisions:
  - "Cancellation requests are tracked separately from enumerable task records so terminal records can be removed immediately while in-flight evaluation can still observe cancellation."
  - "Template metadata and purpose-template imports are lazy in src/mcp/tools/macro.ts so importing runMacroSource for registry tests does not load storage modules."
  - "Tool-call cancellation checks now run after argument evaluation and before handler dispatch."

patterns-established:
  - "MacroTaskRegistry.create returns snake_case task records for builtin output compatibility."
  - "runMacroSource owns lifecycle classification and maps success/expected/runtime/cancelled results into registry terminal cleanup."

requirements-completed:
  - MACRO-OBS-04
  - MACRO-OBS-06

duration: 4m10s
completed: 2026-05-14
---

# Phase 136 Plan 02: Task Lifecycle Registry Wiring Summary

**Instance-scoped macro task registry with session-filtered visibility and runMacroSource lifecycle cleanup for real macro runs.**

## Performance

- **Duration:** 4m10s
- **Started:** 2026-05-14T22:10:20Z
- **Completed:** 2026-05-14T22:14:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `MacroTaskRegistry` with `working`, `completed`, `failed`, and `cancelled` states, UUID task IDs, session filtering, same-session cancellation enforcement, and immediate terminal-record removal.
- Wired `runMacroSource` to create a task before evaluation, pass `taskId`, `sessionId`, registry-backed `listTasks`, and cancellation checks into `evaluateProgram`, then clean terminal records.
- Added `registerMacroTools` registry/session injection with a registration-scoped UUID fallback, while preserving Phase 135 template metadata and hard-exclusion flow.
- Moved the evaluator tool-call cancellation safe point to after argument evaluation and before dispatch.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement instance-scoped MacroTaskRegistry** - `285fba9` (feat)
2. **Task 2: Wire real macro run lifecycle through runMacroSource** - `0f6ba3d` (feat)

## Files Created/Modified

- `src/macro/task-registry.ts` - New instance-scoped in-memory registry with lifecycle, session filtering, cancellation requests, and transition listeners.
- `src/mcp/tools/macro.ts` - Adds registry/session injection, real-run task lifecycle ownership, registry-backed `list_tasks`, cancellation checks, and lazy template metadata imports.
- `src/macro/evaluator.ts` - Moves the tool-call cancellation safe point after argument evaluation and before dispatch.

## Decisions Made

- Kept terminal task records non-enumerable immediately after `complete`, `fail`, or `cancel`, matching REQ-049.
- Stored cancellation requests outside the task record map so tests and later safe-point wiring can observe cancellation without retaining terminal records.
- Used MCP handler `extra` session metadata when available, then a registration-scoped UUID fallback, never `config.instance.id`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lazily loaded storage-backed template metadata dependencies**
- **Found during:** Task 1 (Implement instance-scoped MacroTaskRegistry)
- **Issue:** Importing `runMacroSource` in registry tests loaded template/storage modules at top level, tripping the test guard that the registry path must not import Supabase storage.
- **Fix:** Converted template metadata and native catalog imports in `src/mcp/tools/macro.ts` to lazy imports on the public MCP execution path.
- **Files modified:** `src/mcp/tools/macro.ts`
- **Verification:** `npm test -- --reporter=verbose macro-task-registry macro-session-scope` passed.
- **Committed in:** `285fba9`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was required for the focused registry tests to prove storage isolation. It did not add persistence, external task methods, or new architecture.

## Issues Encountered

- Task 2 focused tests were already green after the Task 1 lifecycle wiring because the Task 1 red tests exercised part of `runMacroSource`; Task 2 still added the required evaluator safe-point position and session metadata resolver before commit.

## Verification

- `npm test -- --reporter=verbose macro-task-registry macro-session-scope` - passed, 2 files / 9 tests.
- `npm test -- --reporter=verbose macro-task-registry macro-builtins` - passed, 2 files / 41 tests.
- `npm test -- --reporter=verbose macro-task-registry macro-session-scope macro-builtins` - passed, 3 files / 44 tests.
- Acceptance greps for registry exports, terminal statuses, no storage/TTL/external task protocol coupling, registry/session lifecycle wiring, Phase 135 template metadata preservation, no `knownToolNames`, no config-wide session fallback, and T-U coverage IDs passed.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - this plan used unit tests only and did not require external service configuration.

## Next Phase Readiness

Plan 136-03 can build on the registry-backed lifecycle by replacing the temporary cancellation runtime classification with the dedicated `MacroCancellationError` envelope and expanding safe-point behavior for the cancellation suite.

## Self-Check: PASSED

- Key files exist: `src/macro/task-registry.ts`, `src/mcp/tools/macro.ts`, `src/macro/evaluator.ts`, and `136-02-SUMMARY.md`.
- Task commits exist: `285fba9` and `0f6ba3d`.
- Required focused verification commands passed.

---
*Phase: 136-task-lifecycle-and-cancellation*
*Completed: 2026-05-14*
