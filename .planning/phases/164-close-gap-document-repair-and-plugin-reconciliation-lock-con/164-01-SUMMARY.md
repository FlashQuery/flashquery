---
phase: 164-close-gap-document-repair-and-plugin-reconciliation-lock-con
plan: 01
subsystem: mcp-documents
tags: [vault-write-coherency, document-locks, get-document, version-token]
requires:
  - phase: 162-version-fingerprint-check
    provides: raw-byte version token and content_hash equality model
provides:
  - get_document repair writes guarded by shared ancestor directory locks and document locks
  - cache-hit and no-repair scan paths that remain lock-free
affects: [documents, vault-write, version-token]
tech-stack:
  added: []
  patterns: [caller-owned document-path lock envelope around repair writes]
key-files:
  created: []
  modified:
    - src/mcp/utils/document-output.ts
    - src/mcp/utils/document-resolver-primitives.ts
    - tests/unit/get-document-no-lock.test.ts
    - tests/unit/single-write-primitive.test.ts
key-decisions:
  - "Lock only the frontmatterChanged repair write branch; keep cache-hit and no-repair read paths lock-free."
patterns-established:
  - "Repair writes use withAncestorDirectoryLocksShared outside withDocumentLock before writeVaultFile."
requirements-completed: [REQ-001, REQ-007, REQ-009, REQ-014, REQ-020]
duration: 29min
completed: 2026-05-28
---

# Phase 164 Plan 01: Read-Triggered Repair Lock Contract Summary

**get_document repair writes now hold document-path locks while pure reads and no-repair scans stay lock-free**

## Performance

- **Duration:** 29 min
- **Started:** 2026-05-28T00:00:00Z
- **Completed:** 2026-05-28T00:29:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added source-level guards proving cache-hit `get_document` does not call `targetedScan` or lock helpers.
- Wrapped only the `targetedScan` `frontmatterChanged` repair write with shared ancestor directory locks outside `withDocumentLock`.
- Preserved `writeMarkdownFile` delegation to `writeVaultFile(..., { lockConfig: config })` and post-write content hash propagation.

## Task Commits

1. **Tasks 1-3: repair lock tests, implementation, and evidence** - `9e4e464` (feat)

## Files Created/Modified

- `src/mcp/utils/document-output.ts` - Uses the full config type so downstream repair helpers receive lock config.
- `src/mcp/utils/document-resolver-primitives.ts` - Adds the document-path lock envelope around actual repair writes.
- `tests/unit/get-document-no-lock.test.ts` - Adds T-U-037 cache-hit and repair-branch source guards.
- `tests/unit/single-write-primitive.test.ts` - Updates primitive routing guard for the new caller-owned lock envelope.

## Decisions Made

Lock acquisition is intentionally inside `targetedScan` and only around the repair write branch. This preserves INV-07 for pure reads while satisfying the caller-owned `writeVaultFile` assertion when repair mutates frontmatter.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The first red cache-hit test matched the word `targetedScan` in a comment. The test was corrected to strip comments before asserting executable code paths.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can rely on the same caller-owned document-path lock pattern for plugin reconciliation frontmatter writes.

---
*Phase: 164-close-gap-document-repair-and-plugin-reconciliation-lock-con*
*Completed: 2026-05-28*
