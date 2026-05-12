---
phase: 127-removal-directory-and-vault-maintenance
plan: 04
subsystem: mcp
tags: [remove-document, trash-folder, git, vault, lifecycle, integration-tests]

requires:
  - phase: 127-removal-directory-and-vault-maintenance
    provides: trash_folder config, FM.ORIGINAL_PATH, maintain_vault service, Phase 127 traceability
provides:
  - Final `remove_document` handler with archive-before-delete lifecycle
  - Git-aware vault hard-delete and trash-move helpers
  - Ordered batch removal results with per-item expected errors and bulk warnings
  - Unit and integration coverage for DOC-09 destructive safety cases
affects: [remove-document, vault-manager, git-manager, maintain-vault, phase-127]

tech-stack:
  added: []
  patterns:
    - TDD RED/GREEN commits for vault/git helpers and remove_document handler contracts
    - Destructive document filesystem effects routed through VaultManager/GitManager
    - Trash moves use basename-only destinations and fq_original_path recovery frontmatter

key-files:
  created:
    - tests/unit/remove-document.test.ts
    - tests/integration/remove-document.integration.test.ts
    - .planning/phases/127-removal-directory-and-vault-maintenance/127-04-SUMMARY.md
  modified:
    - src/storage/vault.ts
    - src/git/manager.ts
    - src/mcp/tools/documents.ts
    - src/mcp/utils/response-formats.ts
    - tests/unit/vault.test.ts
    - tests/unit/git-manager.test.ts
    - tests/unit/response-formats.test.ts
    - .planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md

key-decisions:
  - "remove_document writes archived lifecycle state and fq_original_path before trash moves, but does not create removed DB fields."
  - "Removal git commits use git add -A so hard deletes and in-repo trash moves stage deletions and destination additions correctly."
  - "Unsafe relative trash_folder traversal is rejected before document resolution or lifecycle mutation."

patterns-established:
  - "VaultManager owns markdown removal filesystem effects; MCP handlers do not call raw git."
  - "remove_document batch responses use `{ results, warnings? }` with outer `isError:false` for expected per-item errors."

requirements-completed: [DOC-09]

duration: 11min
completed: 2026-05-12
---

# Phase 127 Plan 04: Remove Document Summary

**`remove_document` now archives document lifecycle state before hard-delete or trash move, with git-aware vault helpers and destructive-safety integration coverage.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-12T20:12:09Z
- **Completed:** 2026-05-12T20:23:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added `VaultManager.removeMarkdown` and `VaultManager.moveMarkdownToTrash` with cross-device move fallback and centralized git policy routing.
- Added `GitManager.commitVaultRemoval` using `git add -A`, existing `autoCommit`, and existing `autoPush` behavior.
- Registered `remove_document` with string/string-array identifiers, archive-before-filesystem mutation, hard-delete, in-vault trash, external trash, basename collision handling, unsafe trash path rejection, and bulk warnings.
- Added integration coverage for hard delete, trash metadata, external trash, collision suffixes, invalid traversal, batch partial failures, and remove -> `maintain_vault` sync/repair non-`missing` behavior.

## Task Commits

1. **Task 1 RED: Add failing removal helper tests** - `3e6e43b` (test)
2. **Task 1 GREEN: Add git-aware vault removal helpers** - `65f805d` (feat)
3. **Task 2 RED: Add failing remove_document contract tests** - `16af7a3` (test)
4. **Task 2 GREEN: Register remove_document handler** - `1b44a9d` (feat)
5. **Task 3: Add remove_document integration coverage and traceability** - `e3750be` (test)

## Files Created/Modified

- `src/storage/vault.ts` - Adds hard-delete and trash-move helpers with cross-device fallback and git policy delegation.
- `src/git/manager.ts` - Adds removal commit helper with `git add -A`, auto-commit, and auto-push support.
- `src/mcp/tools/documents.ts` - Registers `remove_document` and implements archive/trash/delete/batch behavior.
- `src/mcp/utils/response-formats.ts` - Updates `documentRemovalResult` to the final top-level removal feedback contract.
- `tests/unit/remove-document.test.ts` - Covers handler registration strings, unsafe trash contracts, and removal result shape.
- `tests/unit/vault.test.ts` - Covers hard delete, in-vault trash, and external trash helper behavior.
- `tests/unit/git-manager.test.ts` - Covers removal git policy for autoCommit and autoPush.
- `tests/unit/response-formats.test.ts` - Aligns removal helper expectation with final output shape.
- `tests/integration/remove-document.integration.test.ts` - Real vault/Supabase coverage for DOC-09.
- `.planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md` - Marks DOC-09 implemented evidence.

## Decisions Made

- Used top-level `removed`, `moved_to`, and `original_path` fields instead of the earlier nested `removal` helper shape to match the final tool contract.
- Validated unsafe relative trash traversal before document resolution or lifecycle mutation so a bad trash config cannot archive or move the source.
- Kept persistent lifecycle state as `archived` with `archived_at`; no `removed_at` or `removed_to` DB fields were introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected removal response helper shape**
- **Found during:** Task 2 (Register remove_document handler)
- **Issue:** The existing `documentRemovalResult` helper returned a nested `removal` object, but the plan/product contract requires top-level `removed`, `moved_to`, and `original_path` fields.
- **Fix:** Updated `src/mcp/utils/response-formats.ts` and its unit test, then used the corrected helper from `remove_document`.
- **Files modified:** `src/mcp/utils/response-formats.ts`, `tests/unit/response-formats.test.ts`
- **Verification:** `npm test -- tests/unit/remove-document.test.ts tests/unit/archive-document.test.ts tests/unit/move-document.test.ts tests/unit/response-formats.test.ts` passed; final build passed.
- **Committed in:** `1b44a9d`

**Total deviations:** 1 auto-fixed (Rule 1).
**Impact on plan:** No scope expansion; the fix aligned an existing helper with the required DOC-09 output contract.

## TDD Gate Compliance

- RED commit present for Task 1: `3e6e43b`.
- GREEN commit present for Task 1: `65f805d`.
- RED commit present for Task 2: `16af7a3`.
- GREEN commit present for Task 2: `1b44a9d`.
- Task 3 added integration and traceability coverage in one test commit: `e3750be`.
- Refactor phase not needed.

## Known Stubs

None. Stub scan found only normal empty-object/array initialization and null checks in existing code/tests; no placeholder behavior blocks DOC-09.

## Issues Encountered

- Integration runs emitted pre-existing DDL log noise about dropping a missing `description` column on `fqc_documents`; the focused integration suites passed.

## User Setup Required

None - existing `.env.test` credentials were sufficient.

## Verification

- `npm test -- tests/unit/vault.test.ts tests/unit/git-manager.test.ts` - passed, 70 tests.
- `npm test -- tests/unit/remove-document.test.ts tests/unit/archive-document.test.ts tests/unit/move-document.test.ts tests/unit/response-formats.test.ts` - passed, 35 tests.
- `npm run test:integration -- tests/integration/remove-document.integration.test.ts` - passed, 7 tests.
- `npm test -- tests/unit/remove-document.test.ts tests/unit/vault.test.ts tests/unit/git-manager.test.ts` - passed, 73 tests.
- `npm run test:integration -- tests/integration/remove-document.integration.test.ts tests/integration/maintain-vault.integration.test.ts` - passed, 13 tests.
- `npm run build` - passed.

## Next Phase Readiness

Plan 127-05 can add MCP protocol, directed scenario, and YAML integration workflow coverage for `remove_document`, `manage_directory`, and `maintain_vault` against the final handler surfaces.

## Self-Check: PASSED

- Verified created/modified key files exist.
- Verified task commits exist in git history.
- Verified focused unit, integration, and build commands passed.

---
*Phase: 127-removal-directory-and-vault-maintenance*
*Completed: 2026-05-12*
