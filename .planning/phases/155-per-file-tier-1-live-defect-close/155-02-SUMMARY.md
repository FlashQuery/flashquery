---
phase: 155-per-file-tier-1-live-defect-close
plan: 02
subsystem: mcp-tools
tags: [document-lock, write-document, compound, macro]
requires:
  - phase: 155-01
    provides: document-lock facade
provides:
  - Document and compound write call sites migrated off the coarse documents lock
  - Macro engine static guard and help text for per-step locking semantics
affects: [document-tools, compound-tools, macro]
tech-stack:
  added: []
  patterns:
    - Resolve enough path identity before lock; re-read or re-resolve inside per-file lock for mutation
key-files:
  created:
    - tests/unit/document-tool-lock-call-sites.test.ts
    - tests/unit/macro-no-lock-imports.test.ts
  modified:
    - src/mcp/tools/documents/write.ts
    - src/mcp/tools/documents/archive.ts
    - src/mcp/tools/documents/remove.ts
    - src/mcp/tools/documents/copy.ts
    - src/mcp/tools/documents/move.ts
    - src/mcp/tools/compound.ts
    - src/mcp/tool-help/call_macro.tool.md
    - tests/unit/archive-document.test.ts
key-decisions:
  - "Macro execution remains lock-free; called tools provide per-step document locking."
  - "Lock timeout errors from the facade are converted back to conflict/lock_contention envelopes at tool boundaries."
patterns-established:
  - "Document tools call withDocumentLock/withDocumentLocks with absolute paths."
requirements-completed: [REQ-001, REQ-009, REQ-010, REQ-025]
duration: 40 min
completed: 2026-05-26
---

# Phase 155 Plan 02: Document and Compound Lock Migration Summary

**Document and compound write handlers now use per-file locking, while call_macro stays macro-lock-free and documents per-step semantics**

## Performance

- **Duration:** 40 min
- **Started:** 2026-05-26T15:12:00Z
- **Completed:** 2026-05-26T15:52:16Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Migrated document create/update/archive/remove/copy/move paths from direct `acquireLock('documents')` to `withDocumentLock` / `withDocumentLocks`.
- Wrapped compound document mutations including `insert_doc_link`, document-target `apply_tags`, `insert_in_doc`, and `replace_doc_section`.
- Added static guards for document call-site migration and macro no-lock imports.
- Updated `call_macro` help text to state per-step locking, no macro-spanning atomicity, and deferred version-token auto-threading.

## Task Commits

1. **Task 155-02-01: Add call-site migration tests and macro static guard** - `40703d8` (test)
2. **Task 155-02-02: Migrate document tools to withDocumentLock** - `29ad61a` (feat)
3. **Task 155-02-03: Migrate compound tools and document macro semantics** - `29ad61a`, `4c88ab2` (feat/docs)

## Files Created/Modified

- `src/mcp/tools/documents/write.ts` - Per-file lock around create/update mutations.
- `src/mcp/tools/documents/archive.ts` - Per-item archive lock.
- `src/mcp/tools/documents/remove.ts` - Per-item removal/archive lock.
- `src/mcp/tools/documents/copy.ts` - Destination path lock around destination existence and write.
- `src/mcp/tools/documents/move.ts` - Source/destination `withDocumentLocks` usage.
- `src/mcp/tools/compound.ts` - Per-file locks for document mutations.
- `src/mcp/tool-help/call_macro.tool.md` - REQ-025 semantics.
- `tests/unit/document-tool-lock-call-sites.test.ts` - Static migration guard.
- `tests/unit/macro-no-lock-imports.test.ts` - Macro lock boundary guard.

## Decisions Made

- Kept macro-level code free of direct lock calls; this preserves REQ-025 and avoids implying macro transaction semantics.
- Converted `LockTimeoutError` to existing `conflict` / `lock_contention` envelopes at each document tool boundary.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated old archive lock tests to per-file resource expectations**
- **Found during:** Task 155-02-02
- **Issue:** Existing tests asserted the retired coarse `documents` resource.
- **Fix:** Updated expectations to `document:/tmp/fq-unit/Notes/Archive Me.md`.
- **Files modified:** `tests/unit/archive-document.test.ts`
- **Verification:** affected document tool unit suite passed.
- **Committed in:** `29ad61a`

---

**Total deviations:** 1 auto-fixed.
**Impact on plan:** Aligns legacy unit expectations with the Phase 155 contract.

## Issues Encountered

The broad integration selector `npm run test:integration -- -t "per-file|apply-tags|insert-doc-link|call-macro-per-step"` repeatedly rebuilt the project across unrelated integration files and was killed after proving unbounded in this repo state. It is recorded as inconclusive, not passed.

## Verification

- `npm test -- tests/unit/document-tool-lock-call-sites.test.ts tests/unit/macro-no-lock-imports.test.ts` — passed.
- `npm test -- tests/unit/document-lock-registry.test.ts tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts tests/unit/document-tool-lock-call-sites.test.ts tests/unit/macro-no-lock-imports.test.ts tests/unit/scanner.test.ts` — passed.
- `npm test -- tests/unit/write-document.test.ts tests/unit/archive-document.test.ts tests/unit/remove-document.test.ts tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/advanced-document-tools.test.ts tests/unit/apply-tags.test.ts` — passed.
- `npm run typecheck` — passed.
- Static grep for `acquireLock('documents')` / `releaseLock('documents')` in document and compound tools — no matches.
- Static grep for lock imports/calls in macro engine files — no matches.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 155-03 directed scenario evidence and final validation recording.

---
*Phase: 155-per-file-tier-1-live-defect-close*
*Completed: 2026-05-26*
