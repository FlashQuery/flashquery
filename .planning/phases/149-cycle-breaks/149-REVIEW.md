---
phase: 149-cycle-breaks
reviewed: 2026-05-24T21:36:43Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - src/storage/document-primitives.ts
  - src/mcp/tools/documents.ts
  - src/mcp/utils/resolve-document.ts
  - src/services/scanner.ts
  - src/services/plugin-reconciliation.ts
  - src/macro/runtime-types.ts
  - src/macro/runtime-errors.ts
  - src/macro/evaluator.ts
  - src/macro/types.ts
  - src/macro/progress-emitter.ts
  - src/macro/builtins.ts
  - src/macro/shell-verbs.ts
  - src/macro/dispatcher.ts
  - src/macro/registry.ts
  - src/macro/budget.ts
  - src/macro/coerce.ts
  - src/macro/dry-run.ts
  - src/macro/forbidden-flag-scan.ts
  - src/macro/introspection.ts
  - src/macro/path-wrapper.ts
  - src/macro/preflight.ts
  - src/macro/task-registry.ts
  - tests/unit/document-tools.test.ts
  - tests/unit/resolve-document.test.ts
  - tests/unit/circular-deps.test.ts
  - tests/macro-framework/src/framework-mirror-check.ts
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 149: Code Review Report

**Reviewed:** 2026-05-24T21:36:43Z
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

Reviewed the Phase 149 cycle-breaking changes across document/plugin helpers, macro runtime helper extraction, and the new cycle/test tripwires. The explicit targeted unit tests passed locally, but the review found cross-instance reconciliation leakage, a broken macro cancellation-state API path, and two fragile tests that can mask or invent failures.

Verification run:
`npm test -- --run tests/unit/circular-deps.test.ts tests/unit/document-tools.test.ts tests/unit/resolve-document.test.ts` passed.

## Resolution Notes

- CR-02 fixed in `fdbaf0c`: shared `MacroCancellationState` objects are no longer copied, and a regression test flips a token while `sleep` is running.
- WR-01 fixed in `fdbaf0c`: the circular dependency gate now fails on `spawnSync().error` and asserts recognizable madge output.
- WR-02 fixed in `fdbaf0c`: the markdown listing assertion is order-insensitive.
- CR-01 remains documented as a broader pre-existing plugin reconciliation tenant-boundary issue. It was not introduced by Phase 149's import extraction and should be remediated in a dedicated record/plugin reconciliation phase because the fix changes public reconciliation call contracts and plugin table query semantics.

## Critical Issues

### CR-01: [BLOCKER] Plugin Reconciliation Ignores FlashQuery Instance Boundaries

**File:** `src/services/plugin-reconciliation.ts:646`
**Issue:** `reconcilePluginDocuments()` loads folder-discovered `fqc_documents`, ownership-type `fqc_documents`, and plugin table rows without filtering by the active FlashQuery `instance_id` (see lines 646, 663, and 682). Callers pass the active FQ instance only to `executeReconciliationActions()`, after classification has already mixed rows from every instance in the database. In a multi-instance database this can classify another instance's documents as added/deleted/moved and then archive or insert plugin rows for the wrong tenant.
**Fix:**
```ts
export async function reconcilePluginDocuments(
  pluginId: string,
  instanceId: string,
  fqcInstanceId: string,
  databaseUrl?: string,
): Promise<ReconciliationResult> {
  // Path 1
  const conditions = folderList.flatMap((folder, i) => {
    const base = 2 + i * 2;
    return [`path = $${base}`, `path LIKE $${base + 1}`];
  });
  const params = [fqcInstanceId, ...folderList.flatMap((folder) => [folder, `${folder}/%`])];
  const sql = `SELECT id, path, status, updated_at, ownership_plugin_id, ownership_type, content_hash
               FROM fqc_documents
               WHERE instance_id = $1 AND (${conditions.join(' OR ')})`;

  // Path 2
  const typePlaceholders = pluginTypeIds.map((_, i) => `$${i + 2}`).join(', ');
  const typeSql = `SELECT id, path, status, updated_at, ownership_plugin_id, ownership_type, content_hash
                   FROM fqc_documents
                   WHERE instance_id = $1 AND ownership_type IN (${typePlaceholders})`;

  // Plugin tables
  const pluginSql = `SELECT id, fqc_id, status, path, last_seen_updated_at
                     FROM ${pg.escapeIdentifier(tableName as string)}
                     WHERE instance_id = $1`;
}
```
Update all callers in `records.ts` to pass `config.instance.id`, and include that id in the staleness cache key.

### CR-02: [BLOCKER] Shared Cancellation Tokens Are Copied, So Later Cancellation Is Ignored

**File:** `src/macro/evaluator.ts:144`
**Issue:** `createInvocationContext()` accepts `cancelled?: boolean | MacroCancellationState`, but when the caller passes a mutable `MacroCancellationState` it copies only the initial value into a fresh object. Any later `token.value = true` update is invisible to `context.checkCancelled()`, so long-running macro builtins like `sleep` and `slow_op` keep running instead of returning the canonical `cancelled` envelope. This breaks the public runtime API shape declared in `runtime-types.ts`.
**Fix:**
```ts
const cancelled =
  typeof options.cancelled === 'object'
    ? options.cancelled
    : { value: options.cancelled ?? false };
```
Add a unit test that starts `evaluateProgram(parseProgram('sleep 500'), { cancelled: token })`, flips `token.value = true` while it is sleeping, and asserts the result has `error: "cancelled"`.

## Warnings

### WR-01: [WARNING] Circular Dependency Gate Can Pass When Madge Fails To Execute

**File:** `tests/unit/circular-deps.test.ts:5`
**Issue:** `runMadgeCircular()` discards `spawnSync().error` and never asserts that madge produced a valid report. If `npx` is missing, madge cannot start, or the CLI invocation changes enough to return no useful output, both tests can pass because the forbidden fragments are absent from an empty/error-only report.
**Fix:** Return the full `SpawnSyncReturns<string>` result, fail on `result.error`, and assert the output contains a recognizable madge circular-dependency report before checking forbidden fragments.

### WR-02: [WARNING] New Markdown-File Ordering Test Is Filesystem-Order Fragile

**File:** `tests/unit/document-tools.test.ts:67`
**Issue:** The test expects `listMarkdownFiles()` to return `Project/alpha.md` before `Project/Nested/beta.markdown`, but `fs.readdir(..., { recursive: true })` does not give this test a durable ordering contract across platforms and Node implementations. A harmless traversal-order change can fail the test even though the helper still returns the right set.
**Fix:** Either sort in `listMarkdownFiles()` before returning, which gives callers deterministic behavior too, or assert order-insensitively:
```ts
await expect(listMarkdownFiles(root, ['.md', '.markdown'], 'Project')).resolves.toEqual(
  expect.arrayContaining(['Project/alpha.md', 'Project/Nested/beta.markdown'])
);
```

---

_Reviewed: 2026-05-24T21:36:43Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
