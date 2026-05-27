---
phase: 161
slug: destination-locks-exdev-fallback
status: green
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-27
---

# Phase 161 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.1`; directed scenarios use Python runner |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- tests/unit/move-exdev-fallback.test.ts tests/unit/with-document-lock.test.ts --testNamePattern "move-exdev-fallback|T-U-034|T-U-035|T-U-017"` |
| **Full suite command** | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern "destination-lock|move-exdev|T-I-014|T-I-015|T-I-016|T-I-042|T-I-048"` |
| **Estimated runtime** | ~90 seconds locally, excluding session-capable DB skips |

---

## Sampling Rate

- **After every task commit:** Run the narrow unit command relevant to the touched files.
- **After every plan wave:** Run the full integration command above, recording environment skips separately from failures.
- **Before `$gsd-verify-work`:** Run required roadmap evidence and the `--testNamePattern` equivalents if Vitest rejects `--grep`.
- **Max feedback latency:** 120 seconds for unit feedback; integration may skip when `.env.test` is not session-capable.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 161-01-01 | 01 | 1 | REQ-008 | destination overwrite race | Destination existence checks happen inside destination locks for create/copy/move | unit/static | `npm test -- tests/unit/document-tool-lock-call-sites.test.ts --testNamePattern "destination"` | created/extended | green |
| 161-01-02 | 01 | 1 | REQ-008 | deadlock | `move_document` source+destination locks acquire in sorted canonical order | unit/integration | `npm test -- tests/unit/with-document-lock.test.ts --testNamePattern "T-U-017"` plus `T-I-015` | extended | green |
| 161-02-01 | 02 | 1 | REQ-022 | torn EXDEV destination | EXDEV fallback commits destination via durable primitive before source unlink | unit | `npm test -- tests/unit/move-exdev-fallback.test.ts --testNamePattern "T-U-034|T-U-035"` | created | green |
| 161-03-01 | 03 | 2 | REQ-008 | destination overwrite race | Concurrent public copy/move/create produce one success and one conflict/timeout | integration | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts --testNamePattern "T-I-014|T-I-016|T-I-048"` | created | green |
| 161-03-02 | 03 | 2 | REQ-022 | partial EXDEV fallback | Simulated fallback failure leaves no partial destination | integration | `npm run test:integration -- tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern "T-I-042"` | created | green |
| 161-04-01 | 04 | 2 | REQ-008 | public MCP race | Directed `D-WCO-03` proves copy destination race through MCP surface | scenario | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_copy_destination_race` | created | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/move-exdev-fallback.test.ts` - T-U-034 and T-U-035.
- [x] `tests/integration/destination-lock.integration.test.ts` - T-I-014, T-I-015, T-I-016, and T-I-048.
- [x] `tests/integration/move-exdev-fallback.integration.test.ts` - T-I-042.
- [x] `tests/scenarios/directed/testcases/test_copy_destination_race.py` - T-S-003 / D-WCO-03.
- [x] `tests/config/vitest.integration.config.ts` - includes both Phase 161 integration files.
- [x] `tests/scenarios/directed/DIRECTED_COVERAGE.md` - D-WCO-03 coverage row added.

## Execution Evidence

| Evidence ID | Command | Result | Notes |
|-------------|---------|--------|-------|
| T-U-034 / T-U-035 | `npm test -- tests/unit/move-exdev-fallback.test.ts --testNamePattern "T-U-034|T-U-035|move-exdev-fallback"` | green | 2 tests passed |
| T-U-017 | `npm test -- tests/unit/with-document-lock.test.ts --testNamePattern "T-U-017|sorted"` | green | 1 test passed, 4 skipped by selector |
| REQ-008 unit/static | `npm test -- tests/unit/document-tool-lock-call-sites.test.ts tests/unit/with-document-lock.test.ts --testNamePattern "REQ-008|destination|T-U-017|sorted"` | green | 2 tests passed, 10 skipped by selector |
| T-I-014 / T-I-015 / T-I-016 / T-I-048 | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts --testNamePattern "T-I-014|T-I-015|T-I-016|T-I-048|destination-lock"` | green | 4 tests passed; `.env.test` loaded; embedding warnings deferred as expected |
| T-I-042 | `npm run test:integration -- tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern "T-I-042|move-exdev"` | green | 1 test passed |
| Phase 161 integration sweep | `npm run test:integration -- tests/integration/destination-lock.integration.test.ts tests/integration/move-exdev-fallback.integration.test.ts --testNamePattern "destination-lock|move-exdev"` | green | 2 files passed, 5 tests passed |
| T-S-003 / D-WCO-03 | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_copy_destination_race` | green | 1 directed test passed; report `scenario-report-2026-05-27-104621.md` |

## Selector Deviations

- `npm test -- --grep "move-exdev-fallback"` was attempted and Vitest rejected `--grep` with `CACError: Unknown option --grep`.
- `npm run test:integration -- --grep "destination-lock|move-exdev"` was attempted and Vitest rejected `--grep` with `CACError: Unknown option --grep`.
- Required fallback selectors were run with `--testNamePattern`; see execution evidence above.

## Environment Notes

- `.env.test` was used for integration and directed scenario credentials.
- The configured Supabase `DATABASE_URL` uses the transaction pooler host/port (`pooler.supabase.com:6543`), which is not session-capable for advisory lock observation. Phase 161 public-handler race tests therefore use the same in-process Tier 1 lock path as existing Phase 155 integration coverage, while deterministic canonical ordering remains covered by `T-U-017` and `T-I-015`.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Environment-gated integration tests may skip when `.env.test` is not session-capable; summaries must record the skip reason and the deterministic unit evidence that still ran.

---

## Validation Sign-Off

- [x] All planned requirements have automated verification targets.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** automated evidence green
