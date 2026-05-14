---
phase: 130
slug: foundation-metadata-broker-shim-archive-lock
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 130 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- --run tests/unit/response-formats.test.ts tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts tests/unit/mcp-broker.test.ts tests/unit/archive-document.test.ts` |
| **Full suite command** | `npm test && npm run test:integration -- --run tests/integration/archive-document-lock.test.ts` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused unit test command for changed files.
- **After every plan wave:** Run `npm test` plus the focused archive lock integration test if added.
- **Before `$gsd-verify-work`:** `npm run build`, `npm test`, and focused integration coverage must be green or explicitly skipped for missing `.env.test`.
- **Max feedback latency:** 120 seconds for focused feedback.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 130-01-01 | 01 | 1 | MACRO-RESP-01, MACRO-RESP-02, MACRO-RESP-03, MACRO-RESP-04, MACRO-OBS-01 | T-130-01 | Macro payload helpers are additive and do not alter existing response helpers. | unit | `npm test -- --run tests/unit/response-formats.test.ts` | ✅ | ⬜ pending |
| 130-01-02 | 01 | 1 | MACRO-INT-05 | T-130-02 | `call_macro` is admin-tier and delegated-hard-excluded. | unit | `npm test -- --run tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts` | ✅ | ⬜ pending |
| 130-01-03 | 01 | 1 | MACRO-INT-06 | T-130-03 | `NullMcpBroker` never exposes unavailable brokered tools. | unit | `npm test -- --run tests/unit/mcp-broker.test.ts` | ❌ W0 | ⬜ pending |
| 130-02-01 | 02 | 1 | MACRO-INT-03 | T-130-04 | `archive_document` serializes document writes through the standard lock and preserves conflict semantics. | unit + integration | `npm test -- --run tests/unit/archive-document.test.ts && npm run test:integration -- --run tests/integration/archive-document-lock.test.ts` | partial | ⬜ pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/mcp-broker.test.ts` — covers `NullMcpBroker`.
- [ ] `tests/unit/archive-document.test.ts` or an existing document-tool unit suite — covers archive lock acquisition, release, and timeout conflict.
- [ ] `tests/integration/archive-document-lock.test.ts` — covers archive lock behavior if deterministic integration setup is feasible.
- [ ] `tests/config/vitest.integration.config.ts` — includes any new integration test file.

---

## Manual-Only Verifications

All Phase 130 behaviors should have automated verification. If `.env.test` is unavailable or incomplete, integration tests may skip gracefully per project convention; record that skip in the phase summary.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 120 seconds for focused checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
