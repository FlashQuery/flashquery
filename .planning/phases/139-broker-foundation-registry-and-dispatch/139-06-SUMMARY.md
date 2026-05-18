---
phase: 139-broker-foundation-registry-and-dispatch
plan: 06
subsystem: testing
tags: [mcp-broker, yaml-integration, call_model, tool-dispatch, validation]

requires:
  - phase: 139-05
    provides: "Directed scenarios and E2E coverage for Phase A broker behavior"
provides:
  - "YAML integration scenarios for INT-MCB-01, INT-MCB-04, INT-MCB-05, and INT-MCB-07"
  - "Deterministic mock OpenAI endpoint support in the YAML integration runner"
  - "Final Phase 139 validation gate record"
affects: [mcp-broker, llm-tools, scenario-harness, phase-validation]

tech-stack:
  added: []
  patterns:
    - "Top-level YAML `mock_openai.responses` can drive deterministic OpenAI-compatible call_model tests"
    - "Brokered call_model traces expose sanitized `metadata.tool_calls` entries for YAML assertions"

key-files:
  created:
    - tests/scenarios/integration/tests/brokered_purpose_dispatch.yml
    - tests/scenarios/integration/tests/host_unknown_server_fail_loud.yml
    - tests/scenarios/integration/tests/purpose_unknown_server_fail_loud.yml
    - tests/scenarios/integration/tests/cost_per_call_resolution.yml
    - .planning/phases/139-broker-foundation-registry-and-dispatch/139-VALIDATION.md
    - .planning/phases/139-broker-foundation-registry-and-dispatch/139-06-SUMMARY.md
  modified:
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - tests/scenarios/integration/run_integration.py
    - src/mcp/server.ts
    - src/mcp/tools/llm.ts
    - src/llm/types.ts

key-decisions:
  - "Use an in-process OpenAI-compatible mock endpoint for YAML call_model tests so broker dispatch scenarios do not depend on external network or API credentials."
  - "Expose only sanitized broker trace snapshots through call_model metadata, preserving observable cost assertions without leaking raw broker internals."

patterns-established:
  - "YAML broker scenarios should use managed fixture servers plus deterministic scripted model responses."
  - "Cost trace validation should assert public `metadata.tool_calls` entries, including server-default and per-tool override resolution."

requirements-completed:
  - REQ-001
  - REQ-002
  - REQ-003
  - REQ-004
  - REQ-005
  - REQ-006
  - REQ-007
  - REQ-008
  - REQ-009
  - REQ-010
  - REQ-011
  - REQ-012
  - REQ-013
  - REQ-014
  - REQ-015
  - REQ-016
  - REQ-017
  - REQ-018
  - REQ-019
  - REQ-020
  - REQ-021
  - REQ-022
  - REQ-023
  - REQ-024
  - REQ-025
  - REQ-026
  - REQ-027
  - REQ-028
  - REQ-029
  - REQ-030
  - REQ-031
  - REQ-032
  - REQ-033
  - REQ-034
  - REQ-035
  - REQ-036
  - REQ-037
  - REQ-050
  - REQ-051
  - REQ-052
  - REQ-053
  - REQ-054
  - REQ-055
  - REQ-056
  - REQ-057
  - REQ-058
  - REQ-059
  - REQ-060
  - REQ-106
  - REQ-107
  - REQ-108

duration: 36min
completed: 2026-05-18
---

# Phase 139 Plan 06: YAML Broker Scenarios and Validation Summary

**Phase A MCP Broker YAML coverage with deterministic call_model dispatch, resolved cost trace assertions, and final validation sign-off**

## Performance

- **Duration:** 36 min
- **Started:** 2026-05-18T02:20:00Z
- **Completed:** 2026-05-18T02:56:00Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Added YAML scenarios for brokered purpose dispatch, host unknown-server failure, purpose unknown-server failure, and cost-per-call trace resolution.
- Updated the YAML integration runner with a deterministic OpenAI-compatible mock endpoint so `call_model` broker dispatch can be tested without external services.
- Threaded the production broker into public `call_model` purpose dispatch and exposed sanitized `metadata.tool_calls` trace entries for scenario assertions.
- Recorded the final Phase 139 validation gate across unit, integration, E2E, directed scenario, YAML scenario, and build commands.

## Task Commits

1. **Task 1 RED: Add failing broker YAML scenarios** - `4dd1ec5` (test)
2. **Task 1 GREEN: Support broker YAML dispatch scenarios** - `4e07497` (feat)
3. **Task 2: Record Phase 139 validation gate** - `4519568` (docs)

**Plan metadata:** pending final close-out commit

## Files Created/Modified

- `tests/scenarios/integration/tests/brokered_purpose_dispatch.yml` - INT-MCB-01 brokered purpose dispatch scenario.
- `tests/scenarios/integration/tests/host_unknown_server_fail_loud.yml` - INT-MCB-04 host config fail-loud scenario.
- `tests/scenarios/integration/tests/purpose_unknown_server_fail_loud.yml` - INT-MCB-05 purpose config fail-loud scenario.
- `tests/scenarios/integration/tests/cost_per_call_resolution.yml` - INT-MCB-07 server-default and per-tool override trace cost scenario.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Matrix rows and last-passing dates for the new Phase A YAML scenarios.
- `tests/scenarios/integration/run_integration.py` - Scripted mock OpenAI provider and variable substitution support for YAML `call_model` tests.
- `src/mcp/server.ts` - Passes the production broker into LLM tool registration.
- `src/mcp/tools/llm.ts` - Enables brokered purpose dispatch in `call_model` and returns sanitized broker trace metadata.
- `src/llm/types.ts` - Adds brokered trace entry and `metadata.tool_calls` typing.
- `.planning/phases/139-broker-foundation-registry-and-dispatch/139-VALIDATION.md` - Final validation gate record.

## Decisions Made

- Used a local scripted OpenAI-compatible endpoint in the integration runner to keep YAML model/tool-call tests deterministic and credential-free.
- Exposed broker cost assertions through public `call_model` metadata because YAML scenarios cannot inspect internal broker accumulators.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added deterministic mock OpenAI provider to the YAML runner**
- **Found during:** Task 1 RED/GREEN
- **Issue:** The new YAML `call_model` broker tests needed deterministic tool-call responses, but the runner had no valid model endpoint for `${mock_openai.endpoint}`.
- **Fix:** Added `_ScriptedOpenAIProvider`, top-level `mock_openai.responses`, endpoint injection, and `${run.id}` substitution.
- **Files modified:** `tests/scenarios/integration/run_integration.py`, YAML scenario files
- **Verification:** `python3 tests/scenarios/integration/run_integration.py --managed brokered_purpose_dispatch host_unknown_server_fail_loud purpose_unknown_server_fail_loud cost_per_call_resolution`
- **Committed in:** `4e07497`

**2. [Rule 2 - Missing Critical] Exposed brokered `call_model` cost trace metadata**
- **Found during:** Task 1 GREEN
- **Issue:** The plan required T-Y-007 to assert resolved costs in observable `tool_calls` trace entries, but the existing public `call_model` path did not surface broker traces.
- **Fix:** Passed the broker into LLM tools, routed purpose `mcp_servers` through broker dispatch, and returned sanitized `metadata.tool_calls` entries.
- **Files modified:** `src/mcp/server.ts`, `src/mcp/tools/llm.ts`, `src/llm/types.ts`
- **Verification:** YAML broker scenarios, focused LLM unit tests, and `npm run build`
- **Committed in:** `4e07497`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both fixes were required to make the planned YAML scenarios executable and observable. No package installs or external services were added.

## Issues Encountered

- The directed scenario runner reported cleanup timeout warnings around `test_mcp_broker_phase_a`, but the suite passed with `RESIDUE 0`. This warning is recorded in `139-VALIDATION.md`.

## User Setup Required

None - no external service configuration required for the new YAML scenarios. Existing `.env.test` credentials were available for the broader validation gate.

## Known Stubs

None. The stub scan only found intentional YAML mock-provider fixtures and pre-existing runner default values.

## Verification

- `python3 tests/scenarios/integration/run_integration.py --managed brokered_purpose_dispatch host_unknown_server_fail_loud purpose_unknown_server_fail_loud cost_per_call_resolution` - passed, 4/4 scenarios.
- `npm test -- --run tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts` - passed, 47 tests.
- `npm run build` - passed.
- `npm test -- --run tests/unit/config.test.ts tests/unit/mcp-broker-tofu.test.ts tests/unit/mcp-broker-registry.test.ts tests/unit/mcp-broker-errors.test.ts tests/unit/macro-coerce.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro-registry.test.ts` - passed, 92 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker` - passed, 16 tests.
- `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` - passed, 1 test.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_a` - passed, 3/3 steps, residue 0.

## Next Phase Readiness

Phase 139 has an auditable Phase A MCP Broker foundation gate. Downstream broker work can rely on registry, dispatch, macro, YAML, directed, integration, and E2E coverage recorded in the phase summaries and validation file.

## Self-Check: PASSED

- Verified all created and modified files exist on disk.
- Verified task commits `4dd1ec5`, `4e07497`, and `4519568` exist in git history.

---
*Phase: 139-broker-foundation-registry-and-dispatch*
*Completed: 2026-05-18*
