---
phase: 162-version-fingerprint-check
verified: 2026-05-27T17:40:55Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 162: Version-fingerprint Check Verification Report

**Phase Goal:** Users can detect read-to-write conflicts with `version_token` while existing callers can continue using last-writer-wins behavior when they omit the token.
**Verified:** 2026-05-27T17:40:55Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `get_document` and successful file-affecting writes return a `version_token` matching current on-disk bytes. | VERIFIED | `computeVersionToken` hashes raw bytes in `src/mcp/utils/document-version.ts:16`; `get_document` response uses `capturedFrontmatter.contentHash` in `src/mcp/utils/document-output.ts:153` and `:166`; write success builders carry `version_token` in `src/mcp/utils/document-write.ts:175` and `src/mcp/utils/response-formats.ts:82`. Top-level and compound tools return post-write hashes, e.g. `write_document` at `src/mcp/tools/documents/write.ts:448`, `copy_document` at `src/mcp/tools/documents/copy.ts:238`, `insert_in_doc` at `src/mcp/tools/compound.ts:1310`. `remove_document` intentionally omits the token because the file no longer exists, matching REQ-011 AC2 and `documentRemovalResult` at `src/mcp/utils/response-formats.ts:277`. |
| 2 | Matching `expected_version` or `if_match` succeeds; a stale token refuses the write without modifying the file; omitted token preserves last-writer-wins. | VERIFIED | Schemas accept both names in `write_document` (`src/mcp/tools/documents/write.ts:81`), archive/remove/copy/move, and compound tools (`src/mcp/tools/compound.ts:273`, `:450`, `:1195`, `:1394`). `pickExpectedVersion` selects either alias at `src/mcp/utils/document-version.ts:20`. Tests verify match, stale refusal, source-token semantics, alias behavior, and omitted-token last-writer-wins in `tests/integration/version-token-precondition.integration.test.ts:46`, `:62`, `:77`, `:89`, `:109`, `:122`. |
| 3 | Conflict responses include current token and caller-relevant current region needed to retry safely. | VERIFIED | Shared envelope builder returns `error: "conflict"`, `details.reason: "version_mismatch"`, current `version_token`, and `targeted_region` in `src/mcp/utils/document-version.ts:24`. Top-level tools use whole-document regions (`src/mcp/tools/documents/write.ts:304`); compound tools build frontmatter, section, anchor/end, and not-found regions (`src/mcp/tools/compound.ts:222`, `:331`, `:1246`, `:1426`). Integration coverage verifies region shapes and byte-identical section representation in `tests/integration/refused-write-envelope.integration.test.ts:38`, `:89`, `:117`. |
| 4 | Version checks run after lock acquisition against fresh disk bytes, including external file changes. | VERIFIED | `write_document` acquires `withDocumentLock`, then reads disk and computes the token inside the lock at `src/mcp/tools/documents/write.ts:285` and `:298`; archive/remove/copy/move follow the same pattern at `archive.ts:81`, `remove.ts:89`, `copy.ts:250`, and `move.ts:191`. Compound tools read and compare inside `withDocumentLock` at `src/mcp/tools/compound.ts:328`, `:1240`, and `:1418`. External edit conflict is verified in `tests/integration/version-check-inside-lock.integration.test.ts:25`, with disk unchanged after refusal at `:44`. |
| 5 | Two consecutive scans of an unchanged vault perform no file writes. | VERIFIED | Scanner zero-write behavior is covered by `tests/integration/scanner-zero-writes.integration.test.ts:31` and `:53`, which instrument `vaultManager.writeMarkdown` and assert zero second-run writes. Directed coverage records `D-WCO-07` as passing in `tests/scenarios/directed/DIRECTED_COVERAGE.md:373`. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/mcp/utils/document-version.ts` | Shared token, alias, and conflict-envelope helpers | VERIFIED | Exports `computeVersionToken`, `pickExpectedVersion`, and `buildVersionMismatchEnvelope`; all are substantive and imported by document and compound tools. |
| `src/mcp/utils/document-output.ts` | `get_document` token and DB hash synchronization | VERIFIED | Computes raw-byte hash, uses post-repair `capturedFrontmatter.contentHash`, and updates `fqc_documents.content_hash` with the same value at `src/mcp/utils/document-output.ts:458` and `:470`. |
| `src/mcp/utils/document-resolver-primitives.ts` | Read-triggered repair returns post-write hash | VERIFIED | `writeMarkdownFile` returns `writeVaultFile(...).contentHash` at `src/mcp/utils/document-resolver-primitives.ts:115`; `targetedScan` stores it at `:470`. |
| `src/mcp/tools/documents/{write,archive,remove,copy,move}.ts` | Top-level expected-version schemas, in-lock checks, success tokens | VERIFIED | Artifacts exist and are substantive; manual wiring check confirms fresh reads inside locks and post-write token responses. |
| `src/mcp/tools/compound.ts` | Compound expected-version schemas, in-lock checks, targeted regions | VERIFIED | Artifact is substantive and wired to `document-version` and markdown-section helpers; region builders and conflict payloads are used by insert/replace/tags/link handlers. |
| Unit, integration, and directed test files from Plans 01-02 and 06 | Executable contract coverage for T-U/T-I/T-S IDs | VERIFIED | Artifacts exist; orchestrator final evidence reports unit PASS 5 files/19 tests, integration PASS 6 files/16 tests, and directed PASS 3/3. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `document-output.ts` | `fqc_documents.content_hash` | Same post-repair token used for response and DB update | VERIFIED | Automated pattern check was a false negative due multiline code. Manual evidence: `versionToken = preScan.capturedFrontmatter.contentHash` at `src/mcp/utils/document-output.ts:458`; DB update writes `content_hash: versionToken` at `:470`. |
| `document-resolver-primitives.ts` | `writeVaultFile` | Repair hash returned from durable primitive | VERIFIED | `writeVaultFile` result contentHash is returned at `src/mcp/utils/document-resolver-primitives.ts:115`. |
| `write.ts` | `document-lock.ts` | Fresh read and compare inside `withDocumentLock` | VERIFIED | Automated same-line pattern check was a false negative. Manual evidence: lock starts at `src/mcp/tools/documents/write.ts:285`; fresh `readFile` and `computeVersionToken` happen at `:298`. |
| `compound.ts` | `document-version.ts` / `markdown-sections.ts` | Conflict envelope and targeted-region extraction | VERIFIED | `buildVersionMismatchEnvelope` is used at `src/mcp/tools/compound.ts:228`; section and insert region helpers are used at `:213`, `:1250`, and `:1430`. |
| Directed scenarios | Public MCP document tools | `version_token` to `expected_version` round trip | VERIFIED | `test_version_token_round_trip.py` reads a token, writes with it, then verifies stale conflict at lines `55`, `74`, and `94`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `document-output.ts` | `version_token` | Fresh `readFile`, `targetedScan`, and DB content hash update | Yes | VERIFIED |
| `write.ts` | `expectedVersion` / `currentVersionToken` | Caller input plus fresh locked disk bytes | Yes | VERIFIED |
| `compound.ts` | `expectedVersion` / targeted regions | Caller input plus locked disk snapshots and markdown-section extraction | Yes | VERIFIED |
| `scanner-zero-writes.integration.test.ts` | `secondRunWrites` | Instrumented `vaultManager.writeMarkdown` during real `runScanOnce` | Yes | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Unit contract for response tokens, schemas, conflict envelopes, whole-file token, and read-no-lock | `npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/expected-version-schema.test.ts tests/unit/conflict-envelope.test.ts tests/unit/version-token-shape.test.ts` | Orchestrator evidence: PASS, 5 files / 19 tests | PASS |
| Integration contract for version-token behavior | Six focused integration file runs listed in `162-VALIDATION.md` | Orchestrator evidence: PASS, 6 files / 16 tests | PASS |
| Directed public workflows | `python3 tests/scenarios/directed/run_suite.py --managed version_token_round_trip read_triggered_repair_token scanner_token_stability` | Orchestrator evidence: PASS, 3 scenarios / 0 failures | PASS |
| Type safety | `npm run typecheck` | Orchestrator evidence: PASS | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| None | Probe discovery found no `scripts/**/tests/probe-*.sh` and no declared phase probes | Not applicable | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| REQ-011 | Plans 01, 02, 03, 04, 05, 06 | `version_token` on read and successful write responses | SATISFIED | Read envelope and write helpers include caller-facing `version_token`; unit and integration evidence covers T-U-020/T-U-021/T-I-019. |
| REQ-012 | Plans 01, 02, 04, 05, 06 | Optional `expected_version` / `if_match` on file-affecting tools with omitted-token compatibility | SATISFIED | Schemas and handlers cover top-level and compound tools; tests T-U-022 and T-I-020 through T-I-024 pass. |
| REQ-013 | Plans 02, 04, 05, 06 | Version check inside write lock against fresh disk bytes | SATISFIED | Lock-then-read pattern verified in code; T-I-025 external edit conflict passes. |
| REQ-014 | Plans 02, 03, 04, 05, 06 | Token, DB row, and disk bytes mutually consistent | SATISFIED | Repair hash propagation and DB update use post-write token; T-I-026 through T-I-028 pass. |
| REQ-015 | Plans 01, 02, 04, 05, 06 | Refused-write envelope includes current token and targeted region | SATISFIED | Shared envelope helper and per-tool region builders verified; T-U-023 and T-I-029 through T-I-031 pass. |
| REQ-016 | Plans 01, 03, 04, 05, 06 | Token is a whole-file raw-byte hash, not section scoped | SATISFIED | `computeVersionToken` hashes raw bytes; section response test rejects section-scoped token; T-U-024/T-U-025 pass. |
| REQ-017 | Plans 02, 06 | Scanner zero-writes-on-unchanged-files invariant | SATISFIED | Scanner integration T-I-032/T-I-033 and directed D-WCO-07 pass. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| None | - | No unreferenced `TBD`, `FIXME`, or `XXX`; no blocking placeholder implementation found in modified phase files | None | No blocker. Benign `return null` validation paths and empty fallback maps were reviewed and are not stubs. |

### Human Verification Required

None. The phase is CLI/MCP behavior with automated unit, integration, and directed scenario evidence. No visual or external-service-only UAT item remains.

### Gaps Summary

No blocking gaps found. The codebase evidence satisfies the phase goal: callers receive raw-byte `version_token`s, can opt into stale-write refusal with `expected_version` or `if_match`, can omit the token for existing last-writer-wins behavior, and get conflict payloads with retry data. Scanner stability is verified.

---

_Verified: 2026-05-27T17:40:55Z_
_Verifier: the agent (gsd-verifier)_
