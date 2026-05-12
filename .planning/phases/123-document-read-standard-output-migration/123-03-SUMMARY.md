---
phase: 123-document-read-standard-output-migration
plan: 03
subsystem: mcp
tags: [copy-document, move-document, json-output, document-identification, vitest, e2e]

requires:
  - phase: 123-document-read-standard-output-migration
    provides: get_document canonical errors and archive_document JSON output from plans 01-02
provides:
  - copy_document JSON document identification output with fresh copy fq_id
  - move_document JSON document identification output with stable fq_id
  - canonical expected-error envelopes for copy/move conflicts and invalid paths
  - E2E, integration, directed, and YAML scenario coverage for copy/move JSON migration
affects: [document-tools, scenario-coverage, e2e-protocol, mcp-tool-metadata]

tech-stack:
  added: []
  patterns:
    - copy_document and move_document success responses use jsonToolResult(documentIdentification(...))
    - plugin ownership warnings are emitted through top-level warnings arrays
    - destination path conflicts return canonical conflict envelopes with details.reason path_exists

key-files:
  created:
    - tests/unit/move-document.test.ts
    - .planning/phases/123-document-read-standard-output-migration/123-03-SUMMARY.md
  modified:
    - src/mcp/tools/documents.ts
    - src/mcp/tool-metadata.ts
    - tests/unit/copy-document.test.ts
    - tests/unit/tool-metadata.test.ts
    - tests/integration/documents.integration.test.ts
    - tests/e2e/protocol.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - tests/scenarios/integration/tests/move_document_to_new_directory.yml

key-decisions:
  - "Kept copy_document and move_document single-target while migrating their output contracts."
  - "Preserved move_document path behavior by normalizing extensionless destinations with the source extension."
  - "Represented plugin ownership notices as warnings:[\"plugin_ownership_path_expectation\"] instead of appended prose."

patterns-established:
  - "Mutation confirmations for copy/move return document identification JSON, not operation prose."
  - "Expected copy/move path failures use jsonExpectedError with isError:false."

requirements-completed: [DOC-05]

duration: 14min
completed: 2026-05-12
---

# Phase 123 Plan 03: copy_document and move_document JSON Output Summary

**copy_document and move_document now return structured document identification JSON with canonical expected errors and protocol/scenario coverage**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-12T00:39:30Z
- **Completed:** 2026-05-12T00:53:53Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Migrated `copy_document` success responses from key-value text to `documentIdentification` JSON including `identifier`, `title`, `path`, `fq_id`, `modified`, and `size.chars`.
- Preserved copy semantics: fresh copy `fq_id`, source unchanged, metadata/body copied, conflict guard before write.
- Migrated `move_document` success responses from prose to JSON while preserving stable `fq_id`, extensionless destination normalization, intermediate directory creation, DB path update, and EXDEV fallback.
- Converted copy/move expected errors for not found, ambiguity, traversal, path conflicts, identical paths, and unsupported array-like copy input to canonical JSON envelopes with `isError:false`.
- Added unit, integration, E2E, directed coverage, integration coverage, and YAML scenario evidence for copy/move JSON migration.

## Task Commits

1. **Task 1 RED: copy_document JSON contract tests** - `8d1a9a4` (test)
2. **Task 1 GREEN: copy_document JSON contract** - `23e87aa` (feat)
3. **Task 2 RED: move_document JSON contract tests** - `3fb9dc3` (test)
4. **Task 2 GREEN: move_document JSON contract** - `89ece94` (feat)
5. **Task 3: copy/move E2E and scenario coverage** - `2eebf76` (test)

## Files Created/Modified

- `tests/unit/move-document.test.ts` - Move JSON contract, conflict, extension normalization, and warning coverage.
- `src/mcp/tools/documents.ts` - Migrated copy/move handlers to helper-backed JSON and canonical expected errors.
- `src/mcp/tool-metadata.ts` - Updated copy/move metadata descriptions for JSON output and warning behavior.
- `tests/unit/copy-document.test.ts` - Replaced legacy key-value assertions with JSON identification and error contract coverage.
- `tests/unit/tool-metadata.test.ts` - Added copy/move metadata assertions.
- `tests/integration/documents.integration.test.ts` - Added Supabase-backed copy/get and move/get JSON integration coverage.
- `tests/e2e/protocol.test.ts` - Added MCP protocol JSON parse round-trips for copy_document and move_document.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Added D-copy and D-move coverage rows.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Added INT-copy and INT-move workflow rows.
- `tests/scenarios/integration/tests/move_document_to_new_directory.yml` - Added JSON assertions to the existing move workflow.

## Decisions Made

- Kept `copy_document` and `move_document` single-target per the product contract; no batch support or aliases were added.
- Used `warnings:["plugin_ownership_path_expectation"]` without extra detail fields because the shared helper currently supports warning codes only.
- Left existing link rewriting behavior unchanged; move responses no longer append prose about reference updates.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added overwrite prevention to copy_document**
- **Found during:** Task 1 (copy_document migration)
- **Issue:** The existing copy path used `gitAction` create/update and could overwrite a destination instead of returning the required conflict envelope.
- **Fix:** Added a destination `existsSync` guard before writing and return canonical `conflict` with `details.reason:"path_exists"`.
- **Files modified:** `src/mcp/tools/documents.ts`
- **Verification:** Unit conflict coverage passed; integration conflict coverage passed.
- **Committed in:** `23e87aa`

**2. [Rule 1 - Bug] Fixed new integration test assumptions**
- **Found during:** Task 3 (integration verification)
- **Issue:** Initial integration assertions expected exact body length without accounting for markdown write newline normalization, and conflict setup did not target an existing destination path.
- **Fix:** Asserted `size.chars` as a numeric body-size field with a lower bound and created an explicit conflict destination before testing copy/move conflicts.
- **Files modified:** `tests/integration/documents.integration.test.ts`
- **Verification:** `npm run test:integration -- tests/integration/documents.integration.test.ts` passed with 12 tests.
- **Committed in:** `2eebf76`

---

**Total deviations:** 2 auto-fixed (Rule 1: 1, Rule 2: 1)
**Impact on plan:** Both changes were required for the stated output/error contract. No architectural scope was added.

## Issues Encountered

- Supabase integration startup still logs the known handled attempt to drop absent `fqc_documents.description`; the integration command passed.
- The managed YAML scenario generated an ignored report under `tests/scenarios/integration/reports/`; no untracked files remained.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` credentials used for integration and E2E tests.

## Verification

- `npm test -- tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/tool-metadata.test.ts` - passed, 23 tests.
- `npm run test:integration -- tests/integration/documents.integration.test.ts` - passed, 12 tests.
- `npm run test:e2e -- tests/e2e/protocol.test.ts` - passed, 16 tests.
- `python3 tests/scenarios/integration/run_integration.py --managed move_document_to_new_directory` - passed, 4/4 steps.
- Task acceptance greps for legacy copy/move prose removal, `documentIdentification`, `path_exists`, metadata JSON descriptions, E2E copy/move assertions, and D-copy/D-move/INT-copy/INT-move rows passed.

## Known Stubs

None.

## Threat Flags

None.

## TDD Gate Compliance

- Task 1 completed RED (`8d1a9a4`) and GREEN (`23e87aa`) commits.
- Task 2 completed RED (`3fb9dc3`) and GREEN (`89ece94`) commits.
- Task 3 was non-TDD and completed as coverage update commit `2eebf76`.

## Next Phase Readiness

Plan 123-04 can migrate `list_vault` using the same helper-backed JSON response pattern without revisiting copy/move contracts.

## Self-Check: PASSED

- Verified created/modified files exist on disk.
- Verified task commits exist in git history: `8d1a9a4`, `23e87aa`, `3fb9dc3`, `89ece94`, `2eebf76`.

---
*Phase: 123-document-read-standard-output-migration*
*Completed: 2026-05-12*
