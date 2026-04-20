---
phase: 85-reconciliation-engine
plan: "01"
subsystem: services
tags:
  - reconciliation
  - plugin
  - classification
  - staleness-cache
  - self-healing
dependency_graph:
  requires:
    - src/plugins/manager.ts (DocumentTypePolicy, TypeRegistryEntry, RegistryEntry, pluginManager, getTypeRegistryMap)
    - src/storage/supabase.ts (supabaseManager)
    - src/storage/vault.ts (atomicWriteFrontmatter, vaultManager)
    - src/utils/pg-client.ts (createPgClientIPv4)
    - src/logging/logger.ts (logger)
  provides:
    - src/services/plugin-reconciliation.ts
  affects:
    - Phase 85-02 (executeReconciliationActions builds on this file)
    - Phase 85-03 (unit tests verify this file)
    - Phase 86 (record tools will call reconcilePluginDocuments)
tech_stack:
  added: []
  patterns:
    - module-level Map/Set singletons for staleness cache and verifiedTables
    - single pgClient per function call wrapped in try/finally
    - Supabase JS for known tables; raw pg for dynamic fqcp_* tables
    - pg.escapeIdentifier() for all dynamic table names in SQL
    - parameterized queries for all pg value bindings
key_files:
  created:
    - src/services/plugin-reconciliation.ts
  modified: []
decisions:
  - "applyFieldMap() exported (not module-private) so Plan 03 tests can exercise it directly without mocking the full reconciliation pipeline"
  - "DocumentInfo.tableName typed as string | null (null when policy has no track_as) — Plan 02 skips auto-track when tableName is null"
  - "classifyDocument() takes a structured args object (not positional params) for legibility"
metrics:
  duration: "~4 minutes"
  completed: "2026-04-20T19:53:00Z"
  tasks_completed: 2
  files_created: 1
  files_modified: 0
---

# Phase 85 Plan 01: Reconciliation Engine Scaffold — Summary

**One-liner:** New `src/services/plugin-reconciliation.ts` implements the full read-only reconciliation classification pipeline: 7-branch decision tree, staleness cache, self-healing ALTER TABLE, dual-path fqc_documents discovery, and unfiltered plugin-row query including archived rows (OQ-7 guard).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Scaffold plugin-reconciliation.ts with interfaces, module state, and staleness cache | 6b936cb | src/services/plugin-reconciliation.ts (created) |
| 2 | Implement reconcilePluginDocuments orchestrator with self-healing ALTER TABLE, two-path discovery, and 7-branch classification | bae8863 | src/services/plugin-reconciliation.ts (expanded) |

## Export Surface for Plan 02

Plan 02 (`executeReconciliationActions`) builds against these exports:

| Export | Kind | Purpose |
|--------|------|---------|
| `ClassificationState` | type union | 7 state values |
| `DocumentInfo` | interface | added[] items |
| `ResurrectionRef` | interface | resurrected[] items |
| `DeletionRef` | interface | deleted[], disassociated[] items |
| `MovedRef` | interface | moved[] items |
| `ModifiedRef` | interface | modified[] items |
| `ReconciliationResult` | interface | Return type of reconcilePluginDocuments |
| `reconcilePluginDocuments` | async function | Main orchestrator |
| `invalidateReconciliationCache` | function | Reset staleness Map (tests use in beforeEach) |
| `applyFieldMap` | function | Pure field_map applicator for Plan 02 executor |

### Interface Shape Notes

- `DocumentInfo.tableName` is `string | null` — null when the matched DocumentTypePolicy has no `track_as`. Plan 02 should skip auto-track INSERT when `tableName` is null.
- `DeletionRef` is reused for both `deleted` and `disassociated` arrays (same shape per D-02).
- `MovedRef.oldPath` is `string | null` — matches `PluginTableRow.path` which can be null if the plugin row never stored a path.

## OQ-7 Guard Comment Location

Line **334**: `// CRITICAL: Query ALL rows, including archived.`

This comment appears immediately above the plugin-row SELECT in Step G, which has no `WHERE status` filter. This ensures archived plugin rows are returned and can be classified as `resurrected` (not `added`) when the corresponding `fqc_documents` row is active.

## pg.escapeIdentifier Usage Sites (T-85-01 Traceability)

| Line | Context |
|------|---------|
| 146 | `ALTER TABLE ${pg.escapeIdentifier(tableName)} ADD COLUMN IF NOT EXISTS last_seen_updated_at TIMESTAMPTZ` — self-healing DDL in `ensureLastSeenColumn()` |
| 335 | `SELECT id, fqc_id, status, path, last_seen_updated_at FROM ${pg.escapeIdentifier(tableName as string)}` — unfiltered plugin-row query in Step G |

Both dynamic table names are derived from `entry.table_prefix + policy.track_as`, validated as `/^[a-z0-9_]+$/` at Phase 84 parse time. No user-controlled values are concatenated into SQL anywhere in the file.

## Deviations from Plan

### Shape Refinements

**1. DocumentInfo.tableName typed as `string | null`**
- **Found during:** Task 1 review of plan spec
- **Issue:** The plan's `DocumentInfo` interface specifies `tableName: string` but the `added` classification must handle doc types without a `track_as` (no plugin table). Forcing `tableName: string` would require a stub value.
- **Fix:** Changed to `tableName: string | null`. Plan 02 skips auto-track when null.
- **Files modified:** src/services/plugin-reconciliation.ts

**2. `applyFieldMap()` exported (not module-private)**
- **Found during:** Task 2 — Plan 03 test design requires direct testing of this pure function
- **Issue:** The plan says "module-private applyFieldMap helper used by Plan 02." However, Plan 03 test file `field-map-null.test.ts` needs to test it directly without mocking the full reconciliation pipeline.
- **Fix:** Exported `applyFieldMap`. No functional impact on Plan 02 (can still import it as before).
- **Files modified:** src/services/plugin-reconciliation.ts

**3. `classifyDocument()` uses structured args object**
- **Found during:** Task 2 implementation
- **Issue:** Plan specifies positional params `{ fqcId, fqcDoc?, pluginRow?, pluginId, watchedFolders }`. Implemented as an interface-typed args object for legibility and easier mock construction in Plan 03 tests.
- **Fix:** Function signature `classifyDocument(args: { fqcId, fqcDoc, pluginRow, pluginId, watchedFolders })`.
- **Files modified:** src/services/plugin-reconciliation.ts

## Known Stubs

None. All exported functions are fully implemented. The Plan 01 Task 1 stub (`reconcilePluginDocuments` returning `emptyResult()`) was replaced in Task 2 with the full implementation.

## Threat Surface Scan

All threat mitigations from T-85-01 through T-85-03 are implemented:

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-85-01 | IMPLEMENTED — both pg.escapeIdentifier() sites at lines 146 and 335 |
| T-85-02 | IMPLEMENTED — information_schema query parameterized with `$1` at line 140 |
| T-85-03 | IMPLEMENTED — all logger calls use `error.message` only, never full error objects |
| T-85-04 | ACCEPTED — no pagination; noted as out of scope for v2.8 |

No new threat surface was introduced beyond what the plan's threat model covers.

## Self-Check

### Files exist
- [x] `src/services/plugin-reconciliation.ts` — 457 lines

### Commits exist
- [x] `6b936cb` — feat(85-01): scaffold plugin-reconciliation.ts with interfaces, types, staleness cache
- [x] `bae8863` — feat(85-01): implement reconcilePluginDocuments with classification pipeline

### Acceptance criteria verification
- [x] `grep -c "export interface ReconciliationResult"` → 1
- [x] `grep "STALENESS_THRESHOLD_MS = 30_000"` → 1 match
- [x] `grep "reconciliationTimestamps = new Map"` → 1 match
- [x] `grep "verifiedTables = new Set"` → 1 match
- [x] `grep "export function invalidateReconciliationCache"` → 1 match
- [x] `grep "export async function reconcilePluginDocuments"` → 1 match
- [x] `grep "// CRITICAL: Query ALL rows, including archived\."` → 1 match (line 334)
- [x] `grep "ALTER TABLE.*ADD COLUMN IF NOT EXISTS last_seen_updated_at TIMESTAMPTZ"` → 1 match (line 146)
- [x] `grep -c "pg.escapeIdentifier"` → 2 matches (lines 146, 335)
- [x] `isWithinStaleness(pluginId, instanceId)` → first meaningful statement in reconcilePluginDocuments body (line 251)
- [x] `markReconciled(pluginId, instanceId)` → 1 match inside try block (line 446)
- [x] `function classifyDocument` → 1 match; body has all 7 branches in order
- [x] `function ensureLastSeenColumn` → 1 match; references verifiedTables.has, verifiedTables.add, information_schema.columns
- [x] No `WHERE status = 'active'` in any SQL string (TypeScript comparisons only)
- [x] `createPgClientIPv4(dbUrl)` called once; `await pgClient.end()` inside exactly one finally block
- [x] `npm test` — same 20 pre-existing failures; 0 new regressions from this plan

## Self-Check: PASSED
