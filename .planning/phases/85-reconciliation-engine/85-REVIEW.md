---
phase: 85-reconciliation-engine
reviewed: 2026-04-20T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/services/plugin-reconciliation.ts
  - tests/unit/field-map-null.test.ts
  - tests/unit/plugin-reconciliation.test.ts
  - tests/unit/reconciliation-staleness.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 85: Code Review Report

**Reviewed:** 2026-04-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the reconciliation engine implementation (`plugin-reconciliation.ts`) and its three unit test suites. The core classification logic is sound and clearly structured. The seven-state decision tree in `classifyDocument` correctly implements the mutual-exclusivity requirement. `applyFieldMap` correctly uses `??` instead of `||` and the tests validate that precisely.

Four warnings were found — two are logic correctness concerns in the source file, two are test reliability concerns. Three informational items note dead-code patterns and a minor semantic inconsistency.

---

## Warnings

### WR-01: `staleCacheKey` computes incorrect key when `instanceId` is passed as `undefined`

**File:** `src/services/plugin-reconciliation.ts:116`

**Issue:** The function signature declares `instanceId: string` but the `??` guard inside uses `instanceId ?? ''`. This is dead code — if `instanceId` were always a `string` the guard is unreachable, but `reconcilePluginDocuments` itself also accepts `instanceId: string` with no optional marker, meaning callers are already required to pass a value. The real concern is the public `executeReconciliationActions` (line 299), which declares `instanceId?: string` (optional) and then passes `instanceId ?? ''` to `markReconciled` (line 126) — but `markReconciled` in turn calls `staleCacheKey(pluginId, instanceId ?? '')`. The staleness cache key for an absent `instanceId` will always be `"pluginId:"`, while `reconcilePluginDocuments` records the key as `"pluginId:default"`. These will never match, so calling `executeReconciliationActions` without an `instanceId` will never benefit from the staleness guard that was intended to prevent double-reconciliation.

**Fix:** Either enforce `instanceId` as required in `executeReconciliationActions`, or align the defaulting so both sides use the same sentinel:

```typescript
// In executeReconciliationActions — line 299
export async function executeReconciliationActions(
  result: ReconciliationResult,
  policies: Map<string, DocumentTypePolicy>,
  pluginId: string,
  instanceId: string,  // make required, not optional
): Promise<void> {
```

---

### WR-02: Classification order — `disassociated` check fires before `moved`, masking a legitimate `moved` scenario

**File:** `src/services/plugin-reconciliation.ts:200-205`

**Issue:** The decision tree (lines 201-205) places the `disassociated` check (ownership mismatch) before the `moved` check (path outside watched folders). When a document is both owned by another plugin AND has moved outside the watched folder, it is classified as `disassociated`. This is probably intentional, but the comment block (D-04 reference) does not make the priority explicit. More importantly, the `disassociated` branch checks `ownership_plugin_id === null` as a disassociation trigger (line 202): `fqcDoc.ownership_plugin_id === null || fqcDoc.ownership_plugin_id !== pluginId`. A document that has never had an owner (`ownership_plugin_id = null`) but has an active plugin row is classified as `disassociated`. This is counterintuitive — a null owner could just as easily mean the document was just created and the frontmatter write hasn't propagated yet. If that's intended as a design decision it should be documented; if not, the null-ownership case should be its own guard or treated as `added` at a higher priority.

**Fix:** Add explicit comment at line 201 clarifying that null ownership is intentionally treated as disassociation. If null ownership should not trigger disassociation, restrict the guard:

```typescript
// Line 201-202: only fire disassociated if another plugin owns it, not if null
if (pluginRow?.status === 'active' && fqcDoc?.status === 'active' &&
    fqcDoc.ownership_plugin_id !== null &&
    fqcDoc.ownership_plugin_id !== pluginId) return 'disassociated';
```

---

### WR-03: `setupFqcDocuments` mock in `plugin-reconciliation.test.ts` is shared across both Supabase call paths, but the mock `from()` only creates one chain — both `.or()` (Path 1) and `.in()` (Path 2) resolve to the same data, meaning Path 2 queries cannot return different rows from Path 1

**File:** `tests/unit/plugin-reconciliation.test.ts:135-155`

**Issue:** `setupFqcDocuments` wraps all Supabase queries in a single `makeChain()` call per `from()` call. Both the Path 1 query (`.or(folderFilter)`) and the Path 2 query (`.in('ownership_type', ...)`) resolve to the same `rows` array because `chain.then` is hardcoded to `resolve({ data: rows, error: null })`. This means the deduplication test at line 361 ("merges deduplicated") only tests that `Map.set()` deduplicates on the same key — it never actually exercises the scenario where Path 1 and Path 2 return the same row from *distinct* database queries. The test passes vacuously and would not catch a regression where the candidateMap merge is broken.

**Fix:** For deduplication tests, create two separate chain instances and return the duplicate row from both paths independently:

```typescript
function setupFqcDocumentsPath1Path2(path1Rows: FqcDocRow[], path2Rows: FqcDocRow[]) {
  let callCount = 0;
  vi.mocked(supabaseManager.getClient).mockReturnValue({
    from: vi.fn().mockImplementation(() => {
      const rows = callCount++ === 0 ? path1Rows : path2Rows;
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.or = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      // ...
      chain.then = (resolve: (val: { data: FqcDocRow[]; error: null }) => void) =>
        resolve({ data: rows, error: null });
      return chain;
    }),
  } as any);
}
```

---

### WR-04: `executeReconciliationActions` has no test coverage — the `pgClient.end()` in the `finally` block is the only guaranteed cleanup, but there is no test verifying the pg connection is closed when an action throws mid-loop

**File:** `src/services/plugin-reconciliation.ts:306-472`

**Issue:** The `finally { await pgClient.end() }` pattern at line 469 is correct, but the unit test suites (`plugin-reconciliation.test.ts`, `field-map-null.test.ts`) do not test `executeReconciliationActions` at all. If any action loop throws (e.g., a malformed SQL from a bad `fieldMap` column name), the finally block runs, but there is no verification of this. More critically, the function constructs raw `SET` clauses from `Object.keys(fieldMapCols)` with `pg.escapeIdentifier` — if a plugin's `field_map` value maps to an empty string, `pg.escapeIdentifier('')` will produce `""`, which is a valid but semantically empty column name and will cause a runtime SQL error that propagates through the try/catch only up to the caller. This is untested.

**Fix:** Add at least one unit test for `executeReconciliationActions` covering:
1. The `resurrected` branch applies field_map and calls `pgClient.query` with the expected SQL shape.
2. The `finally` block calls `pgClient.end()` even when a query throws.

Additionally, add a guard in `applyFieldMap` (or at call sites) rejecting empty-string column names:

```typescript
// In applyFieldMap, after computing result[columnName]:
if (!columnName || columnName.trim() === '') {
  logger.warn(`[RECON] applyFieldMap: field_map maps '${frontmatterKey}' to empty column name — skipping`);
  continue;
}
```

---

## Info

### IN-01: `staleCacheKey` — `instanceId ?? ''` on a `string`-typed parameter is dead code

**File:** `src/services/plugin-reconciliation.ts:116`

**Issue:** `staleCacheKey` is typed `(pluginId: string, instanceId: string): string`. The `instanceId ?? ''` expression (line 116) can never be reached with `undefined` because TypeScript will reject `undefined` at the call site at compile time. The guard is harmless but misleading — it implies `undefined` is possible. The caller at line 678 passes `instanceId` directly (which is `string`, not optional).

**Fix:** Remove the redundant nullish coalescing:

```typescript
function staleCacheKey(pluginId: string, instanceId: string): string {
  return `${pluginId}:${instanceId}`;
}
```

---

### IN-02: `verifiedTables` module-level `Set` is never cleared between test runs — potential cross-test contamination in integration/test environments

**File:** `src/services/plugin-reconciliation.ts:105`

**Issue:** `reconciliationTimestamps` has a public `invalidateReconciliationCache()` export (line 107) that clears it between tests. `verifiedTables` has no equivalent. If a test adds a table name to `verifiedTables`, subsequent tests in the same Vitest worker will skip the `information_schema` check for that table name. The current tests call `vi.clearAllMocks()` but that does not reset module-level `Set` state. In practice this is benign for the current test suite, but it's a latent isolation risk.

**Fix:** Export a `resetVerifiedTablesCache()` (or merge it into `invalidateReconciliationCache`) and call it in `beforeEach`:

```typescript
export function invalidateReconciliationCache(): void {
  reconciliationTimestamps.clear();
  verifiedTables.clear(); // add this line
}
```

---

### IN-03: `inferDocTypeForAdded` falls back to a new single-element `Set` for folder matching, making each call allocate a new `Set` per docType iteration

**File:** `src/services/plugin-reconciliation.ts:223`

**Issue:** `inferDocTypeForAdded` calls `isPathInWatchedFolders(fqcDoc.path, new Set([d.policy.folder]))` for each `docType` in the `find` callback. This creates one `Set` per iteration and is semantically equivalent to a simple string prefix check. The allocation is small but the intent is obscured — it reads as if `d.policy.folder` could be a collection, when it's a single string.

**Fix:** Replace with a direct prefix check to make the intent clear and avoid unnecessary allocations:

```typescript
return docTypes.find((d) =>
  fqcDoc.path === d.policy.folder || fqcDoc.path.startsWith(d.policy.folder + '/')
);
```

---

_Reviewed: 2026-04-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
