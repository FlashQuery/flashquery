---
phase: 87-scanner-modifications-frontmatter-sync
plan: "03"
subsystem: test-integration
tags:
  - integration-tests
  - frontmatter-sync
  - scanner
  - ownership-columns
dependency_graph:
  requires:
    - 87-01
    - 87-02
  provides:
    - TEST-08
    - TEST-10
  affects:
    - tests/integration/frontmatter-sync.integration.test.ts
    - tests/integration/scan-command.integration.test.ts
tech_stack:
  added: []
  patterns:
    - vitest describe.skipIf for graceful credential-absent skipping
    - camelCase FlashQueryConfig keys in direct config objects (not YAML-loaded)
    - path-scoped DB queries to avoid multi-row conflicts in cumulative vault state
key_files:
  created:
    - tests/integration/frontmatter-sync.integration.test.ts
  modified:
    - tests/integration/scan-command.integration.test.ts
decisions:
  - "Used camelCase keys (serviceRoleKey, databaseUrl, markdownExtensions) in makeIntegrationConfig — the FlashQueryConfig interface uses camelCase but plan template showed snake_case, which caused initSupabase to fail with 'Invalid value undefined for header apikey'"
  - "Added .eq('path', 'ownership-test.md') filter to TEST-10 query to handle cumulative vault state from prior tests whose cleanup failed silently due to missing fsPromises import in beforeEach"
metrics:
  duration: "12m 20s"
  completed: "2026-04-21"
  tasks_completed: 2
  files_changed: 2
---

# Phase 87 Plan 03: Integration Tests for Frontmatter-to-Column Sync Summary

Integration gate tests for SCANNER-01, SCANNER-02, SCANNER-03 behavior — 4 new test cases in a new file plus 1 new assertion in the existing scan-command test. All 13 tests pass against live Supabase.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create frontmatter-sync.integration.test.ts (TEST-08) | 5ed1643 | tests/integration/frontmatter-sync.integration.test.ts (created) |
| 2 | Add ownership sync assertion to scan-command.integration.test.ts (TEST-10) | 7041f68 | tests/integration/scan-command.integration.test.ts (modified) |

## Test Results

**frontmatter-sync.integration.test.ts:** 4/4 passed
- RO-32: fqc_owner synced to ownership_plugin_id on INSERT
- RO-33: fqc_type synced to ownership_type on INSERT
- RO-34: removing fqc_owner sets ownership_plugin_id to NULL on content-change UPDATE
- RO-42: scan does not write to fqc_change_queue

**scan-command.integration.test.ts:** 9/9 passed (8 original + 1 new TEST-10)
- TEST-10: ownership columns synced from frontmatter fields on INSERT

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed camelCase config keys in makeIntegrationConfig**
- **Found during:** Task 1 verification — `initSupabase` threw `Invalid value "undefined" for header "apikey"`
- **Issue:** Plan's `<interfaces>` template used snake_case keys (`service_role_key`, `database_url`, `skip_ddl`, `api_key`, `ttl_seconds`) but `FlashQueryConfig` interface and `supabase.ts` expect camelCase (`serviceRoleKey`, `databaseUrl`, `skipDdl`, `apiKey`, `ttlSeconds`). The `as unknown as FlashQueryConfig` cast bypasses TypeScript type checking, so the runtime sees `undefined` for all camelCase property accesses.
- **Fix:** Rewrote `makeIntegrationConfig` with correct camelCase keys, matching the pattern in `tests/integration/bulk-reconciliation.integration.test.ts`
- **Files modified:** tests/integration/frontmatter-sync.integration.test.ts
- **Commit:** 5ed1643

**2. [Rule 1 - Bug] Added path filter to TEST-10 query**
- **Found during:** Task 2 verification — `.single()` failed with `PGRST116 "The result contains 9 rows"`
- **Issue:** The `scan-command.integration.test.ts` `beforeEach` references `fsPromises` which is not imported — vault cleanup silently fails, causing files from all prior tests to accumulate. By TEST-10 (last test in suite), the vault has files from all 8 prior tests, so the scan inserts 9 DB rows.
- **Fix:** Added `.eq('path', 'ownership-test.md')` filter to uniquely identify the row created by TEST-10. Root cause (`fsPromises` missing import) is a pre-existing bug in the test file that predates this plan — documented but not modified per plan instruction "Do NOT modify any existing tests."
- **Files modified:** tests/integration/scan-command.integration.test.ts
- **Commit:** 7041f68

## Known Stubs

None.

## Threat Flags

None. Test files only — no new network endpoints, auth paths, or schema changes.

## Self-Check

**Created files:**
- [x] `tests/integration/frontmatter-sync.integration.test.ts` — exists, 174 lines
- [x] `tests/integration/scan-command.integration.test.ts` — modified, 405 lines

**Commits:**
- [x] 5ed1643 exists (Task 1)
- [x] 7041f68 exists (Task 2)

**Test results:**
- [x] frontmatter-sync: 4 passed, 0 failed
- [x] scan-command: 9 passed (8 original + 1 new), 0 failed

## Self-Check: PASSED
