---
phase: 127-removal-directory-and-vault-maintenance
verified: 2026-05-12T22:01:33Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
deferred:
  - truth: "Removed legacy directory/scan tools are absent from every final host/delegated surface and config selector path."
    addressed_in: "Phase 128"
    evidence: "Roadmap Phase 128 goal: 'The final host/delegated MCP surface is reduced, documented, tested, and free of stale merged/dead tools.' REQUIREMENTS.md maps DOC-10, MEM-05, SYS-04, SYS-05, and SYS-06 to Phase 128; 127-VALIDATION.md explicitly excludes broad global legacy cleanup as 'Scoped to Phase 128'."
---

# Phase 127: Removal, Directory, And Vault Maintenance Verification Report

**Phase Goal:** Destructive and administrative filesystem operations are explicit, structured, git-aware, and safely tested.  
**Verified:** 2026-05-12T22:01:33Z  
**Status:** passed  
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `remove_document` archives lifecycle state before trash-folder move or hard deletion and returns ordered batch results with git policy honored. | VERIFIED | `src/mcp/tools/documents.ts` registers `remove_document`, writes `FM.STATUS:"archived"`/`FM.ARCHIVED_AT` and DB archived fields before `vaultManager.moveMarkdownToTrash()` or `vaultManager.removeMarkdown()`. `src/storage/vault.ts` routes removals to `gitManager.commitVaultRemoval()`, and `src/git/manager.ts` stages deletions/moves with `git add -A`. Integration covers hard delete, trash, collision, invalid trash path, batch, and remove-then-maintenance. |
| 2 | `manage_directory(action:"create")` and `manage_directory(action:"remove")` replace directory create/remove tools with ordered per-path results and directory-scoped locking. | VERIFIED | `src/mcp/tools/files.ts` registers `manage_directory`, validates paths, processes `for...of` in order, locks `directory:${normalizedPath}`, creates recursively, removes only empty directories, and returns `{ results }` JSON. Unit/integration tests cover idempotent create, duplicate order, traversal/symlink/file conflicts, non-empty conflict, and lock contention. |
| 3 | `maintain_vault` replaces scan/reconcile tools with sync, repair, repair+sync, dry-run, background job, status, and conflict behavior. | VERIFIED | `src/mcp/tools/scan.ts` registers only `maintain_vault` for scan tools and delegates to `src/services/maintenance.ts`. The service normalizes combined actions to repair before sync, calls `repairFrontmatter()` and `runScanOnce()`, validates `dry_run`/`background`, records process-local jobs, exposes status, and returns `maintenance_in_progress` conflicts. |
| 4 | High-risk destructive/admin behavior has explicit expected-error coverage, including non-empty directory conflicts, invalid trash paths, missing documents, and concurrent maintenance. | VERIFIED | `tests/unit/manage-directory.test.ts`, `tests/integration/manage-directory.integration.test.ts`, `tests/integration/remove-document.integration.test.ts`, and `tests/unit/maintain-vault.test.ts` cover `directory_not_empty`, `path_traversal`/`unsafe_trash`, batch `not_found`, and `maintenance_in_progress` with `isError:false` expected-error envelopes. |
| 5 | Unit, integration, E2E, directed scenario, and integration scenario coverage ship with the phase. | VERIFIED | Files exist and are substantive: `tests/unit/{remove-document,manage-directory,maintain-vault}.test.ts`, `tests/integration/{remove-document,manage-directory,maintain-vault}.integration.test.ts`, `tests/e2e/protocol.test.ts`, `tests/scenarios/directed/testcases/test_removal_directory_maintenance.py`, and `tests/scenarios/integration/tests/removal_directory_maintenance.yml`. |
| 6 | Scenario tests prove real user workflows across write/search/remove/maintenance, not just handler-level calls. | VERIFIED | Directed scenario has 37 workflow steps recorded in validation. YAML scenario composes directory creation, write/search, `remove_document`, `maintain_vault` repair/sync/status, and search exclusion after removal. Coverage rows `D-rdoc-*`, `D-mdir-*`, `D-mvault-*`, `INT-rdoc-*`, `INT-mdir-*`, and `INT-mvault-*` reference the scenario files. |

**Score:** 6/6 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|--------------|----------|
| 1 | Code-review warning WR-01: removed tools can still appear in delegated selector/config paths (`getToolNamesByTier()` and purpose validation). | Phase 128 | Phase 128 goal explicitly covers final host/delegated stale-tool cleanup. `127-VALIDATION.md` classifies broad legacy cleanup as Phase 128 scope. Host MCP exposure for Phase 127 is already guarded by `src/mcp/tool-exposure.ts` and E2E absence checks. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/mcp/tools/documents.ts` | `remove_document` handler | VERIFIED | Archives frontmatter/DB before move/delete; resolves trash root safely; writes `FM.ORIGINAL_PATH`; ordered batch output. |
| `src/storage/vault.ts` / `src/git/manager.ts` | Git-aware delete/trash helpers | VERIFIED | `removeMarkdown()`, `moveMarkdownToTrash()`, and `commitVaultRemoval()` use git removal policy with `add -A`. |
| `src/mcp/tools/files.ts` | `manage_directory` handler | VERIFIED | JSON-only ordered results, path validation, empty-dir-only remove, per-path locks. |
| `src/services/maintenance.ts` / `src/mcp/tools/scan.ts` | `maintain_vault` service and handler | VERIFIED | Sync/repair/status/background/conflict implementation wired to scanner and MCP handler. |
| `TRACEABILITY.md` / `127-VALIDATION.md` | Requirement-to-evidence ledger and final gates | VERIFIED | DOC-09, SYS-01, SYS-02, SYS-03 all mapped to unit, integration, E2E, directed, YAML scenario, and validation evidence. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/mcp/tools/documents.ts` | `src/config/loader.ts` | `config.trashFolder` | WIRED | Loader exposes `trashFolder`; handler resolves trash path at use time. |
| `src/mcp/tools/documents.ts` | `src/constants/frontmatter-fields.ts` | `FM.ORIGINAL_PATH` | WIRED | Trash move metadata uses `FM.ORIGINAL_PATH`, not a raw field constant in the removal write path. |
| `src/mcp/tools/documents.ts` | `src/storage/vault.ts` | `removeMarkdown` / `moveMarkdownToTrash` | WIRED | Handler uses vault helpers rather than raw unlink/rename. |
| `src/storage/vault.ts` | `src/git/manager.ts` | `commitVaultRemoval` | WIRED | Hard delete and trash moves route through git removal policy. |
| `src/mcp/tools/files.ts` | `src/services/write-lock.ts` | `acquireLock` with `directory:${normalizedPath}` | WIRED | Create and remove acquire/release per-path locks when locking is enabled. |
| `src/mcp/tools/scan.ts` | `src/services/maintenance.ts` | `maintainVault` / `getMaintenanceJobStatus` | WIRED | MCP handler maps service success to `jsonToolResult` and expected errors to JSON expected-error responses. |
| `src/services/maintenance.ts` | `src/services/scanner.ts` | `runScanOnce` / `repairFrontmatter` | WIRED | Real scanner/repair functions populate maintenance action counts. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `remove_document` | removal payload / archived row | `resolveDocumentIdentifier()`, `vaultManager.readMarkdown()`, Supabase `fqc_documents.update()`, vault remove/trash helpers | Yes | FLOWING |
| `manage_directory` | `results[]` | `validateVaultPath()`, `stat()`, `mkdir()`, `readdir()`, `rmdir()`, write-lock service | Yes | FLOWING |
| `maintain_vault` | `actions[]`, job status | `repairFrontmatter()`, `runScanOnce()`, process-local job map | Yes | FLOWING |
| Scenario coverage | coverage rows and workflow assertions | Directed/YAML scenario files and coverage matrices | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Focused Phase 127 unit contracts pass | `npm test -- tests/unit/remove-document.test.ts tests/unit/manage-directory.test.ts tests/unit/maintain-vault.test.ts tests/unit/config.test.ts tests/unit/tool-metadata.test.ts` | 5 files passed, 74 tests passed | PASS |
| Project still builds after verification | `npm run build` | ESM and DTS builds succeeded | PASS |
| Built entry imports | `node --input-type=module -e "import('./dist/index.js')..."` | `dist import ok` | PASS |
| Supabase-backed integration/E2E/scenario gates | Not re-run in this verification pass | `127-VALIDATION.md` records previous green focused integration, E2E, directed, YAML scenario, and build gates | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DOC-09 | Plans 01, 04, 05, 06 | `remove_document` archives lifecycle before trash/hard delete, preserves ordered batch results, honors git policy. | SATISFIED | Source wiring plus `tests/integration/remove-document.integration.test.ts`, protocol tests, directed/YAML scenarios, and traceability. |
| SYS-01 | Plans 01, 02, 05, 06 | `manage_directory(action:"create")` replaces `create_directory` with ordered idempotent path-safe locked results. | SATISFIED | `src/mcp/tools/files.ts`, unit/integration tests, E2E and scenario workflows. |
| SYS-02 | Plans 01, 02, 05, 06 | `manage_directory(action:"remove")` replaces `remove_directory` with ordered empty-dir-only removal and non-empty conflicts. | SATISFIED | `directory_not_empty` implementation and coverage across unit/integration/E2E/scenario tests. |
| SYS-03 | Plans 01, 03, 05, 06 | `maintain_vault` replaces scan/reconcile behavior with sync, repair, status, dry-run, background sync, and conflict handling. | SATISFIED | `src/services/maintenance.ts`, `src/mcp/tools/scan.ts`, focused tests, protocol and scenarios. |

No orphaned Phase 127 requirement IDs were found in `.planning/REQUIREMENTS.md`; DOC-09, SYS-01, SYS-02, and SYS-03 are all mapped to Phase 127 and marked complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/mcp/tool-metadata.ts` | 293 | Removed legacy tools are still included by delegated tier expansion | WARNING / Deferred | Code-review WR-01 is real but belongs to Phase 128 final host/delegated stale-tool cleanup, not the Phase 127 final-tool behavior. |
| `src/config/loader.ts` | 576 | Purpose validation only rejects removed legacy suggestions when `hostEligible === false` | WARNING / Deferred | Same Phase 128 selector/config cleanup context. |

No Phase 127 blocker stubs found. Grep hits for `return null`/`return []` are normal guard/helper branches, not user-visible placeholder behavior. Old prose-response audit returned no active Phase 127 migrated assertions.

### Human Verification Required

None. Phase behavior is covered by code inspection plus automated unit/build spot checks, with Supabase-backed gates already recorded in `127-VALIDATION.md`.

### Gaps Summary

No Phase 127 blocking gaps found. The final `remove_document`, `manage_directory`, and `maintain_vault` surfaces exist, are wired to real filesystem/DB/scanner/git paths, have traceability to DOC-09/SYS-01/SYS-02/SYS-03, and ship focused unit, integration, E2E, directed, and YAML scenario coverage.

The remaining legacy selector/config warning is deferred to Phase 128, whose roadmap goal explicitly owns final stale-tool surface cleanup.

---

_Verified: 2026-05-12T22:01:33Z_  
_Verifier: the agent (gsd-verifier)_
