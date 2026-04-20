---
phase: 86-record-tool-integration-pending-review
plan: "04"
subsystem: integration-tests
tags: [integration-tests, reconciliation, pending-review, plugin-lifecycle]
dependency_graph:
  requires: [86-01, 86-02, 86-03]
  provides: [TEST-07, TEST-15, TEST-16]
  affects: [src/plugins/manager.ts, src/services/plugin-reconciliation.ts]
tech_stack:
  added: []
  patterns:
    - "SKIP_DB guard pattern with describe.skipIf() + if (SKIP_DB) return in hooks"
    - "createTrackedDoc via MCP create_document tool for fqc_documents-visible test fixtures"
    - "PLUGIN_INSTANCE='default' vs INSTANCE_ID for plugin table vs fqc_documents queries"
key_files:
  created:
    - tests/integration/plugin-reconciliation.integration.test.ts
    - tests/integration/pending-plugin-review.integration.test.ts
  modified:
    - src/plugins/manager.ts
    - src/services/plugin-reconciliation.ts
decisions:
  - "Use create_document MCP tool (not writeFile) to create test docs — reconciliation queries fqc_documents only"
  - "Plugin table instance_id stores plugin instance ('default'), not FlashQuery instance ID"
  - "For FK CASCADE test: delete plugin table row first (no cascade on plugin FK), then delete fqc_documents"
  - "Test 7 clears ALL pending fqc_ids to assert empty state (not just one, since other tests may have left rows)"
metrics:
  duration: "~45 minutes"
  completed: "2026-04-20"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 4
---

# Phase 86 Plan 04: Integration Tests for Reconciliation & Pending Review Summary

**One-liner:** 16 integration tests covering reconcile-on-read (TEST-07), resurrection lifecycle (TEST-16), and full pending review lifecycle with FK CASCADE (TEST-15); two Rule 1 bug fixes to reconciliation engine discovered during test execution.

## What Was Built

### Task 1 — plugin-reconciliation.integration.test.ts (10 tests)

Tests TEST-07 and TEST-16 with a real Supabase instance. Covers:

- Record tool triggers reconciliation before core operation
- Auto-track creates plugin table row and writes frontmatter
- Auto-track does not modify document body
- Archival: deleted document causes plugin row status archived
- Disassociation: ownership change causes plugin row archived
- Pending review appears in record tool response when items exist
- Full pending review lifecycle: create → query mode → clear mode → empty
- In-conversation doc + immediate reconciliation (no staleness race)
- Legacy plugin with no policies uses defaults
- Resurrection lifecycle: archived row un-archived on reappearance (TEST-16)

### Task 2 — pending-plugin-review.integration.test.ts (6 tests)

Tests TEST-15 with a real Supabase instance. Covers:

- Register plugin, create doc, call record tool → pending review row created
- Query mode (fqc_ids: []) returns pending items without deleting
- Clear mode deletes specified rows, returns remaining
- Idempotent: clearing non-existent IDs does not error
- FK CASCADE: deleting fqc_documents row removes pending review
- unregister_plugin deletes all pending reviews before removing registry entry

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing fqc_id and path columns in buildPluginTableDDL**
- **Found during:** Task 1 — reconciliation SELECT queries failed
- **Issue:** `reconcilePluginDocuments()` executes `SELECT id, fqc_id, status, path, last_seen_updated_at FROM fqcp_*` but `buildPluginTableDDL` did not include `fqc_id` or `path` in its implicit column list
- **Fix:** Added `fqc_id UUID REFERENCES fqc_documents(id)` and `path TEXT` to `implicitCols` in `src/plugins/manager.ts`
- **Files modified:** `src/plugins/manager.ts`
- **Commit:** f5a59dc

**2. [Rule 1 - Bug] Missing instance_id in executeReconciliationActions INSERT**
- **Found during:** Task 1 — plugin table had 0 rows despite no errors (NOT NULL violation silently failing)
- **Issue:** `baseCols` for plugin table INSERT was `['fqc_id', 'status', 'path', 'last_seen_updated_at']` but `instance_id TEXT NOT NULL` had no default and was not included
- **Fix:** Added `'instance_id'` to `baseCols` at index 1 and `instanceId ?? 'default'` to `baseVals`; updated fallback index from 3 to 4 in `src/services/plugin-reconciliation.ts`
- **Files modified:** `src/services/plugin-reconciliation.ts`
- **Commit:** f5a59dc

**3. [Rule 1 - Bug] Test queries used wrong instance_id for plugin table**
- **Found during:** Task 1 — 5 tests still failed after INSERT fix with "expected 0 to be greater than 0"
- **Issue:** Plugin table's `instance_id` column stores the plugin instance (`'default'`), not the FlashQuery instance ID (`'reconciliation-integration-test'`). Tests queried `WHERE instance_id = INSTANCE_ID` but rows contained `'default'`
- **Fix:** Added `PLUGIN_INSTANCE = 'default'` constant; updated all 6 plugin table queries to use `PLUGIN_INSTANCE` instead of `INSTANCE_ID`
- **Files modified:** `tests/integration/plugin-reconciliation.integration.test.ts`
- **Commit:** f5a59dc

**4. [Rule 1 - Bug] Test 7 clear mode assertion incorrect with cross-test pending rows**
- **Found during:** Task 1 — test 7 asserted 'No pending reviews' after clearing one row, but other tests had left additional pending rows
- **Fix:** Changed test 7 to collect all pending fqc_ids and clear them all at once, enabling correct empty-state assertion
- **Files modified:** `tests/integration/plugin-reconciliation.integration.test.ts`
- **Commit:** f5a59dc

**5. [Rule 1 - Bug] afterAll Supabase chain used .catch() — not a function**
- **Found during:** Task 2 first run — Supabase query builder does not expose `.catch()` on chained queries
- **Fix:** Wrapped each cleanup query in `try/catch` block
- **Files modified:** `tests/integration/pending-plugin-review.integration.test.ts`
- **Commit:** fe73b25

**6. [Rule 1 - Bug] FK CASCADE test failed — plugin table FK to fqc_documents has no cascade**
- **Found during:** Task 2 first run — deleting `fqc_documents` row returned FK violation from plugin table
- **Issue:** The plugin table has `fqc_id UUID REFERENCES fqc_documents(id)` (no ON DELETE CASCADE); only `fqc_pending_plugin_review` has CASCADE. Must delete plugin row first
- **Fix:** Added pgClient query to delete plugin table row by `fqc_id` before deleting `fqc_documents` row
- **Files modified:** `tests/integration/pending-plugin-review.integration.test.ts`
- **Commit:** fe73b25

## Known Stubs

None — all tests exercise real database operations.

## Threat Flags

None — test files only. No new network endpoints or auth paths introduced.

## Self-Check

### Created files exist

- [x] `tests/integration/plugin-reconciliation.integration.test.ts` — 692 lines
- [x] `tests/integration/pending-plugin-review.integration.test.ts` — 459+ lines

### Commits exist

- [x] f5a59dc — Task 1: plugin-reconciliation integration tests
- [x] fe73b25 — Task 2: pending-plugin-review integration tests

### Test results

- [x] plugin-reconciliation.integration: 10/10 passed
- [x] pending-plugin-review.integration: 6/6 passed

## Self-Check: PASSED
