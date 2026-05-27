---
phase: 160-folder-locks-manage-directory-migration
plan: 01
subsystem: services
tags: [postgres, advisory-locks, directory-locks, vitest]
requires:
  - phase: 159-lock-timeout-canonical-key-derivation
    provides: canonical file/dir advisory lock key derivation and timeout semantics
provides:
  - shared ancestor directory advisory lock facade
  - exclusive single-directory advisory lock facade
  - helper-level coverage for timeout, SQL mode, release, and export boundaries
affects: [document-locks, manage-directory, folder-coordination]
tech-stack:
  added: []
  patterns: [high-level directory lock facade over private advisory SQL]
key-files:
  created:
    - tests/unit/with-directory-lock.test.ts
  modified:
    - src/services/document-lock.ts
    - tests/unit/lock-helper-only.test.ts
key-decisions:
  - "Directory helpers use canonical `dir:` entries from the existing lock service instead of introducing a second key system."
  - "Directory locks remain Tier 2 advisory-only; Tier 1 in-process stripes stay file-only."
patterns-established:
  - "Shared directory locks use `pg_try_advisory_lock_shared` / `pg_advisory_unlock_shared` through the same bounded retry and release policy as document locks."
requirements-completed: [REQ-007, REQ-024]
duration: 12 min
completed: 2026-05-27
---

# Phase 160 Plan 01: Directory Lock Facade Summary

**Shared and exclusive directory advisory-lock helpers over canonical `dir:` keys**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-27T03:36:00Z
- **Completed:** 2026-05-27T03:48:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `withAncestorDirectoryLocksShared` for parent-through-root shared directory locks.
- Added `withDirectoryLockExclusive` for structural folder-operation locks.
- Preserved Phase 159 timeout and release-error behavior for directory helpers.
- Updated export-boundary coverage so raw advisory primitives remain private.

## Task Commits

1. **Task 1: Specify directory-lock helper behavior and export boundary** - `c51aeaa` (test)
2. **Task 2: Implement shared and exclusive directory advisory helpers** - `4b7358c` (feat)

## Files Created/Modified

- `tests/unit/with-directory-lock.test.ts` - Helper coverage for shared/exclusive SQL, timeouts, and release policy.
- `src/services/document-lock.ts` - Directory helper exports and private shared/exclusive advisory runner.
- `tests/unit/lock-helper-only.test.ts` - Public facade export allow-list.

## Decisions Made

Directory helper acquisition is deterministic and canonicalized through existing `dir:` lock entries, with no directory Tier 1 registry or public low-level acquire/release API.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can wrap file-writing paths with `withAncestorDirectoryLocksShared`; Plan 03 can consume `withDirectoryLockExclusive` for public `manage_directory` structural operations.

---
*Phase: 160-folder-locks-manage-directory-migration*
*Completed: 2026-05-27*
