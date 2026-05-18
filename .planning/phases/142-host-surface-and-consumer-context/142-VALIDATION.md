---
phase: 142
slug: host-surface-and-consumer-context
status: draft
nyquist_compliant: true
wave_0_complete: false
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
| 142-W0-01 | W0 | 0 | REQ-031, REQ-116 | T-142-01 | Host and purpose filtered views exclude unauthorized server tools. | unit | `npm test -- --run tests/unit/mcp-broker-registry.test.ts` | extend existing | pending |
| 142-W0-02 | W0 | 0 | REQ-005..010, REQ-113 | T-142-02 | Planned unit tests: `REQ-005 REQ-009 defaults omitted host to no broker visibility and disabled host search`; `REQ-006 accepts empty host config as disabled broker host visibility`; `REQ-007 rejects unknown host broker server references with [host] scope and the missing ID`; `REQ-008 rejects unknown purpose broker server references with [purpose:<name>] scope and the missing ID`; `REQ-010 REQ-113 loads host.tool_search enabled with broker visibility distinct from host_mcp_tools`. | unit/YAML | `npm test -- --run tests/unit/config.test.ts` plus Phase D YAML scenarios | partial | planned |
| 142-W0-03 | W0 | 0 | REQ-035, REQ-066 | T-142-03 | Host cannot call hidden registry keys; visible host brokered calls trace correctly. | integration | `npm run test:integration -- --run tests/integration/mcp-broker/host-surface.test.ts` | missing W0 | pending |
| 142-W0-04 | W0 | 0 | REQ-114, REQ-115, REQ-067 | T-142-04 | Nested macro frames inherit consumer context, trace scope, and `interactive`. | unit/directed | `npm test -- --run tests/unit/macro*.test.ts` plus directed MCB-13/14 sibling | missing W0 | pending |
| 142-W0-05 | W0 | 0 | REQ-117, REQ-118 | T-142-05 | Host and delegated callers share one server process and one TOFU pin set. | integration/E2E | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` | extend existing | pending |
| 142-W0-06 | W0 | 0 | REQ-065..067 | T-142-06 | `tool_calls` records include resolved cost and are attached to the correct trace scope. | directed/YAML | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_d` and Phase D YAML workflows | missing W0 | pending |

## Wave 0 Requirements

- [ ] Add or relabel unit coverage for `T-U-036` and `T-U-037` in `tests/unit/mcp-broker-registry.test.ts`.
- [ ] Add focused host MCP surface integration coverage for `T-I-030` hidden/unknown brokered dispatch rejection.
- [ ] Add shared broker lifecycle integration coverage for `T-I-031` lazy-spawn unification and `T-I-032` shared TOFU pins.
- [ ] Add host index integration coverage for `T-I-038` startup index build and `T-I-039` host-visible `list_changed` index updates.
- [ ] Add Phase D E2E gate `T-E-D1` in `tests/e2e/mcp-broker.e2e.test.ts`.
- [ ] Add directed scenario coverage for `MCB-12..MCB-16`, plus the Phase 140 carry-forward sibling for `interactive: false` inheritance.
- [ ] Add YAML scenarios `brokered_host_dispatch.yml`, `host_tool_search_with_brokered.yml`, `host_empty_section.yml`, `host_mcp_tools_with_brokered.yml`, `brokered_host_registration.yml`, and `brokered_no_tier_classification.yml`.
- [ ] Close Phase 141 carry-forward REQ-100b / Gap 6 by proving `brokered_host_registration.yml` sees `description_override` in host MCP `tools/list` via `BrokeredTool.description`.
- [ ] Update directed and YAML coverage ledgers with `MCB-12..16` and `INT-MCB-02/03/06/09/10/11`.

## Manual-Only Verifications

All Phase 142 behaviors should have automated verification. Manual review is useful for checking trace payload readability, but it is not a substitute for the Phase D gates.

## Validation Sign-Off

- [x] All tasks have automated verify targets or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing Phase D references from research.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending execution.
