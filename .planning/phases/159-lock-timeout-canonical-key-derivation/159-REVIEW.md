---
phase: 159-lock-timeout-canonical-key-derivation
reviewed: 2026-05-27T00:22:46Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/services/document-lock.ts
  - src/config/types.ts
  - src/config/loader.ts
  - src/mcp/tools/documents/write.ts
  - src/mcp/tools/documents/copy.ts
  - src/mcp/tools/documents/move.ts
  - src/mcp/tools/documents/archive.ts
  - src/mcp/tools/documents/remove.ts
  - src/mcp/tools/compound.ts
  - tests/unit/lock-key-derivation.test.ts
  - tests/unit/lock-timeout.test.ts
  - tests/unit/config-loader.test.ts
  - tests/unit/document-lock-tier2.test.ts
  - tests/unit/with-document-lock.test.ts
  - tests/unit/document-lock-registry.test.ts
  - tests/unit/document-tool-lock-call-sites.test.ts
  - tests/integration/lock-timeout.integration.test.ts
  - tests/integration/two-tier-lock.integration.test.ts
  - tests/scenarios/directed/testcases/test_case_variant_path_locking.py
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: resolved
---

# Phase 159: Code Review Report

**Reviewed:** 2026-05-27T00:22:46Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** resolved

## Summary

Reviewed the canonical lock-key derivation, configurable lock timeout, document tool timeout envelopes, and the added unit/integration/directed coverage. The canonical key path is broadly covered, but the submitted implementation still has one lock-invariant violation in `write_document(update)` and one timeout-handle cleanup defect in Tier 1 acquisition.

## Resolution Follow-Up

Both review findings were fixed and re-verified on 2026-05-27T00:30:39Z.

| Finding | Status | Resolution Evidence |
|---------|--------|---------------------|
| CR-01 | Resolved | `write_document(update)` now locks a fresh `lockCandidate.absPath`, re-resolves inside the lock, returns a retry sentinel when the resolved path changed, and only reads/writes when both paths match. `tests/unit/document-tool-lock-call-sites.test.ts` asserts the retry guard. |
| WR-01 | Resolved | Tier 1 acquisition now uses `acquireTier1StripeWithTimeout`, clears the timeout in `finally`, calls `unref?.()`, and releases late mutex acquisitions after timeout. |

## Resolution Verification

- `npm test -- tests/unit/document-tool-lock-call-sites.test.ts tests/unit/with-document-lock.test.ts tests/unit/document-lock-tier2.test.ts tests/unit/lock-timeout.test.ts tests/unit/write-document.test.ts` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed: 167 files, 2086 tests.
- `npm run build` — passed.

## Critical Issues

### CR-01: `write_document(update)` Can Write a Re-Resolved Path Without Holding That Path's Lock

**File:** `src/mcp/tools/documents/write.ts:201`

**Issue:** The update path resolves the identifier once, locks `initialResolved.absPath`, then re-resolves inside the lock and writes `resolved.relativePath`. If a concurrent `move_document` changes the same `fqc_id` from `Old.md` to `New.md` while this update is waiting, the update acquires the old-path lock, re-resolves to `New.md`, and writes `New.md` without holding the `New.md` canonical lock. That breaks the document-lock invariant and can race with any operation correctly holding the new-path lock, causing lost updates or DB/file divergence.

**Fix:** Retry when the locked path no longer matches the fresh resolution, and only perform the read/write when both resolutions identify the same canonical path. Add a regression test that moves a document between the initial resolve and lock entry.

```ts
while (true) {
  const candidate = await resolveDocumentIdentifier(config, supabase, identifier as string, logger);
  const result = await withDocumentLock(config, candidate.absPath, async () => {
    const resolved = await resolveDocumentIdentifier(config, supabase, identifier as string, logger);
    if (resolved.absPath !== candidate.absPath) {
      return { retry: true as const };
    }
    // Existing update implementation, using resolved.
    return { retry: false as const, value: await updateResolvedDocument(resolved) };
  });
  if (!result.retry) return result.value;
}
```

## Warnings

### WR-01: Successful Tier 1 Lock Acquisition Leaves Timeout Handles Alive

**File:** `src/services/document-lock.ts:283`

**Issue:** The bounded Tier 1 acquisition races `tier1Stripes[stripeIndex].acquire()` against a `setTimeout`, but the timeout handle is never cleared when the mutex acquisition wins. Every successful acquisition leaves a pending timer until `lockTimeoutSeconds` elapses. In a one-shot process or test worker, a successful document write can keep Node alive for the full configured timeout, and larger configured timeouts make this worse.

**Fix:** Keep the timeout handle, clear it as soon as the race settles, and optionally `unref()` it so it cannot hold process shutdown open.

```ts
let timeout: NodeJS.Timeout | undefined;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeout = setTimeout(
    () => reject(new LockTimeoutError(entry.resource, configuredTimeoutSeconds)),
    remainingMs(deadline)
  );
  timeout.unref?.();
});

const releaseTier1 = await Promise.race([acquire, timeoutPromise]).finally(() => {
  if (timeout) clearTimeout(timeout);
});
```

---

_Reviewed: 2026-05-27T00:22:46Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
