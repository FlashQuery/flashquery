---
phase: 84
slug: schema-parsing-policy-infrastructure
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
verified: 2026-04-20
---

# Phase 84 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.1 |
| **Config file** | `tests/config/vitest.unit.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 84-01-01 | 01 | 1 | SCHEMA-01, SCHEMA-02 | — | N/A | unit | `npm test` | ✅ | ✅ green |
| 84-01-02 | 01 | 1 | SCHEMA-03 | — | N/A | unit | `npm test` | ✅ | ✅ green |
| 84-01-03 | 01 | 1 | SCHEMA-04 | — | N/A | unit | `npm test` | ✅ | ✅ green |
| 84-01-04 | 01 | 1 | SCHEMA-06 | — | N/A | unit | `npm test` | ✅ | ✅ green |
| 84-02-01 | 02 | 1 | SCHEMA-05 | — | N/A | unit | `npm test` | ✅ | ✅ green |
| 84-02-02 | 02 | 1 | TEST-01 | — | N/A | unit | `npm test` | ✅ | ✅ green |
| 84-02-03 | 02 | 1 | TEST-02 | — | N/A | unit | `npm test` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/declarative-policies.test.ts` — 6 tests, all passing (SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04, TEST-01)
- [x] `tests/unit/global-type-registry.test.ts` — 4 tests, all passing (SCHEMA-05, TEST-02)
- [x] `tests/unit/plugin-manager.test.ts` updated to assert `last_seen_updated_at TIMESTAMPTZ` in implicit columns (SCHEMA-06)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| N/A | — | — | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-04-20 — 45/45 tests passing (declarative-policies: 6, global-type-registry: 4, plugin-manager: 35)
