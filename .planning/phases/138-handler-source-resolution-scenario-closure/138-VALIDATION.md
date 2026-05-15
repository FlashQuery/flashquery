---
phase: 138
slug: handler-source-resolution-scenario-closure
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-15
updated: 2026-05-15
---

# Phase 138 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + FlashQuery Python scenario runners |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, scenario runner config |
| **Quick run command** | `npm test -- --reporter=verbose macro-handler macro-source-ref macro-fence-extractor` |
| **Full suite command** | `npm run build && npm test -- --reporter=verbose macro && npm run test:integration -- --reporter=verbose macro` |
| **Estimated runtime** | ~120-300 seconds focused; scenario runners depend on Supabase and embeddings |

## Sampling Rate

- **After every task commit:** Run the plan's focused unit or integration command.
- **After every plan wave:** Run `npm run build` plus the focused macro test command for that wave.
- **Before `$gsd-verify-work`:** Focused unit, integration, E2E, directed scenario, YAML scenario, and POC fixture validation must be green or explicitly skipped for missing external credentials.
- **Max feedback latency:** 5 minutes for focused checks.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 138-01-01 | 01 | 0 | MACRO-SRC-01 | T-138-01-01 | Handler schema rejects unsupported source/task shape | unit | `npm test -- --reporter=verbose macro-handler macro-source-ref` | ✅ | ✅ green |
| 138-01-02 | 01 | 0 | MACRO-SRC-02 | T-138-01-02 | Invalid source combinations return expected envelopes without execution | unit | `npm test -- --reporter=verbose macro-handler macro-source-ref` | ✅ | ✅ green |
| 138-02-01 | 02 | 1 | MACRO-SRC-03 | T-138-02-01 | Source references use document resolver and vault-local reads | unit/integration | `npm run test:integration -- --reporter=verbose macro-source-ref` | ✅ | ✅ green |
| 138-02-02 | 02 | 1 | MACRO-SRC-04 | T-138-02-02 | Archived macro docs are hidden as `not_found` | integration | `npm run test:integration -- --reporter=verbose macro-source-ref` | ✅ | ✅ green |
| 138-03-01 | 03 | 2 | MACRO-INT-02 | T-138-03-01 | Macro writes inherit existing write locks; macro engine adds no lock bypass | integration/scenario | `npm run test:integration -- --reporter=verbose macro-write-lock` | ✅ | ✅ green |
| 138-03-02 | 03 | 2 | MACRO-SRC-01..04 | T-138-03-02 | Real MCP transport returns canonical success/dry-run/error/progress behavior | e2e | `npx vitest run tests/e2e/macro-call-macro.test.ts` | ✅ | ✅ green |
| 138-04-01 | 04 | 3 | MACRO-SRC-01..04, MACRO-INT-02 | T-138-04-01 | Scenario matrices and 17 POC fixtures prove public workflows | scenario | scenario runner commands in Plan 04 | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Plan 01 adds missing handler/source-ref contract tests before production source_ref implementation.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | N/A | N/A | All phase behaviors must have automated verification or credential-based scenario skips. |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5 minutes for focused checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-15 validation audit

## Validation Audit 2026-05-15

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Rerun evidence:
- `npm test -- --run tests/unit/macro-handler.test.ts tests/unit/macro-source-ref.test.ts tests/unit/macro-fence-extractor.test.ts tests/unit/macro-poc-fixtures.test.ts ...`: included in macro validation slice, 21 files passed / 244 tests passed.
- `npm run test:integration -- --run tests/integration/macro-source-ref.integration.test.ts tests/integration/macro-write-lock.integration.test.ts ...`: included in macro integration slice, 4 files passed / 11 tests passed / 1 expected ACL skip.
- `npm run test:e2e -- --run tests/e2e/macro-call-macro.test.ts`: 1 file passed / 4 tests passed.
