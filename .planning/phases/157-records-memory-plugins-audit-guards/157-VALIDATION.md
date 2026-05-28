---
phase: 157
slug: records-memory-plugins-audit-guards
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 157 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- --grep "no-coarse-resource-locks"` |
| **Full suite command** | `npm run test:integration -- --grep "memory-no-coarse-lock|records-reconciliation|unregister-plugin"` |
| **Estimated runtime** | ~90 seconds for targeted unit/static plus integration gates, excluding Supabase startup/network variance |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted unit or integration command.
- **After every plan wave:** Run `npm test -- --grep "no-coarse-resource-locks"` and any integration test added or modified in the wave.
- **Before `$gsd-verify-work`:** Run the full ROADMAP gate:
  `npm test -- --grep "no-coarse-resource-locks"` and
  `npm run test:integration -- --grep "memory-no-coarse-lock|records-reconciliation|unregister-plugin"`.
- **Max feedback latency:** 120 seconds for targeted commands when `.env.test` is available.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 157-01-01 | 01 | 0 | REQ-023 | 157-T1 | Coarse records/memory/plugins locks cannot be reintroduced unnoticed | unit/static | `npm test -- tests/unit/no-coarse-resource-locks.test.ts` | W0 | green |
| 157-01-02 | 01 | 1 | REQ-023 | 157-T2 | Concurrent memory updates converge through `fqc_memory_create_version` without duplicate latest rows | integration | `npm run test:integration -- tests/integration/memory-no-coarse-lock.integration.test.ts --testTimeout 120000 --hookTimeout 120000` | W1 | green |
| 157-02-01 | 02 | 1 | REQ-023 | 157-T3 | Records reconciliation cannot double-apply actions under concurrent calls | integration | `npm run test:integration -- tests/integration/records-reconciliation.integration.test.ts --testTimeout 120000 --hookTimeout 120000` | W1 | green |
| 157-03-01 | 03 | 1 | REQ-023 | 157-T4 | Concurrent plugin unregister cannot claim success after partial cleanup | integration | `npm run test:integration -- tests/integration/unregister-plugin-races.integration.test.ts --testTimeout 120000 --hookTimeout 120000` | W1 | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/no-coarse-resource-locks.test.ts` - static guard for `T-U-036`.
- [x] Integration harness setup for `T-I-043`, `T-I-044`, and `T-I-045`, reusing existing FlashQuery config, Supabase, and plugin registration patterns.
- [x] Records reconciliation concurrency review artifact, required by REQ-023 and ROADMAP Phase 157.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verification or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency < 120s for targeted commands when `.env.test` is configured.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** passed
