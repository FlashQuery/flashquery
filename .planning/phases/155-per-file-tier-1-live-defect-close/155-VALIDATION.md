---
phase: 155
slug: per-file-tier-1-live-defect-close
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-26
---

# Phase 155 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest unit/integration; directed Python scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/scenarios/directed/WRITING_SCENARIOS.md` |
| **Quick run command** | `npm test -- --grep "document-lock|with-document-lock|macro-no-lock"` |
| **Full suite command** | `npm run test:integration -- --grep "per-file|apply-tags|insert-doc-link|call-macro-per-step"` |
| **Estimated runtime** | ~180 seconds without directed scenarios; environment-dependent with Supabase |

## Sampling Rate

- **After every task commit:** Run the quick command or the task-specific unit command.
- **After every plan wave:** Run the relevant integration command for that plan.
- **Before `$gsd-verify-work`:** Unit, integration, and required directed scenario evidence must be green or explicitly blocked by missing external credentials/infrastructure.
- **Max feedback latency:** 5 minutes for targeted local gates.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 155-01-01 | 01 | 1 | REQ-001, REQ-009 | T-155-01, T-155-03 | Lock keys come from resolved paths; stripe registry is bounded. | unit | `npm test -- tests/unit/document-lock-registry.test.ts tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts` | ✅ present | ✅ green |
| 155-01-02 | 01 | 1 | REQ-001, REQ-009 | T-155-02 | Scanner repair writes participate in the per-file helper. | unit/static | `npm test -- tests/unit/scanner.test.ts` | ✅ present | ✅ green |
| 155-02-01 | 02 | 2 | REQ-001, REQ-010 | T-155-02 | Document and compound write call sites re-read inside per-file locks. | unit/integration | targeted document/compound lock slices and directed scenarios | ✅ present | ✅ green |
| 155-02-02 | 02 | 2 | REQ-025 | T-155-04 | Macro layer has no direct lock and documents per-step locking. | unit/integration | `npm test -- tests/unit/macro-no-lock-imports.test.ts`; D-WCO-08 | ✅ present | ✅ green |
| 155-03-01 | 03 | 3 | REQ-001, REQ-010, REQ-025 | T-155-02, T-155-04 | Public MCP scenarios prove same-process lock behavior and macro per-step behavior. | directed | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_per_file_lock_parallel.py test_apply_tags_no_lost_update.py test_parallel_macros_per_file_lock.py` | ✅ present | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [x] `tests/unit/document-lock-registry.test.ts` - T-U-001, T-U-002, plus Phase-155 basic key scaffolding coverage from Test Plan §4.1.3 without claiming full REQ-003.
- [x] `tests/unit/with-document-lock.test.ts` - T-U-016, T-U-017, T-U-018.
- [x] `tests/unit/lock-helper-only.test.ts` - T-U-019.
- [x] `tests/unit/macro-no-lock-imports.test.ts` - T-U-038.
- [x] `tests/integration/per-file-lock.test.ts` - T-I-001, T-I-002.
- [x] `tests/integration/apply-tags-concurrent.integration.test.ts` - T-I-017.
- [x] `tests/integration/insert-doc-link-race.integration.test.ts` - T-I-018.
- [x] `tests/integration/call-macro-per-step-lock.integration.test.ts` - T-I-049, T-I-050, T-I-051.
- [x] Directed scenarios D-WCO-01, D-WCO-04, and D-WCO-08, authored with `enable_locking=True` and verified with `--strict-cleanup`.

## Manual-Only Verifications

All phase behaviors have automated verification. If Supabase-backed integration or directed runs skip because `.env.test` is unavailable, the executor must record the exact skip gate in the SUMMARY and run all deterministic unit/static checks.

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency < 5 minutes for targeted gates.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** verified
