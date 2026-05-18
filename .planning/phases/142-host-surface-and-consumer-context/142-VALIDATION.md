---
phase: 142
slug: host-surface-and-consumer-context
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-18
---

# Phase 142 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1; directed/YAML scenario runners are Python. |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| Quick run command | `npm test -- --run tests/unit/mcp-broker-registry.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro*.test.ts` |
| Full suite command | `npm run build && npm test && npm run test:integration -- --run tests/integration/mcp-broker tests/integration/tool-search && npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` |
| Estimated runtime | Focused unit: ~30s; focused integration/E2E depends on MCP fixture startup; full gate depends on `.env.test`. |

## Sampling Rate

- After every task commit: run the focused unit or integration command for the touched seam.
- After every plan wave: run the Phase D focused unit, integration, E2E, directed, and YAML scenario set for completed seams.
- Before `$gsd-verify-work`: build, unit, integration, E2E, directed Phase D, YAML Phase D, and lint gates must be green or explicitly documented as skipped by environment.
- Max feedback latency for ordinary implementation tasks: one focused test command before commit.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 142-W0-01 | W0 | 0 | REQ-031, REQ-116 | T-142-01 | `T-U-036` filters host views to `host.mcp_servers` and excludes hidden servers; `T-U-037` filters purpose views and keeps returned tools cloned. | unit | `npm test -- --run tests/unit/mcp-broker-registry.test.ts` plus final focused unit gate | extend existing | passed 2026-05-18 |
| 142-W0-02 | W0 | 0 | REQ-005..010, REQ-113 | T-142-02 | Host config defaults, strict host/purpose server references, enabled host search, and native `host_mcp_tools` distinction are covered. | unit/YAML | `npm test -- --run tests/unit/config.test.ts` plus Phase D YAML scenarios | existing | passed 2026-05-18 |
| 142-W0-03 | W0 | 0 | REQ-035, REQ-066 | T-142-03 | Host cannot call hidden registry keys; visible host brokered calls trace with cost and sanitized host scope. | integration | `npm run test:integration -- --run tests/integration/mcp-broker/host-surface.test.ts` | exists | passed 2026-05-18 |
| 142-W0-04 | W0 | 0 | REQ-114, REQ-115, REQ-067 | T-142-04 | Nested macro frames inherit consumer context, trace scope, and `interactive`; directed MCB-13/14 validates public scenario behavior. | unit/directed | `npm test -- --run tests/unit/macro-registry.test.ts` plus directed Phase D | exists | passed 2026-05-18 |
| 142-W0-05 | W0 | 0 | REQ-117, REQ-118 | T-142-05 | Host and delegated callers share one server process and one TOFU pin set. | integration/E2E | `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` and `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` | exists | passed 2026-05-18 |
| 142-W0-06 | W0 | 0 | REQ-065..067 | T-142-06 | `tool_calls` records include resolved cost and are attached to the correct trace scope. | directed/YAML | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_d` and Phase D YAML workflows | exists | passed 2026-05-18 |

## Wave 0 Requirements

- [x] Add or relabel unit coverage for `T-U-036` and `T-U-037` in `tests/unit/mcp-broker-registry.test.ts`.
- [x] Add focused host MCP surface integration coverage for `T-I-030` hidden/unknown brokered dispatch rejection.
- [x] Add shared broker lifecycle integration coverage for `T-I-031` lazy-spawn unification and `T-I-032` shared TOFU pins.
- [x] Add host index integration coverage for `T-I-038` startup index build and `T-I-039` host-visible `list_changed` index updates.
- [x] Add Phase D E2E gate `T-E-D1` in `tests/e2e/mcp-broker.e2e.test.ts`.
- [x] Add directed scenario coverage for `MCB-12..MCB-16`, plus the Phase 140 carry-forward sibling for `interactive: false` inheritance.
- [x] Add YAML scenarios `brokered_host_dispatch.yml`, `host_tool_search_with_brokered.yml`, `host_empty_section.yml`, `host_mcp_tools_with_brokered.yml`, `brokered_host_registration.yml`, and `brokered_no_tier_classification.yml`.
- [x] Close Phase 141 carry-forward REQ-100b / Gap 6 by proving `brokered_host_registration.yml` sees `description_override` in host MCP `tools/list` via `BrokeredTool.description`.
- [x] Update directed and YAML coverage ledgers with `MCB-12..16` and `INT-MCB-02/03/06/09/10/11`.

## Phase D Final Gate Outcomes

Executed on 2026-05-18 from the FlashQuery repo root with `.env.test` credentials.

| Gate | Command | Outcome | Notes |
|------|---------|---------|-------|
| Build | `npm run build` | PASS | ESM and DTS build succeeded. Re-run after lint cleanup also passed. |
| Config, registry, host tools, dispatcher, macro unit tests | `npm test -- --run tests/unit/config.test.ts tests/unit/mcp-broker-registry.test.ts tests/unit/mcp-server-tools.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro-registry.test.ts` | PASS | 5 files, 113 tests passed. |
| Host surface, host index, shared lifecycle integration | `npm run test:integration -- --run tests/integration/mcp-broker/host-surface.test.ts tests/integration/tool-search/host-index.integration.test.ts tests/integration/mcp-broker/client-lifecycle.test.ts` | PASS | 3 files, 36 tests passed after updating a stale host trace assertion to include `consumer_kind` and `trace_id`. |
| Broker E2E | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` | PASS | 1 file, 3 tests passed. |
| Directed Phase D | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_d` | PASS | 1 test, 6/6 steps passed; strict cleanup reported `RESIDUE: 0`. Environment warnings: `clean_test_tables.py` timed out after 30 seconds during initial and final cleanup against hosted Supabase. |
| YAML Phase D | `python3 tests/scenarios/integration/run_integration.py --managed brokered_host_dispatch host_tool_search_with_brokered host_empty_section host_mcp_tools_with_brokered brokered_host_registration brokered_no_tier_classification` | PASS | 6/6 workflows passed, 8/8 steps passed. |
| Lint | `npm run lint --if-present` | PASS | Initial run failed on two unnecessary type assertions in `src/mcp/host-brokered-tools.ts` and `src/mcp/tool-catalog.ts`; minimal cleanup was applied and lint passed. |

## Phase D Test ID Audit

| Test ID | Coverage ID | Evidence |
|---------|-------------|----------|
| T-U-036 | unit | `tests/unit/mcp-broker-registry.test.ts` |
| T-U-037 | unit | `tests/unit/mcp-broker-registry.test.ts` |
| T-I-030 | integration | `tests/integration/mcp-broker/host-surface.test.ts` |
| T-I-031 | integration | `tests/integration/mcp-broker/client-lifecycle.test.ts` |
| T-I-032 | integration | `tests/integration/mcp-broker/client-lifecycle.test.ts` |
| T-I-038 | integration | `tests/integration/tool-search/host-index.integration.test.ts` |
| T-I-039 | integration | `tests/integration/tool-search/host-index.integration.test.ts` |
| T-E-D1 | E2E | `tests/e2e/mcp-broker.e2e.test.ts` |
| T-S-012 | MCB-12 | `test_macro_brokered_tool_not_in_context` in `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py`; ledger row in `tests/scenarios/directed/DIRECTED_COVERAGE.md` |
| T-S-013 | MCB-13 | `test_macro_nested_purpose_context` in `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py`; ledger row in `tests/scenarios/directed/DIRECTED_COVERAGE.md` |
| T-S-014 | MCB-14 | `test_macro_nested_host_context` in `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py`; ledger row in `tests/scenarios/directed/DIRECTED_COVERAGE.md` |
| T-S-015 | MCB-15 | `test_brokered_call_cost_in_trace` in `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py`; ledger row in `tests/scenarios/directed/DIRECTED_COVERAGE.md` |
| T-S-016 | MCB-16 | `test_host_brokered_call_trace_scope` in `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py`; ledger row in `tests/scenarios/directed/DIRECTED_COVERAGE.md` |
| T-Y-002 | INT-MCB-02 | `tests/scenarios/integration/tests/brokered_host_dispatch.yml`; ledger row in `tests/scenarios/integration/INTEGRATION_COVERAGE.md` |
| T-Y-003 | INT-MCB-03 | `tests/scenarios/integration/tests/host_tool_search_with_brokered.yml`; ledger row in `tests/scenarios/integration/INTEGRATION_COVERAGE.md` |
| T-Y-006 | INT-MCB-06 | `tests/scenarios/integration/tests/host_empty_section.yml`; ledger row in `tests/scenarios/integration/INTEGRATION_COVERAGE.md` |
| T-Y-009 | INT-MCB-09 | `tests/scenarios/integration/tests/host_mcp_tools_with_brokered.yml`; ledger row in `tests/scenarios/integration/INTEGRATION_COVERAGE.md` |
| T-Y-010 | INT-MCB-10 | `tests/scenarios/integration/tests/brokered_host_registration.yml`; ledger row in `tests/scenarios/integration/INTEGRATION_COVERAGE.md` |
| T-Y-011 | INT-MCB-11 | `tests/scenarios/integration/tests/brokered_no_tier_classification.yml`; ledger row in `tests/scenarios/integration/INTEGRATION_COVERAGE.md` |

## Phase 141 Carry-Forward Audit

| Carry-forward | Status | Evidence |
|---------------|--------|----------|
| REQ-100b / Gap 6: host MCP surface uses `BrokeredTool.description`, including `description_override`, for brokered host `tools/list` registration. | CLOSED | `brokered_host_registration.yml` passed under `python3 tests/scenarios/integration/run_integration.py --managed ...`; Step 2 asserted `description: "X"` on host `tools/list` and excluded the upstream original description. Coverage row: `INT-MCB-10`; source test: `T-Y-010`. |

## Threat Review

| Threat | Mitigation Result |
|--------|-------------------|
| T-142-20 validation repudiation | Exact commands, dates, outcomes, pass counts, and environment warnings are recorded above. |
| T-142-21 requirements checklist tampering | Only Phase 142 IDs are eligible for checklist closure in this plan; future/deferred IDs remain unchecked. |
| T-142-22 information disclosure | Validation logs record sanitized command outcomes only; `.env.test` secret values and raw upstream payloads are not copied. |
| T-142-SC package installs | No package-manager install was run. |

No failing high-severity Phase 142 threat-model item remains open.

## Manual-Only Verifications

All Phase 142 behaviors should have automated verification. Manual review is useful for checking trace payload readability, but it is not a substitute for the Phase D gates.

## Validation Sign-Off

- [x] All tasks have automated verify targets or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing Phase D references from research.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** complete after final Phase D gates passed on 2026-05-18.
