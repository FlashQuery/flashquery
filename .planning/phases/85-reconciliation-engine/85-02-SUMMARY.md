---
phase: 85-reconciliation-engine
plan: "02"
subsystem: services
tags:
  - reconciliation
  - plugin
  - policy-executor
  - field-map
  - 42P01-guard
  - ownership-check
dependency_graph:
  requires:
    - src/services/plugin-reconciliation.ts (Plan 01 scaffold — ReconciliationResult, interfaces, reconcilePluginDocuments)
    - src/storage/vault.ts (atomicWriteFrontmatter, vaultManager)
    - src/storage/supabase.ts (supabaseManager)
    - src/utils/pg-client.ts (createPgClientIPv4)
    - src/plugins/manager.ts (DocumentTypePolicy)
    - gray-matter (frontmatter parsing)
  provides:
    - src/services/plugin-reconciliation.ts (expanded with executeReconciliationActions + applyFieldMap)
  affects:
    - Phase 85-03 (unit tests will import executeReconciliationActions and applyFieldMap)
    - Phase 86 (record tools will call executeReconciliationActions after reconcilePluginDocuments)
tech_stack:
  added: []
  patterns:
    - Single pgClient per function call wrapped in try/finally
    - Supabase JS for known tables (fqc_documents, fqc_pending_plugin_review)
    - Raw pg with pg.escapeIdentifier() for dynamic plugin tables (fqcp_* pattern)
    - 42P01 guard via withPendingReviewGuard() — PromiseLike<unknown> for Supabase compatibility
    - OQ-3 ownership check: read existing fqc_owner before writing frontmatter
    - RECON-05 post-write updated_at re-query to prevent false-modified classification
    - applyFieldMap: nullish coalescing (?? null) preserves falsy values (0, false, "")
key_files:
  created: []
  modified:
    - src/services/plugin-reconciliation.ts
decisions:
  - "withPendingReviewGuard op typed as PromiseLike<unknown> (not Promise<unknown>) — Supabase insert/delete return PostgrestFilterBuilder which is thenable but not a Promise; PromiseLike covers both"
  - "toAbsolutePath() casts vaultManager to { rootPath: string } — VaultManager public interface does not expose rootPath, but VaultManagerImpl always has it at runtime; plan test mocks confirm rootPath access pattern"
  - "applyFieldMap signature updated to accept fieldMap as Record<string, string> | undefined — Plan 01 exported it as non-optional but Plan 02 needed the undefined guard for safe policy?.field_map access"
metrics:
  duration: "~7 minutes"
  completed: "2026-04-20T20:00:16Z"
  tasks_completed: 2
  files_created: 0
  files_modified: 1
---

# Phase 85 Plan 02: Policy Executor — Summary

**One-liner:** `executeReconciliationActions()` implements all 7 D-06 policy branches with OQ-3 ownership check, RECON-05 post-write updated_at re-query, 42P01-guarded pending-review writes, and full `pg.escapeIdentifier` coverage; `applyFieldMap()` updated to accept optional fieldMap with `?? null` semantics.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add applyFieldMap helper, executeReconciliationActions skeleton, and private executor helpers | cfad06f | src/services/plugin-reconciliation.ts |
| 2 | Fill in all 7 branches of executeReconciliationActions | ab8ea4b | src/services/plugin-reconciliation.ts |

## Exact Branch Line Numbers (for Plan 03 test authoring)

| Branch | Loop start line | Key lines |
|--------|----------------|-----------|
| resurrected | 312 | pg UPDATE line 325, pending review INSERT line 328 |
| added (auto-track) | 342 | OQ-3 check line 352–353, atomicWriteFrontmatter line 356, RECON-05 re-query line 370, INSERT line 384 |
| deleted | 406 | pg UPDATE line 407, pending review DELETE line 409 |
| disassociated | 419 | pg UPDATE line 420, pending review DELETE line 422 |
| moved (keep-tracking) | 432 | pg UPDATE line 435 |
| moved (stop-tracking) | 432 | pg UPDATE line 438 |
| modified (sync-fields) | 448 | frontmatter re-read line 450, applyFieldMap line 451, pg UPDATE line 459 |
| modified (ignore) | 448 | pg UPDATE line 463 |

## OQ-3 Ownership Check Location

Line **352–353**: `const existingOwner = existingFm.fqc_owner;` / `const shouldWriteFrontmatter = !existingOwner || existingOwner === pluginId;`

The check reads existing frontmatter BEFORE calling `atomicWriteFrontmatter`. If `existingOwner` is set and differs from `pluginId`, the frontmatter write is skipped but the plugin row INSERT still proceeds (both plugins track the file in their tables).

## RECON-05 Post-Write Re-Query Location

Line **370–373**: `await supabase.from('fqc_documents').select('updated_at, content_hash').eq('id', doc.fqcId).single()`

This re-query runs inside the `result.added` loop AFTER `atomicWriteFrontmatter`. The returned `updated_at` becomes `last_seen_updated_at` in the plugin row INSERT, preventing the next reconciliation pass from classifying the newly-tracked document as `modified`.

## pg.escapeIdentifier Call Sites (T-85-05 Traceability)

| Line | Context |
|------|---------|
| 146 | ALTER TABLE for self-healing last_seen_updated_at column (Plan 01) |
| 322 | SET clause for field_map columns in resurrected UPDATE |
| 325 | Table name in resurrected UPDATE |
| 383 | Column list in added INSERT (field_map columns) |
| 384 | Table name in added INSERT |
| 407 | Table name in deleted UPDATE |
| 420 | Table name in disassociated UPDATE |
| 435 | Table name in moved keep-tracking UPDATE |
| 438 | Table name in moved stop-tracking UPDATE |
| 456 | SET clause for field_map columns in modified sync-fields UPDATE |
| 459 | Table name in modified sync-fields UPDATE |
| 463 | Table name in modified ignore UPDATE |
| 567 | Table name in plugin-row query (Plan 01) |

All 13 sites use `pg.escapeIdentifier()`. No string-concatenated identifiers in any SQL string.

## Deviations from Plan

### Auto-fixed Type Issues

**1. [Rule 2 - Missing null guard] applyFieldMap signature updated to accept undefined fieldMap**
- **Found during:** Task 1 — plan specified `Record<string, string> | undefined` in the action spec but the existing Plan 01 export had `Record<string, string>` (non-optional)
- **Fix:** Updated signature to `fieldMap: Record<string, string> | undefined` with early `if (!fieldMap) return result;` guard. Required for safe `policy?.field_map` access in all 3 branches that call `applyFieldMap`.
- **Files modified:** src/services/plugin-reconciliation.ts

**2. [Rule 3 - Blocking type error] withPendingReviewGuard op typed as PromiseLike<unknown>**
- **Found during:** Task 2 TypeScript check — `PostgrestFilterBuilder` (Supabase insert/delete return type) is thenable but does not extend `Promise<unknown>`, causing TS2739
- **Fix:** Changed `op: () => Promise<unknown>` to `op: () => PromiseLike<unknown>`. Functionally equivalent — `await` works on any thenable.
- **Files modified:** src/services/plugin-reconciliation.ts

**3. [Rule 3 - Blocking type error] toAbsolutePath() uses runtime cast for vaultManager.rootPath**
- **Found during:** Task 1 TypeScript check — `VaultManager` public interface does not expose `rootPath` (it is `private` on `VaultManagerImpl`)
- **Fix:** `(vaultManager as unknown as { rootPath: string }).rootPath` cast. At runtime `vaultManager` is always the concrete `VaultManagerImpl` which has `rootPath`. The test mock pattern in 085-PATTERNS.md confirms `vaultManager: { rootPath: '/vault' }` is the expected mock shape.
- **Files modified:** src/services/plugin-reconciliation.ts

## Known Stubs

None. All branches are fully implemented. The `void result; void policies; void pluginId; void instanceId;` no-op placeholder from the Task 1 skeleton was fully replaced in Task 2.

## Threat Surface Scan

All threat mitigations from T-85-05 through T-85-09 are implemented per the plan's threat model:

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-85-05 | IMPLEMENTED — all 13 pg.escapeIdentifier() sites confirmed (lines above) |
| T-85-06 | IMPLEMENTED — fqc_id values come from reconcilePluginDocuments() query results (our own DB); Supabase client uses parameterized statements internally |
| T-85-07 | IMPLEMENTED — OQ-3 ownership check at lines 352–353; frontmatter write skipped when existingOwner differs |
| T-85-08 | ACCEPTED — rate-limited by 30s staleness cache from Plan 01 |
| T-85-09 | IMPLEMENTED — all logger calls use `error.message` or count summaries; no frontmatter objects or connection strings logged |

No new threat surface introduced beyond what the plan's threat model covers.

## Self-Check

### Files exist
- [x] `src/services/plugin-reconciliation.ts` — 689 lines

### Commits exist
- [x] `cfad06f` — feat(85-02): add applyFieldMap helper, executeReconciliationActions skeleton, and private executor helpers
- [x] `ab8ea4b` — feat(85-02): implement all 7 action branches in executeReconciliationActions

### Acceptance criteria verification
- [x] `grep "export function applyFieldMap"` → 1 match (line 235)
- [x] `grep "export async function executeReconciliationActions"` → 1 match (line 295)
- [x] `grep -c "?? null"` → 3 matches (applyFieldMap body + comments)
- [x] `grep "|| null"` → 1 match (comment only, not executable code)
- [x] `grep -A 5 "export async function executeReconciliationActions"` → `instanceId?` present (D-05)
- [x] `grep "function withPendingReviewGuard"` → 1 match (line 272)
- [x] `grep "function readFrontmatterFromDisk"` → 1 match (line 260)
- [x] `grep "function toAbsolutePath"` → 1 match (line 253)
- [x] All 6 branch loops present at their respective lines
- [x] `grep -c "withPendingReviewGuard("` → 5 (resurrected, template_available, deleted, disassociated — meets ≥4 requirement)
- [x] `grep "existingOwner"` → 3 matches inside result.added loop (lines 352, 353, 361)
- [x] `grep -A 2 "from('fqc_documents')" | grep "updated_at"` → matches the post-write re-query
- [x] `grep "review_type: 'resurrected'"` → exactly 1 match
- [x] `grep "review_type: 'template_available'"` → exactly 1 match
- [x] `grep "policy.template"` → 2 matches (conditional check + context object)
- [x] `grep "on_moved === 'keep-tracking'"` → 1 match
- [x] `grep "on_moved === 'stop-tracking'"` → 1 match
- [x] `grep "on_modified === 'sync-fields'"` → 1 match
- [x] `npx tsc --noEmit` → exits 0
- [x] `npm test` → 10 pre-existing failures; 0 new regressions (same as Plan 01 baseline)

## Self-Check: PASSED
