---
phase: 120
slug: cross-phase-atl-validation-coverage-closure
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-07
---

# Phase 120 — Validation Strategy

> Per-phase validation contract for ATL milestone closure.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration/E2E; Python scenario runners for directed and YAML integration tests |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`, scenario managed config fixtures |
| **Quick run command** | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` |
| **Full suite command** | `npm run lint && npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts && npm run test:integration -- tests/integration/reference-resolver.integration.test.ts tests/integration/template-tools.integration.test.ts tests/integration/llm-config-sync.test.ts && npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages test_call_model_reference_system_core test_call_model_template_parameterization test_call_model_agent_loop_capabilities test_call_model_native_tool_registry test_call_model_agent_loop_native test_call_model_agent_loop_budgets test_call_model_agent_loop_usage test_call_model_template_discovery test_call_model_template_tool_conflicts test_call_model_agent_loop_template_tool test_call_model_agent_loop_mixed_tools test_discovery_resolvers test_call_model_help_resolver && npm run build` |
| **Estimated runtime** | Several minutes; managed scenarios and Supabase-backed tests dominate |

---

## Sampling Rate

- **After every task commit:** Run the focused command for the touched validation surface.
- **After every plan wave:** Run that wave's full ATL subset.
- **Before `$gsd-verify-work`:** Full ATL preflight must pass or record explicit environmental skips.
- **Max feedback latency:** keep focused commands under 5 minutes when possible.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 120-01-01 | 01 | 1 | VAL-120 | T-120-01 | Mode 1 and provider failure evidence remains deterministic and mock-provider based | e2e | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` | ✅ | ⬜ pending |
| 120-02-01 | 02 | 1 | VAL-120 | T-120-02 | YAML scenarios use public MCP behavior and managed cleanup | yaml integration | `python3 tests/scenarios/integration/run_integration.py --managed <atl-yaml-tests>` | ❌ W0 | ⬜ pending |
| 120-03-01 | 03 | 1 | VAL-120, TEST-04 | T-120-03 | Directed closure asserts public MCP JSON only and does not inspect private internals | directed | `python3 tests/scenarios/directed/run_suite.py --managed <atl-directed-tests>` | ✅ | ✅ green |
| 120-04-01 | 04 | 2 | TEST-04 | T-120-04 | Final audit records evidence and explicit skips without inventing missing phase artifacts | docs/audit | `rg -n "VAL-120|TEST-04|ATL-E2E|ATL-INT|ATL-DS|Phase 112|Phase 119" .planning/phases/120-cross-phase-atl-validation-coverage-closure tests/scenarios` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `.planning/phases/120-cross-phase-atl-validation-coverage-closure/120-CONTEXT.md` — canonical docs and downstream read-first rule.
- [x] `.planning/phases/120-cross-phase-atl-validation-coverage-closure/120-RESEARCH.md` — evidence map and gap analysis.
- [x] `.planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md` — validation strategy.

---

## Phase 120 Directed Evidence

| Command | Result | Report | Notes |
|---------|--------|--------|-------|
| `npm test -- tests/unit/reference-resolver.test.ts -t "even-parity active refs"` | PASS: 1/1 selected, 83 skipped | n/a | Added regression coverage for even-parity active reference hydration discovered during directed rerun. |
| `npm test -- tests/unit/reference-resolver.test.ts` | PASS: 84/84 | n/a | Confirms the reference resolver regression fix preserves existing parser, hydration, metadata, and template behavior. |
| `npm run build` | PASS | n/a | Rebuilt `dist/index.js` before managed Python scenarios, because `FQCServer` executes the compiled binary. |
| `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages test_call_model_reference_system_core test_call_model_template_parameterization` | PASS: 3/3, FAIL: 0, SKIP: 0 | `tests/scenarios/directed/reports/scenario-report-2026-05-07-012941.md` | Repaired legacy scenario model capability fixtures and verified ATL return-message, DRS, and template parameterization public behavior. |
| `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages test_call_model_reference_system_core test_call_model_template_parameterization test_call_model_agent_loop_capabilities test_call_model_native_tool_registry test_call_model_agent_loop_native test_call_model_agent_loop_budgets test_call_model_agent_loop_usage test_call_model_template_discovery test_call_model_template_tool_conflicts test_call_model_agent_loop_template_tool test_call_model_agent_loop_mixed_tools test_discovery_resolvers test_call_model_help_resolver` | PASS: 14/14, FAIL: 0, SKIP: 0 | `tests/scenarios/directed/reports/scenario-report-2026-05-07-014118.md` | Focused ATL directed suite passed without `test_call_model_agent_loop_shutdown`; shutdown is split because that scenario intentionally SIGTERMs the managed server. |
| `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_shutdown` | PASS: 1/1, FAIL: 0, SKIP: 0 | `tests/scenarios/directed/reports/scenario-report-2026-05-07-014240.md` | Closes L-90 with public MCP cooperative shutdown evidence: `stop_reason == "shutdown"`, `calls_log` preserved, completed-iteration tokens/cost retained. |

Notes:
- An invalid combined run that placed `test_call_model_agent_loop_shutdown` in the shared managed suite terminated the shared server as designed. Final evidence therefore records shutdown as a dedicated one-test run and the rest of the focused ATL directed suite as a separate 14-test run.
- The first post-fixture rerun exposed a real even-parity hydration bug in `src/llm/reference-resolver.ts`; the source fix and unit regression are included in Plan 120-03 because L-77 could not legitimately pass without it.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Phase-local evidence audit for Phases 112-119 | TEST-04 | Evidence lives across planning docs, summaries, verification reports, and coverage ledgers | Inspect `.planning/phases/112-*` through `.planning/phases/119-*`, record exact runnable commands and any missing/asymmetric artifacts in the Phase 120 final validation report. |
| Environmental skip review | VAL-120 | Supabase and managed scenario prerequisites can be environment-specific | Record command output and skip reason when `.env.test`, Supabase, ports, or managed provider fixtures prevent a gate from running locally. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency target documented
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
