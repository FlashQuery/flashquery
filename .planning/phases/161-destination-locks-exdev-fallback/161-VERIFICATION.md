---
phase: 161-destination-locks-exdev-fallback
verified: 2026-05-27T14:15:05Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
---

# Phase 161: Destination Locks + EXDEV Fallback Verification Report

**Phase Goal:** Users cannot accidentally overwrite destination paths through races, and cross-device moves preserve atomic durable semantics.
**Verified:** 2026-05-27T14:15:05Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Concurrent `copy_document` calls to the same destination produce exactly one success and one conflict/timeout. | VERIFIED | `tests/integration/destination-lock.integration.test.ts:54` runs two public handler calls with `Promise.all`; `expectOneSuccessAndOneConflict` requires one success and one `path_exists`/`lock_timeout` conflict. Directed public MCP scenario `tests/scenarios/directed/testcases/test_copy_destination_race.py:91` also runs parallel `copy_document` calls. |
| 2 | Concurrent `move_document` calls to the same destination produce exactly one success and one conflict/timeout. | VERIFIED | `tests/integration/destination-lock.integration.test.ts:95` races two `move_document` public handler calls to `phase161/move-dest.md` and asserts one success/one conflict. |
| 3 | Concurrent create-mode `write_document` calls to the same absent destination produce exactly one success and one conflict/timeout. | VERIFIED | `tests/integration/destination-lock.integration.test.ts:113` races two create-mode `write_document` calls to one path and asserts one success/one conflict. |
| 4 | `move_document` locks both source and destination in deterministic sorted canonical order. | VERIFIED | `src/mcp/tools/documents/move.ts:171` wraps source and destination ancestor locks, then `withDocumentLocks(config, [sourceAbsPath, normalizedDest], ...)`; `tests/unit/with-document-lock.test.ts:108` proves sorted canonical advisory acquire order and reverse release order. |
| 5 | Create-mode `write_document` holds the destination file lock before the authoritative destination existence check. | VERIFIED | `src/mcp/tools/documents/write.ts:125` enters `withDocumentLock(config, absolutePath, ...)`; `existsSync(absolutePath)` is inside the callback at `write.ts:127`; static guard in `tests/unit/document-tool-lock-call-sites.test.ts:203`. |
| 6 | `copy_document` holds the destination file lock before the authoritative destination existence check. | VERIFIED | `src/mcp/tools/documents/copy.ts:145` enters `withDocumentLock(config, absPath, ...)`; `existsSync(absPath)` is inside the callback at `copy.ts:147`; static guard in `tests/unit/document-tool-lock-call-sites.test.ts:209`. |
| 7 | `move_document` destination existence checks happen inside the destination/source multi-lock. | VERIFIED | `src/mcp/tools/documents/move.ts:173` calls `withDocumentLocks`; `existsSync(destAbsPath)` is inside that callback at `move.ts:175`; static guard in `tests/unit/document-tool-lock-call-sites.test.ts:215`. |
| 8 | A cross-device move writes the destination through the durable primitive before unlinking the source. | VERIFIED | `src/mcp/tools/documents/move.ts:205` detects EXDEV, reads source, calls `writeVaultFile(destAbsPath, content, { lockConfig: config })` at `move.ts:208`, then `unlink(sourceAbsPath)` at `move.ts:209`; unit order assertion in `tests/unit/move-exdev-fallback.test.ts:172`. |
| 9 | If the durable destination commit fails, the source remains intact and unlink is not called. | VERIFIED | `tests/unit/move-exdev-fallback.test.ts:207` rejects `writeVaultFile` and asserts `unlink` was not called; `tests/integration/move-exdev-fallback.integration.test.ts:160` asserts source content remains and destination is absent. |
| 10 | EXDEV detection handles Node errno code `EXDEV`, not only message text. | VERIFIED | `src/mcp/tools/documents/move.ts:34` checks `NodeJS.ErrnoException.code === 'EXDEV'`; unit setup throws an Error with `{ code: 'EXDEV' }` at `tests/unit/move-exdev-fallback.test.ts:174`. |
| 11 | An EXDEV fallback failure never leaves a partial destination and never removes the source before destination commit. | VERIFIED | Integration test `tests/integration/move-exdev-fallback.integration.test.ts:160` uses the registered `move_document` handler, simulates EXDEV plus durable write failure, and asserts source intact, destination absent, and runtime error returned. |
| 12 | Public directed scenario D-WCO-03 proves parallel `copy_document` destination race prevention. | VERIFIED | `tests/scenarios/directed/testcases/test_copy_destination_race.py:56` starts a managed public MCP server and `:94` runs parallel `copy_document` calls; `DIRECTED_COVERAGE.md:369` registers D-WCO-03 as passing on 2026-05-27. |
| 13 | Final Phase 161 evidence records required roadmap commands and the Vitest `--grep` to `--testNamePattern` deviation. | VERIFIED | `161-VALIDATION.md` records the roadmap `--grep` failures and targeted equivalent evidence; verifier re-ran the `--grep` commands and observed `CACError: Unknown option --grep`. |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/mcp/tools/documents/write.ts` | REQ-008 create destination lock site and comment-table coverage | VERIFIED | Contains REQ-008 comment and destination lock/existence check at lines 122-127. |
| `src/mcp/tools/documents/copy.ts` | REQ-008 copy destination lock site and comment-table coverage | VERIFIED | Contains REQ-008 comment and destination lock/existence check at lines 142-147. |
| `src/mcp/tools/documents/move.ts` | REQ-008 multi-lock and REQ-022 EXDEV fallback implementation | VERIFIED | Contains sorted multi-lock call at lines 171-173 and EXDEV durable fallback at lines 205-209. |
| `tests/unit/document-tool-lock-call-sites.test.ts` | Static source-order assertions for existence checks inside locks | VERIFIED | REQ-008 source-order guard at lines 189-222. |
| `tests/unit/with-document-lock.test.ts` | Deterministic sorted multi-lock acquisition proof | VERIFIED | T-U-017 sorted key and reverse release assertion at lines 108-135. |
| `tests/unit/move-exdev-fallback.test.ts` | T-U-034 and T-U-035 EXDEV unit coverage | VERIFIED | Tests write-before-unlink and no-unlink-on-write-failure at lines 172-217. |
| `tests/unit/move-document.test.ts` | Move behavior regression coverage included in review scope | VERIFIED | Present and passed in targeted verifier unit command. |
| `tests/integration/destination-lock.integration.test.ts` | T-I-014, T-I-015, T-I-016, T-I-048 | VERIFIED | Public handler race and sorted-order evidence at lines 54-130. |
| `tests/integration/move-exdev-fallback.integration.test.ts` | T-I-042 EXDEV failure coverage | VERIFIED | Registered handler simulation at lines 160-180. |
| `tests/config/vitest.integration.config.ts` | Explicit integration include registration | VERIFIED | Includes both Phase 161 integration files at lines 23-24. |
| `tests/scenarios/directed/testcases/test_copy_destination_race.py` | T-S-003 / D-WCO-03 directed scenario | VERIFIED | Managed public MCP scenario, no false-pass skip gate, lines 56-124. |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | D-WCO-03 coverage registration | VERIFIED | D-WCO-03 row and scenario detail are present. |
| `.planning/phases/161-destination-locks-exdev-fallback/161-VALIDATION.md` | Final execution evidence and selector deviation | VERIFIED | Records unit, integration, directed evidence plus `.env.test`/pooler context. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/mcp/tools/documents/write.ts` | `src/services/document-lock.ts` | `withDocumentLock(config, absolutePath, ...)` | WIRED | Imported helper and used around create-mode existence check. |
| `src/mcp/tools/documents/copy.ts` | `src/services/document-lock.ts` | `withDocumentLock(config, absPath, ...)` | WIRED | Imported helper and used around copy destination existence check. |
| `src/mcp/tools/documents/move.ts` | `src/services/document-lock.ts` | `withDocumentLocks(config, [sourceAbsPath, normalizedDest], ...)` | WIRED | Manual verification confirms the PLAN pattern at `move.ts:173`; SDK rejected the escaped regex string as invalid, but source link exists. |
| `src/mcp/tools/documents/move.ts` | `src/storage/vault-write.ts` | `writeVaultFile(destAbsPath, content, { lockConfig: config })` | WIRED | Manual verification confirms the PLAN pattern at `move.ts:208`; SDK rejected the escaped regex string as invalid, but source link exists. |
| `tests/unit/document-tool-lock-call-sites.test.ts` | `src/mcp/tools/documents/{write,copy,move}.ts` | Source-order assertions | WIRED | Test reads actual source files and asserts lock-before-`existsSync` placement. |
| `tests/integration/destination-lock.integration.test.ts` | Registered document tool handlers | Public handler calls | WIRED | Uses `harness.handlers.write_document`, `.copy_document`, and `.move_document`. |
| `tests/integration/move-exdev-fallback.integration.test.ts` | `src/mcp/tools/documents/move.ts` | Registered `move_document` handler and mocked EXDEV path | WIRED | Registers document tools and fetches `move_document` handler before exercising fallback. |
| `tests/scenarios/directed/testcases/test_copy_destination_race.py` | `copy_document` public MCP tool | Managed public MCP calls | WIRED | `TestContext(managed=True)` and `ctx.client.call_tool("copy_document", ...)` are used. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `write.ts` create path | `absolutePath` | `validateVaultPath` result from user `path` | Yes | FLOWING - `existsSync(absolutePath)` and `writeVaultFile(absolutePath, ...)` use validated destination inside lock. |
| `copy.ts` destination path | `absPath` | `validateVaultPath` result from user `destination` | Yes | FLOWING - existence check and destination write use the same validated path inside lock. |
| `move.ts` source/destination paths | `sourceAbsPath`, `destAbsPath`, `normalizedDest` | Resolver plus `validateVaultPath` | Yes | FLOWING - multi-lock callback guards destination existence, rename, EXDEV durable fallback, unlink, and DB path update. |
| `destination-lock.integration.test.ts` | Public handler results | Registered MCP document handlers | Yes | FLOWING - tests call actual handlers and parse returned envelopes. |
| `test_copy_destination_race.py` | Public MCP responses | Managed FlashQuery server | Yes | FLOWING - scenario calls public MCP tools over the managed server. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Required roadmap unit grep command behavior | `npm test -- --grep "move-exdev-fallback"` | Fails with `CACError: Unknown option --grep` under Vitest v4.1.7 / Node v24.7.0. | PASS as documented selector deviation |
| Required roadmap integration grep command behavior | `npm run test:integration -- --grep "destination-lock|move-exdev"` | Fails with `CACError: Unknown option --grep` under Vitest v4.1.7 / Node v24.7.0. | PASS as documented selector deviation |
| Phase 161 unit coverage | `npx vitest run tests/unit/move-exdev-fallback.test.ts tests/unit/with-document-lock.test.ts tests/unit/document-tool-lock-call-sites.test.ts tests/unit/move-document.test.ts --config tests/config/vitest.unit.config.ts` | 4 files passed, 23 tests passed, duration 842ms. | PASS |
| Phase 161 integration coverage | `npx vitest run tests/integration/destination-lock.integration.test.ts tests/integration/move-exdev-fallback.integration.test.ts --config tests/config/vitest.integration.config.ts` | 2 files passed, 5 tests passed, duration 36.36s. Background embedding warnings reported no API key, but tests passed. | PASS |
| Directed D-WCO-03 scenario | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_copy_destination_race` | PASS: 1 test, 2/2 steps, 0 cleanup residue; report `tests/scenarios/directed/reports/scenario-report-2026-05-27-111456.md`. | PASS |
| `.env.test` pooler context | `node -e ...` sanitized DATABASE_URL inspection | `.env.test DATABASE_URL host=aws-1-us-west-2.pooler.supabase.com port=6543`. | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| Conventional or declared probes | `find scripts -path '*/tests/probe-*.sh' ...` and PLAN/SUMMARY grep | No Phase 161 probes discovered. | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REQ-008 | 161-01, 161-03, 161-04 | Destination-path locks for create/copy/move; move locks source and destination in sorted canonical order; destination existence check is not the only guard. | SATISFIED | Source locks and static assertions in `write.ts`, `copy.ts`, `move.ts`, `document-tool-lock-call-sites.test.ts`, `with-document-lock.test.ts`; public race tests for create/copy/move; directed D-WCO-03 public MCP coverage. |
| REQ-022 | 161-02, 161-04 | Cross-device EXDEV fallback uses the same atomic/durable write discipline and unlinks source only after destination commit. | SATISFIED | `move.ts` uses `writeVaultFile` before `unlink`; unit and integration tests assert write-before-unlink, no unlink on durable failure, source intact, and no partial destination. |

No orphaned Phase 161 requirements were found. `.planning/REQUIREMENTS.md` maps Phase 161 to REQ-008 and REQ-022 only.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | various historical rows | `placeholder` text | Info | These are literal test descriptions for call-model placeholder behavior, not Phase 161 stubs or incomplete work. |

No unreferenced `TBD`, `FIXME`, or `XXX` debt markers were found in Phase 161 scoped source/test files. No Phase 161 stub implementation was found.

### Human Verification Required

None. Phase 161 is CLI/MCP and test-facing; all success criteria are covered by source inspection plus automated unit, integration, and directed scenario execution.

### Gaps Summary

No blocking gaps found. The only deviation is the roadmap's `--grep` command form, which Vitest rejects; the validation file records this accurately and equivalent targeted commands passed during verification. Integration and directed evidence used `.env.test`; the sanitized `DATABASE_URL` host is `aws-1-us-west-2.pooler.supabase.com:6543`, so Phase 161 integration remains Tier 1/in-process for public-handler race evidence while canonical sorted lock behavior is proven deterministically in unit and integration tests.

---

_Verified: 2026-05-27T14:15:05Z_
_Verifier: the agent (gsd-verifier)_
