---
phase: 146
slug: embedding-reliability-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-24
---

# Phase 146 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest unit/integration, Python directed scenarios, YAML integration scenarios |
| **Config file** | `vitest.config.ts`, `tests/config/vitest.integration.config.ts`, scenario runners |
| **Quick run command** | `npm test -- tests/unit/background-embed-helper.test.ts tests/unit/pending-embed-worker.test.ts tests/unit/pg-client-pool.test.ts tests/unit/scanner-embed-drain-status.test.ts` |
| **Full suite command** | `npm test -- tests/unit/background-embed-helper.test.ts tests/unit/pending-embed-worker.test.ts tests/unit/pg-client-pool.test.ts tests/unit/scanner-embed-drain-status.test.ts && npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts tests/integration/embedding/pending-embed-worker.test.ts tests/integration/doctor/embedding-diagnostics.test.ts tests/integration/mcp/tools/records-pg-pool.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_background_embed_failure_warning && python3 tests/scenarios/integration/run_integration.py --managed record_embed_pool_concurrency && npm run typecheck && npm run lint` |
| **Estimated runtime** | ~180 seconds, excluding scenario runners |

---

## Sampling Rate

- **After every task commit:** Run the focused command for the task's touched unit/integration specs.
- **After every plan wave:** Run the full suite command above plus any scenario added for D-69 or IS-15.
- **Before `$gsd-verify-work`:** `npm run typecheck`, `npm run lint`, focused unit/integration tests, and any added scenario coverage must be green or documented as skipped due to missing `.env.test`.
- **Max feedback latency:** 300 seconds for focused checks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 146-W0-REQ003 | 146-01, 146-02 | 0 | REQ-003 | TM-146-01 | Foreground writes surface deferred embedding warnings instead of silent loss | unit/integration | `npm test -- tests/unit/background-embed-helper.test.ts && npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts` | ✅ exists | ✅ green |
| 146-W0-REQ004 | 146-01, 146-03 | 0 | REQ-004 | TM-146-02 | Pending embeddings retry without cross-instance or target-kind drift | unit/integration | `npm test -- tests/unit/pending-embed-worker.test.ts tests/unit/scanner-embed-drain-status.test.ts && npm run test:integration -- tests/integration/embedding/pending-embed-worker.test.ts tests/integration/doctor/embedding-diagnostics.test.ts` | ✅ exists | ✅ green |
| 146-W0-REQ005 | 146-04 | 0 | REQ-005 | TM-146-03 | Record vector SQL releases pooled clients and preserves IPv4 behavior | unit/integration | `npm test -- tests/unit/pg-client-pool.test.ts && npm run test:integration -- tests/integration/mcp/tools/records-pg-pool.test.ts` | ✅ exists | ✅ green |
| 146-W0-SCENARIO | 146-02, 146-04 | 0 | REQ-003, REQ-005 | — | Public warning and pooled record workflow are proven if lower-level tests do not fully cover them | scenario | `python3 tests/scenarios/directed/run_suite.py --managed test_background_embed_failure_warning` and `python3 tests/scenarios/integration/run_integration.py --managed record_embed_pool_concurrency` | ✅ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/background-embed-helper.test.ts` — T-U-006, T-U-007, T-U-008.
- [x] `tests/unit/pending-embed-worker.test.ts` — T-U-009, T-U-010.
- [x] `tests/unit/pg-client-pool.test.ts` — T-U-011, T-U-012.
- [x] `tests/unit/scanner-embed-drain-status.test.ts` — scanner-created embedding retry/status regression coverage.
- [x] `tests/integration/embedding/background-embed-doc-memory-record.test.ts` — T-I-003, T-I-004.
- [x] `tests/integration/embedding/pending-embed-worker.test.ts` — T-I-005.
- [x] `tests/integration/doctor/embedding-diagnostics.test.ts` — T-I-006.
- [x] `tests/integration/mcp/tools/records-pg-pool.test.ts` — T-I-007, T-I-008.
- [x] Directed scenario D-69: `tests/scenarios/directed/testcases/test_background_embed_failure_warning.py`.
- [x] Integration scenario IS-15: `tests/scenarios/integration/tests/record_embed_pool_concurrency.yml`.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Scenario coverage may be conditionally omitted only when the implementation summary documents which lower-level tests prove the public acceptance criteria from the companion test plan.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 300s for focused checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete — full Phase 146 validation gate passed on 2026-05-24 using `.env.test`.
