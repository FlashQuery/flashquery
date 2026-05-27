---
phase: 162
slug: version-fingerprint-check
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-27
completed: 2026-05-27
---

# Phase 162 - Validation Evidence

> Final Phase 162 evidence for version-fingerprint check.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration; Python directed scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`; `tests/scenarios/directed/run_suite.py` |
| **Quick run command** | `npm test -- --testNamePattern "version-token|expected-version|conflict-envelope|get-document-no-lock"` |
| **Full suite command** | `npm run test:integration -- --testNamePattern "version-token|version-check|token-equals-disk|refused-write|scanner-zero-writes"` |
| **Estimated runtime** | ~120 seconds for focused unit/integration when `.env.test` is configured |

---

## Final Command Evidence

| Command | Result | Evidence |
|---------|--------|----------|
| `npm test -- --testNamePattern "version-token\|expected-version\|conflict-envelope\|get-document-no-lock"` | PASS, but selected 0 tests | Vitest completed successfully with 174 files skipped / 2129 tests skipped because current test names use IDs and underscores rather than those hyphenated phrases. Focused unit file run below is the authoritative per-ID evidence. |
| `npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/expected-version-schema.test.ts tests/unit/conflict-envelope.test.ts tests/unit/version-token-shape.test.ts` | PASS | 5 files passed, 19 tests passed. Covers `T-U-020`, `T-U-021`, `T-U-022`, `T-U-023`, `T-U-024`, `T-U-025`, and `T-U-037`. |
| `npm run test:integration -- --testNamePattern "version-token\|version-check\|token-equals-disk\|refused-write\|scanner-zero-writes"` | STOPPED | The broad selector matched a large integration surface and repeatedly rebuilt without converging in reasonable time. Focused file runs below provide attributable evidence for every required Phase 162 integration ID. |
| `npm run test:integration -- tests/integration/version-token-shape.integration.test.ts` | PASS | 1 file passed, 1 test passed. Covers `T-I-019`. |
| `npm run test:integration -- tests/integration/version-token-precondition.integration.test.ts` | PASS | 1 file passed, 6 tests passed. Covers `T-I-020` through `T-I-024`. |
| `npm run test:integration -- tests/integration/version-check-inside-lock.integration.test.ts` | PASS | 1 file passed, 1 test passed. Covers `T-I-025`. |
| `npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts` | PASS | 1 file passed, 3 tests passed. Covers `T-I-026` through `T-I-028`. |
| `npm run test:integration -- tests/integration/refused-write-envelope.integration.test.ts` | PASS | 1 file passed, 3 tests passed. Covers `T-I-029` through `T-I-031`. |
| `npm run test:integration -- tests/integration/scanner-zero-writes.integration.test.ts` | PASS | 1 file passed, 2 tests passed. Covers `T-I-032` and `T-I-033`. |
| `python3 tests/scenarios/directed/run_suite.py --managed version_token_round_trip read_triggered_repair_token scanner_token_stability` | PASS | 3 scenarios passed, 0 failed. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-27-141402.md`. Covers `D-WCO-05`, `D-WCO-06`, and `D-WCO-07`. |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 162-01-01 | 01 | 1 | REQ-011, REQ-014, REQ-016 | T-162-01 | Token is current disk hash, not stale DB/pre-repair data | unit/integration | focused unit files; `version-token-shape.integration`; `token-equals-disk.integration` | W0 | green |
| 162-02-01 | 02 | 1 | REQ-012, REQ-013 | T-162-02 | Stale writes are refused after fresh in-lock disk read | unit/integration | focused unit files; `version-token-precondition.integration`; `version-check-inside-lock.integration` | W0 | green |
| 162-03-01 | 03 | 2 | REQ-015 | T-162-03 | Conflict envelope returns only the caller-relevant current region | unit/integration | focused unit files; `refused-write-envelope.integration` | W0 | green |
| 162-04-01 | 04 | 2 | REQ-017 | T-162-04 | Scanner does not mutate unchanged files or repeatedly repair the same file | integration/directed | `scanner-zero-writes.integration`; `scanner_token_stability` directed scenario | W0 | green |
| 162-05-01 | 05 | 3 | REQ-011, REQ-012, REQ-014, REQ-017 | T-162-01/T-162-02/T-162-04 | MCP public workflows prove read-write retry and repair-token stability | directed | `python3 tests/scenarios/directed/run_suite.py --managed version_token_round_trip read_triggered_repair_token scanner_token_stability` | W0 | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/document-output-version-token.test.ts` - T-U-020/T-U-021.
- [x] `tests/unit/get-document-no-lock.test.ts` - T-U-037.
- [x] `tests/unit/expected-version-schema.test.ts` - T-U-022.
- [x] `tests/unit/conflict-envelope.test.ts` - T-U-023.
- [x] `tests/unit/version-token-shape.test.ts` - T-U-024/T-U-025.
- [x] `tests/integration/version-token-shape.integration.test.ts` - T-I-019.
- [x] `tests/integration/version-token-precondition.integration.test.ts` - T-I-020 through T-I-024.
- [x] `tests/integration/version-check-inside-lock.integration.test.ts` - T-I-025.
- [x] `tests/integration/token-equals-disk.integration.test.ts` - T-I-026 through T-I-028.
- [x] `tests/integration/refused-write-envelope.integration.test.ts` - T-I-029 through T-I-031.
- [x] `tests/integration/scanner-zero-writes.integration.test.ts` - T-I-032/T-I-033.
- [x] `tests/scenarios/directed/testcases/test_version_token_round_trip.py` - D-WCO-05.
- [x] `tests/scenarios/directed/testcases/test_read_triggered_repair_token.py` - D-WCO-06.
- [x] `tests/scenarios/directed/testcases/test_scanner_token_stability.py` - D-WCO-07.

## Requirement Evidence Map

| Requirement | Test IDs | Status |
|-------------|----------|--------|
| REQ-011 | `T-U-020`, `T-U-021`, `T-U-037`, `T-I-019`, `D-WCO-05` | green |
| REQ-012 | `T-U-022`, `T-I-020`, `T-I-021`, `T-I-022`, `T-I-023`, `T-I-024`, `D-WCO-05` | green |
| REQ-013 | `T-I-025` | green |
| REQ-014 | `T-I-026`, `T-I-027`, `T-I-028`, `D-WCO-06` | green |
| REQ-015 | `T-U-023`, `T-I-029`, `T-I-030`, `T-I-031`, `D-WCO-05` | green |
| REQ-016 | `T-U-024`, `T-U-025`, `T-I-019` | green |
| REQ-017 | `T-I-032`, `T-I-033`, `D-WCO-07` | green |

## Source Audit Coverage

| Source | Coverage |
|--------|----------|
| GOAL | Covered by Plans 01-06: public tokens, write preconditions, conflict envelopes, scanner stability, directed public workflows, and final validation evidence are complete. |
| REQ | Covered by Plans 01-06 with every `REQ-011` through `REQ-017` mapped above to green evidence. |
| RESEARCH | Covered by Plans 01-06: the repair-token hazard, inside-lock check, public conflict payload, whole-file raw-byte token, and scanner no-write invariant are all verified. |
| CONTEXT | Covered by Plans 01-06: phase boundary, deferred non-goals, and required unit/integration/directed IDs are reflected in this validation file. |

---

## Manual-Only Verifications

All phase behaviors have automated verification. This final run used `.env.test` and produced no environment skips for the required Phase 162 IDs. Background embedding warnings appeared because no embedding API key is configured; the Phase 162 assertions do not require embeddings and the tests passed.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all MISSING references.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-27 for planning

**Final evidence:** complete 2026-05-27 for Phase 162 Plan 06.
