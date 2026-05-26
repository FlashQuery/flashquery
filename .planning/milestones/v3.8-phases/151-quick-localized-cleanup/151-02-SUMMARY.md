---
phase: 151-quick-localized-cleanup
plan: 02
subsystem: infra
tags: [backup, package-metadata, static-guards, audit-remediation]
requires:
  - phase: 151-quick-localized-cleanup
    provides: REQ-001 and REQ-002 production cleanup from 151-01
provides:
  - Removed inert projects seeder and stale tests
  - Visible pg cleanup failure logging without credential leakage
  - Static guard suite for Phase 151 forbidden patterns
  - Direct esbuild metadata and removal of stale @types/uuid
affects: [backup, package-metadata, phase-151]
tech-stack:
  added:
    - esbuild direct dev dependency
  patterns:
    - Static guard tests assert exact audit-remediation forbidden patterns
    - Cleanup diagnostics redact credential-bearing fragments
key-files:
  created:
    - tests/unit/codebase-audit-remaining-remediation.test.ts
  modified:
    - src/git/manager.ts
    - tests/unit/git-manager.test.ts
    - tests/unit/backup-command.test.ts
    - tests/unit/plugin-reconciliation.test.ts
    - package.json
    - package-lock.json
  deleted:
    - src/projects/seeder.ts
    - tests/unit/projects-seeder.test.ts
key-decisions:
  - "Chose debug logging for pg cleanup failures so backup success remains success while close failures are still visible."
  - "Added esbuild as a direct dev dependency instead of changing tsup.config.ts because the type import is intentional and the lockfile already carried esbuild through tsup."
patterns-established:
  - "Audit structural guards read named source files and package metadata rather than banning broad repository patterns."
requirements-completed:
  - REQ-001
  - REQ-002
  - REQ-003
  - REQ-004
  - REQ-005
duration: 4 min
completed: 2026-05-25
---

# Phase 151 Plan 02: Seeder, Backup Cleanup, and Package Metadata Summary

**Dead seeder removal, safe pg cleanup diagnostics, and package metadata guards for Phase 151**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-25T16:01:39Z
- **Completed:** 2026-05-25T16:05:28Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Removed the inert `src/projects/seeder.ts` module and its stale unit suite, plus the backup command mock that referenced it.
- Replaced silent pg client cleanup swallowing with debug logging that redacts database URLs and password fragments.
- Added exact static guards for T-U-004, T-U-007, T-U-008, T-U-009, T-U-011, T-U-012, and T-U-013.
- Added direct `esbuild` dev metadata and removed stale `@types/uuid`, with lockfile refreshed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove inert seeder and make backup cleanup failures visible** - `fc80424` (test), `f95db39` (feat)
2. **Task 2: Add static guards and package metadata cleanup** - `a9f74a8` (test), `e2af1ef` (chore)

**Plan metadata:** local-only GSD summary; `.planning/` is intentionally not tracked in git.

## Files Created/Modified

- `src/git/manager.ts` - Logs pg cleanup failures with credential redaction.
- `src/projects/seeder.ts` - Deleted inert legacy seeder.
- `tests/unit/projects-seeder.test.ts` - Deleted stale seeder-only tests.
- `tests/unit/git-manager.test.ts` - Covers pg close rejection logging and credential redaction.
- `tests/unit/backup-command.test.ts` - Removes stale seeder mock.
- `tests/unit/codebase-audit-remaining-remediation.test.ts` - Adds Phase 151 static guard suite.
- `tests/unit/plugin-reconciliation.test.ts` - Updates vault mock to the new public path API.
- `package.json` / `package-lock.json` - Adds direct `esbuild`, removes `@types/uuid`.

## Decisions Made

- Preserved primary backup errors by logging cleanup failures inside `finally` without throwing from cleanup.
- Redacted database URL and password-shaped fragments from cleanup diagnostics.
- Kept the esbuild type import and made package metadata match it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated plugin reconciliation unit mock for new VaultManager contract**
- **Found during:** Task 2 full unit verification
- **Issue:** `tests/unit/plugin-reconciliation.test.ts` mocked `vaultManager.rootPath`, so full unit tests failed after production moved to `resolveVaultPath()`.
- **Fix:** Updated the mock to expose `resolveVaultPath(relativePath)`.
- **Files modified:** `tests/unit/plugin-reconciliation.test.ts`
- **Verification:** Full `npm test -- --bail=1` passed.
- **Committed in:** `e2af1ef`

---

**Total deviations:** 1 auto-fixed (blocking test mock drift).
**Impact on plan:** No scope expansion; the fix aligns unit tests with the new public API required by REQ-002.

## Issues Encountered

None beyond the expected RED test failures and the test mock drift documented above.

## Verification

- `npm test -- tests/unit/git-manager.test.ts tests/unit/backup-command.test.ts --bail=1` - passed, 32 tests.
- `! rg -n "initProjects|projects/seeder" src tests --glob "!tests/unit/codebase-audit-remaining-remediation.test.ts"` - passed.
- `! rg -n "\\.catch\\(\\(\\) => \\{\\}\\)" src/git/manager.ts` - passed.
- `npm test -- tests/unit/codebase-audit-remaining-remediation.test.ts --bail=1` - passed, 7 tests.
- `npm run knip` - passed.
- `npm audit` - passed, 0 vulnerabilities.
- `npm test -- --bail=1` - passed, 147 files and 2002 tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 151 source work is complete. Phase-level review, regression, schema/drift, and verification gates can now run.

---
*Phase: 151-quick-localized-cleanup*
*Completed: 2026-05-25*
