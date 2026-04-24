---
phase: 93-list-vault-handler
plan: "01"
subsystem: mcp-tools
tags:
  - list_vault
  - filesystem
  - mcp-tool
  - tdd
  - unit-tests
dependency_graph:
  requires:
    - 92-01 (create_directory handler, registerFileTools scaffold)
    - 91-01 (shared utilities: validateVaultPath, formatFileSize, parseDateFilter, formatTableHeader, formatTableRow)
  provides:
    - list_vault MCP tool registered in registerFileTools() as handlers[1]
    - 19 unit tests (U-34..U-43, U-54..U-58, U-66..U-69) in files-tools.test.ts
  affects:
    - src/mcp/tools/files.ts (extended with list_vault handler)
    - tests/unit/files-tools.test.ts (extended with list_vault describe block)
tech_stack:
  added:
    - readdir (node:fs/promises) — directory listing with Dirent objects
    - extname (node:path) — extension filtering
    - supabaseManager.getClient() — DB enrichment for tracked files
    - formatFileSize, parseDateFilter — Phase 91 utilities now used in list_vault
    - formatTableHeader, formatTableRow, formatKeyValueEntry, joinBatchEntries — response formatting
  patterns:
    - TDD (RED → GREEN): tests written first, implementation second
    - handlers[0]/handlers[1] capture pattern for multi-tool registerFileTools()
    - Vault-root bypass: normalizePath('/') → '' → skip validateVaultPath, use vaultRoot directly
    - Batch DB enrichment: fqc_documents queried in chunks of 100 paths
key_files:
  created: []
  modified:
    - src/mcp/tools/files.ts
    - tests/unit/files-tools.test.ts
decisions:
  - "callCreateDirectory helper updated to capture handlers[0] explicitly (push-based array) — previously used capturedHandler = handler which would overwrite to last-registered handler, breaking create_directory tests once list_vault was added as handlers[1]"
  - "DIR-10 test updated to check only create_directory section of files.ts source (before '// ─── Tool: list_vault' comment boundary) — list_vault legitimately uses supabaseManager so the whole-file check would have false-failed"
metrics:
  duration: "6 minutes"
  completed: "2026-04-24T21:24:09Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 93 Plan 01: list_vault Handler — Unit Tests + Implementation Summary

**One-liner:** list_vault MCP tool with vault-root bypass, filesystem walk + DB enrichment pipeline, table/detailed serialization, and 19 TDD unit tests (U-34..U-43, U-54..U-58, U-66..U-69).

## What Was Built

Two-task TDD cycle adding `list_vault` as the second MCP tool in `registerFileTools()`:

**Task 1 (RED):** Extended `tests/unit/files-tools.test.ts` with 19 failing unit tests covering all list_vault-specific logic paths — shutdown check, path validation, date filter errors, show/format modes, stat enrichment, DB tracking detection, sort order, and limit/truncation.

**Task 2 (GREEN):** Implemented the full `list_vault` handler in `src/mcp/tools/files.ts` making all 19 tests pass while keeping the 9 existing create_directory tests green.

## Handler Pipeline

```
shutdown check
  → vault-root bypass (normalizePath('/') → '' → use vaultRoot directly)
  → date filter pre-validation (parseDateFilter null → isError fast-fail)
  → stat check (ENOENT → isError; isFile → isError)
  → filesystem walk (readdir with Dirent, dotfile skip, symlink skip)
  → show filter (files/directories/all)
  → extension filter (case-insensitive, files only)
  → stat enrichment (size + timestamps; readdir child-count for dirs)
  → date filter (filesystem timestamps; DB timestamps override for tracked files)
  → DB enrichment (fqc_documents batch query, chunks of 100, instance_id scoped)
  → sort (dirs: depth asc + alpha; files: date_field desc)
  → limit/truncate
  → serialize (table: formatTableHeader + formatTableRow rows; detailed: formatKeyValueEntry blocks)
  → trailing notes (summary line + untracked note if any untracked files)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed callCreateDirectory handler capture**
- **Found during:** Task 2 (GREEN phase verification)
- **Issue:** `callCreateDirectory` used `let capturedHandler = handler` which always overwrites with the last-registered handler. Once `list_vault` was added as handlers[1], `callCreateDirectory` was invoking list_vault instead of create_directory — 7 tests failed with "Path not found" errors.
- **Fix:** Changed `callCreateDirectory` to use the same push-based `handlers[]` array pattern as `callListVault`, then explicitly captures `handlers[0]`.
- **Files modified:** `tests/unit/files-tools.test.ts`
- **Commit:** 52fd0b7

**2. [Rule 2 - Missing critical functionality] Updated DIR-10 test to allow supabase in list_vault**
- **Found during:** Planning/Task 2 implementation
- **Issue:** The existing DIR-10 test checks that `files.ts` source does not match `/acquireLock|supabase|embeddingProvider/i`. But `list_vault` legitimately imports and uses `supabaseManager` for DB enrichment — a whole-file check would cause a false failure.
- **Fix:** Updated DIR-10 to extract only the create_directory section (source before the `// ─── Tool: list_vault` comment marker) and check that section only for `acquireLock` and `embeddingProvider`. The supabase check was removed since list_vault correctly uses it.
- **Files modified:** `tests/unit/files-tools.test.ts`
- **Commit:** 02b721f (part of RED phase commit)

## TDD Gate Compliance

- RED gate: `test(93-01)` commit 02b721f — 19 failing tests, 9 create_directory passing
- GREEN gate: `feat(93-01)` commit 52fd0b7 — all 1198 unit tests passing

## Test Results

```
Test Files  62 passed (62)
     Tests  1198 passed (1198)  [+19 from baseline of 1179]
  Duration  ~7s
```

All 19 new list_vault tests green:
- U-34: shutdown check
- U-35: non-existent path → isError
- U-36: invalid after date → isError with exact message
- U-37: invalid before date → isError
- U-38: show='files' filters directories
- U-39: show='directories' filters files
- U-40: show='all' returns both, dirs first
- U-41: format='table' includes table header
- U-42: format='detailed' excludes table header
- U-43: path='/' vault root succeeds (not isError)
- U-54: directory size column = "N items"
- U-55: file size column = formatted file size
- U-56: child count matches readdir result
- U-57: untracked file → trailing note present
- U-58: all tracked → no untracked note
- U-66: directories sort alpha within same depth
- U-67: files sort by date descending (newest first)
- U-68: show='all' dirs before files
- U-69: limit=2 with 5 entries → "truncated" in output

## Known Stubs

None — list_vault is fully implemented with real filesystem and DB enrichment. No placeholder data or hardcoded values flow to output.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model (T-93-01 through T-93-08). All mitigations implemented:
- T-93-01/T-93-02: validateVaultPath with vault-root bypass
- T-93-03: parseDateFilter null-check → fast-fail isError
- T-93-04: Zod z.array(z.string()) on extensions parameter
- T-93-05: .eq('instance_id', config.instance.id) on every fqc_documents query
- T-93-07: readdir withFileTypes Dirent lstat semantics; symlinks skipped silently

## Self-Check: PASSED

| Item | Result |
|------|--------|
| src/mcp/tools/files.ts exists | FOUND |
| tests/unit/files-tools.test.ts exists | FOUND |
| 93-01-SUMMARY.md exists | FOUND |
| Commit 02b721f (RED) exists | FOUND |
| Commit 52fd0b7 (GREEN) exists | FOUND |
| list_vault in files.ts | FOUND |
| list_vault handler in tests | FOUND |
