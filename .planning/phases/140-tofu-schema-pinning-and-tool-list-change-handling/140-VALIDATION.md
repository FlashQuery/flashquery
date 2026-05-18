---
phase: 140
slug: tofu-schema-pinning-and-tool-list-change-handling
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-18
completed: 2026-05-18
---

# Phase 140 - Executed Validation Record

Phase 140 closes the MCP Broker Phase B slice: in-memory TOFU schema pinning,
schema-drift blocking, `notifications/tools/list_changed` routing, macro
`needs_user_input`, approve/reject resolution, audit logging, and YAML workflow
coverage.

## Validation Commands

All commands were run from the FlashQuery repo root on 2026-05-18 with
`.env.test` loaded by the standard test harnesses.

| Gate | Command | Outcome | Evidence |
|------|---------|---------|----------|
| Unit | `npm test -- --run tests/unit/mcp-broker-diff.test.ts tests/unit/mcp-broker-tofu.test.ts tests/unit/mcp-broker-registry.test.ts tests/unit/macro-termination.test.ts tests/unit/macro-registry.test.ts tests/unit/macro-coerce.test.ts` | PASS | 6 files, 53 tests passed. |
| Integration | `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts tests/integration/mcp-broker/tofu-list-changed.test.ts tests/integration/mcp-broker/dispatch.test.ts` | PASS | 3 files, 37 tests passed. |
| E2E | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` | PASS | 1 file, 2 tests passed. |
| Directed | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_b` | PASS | 1 test, 4/4 steps, `RESIDUE: 0`; report `tests/scenarios/directed/reports/scenario-report-2026-05-18-115230.md`. The shared DB cleanup helper timed out before and after the run, matching the known 140-05 behavior, but the scenario passed and left no residue. |
| YAML | `python3 tests/scenarios/integration/run_integration.py --managed tofu_drift_yaml_workflow` | PASS | 1/1 YAML tests passed, 4/4 steps; report `tests/scenarios/integration/reports/integration-report-2026-05-18-115356.md`. |
| Build | `npm run build` | PASS | `tsup` ESM and DTS builds completed successfully. |

No integration or E2E gate skipped. Supabase credentials were present in
`.env.test`, and the scenario harnesses used the configured test database.

## Source Coverage Audit

| Requirement | Status | Verification Artifact |
|-------------|--------|-----------------------|
| REQ-038 | PASS | `tests/unit/mcp-broker-tofu.test.ts`; `tests/integration/mcp-broker/tofu-list-changed.test.ts` T-I-027/T-I-032a. |
| REQ-039 | PASS | T-I-013 and T-I-020 in `tests/integration/mcp-broker/tofu-list-changed.test.ts`. |
| REQ-040 | PASS | T-I-013 and YAML T-Y-012 setup step. |
| REQ-041 | PASS | T-I-006, T-I-014, T-E-B1, T-S-003, and T-Y-012. |
| REQ-042 | PASS | `MacroNeedsUserInputError` unit coverage, T-I-014, T-E-B1, T-S-003, and T-Y-012 payload assertions. |
| REQ-043 | PASS | T-I-016, T-E-B1, T-S-004, and T-Y-012 approve resume. |
| REQ-044 | PASS | T-I-017 and T-S-005 reject blocked scenario. |
| REQ-045 | PASS | T-I-018 bundled drift integration coverage. |
| REQ-046 | PASS | TOFU decision audit unit/integration coverage and T-S-017. |
| REQ-047 | PASS | T-I-007, T-I-017, and retained rejected hash coverage. |
| REQ-048 | PASS | Source scan and absence of rate-limit/debounce/throttle logic under `src/services/mcp-broker`. |
| REQ-049 | PASS | T-I-032b autonomous blocked_on_user integration coverage. |
| REQ-061 | PASS | `BrokerClient` list_changed subscription coverage in `tests/integration/mcp-broker/client-lifecycle.test.ts`. |
| REQ-062 | PASS | T-U-035 plus T-I-005, T-I-006, and T-I-007. |
| REQ-063 | PASS | T-I-015/T-I-016 index sink add/remove ordering in `tofu-list-changed.test.ts`. |
| REQ-064 | PASS | T-U-035 pure `diffToolSnapshots` unit coverage. |
| REQ-068 | PASS | Reverse-request audit regression in `client-lifecycle.test.ts`. |
| REQ-070 | PASS | TOFU approval/rejection audit unit coverage, integration assertions, and T-S-017. |
| REQ-105 | PASS | `tests/unit/macro-termination.test.ts`, `tests/unit/macro-registry.test.ts`, T-E-B1, T-S-003, and T-Y-012. |

## Phase B Test ID Audit

| Test ID | Status | Command Evidence |
|---------|--------|------------------|
| T-U-035 | PASS | `npm test -- --run tests/unit/mcp-broker-diff.test.ts ...` |
| T-I-004 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts ...` |
| T-I-005 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-006 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-007 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-013 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-014 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-015 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-016 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-017 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-018 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-019 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-020 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-027 | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-032a | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-I-032b | PASS | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts ...` |
| T-E-B1 | PASS | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` |
| T-S-003 | PASS | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_b` |
| T-S-004 | PASS | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_b` |
| T-S-005 | PASS | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_b` |
| T-S-017 | PASS | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_b` |
| T-Y-012 | PASS | `python3 tests/scenarios/integration/run_integration.py --managed tofu_drift_yaml_workflow` |

## Coverage Files

| Artifact | Status |
|----------|--------|
| `tests/unit/mcp-broker-diff.test.ts` | Covers T-U-035. |
| `tests/integration/mcp-broker/client-lifecycle.test.ts` | Covers list_changed subscription and reverse-request audit regressions. |
| `tests/integration/mcp-broker/tofu-list-changed.test.ts` | Covers T-I-004..007, T-I-013..020, T-I-027, T-I-032a, and T-I-032b. |
| `tests/e2e/mcp-broker.e2e.test.ts` | Covers T-E-B1. |
| `tests/scenarios/directed/testcases/test_mcp_broker_phase_b.py` | Covers T-S-003, T-S-004, T-S-005, and T-S-017 through MCB-03, MCB-04, MCB-05, and MCB-17. |
| `tests/scenarios/integration/tests/tofu_drift_yaml_workflow.yml` | Covers T-Y-012 / INT-MCB-12. |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | Registers INT-MCB-12 with `tofu_drift_yaml_workflow`. |

## Validation Sign-Off

- [x] Every Phase 140 requirement maps to a passing verification artifact.
- [x] Every Phase B test ID maps to command evidence.
- [x] Unit, integration, E2E, directed, YAML, and build gates passed.
- [x] No package installs or new dependencies were introduced.
- [x] No manual-only blocker remains for `$gsd-verify-work`.
