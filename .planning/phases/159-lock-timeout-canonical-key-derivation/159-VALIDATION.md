---
phase: 159
slug: lock-timeout-canonical-key-derivation
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 159 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7 for unit/integration; Python directed scenario runner for `D-WCO-02` |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- tests/unit/lock-key-derivation.test.ts tests/unit/lock-timeout.test.ts --testNamePattern "canonical-key|case-fold|symlink|lock-timeout"` |
| **Full suite command** | `npm test && npm run test:integration -- --testNamePattern "lock-timeout"` plus directed scenario command when added |
| **Estimated runtime** | ~120 seconds without integration; integration depends on `.env.test` |

---

## Sampling Rate

- **After every task commit:** Run the targeted unit or integration command listed for the task.
- **After every plan wave:** Run `npm test -- --testNamePattern "canonical-key|case-fold|symlink|lock-timeout"` and targeted integration where applicable.
- **Before `$gsd-verify-work`:** Full Phase 159 suite must be green or skip-safe with `.env.test` explanation.
- **Max feedback latency:** 120 seconds for unit feedback; integration feedback may exceed this when exercising real Postgres contention.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 159-01-01 | 01 | 1 | REQ-003 | T-159-01 | Symlink and `.`/`..` aliases unify through `realpath` before hashing. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-006|canonical-key|symlink"` | ✅ present | ✅ green |
| 159-01-02 | 01 | 1 | REQ-003 | T-159-01 | Missing destinations use real parent path plus basename. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-007|destination"` | ✅ present | ✅ green |
| 159-01-03 | 01 | 1 | REQ-003 | T-159-02 | Case-insensitive filesystems fold path case so aliases share one lock identity. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-008|case-fold"` | ✅ present | ✅ green |
| 159-01-04 | 01 | 1 | REQ-003 | T-159-03 | File and directory keys use separate `file:` and `dir:` namespaces. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-009|namespace"` | ✅ present | ✅ green |
| 159-01-05 | 01 | 1 | REQ-003 | T-159-01 | Vault-relative inputs are canonicalized or rejected and never used as raw keys. | unit | `npm test -- tests/unit/lock-key-derivation.test.ts --testNamePattern "T-U-010|vault-relative"` | ✅ present | ✅ green |
| 159-02-01 | 02 | 1 | REQ-006 | T-159-04 | Configured timeout controls bounded Tier 2 acquisition. | unit | `npm test -- tests/unit/lock-timeout.test.ts --testNamePattern "T-U-014|lock-timeout"` | ✅ present | ✅ green |
| 159-02-02 | 02 | 1 | REQ-006 | T-159-04 | Missing config defaults to 10 seconds. | unit | `npm test -- tests/unit/lock-timeout.test.ts --testNamePattern "T-U-015|default"` | ✅ present | ✅ green |
| 159-02-03 | 02 | 2 | REQ-006 | T-159-04 | Default timeout returns structured `details.reason: "lock_timeout"` conflict. | integration | `npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern "T-I-009|lock-timeout"` | ✅ present | ✅ green |
| 159-02-04 | 02 | 2 | REQ-006 | T-159-04 | Configured 30 second timeout waits long enough for a 12 second holder. | integration | `npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern "T-I-010|lock-timeout"` | ✅ present | ✅ green |
| 159-03-01 | 03 | 2 | REQ-003 | T-159-02 | Public MCP case-variant writes serialize on case-insensitive filesystems. | directed | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_case_variant_path_locking` | ✅ present | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/lock-key-derivation.test.ts` — stubs and failing assertions for `T-U-006` through `T-U-010`.
- [x] `tests/unit/lock-timeout.test.ts` — stubs and failing assertions for `T-U-014` and `T-U-015`.
- [x] `tests/integration/lock-timeout.integration.test.ts` — skip-safe integration coverage for `T-I-009` and `T-I-010`.
- [x] `tests/scenarios/directed/testcases/test_case_variant_path_locking.py` — `D-WCO-02` directed scenario with case-sensitive filesystem skip.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Environment-dependent behavior (`D-WCO-02`) must skip clearly on case-sensitive filesystems.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s for unit sampling
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-26
