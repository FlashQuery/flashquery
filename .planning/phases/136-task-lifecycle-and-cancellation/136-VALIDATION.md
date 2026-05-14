---
phase: 136
slug: task-lifecycle-and-cancellation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-14
---

# Phase 136 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x for unit/integration; Python directed scenario runner for MCP scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`; `tests/scenarios/directed/run_suite.py` |
| **Quick run command** | `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope` |
| **Full suite command** | `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope && npm run test:integration -- --reporter=verbose macro-concurrency && python3 tests/scenarios/directed/run_suite.py --managed test_macro_cancellation test_macro_no_partial_side_effects_after_cancel && npm run build` |
| **Estimated runtime** | ~90 seconds for focused unit tests; integration/scenario runtime depends on `.env.test` and managed server startup |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope` once the unit files exist.
- **After every plan wave:** Run `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope && npm run test:integration -- --reporter=verbose macro-concurrency`.
- **Before `$gsd-verify-work`:** Focused unit tests, macro concurrency integration, directed cancellation scenarios, and `npm run build` must be green or documented as environment-skipped by existing test helpers.
- **Max feedback latency:** 120 seconds for automated focused feedback.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 136-01-01 | 01 | 0 | MACRO-OBS-04 | — | Task records enter `working`, transition to terminal vocabulary states, and are removed immediately without persistence | unit | `npm test -- --reporter=verbose macro-task-registry` | ✅ | ✅ green |
| 136-01-02 | 01 | 0 | MACRO-OBS-05 | V4/Tampering | Cancellation is observed at all safe-point classes and emits canonical non-error envelope | unit | `npm test -- --reporter=verbose macro-cancellation` | ✅ | ✅ green |
| 136-01-03 | 01 | 0 | MACRO-OBS-06 | V3/V4 | `list_tasks` and `cancel` are scoped to the current session | unit | `npm test -- --reporter=verbose macro-session-scope` | ✅ | ✅ green |
| 136-02-01 | 02 | 1 | MACRO-OBS-04 | — | `runMacroSource` creates and cleans registry records on complete/fail/cancel | unit | `npm test -- --reporter=verbose macro-task-registry macro-cancellation` | ✅ | ✅ green |
| 136-02-02 | 02 | 1 | MACRO-OBS-05 | V4/Tampering | Tool-call cancellation check happens after arg evaluation and before dispatch; in-flight calls complete before cancellation is returned | unit | `npm test -- --reporter=verbose macro-cancellation` | ✅ | ✅ green |
| 136-03-01 | 03 | 2 | MACRO-INT-01 | V3/V4 | Concurrent simulated sessions do not leak variables, trace, tasks, budgets, progress, or cancellation state | integration | `npm run test:integration -- --reporter=verbose macro-concurrency` | ✅ | ✅ green |
| 136-03-02 | 03 | 2 | MACRO-OBS-05 | V4/Tampering | Directed cancellation scenarios prove managed-server cancellation and no post-cancel side effects | directed | `python3 tests/scenarios/directed/run_suite.py --managed test_macro_cancellation test_macro_no_partial_side_effects_after_cancel` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/macro-task-registry.test.ts` — T-U-172 through T-U-177 for REQ-049 / MACRO-OBS-04.
- [x] `tests/unit/macro-cancellation.test.ts` — T-U-178 through T-U-184 for REQ-050 / MACRO-OBS-05.
- [x] `tests/unit/macro-session-scope.test.ts` — T-U-185 and T-U-186 for REQ-051 / MACRO-OBS-06.
- [x] `tests/integration/macro-concurrency.test.ts` — T-I-002 for REQ-025/REQ-057 / MACRO-INT-01.
- [x] `tests/config/vitest.integration.config.ts` — explicit include entry for `tests/integration/macro-concurrency.test.ts`.
- [x] Directed coverage ID reconciliation for the Macro Test Plan's proposed `M-01`/`M-02` collision before adding cancellation scenario matrix rows. Phase 136 uses `MLC-01` and `MLC-02`; existing memory `M-01`/`M-02` rows remain unchanged.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Directed coverage ID reconciliation | MACRO-OBS-05 | Existing `DIRECTED_COVERAGE.md` already uses `M-01`/`M-02`; the executor must choose a non-conflicting matrix update path or document a product-doc follow-up | Inspect `tests/scenarios/directed/DIRECTED_COVERAGE.md` before editing; do not overwrite existing memory lifecycle rows |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all MISSING references.
- [x] No watch-mode flags.
- [x] Feedback latency < 120s for unit/integration/build gates; directed managed scenarios completed in 1m25s with 2/2 passing.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** complete

## Phase 136 Final Focused Gate Results

Recorded 2026-05-14 during Plan 136-04.

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| Focused unit | `npm test -- --reporter=verbose macro-task-registry macro-cancellation macro-session-scope` | PASS | 3 files / 17 tests passed. |
| Focused integration | `npm run test:integration -- --reporter=verbose macro-concurrency` | PASS | 1 file / 2 tests passed after integration setup build. |
| Directed cancellation | `python3 tests/scenarios/directed/run_suite.py --managed test_macro_cancellation test_macro_no_partial_side_effects_after_cancel` | PASS | 2/2 directed tests passed. The runner logged table cleanup timeout warnings before/between tests, but the suite exited 0 and did not skip cancellation. |
| Build | `npm run build` | PASS | tsup ESM and DTS builds completed successfully. |
