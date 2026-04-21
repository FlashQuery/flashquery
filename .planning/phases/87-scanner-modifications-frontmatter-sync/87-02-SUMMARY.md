---
phase: 87-scanner-modifications-frontmatter-sync
plan: "02"
subsystem: plugin
tags: [pg, plugin-propagation, plugin-reconciliation, fqc_id, last_seen_updated_at]

requires:
  - phase: 85-reconciliation-engine
    provides: ensureLastSeenColumn function in plugin-reconciliation.ts

provides:
  - Exported ensureLastSeenColumn from plugin-reconciliation.ts
  - Unified pg connection in propagateFqcIdChange() covering both discovery and UPDATE loop
  - Plugin table UPDATEs now set last_seen_updated_at = NOW() to prevent false reconciliation hits

affects:
  - 88-legacy-infrastructure-removal
  - 89-test-helper-existing-test-updates

tech-stack:
  added: []
  patterns:
    - "Single pg connection lifecycle: open once, cover all operations, close in finally"
    - "ensureLastSeenColumn called per-table before UPDATE in propagateFqcIdChange"

key-files:
  created: []
  modified:
    - src/services/plugin-reconciliation.ts
    - src/services/plugin-propagation.ts

key-decisions:
  - "supabase parameter retained in propagateFqcIdChange() signature despite being unused for plugin table updates — removing it would be a breaking API change"
  - "last_seen_updated_at refresh is defensive: fqc_id reassignment on plugin-tracked docs is rare but a stale timestamp would cause false modified classification on next reconciliation pass"

patterns-established:
  - "Unified pg connection pattern: single try/finally covers all pg operations in a function"

requirements-completed:
  - SCANNER-04
duration: 1min
completed: "2026-04-21"
---

# Phase 87 Plan 02: Scanner Modifications - pg Propagation Refactor Summary

**Exported ensureLastSeenColumn from plugin-reconciliation.ts and unified propagateFqcIdChange() to a single pg connection that sets both fqc_id and last_seen_updated_at = NOW() on plugin table UPDATEs**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-21T03:26:58Z
- **Completed:** 2026-04-21T03:28:26Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `export` keyword to `ensureLastSeenColumn` in plugin-reconciliation.ts so plugin-propagation.ts can import and reuse it
- Replaced split pg-for-discovery + Supabase-for-update pattern in `propagateFqcIdChange()` with a single pg connection covering both phases (one `pgClient.end()` in finally)
- Each plugin table UPDATE now executes raw pg SQL: `SET fqc_id = $1, last_seen_updated_at = NOW() WHERE fqc_id = $2`, preventing false `modified` classification on the next reconciliation pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Export ensureLastSeenColumn from plugin-reconciliation.ts** - `bdd45e8` (feat)
2. **Task 2: Refactor propagateFqcIdChange() to unified pg connection with last_seen_updated_at** - `942b8e7` (feat)

## Files Created/Modified

- `src/services/plugin-reconciliation.ts` - Added `export` keyword to `ensureLastSeenColumn` function declaration; `verifiedTables` cache remains module-private
- `src/services/plugin-propagation.ts` - Added import for `ensureLastSeenColumn`; replaced Supabase client UPDATE loop with unified pg `try/finally` block; each UPDATE sets `last_seen_updated_at = NOW()`

## Decisions Made

- `supabase` parameter kept in `propagateFqcIdChange()` signature even though it is no longer used for plugin table UPDATEs — removing it would break all call sites in scanner.ts
- `last_seen_updated_at` refresh is defensive: `fqc_id` reassignment via scanner duplicate resolution is rare, but if it occurs a stale timestamp would cause a false `modified` classification on the next reconciliation pass

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in unrelated files (`server.ts`, `discovery-coordinator.ts`, `discovery-orchestrator.ts`, `plugin-skill-invoker.ts`) were present before this plan. No new errors were introduced in either modified file.

## Threat Model Compliance

- T-87-03 (Tampering): `pg.escapeIdentifier(tableName)` used for table name; `fqc_id` values passed as `$1`/`$2` parameters — no string interpolation of user-controlled values. Mitigated as specified.
- T-87-04 (Elevation of Privilege): `ensureLastSeenColumn` export is internal to the services layer, not exposed via MCP or CLI. Accepted as specified.

## Next Phase Readiness

- `ensureLastSeenColumn` is now importable by any service that needs to ensure the `last_seen_updated_at` column exists before operating on a plugin table
- `propagateFqcIdChange()` now correctly prevents false reconciliation hits after fqc_id propagation
- Ready for Phase 88 (Legacy Infrastructure Removal) and Phase 89 (Test Helper & Existing Test Updates)

---
*Phase: 87-scanner-modifications-frontmatter-sync*
*Completed: 2026-04-21*
