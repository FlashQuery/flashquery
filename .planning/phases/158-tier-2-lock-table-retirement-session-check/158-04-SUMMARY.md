---
phase: 158-tier-2-lock-table-retirement-session-check
plan: 04
subsystem: testing
tags: [vitest, advisory-locks, legacy-retirement, postgres]

requires:
  - phase: 158-01
    provides: Native session advisory document locks through withDocumentLock
  - phase: 158-02
    provides: Legacy fqc_write_locks service and table retirement
provides:
  - Stale lock-behavior tests no longer import or mock the retired write-lock service
  - Obsolete table-backed write-lock unit and integration tests removed
  - Archive, macro, and manage_directory tests aligned to current advisory/document-lock behavior
affects: [phase-158, REQ-004, lock-test-cleanup]

tech-stack:
  added: []
  patterns: [Mock withDocumentLock for tool-level lock contention, remove service-only tests when production API is retired]

key-files:
  created: []
  modified:
    - tests/unit/archive-document.test.ts
    - tests/unit/document-batch-lock-contention.test.ts
    - tests/unit/manage-directory.test.ts
    - tests/integration/archive-document-lock.test.ts
    - tests/integration/macro-write-lock.integration.test.ts
    - tests/integration/manage-directory.integration.test.ts
    - tests/unit/write-lock.test.ts
    - tests/integration/write-lock.integration.test.ts

key-decisions:
  - "Deleted service-only write-lock test files because their only subject was the retired fqc_write_locks implementation."
  - "Kept user-facing archive, macro, and manage_directory coverage while removing table-row contention expectations."

patterns-established:
  - "Tool lock-contention unit tests should mock src/services/document-lock.js and throw LockTimeoutError instead of mocking the deleted write-lock service."
  - "Manage-directory tests should cover validation and filesystem mutation behavior only until shared/exclusive directory locks ship later."

requirements-completed: [REQ-004]

duration: 7min
completed: 2026-05-26
---

# Phase 158 Plan 04: Legacy Lock Test Cleanup Summary

**Stale table-lock tests removed and remaining archive, macro, and directory tests rewritten for advisory document-lock behavior**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-26T20:41:52Z
- **Completed:** 2026-05-26T20:48:45Z
- **Tasks:** 1
- **Files modified:** 8

## Accomplishments

- Deleted obsolete unit and integration tests whose only target was the retired `src/services/write-lock.ts` table-backed service.
- Rewrote archive and batch lock-contention unit tests to mock `withDocumentLock` and use `LockTimeoutError`.
- Removed direct `fqc_write_locks` cleanup and TTL config expectations from integration tests.
- Preserved user-facing archive, macro, and directory behavior coverage without asserting retired table-row contention semantics.

## Task Commits

1. **Task 1: Remove or rewrite obsolete legacy write-lock tests** - `6ed5ef1` (test)

## Files Created/Modified

- `tests/unit/write-lock.test.ts` - Deleted obsolete service-only table-lock unit tests.
- `tests/integration/write-lock.integration.test.ts` - Deleted obsolete multi-instance table-lock integration tests.
- `tests/unit/archive-document.test.ts` - Replaced legacy lock-service mocks with `withDocumentLock` / `LockTimeoutError` coverage.
- `tests/unit/document-batch-lock-contention.test.ts` - Replaced legacy lock-service mocks with document-lock timeout coverage.
- `tests/unit/manage-directory.test.ts` - Removed retired table-lock contention assertions; preserved validation and mutation behavior.
- `tests/integration/archive-document-lock.test.ts` - Removed direct table cleanup and legacy service calls; kept advisory-lock tool behavior checks.
- `tests/integration/macro-write-lock.integration.test.ts` - Removed direct legacy lock contention setup; kept macro tool behavior checks.
- `tests/integration/manage-directory.integration.test.ts` - Removed legacy table cleanup and TTL config fields.

## Decisions Made

- Deleted rather than rewrote `write-lock.test.ts` and `write-lock.integration.test.ts` because they only documented the removed table-backed API.
- Adjusted archive/remove integration assertions away from same-file table-lock conflict behavior; after advisory-lock serialization, a loser can observe ordinary file state changes rather than `lock_contention`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated same-file archive/remove integration expectations**
- **Found during:** Task 1
- **Issue:** The stale test expected old table-lock `lock_contention`; current advisory-lock behavior serializes the operations and can produce normal file-state outcomes.
- **Fix:** Reworked archive and macro integration tests to verify current user-facing advisory-lock behavior without depending on retired table-row contention.
- **Files modified:** `tests/integration/archive-document-lock.test.ts`, `tests/integration/macro-write-lock.integration.test.ts`
- **Verification:** Targeted integration command passed.
- **Committed in:** `6ed5ef1`

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** Kept the plan goal intact by removing stale legacy assertions while preserving meaningful current behavior coverage.

## Issues Encountered

- Targeted integration tests initially failed because old same-file archive/remove expectations no longer matched current advisory-lock behavior. Fixed inline and reran successfully.

## Verification

- `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts tests/unit/manage-directory.test.ts tests/unit/archive-document.test.ts tests/unit/document-batch-lock-contention.test.ts`
- `npm run test:integration -- tests/integration/archive-document-lock.test.ts tests/integration/macro-write-lock.integration.test.ts tests/integration/manage-directory.integration.test.ts`
- `npm test -- --testNamePattern "legacy-write-lock|advisory-lock"`
- `npm run typecheck`
- `npm run build`

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

REQ-004 test cleanup is complete. Remaining Phase 158 plans can assume owned tests no longer force the deleted legacy write-lock API or `fqc_write_locks` table to exist.

## Self-Check: PASSED

- Found summary file and all retained modified test files.
- Confirmed `tests/unit/write-lock.test.ts` and `tests/integration/write-lock.integration.test.ts` are deleted.
- Confirmed task commit `6ed5ef1` exists in git history.

---
*Phase: 158-tier-2-lock-table-retirement-session-check*
*Completed: 2026-05-26*
