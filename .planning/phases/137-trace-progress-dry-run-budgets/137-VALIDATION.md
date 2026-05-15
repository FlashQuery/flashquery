---
phase: 137
slug: trace-progress-dry-run-budgets
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-14
---

# Phase 137 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest unit tests; Python directed scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/scenarios/directed/WRITING_SCENARIOS.md` |
| **Quick run command** | `npm test -- --reporter=verbose macro-trace macro-progress macro-envelopes macro-warnings macro-budget macro-handler` |
| **Full suite command** | `npm test -- --reporter=verbose macro-trace macro-progress macro-envelopes macro-warnings macro-budget macro-handler macro-builtins macro-isolation macro-cancellation macro-task-registry && npm run build` |
| **Handler fallback integration** | `npm run test:integration -- macro-call-macro-session` when `.env.test` is available after any `src/mcp/tools/macro.ts` edit |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the narrow Vitest command for the changed module.
- **After every plan wave:** Run the full suite command above; include the handler fallback integration command after waves that touch `src/mcp/tools/macro.ts` when `.env.test` is available.
- **Before `$gsd-verify-work`:** Full suite must be green; directed scenarios added in this phase must also pass or be explicitly skipped for missing environment.
- **Max feedback latency:** 120 seconds for unit/build feedback.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 137-TBD-trace | 137-01/02 | 0/1 | MACRO-OBS-02 | T-137-01-01, T-137-02-01, T-137-02-02 | Trace modes avoid leaking omitted args/results and cap large values | unit | `npm test -- --reporter=verbose macro-trace macro-warnings` | W0 | green |
| 137-TBD-progress | 137-01/03 | 0/2 | MACRO-OBS-03, MACRO-INT-07 | T-137-01-02, T-137-03-01, T-137-03-02, T-137-03-04 | Progress emits only when allowed by token/mode and remains per invocation | unit | `npm test -- --reporter=verbose macro-progress macro-handler macro-builtins` | W0 | green |
| 137-TBD-dry-run | 137-01/04 | 0/3 | MACRO-RESP-05 | T-137-01-03, T-137-04-01 | Dry-run runs pre-flight checks and executes no side effects | unit | `npm test -- --reporter=verbose macro-envelopes macro-handler` | W0 | green |
| 137-TBD-budget | 137-01/04 | 0/3 | MACRO-INT-04 | T-137-01-04, T-137-04-02, T-137-04-03, T-137-04-04 | Budget caps halt execution before/after the correct boundary | unit | `npm test -- --reporter=verbose macro-budget macro-isolation macro-cancellation` | W0 | green |
| 137-TBD-session-fallback | 137-03/04 | 2/3 | MACRO-INT-07, MACRO-INT-04 | T-137-03-02, T-137-04-04 | Handler edits preserve registration-scoped fallback sessions and task visibility isolation | integration | `npm run test:integration -- macro-call-macro-session` | existing | green |
| 137-TBD-scenarios | 137-05 | 4 | MACRO-OBS-02, MACRO-OBS-03, MACRO-INT-04 | T-137-05-01, T-137-05-02, T-137-05-03, T-137-05-04 | Public MCP scenarios prove trace/progress/budget behavior | directed | `python3 tests/scenarios/directed/run_suite.py --managed test_macro_trace_full_summary_none test_macro_progress_milestones test_macro_budget_timeout` | W0 | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] Extend `tests/unit/macro-trace.test.ts` for `T-U-187`, `T-U-188`, `T-U-189`, `T-U-190`, and `T-U-193`.
- [x] Add `tests/unit/macro-progress.test.ts` for `T-U-194` through `T-U-198`.
- [x] Add `tests/unit/macro-budget.test.ts` for `T-U-211` through `T-U-215`.
- [x] Add `tests/unit/macro-warnings.test.ts` for `T-U-209`, `T-U-210`, and `progress_throttled` warning behavior if implemented.
- [x] Add or extend `tests/unit/macro-handler.test.ts` for `T-U-233` and `T-U-234`.
- [x] Add directed scenario rows/files for `T-S-016`, `T-S-017`, and `T-S-018` using non-colliding `ML-*` coverage IDs.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None planned | N/A | All phase behaviors have automated unit or directed scenario coverage | N/A |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references from the Test Plan rows above.
- [x] No watch-mode flags.
- [x] Feedback latency < 120s for focused unit/build feedback.
- [x] `nyquist_compliant: true` set in frontmatter after Wave 0 and execution validation are complete.

**Approval:** passed

## Final Validation Evidence

| Command | Status | Notes |
|---------|--------|-------|
| `npm test -- --reporter=verbose macro-trace macro-progress macro-envelopes macro-warnings macro-budget macro-handler macro-builtins macro-isolation macro-cancellation macro-task-registry config` | PASS | 181 tests across 14 files passed. |
| `npm run build` | PASS | ESM and DTS builds succeeded. |
| `npm run test:integration -- macro-call-macro-session` | PASS | 2 integration tests passed with `.env.test` credentials. |
| `python3 tests/scenarios/directed/run_suite.py --managed test_macro_trace_full_summary_none test_macro_progress_milestones test_macro_budget_timeout` | PASS | 3/3 directed scenarios passed. Shared DB table cleanup emitted timeout warnings before/after scenarios, but scenario results were green. Latest report after code-review fixes: `tests/scenarios/directed/reports/scenario-report-2026-05-14-235047.md`. |
| `npm test` | PASS | Full unit suite passed: 121 files, 1744 tests. |
