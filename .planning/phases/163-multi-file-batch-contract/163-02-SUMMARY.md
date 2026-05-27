---
phase: 163-multi-file-batch-contract
plan: 02
subsystem: api
tags: [mcp, documents, batch, version-token, vitest]
requires:
  - phase: 163-multi-file-batch-contract
    provides: shared mixed batch identifier schemas and batch result wrappers from plan 01
provides:
  - archive_document ordered destructive batch result envelopes
  - remove_document ordered destructive batch result envelopes
  - Integration coverage for T-I-034 through T-I-037
affects: [archive_document, remove_document, phase-163]
tech-stack:
  added: []
  patterns:
    - Array-input destructive tools return raw ordered succeeded/conflicted/failed result entries
    - Object-form item version_token is checked per item inside the document lock
key-files:
  created:
    - tests/integration/batch-envelope.integration.test.ts
  modified:
    - src/mcp/tools/documents/archive.ts
    - src/mcp/tools/documents/remove.ts
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "Bare string entries in archive/remove batch arrays skip top-level expected_version checks; object entries use their co-located version_token."
  - "remove_document array inputs now return the raw REQ-018 per-item array instead of the legacy { results } wrapper."
patterns-established:
  - "Destructive batch handlers push legacy success payloads through batchSucceeded and expected per-item errors through batchConflicted or batchFailed."
requirements-completed: [REQ-018, REQ-019]
duration: 9min
completed: 2026-05-27
---

# Phase 163 Plan 02: Destructive Batch Envelope Summary

**archive_document and remove_document now expose ordered per-item batch outcomes with locked per-item token checks**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-27T19:54:48Z
- **Completed:** 2026-05-27T20:03:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added integration coverage for `T-I-034` through `T-I-037`, including ordered success/conflict/failure arrays, stale-token conflicts, not-found failures, and non-rollback persistence.
- Updated `archive_document` array calls to return raw ordered `succeeded` / `conflicted` / `failed` entries while preserving single-string behavior.
- Updated `remove_document` array calls to return the same raw ordered array contract and remove the legacy batch `{ results }` wrapper for array inputs.

## Task Commits

1. **Task 1: Add archive/remove batch envelope integration coverage** - `ac5d2fb` (test)
2. **Task 2: Thread per-item tokens through archive_document and remove_document** - `840f445` (feat)

## Files Created/Modified

- `tests/integration/batch-envelope.integration.test.ts` - Covers destructive batch envelopes and best-effort persistence.
- `tests/config/vitest.integration.config.ts` - Registers the new integration test file so the plan verification command runs it.
- `src/mcp/tools/documents/archive.ts` - Wraps array-input per-item success, conflict, and failure results.
- `src/mcp/tools/documents/remove.ts` - Wraps array-input per-item results and returns raw arrays for batch calls.

## Decisions Made

- Bare string array items remain untokened and skip top-level `expected_version` / `if_match`; tokened object items use their own `version_token`.
- `lock_timeout` and other non-version expected per-item errors are reported as `failed` entries with their existing error envelopes; only version mismatches become `conflicted`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Registered new integration test in Vitest include list**
- **Found during:** Task 1
- **Issue:** The focused command `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts` could not discover the newly created test because the integration config uses an explicit include list.
- **Fix:** Added `tests/integration/batch-envelope.integration.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** The command reached the RED assertions before production changes and passed after Task 2.
- **Committed in:** `ac5d2fb`

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** Required to make the plan's own verification command executable; no production scope expansion.

## Issues Encountered

- The RED run initially failed at test discovery due the explicit integration include list; after registering the file it failed on the intended archive/remove contract assertions.
- Focused integration runs log background embedding errors because the test config uses no embedding API key; the tests pass and this is existing integration behavior.

## Known Stubs

None.

## Threat Flags

None - the changed MCP input/output surface was already covered by the plan threat model for destructive batch operations.

## Verification

- `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts` failed before Task 2 on the expected contract gaps.
- `npm run test:integration -- tests/integration/batch-envelope.integration.test.ts` passed after Task 2: 1 file, 2 tests.
- `npm test -- tests/unit/batch-input-shape.test.ts` passed: 1 file, 5 tests.
- `npm run typecheck` passed.
- Source assertions passed for `normalizeBatchIdentifiers`, `jsonToolResult(results)`, `batchSucceeded` / `batchConflicted` / `batchFailed`, archived post-write hash, and literal test IDs `T-I-034` through `T-I-037`.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used by integration tests.

## Next Phase Readiness

Plan 03 can proceed independently on compound-tool batch behavior. This plan did not edit `src/mcp/tools/compound.ts` or tool-help docs.

## Self-Check: PASSED

- Found `tests/integration/batch-envelope.integration.test.ts`.
- Found task commits `ac5d2fb` and `840f445` in git history.
- Verification commands passed from the committed production state.

---
*Phase: 163-multi-file-batch-contract*
*Completed: 2026-05-27*
