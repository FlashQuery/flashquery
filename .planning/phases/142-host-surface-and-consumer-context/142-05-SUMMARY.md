---
phase: 142-host-surface-and-consumer-context
plan: 5
subsystem: testing
tags: [mcp-broker, host-surface, consumer-context, directed-scenarios, yaml-scenarios]

requires:
  - phase: 142-host-surface-and-consumer-context
    provides: host brokered registration, trace metadata, host search, and shared broker state from 142-02 through 142-04
provides:
  - Phase D directed scenario coverage for MCB-12 through MCB-16
  - Phase D managed YAML workflow coverage for INT-MCB-02, INT-MCB-03, INT-MCB-06, INT-MCB-09, INT-MCB-10, and INT-MCB-11
  - Public host tools/list description assertions for brokered description_override substitution
affects: [phase-142, mcp-broker-host-surface, scenario-validation]

tech-stack:
  added: []
  patterns:
    - managed directed scenarios with public MCP calls and source test-plan IDs in labels
    - managed YAML workflows using public MCP assertions for host brokered visibility
    - mcp.list_tools YAML assertions expose full tool metadata for description-sensitive checks

key-files:
  created:
    - tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py
    - tests/scenarios/integration/tests/brokered_host_dispatch.yml
    - tests/scenarios/integration/tests/host_tool_search_with_brokered.yml
    - tests/scenarios/integration/tests/host_empty_section.yml
    - tests/scenarios/integration/tests/host_mcp_tools_with_brokered.yml
    - tests/scenarios/integration/tests/brokered_host_registration.yml
    - tests/scenarios/integration/tests/brokered_no_tier_classification.yml
    - .planning/phases/142-host-surface-and-consumer-context/142-05-SUMMARY.md
  modified:
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - tests/scenarios/integration/run_integration.py

key-decisions:
  - "142-05: YAML mcp.list_tools assertions now serialize full tool objects so host brokered description_override can be validated through the public tools/list surface."
  - "142-05: MCB-13 is exercised through public nested macro re-entry because delegated call_model intentionally hard-excludes call_macro; purpose-rooted inheritance remains covered by 142-03 unit coverage."

patterns-established:
  - "Phase D public scenario labels include both MCB/INT-MCB IDs and source T-S/T-Y IDs."
  - "Description-sensitive host listTools YAML checks use public mcp.list_tools metadata rather than SDK internals."

requirements-completed: [REQ-005, REQ-006, REQ-009, REQ-010, REQ-031, REQ-035, REQ-065, REQ-066, REQ-067, REQ-113, REQ-114, REQ-115, REQ-116, REQ-117, REQ-118]

duration: 23m30s
completed: 2026-05-18
---

# Phase 142 Plan 5: Phase D Scenario Gates Summary

**Phase D public scenario gates now cover host brokered dispatch, host search, nested macro context, trace scope, and no-tier brokered visibility.**

## Performance

- **Duration:** 23m30s
- **Started:** 2026-05-18T20:39:10Z
- **Completed:** 2026-05-18T21:02:40Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added `test_mcp_broker_phase_d.py` with MCB-12 through MCB-16 labels and a Phase 140 carry-forward sibling.
- Added six managed YAML workflows for INT-MCB-02, INT-MCB-03, INT-MCB-06, INT-MCB-09, INT-MCB-10, and INT-MCB-11.
- Updated directed and integration coverage ledgers with Phase 142 rows and passing dates.
- Extended YAML `mcp.list_tools` assertions to expose full tool metadata, enabling public verification of `description_override: "X"` on host `tools/list`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add directed Phase D broker scenarios** - `adb30a3` (test)
2. **Task 2: Add Phase D YAML workflows and coverage rows** - `e10817c` (test)

## Files Created/Modified

- `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py` - Directed Phase D managed scenario coverage.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - MCB-12 through MCB-16 coverage rows.
- `tests/scenarios/integration/tests/brokered_host_dispatch.yml` - INT-MCB-02 host brokered dispatch workflow.
- `tests/scenarios/integration/tests/host_tool_search_with_brokered.yml` - INT-MCB-03 host search workflow.
- `tests/scenarios/integration/tests/host_empty_section.yml` - INT-MCB-06 empty host workflow.
- `tests/scenarios/integration/tests/host_mcp_tools_with_brokered.yml` - INT-MCB-09 native plus brokered host workflow.
- `tests/scenarios/integration/tests/brokered_host_registration.yml` - INT-MCB-10 host `tools/list` registration and override workflow.
- `tests/scenarios/integration/tests/brokered_no_tier_classification.yml` - INT-MCB-11 no broker-side tier workflow.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - INT-MCB Phase D coverage rows.
- `tests/scenarios/integration/run_integration.py` - Full `tools/list` metadata serialization for YAML assertions.

## Verification

- `npm run build` - passed.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_d` - passed, 6/6 steps, zero residue. The hosted Supabase cleanup helper timed out before/after the run, but strict cleanup still reported zero residue.
- `python3 tests/scenarios/integration/run_integration.py --managed brokered_host_dispatch host_tool_search_with_brokered host_empty_section host_mcp_tools_with_brokered brokered_host_registration brokered_no_tier_classification` - passed, 6/6 workflows.

## Decisions Made

- `mcp.list_tools` YAML helper now returns full tool objects instead of names only; existing string-based name assertions still work, and description assertions are now possible.
- MCB-13 uses public nested macro re-entry rather than delegated `call_model -> call_macro`, because `call_macro` remains hard-excluded from delegated model access by design.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exposed full tools/list metadata in YAML runner**
- **Found during:** Task 2 (INT-MCB-10 host registration workflow)
- **Issue:** The YAML runner's `mcp.list_tools` helper serialized only tool names, so it could not prove host `tools/list` returned `description_override: "X"`.
- **Fix:** Changed the helper to serialize full public tool objects from the MCP `tools/list` result.
- **Files modified:** `tests/scenarios/integration/run_integration.py`
- **Verification:** `brokered_host_registration.yml` passed and asserted `"description": "X"` while excluding the upstream original description.
- **Committed in:** `e10817c`

**2. [Rule 1 - Test Contract Adjustment] Aligned MCB-13 with delegated hard-exclusion contract**
- **Found during:** Task 1 directed verification
- **Issue:** Attempting to initiate nested macro execution from `call_model` failed with `tool_not_in_registry` because `call_macro` is intentionally hard-excluded from delegated model access.
- **Fix:** Exercised nested macro re-entry through the public macro surface while preserving MCB-13 labeling; purpose-rooted ConsumerContext inheritance remains covered by the 142-03 unit suite.
- **Files modified:** `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py`
- **Verification:** Directed Phase D suite passed 6/6 steps.
- **Committed in:** `adb30a3`

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 1 test contract adjustment).
**Impact on plan:** Public Phase D gates are green. The only semantic adjustment preserves the existing security contract that delegated models cannot invoke `call_macro` directly.

## Issues Encountered

The directed runner repeatedly printed hosted Supabase cleanup timeout warnings from `clean_test_tables.py`, but both directed and YAML managed runs completed with passing tests. The directed run reported zero residue.

## Known Stubs

None. Stub-pattern scan found only intentional test placeholders, typed empty collections, and historical ledger text.

## Threat Flags

None - this plan added scenario tests and a test-runner assertion helper. It did not introduce new production endpoints, auth paths, file access patterns, schema boundaries, or runtime trust boundaries.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` credentials used by the scenario runners.

## Next Phase Readiness

Ready for 142-06 final validation with Phase D directed and YAML public gates now mapped and passing.

## Self-Check: PASSED

- Found `tests/scenarios/directed/testcases/test_mcp_broker_phase_d.py`
- Found `tests/scenarios/integration/tests/brokered_host_dispatch.yml`
- Found `tests/scenarios/integration/tests/host_tool_search_with_brokered.yml`
- Found `tests/scenarios/integration/tests/host_empty_section.yml`
- Found `tests/scenarios/integration/tests/host_mcp_tools_with_brokered.yml`
- Found `tests/scenarios/integration/tests/brokered_host_registration.yml`
- Found `tests/scenarios/integration/tests/brokered_no_tier_classification.yml`
- Found `.planning/phases/142-host-surface-and-consumer-context/142-05-SUMMARY.md`
- Found commit `adb30a3`
- Found commit `e10817c`

---
*Phase: 142-host-surface-and-consumer-context*
*Completed: 2026-05-18*
