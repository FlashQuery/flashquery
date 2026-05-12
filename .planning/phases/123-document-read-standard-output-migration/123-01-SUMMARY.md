---
phase: 123-document-read-standard-output-migration
plan: 01
subsystem: mcp
tags: [get-document, canonical-errors, json-envelopes, vitest]

requires:
  - phase: 121-foundation-metadata-response-helpers-test-harness
    provides: shared JSON response helpers and tool metadata registry
  - phase: 122-host-tool-exposure-config
    provides: metadata-backed registered tool descriptions
provides:
  - DOC-01 get_document canonical expected-error envelopes
  - Phase 123 traceability rows for DOC-01, DOC-02, and DOC-05
  - Handler-level integration evidence for get_document expected errors
affects: [phase-123-document-read-standard-output-migration, document-tools, scenario-coverage]

tech-stack:
  added: []
  patterns:
    - jsonExpectedError for get_document expected DocumentRequestError responses
    - canonical invalid_input validation conflicts with preserved details.conflict

key-files:
  created:
    - .planning/phases/123-document-read-standard-output-migration/123-01-SUMMARY.md
  modified:
    - src/mcp/utils/document-output.ts
    - src/mcp/tools/documents.ts
    - src/mcp/tool-metadata.ts
    - tests/unit/document-output.test.ts
    - tests/unit/tool-metadata.test.ts
    - tests/integration/documents.integration.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md

key-decisions:
  - "Kept get_document input and success response shape unchanged while canonicalizing expected errors only."
  - "Recorded get_document canonical error-shape evidence in existing directed and integration coverage ledgers instead of introducing new scenario runner files in this narrow plan."

patterns-established:
  - "Single get_document DocumentRequestError responses return through jsonExpectedError."
  - "Batch get_document DocumentRequestError elements are normalized through the same expected-error helper before insertion into the response array."

requirements-completed: [DOC-01, DOC-05]

duration: 6min
completed: 2026-05-12
---

# Phase 123 Plan 01: get_document Canonical Expected Errors Summary

**get_document expected errors now use canonical JSON envelopes with isError:false across unit and integration coverage**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-12T00:07:37Z
- **Completed:** 2026-05-12T00:13:45Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Verified Phase 123 traceability maps DOC-01, DOC-02, and DOC-05 to concrete unit, integration, E2E, directed scenario, and integration scenario targets.
- Canonicalized `get_document` parameter conflict errors from `invalid_parameter_combination` to `invalid_input` while preserving `details.conflict`.
- Routed single and batch `DocumentRequestError` expected responses through shared JSON expected-error helpers.
- Added handler-level integration coverage plus directed and integration coverage ledger rows for `get_document` JSON error-shape migration.

## Task Commits

1. **Task 1: Verify and complete traceability foundation** - `2b75a52` (docs)
2. **Task 2 RED: Canonical get_document unit expectations** - `d35ed5d` (test)
3. **Task 2 GREEN: Canonicalize get_document expected errors** - `48a5de9` (feat)
4. **Task 3: Add integration and scenario coverage** - `6a24bfc` (test)

## Files Created/Modified

- `.planning/phases/123-document-read-standard-output-migration/123-01-SUMMARY.md` - Execution summary and verification record.
- `src/mcp/utils/document-output.ts` - `validateParameterCombinations` now returns canonical `invalid_input`.
- `src/mcp/tools/documents.ts` - `get_document` expected `DocumentRequestError` responses now use `jsonExpectedError`.
- `src/mcp/tool-metadata.ts` - `get_document` metadata now documents canonical expected-error envelopes and unchanged include vocabulary.
- `tests/unit/document-output.test.ts` - Unit assertions for `invalid_input` conflict envelopes.
- `tests/unit/tool-metadata.test.ts` - Metadata coverage for get_document expected-error and include documentation.
- `tests/integration/documents.integration.test.ts` - Handler-level canonical `not_found` and `invalid_input` assertions.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - `D-gdoc-error-*` coverage rows.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - `INT-gdoc-error-*` coverage rows.

## Decisions Made

- Preserved all existing `get_document` success output and input options; this plan changed expected-error shape only.
- Used existing coverage ledgers for scenario traceability because this plan’s behavior is the error-envelope contract, not a new user workflow.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Increased Supabase-backed integration hook timeout**
- **Found during:** Task 3 (integration verification)
- **Issue:** The required file-level integration command failed because an existing `beforeAll` hook in `documents.integration.test.ts` timed out at 10 seconds while Supabase DDL retries were still running, and cleanup assumed initialization had completed.
- **Fix:** Added 60-second hook timeouts and guarded cleanup when Supabase initialization has not produced a manager.
- **Files modified:** `tests/integration/documents.integration.test.ts`
- **Verification:** `npm run test:integration -- tests/integration/documents.integration.test.ts` passed with 6 tests.
- **Committed in:** `6a24bfc`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** The fix was limited to the touched integration suite and was required to run the plan’s specified verification command.

## Issues Encountered

- Task 3 was marked TDD, but its production behavior had already landed in Task 2 by design. The new integration tests passed when added, so Task 3 produced a test-only coverage commit rather than a separate RED/GREEN pair.
- Supabase schema setup logged repeated attempts to drop a missing `description` column during integration tests. The command still completed successfully.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used for integration tests.

## Verification

- `grep -v '^#' .planning/phases/123-document-read-standard-output-migration/TRACEABILITY.md | grep -c 'DOC-0'` - passed, returned `3`.
- `grep -n "invalid_parameter_combination" src/mcp/utils/document-output.ts src/mcp/tools/documents.ts` - passed, no production occurrences.
- `grep -n "jsonExpectedError" src/mcp/tools/documents.ts` - passed, shared helper is used in `get_document`.
- `grep -n "canonical expected-error\|expected-error" src/mcp/tool-metadata.ts tests/unit/tool-metadata.test.ts` - passed.
- `npm test -- tests/unit/document-output.test.ts tests/unit/response-formats.test.ts tests/unit/tool-metadata.test.ts` - passed, 70 tests.
- `npm run test:integration -- tests/integration/documents.integration.test.ts` - passed, 6 tests.

## Known Stubs

None.

## Threat Flags

None.

## TDD Gate Compliance

- Task 2 completed RED (`d35ed5d`) and GREEN (`48a5de9`) commits.
- Task 3 was coverage-only after Task 2 implemented the shared behavior; no additional production GREEN commit was needed.

## Next Phase Readiness

Plan 123-02 can build on the same response helper pattern for `archive_document` while preserving expected-error `isError:false` behavior and updating scenario ledgers in the same phase.

## Self-Check: PASSED

- Verified created/modified files exist on disk.
- Verified task commits exist in git history: `2b75a52`, `d35ed5d`, `48a5de9`, `6a24bfc`.

---
*Phase: 123-document-read-standard-output-migration*
*Completed: 2026-05-12*
