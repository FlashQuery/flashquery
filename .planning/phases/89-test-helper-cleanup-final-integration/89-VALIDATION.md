---
phase: 89
slug: test-helper-cleanup-final-integration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-21
---

# Phase 89 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run test:integration && npm run test:e2e` |
| **Estimated runtime** | ~60 seconds (unit), ~180 seconds (integration+e2e) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && npm run test:integration`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 89-01-01 | 01 | 1 | TEST-11 | — | N/A | unit | `npm test` | ✅ | ⬜ pending |
| 89-01-02 | 01 | 1 | TEST-11 | — | N/A | unit | `npm test` | ✅ | ⬜ pending |
| 89-02-01 | 02 | 2 | TEST-11 | — | N/A | integration | `npm run test:integration` | ❌ W0 | ⬜ pending |
| 89-02-02 | 02 | 2 | TEST-12 | — | N/A | integration | `npm run test:integration` | ✅ | ⬜ pending |
| 89-03-01 | 03 | 3 | TEST-11,TEST-12 | — | N/A | e2e | `npm run test:e2e` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements. No new test framework installation needed — vitest already installed, `.env.test` already configured.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
