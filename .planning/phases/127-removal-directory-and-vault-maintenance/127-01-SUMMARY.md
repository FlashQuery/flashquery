---
phase: 127-removal-directory-and-vault-maintenance
plan: 01
subsystem: mcp
tags: [config, frontmatter, tool-metadata, response-helpers, tdd]

requires:
  - phase: 126-plugin-record-consolidation
    provides: final consolidation metadata and traceability patterns
provides:
  - Phase 127 traceability ledger for DOC-09 and SYS-01 through SYS-03
  - Locked trash_folder config contract with camelCase runtime config
  - FM.ORIGINAL_PATH frontmatter constant for removal recovery metadata
  - Final current metadata for remove_document, manage_directory, and maintain_vault
  - JSON-compatible helper builders for directory, maintenance, and removal results
affects: [phase-127, remove-document, manage-directory, maintain-vault]

tech-stack:
  added: []
  patterns:
    - TDD RED/GREEN commits for config/frontmatter and metadata/helper contracts
    - Top-level snake_case YAML config mapped to camelCase runtime config
    - Final tool metadata promoted through the central registry

key-files:
  created:
    - .planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md
  modified:
    - src/config/loader.ts
    - src/constants/frontmatter-fields.ts
    - src/mcp/utils/response-formats.ts
    - src/mcp/tool-metadata.ts
    - tests/unit/config.test.ts
    - tests/unit/frontmatter-fields.test.ts
    - tests/unit/response-formats.test.ts
    - tests/unit/tool-metadata.test.ts

key-decisions:
  - "Kept trash_folder.path unresolved in loadConfig so remove_document can resolve relative paths from the vault root at use time."
  - "Promoted remove_document and manage_directory into read-write delegated tier metadata while keeping maintain_vault system/admin and delegated-hard-excluded."

patterns-established:
  - "Phase 127 traceability rows name unit, integration, E2E, directed, integration scenario, and final verification evidence before implementation."
  - "Removal recovery frontmatter must use FM.ORIGINAL_PATH instead of raw fq_original_path literals."

requirements-completed: [DOC-09, SYS-01, SYS-02, SYS-03]

duration: 9min
completed: 2026-05-12
---

# Phase 127 Plan 01: Shared Removal, Directory, And Vault Maintenance Contracts Summary

**Traceability, trash-folder config, recovery frontmatter, response builders, and final metadata contracts for Phase 127 destructive/admin tools.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-12T19:30:42Z
- **Completed:** 2026-05-12T19:39:47Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Created the Phase 127 traceability ledger mapping `DOC-09`, `SYS-01`, `SYS-02`, and `SYS-03` to unit, integration, E2E, directed, integration scenario, and final verification evidence.
- Added `trash_folder` config parsing with locked defaults and `trashFolder` camelCase runtime shape.
- Added `FM.ORIGINAL_PATH` for managed trash recovery metadata.
- Promoted `remove_document`, `manage_directory`, and `maintain_vault` to final current metadata with correct category, tier, and delegated exclusion policy.
- Added JSON-compatible `directoryResult`, `maintenanceActionResult`, and `documentRemovalResult` builders.

## Task Commits

1. **Task 1: Instantiate Phase 127 traceability** - `5f41683` (docs)
2. **Task 2 RED: Add failing trash config contract tests** - `e0f194b` (test)
3. **Task 2 GREEN: Add trash config and recovery frontmatter contracts** - `f3fdd4e` (feat)
4. **Task 3 RED: Add failing metadata response contract tests** - `ef0a8af` (test)
5. **Task 3 GREEN: Finalize Phase 127 response helpers and metadata** - `3679b04` (feat)

## Files Created/Modified

- `.planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md` - Phase-local evidence ledger for the four Phase 127 requirements.
- `src/config/loader.ts` - Adds `TrashFolderSchema`, top-level `trash_folder`, and `FlashQueryConfig.trashFolder`.
- `src/constants/frontmatter-fields.ts` - Adds `FM.ORIGINAL_PATH`.
- `src/mcp/utils/response-formats.ts` - Adds directory, maintenance action, and document removal helper types/builders.
- `src/mcp/tool-metadata.ts` - Promotes Phase 127 final tools from future metadata to current final metadata.
- `tests/unit/config.test.ts` - Covers trash-folder defaults, camelCase mapping, and invalid collision strategy.
- `tests/unit/frontmatter-fields.test.ts` - Covers `FM.ORIGINAL_PATH` value and ordering.
- `tests/unit/response-formats.test.ts` - Covers JSON-compatible Phase 127 helper shapes.
- `tests/unit/tool-metadata.test.ts` - Covers final Phase 127 metadata and merged legacy suggestions.

## Decisions Made

- Kept `trashFolder.path` as the YAML value instead of resolving it relative to the config file, because the product contract requires `remove_document` to resolve relative trash paths from the vault root at use time.
- Added small helper builders in `response-formats.ts` now, so later implementation plans can share canonical result shapes instead of assembling bespoke payload objects.
- Kept `maintain_vault` as system/admin with `SYSTEM_ADMIN_REASON`, making it host-eligible but delegated-hard-excluded.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## TDD Gate Compliance

- RED commit present for Task 2: `e0f194b`.
- GREEN commit present for Task 2: `f3fdd4e`.
- RED commit present for Task 3: `ef0a8af`.
- GREEN commit present for Task 3: `3679b04`.
- Refactor phase not needed.

## Known Stubs

None. Stub scan found only normal empty-array/object initialization and null checks in existing code paths.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `npm test -- tests/unit/config.test.ts tests/unit/frontmatter-fields.test.ts tests/unit/response-formats.test.ts tests/unit/tool-metadata.test.ts` - passed, 75 tests.
- `npm run build` - passed.

## Next Phase Readiness

Plan 127-02 can implement `manage_directory` against the established traceability, metadata, response helper, and config/frontmatter foundation.

## Self-Check: PASSED

- Verified created/modified key files exist.
- Verified task commits exist in git history.
- Verified focused unit tests and build passed.

---
*Phase: 127-removal-directory-and-vault-maintenance*
*Completed: 2026-05-12*
