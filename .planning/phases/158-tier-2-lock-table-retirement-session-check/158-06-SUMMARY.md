---
phase: 158-tier-2-lock-table-retirement-session-check
plan: 06
subsystem: testing
tags: [vitest, req-023, write-lock-retirement, plugin-coordination]
requires:
  - phase: 157-records-memory-plugins-audit-guards
    provides: REQ-023 scoped records and plugin coordination tests
  - phase: 158-tier-2-lock-table-retirement-session-check
    provides: Plan 02 legacy write-lock retirement and effective config shape
provides:
  - Phase 157 gap-fix unit tests without stale legacy write-lock mocks
  - REQ-023 assertions preserved through withPluginCoordinationLock
  - Coarse resource lock guard compatible with full legacy write-lock sweeps
affects: [REQ-004, REQ-023, unit-tests, static-guards]
tech-stack:
  added: []
  patterns: [mock current lock helpers instead of retired write-lock service]
key-files:
  created:
    - .planning/phases/158-tier-2-lock-table-retirement-session-check/158-06-SUMMARY.md
  modified:
    - tests/unit/advanced-document-tools.test.ts
    - tests/unit/plugin-tools.test.ts
    - tests/unit/record-tools.test.ts
    - tests/unit/no-coarse-resource-locks.test.ts
key-decisions:
  - "Mock document-lock helpers in advanced document tests instead of the retired services/write-lock module."
  - "Keep REQ-023 unit assertions anchored on withPluginCoordinationLock for records and plugin unregister."
patterns-established:
  - "Legacy lock static guards should avoid literal retired symbols when the broader no-legacy guard owns that sweep."
requirements-completed: [REQ-004]
duration: 3min
completed: 2026-05-26
---

# Phase 158 Plan 06: Gap-Fix Test Alignment Summary

**Phase 157 gap-fix unit coverage now proves scoped plugin coordination without stale legacy write-lock mocks or effective TTL fixtures.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-26T20:41:57Z
- **Completed:** 2026-05-26T20:44:32Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Removed stale `services/write-lock` mocks from the owned Phase 157 gap-fix test files.
- Removed effective `ttlSeconds` fixture properties from plugin and record unit configs.
- Preserved REQ-023 assertions that records and `unregister_plugin` use `withPluginCoordinationLock`.
- Kept `no-coarse-resource-locks` focused on coarse records/memory/plugins resources while allowing the full legacy-lock guard to catch retired symbols.

## Task Commits

1. **Task 1: Align Phase 157 gap-fix tests with legacy lock retirement** - `c21031d` (test)

## Files Created/Modified

- `tests/unit/advanced-document-tools.test.ts` - Removed the stale legacy write-lock mock, added current document-lock helper mocks, and dropped effective TTL config.
- `tests/unit/plugin-tools.test.ts` - Removed effective TTL config while preserving unregister plugin coordination assertions.
- `tests/unit/record-tools.test.ts` - Removed the stale legacy write-lock mock and effective TTL config while preserving record coordination assertions.
- `tests/unit/no-coarse-resource-locks.test.ts` - Removed the `src/services/write-lock.ts` skip and avoided literal retired symbols inside the guard itself.

## Decisions Made

- Mocked `withDocumentLock` and `withDocumentLocks` in advanced document tests because the tests still exercise document tools that now depend on the current lock helper.
- Built the coarse-lock guard regex from split legacy symbol strings so Plan 06's stale-reference sweep can stay clean without weakening T-U-036 behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added current document-lock helper mocks after removing legacy write-lock mock**
- **Found during:** Task 1 verification
- **Issue:** Removing the stale `services/write-lock` mock exposed that advanced document tests now need the current `services/document-lock` helpers mocked.
- **Fix:** Added mocks for `LockTimeoutError`, `withDocumentLock`, and `withDocumentLocks`.
- **Files modified:** `tests/unit/advanced-document-tools.test.ts`
- **Verification:** Targeted unit suite passed.
- **Committed in:** `c21031d`

**2. [Rule 1 - Bug] Kept coarse-lock guard compatible with stale-reference sweep**
- **Found during:** Task 1 traceability sweep
- **Issue:** The guard file itself contained literal retired symbol names, causing the plan's stale-reference sweep to report the guard implementation.
- **Fix:** Built the regex from split strings while preserving the same forbidden coarse-resource pattern.
- **Files modified:** `tests/unit/no-coarse-resource-locks.test.ts`
- **Verification:** Traceability sweep returned no matches and guard test passed.
- **Committed in:** `c21031d`

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes were necessary to keep tests aligned with current Phase 158 behavior without reintroducing legacy lock references.

## Issues Encountered

- Initial targeted unit run failed in `advanced-document-tools.test.ts` after the retired mock was removed. The current document-lock helper mock resolved the failure.

## Known Stubs

None. Stub-pattern scan only found local empty arrays/default null parameters in test helpers, not UI-facing or behavior-blocking stubs.

## Threat Flags

None. This plan changed tests only and introduced no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes.

## Verification

- `rg -n "from ['\\\"].*services/write-lock|vi\\.mock\\(['\\\"].*services/write-lock|acquireLock|releaseLock|isLocked|ttlSeconds" tests/unit/advanced-document-tools.test.ts tests/unit/plugin-tools.test.ts tests/unit/record-tools.test.ts tests/unit/no-coarse-resource-locks.test.ts` - passed with no matches.
- `npm test -- tests/unit/advanced-document-tools.test.ts tests/unit/plugin-tools.test.ts tests/unit/record-tools.test.ts tests/unit/no-coarse-resource-locks.test.ts` - passed, 42 tests.
- `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts` - passed, 1 test.
- `npm run typecheck` - passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 06 is complete. The Phase 157 gap-fix tests no longer preserve the retired table-lock service or effective TTL behavior and remain compatible with Phase 158's broader legacy lock retirement.

## Self-Check: PASSED

- Found summary file and all four modified test files.
- Found task commit `c21031d` in git history.

---
*Phase: 158-tier-2-lock-table-retirement-session-check*
*Completed: 2026-05-26*
