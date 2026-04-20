---
phase: 86-record-tool-integration-pending-review
plan: 03
subsystem: mcp-tools
tags: [typescript, mcp, plugin-reconciliation, record-tools, documents, pending-review]

# Dependency graph
requires:
  - phase: 86-01
    provides: reconcilePluginDocuments, executeReconciliationActions, ReconciliationActionSummary, fqc_pending_plugin_review DDL

provides:
  - Reconciliation preamble in all 5 record tools (create_record, get_record, update_record, archive_record, search_records)
  - formatReconciliationSummary helper in records.ts
  - queryPendingReview helper in records.ts
  - fqc_pending_plugin_review cleanup in unregister_plugin (plugins.ts)
  - read-only folder guardrail in create_document and update_document (documents.ts)

affects:
  - 86-04 (E2E tests — exercises clear_pending_reviews and reconciliation summary paths)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reconciliation preamble: outer try/catch wraps reconcilePluginDocuments + executeReconciliationActions; failure sets reconciliationWarning (non-fatal)"
    - "Pending note: queryPendingReview called after core op; non-zero count appends 'N pending review item(s). Call clear_pending_reviews to process.'"
    - "D-12 guardrail: getFolderClaimsMap + pluginManager.getEntry to check access field; warning-only, write proceeds"

key-files:
  created: []
  modified:
    - src/mcp/tools/records.ts
    - src/mcp/tools/plugins.ts
    - src/mcp/tools/documents.ts
    - tests/unit/record-tools.test.ts

key-decisions:
  - "queryPendingReview uses instance_id = instanceName (not config.instance.id) — matches plugin instance scope, not FQC instance"
  - "search_records has 4 return paths (filters-only, semantic, no-text-columns fallback, ILIKE) — all 4 get pending note appended"
  - "update_document guardrail uses folderClaimsMapUpdate variable name to avoid shadowing create_document's folderClaimsMap"
  - "TDD RED/GREEN followed: 5 failing tests committed first, then implementation made them pass"

requirements-completed:
  - RECTOOLS-01
  - RECTOOLS-04
  - RECTOOLS-08
  - RECTOOLS-09

# Metrics
duration: ~25min
completed: 2026-04-20
---

# Phase 86 Plan 03: Record Tool Integration Summary

**Reconciliation preamble wired into all five record tools; pending review cleanup added to unregister_plugin; read-only guardrail added to create_document and update_document**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-20T19:10:00Z
- **Completed:** 2026-04-20T19:35:00Z
- **Tasks:** 2
- **Files modified:** 4 (3 source + 1 test)

## Accomplishments

### Task 1: Reconciliation preamble in all five record tools (TDD)

- Added imports for `reconcilePluginDocuments`, `executeReconciliationActions`, `ReconciliationActionSummary` to `records.ts`
- Added `formatReconciliationSummary` helper: converts 5 action counters to human-readable text fragments
- Added `queryPendingReview` helper: queries `fqc_pending_plugin_review` per plugin/instance, returns rows
- Replaced `const instanceName = plugin_instance ?? 'default'` in all 5 tools with full reconciliation preamble block
- Preamble pattern: outer try/catch wraps reconcilePluginDocuments + executeReconciliationActions; failure logs WARN and sets `reconciliationWarning` (non-fatal)
- Each tool's success return now appends `reconciliationSummary + reconciliationWarning + pendingNote`
- `search_records` has 4 success paths — all 4 get the suffix appended
- TDD: 5 failing tests committed first (RED `8503005`), then implementation (GREEN `8f5f983`)

### Task 2: unregister_plugin cleanup + documents.ts guardrail

- `plugins.ts`: added `fqc_pending_plugin_review` delete block between memory deletion and registry removal
- `documents.ts`: added import for `pluginManager` and `getFolderClaimsMap` from `plugins/manager.js`
- `documents.ts`: added D-12 read-only guardrail in `create_document` — checks `getFolderClaimsMap` after `relativePath` is resolved; emits warning if `access === 'read-only'`; write proceeds regardless
- `documents.ts`: added identical guardrail in `update_document`

## Task Commits

1. **Task 1 RED: Add failing tests for reconciliation preamble** - `8503005` (test)
2. **Task 1 GREEN: Add reconciliation preamble to all five record tools** - `8f5f983` (feat)
3. **Task 2: Pending review cleanup + read-only guardrail** - `84f8cb6` (feat)

## Files Created/Modified

- `src/mcp/tools/records.ts` — imports, formatReconciliationSummary, queryPendingReview, preamble in 5 tools, pending note in 5 tools
- `src/mcp/tools/plugins.ts` — fqc_pending_plugin_review delete block in unregister_plugin
- `src/mcp/tools/documents.ts` — getFolderClaimsMap import, D-12 guardrail in create_document and update_document
- `tests/unit/record-tools.test.ts` — 5 new tests for reconciliation preamble behavior (TDD RED + GREEN)

## Decisions Made

- `queryPendingReview` scopes by `instance_id = instanceName` (the plugin instance name) rather than `config.instance.id` (the FQC instance) — this is correct because `fqc_pending_plugin_review.instance_id` is the plugin instance identifier
- `search_records` has 4 return paths; rather than extracting the pending query into a shared variable before the branching, it is called inline in each path — this keeps the code readable and avoids variable scope issues with the `pgClient.finally` blocks
- `folderClaimsMapUpdate` used as variable name in `update_document` to avoid shadowing — a minor style choice to keep TypeScript happy without renaming

## Deviations from Plan

None — plan executed exactly as written. TDD RED/GREEN/no-REFACTOR (no cleanup needed).

## Issues Encountered

None.

## Known Stubs

None — all data flows are wired. `formatReconciliationSummary` produces empty string when all counters are zero, so no stub text appears in responses when nothing changed.

## Threat Flags

No new threat surface beyond plan's threat model. T-86-07 through T-86-10 all accepted per plan disposition.

## Self-Check

- [x] `src/mcp/tools/records.ts` — `reconcilePluginDocuments` appears 6 times (1 import + 5 call sites), `formatReconciliationSummary` defined, `queryPendingReview` defined with 8 call sites
- [x] `src/mcp/tools/plugins.ts` — `fqc_pending_plugin_review` delete at line 690
- [x] `src/mcp/tools/documents.ts` — `getFolderClaimsMap` imported and called in create_document + update_document; `readOnlyWarning` count = 6
- [x] Commits 8503005, 8f5f983, 84f8cb6 exist in git log
- [x] `npx tsc --noEmit` — no errors in modified files (13 pre-existing errors in other files unchanged)
- [x] `npm test` — 1169 pass, 10 pre-existing failures (auth-middleware, config, embedding, resolve-document)

## Self-Check: PASSED
