---
phase: 86-record-tool-integration-pending-review
plan: 01
subsystem: database
tags: [typescript, supabase, mcp, plugin-reconciliation, pending-review]

# Dependency graph
requires:
  - phase: 85-reconciliation-engine
    provides: executeReconciliationActions, ReconciliationResult, withPendingReviewGuard shim
  - phase: 84-schema-parsing-policy-infrastructure
    provides: DocumentTypePolicy, pluginManager.getEntry, RegistryEntry

provides:
  - ReconciliationActionSummary interface with 7 counters (autoTracked, archived, resurrected, pathsUpdated, fieldsSynced, pendingReviewsCreated, pendingReviewsCleared)
  - executeReconciliationActions new 3-param signature returning Promise<ReconciliationActionSummary>
  - fqc_pending_plugin_review table DDL with FK, two indexes in supabase.ts initializeSchema()
  - registerPendingReviewTools MCP tool (clear_pending_reviews with query + clear modes)

affects:
  - 86-02 (record tool integration — calls executeReconciliationActions with new signature)
  - 86-03 (integration tests — tests against fqc_pending_plugin_review table)
  - 86-04 (e2e tests — uses clear_pending_reviews tool)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "executeReconciliationActions now returns summary counters instead of void"
    - "Direct supabase inserts replace withPendingReviewGuard shim (table now guaranteed to exist)"
    - "Internal policy lookup via pluginManager.getEntry replaces policies Map parameter"
    - "registerPendingReviewTools follows records.ts pattern with shutdown guard + Zod validation"

key-files:
  created:
    - src/mcp/tools/pending-review.ts
  modified:
    - src/services/plugin-reconciliation.ts
    - src/storage/supabase.ts
    - src/mcp/server.ts
    - tests/unit/plugin-reconciliation.test.ts

key-decisions:
  - "withPendingReviewGuard shim deleted — fqc_pending_plugin_review table now created at startup, guard is no longer needed"
  - "policies parameter removed from executeReconciliationActions — internal lookup via pluginManager.getEntry keeps the call site clean"
  - "instance_id default changed from '' to 'default' for consistency with plugin_instance convention"
  - "ReconciliationActionSummary returned (not void) so record tools can log/report action outcomes"

patterns-established:
  - "Pending review tool: query mode when fqc_ids=[], clear mode when fqc_ids non-empty — idempotent by design"
  - "Counter pattern: initialize 7 let vars before action loops, increment inline, return as summary object"

requirements-completed:
  - RECTOOLS-01
  - RECTOOLS-02
  - RECTOOLS-03
  - RECTOOLS-05
  - RECTOOLS-06
  - RECTOOLS-07

# Metrics
duration: 25min
completed: 2026-04-20
---

# Phase 86 Plan 01: Infrastructure Foundation Summary

**executeReconciliationActions refactored to 3-param signature returning ReconciliationActionSummary; fqc_pending_plugin_review DDL + clear_pending_reviews MCP tool added**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-20T19:00:00Z
- **Completed:** 2026-04-20T19:25:00Z
- **Tasks:** 2
- **Files modified:** 5 (4 modified, 1 created)

## Accomplishments

- Removed Phase 85 `withPendingReviewGuard` shim; replaced 3 call sites with direct awaited supabase inserts
- Changed `executeReconciliationActions` from `(result, policies, pluginId, instanceId?)` to `(result, pluginId, instanceId)` returning `Promise<ReconciliationActionSummary>` with 7 counters
- Added `fqc_pending_plugin_review` DDL (table + 2 indexes, FK with ON DELETE CASCADE) to `initializeSchema()` in supabase.ts
- Created `src/mcp/tools/pending-review.ts` with `registerPendingReviewTools` — query mode and clear mode, Zod UUID validation, shutdown guard
- Wired `registerPendingReviewTools` into `server.ts`; all unit tests passing (1146 pass, 20 pre-existing failures unchanged)

## Task Commits

1. **Task 1: Update executeReconciliationActions — new signature, counters, remove withPendingReviewGuard** - `65124a1` (feat)
2. **Task 2: Add fqc_pending_plugin_review DDL, create pending-review.ts tool, wire into server.ts** - `df1cac5` (feat)

## Files Created/Modified

- `src/services/plugin-reconciliation.ts` - New 3-param signature, ReconciliationActionSummary interface, 7 action counters, removed withPendingReviewGuard, fixed instance_id defaults
- `src/storage/supabase.ts` - Added fqc_pending_plugin_review DDL (table + 2 indexes) in initializeSchema()
- `src/mcp/tools/pending-review.ts` - New file: registerPendingReviewTools with clear_pending_reviews tool
- `src/mcp/server.ts` - Added import + registerPendingReviewTools call
- `tests/unit/plugin-reconciliation.test.ts` - Updated executeReconciliationActions call sites to new 3-param signature; added pluginManager.getEntry mock in RECON-05 test

## Decisions Made

- `withPendingReviewGuard` deleted (not just emptied) — the 42P01 guard was a Phase 85 stopgap until Phase 86 added the DDL; now the table is created at startup
- Internal policy lookup (`pluginManager.getEntry`) replaces the dropped `policies` parameter — simplifies call sites and centralizes policy resolution
- `instance_id` default changed from `''` to `'default'` — matches the `plugin_instance` field convention used throughout the system

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None — all data flows are wired. `clear_pending_reviews` reads from `fqc_pending_plugin_review` which is populated by `executeReconciliationActions` at reconcile time.

## Threat Flags

No new threat surface introduced beyond what is documented in the plan's `<threat_model>`. T-86-01 mitigated: `fqc_ids` validated as `z.string().uuid()`. T-86-03 mitigated: `plugin_id` sourced from `pluginManager.getEntry()`, not caller input.

## Self-Check

- [x] `src/services/plugin-reconciliation.ts` — exists, `ReconciliationActionSummary` defined, `withPendingReviewGuard` absent
- [x] `src/storage/supabase.ts` — `fqc_pending_plugin_review` DDL present at line 322
- [x] `src/mcp/tools/pending-review.ts` — created
- [x] `src/mcp/server.ts` — `registerPendingReviewTools` imported and called
- [x] Commits 65124a1 and df1cac5 exist in git log

## Self-Check: PASSED

## Next Phase Readiness

- `executeReconciliationActions` new signature is the contract Plans 02-05 depend on — ready
- `fqc_pending_plugin_review` table DDL in schema — will be created on next server startup
- `clear_pending_reviews` tool registered and available to AI clients
- No blockers for Plan 02 (record tool integration)

---
*Phase: 86-record-tool-integration-pending-review*
*Completed: 2026-04-20*
