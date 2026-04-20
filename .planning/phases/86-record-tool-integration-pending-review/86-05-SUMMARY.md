---
phase: 86-record-tool-integration-pending-review
plan: 05
subsystem: testing
tags: [vitest, integration-tests, reconciliation, plugin-tables, pending-review]

# Dependency graph
requires:
  - phase: 86-01
    provides: reconcilePluginDocuments and executeReconciliationActions engine
  - phase: 86-02
    provides: record tool registration with reconciliation preamble
  - phase: 86-03
    provides: pending review tools, read-only guardrail in document tools

provides:
  - Integration test coverage for bulk reconciliation (TEST-09): 50-doc auto-track, count summary, spurious-modified prevention, incremental pending review, read-only guardrail
  - Integration test coverage for multi-table plugins: single-pass scan, OQ-7 duplicate prevention, folder-to-table routing

affects:
  - Any future changes to plugin-reconciliation.ts
  - Any future changes to pending-review.ts or records.ts instance_id scoping

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration tests use create_document handler to register docs in fqc_documents before reconciliation (reconciliation only sees FQC-registered documents)"
    - "Tests use invalidateReconciliationCache() to force reconciliation within staleness window"
    - "All DB row operations scope by config.instance.id (FQC server ID), not plugin instance name"

key-files:
  created:
    - tests/integration/bulk-reconciliation.integration.test.ts
    - tests/integration/multi-table-reconciliation.integration.test.ts
  modified:
    - src/plugins/manager.ts
    - src/services/plugin-reconciliation.ts
    - src/mcp/tools/records.ts
    - src/mcp/tools/pending-review.ts
    - tests/unit/plugin-reconciliation.test.ts

key-decisions:
  - "instance_id in plugin tables and fqc_pending_plugin_review must be config.instance.id (FQC server identity), not the plugin instance name — these are distinct concepts"
  - "executeReconciliationActions must call updateDocumentOwnership after auto-tracking so subsequent reconciliations classify docs as unchanged not disassociated"
  - "clear_pending_reviews must scope by config.instance.id not plugin_instance parameter"

patterns-established:
  - "FQC server instance ID (config.instance.id) is the correct value for instance_id column in all plugin-related tables"
  - "After auto-tracking a document, ownership metadata in fqc_documents must be updated to prevent disassociated classification on next reconciliation pass"

requirements-completed: [TEST-09, RECTOOLS-01, RECTOOLS-04, RECTOOLS-09]

# Metrics
duration: 90min
completed: 2026-04-20
---

# Phase 86 Plan 05: Bulk and Multi-Table Reconciliation Integration Tests Summary

**9 integration tests verifying bulk auto-track (50 docs), pending review lifecycle, read-only guardrail, and multi-table plugin routing — with 5 source bug fixes required to make reconciliation work correctly end-to-end**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-04-20T19:40:00Z
- **Completed:** 2026-04-20T20:05:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- 6 integration tests in `bulk-reconciliation.integration.test.ts` (TEST-09): 50-doc batch auto-track, count-based summary output, spurious-modified prevention (RECON-05), incremental pending review (no duplicates across reconciliation rounds), read-only guardrail warning in `create_document` response
- 3 integration tests in `multi-table-reconciliation.integration.test.ts`: single-pass multi-table scan, OQ-7 cross-table resurrection guard (no duplicates), correct folder-to-table routing (contacts/ → contacts table, notes/ → notes table)
- 5 source bugs discovered and fixed during test authoring

## Task Commits

1. **Task 1: Bulk reconciliation integration tests (TEST-09)** - `93ba282` (test)
2. **Task 2: Multi-table reconciliation integration tests** - `3488a6c` (test)

## Files Created/Modified

- `tests/integration/bulk-reconciliation.integration.test.ts` - 6 integration tests: 50-doc auto-track, count summary, spurious-modified prevention, incremental pending review, read-only guardrail
- `tests/integration/multi-table-reconciliation.integration.test.ts` - 3 integration tests: single-pass multi-table scan, OQ-7 duplicate prevention, folder-to-table routing
- `src/plugins/manager.ts` - Added fqc_id and path to implicit columns in buildPluginTableDDL
- `src/services/plugin-reconciliation.ts` - Added instance_id to INSERT, added updateDocumentOwnership call, fixed pending review instance_id to use fqcInstanceId, added updateDocumentOwnership import
- `src/mcp/tools/records.ts` - Pass config.instance.id as fqcInstanceId to executeReconciliationActions; fix queryPendingReview to use config.instance.id
- `src/mcp/tools/pending-review.ts` - Use config.instance.id (not plugin instance name) for DB scoping in clear_pending_reviews
- `tests/unit/plugin-reconciliation.test.ts` - Add .update to Supabase mock chain for RECON-05 test

## Decisions Made

- FQC server instance ID (`config.instance.id`, e.g. `'crm-server'`) is the correct value for `instance_id` in plugin tables and `fqc_pending_plugin_review`. The plugin instance name (`'default'`) identifies the plugin configuration variant, not the server. These were previously conflated.
- `executeReconciliationActions` receives `fqcInstanceId` as an optional 4th parameter to avoid breaking callers that don't have access to config.
- `updateDocumentOwnership` must be called after every auto-track INSERT so that the `fqc_documents.ownership_plugin_id` field is set; without this, the next reconciliation pass misclassifies the document as `disassociated` (ownership mismatch) and archives the plugin row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] buildPluginTableDDL missing fqc_id and path implicit columns**
- **Found during:** Task 1 (writing bulk reconciliation test, first test run)
- **Issue:** `executeReconciliationActions` INSERTs `fqc_id` and `path` into plugin tables, but `buildPluginTableDDL` did not include these columns in its implicit column list. Error: `column "fqc_id" does not exist`
- **Fix:** Added `fqc_id TEXT` and `path TEXT` to `implicitCols` in `src/plugins/manager.ts`
- **Files modified:** `src/plugins/manager.ts`
- **Verification:** Plugin table creation no longer errors; reconciliation INSERT succeeds
- **Committed in:** 93ba282

**2. [Rule 1 - Bug] executeReconciliationActions INSERT missing instance_id**
- **Found during:** Task 1 (bulk reconciliation test run)
- **Issue:** `executeReconciliationActions` built plugin table INSERTs without `instance_id`, violating the `NOT NULL` constraint on that column
- **Fix:** Added `instance_id` to `baseCols` and `baseVals`, using `fqcInstanceId ?? instanceId` as the value
- **Files modified:** `src/services/plugin-reconciliation.ts`
- **Verification:** INSERT succeeds, rows created with correct instance_id
- **Committed in:** 93ba282

**3. [Rule 1 - Bug] Wrong instance_id value for plugin table rows (plugin instance vs FQC server ID)**
- **Found during:** Task 1 (test count assertion failing — 0 rows instead of 50)
- **Issue:** Plugin table INSERTs used `instanceId` (plugin instance name = `'default'`), but `search_records` queries rows with `WHERE instance_id = config.instance.id` (`'bulk-reconciliation-test'`). The two values never match.
- **Fix:** Added `fqcInstanceId` optional parameter to `executeReconciliationActions`; all 5 callers in `records.ts` pass `config.instance.id`
- **Files modified:** `src/services/plugin-reconciliation.ts`, `src/mcp/tools/records.ts`
- **Verification:** Plugin table rows created with correct instance_id; row count assertions pass
- **Committed in:** 93ba282

**4. [Rule 1 - Bug] fqc_documents.ownership_plugin_id not updated after auto-track**
- **Found during:** Task 1 (test 2 count-based summary test — `Archived 50 records` message when expecting unchanged)
- **Issue:** After auto-tracking docs into plugin tables, `fqc_documents.ownership_plugin_id` remained NULL. On the next reconciliation pass, docs were classified as `disassociated` (ownership mismatch check: `ownership_plugin_id === null`) and their plugin rows were archived.
- **Fix:** Added `updateDocumentOwnership(doc.fqcId, { plugin_id: pluginId, type: doc.typeId, needs_discovery: false })` call after each successful auto-track INSERT
- **Files modified:** `src/services/plugin-reconciliation.ts`
- **Verification:** Second reconciliation pass classifies already-tracked docs as `unchanged`; no spurious archiving
- **Committed in:** 93ba282

**5. [Rule 1 - Bug] pending_review rows and clear_pending_reviews used plugin instance name for instance_id**
- **Found during:** Task 1 (test 5 incremental pending review — 0 rows returned by direct query; extra row count after round 2)
- **Issue:** `fqc_pending_plugin_review` INSERTs used `instanceId ?? 'default'` (plugin instance name), but the test's direct Supabase query scoped by `INSTANCE_ID = 'bulk-reconciliation-test'`. `clear_pending_reviews` and `queryPendingReview` also used `instanceName` (plugin instance name) for DB scoping, so deletes silently did nothing and queries returned empty results.
- **Fix:** `executeReconciliationActions` uses `rowInstanceId` (fqcInstanceId) for pending review inserts; `clear_pending_reviews` uses `config.instance.id`; `queryPendingReview` takes `fqcInstanceId` as 3rd parameter
- **Files modified:** `src/services/plugin-reconciliation.ts`, `src/mcp/tools/pending-review.ts`, `src/mcp/tools/records.ts`
- **Verification:** All 6 bulk reconciliation tests pass including test 5 exact count assertion
- **Committed in:** 93ba282

---

**Total deviations:** 5 auto-fixed (all Rule 1 bugs)
**Impact on plan:** All fixes required for correctness — reconciliation engine was fundamentally broken for multi-test scenarios. No scope creep.

## Issues Encountered

- Multi-table test `createDoc` helper had wrong calling convention: the type signature said `docHandler` was an already-resolved handler but the body called it as `docHandler('create_document')({...})` (treating it as a getHandler function). Fixed by updating the body to call `createDocumentHandler({...})` directly.
- Unit test `plugin-reconciliation.test.ts` RECON-05 mock missing `.update` chain on Supabase mock — caused by new `updateDocumentOwnership` call. Fixed by adding `.update` to `singleChain` mock.

## Known Stubs

None — all tests use real database operations against local/remote Supabase.

## Next Phase Readiness

- All 9 integration tests pass (6 bulk + 3 multi-table)
- Reconciliation engine now correctly handles ownership tracking, instance scoping, and pending review lifecycle
- Phase 86 complete — all 5 plans executed

## Self-Check: PASSED

- FOUND: tests/integration/bulk-reconciliation.integration.test.ts
- FOUND: tests/integration/multi-table-reconciliation.integration.test.ts
- FOUND: commit 93ba282
- FOUND: commit 3488a6c

---
*Phase: 86-record-tool-integration-pending-review*
*Completed: 2026-04-20*
