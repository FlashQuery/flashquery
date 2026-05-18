---
phase: 139-broker-foundation-registry-and-dispatch
plan: 5
subsystem: testing
tags: [mcp-broker, call_macro, e2e, directed-scenarios, trace]

requires:
  - phase: 139-04
    provides: broker dispatch seams for agent loop and macro execution
provides:
  - Phase A E2E gate for public call_macro to stdio brokered tool dispatch
  - Directed coverage for MCB-01, MCB-02, and MCB-18
  - Public MCP server broker wiring required by the E2E path
affects: [mcp-broker, macro, directed-coverage, e2e]

tech-stack:
  added: []
  patterns:
    - HTTP MCP E2E using StreamableHTTPServerTransport and stdio MCP fixtures
    - Directed scenario managed server with test-local broker fixture config

key-files:
  created:
    - tests/e2e/mcp-broker.e2e.test.ts
    - tests/scenarios/directed/testcases/test_mcp_broker_phase_a.py
  modified:
    - src/mcp/server.ts
    - src/mcp/tools/macro.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md

key-decisions:
  - "Threaded the MCP session ID into public call_macro broker dispatch as the trace ID so brokered tool_calls trace snapshots are observable through the Phase 139 trace helper."
  - "Directed Phase A broker scenarios force a dedicated managed server because the test must inject mcp_servers fixture config."

patterns-established:
  - "Public call_macro builds brokered macro tool entries from broker.listToolsForConsumer before macro parsing and dispatch."
  - "MCP Broker directed scenarios can use TypeScript fixture servers through test-local extra_config with node --import tsx."

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

duration: 14m12s
completed: 2026-05-18
---

# Phase 139 Plan 05: Phase A Broker Coverage Summary

**Public call_macro E2E and directed Phase A scenarios now prove stdio broker dispatch, fail-fast broker errors, and reverse-request audit posture.**

## Performance

- **Duration:** 14m12s
- **Started:** 2026-05-18T02:03:42Z
- **Completed:** 2026-05-18T02:17:54Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `tests/e2e/mcp-broker.e2e.test.ts` as T-E-A1, driving public `call_macro` over a real MCP HTTP transport into a lazily spawned stdio fixture server.
- Wired the public MCP server's `call_macro` registration to the production broker and session trace ID so brokered macro calls record resolved cost in the Phase 139 trace snapshot.
- Added `test_mcp_broker_phase_a.py` and MCB-01, MCB-02, and MCB-18 matrix rows for managed directed scenario coverage.

## Task Commits

1. **Task 1 RED: Add failing Phase A broker E2E gate** - `9442c21` (test)
2. **Task 1 GREEN: Wire broker into public call_macro** - `1c13a08` (feat)
3. **Task 2: Add directed MCP Broker Phase A scenarios** - `4abbe5e` (test)

## Files Created/Modified

- `tests/e2e/mcp-broker.e2e.test.ts` - E2E gate for public `call_macro` invoking `basic.echo` through stdio broker dispatch and asserting trace cost recording.
- `src/mcp/server.ts` - Creates or accepts a production broker and passes it into macro tool registration.
- `src/mcp/tools/macro.ts` - Builds brokered macro tool entries from consumer-visible broker tools and threads session IDs into broker trace context.
- `tests/scenarios/directed/testcases/test_mcp_broker_phase_a.py` - Managed directed scenario for broker success, fail-fast `isError`, and reverse-request audit logging.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Adds MCB-01, MCB-02, and MCB-18 rows.

## Decisions Made

- Used the MCP session ID as the public `call_macro` trace ID for brokered macro dispatch because the public tool surface has no explicit trace parameter.
- Forced the directed scenario to start its own managed server so the scenario can inject broker fixture config deterministically instead of relying on the shared runner server config.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Wired public call_macro to the production broker**
- **Found during:** Task 1
- **Issue:** The E2E RED run showed public `call_macro` could not reach configured brokered tools because `createMcpServer` registered macro tools with the null broker.
- **Fix:** `createMcpServer` now creates or accepts a broker and passes it to `registerMacroTools`; `registerMacroTools` derives brokered macro tool entries from `broker.listToolsForConsumer`.
- **Files modified:** `src/mcp/server.ts`, `src/mcp/tools/macro.ts`, `tests/e2e/mcp-broker.e2e.test.ts`
- **Verification:** `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts`
- **Committed in:** `1c13a08`

**2. [Rule 3 - Blocking Test Issue] Corrected directed scenario project-root helper**
- **Found during:** Task 2
- **Issue:** The first directed run generated fixture paths under `tests/tests/fixtures/...`, causing broker startup failure.
- **Fix:** Corrected the test-local project root resolution from `parents[3]` to `parents[4]`.
- **Files modified:** `tests/scenarios/directed/testcases/test_mcp_broker_phase_a.py`
- **Verification:** `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_a`
- **Committed in:** `4abbe5e`

---

**Total deviations:** 2 auto-fixed (1 missing critical functionality, 1 blocking test issue)
**Impact on plan:** Both fixes were required to execute the planned public workflows. Scope stayed inside Plan 05's E2E and directed coverage surface.

## Issues Encountered

- The directed runner's shared managed DB cleanup helper timed out before and after the scenario in the verification runs. The scenario still passed 3/3 steps and reported `RESIDUE: 0`, so this was recorded as a cleanup warning rather than a failing acceptance criterion.

## Verification

- `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` - passed, 1 test.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_a` - passed, 3/3 steps, zero residue. Latest report: `tests/scenarios/directed/reports/scenario-report-2026-05-17-231727.md`.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: public-mcp-to-subprocess | `src/mcp/server.ts` / `src/mcp/tools/macro.ts` | Plan-owned public MCP call to brokered subprocess path was enabled for `call_macro`; covered by T-E-A1 and MCB-01/MCB-02/MCB-18. |

## User Setup Required

None - no new external service configuration required. Directed verification used existing `.env.test` credentials.

## Next Phase Readiness

Phase A coverage is represented in E2E and directed scenarios. Plan 06 can build on broker foundation coverage with final validation and any remaining Phase 139 closure checks.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/139-broker-foundation-registry-and-dispatch/139-05-SUMMARY.md`.
- Task commits exist: `9442c21`, `1c13a08`, `4abbe5e`.
- Key files exist and verification commands passed.

---
*Phase: 139-broker-foundation-registry-and-dispatch*
*Completed: 2026-05-18*
