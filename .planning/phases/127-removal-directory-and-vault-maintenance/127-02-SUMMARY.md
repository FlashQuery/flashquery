---
phase: 127-removal-directory-and-vault-maintenance
plan: 02
subsystem: mcp
tags: [filesystem, directory-management, mcp-tools, json-contracts, locks, tdd]

requires:
  - phase: 127-removal-directory-and-vault-maintenance
    provides: Phase 127 shared traceability, metadata, and directory result helper contracts
provides:
  - Final `manage_directory(action:"create"|"remove")` MCP handler
  - Ordered JSON directory mutation results with canonical expected errors
  - Per-path `directory:${normalizedPath}` locks for create and remove
  - Unit and integration coverage for create, remove, conflicts, validation, and locks
affects: [manage-directory, create-directory, remove-directory, phase-127]

tech-stack:
  added: []
  patterns:
    - Handler capture by registered tool name in unit tests
    - Ordered per-path mutation loop with expected errors inside `{ results }`
    - Directory-scoped write locks around filesystem mutations

key-files:
  created:
    - tests/unit/manage-directory.test.ts
    - tests/integration/manage-directory.integration.test.ts
    - .planning/phases/127-removal-directory-and-vault-maintenance/127-02-SUMMARY.md
  modified:
    - src/mcp/tools/files.ts
    - tests/unit/files-tools.test.ts
    - .planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md

key-decisions:
  - "Registered `manage_directory` alongside the legacy directory tools for this plan, leaving final legacy-surface removal to later Phase 127/128 work."
  - "Used registered tool names rather than registration order in file-tool tests so adding final tools does not break existing helper selection."

patterns-established:
  - "Directory mutation expected errors stay inside `{ results }` with outer `isError:false`."
  - "Directory lock resources use `directory:${normalizedPath}` for both create and remove."

requirements-completed: [SYS-01, SYS-02]

duration: 10min
completed: 2026-05-12
---

# Phase 127 Plan 02: Manage Directory Summary

**Final `manage_directory` create/remove surface with ordered JSON results, path-safe validation, and directory-scoped locking.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-12T19:46:12Z
- **Completed:** 2026-05-12T19:55:44Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added `manage_directory` with explicit `action: "create" | "remove"` and `paths: string[]`.
- Returned ordered `{ results }` JSON for successes and expected per-path errors.
- Added canonical `invalid_input`, `conflict`, `not_found`, and `permission_denied` envelopes for directory operations.
- Added per-path `directory:${normalizedPath}` locks with `lock_contention` conflicts.
- Added unit and real filesystem integration coverage for idempotent create, empty remove, non-empty conflicts, traversal, symlinks, and file conflicts.

## Task Commits

1. **Task 1 RED: Add failing manage_directory contract tests** - `405318a` (test)
2. **Task 2 GREEN: Implement manage_directory handler** - `c0f5f4c` (feat)
3. **Task 3: Add manage_directory integration coverage and traceability** - `08a65b0` (test)

## Files Created/Modified

- `src/mcp/tools/files.ts` - Registers `manage_directory` and implements ordered create/remove behavior.
- `tests/unit/manage-directory.test.ts` - Covers schema, invalid inputs, ordering, duplicate paths, non-empty remove, and lock contention.
- `tests/unit/files-tools.test.ts` - Captures legacy handlers by registered name after final tool insertion.
- `tests/integration/manage-directory.integration.test.ts` - Exercises real filesystem create/remove/conflict behavior with real lock service.
- `.planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md` - Marks SYS-01/SYS-02 implementation evidence.

## Decisions Made

- Kept legacy `create_directory` and `remove_directory` registered in this plan because 127-02 only introduces the final mutation surface; later phase plans own final absence/removal checks.
- Made `manage_directory` always use the directory lock service for both actions, matching the Phase 127 threat model and DAQ-9 answer.
- Updated file-tool unit helpers to find handlers by tool name, avoiding brittle registration-order assumptions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed brittle legacy file-tool unit helper selection**
- **Found during:** Task 2
- **Issue:** Adding `manage_directory` changed registration order, causing `tests/unit/files-tools.test.ts` to call the wrong handlers by index.
- **Fix:** Changed helper capture to a name-keyed map for `create_directory` and `list_vault`.
- **Files modified:** `tests/unit/files-tools.test.ts`
- **Verification:** `npm test -- tests/unit/manage-directory.test.ts tests/unit/files-tools.test.ts` passed.
- **Committed in:** `c0f5f4c`

**Total deviations:** 1 auto-fixed (Rule 1).
**Impact on plan:** No scope expansion; the fix was required to preserve existing file-tool coverage after adding the final surface.

## Known Stubs

None. Stub scan found only normal array initialization and existing null checks; no placeholder behavior blocks the plan goal.

## Issues Encountered

- The integration run emitted pre-existing DDL log noise about dropping a missing `description` column, but the focused suite passed.

## User Setup Required

None - existing `.env.test` credentials were sufficient.

## Verification

- `npm test -- tests/unit/manage-directory.test.ts tests/unit/files-tools.test.ts` - passed, 39 tests.
- `npm run test:integration -- tests/integration/manage-directory.integration.test.ts` - passed, 4 tests.
- `npm run build` - passed.

## Next Phase Readiness

`manage_directory` is ready for E2E and scenario coverage in later Phase 127 plans. Legacy directory tool removal remains for the planned legacy-surface cleanup work.

## Self-Check: PASSED

- Verified created/modified key files exist.
- Verified task commits exist in git history.
- Verified focused unit, integration, and build commands passed.

---
*Phase: 127-removal-directory-and-vault-maintenance*
*Completed: 2026-05-12*
