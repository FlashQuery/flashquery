---
phase: 158
slug: tier-2-lock-table-retirement-session-check
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 158 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7 |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- --testNamePattern "advisory-lock\|lock-startup\|legacy-write-lock"` |
| **Full suite command** | `npm run typecheck && npm run build && npm test` |
| **Estimated runtime** | ~30 seconds for unit suite; ~185 seconds for Phase 158 integration selection with `.env.test` |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck` plus the directly affected Phase 158 unit test file.
- **After every plan wave:** Run all Phase 158 unit files and the affected Phase 158 integration file when `.env.test` is configured.
- **Before `$gsd-verify-work`:** Full Phase 158 evidence commands must be green or explicitly documented as skipped due to missing `.env.test`.
- **Max feedback latency:** 180 seconds for unit/type/build checks; integration latency depends on test Supabase.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 158-01-01 | 01 | 1 | REQ-002 | T-158-01 | Advisory-lock SQL uses `$1::bigint` parameterization and releases in `finally` on the owning `PoolClient`. | unit | `npm test -- tests/unit/document-lock-tier1.test.ts tests/unit/document-lock-tier2.test.ts` | ✅ | ✅ green |
| 158-01-02 | 01 | 1 | REQ-002 | T-158-02 | Cross-process same-file writers serialize through session-scoped advisory locks. | integration | `npm run test:integration -- tests/integration/two-tier-lock.integration.test.ts` | ✅ | ✅ green |
| 158-02-01 | 02 | 1 | REQ-004 | T-158-03 | Legacy table/CLI removal leaves no production dependency on `fqc_write_locks` or manual unlock. | unit/static | `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts` | ✅ | ✅ green |
| 158-02-02 | 02 | 1 | REQ-004 | T-158-04 | Startup drops legacy `fqc_write_locks`; legacy `locking.ttl_seconds` is ignored with one warning. | integration | `npm run test:integration -- tests/integration/fqc-write-locks-drop.integration.test.ts` | ✅ | ✅ green |
| 158-03-01 | 03 | 2 | REQ-005 | T-158-05 | Startup fails closed when database session capability cannot be proven. | unit/integration | `npm test -- tests/unit/lock-startup-self-test.test.ts && npm run test:integration -- tests/integration/lock-startup.integration.test.ts` | ✅ | ✅ green |
| 158-04-01 | 04 | 3 | REQ-004 | T-158-08 | Stale lock-behavior tests no longer depend on the deleted table-lock service. | unit/integration | `npm test -- tests/unit/manage-directory.test.ts tests/unit/archive-document.test.ts tests/unit/document-batch-lock-contention.test.ts && npm run test:integration -- tests/integration/archive-document-lock.test.ts tests/integration/macro-write-lock.integration.test.ts tests/integration/manage-directory.integration.test.ts` | ✅ | ✅ green |
| 158-05-01 | 05 | 3 | REQ-004 | T-158-09 | Config/schema tests and fixtures no longer treat `fqc_write_locks` or effective TTL as active behavior. | unit/integration | `npm test -- tests/unit/config.test.ts tests/unit/schema-verify.test.ts tests/unit/no-legacy-write-lock-imports.test.ts && npm run test:integration -- tests/integration/supabase-schema-verify.test.ts tests/integration/supabase.test.ts` | ✅ | ✅ green |
| 158-06-01 | 06 | 3 | REQ-004 | T-158-11 | Phase 157 gap-fix tests retain scoped plugin coordination coverage without legacy write-lock mocks. | unit | `npm test -- tests/unit/advanced-document-tools.test.ts tests/unit/plugin-tools.test.ts tests/unit/record-tools.test.ts tests/unit/no-coarse-resource-locks.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/document-lock-tier1.test.ts` — T-U-003 / REQ-002.
- [x] `tests/unit/document-lock-tier2.test.ts` — T-U-004 and T-U-005 / REQ-002.
- [x] `tests/unit/no-legacy-write-lock-imports.test.ts` — T-U-011 / REQ-004.
- [x] `tests/unit/lock-startup-self-test.test.ts` — T-U-012 and T-U-013 / REQ-005.
- [x] `tests/integration/two-tier-lock.integration.test.ts` — T-I-003 and T-I-004 / REQ-002; skips advisory-lock assertions when `.env.test` points at a transaction-pooler URL.
- [x] `tests/integration/fqc-write-locks-drop.integration.test.ts` — T-I-005 and T-I-006 / REQ-004.
- [x] `tests/integration/lock-startup.integration.test.ts` — T-I-007 and T-I-008 / REQ-005.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Supabase dashboard pooler mode selection | REQ-005 | The local repo cannot inspect a user's dashboard-selected endpoint mode. | Confirm docs tell users to use direct or session-capable Postgres URLs and warn that transaction pooler URLs fail startup. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s for unit/type/build checks
- [x] `nyquist_compliant: true` set in frontmatter

## Validation Audit 2026-05-26

| Metric | Count |
|--------|-------|
| Gaps found | 2 |
| Resolved | 2 |
| Escalated | 0 |

- Added runtime session-capability guards to advisory-lock integrations that require direct/session-mode Postgres semantics. The current `.env.test` URL points at a transaction-pooler endpoint, which REQ-005 correctly treats as unsafe.
- Removed residual legacy write-lock mocks from older unit/integration tests so the deleted `src/services/write-lock.ts` module is not required by the broad suite.

**Fresh evidence:** `npm test` passed 165 files / 2072 tests; `npm run typecheck` passed; `npm run build` passed; Phase 158 integration selection passed 7 files / 23 tests.

**Approval:** approved 2026-05-26
