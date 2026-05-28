---
phase: 164
slug: close-gap-document-repair-and-plugin-reconciliation-lock-con
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-27
---

# Phase 164 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + directed scenario runner |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts tests/unit/plugin-reconciliation.test.ts tests/unit/resolve-document.test.ts tests/unit/record-tools.test.ts` |
| **Full suite command** | `FQC_LOCK_ASSERT=true npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/memory-no-coarse-lock.integration.test.ts tests/integration/records-reconciliation.integration.test.ts tests/integration/unregister-plugin-races.integration.test.ts` |
| **Estimated runtime** | ~120 seconds for focused unit checks; integration runtime depends on `.env.test` Supabase availability |

---

## Sampling Rate

- **After every task commit:** Run the quick focused unit command when touched files affect lock assertions, write primitives, or read-token behavior.
- **After every plan wave:** Run the full focused command set if `.env.test` is configured; otherwise record skipped integration tests and the missing environment reason.
- **Before `$gsd-verify-work`:** Focused unit checks must be green. Focused integration checks must be green or explicitly skipped by the existing test-env guard.
- **Max feedback latency:** 120 seconds for the quick loop.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 164-01-01 | 01 | 1 | REQ-001, REQ-007, REQ-009, REQ-014, REQ-020 | T-164-01 | Repair writes cannot bypass ambient document/folder lock assertions | unit + integration | `FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts tests/unit/plugin-reconciliation.test.ts` | ✅ | ✅ green 2026-05-28 |
| 164-02-01 | 02 | 1 | REQ-020, REQ-023 | T-164-02 | Plugin reconciliation frontmatter writes cannot bypass ambient document/folder lock assertions | unit + integration | `FQC_LOCK_ASSERT=true npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/memory-no-coarse-lock.integration.test.ts tests/integration/records-reconciliation.integration.test.ts tests/integration/unregister-plugin-races.integration.test.ts` | ✅ | ✅ green 2026-05-28 |
| 164-03-01 | 03 | 2 | REQ-014 | T-164-03 | Post-repair token/hash/disk consistency survives lock-contract changes | integration + directed | `python3 tests/scenarios/directed/run_suite.py --managed read_triggered_repair_token` | ✅ | ✅ green 2026-05-28 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | — | — | All phase behaviors should have automated unit, integration, or directed scenario coverage. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

## Final Evidence

| Evidence | Result | Notes |
|----------|--------|-------|
| `FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts tests/unit/plugin-reconciliation.test.ts tests/unit/resolve-document.test.ts tests/unit/record-tools.test.ts` | PASS | 6 files, 74 tests |
| `npm test -- tests/unit/no-coarse-resource-locks.test.ts` | PASS | 1 file, 1 test |
| `npm run typecheck` | PASS | `tsc --noEmit` |
| `FQC_LOCK_ASSERT=true npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts tests/integration/atomic-write-frontmatter.integration.test.ts tests/integration/memory-no-coarse-lock.integration.test.ts tests/integration/records-reconciliation.integration.test.ts tests/integration/unregister-plugin-races.integration.test.ts` | PASS | 5 files, 10 tests; embedding warnings expected because `.env.test` has no semantic provider key |
| `python3 tests/scenarios/directed/run_suite.py --managed read_triggered_repair_token` | PASS | D-WCO-06, 1 test, 3/3 steps; report `tests/scenarios/directed/reports/scenario-report-2026-05-28-004501.md` |

## Final Source Audit

| Source Item | Coverage |
|-------------|----------|
| GOAL: close document repair and plugin reconciliation lock-contract gaps | Covered by `164-01-SUMMARY.md`, `164-02-SUMMARY.md`, unit lock-order guards, focused integration, and D-WCO-06 |
| REQ-001 | Covered by read/repair lock-free versus write-locked behavior in T-U-037 and T-I-026/T-I-027 |
| REQ-007 | Covered by shared ancestor directory locks around document repair and plugin reconciliation frontmatter writes |
| REQ-009 | Covered by document lock ordering before `writeVaultFile` and `atomicWriteFrontmatter` |
| REQ-014 | Covered by token/hash/disk equality in T-I-026, T-I-027, T-I-028, and D-WCO-06 |
| REQ-020 | Covered by single durable write primitive guard T-U-030 and lock assertion integration |
| REQ-023 | Covered by T-I-043 memory convergence, T-I-044 records/reconciliation including same-file race, and T-I-045 unregister race |
| D-01 | No macro-level lock behavior added; implementation is limited to repair/reconciliation write side effects |
| D-02 | Cache-hit `get_document` branch remains lock-free and bypasses `targetedScan` |
| D-03 | `targetedScan` only acquires document-path locks when `frontmatterChanged` triggers a repair write |
| D-04 | Version token model unchanged; repaired raw bytes remain the source of returned `version_token` |
| D-05 | Plugin coordination locks remain scoped to records sequencing; document locks wrap only markdown frontmatter writes |
| D-06 | `writeVaultFile` and `atomicWriteFrontmatter` remain primitive-only; locks are caller-owned |
| D-07 | D-WCO-06 remains current and passed in managed mode |

No deferred ideas were implemented: no macro-level lock behavior, no server-side session state, no opt-in version-token model change, and no lock subsystem rewrite beyond repair/reconciliation gaps.

**Approval:** passed 2026-05-28
