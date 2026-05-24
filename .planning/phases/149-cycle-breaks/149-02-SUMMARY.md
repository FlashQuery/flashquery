---
phase: 149-cycle-breaks
plan: 02
subsystem: macro
tags: [macro, runtime-types, runtime-errors, circular-deps]
requires: []
provides:
  - Macro runtime type primitives outside evaluator
  - Macro runtime error classes outside evaluator
affects: [macro, evaluator, runtime]
tech-stack:
  added: []
  patterns: [compatibility re-export, dependency-light runtime primitives]
key-files:
  created: [src/macro/runtime-types.ts, src/macro/runtime-errors.ts]
  modified: [src/macro/evaluator.ts, src/macro/types.ts, src/macro/progress-emitter.ts]
key-decisions:
  - "Evaluator remains a public compatibility surface by re-exporting moved runtime types and errors."
  - "Initial runtime extraction kept helper migration for Plan 149-03."
patterns-established:
  - "Macro runtime value and error definitions are no longer owned by evaluator.ts."
requirements-completed: [REQ-011]
duration: 20 min
completed: 2026-05-24
---

# Phase 149 Plan 02: Macro Runtime Primitive Extraction Summary

**Macro runtime values, invocation context types, and error classes extracted from evaluator while preserving evaluator imports**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-24T21:05:00Z
- **Completed:** 2026-05-24T21:31:24Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created `src/macro/runtime-types.ts` and `src/macro/runtime-errors.ts`.
- Updated `src/macro/evaluator.ts` to import and re-export the moved public runtime surface.
- Updated `src/macro/types.ts` and `src/macro/progress-emitter.ts` to consume runtime primitives directly.

## Task Commits

1. **Task 1/2: Pin and extract macro runtime primitives** - `870c7ac` (feat)

**Plan metadata:** committed with phase summary artifacts.

## Files Created/Modified

- `src/macro/runtime-types.ts` - Runtime values, builtins, context, budget, progress, and task types.
- `src/macro/runtime-errors.ts` - Shared macro runtime error classes.
- `src/macro/evaluator.ts` - Imports and re-exports moved runtime surface.
- `src/macro/types.ts` - Stops depending on evaluator-owned runtime type definitions.

## Decisions Made

Preserved evaluator compatibility exports so existing tests and consumers importing runtime types/classes from `evaluator.ts` continue to work while Plan 149-03 migrates helpers to direct runtime imports.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 149-03 can migrate macro helper imports to `runtime-types.ts` and `runtime-errors.ts`.

---
*Phase: 149-cycle-breaks*
*Completed: 2026-05-24*
