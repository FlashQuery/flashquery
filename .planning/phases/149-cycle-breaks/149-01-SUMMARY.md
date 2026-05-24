---
phase: 149-cycle-breaks
plan: 01
subsystem: storage
tags: [documents, plugins, circular-deps, supabase]
requires: []
provides:
  - Lower-level document primitives shared by resolver, scanner, plugin services, and MCP tools
  - REQ-010 document/plugin import direction fix
affects: [documents, plugins, scanner, resolver]
tech-stack:
  added: []
  patterns: [dependency-light storage primitive module]
key-files:
  created: [src/storage/document-primitives.ts]
  modified: [src/mcp/tools/documents.ts, src/mcp/utils/resolve-document.ts, src/services/scanner.ts, src/services/plugin-reconciliation.ts, tests/unit/document-tools.test.ts, tests/unit/resolve-document.test.ts, tests/integration/identity-resolution.test.ts]
key-decisions:
  - "Kept compatibility re-exports from documents.ts while moving service imports to storage/document-primitives.ts."
  - "Made primitive logging tolerate uninitialized logger in direct unit imports."
patterns-established:
  - "Shared document file/hash/frontmatter helpers live below MCP tools."
requirements-completed: [REQ-010]
duration: 25 min
completed: 2026-05-24
---

# Phase 149 Plan 01: Document Primitive Extraction Summary

**Dependency-light document file/hash/frontmatter primitives consumed by resolver, scanner, plugin services, and document MCP tools**

## Performance

- **Duration:** 25 min
- **Started:** 2026-05-24T21:05:00Z
- **Completed:** 2026-05-24T21:31:24Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Created `src/storage/document-primitives.ts` for `DocMeta`, `computeHash`, `listMarkdownFiles`, `parseDocMeta`, and `reconcileMissingRow`.
- Updated resolver, scanner, plugin reconciliation, and targeted tests to import primitives from storage instead of MCP document tools.
- Added T-U-021 hash/listing assertions and preserved compatibility exports for existing tool consumers.

## Task Commits

1. **Task 1/2: Pin and extract document/plugin primitives** - `16ff0f0` (feat)

**Plan metadata:** committed with phase summary artifacts.

## Files Created/Modified

- `src/storage/document-primitives.ts` - Shared document primitive module.
- `src/mcp/tools/documents.ts` - Re-exports primitives and keeps document tool orchestration.
- `src/mcp/utils/resolve-document.ts` - Imports `listMarkdownFiles` from storage.
- `src/services/scanner.ts` - Imports `computeHash` and `listMarkdownFiles` from storage.
- `src/services/plugin-reconciliation.ts` - Imports `computeHash` from storage.
- `tests/unit/document-tools.test.ts` - Adds stable hash and markdown listing behavior coverage.

## Decisions Made

Kept compatibility re-exports from `documents.ts` so existing MCP/tool imports continue to work while lower-level services stop depending on the MCP tool module.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The first direct primitive unit assertion exposed that `logger` can be undefined when the primitive module is imported before logger initialization. The primitive now uses optional debug logging, preserving behavior while avoiding import-order fragility.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

REQ-010 document/plugin target import direction is ready for the final targeted madge gate in Plan 149-04.

---
*Phase: 149-cycle-breaks*
*Completed: 2026-05-24*
