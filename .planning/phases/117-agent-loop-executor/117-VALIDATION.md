---
phase: 117
slug: agent-loop-executor
status: green
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-06
---

# Phase 117 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 for TypeScript unit/E2E tests; Python 3.12.3 for directed scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool.test.ts` |
| **Full suite command** | `npm test && npm run test:e2e && npm run build` plus Phase 117 directed scenario commands |
| **Estimated runtime** | ~120 seconds for focused unit tests; full suite depends on integration environment |

---

## Sampling Rate

- **After every task commit:** Run the focused unit command for touched files.
- **After every plan wave:** Run `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts` plus the relevant directed scenario.
- **Before `$gsd-verify-work`:** `npm test`, `npm run test:e2e`, `npm run build`, and all Phase 117 directed scenarios with `--managed` must be green or explicitly documented if environment-gated.
- **Max feedback latency:** 180 seconds for focused verification.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 117-W0-01 | 01 | 0 | LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07 | T-117-02 / T-117-04 / T-117-05 | Loop state machine has deterministic tests before wiring into `call_model` | unit | `npm test -- tests/unit/llm-agent-loop.test.ts` | yes | green |
| 117-W0-02 | 01 | 0 | TOOL-05, TOOL-06 | T-117-01 / T-117-02 / T-117-03 | Dispatcher validates per-call registry and serializes tool result/error messages | unit | `npm test -- tests/unit/llm-tool-dispatcher.test.ts` | yes | green |
| 117-W0-03 | 01 | 0 | VAL-117 | T-117-04 / T-117-05 | Mock provider can script tool calls, fallback, budgets, and request capture | e2e | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` | yes | green |
| 117-W0-04 | 01 | 0 | VAL-117 | T-117-01 / T-117-04 / T-117-05 | Public scenarios prove native loop, budget stops, and aggregate usage metadata | directed | `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py --managed` | yes | green |
| 117-01 | 01 | 0 | LOOP-01, LOOP-02, TOOL-05, TOOL-06 | T-117-01 / T-117-02 / T-117-03 | Non-empty native registry triggers Mode 2 and dispatches only exposed native tools | unit + e2e | `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts` | yes | green |
| 117-02 | 02 | 1 | LOOP-03 | T-117-04 | Same-turn tool calls use all-settled semantics and preserve sibling successes | unit + e2e | `npm test -- tests/unit/llm-agent-loop.test.ts` | yes | green |
| 117-03 | 03 | 2 | LOOP-04 | T-117-04 | Guardrails stop before next model call with correct `stop_reason` | unit + directed | `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py --managed` | yes | green |
| 117-04 | 04 | 3 | LOOP-05 | T-117-05 | Purpose fallback can occur mid-loop while preserving completed conversation history | unit + e2e | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` | yes | green |
| 117-05 | 05 | 4 | LOOP-06, LOOP-07 | T-117-05 | Mode 2 writes one aggregate usage row and calls-log token sums equal aggregate tokens | unit + directed | `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py --managed` | yes | green |
| 117-06 | 05 | 4 | VAL-117 | T-117-01 through T-117-05 | Coverage matrices record new ATL scenario rows and commands | docs + scenario | `rg \"ATL-DS-09|ATL-DS-12|ATL-DS-13|VAL-117\" tests/scenarios/directed/DIRECTED_COVERAGE.md` | yes | green |

*Status: pending / green / red / flaky*

---

## Threat References

| Threat Ref | Threat | Required Control |
|------------|--------|------------------|
| T-117-01 | Delegated model attempts recursive `call_model` or an unexposed/admin tool | Dispatch only against immutable per-call registry and preserve Phase 116 hard exclusions |
| T-117-02 | Tool-call arguments bypass validation | Validate arguments against registered schemas before invoking handlers |
| T-117-03 | Tool result or argument containing `{{ref:...}}` causes unintended hydration | Never run host reference hydration on model-produced tool args or tool results |
| T-117-04 | Retry spiral after tool errors consumes excessive tokens/cost | Enforce timeout, max iterations, token budget, and cost budget before each next model call |
| T-117-05 | Usage undercounting or duplicate accounting after multi-round loop/fallback | Avoid per-iteration usage rows and write exactly one aggregate row through `recordLlmUsage()` |

---

## Wave 0 Requirements

- [x] `tests/unit/llm-agent-loop.test.ts` - passing tests for ATL-U-13, ATL-U-14, LOOP-01 through LOOP-07.
- [x] `tests/unit/llm-tool-dispatcher.test.ts` - passing tests for TOOL-05, TOOL-06, dispatcher validation, and CG-4 result/error payloads.
- [x] `tests/e2e/call-model-agent-loop.e2e.test.ts` - deterministic mock provider coverage for ATL-E2E-02, ATL-E2E-03, ATL-E2E-06, ATL-E2E-07.
- [x] `tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py` - directed public native loop scenario for ATL-DS-09.
- [x] `tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py` - directed public guardrail scenario for ATL-DS-12.
- [x] `tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py` - directed public usage/calls-log scenario for ATL-DS-13.
- [x] Coverage rows added to `tests/scenarios/directed/DIRECTED_COVERAGE.md`.

## VAL-117 Notes

Final validation is green as of 2026-05-06. The gate covers the ATL Test Plan blocker cases: caller-provided tools rejection / deferred Mode 3, cooperative shutdown, provider error stop, dispatch-time timeout with AbortSignal propagation, zero public usage rows when no iteration completes, input/output estimate ladder coverage, per-model fallback cost, and `metadata.tools.calls_log` token arithmetic against top-level `metadata.tokens`.

No database DDL validation is listed for Phase 117. Mode 2 uses the existing aggregate usage path through `recordLlmUsage()` and keeps iteration detail in the response envelope only.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Supabase-backed usage-row checks may skip gracefully when `.env.test` or the test database is unavailable, but the plan must still include runnable commands.

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target < 180s for focused verification.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** green
