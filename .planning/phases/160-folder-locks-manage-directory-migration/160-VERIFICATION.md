---
phase: 160-folder-locks-manage-directory-migration
status: partially_verified
verified: 2026-05-28T12:38:00-03:00
requirements:
  - REQ-007
  - REQ-024
source_requirements: /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md
source_test_plan: /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md
---

# Phase 160 Verification

## Result

Phase 160 is verified for local helper behavior, source call-site wiring, public `manage_directory` rename/move shape, and the sequential public folder coordination scenario.

It remains partially verified for the session-scoped advisory-lock contention assertions because the current `.env.test` `DATABASE_URL` uses the Supabase transaction pooler endpoint on port `6543`. The relevant integration files correctly report those tests as skipped rather than falsely passing them.

## Requirement Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-007 - Shared/exclusive directory locks for folder coordination | Partially verified | Unit/static coverage and source wiring passed. Public sequential scenario passed. Session-capable advisory contention tests are present but skipped under current `.env.test`. |
| REQ-024 - `manage_directory` migrates to advisory directory locks | Partially verified | Unit/static coverage and public rename workflow passed. Session-visible exclusive-lock and same-folder contention integrations are skipped until `.env.test` uses a session-capable database URL. |

## Fresh Automated Evidence

Executed with `.env.test` sourced where credentials were needed:

- `npm run typecheck` - passed.
- `npm run build` - passed.
- `npm test -- tests/unit/with-directory-lock.test.ts tests/unit/lock-helper-only.test.ts tests/unit/document-tool-lock-call-sites.test.ts tests/unit/write-document.test.ts tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/archive-document.test.ts tests/unit/document-batch-lock-contention.test.ts tests/unit/replace-doc-section.test.ts tests/unit/manage-directory.test.ts --testNamePattern "with-directory-lock|directory-lock|ancestor|lock_timeout|write_document|archive_document|remove_document|copy_document|move_document|replace_doc_section|manage_directory|T-U-039|T-U-040|T-U-041|T-U-042|T-U-043"` - passed, 9 files passed / 1 skipped; 54 tests passed / 5 skipped.
- `npm run test:integration -- tests/integration/folder-lock.integration.test.ts tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "T-I-011|T-I-012|T-I-013|T-I-046|T-I-047|folder-lock|manage-directory-advisory"` - reported 2 files skipped / 6 tests skipped due current non-session-capable `.env.test`.
- `python3 tests/scenarios/integration/run_integration.py --managed folder_coordination` - passed, 1/1 scenarios and 4/4 steps.

## UAT Evidence

`160-UAT.md` records four checks:

- Directory lock helper facade: passed.
- File write shared ancestor directory locks: passed.
- Manage directory exclusive structural locks: unit/static and public scenario evidence passed; session-advisory integration assertions skipped under current `.env.test`.
- Folder coordination public scenario: passed for the sequential public workflow; true in-flight contention remains outside the current scenario runner's concurrency capability.

## Codebase Evidence

- `src/services/document-lock.ts` contains shared and exclusive directory advisory helpers, using `pg_try_advisory_lock_shared`, `pg_advisory_unlock_shared`, and canonical directory lock entries.
- `src/mcp/tools/documents/write.ts`, `archive.ts`, `remove.ts`, `copy.ts`, and `move.ts` call `withAncestorDirectoryLocksShared` around file-writing or structurally affected paths.
- `src/mcp/tools/compound.ts` and `src/services/scanner.ts` call `withAncestorDirectoryLocksShared` around compound/scanner write paths.
- `src/mcp/tools/files.ts` calls `withDirectoryLockExclusive` for structural `manage_directory` operations.
- `tests/scenarios/integration/tests/folder_coordination.yml` is registered and its managed run produced `tests/scenarios/integration/reports/integration-report-2026-05-28-123648.md`.

## Remaining Evidence Needed For Full Verification

To upgrade this from partial to full verification, rerun the advisory-lock integration command with `.env.test` pointing at a direct/session-mode Postgres URL:

```bash
set -a; source .env.test; set +a; npm run test:integration -- tests/integration/folder-lock.integration.test.ts tests/integration/manage-directory-advisory-lock.integration.test.ts --testNamePattern "T-I-011|T-I-012|T-I-013|T-I-046|T-I-047|folder-lock|manage-directory-advisory"
```

Expected full-verification signal: the currently skipped folder-lock and `manage_directory` advisory-lock tests run and pass.
