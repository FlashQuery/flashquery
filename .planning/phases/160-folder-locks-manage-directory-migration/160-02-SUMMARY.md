---
phase: 160-folder-locks-manage-directory-migration
plan: 02
subsystem: mcp-tools
tags: [directory-locks, document-tools, scanner]
requires:
  - phase: 160-folder-locks-manage-directory-migration
    provides: plan 01 directory lock facade
provides:
  - shared ancestor directory locks around file write paths
  - source guards for document, compound, and scanner writes
affects: [write-document, archive-document, remove-document, copy-document, move-document, compound, scanner]
tech-stack:
  added: []
  patterns: [outer shared directory lock around existing per-file write lock]
key-files:
  created: []
  modified:
    - src/mcp/tools/documents/write.ts
    - src/mcp/tools/documents/archive.ts
    - src/mcp/tools/documents/remove.ts
    - src/mcp/tools/documents/copy.ts
    - src/mcp/tools/documents/move.ts
    - src/mcp/tools/compound.ts
    - src/services/scanner.ts
    - tests/unit/document-tool-lock-call-sites.test.ts
requirements-completed: [REQ-007]
duration: 18 min
completed: 2026-05-27
---

# Phase 160 Plan 02: File-Write Shared Directory Locks Summary

**Document, compound, and scanner writes now hold shared ancestor directory advisory locks while preserving per-file lock behavior**

## Accomplishments

- Wrapped owned file-write paths with `withAncestorDirectoryLocksShared`.
- Preserved existing `LockTimeoutError` envelopes and per-file write serialization.
- Added source guards for write_document, archive/remove/copy/move, compound mutations, and scanner frontmatter repair.

## Task Commits

1. **Task 1/2: Source guards and migration** - `33a40a0`, `d98b570`

## Deviations from Plan

Integration evidence was added with Plan 03 because the public `manage_directory` side was needed for useful end-to-end assertions.

## Issues Encountered

None.

## Next Phase Readiness

Plan 03 can now rely on descendant file writes holding shared folder locks.
