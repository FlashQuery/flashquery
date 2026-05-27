---
phase: 161-destination-locks-exdev-fallback
plan: 02
subsystem: testing
tags: [vault-locking, exdev, durable-write, req-022]
requires:
  - phase: 156-atomic-durable-write-primitive-consolidation
    provides: writeVaultFile durable primitive
  - phase: 161-destination-locks-exdev-fallback
    provides: REQ-008 move lock placement
provides:
  - T-U-034 EXDEV durable write before unlink proof
  - T-U-035 EXDEV durable write failure preserves source proof
affects: [move-document, vault-write]
tech-stack:
  added: []
  patterns: [Node ErrnoException EXDEV detection]
key-files:
  created:
    - tests/unit/move-exdev-fallback.test.ts
  modified:
    - src/mcp/tools/documents/move.ts
key-decisions:
  - "Recognize Node errno `code === 'EXDEV'` in addition to existing message fallbacks."
patterns-established:
  - "EXDEV fallback tests assert ordered events instead of timing sleeps."
requirements-completed: [REQ-022]
duration: 10 min
completed: 2026-05-27
---

# Phase 161 Plan 02: EXDEV Fallback Unit Proof Summary

**Node errno-aware EXDEV fallback tests proving durable destination commit happens before source unlink**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-27T13:31:00Z
- **Completed:** 2026-05-27T13:33:40Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `T-U-034` proving `writeVaultFile(destAbsPath, content, { lockConfig })` runs before `unlink(sourceAbsPath)`.
- Added `T-U-035` proving `unlink(sourceAbsPath)` is not called if the durable destination commit rejects.
- Hardened `move_document` to treat Node `ErrnoException.code === "EXDEV"` as the cross-device fallback trigger.

## Task Commits

1. **Task 1: Add failing EXDEV fallback coverage** - `b5f5c9b` (test)
2. **Task 2: Harden move EXDEV fallback** - `2f5405d` (feat)

## Files Created/Modified

- `tests/unit/move-exdev-fallback.test.ts` - T-U-034 and T-U-035.
- `src/mcp/tools/documents/move.ts` - `isCrossDeviceRenameError` helper.

## Decisions Made

Kept the production change local to `move.ts`; no new durable-write primitive or direct destination write path was added.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

The first GREEN run exposed an extra post-move `readFile` call used for metadata; the ordered event assertion was narrowed to the fallback prefix so it still proves write-before-unlink without overconstraining later metadata reads.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for integration-level destination race and EXDEV failure evidence.

---
*Phase: 161-destination-locks-exdev-fallback*
*Completed: 2026-05-27*
