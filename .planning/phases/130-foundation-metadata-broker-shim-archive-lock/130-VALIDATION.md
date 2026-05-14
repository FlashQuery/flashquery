---
phase: 130
slug: foundation-metadata-broker-shim-archive-lock
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-14
updated: 2026-05-14
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
| **Full suite command** | `npm run build && npm run lint && npm test && npm run test:integration && npm run test:e2e` |
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
| 130-01-01 | 01 | 1 | MACRO-RESP-01, MACRO-RESP-02, MACRO-RESP-03, MACRO-RESP-04, MACRO-OBS-01 | T-130-01 | Macro payload helpers are additive and do not alter existing response helpers. | unit | `npm test -- --run tests/unit/response-formats.test.ts` | ✅ | green |
| 130-01-02 | 01 | 1 | MACRO-INT-05 | T-130-02 | `call_macro` is admin-tier and delegated-hard-excluded. | unit | `npm test -- --run tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts tests/unit/llm-tool-registry.test.ts` | ✅ | green |
| 130-01-03 | 01 | 1 | MACRO-INT-06 | T-130-03 | `NullMcpBroker` never exposes unavailable brokered tools. | unit | `npm test -- --run tests/unit/mcp-broker.test.ts` | ✅ | green |
| 130-02-01 | 02 | 1 | MACRO-INT-03 | T-130-04 | `archive_document` serializes document writes through the standard lock, preserves conflict semantics, rolls back vault frontmatter on DB update failure, and returns canonical single-item expected errors. | unit + integration | `npm test -- --run tests/unit/archive-document.test.ts && npm run test:integration -- --run tests/integration/archive-document-lock.test.ts` | ✅ | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/mcp-broker.test.ts` — covers `NullMcpBroker`.
- [x] `tests/unit/archive-document.test.ts` — covers archive lock acquisition, release, timeout conflict, DB-failure rollback, and single expected-error envelope behavior.
- [x] `tests/integration/archive-document-lock.test.ts` — covers archive/remove shared lock behavior with deterministic held-lock setup.
- [x] `tests/config/vitest.integration.config.ts` — includes the new integration test file.

---

## Automated Validation Results

| Gate | Command | Result |
|------|---------|--------|
| Build | `npm run build` | PASS |
| Lint | `npm run lint` | PASS |
| Unit suite | `npm test` | PASS — 93 files, 1465 tests |
| Integration suite | `npm run test:integration` | PASS — 6 files, 15 tests, using `.env.test` credentials |
| E2E suite | `npm run test:e2e` | PASS — 7 files, 66 tests |
| Code review | `gsd-code-review 130` standard-depth equivalent | PASS — `130-REVIEW.md` status `clean`, 13 files reviewed, 0 findings |
| Phase verification | `gsd-verifier` equivalent | PARTIAL/HUMAN — `130-VERIFICATION.md` status `human_needed`, 8/9 truths verified |

## Manual-Only Verifications

All Phase 130 code behaviors have automated verification. One process-audit item remains manual-only:

- Confirm from executor logs/transcript that Phase 130 implementation agents read the canonical Macro Language requirements and test plan before editing files. This cannot be proven from repository state; it is tracked in `130-HUMAN-UAT.md`.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 120 seconds for focused checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** complete for automated Nyquist coverage; human process-audit item tracked separately.

## Validation Audit 2026-05-14

| Metric | Count |
|--------|-------|
| Requirements mapped | 8 |
| Task rows audited | 4 |
| Automated coverage rows green | 4 |
| Gaps found | 0 |
| Resolved | 0 |
| Escalated/manual-only | 1 process-audit item |

Phase 130 is Nyquist-compliant for code-level behavior. The remaining manual-only item is not a missing test for product behavior; it is an auditability limitation about proving agent read order from repository artifacts.
