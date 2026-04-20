---
phase: 85-reconciliation-engine
reviewed: 2026-04-20T12:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/mcp/tools/scan.ts
  - src/services/plugin-reconciliation.ts
  - tests/unit/field-map-null.test.ts
  - tests/unit/plugin-reconciliation.test.ts
  - tests/unit/reconciliation-staleness.test.ts
  - tests/unit/staleness-invalidation.test.ts
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 85: Code Review Report

**Reviewed:** 2026-04-20T12:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the reconciliation engine implementation (`plugin-reconciliation.ts`), the `force_file_scan` MCP tool (`scan.ts`), and all four unit test suites. The core classification logic is sound and well-structured. The seven-state decision tree in `classifyDocument` correctly implements mutual-exclusivity. `applyFieldMap` correctly uses `??` over `||` and its tests validate that precisely. The staleness cache design is correct and the `force_file_scan` integration is clean.

Four warnings were found — two are logic/correctness concerns in the source file, two are test reliability concerns. Four informational items note dead-code patterns, a test isolation risk, a minor semantic inconsistency, and duplicated test helper code across two files.

---

## Warnings

### WR-01: `executeReconciliationActions` uses a different `instanceId` default than `reconcilePluginDocuments`, breaking staleness key alignment

**File:** `src/services/plugin-reconciliation.ts:299`

**Issue:** `executeReconciliationActions` declares `instanceId?: string` (optional) and passes `instanceId ?? ''` to `markReconciled`. `reconcilePluginDocuments` declares `instanceId: string` (required) and records the staleness key as `"pluginId:default"` when called with `'default'`. If a caller invokes `executeReconciliationActions` without an `instanceId`, it records the key as `"pluginId:"`, which will never match the key set by `reconcilePluginDocuments`. The staleness guard is silently bypassed for callers that omit `instanceId`, allowing duplicate full reconciliation runs within the 30-second window.

**Fix:** Make `instanceId` required in `executeReconciliationActions` to match `reconcilePluginDocuments`:

```typescript
export async function executeReconciliationActions(
  result: ReconciliationResult,
  policies: Map<string, DocumentTypePolicy>,
  pluginId: string,
  instanceId: string,  // required, not optional
): Promise<void> {
```

---

### WR-02: Classification order places `disassociated` before `moved`, and null `ownership_plugin_id` triggers disassociation

**File:** `src/services/plugin-reconciliation.ts:201-205`

**Issue:** The `disassociated` check at line 201 fires before the `moved` check at line 204. The disassociated condition includes `fqcDoc.ownership_plugin_id === null`, so a document whose frontmatter write has not yet propagated (null owner, active plugin row, path outside watched folder) is classified as `disassociated` rather than `moved`. This is not necessarily wrong, but the specification reference (D-04) does not make the null-owner priority explicit, and the behaviour is surprising. No test covers this edge case.

**Fix:** Add an explicit comment at line 201 documenting that null ownership is intentionally treated as disassociation. If null ownership should not trigger disassociation, restrict the guard:

```typescript
// Only fire disassociated if a different plugin owns it; null owner falls through to moved/added
if (pluginRow?.status === 'active' && fqcDoc?.status === 'active' &&
    fqcDoc.ownership_plugin_id !== null &&
    fqcDoc.ownership_plugin_id !== pluginId) return 'disassociated';
```

---

### WR-03: `setupFqcDocuments` mock in `plugin-reconciliation.test.ts` cannot return different data for Path 1 vs Path 2 — the deduplication test passes vacuously

**File:** `tests/unit/plugin-reconciliation.test.ts:135-155`

**Issue:** `setupFqcDocuments` wraps all Supabase queries in a single `makeChain()` per `from()` call. Both the Path 1 query (`.or(folderFilter)`) and the Path 2 query (`.in('ownership_type', ...)`) resolve to the same `rows` array because `chain.then` is hardcoded to `resolve({ data: rows, error: null })`. The deduplication test at line 361 ("merges deduplicated when same doc returned by both Path 1 and Path 2") only tests that `Map.set()` deduplicates on the same key from a single query chain — it never exercises distinct queries returning the same row independently. The test would continue to pass even if the `candidateMap` merge were broken.

**Fix:** Add a helper that returns different data per call index for deduplication-specific tests:

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
      chain.then = (resolve: (val: { data: FqcDocRow[]; error: null }) => void) =>
        resolve({ data: rows, error: null });
      return chain;
    }),
  } as any);
}
```

---

### WR-04: `executeReconciliationActions` has no test verifying the `finally` block closes the pg connection when an action loop throws

**File:** `src/services/plugin-reconciliation.ts:306-472`

**Issue:** The `finally { await pgClient.end() }` pattern at line 469 is the only connection-cleanup guarantee. The unit test suites include only a no-op smoke test for `executeReconciliationActions` (empty result, no throw). There is no test that verifies `pgClient.end()` is called when a query inside an action loop throws. Additionally, the function constructs raw `SET` clauses from `Object.keys(fieldMapCols)` with `pg.escapeIdentifier` — if a plugin's `field_map` maps to an empty string column name, `pg.escapeIdentifier('')` produces `""`, which is a valid SQL token but semantically empty and will cause a runtime error that only surfaces at query time.

**Fix:** Add a test verifying cleanup on throw, and add a guard in `applyFieldMap` or at call sites:

```typescript
// In applyFieldMap — before assigning result[columnName]
if (!columnName || columnName.trim() === '') {
  logger.warn(`[RECON] applyFieldMap: field_map maps '${frontmatterKey}' to empty column name — skipping`);
  continue;
}
```

---

## Info

### IN-01: `staleCacheKey` — `instanceId ?? ''` on a `string`-typed parameter is dead code

**File:** `src/services/plugin-reconciliation.ts:116`

**Issue:** `staleCacheKey` is typed `(pluginId: string, instanceId: string): string`. The `instanceId ?? ''` expression can never be `undefined` because TypeScript rejects it at the call site. The guard is harmless but implies `undefined` is possible, which is misleading.

**Fix:** Remove the redundant nullish coalescing:

```typescript
function staleCacheKey(pluginId: string, instanceId: string): string {
  return `${pluginId}:${instanceId}`;
}
```

---

### IN-02: `verifiedTables` module-level `Set` is never cleared — potential cross-test contamination

**File:** `src/services/plugin-reconciliation.ts:105`

**Issue:** `reconciliationTimestamps` is cleared by the exported `invalidateReconciliationCache()`, which tests call in `beforeEach`. `verifiedTables` has no equivalent reset. A table name added to the `Set` in one test persists across all subsequent tests in the same Vitest worker, causing the `information_schema` check to be silently skipped. This is currently benign but is a latent test isolation risk.

**Fix:** Clear `verifiedTables` inside `invalidateReconciliationCache`:

```typescript
export function invalidateReconciliationCache(): void {
  reconciliationTimestamps.clear();
  verifiedTables.clear(); // add this
}
```

---

### IN-03: `inferDocTypeForAdded` allocates a new `Set` per docType iteration for a single-element folder check

**File:** `src/services/plugin-reconciliation.ts:223`

**Issue:** `inferDocTypeForAdded` calls `isPathInWatchedFolders(fqcDoc.path, new Set([d.policy.folder]))` in a `.find()` callback. This creates a one-element `Set` per iteration and delegates to a function that iterates over it — semantically equivalent to a single string prefix test. The intent is obscured.

**Fix:** Replace with a direct prefix check:

```typescript
return docTypes.find((d) =>
  fqcDoc.path === d.policy.folder || fqcDoc.path.startsWith(d.policy.folder + '/')
);
```

---

### IN-04: `makeEntry`, `setupPluginEntry`, `setupFqcDocuments`, and `setupPgClient` are duplicated verbatim across `reconciliation-staleness.test.ts` and `staleness-invalidation.test.ts`

**File:** `tests/unit/reconciliation-staleness.test.ts:55-125` and `tests/unit/staleness-invalidation.test.ts:55-125`

**Issue:** Both staleness test files contain identical helper implementations (approximately 70 lines each). Any change to the mock shape — e.g., adding a new Supabase chain method — must be made in two places. This is a maintenance burden and a source of future divergence.

**Fix:** Extract the shared helpers into a test utility file (e.g., `tests/unit/helpers/staleness-helpers.ts`) and import from both test files:

```typescript
// tests/unit/helpers/staleness-helpers.ts
export function makeEntry(pluginId: string) { ... }
export function setupPluginEntry(pluginId?: string) { ... }
export function setupFqcDocuments() { ... }
export function setupPgClient() { ... }
```

---

_Reviewed: 2026-04-20T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
