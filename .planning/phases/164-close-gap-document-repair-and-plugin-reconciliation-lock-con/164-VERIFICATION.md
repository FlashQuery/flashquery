---
phase: 164-close-gap-document-repair-and-plugin-reconciliation-lock-con
verified: 2026-05-28T03:50:41Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 164: Close gap: document repair and plugin reconciliation lock contract Verification Report

**Phase Goal:** Every FlashQuery-mediated vault-file write that can happen as a side effect of read-triggered repair or plugin reconciliation runs under the same coherency contract as normal document writes: shared ancestor directory locks outside a per-file `withDocumentLock`, then the single durable `writeVaultFile` primitive. `get_document` remains read-lock-free unless a repair write is actually required.
**Verified:** 2026-05-28T03:50:41Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A `get_document` cache-hit/read-only path still takes no document lock. | VERIFIED | `src/mcp/tools/documents/get.ts` has no document-lock imports per `tests/unit/get-document-no-lock.test.ts`; `src/mcp/utils/document-output.ts:422-450` only calls `targetedScan` on missing/stale DB hash and builds cache-hit output without lock helpers. |
| 2 | A `get_document` repair path takes shared ancestor directory locks and the per-file document lock before `writeVaultFile`. | VERIFIED | `src/mcp/utils/document-resolver-primitives.ts:473-591` wraps actual repair in `withAncestorDirectoryLocksShared(..., () => withDocumentLock(...))`; the write path calls `writeMarkdownFile` inside that callback, and `writeMarkdownFile` delegates to `writeVaultFile` at `:100-113`. |
| 3 | Repaired `version_token`, `fqc_documents.content_hash`, and on-disk bytes match. | VERIFIED | `src/mcp/utils/document-output.ts:452-467` uses `capturedFrontmatter.contentHash` as `version_token` and DB hash update; integration T-I-026/T-I-027/T-I-028 passed, and D-WCO-06 passed with post-repair token accepted by follow-up write. |
| 4 | Plugin reconciliation frontmatter writes take the document-path lock contract, not only plugin coordination. | VERIFIED | `src/services/plugin-reconciliation.ts:430-434` wraps `applyAddedFrontmatter` in `withAncestorDirectoryLocksShared` outside `withDocumentLock`; `applyAddedFrontmatter` calls `atomicWriteFrontmatter(absPath, updates, lockConfig)` at `:414-418`. |
| 5 | `writeVaultFile` remains a primitive with ambient-lock assertion, not lock acquisition. | VERIFIED | `src/storage/vault-write.ts:83-102` documents caller-owned locking and only asserts with `isDocumentLockHeldForPath` when `FQC_LOCK_ASSERT=true`; it imports no lock-acquisition helpers. |
| 6 | Existing Phase 157 behavior remains intact for memory, records/plugin reconciliation serialization, and concurrent plugin unregister. | VERIFIED | `src/mcp/tools/records.ts:163` and `src/mcp/tools/plugins.ts:425` still use `withPluginCoordinationLock`; memory uses `fqc_memory_create_version` at `src/mcp/tools/memory.ts:319-320`; focused T-I-043/T-I-044/T-I-045 integration tests passed. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/mcp/utils/document-output.ts` | Read routing preserves cache-hit lock-free path and post-repair token propagation. | VERIFIED | Substantive; wired through `resolveAndBuildDocument`; no broad read locking found. |
| `src/mcp/utils/document-resolver-primitives.ts` | Repair write lock composition and `writeVaultFile` delegation. | VERIFIED | Substantive; actual repair branch wraps shared directory locks outside document lock before durable primitive. |
| `src/services/plugin-reconciliation.ts` | Plugin reconciliation frontmatter write lock envelope. | VERIFIED | Substantive; added-document frontmatter branch wraps document-path locks while preserving reconciliation DB sequencing. |
| `src/utils/frontmatter.ts` | Primitive-only frontmatter merge/write helper. | VERIFIED | Substantive; delegates to `writeVaultFile(absolutePath, updatedContent, { lockConfig })`; imports no document locks. |
| Focused unit/integration/directed tests | Evidence for T-U-037, T-U-030, T-I-026/027/028, T-I-040/043/044/045, D-WCO-06. | VERIFIED | Artifact SDK check passed for all plan-declared files; commands below passed. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `document-output.ts` | `targetedScan` | Stale/missing DB hash branch only | WIRED | `targetedScan` called only when DB hash is missing/stale; cache-hit branch bypasses it. |
| `document-resolver-primitives.ts` | `document-lock.ts` | `withAncestorDirectoryLocksShared` -> `withDocumentLock` -> `writeMarkdownFile` | WIRED | Manual source check verified exact nesting at `:473-591`; SDK regex was formatting-brittle. |
| `document-resolver-primitives.ts` | `vault-write.ts` | `writeMarkdownFile` -> `writeVaultFile(..., { lockConfig: config })` | WIRED | Verified at `:100-113`. |
| `plugin-reconciliation.ts` | `document-lock.ts` | `withAncestorDirectoryLocksShared` -> `withDocumentLock` -> `atomicWriteFrontmatter` | WIRED | Verified at `:430-434` with write call at `:414-418`. |
| `frontmatter.ts` | `vault-write.ts` | `atomicWriteFrontmatter` -> `writeVaultFile(..., { lockConfig })` | WIRED | Verified at `src/utils/frontmatter.ts:38-53`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `document-output.ts` | `versionToken` | `preScan.capturedFrontmatter.contentHash` from `targetedScan` / cache hit | Yes | FLOWING |
| `document-resolver-primitives.ts` | `capturedFrontmatter.contentHash` | `writeVaultFile` result after repair, or `computeHash(lockedRaw)` when no repair write remains needed | Yes | FLOWING |
| `plugin-reconciliation.ts` | `updatedHash` | Post-write file read + `computeHash(updatedRaw)` after `atomicWriteFrontmatter` | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| TypeScript compiles | `npm run typecheck` | `tsc --noEmit` passed | PASS |
| Focused unit lock/token/primitive coverage | `FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts tests/unit/plugin-reconciliation.test.ts tests/unit/resolve-document.test.ts tests/unit/record-tools.test.ts` | 6 files, 74 tests passed | PASS |
| No coarse resource locks regression | `npm test -- tests/unit/no-coarse-resource-locks.test.ts` | 1 file, 1 test passed | PASS |
| Focused integration coverage | `FQC_LOCK_ASSERT=true npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/memory-no-coarse-lock.integration.test.ts tests/integration/records-reconciliation.integration.test.ts tests/integration/unregister-plugin-races.integration.test.ts` | 5 files, 10 tests passed | PASS |
| Directed D-WCO-06 | `python3 tests/scenarios/directed/run_suite.py --managed read_triggered_repair_token` | 1 test, 3/3 steps passed; report `tests/scenarios/directed/reports/scenario-report-2026-05-28-004501.md` | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| None | `find scripts -path '*/tests/probe-*.sh' -type f` plus phase PLAN/SUMMARY grep | No probes found or declared | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| REQ-001 | 164-01, 164-03 | Per-file write locking replaces global document lock. | SATISFIED | Repair and reconciliation side-effect writes use per-file `withDocumentLock`; pure reads do not lock. |
| REQ-007 | 164-01, 164-02, 164-03 | Shared ancestor directory locks for file writes. | SATISFIED | Both repair and reconciliation write paths wrap shared ancestor directory locks outside document locks. |
| REQ-009 | 164-01, 164-02, 164-03 | Document-touching write call sites use document lock helper. | SATISFIED | Newly covered side-effect write paths use `withDocumentLock`; tests assert lock order. |
| REQ-014 | 164-01, 164-03 | Returned token, DB hash, and disk bytes are mutually consistent. | SATISFIED | T-I-026/T-I-027/T-I-028 and D-WCO-06 passed. |
| REQ-020 | 164-01, 164-02, 164-03 | All vault writes route through durable atomic primitive. | SATISFIED | `writeMarkdownFile` and `atomicWriteFrontmatter` delegate to `writeVaultFile`; T-U-030 passed. |
| REQ-023 | 164-02, 164-03 | Records/memory/plugins coordination after coarse lock retirement. | SATISFIED | Memory, records reconciliation, and unregister regression tests passed; plugin coordination locks remain. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `src/mcp/utils/document-output.ts` | 301 | `return null` | INFO | Benign validation helper return, not a stub or user-visible placeholder. |

### Human Verification Required

None.

### Gaps Summary

No blocking gaps found. The phase goal is achieved in current code: side-effect vault-file writes from read-triggered repair and plugin reconciliation now follow the same directory-lock -> document-lock -> durable primitive contract as normal document writes, while read-only `get_document` paths remain lock-free.

---

_Verified: 2026-05-28T03:50:41Z_
_Verifier: the agent (gsd-verifier)_
