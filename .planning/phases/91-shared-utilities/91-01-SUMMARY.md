---
phase: 91-shared-utilities
plan: 01
subsystem: testing
tags: [path-validation, filesystem, security, typescript, vitest, tdd]

# Dependency graph
requires: []
provides:
  - src/mcp/utils/path-validation.ts with 5 named exports: validateVaultPath, normalizePath, joinWithRoot, sanitizeDirectorySegment, validateSegment
  - tests/unit/path-validation.test.ts with 33 unit tests U-01 through U-33
affects:
  - 92-create-directory (imports validateVaultPath, normalizePath, joinWithRoot, sanitizeDirectorySegment, validateSegment)
  - 93-list-vault (imports validateVaultPath)
  - 94-migration-cleanup (imports validateVaultPath for remove_directory migration)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolve()+relative() for safe vault path confinement (standard Node.js pattern)"
    - "lstat() per segment for symlink detection (not stat() which follows links)"
    - "Buffer.byteLength(str, 'utf8') for byte-length checks (not .length which counts code units)"
    - "ENAMETOOLONG handled gracefully alongside ENOENT in lstat walk"
    - "sanitizeDirectorySegment re-implements sanitizeFolderName inline (D-04) with extended regex + metadata return"

key-files:
  created:
    - src/mcp/utils/path-validation.ts
    - tests/unit/path-validation.test.ts
  modified: []

key-decisions:
  - "ENAMETOOLONG from lstat is swallowed alongside ENOENT — OS-level path limits on combined absolute path are not the same as the 4096-byte vault-relative limit"
  - "sanitizeDirectorySegment does NOT import from vault.ts — logic re-implemented inline per D-04 to avoid coupling and adds NUL/control char coverage"
  - "Test U-31 assertion uses (result.error ?? '') to avoid .toMatch() on undefined — valid result has no error field"

patterns-established:
  - "Pattern: Real-filesystem temp dir tests use os.tmpdir() + mkdirSync + rmSync (no external tmp package)"
  - "Pattern: validateVaultPath is the single choke point before any vault filesystem operation"
  - "Pattern: Path traversal check via resolve()+relative() — if relative() result starts with '..' the path escapes the vault"

requirements-completed:
  - REFAC-04
  - TEST-01

# Metrics
duration: 15min
completed: 2026-04-24
---

# Phase 91 Plan 01: Shared Utilities (path-validation) Summary

**Shared path validation utility with resolve+relative traversal guard, lstat symlink detection, and sanitizeDirectorySegment extending vault.ts with NUL/control char coverage — 33 TDD unit tests all green**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-24T15:10:00Z
- **Completed:** 2026-04-24T15:12:30Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Created `src/mcp/utils/path-validation.ts` with 5 named exports that Phase 92 and 93 will import
- Implemented `validateVaultPath` with path traversal protection (resolve+relative), lstat-based symlink detection per segment, 4096-byte total path limit, and vault-root rejection
- Implemented `sanitizeDirectorySegment` extending vault.ts `sanitizeFolderName` regex with `"`, NUL (`\0`), and control chars (`\x01-\x1f`), returning `{ sanitized, changed, replacedChars }` metadata
- Implemented `validateSegment` using `Buffer.byteLength` for correct UTF-8 byte-length enforcement (not `.length`)
- 33 unit tests U-01 through U-33 all pass; full suite grew from 1113 to 1146 with no regressions

## Task Commits

TDD cycle produced two commits:

1. **RED — failing tests** - `dc7db61` (test)
2. **GREEN — implementation + test assertion fix** - `a234240` (feat)

**Plan metadata:** (this SUMMARY commit)

## Files Created/Modified

- `src/mcp/utils/path-validation.ts` — 5 exports: validateVaultPath, normalizePath, joinWithRoot, sanitizeDirectorySegment, validateSegment
- `tests/unit/path-validation.test.ts` — 33 tests U-01 through U-33 covering all five functions

## Decisions Made

- `ENAMETOOLONG` from `lstat` is handled gracefully (silenced) alongside `ENOENT`: the 4096-byte limit is enforced on the vault-relative path string, but OS-level absolute path limits are a separate concern that should not crash the function
- Test U-31 assertion changed from `expect(result.error).not.toMatch(...)` to `expect(result.error ?? '').not.toMatch(...)` because a valid result has no `error` field (undefined), and Vitest's `.toMatch()` requires a string receiver

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Handle ENAMETOOLONG in lstat walk**
- **Found during:** Task 1 — GREEN phase test run
- **Issue:** When `validateVaultPath` walks segments of a 4095-byte path through `lstat`, the combined absolute path (temp dir prefix + 4095-byte relative path) exceeds the macOS absolute path limit. `lstat` throws `ENAMETOOLONG` instead of `ENOENT`.
- **Fix:** Added `ENAMETOOLONG` to the allowed error codes in the lstat catch block alongside `ENOENT`. The function now treats it as "this path segment doesn't exist yet" and skips it.
- **Files modified:** `src/mcp/utils/path-validation.ts` (lstat error handler)
- **Verification:** U-31 passes — the function returns valid=true for a 4095-byte path without a path-length error
- **Committed in:** `a234240`

**2. [Rule 1 - Bug] Fix U-31 test assertion for undefined error field**
- **Found during:** Task 1 — GREEN phase test run
- **Issue:** `expect(result.error).not.toMatch(...)` fails with `TypeError: .toMatch() expects to receive a string, but got undefined` when the validation result is valid (no error field)
- **Fix:** Changed assertion to `expect(result.error ?? '').not.toMatch(...)` — uses empty string as fallback when error is undefined
- **Files modified:** `tests/unit/path-validation.test.ts` (U-31 assertion)
- **Verification:** U-31 passes; all 33 tests pass
- **Committed in:** `a234240`

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs found during GREEN phase)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

- Vitest `.toMatch()` type requirement for string (not undefined) — caught during GREEN run, fixed inline

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `src/mcp/utils/path-validation.ts` is ready for import by Phase 92 (`create_directory`) and Phase 93 (`list_vault`)
- All 5 exports are tested and TypeScript-clean (no errors in path-validation.ts itself)
- No blockers

---
*Phase: 91-shared-utilities*
*Completed: 2026-04-24*
