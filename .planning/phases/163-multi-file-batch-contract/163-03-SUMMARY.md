---
phase: 163-multi-file-batch-contract
plan: 03
subsystem: api
tags: [mcp, batch-input, version-token, compound-tools, vitest]
requires:
  - phase: 163-multi-file-batch-contract
    provides: Shared mixed batch identifier contracts and batch item response wrappers from Plan 01
provides:
  - Mixed bare/object batch handling for insert_doc_link source identifiers
  - Mixed bare/object document target handling for apply_tags
  - T-I-038 integration coverage for compound mixed input shape
  - Public help text for scoped mixed batch surfaces
affects: [insert_doc_link, apply_tags, archive_document, remove_document, phase-163]
tech-stack:
  added: []
  patterns:
    - Raw ordered arrays for batch array inputs
    - REQ-018 batch item envelopes for document batch entries
key-files:
  created:
    - tests/integration/batch-input-shape.integration.test.ts
    - .planning/phases/163-multi-file-batch-contract/163-03-SUMMARY.md
  modified:
    - src/mcp/tools/compound.ts
    - src/mcp/tool-help/archive_document.tool.md
    - src/mcp/tool-help/remove_document.tool.md
    - src/mcp/tool-help/insert_doc_link.tool.md
    - src/mcp/tool-help/apply_tags.tool.md
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "Version-mismatch entries are the only compound document batch entries marked conflicted; resolution and lock-timeout errors are failed entries."
  - "apply_tags memory target responses remain unwrapped to preserve existing memory semantics."
patterns-established:
  - "Compound document batch handlers wrap successful legacy payloads under data so top-level status remains the unified batch item status."
requirements-completed: [REQ-018, REQ-019]
duration: 7min
completed: 2026-05-27
---

# Phase 163 Plan 03: Mixed Compound Batch Contract Summary

**Mixed source and document-target batch inputs for compound tools with ordered per-item status envelopes**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-27T19:54:40Z
- **Completed:** 2026-05-27T20:01:31Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added T-I-038 integration coverage for mixed `[bare string, current token object, stale token object]` inputs on `insert_doc_link` and `apply_tags`.
- Updated `insert_doc_link` array handling to return a raw ordered array of `succeeded`, `conflicted`, or `failed` batch items.
- Updated document batch entries in `apply_tags` to use REQ-018 envelopes while leaving memory target responses unchanged.
- Updated public help for `archive_document`, `remove_document`, `insert_doc_link`, and `apply_tags` to document the supported mixed array shape.

## Task Commits

1. **Task 1: Add mixed compound input integration coverage** - `fb7f536` (test)
2. **Task 2: Thread per-item tokens through insert_doc_link and apply_tags** - `ef17fd1` (feat)
3. **Task 3: Update scoped tool help for mixed batch inputs** - `e143e79` (docs)

## Files Created/Modified

- `tests/integration/batch-input-shape.integration.test.ts` - T-I-038 integration coverage for compound mixed batch inputs and memory-target regression.
- `tests/config/vitest.integration.config.ts` - Adds the new integration test to the explicit Vitest integration include list.
- `src/mcp/tools/compound.ts` - Threads per-item tokens through compound document batch loops and emits batch item envelopes.
- `src/mcp/tool-help/archive_document.tool.md` - Documents mixed batch identifiers and raw ordered batch results.
- `src/mcp/tool-help/remove_document.tool.md` - Documents mixed batch identifiers and raw ordered batch results.
- `src/mcp/tool-help/insert_doc_link.tool.md` - Documents mixed source identifiers and raw ordered batch results for array input.
- `src/mcp/tool-help/apply_tags.tool.md` - Documents mixed document targets and preserved memory response semantics.

## Decisions Made

- Version mismatches use `status: "conflicted"` with the Phase 162 conflict envelope; document resolution failures and lock timeouts use `status: "failed"`.
- `insert_doc_link` preserves the existing wrapped response for single-string calls, but array input now returns the raw ordered array required by REQ-018.
- `apply_tags` wraps document batch entries only when processing document arrays; memory target payloads stay in their existing shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the new integration test to the explicit Vitest include list**
- **Found during:** Task 1
- **Issue:** `npm run test:integration -- tests/integration/batch-input-shape.integration.test.ts` could not discover the new test because the integration config uses an explicit include list.
- **Fix:** Added `tests/integration/batch-input-shape.integration.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** The same integration command discovered the file and failed RED for the expected contract gaps, then passed after Task 2.
- **Committed in:** `fb7f536`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Required for the plan's own verification command; no runtime scope added.

## Issues Encountered

- Focused integration runs logged expected background embedding errors because the test config uses no embedding API key. The assertions passed and no setup action is required.
- Unrelated dirty files were present before and during execution, including concurrent Phase 163-02 document-tool changes. They were not staged or committed by this plan.

## Known Stubs

None.

## Threat Flags

None - changed MCP input/output and help surfaces were already covered by the plan threat model.

## Verification

- `npm run test:integration -- tests/integration/batch-input-shape.integration.test.ts` failed before production changes as expected.
- `npm run test:integration -- tests/integration/batch-input-shape.integration.test.ts` passed after implementation: 3 tests passed.
- `npm test -- tests/unit/batch-input-shape.test.ts` passed: 5 tests passed.
- `npm run typecheck` passed.
- `rg -n "version_tokens|identifier-token map|atomic batch|call_macro atomic" src/mcp/tool-help/archive_document.tool.md src/mcp/tool-help/remove_document.tool.md src/mcp/tool-help/insert_doc_link.tool.md src/mcp/tool-help/apply_tags.tool.md; test $? -eq 1` passed.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used by integration tests.

## Next Phase Readiness

Plan 04 can rely on the compound mixed-input contract and public help text matching REQ-018/REQ-019. Concurrent Plan 02 changes to archive/remove implementation files remain outside this plan.

## Self-Check: PASSED

- Found all created/modified plan-owned files.
- Found task commits `fb7f536`, `ef17fd1`, and `e143e79` in git history.

---
*Phase: 163-multi-file-batch-contract*
*Completed: 2026-05-27*
