---
phase: 149-cycle-breaks
plan: 03
subsystem: macro
tags: [macro, helper-imports, circular-deps, madge]
requires:
  - phase: 149-02
    provides: Macro runtime type/error modules
provides:
  - Macro helper imports pointed at runtime primitives instead of evaluator
  - Dependency-light runtime modules with no helper back edge
affects: [macro, evaluator, helper-modules]
tech-stack:
  added: []
  patterns: [direct runtime primitive imports]
key-files:
  created: []
  modified: [src/macro/builtins.ts, src/macro/shell-verbs.ts, src/macro/dispatcher.ts, src/macro/registry.ts, src/macro/budget.ts, src/macro/coerce.ts, src/macro/dry-run.ts, src/macro/forbidden-flag-scan.ts, src/macro/introspection.ts, src/macro/path-wrapper.ts, src/macro/preflight.ts, src/macro/task-registry.ts, src/macro/runtime-types.ts, src/macro/runtime-errors.ts, src/macro/types.ts, tests/macro-framework/src/framework-mirror-check.ts]
key-decisions:
  - "Runtime modules use structural interfaces for budget/progress/registry surfaces to avoid type-only madge cycles."
  - "Updated the macro framework file hash after confirming the wrapped registry function hash was unchanged."
patterns-established:
  - "Macro helpers import types/errors directly from runtime modules, not evaluator.ts."
requirements-completed: [REQ-011]
duration: 25 min
completed: 2026-05-24
---

# Phase 149 Plan 03: Macro Helper Import Migration Summary

**Macro helper modules now consume runtime primitives directly, with evaluator removed from helper runtime import paths**

## Performance

- **Duration:** 25 min
- **Started:** 2026-05-24T21:15:00Z
- **Completed:** 2026-05-24T21:31:24Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments

- Migrated core execution helpers and guardrail/support helpers from `./evaluator.js` runtime imports to `runtime-types.js` and `runtime-errors.js`.
- Updated macro framework mirror pin after confirming registry behavior function hash did not change.
- Removed accidental runtime module back edges surfaced by raw madge by making runtime types structural and dependency-light.

## Task Commits

1. **Task 1/2: Migrate macro helper runtime imports** - `29644d8` (feat)
2. **Task 2: Keep runtime modules dependency-light** - `6d90c60` (fix)

**Plan metadata:** committed with phase summary artifacts.

## Files Created/Modified

- `src/macro/builtins.ts` - Imports runtime errors/types directly.
- `src/macro/shell-verbs.ts` - Imports runtime errors/types directly.
- `src/macro/dispatcher.ts`, `src/macro/registry.ts`, `src/macro/budget.ts`, `src/macro/coerce.ts` - Core helper import migration.
- `src/macro/dry-run.ts`, `src/macro/forbidden-flag-scan.ts`, `src/macro/introspection.ts`, `src/macro/path-wrapper.ts`, `src/macro/preflight.ts`, `src/macro/task-registry.ts` - Guardrail/support import migration.
- `src/macro/runtime-types.ts` - Dependency-light runtime type definitions.
- `tests/macro-framework/src/framework-mirror-check.ts` - Updated import-only file hash pin.

## Decisions Made

Madge treats TypeScript type imports as dependency edges for this gate, so `runtime-types.ts` avoids importing helper modules and defines structural context-facing interfaces instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed accidental runtime type cycles**
- **Found during:** Plan 149-04 raw madge evidence
- **Issue:** The initial runtime split introduced `macro/runtime-types.ts > macro/budget.ts > macro/runtime-errors.ts` and `macro/runtime-types.ts > macro/progress-emitter.ts` cycles.
- **Fix:** Moved runtime-facing budget/progress/registry shapes into `runtime-types.ts` as dependency-light structural types.
- **Files modified:** `src/macro/runtime-types.ts`, `src/macro/runtime-errors.ts`, `src/macro/types.ts`
- **Verification:** `npm run typecheck`; raw madge output no longer lists macro cycles.
- **Committed in:** `6d90c60`

---

**Total deviations:** 1 auto-fixed (blocking cycle cleanup).
**Impact on plan:** Required to satisfy the REQ-011 cycle-break goal; no scope expansion.

## Issues Encountered

Macro framework integrity failed after `registry.ts` import changes because the file hash changed while the wrapped function hash stayed unchanged. Updated the pinned file hash after confirming behavior hash remained stable.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 149-04 can assert target cycle absence and record final evidence.

---
*Phase: 149-cycle-breaks*
*Completed: 2026-05-24*
