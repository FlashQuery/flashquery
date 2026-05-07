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
| 120-01-01 | 01 | 1 | VAL-120 | T-120-01 | Mode 1 and provider failure evidence remains deterministic and mock-provider based | e2e | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` | ✅ | ✅ green |
| 120-02-01 | 02 | 1 | VAL-120 | T-120-02 | YAML scenarios use public MCP behavior and managed cleanup | yaml integration | `python3 tests/scenarios/integration/run_integration.py --managed <atl-yaml-tests>` | ✅ | ✅ green |
| 120-03-01 | 03 | 1 | VAL-120, TEST-04 | T-120-03 | Directed closure asserts public MCP JSON only and does not inspect private internals | directed | `python3 tests/scenarios/directed/run_suite.py --managed <atl-directed-tests>` | ✅ | ✅ green |
| 120-04-01 | 04 | 2 | TEST-04 | T-120-04 | Final audit records evidence and explicit skips without inventing missing phase artifacts | docs/audit | `rg -n "VAL-120|TEST-04|ATL-E2E|ATL-INT|ATL-DS|Phase 112|Phase 119" .planning/phases/120-cross-phase-atl-validation-coverage-closure tests/scenarios` | ✅ | ✅ green |

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

## Phase 112-119 Phase-Local Evidence Audit

| Phase | Artifact(s) Read | Runnable Command(s) Recorded | Outcome | Notes |
|-------|------------------|------------------------------|---------|-------|
| 112 | `.planning/phases/112-chat-primitive-envelope-migration/112-VERIFICATION.md` | `npm run build`; `npm test -- tests/unit/llm-client.test.ts tests/unit/llm-resolver.test.ts tests/unit/llm-tool.test.ts`; `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages` | PASS | Phase-local verification records build, 98 focused unit tests, and 4/4 directed steps for CHAT-01 through CHAT-06, VAL-112, TEST-01 through TEST-03. |
| 113 | `.planning/phases/113-document-reference-system-core/113-04-SUMMARY.md`; `.planning/phases/113-document-reference-system-core/113-VALIDATION.md` | `npm run build`; `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts tests/unit/resolve-document.test.ts`; `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts`; `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_reference_system_core` | PASS | No `113-VERIFICATION.md` exists; Phase 113 has an artifact asymmetry. The runnable evidence is recorded in `113-04-SUMMARY.md`, with 122/122 unit tests, 1/1 integration file, and public directed DRS coverage. Phase 120 also refreshed this path and fixed an even-parity hydration regression. |
| 114 | `.planning/phases/114-template-parameterization/114-VERIFICATION.md` | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool.test.ts`; `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` | PASS | Verification records 124 focused unit tests, 8 integration tests, and directed scenario coverage for template parameterization. |
| 115 | `.planning/phases/115-purpose-config-bindings-capabilities/115-VERIFICATION.md` | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts`; full gate: `npm run build && ... && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities && (cd tests/scenarios/integration && python3 run_integration.py --managed llm_discovery_list)` | PASS | Verification records 99 focused unit tests plus build, integration, directed, and YAML gates in `115-VALIDATION.md`. ATL-INT-04 remains a TypeScript integration-layer exception via `llm-config-sync.test.ts`. |
| 116 | `.planning/phases/116-model-visible-tool-registry/116-VERIFICATION.md` | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed`; `npm run build` | PASS | Records 145 focused unit tests, 2/2 public directed native registry steps, and build. |
| 117 | `.planning/phases/117-agent-loop-executor/117-VERIFICATION.md` | `npm run lint`; `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool-registry.test.ts`; `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py --managed`; `npm run build`; `npm test` | PASS | Records lint, 154 focused unit tests, 5 E2E tests, directed budget scenario, build, and broad unit suite. Phase 120 added the previously missing public cooperative shutdown directed row L-90. |
| 118 | `.planning/phases/118-template-discovery-masquerade-dispatch/118-VERIFICATION.md` | `npx tsx -e "...generateTemplateToolName(...)"`; `npm run build`; `npm test`; `npm run test:integration -- tests/integration/template-tools.integration.test.ts`; `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` | PASS | Records generated-name checks, build, 1,655 tests, integration, E2E, and directed template-tool behavior. |
| 119 | `.planning/phases/119-discovery-diagnostics-help-resolver/119-VERIFICATION.md` | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts`; `npm run build`; `npm run lint`; `npx tsx -e "...buildCallModelHelpContent..."`; `npx tsx -e "...buildModelCapabilityDiagnostics..."`; `python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed`; `python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed` | PASS | Records 117 focused unit tests, build, lint, helper contract checks, and public directed discovery/help coverage. |

---

## ATL Test Plan Traceability Map

| ATL ID | Local File / Row ID | Command | Result | Notes |
|--------|---------------------|---------|--------|-------|
| ATL-E2E-01 | `tests/e2e/call-model-agent-loop.e2e.test.ts` | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts -t ATL-E2E-01`; final combined E2E gate | PASS | Mode 1 default envelope returns `messages: []`, opt-in `return_messages` returns hydrated messages plus final assistant, and raw `list_models` discovery omits envelope fields. |
| ATL-E2E-02 | `tests/e2e/call-model-agent-loop.e2e.test.ts` | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` | PASS | Native tool loop E2E retained from Phase 117. |
| ATL-E2E-03 | `tests/e2e/call-model-agent-loop.e2e.test.ts` | same combined E2E gate | PASS | Agent-loop guardrail/fallback/cost E2E retained from Phase 117. |
| ATL-E2E-04 | `tests/e2e/call-model-template-tools.e2e.test.ts` | same combined E2E gate | PASS | Template-tool E2E retained from Phase 118. |
| ATL-E2E-05 | `tests/e2e/call-model-template-tools.e2e.test.ts` | same combined E2E gate | PASS | Template-tool discovery/dispatch E2E retained from Phase 118. |
| ATL-E2E-06 | `tests/e2e/call-model-agent-loop.e2e.test.ts` | same combined E2E gate | PASS | Existing Mode 2 agent-loop E2E surface retained. |
| ATL-E2E-07 | `tests/e2e/call-model-agent-loop.e2e.test.ts` | same combined E2E gate | PASS | Existing usage/calls-log E2E surface retained. |
| ATL-E2E-08 | `tests/e2e/call-model-agent-loop.e2e.test.ts`; `tests/unit/llm-client.test.ts`; `tests/unit/llm-tool.test.ts`; `tests/unit/llm-config.test.ts` | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts -t ATL-E2E-08`; final combined E2E gate | PASS | E2E covers `response_format` with tools pre-dispatch rejection and Mode 1 empty-tools omission. Missing usage on tool-call responses is covered at `llm-client.test.ts`; Mode 2 false/unknown capability admission is covered at config/unit layer because it is a startup/config-load contract. |
| ATL-INT-01 | `tests/scenarios/integration/INTEGRATION_COVERAGE.md` IL-37; `llm_template_reference_freshness.yml` | `python3 tests/scenarios/integration/run_integration.py --managed llm_template_reference_freshness llm_template_document_param_freshness llm_discovery_then_call llm_mixed_reference_modes` | PASS | Template-body freshness brackets an update with two `call_model` calls: ALPHA before the write, BETA after. |
| ATL-INT-02 | `INTEGRATION_COVERAGE.md` IL-38; `llm_template_document_param_freshness.yml` | same YAML subset; final report `tests/scenarios/integration/reports/integration-report-2026-05-07-021326.md` | PASS | Document-param freshness brackets the target write with two `call_model` calls and uses returned hydrated messages to avoid live-model echo variance. |
| ATL-INT-03 | `INTEGRATION_COVERAGE.md` IL-39; `llm_discovery_then_call.yml` | same YAML subset | PASS | Discovery-to-invocation closure exercises §8.3 `usage` block keys, discovered template-tool `template_path`/parameter surface, direct `{{ref:...}}` invocation, and purpose invocation. |
| ATL-INT-04 | `INTEGRATION_COVERAGE.md` IL-35; `tests/integration/llm-config-sync.test.ts` | `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts tests/integration/template-tools.integration.test.ts tests/integration/llm-config-sync.test.ts` | PASS | TypeScript integration exception: no public runtime binding YAML tool exists, so restart/precedence behavior remains covered at config-sync integration layer. |
| ATL-INT-05 | `INTEGRATION_COVERAGE.md` IL-40; `llm_mixed_reference_modes.yml`; `test_call_model_template_parameterization` | YAML subset plus focused directed suite | PASS | YAML proves mixed-mode content hydration; parsed directed coverage proves metadata ordering, parent list entry, same-document/different-section items, and default `_separator` shape. |
| ATL-DS-01 | `DIRECTED_COVERAGE.md` L-73/L-74/L-75; `test_call_model_return_messages` | `python3 tests/scenarios/directed/run_suite.py --managed <focused ATL directed suite>` | PASS | Return-message compatibility envelope and raw discovery shapes. |
| ATL-DS-02 | `DIRECTED_COVERAGE.md` L-76; `test_call_model_reference_system_core` | same focused directed suite | PASS | Public DRS path, fq_id, filename, section, pointer, metadata. |
| ATL-DS-03 | `DIRECTED_COVERAGE.md` L-77/L-78/L-79; `test_call_model_reference_system_core` | same focused directed suite | PASS | Escape parity, host-only scanning, typed reference failures. |
| ATL-DS-04 | `DIRECTED_COVERAGE.md`; `test_call_model_template_parameterization` | same focused directed suite | PASS | Parameterized template references render path-keyed and fq_id-keyed `template_params` with metadata. |
| ATL-DS-05 | `DIRECTED_COVERAGE.md`; `test_call_model_template_parameterization` | same focused directed suite | PASS | Alias `_template`, repeated aliases, list-mode `_items`, plain-object items, item metadata, and separator behavior are covered in the directed template-parameterization scenario. |
| ATL-DS-06 | `DIRECTED_COVERAGE.md`; `test_call_model_template_parameterization` | same focused directed suite | PASS | Template failure taxonomy aborts before provider dispatch for missing required params, invalid document params, invalid `_items`, and invalid `_separator`. |
| ATL-DS-07 | `DIRECTED_COVERAGE.md` L-91; `test_call_model_template_discovery` | same focused directed suite | PASS | Fresh template-tool discovery diagnostics. |
| ATL-DS-08 | `DIRECTED_COVERAGE.md` L-92; `test_call_model_template_tool_conflicts` | same focused directed suite | PASS | Collision diagnostics and pre-provider blocking. |
| ATL-DS-09 | `DIRECTED_COVERAGE.md` L-86; `test_call_model_agent_loop_native` | same focused directed suite | PASS | Public native Mode 2 loop and calls-log metadata. |
| ATL-DS-10 | `DIRECTED_COVERAGE.md` L-93; `test_call_model_agent_loop_template_tool` | same focused directed suite | PASS | Template-tool Mode 2 loop dispatch. |
| ATL-DS-11 | `DIRECTED_COVERAGE.md` L-94; `test_call_model_agent_loop_mixed_tools` | same focused directed suite | PASS | Mixed native/template tool exposure and calls-log kinds. |
| ATL-DS-12 | `DIRECTED_COVERAGE.md` L-87/L-90; `test_call_model_agent_loop_budgets`; `test_call_model_agent_loop_shutdown` | focused directed suite plus `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_shutdown` | PASS | Budget guardrails and public cooperative shutdown evidence. |
| ATL-DS-13 | `DIRECTED_COVERAGE.md` L-88; `test_call_model_agent_loop_usage` | focused directed suite | PASS | Aggregate usage row and token/cost arithmetic. |
| ATL-DS-14 | `DIRECTED_COVERAGE.md` L-84; `test_call_model_agent_loop_capabilities` | focused directed suite | PASS | Capability admission diagnostics and pre-provider rejection. |
| ATL-DS-15 | `DIRECTED_COVERAGE.md` L-99; `test_call_model_help_resolver` | focused directed suite | PASS | Raw JSON help resolver shape and stable sections. |
| ATL-U-* | Phase 112-119 verification artifacts; focused unit files | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts` | PASS | Final focused unit gate passed 184 tests; phase-local artifacts record broader unit slices for chat, DRS, templates, config, registry, loop, discovery. |
| ATL-I-* | `tests/integration/reference-resolver.integration.test.ts`; `template-tools.integration.test.ts`; `llm-config-sync.test.ts`; `INTEGRATION_COVERAGE.md` IL-27/31-35/37-40 | final TypeScript integration and YAML integration gates | PASS | Supabase-backed resolver/template/config-sync and public YAML flows. |

---

## Phase 120 Final Gate Evidence

| Date | Command | Outcome | Notes |
|------|---------|---------|-------|
| 2026-05-07 | `npm run lint` | PASS | ESLint exited 0. |
| 2026-05-07 | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts` | PASS | 5 files passed, 184 tests passed. |
| 2026-05-07 | `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts tests/integration/template-tools.integration.test.ts tests/integration/llm-config-sync.test.ts` | PASS | 3 files passed, 15 tests passed. Expected schema-verification logs note `description` column already absent. |
| 2026-05-07 | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` | PASS | 2 files passed, 12 tests passed. Earlier Plan 120-01 saw a transient concurrent `tsup` race, but the final exact command passed. |
| 2026-05-07 | `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages test_call_model_reference_system_core test_call_model_template_parameterization test_call_model_agent_loop_capabilities test_call_model_native_tool_registry test_call_model_agent_loop_native test_call_model_agent_loop_budgets test_call_model_agent_loop_usage test_call_model_template_discovery test_call_model_template_tool_conflicts test_call_model_agent_loop_template_tool test_call_model_agent_loop_mixed_tools test_discovery_resolvers test_call_model_help_resolver` | PASS | 14/14 tests passed. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-07-020233.md`. |
| 2026-05-07 | `python3 tests/scenarios/integration/run_integration.py --managed llm_template_reference_freshness llm_template_document_param_freshness llm_discovery_then_call llm_mixed_reference_modes` | PASS | Final rerun passed 4/4. Report: `tests/scenarios/integration/reports/integration-report-2026-05-07-021326.md`. Initial run `integration-report-2026-05-07-020616.md` failed ATL-INT-02 because the live model refused to echo the marker; `llm_template_document_param_freshness.yml` was stabilized to assert freshness via `return_messages: true`, then passed standalone and in the full subset. |
| 2026-05-07 | `npm run build` | PASS | tsup ESM and DTS build succeeded. |

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
