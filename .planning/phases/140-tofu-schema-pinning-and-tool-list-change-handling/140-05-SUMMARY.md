---
phase: 140-tofu-schema-pinning-and-tool-list-change-handling
plan: 05
subsystem: testing
tags: [mcp-broker, tofu, call_macro, e2e, directed-scenarios]

requires:
  - phase: 140-04
    provides: broker-level Phase B TOFU/list_changed integration coverage
provides:
  - Public Phase B E2E gate for call_macro TOFU drift and approval
  - Directed coverage for MCB-03, MCB-04, MCB-05, and MCB-17
  - Public call_macro re-entry path for TOFU approve/reject decisions
affects: [phase-140-yaml-validation, mcp-broker, macro, directed-coverage]

tech-stack:
  added: []
  patterns:
    - call_macro input_vars frontmatter.user_decisions resolves pending TOFU decisions before execution
    - Rejected TOFU hashes are retained separately so the same rejected schema stays blocked without re-prompting
    - Directed managed-server scenarios use server-quirky dynamic snapshots for public macro TOFU workflows

key-files:
  created:
    - tests/scenarios/directed/testcases/test_mcp_broker_phase_b.py
  modified:
    - src/macro/registry.ts
    - src/mcp/tools/macro.ts
    - src/services/mcp-broker/index.ts
    - src/services/mcp-broker/tofu.ts
    - src/services/mcp-broker/types.ts
    - tests/e2e/mcp-broker.e2e.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md

key-decisions:
  - "TOFU decisions are accepted through call_macro input_vars at the documented frontmatter.user_decisions.<server>__<tool>.tofu_decision answer_shape."
  - "Public macro registry construction includes pending drift refs so drifted tools surface needs_user_input instead of unknown_server/unknown_tool."
  - "Rejected pending hashes are retained to suppress repeated prompts for the same rejected upstream schema."

patterns-established:
  - "Public TOFU mediation: pending drift -> call_macro needs_user_input -> input_vars decision -> re-invocation."
  - "Directed Phase B broker scenarios force a dedicated managed server with deterministic server-quirky list_changed snapshots."

requirements-completed: [REQ-041, REQ-042, REQ-043, REQ-044, REQ-046, REQ-070, REQ-105]

duration: 26m13s
completed: 2026-05-18
---

# Phase 140 Plan 05: Phase B E2E And Directed Scenario Coverage Summary

**Public call_macro TOFU drift mediation now has E2E and directed coverage for drift, approval, rejection, and audit logging**

## Performance

- **Duration:** 26m13s
- **Started:** 2026-05-18T14:05:55Z
- **Completed:** 2026-05-18T14:32:08Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added T-E-B1 to the MCP broker E2E suite, covering public `call_macro` success, schema drift `needs_user_input`, approval re-entry, final success, and approval audit visibility.
- Added `test_mcp_broker_phase_b.py` with MCB-03, MCB-04, MCB-05, and MCB-17 directed coverage over the managed server path.
- Wired the documented TOFU `answer_shape` into `call_macro` input vars so approve/reject decisions can be applied on public macro re-invocation.
- Preserved rejected pending hashes so the same rejected changed schema remains blocked instead of prompting repeatedly.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add T-E-B1 public Phase B E2E gate** - `b47ce5c` (feat)
2. **Task 2: Add directed Phase B macro TOFU scenarios and coverage rows** - `db3e2d8` (feat)

## Files Created/Modified

- `tests/e2e/mcp-broker.e2e.test.ts` - Adds T-E-B1 public macro drift/approval E2E coverage using the quirky fixture.
- `tests/scenarios/directed/testcases/test_mcp_broker_phase_b.py` - Adds directed managed-server coverage for MCB-03, MCB-04, MCB-05, and MCB-17.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Registers Phase 140 MCB coverage rows.
- `src/mcp/tools/macro.ts` - Applies TOFU decisions from `input_vars.frontmatter.user_decisions` and includes pending drift refs in macro registry construction.
- `src/macro/registry.ts` - Converts pending drift refs into macro `needs_user_input` instead of unknown tool errors.
- `src/services/mcp-broker/index.ts` - Exposes pending/resolve APIs on the broker contract, logs TOFU audit events, and allows rejection without a pending tool snapshot.
- `src/services/mcp-broker/tofu.ts` - Retains rejected pending hashes/schemas to keep rejected changed schemas blocked.
- `src/services/mcp-broker/types.ts` - Extends broker and TOFU entry contracts for pending resolution and rejected hash state.

## Decisions Made

- Used `input_vars.frontmatter.user_decisions.<server>__<tool>.tofu_decision` as the public re-entry surface because it matches the broker payload `answer_shape`.
- Kept directed scenarios at the public MCP `call_macro` layer, with no direct in-process broker access.
- Logged TOFU decisions through the existing managed-server log stream for scenario-level trace assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added public TOFU decision re-entry for call_macro**
- **Found during:** Task 2
- **Issue:** The directed harness could not apply approve/reject decisions through the public server because only the in-memory broker resolver existed.
- **Fix:** `call_macro` now reads `input_vars.frontmatter.user_decisions.<server>__<tool>.tofu_decision` and applies pending TOFU decisions before macro execution.
- **Files modified:** `src/mcp/tools/macro.ts`, `src/services/mcp-broker/types.ts`, `src/services/mcp-broker/index.ts`
- **Verification:** E2E and directed Phase B commands passed.
- **Committed in:** `db3e2d8`

**2. [Rule 1 - Bug] Surfaced pending drift as needs_user_input instead of unknown tool**
- **Found during:** Task 1
- **Issue:** Once `list_changed` removed a drifted tool from the callable registry, public macro re-invocation saw `unknown_server` before it could surface the pending TOFU payload.
- **Fix:** Macro registry construction now includes pending drift refs, and brokered macro dispatch converts pending refs to the existing `needs_user_input` payload.
- **Files modified:** `src/macro/registry.ts`, `src/mcp/tools/macro.ts`, `src/services/mcp-broker/types.ts`, `src/services/mcp-broker/index.ts`
- **Verification:** `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` passed.
- **Committed in:** `b47ce5c`, extended in `db3e2d8`

**3. [Rule 1 - Bug] Preserved rejected schema hashes to prevent repeated prompts**
- **Found during:** Task 2
- **Issue:** Rejecting a schema cleared the pending hash; the next `tools/list` observation of the same rejected schema created a fresh prompt instead of keeping the tool blocked.
- **Fix:** TOFU entries now retain `rejectedHash`/`rejectedSchema`; observations of the same rejected hash return blocked without drift, while a different future hash can still prompt.
- **Files modified:** `src/services/mcp-broker/tofu.ts`, `src/services/mcp-broker/types.ts`
- **Verification:** Directed MCB-05 passed.
- **Committed in:** `db3e2d8`

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 2 missing critical functionality).
**Impact on plan:** All fixes were required to make the planned public E2E and directed workflows true end to end. Scope stayed inside Phase B TOFU mediation.

## Issues Encountered

- The directed runner's DB cleanup helper timed out before and after scenario runs. The scenario itself passed 4/4 steps and reported `RESIDUE: 0`, matching prior Phase 139 behavior.
- The directed harness runs the built `dist` bundle, so `npm run build` was required before rerunning the scenario after source changes.

## Known Stubs

None. Stub scan found only normal empty arrays, objects, and nullable guards used as runtime state or test accumulators.

## Verification

- `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` - passed, 2 tests.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_b` - passed, 4/4 steps, zero residue. Latest report: `tests/scenarios/directed/reports/scenario-report-2026-05-18-113118.md`.
- `npm run build` - passed.

## Acceptance Criteria

- `tests/e2e/mcp-broker.e2e.test.ts` contains `T-E-B1`.
- E2E asserts `reason: "needs_user_input"`.
- E2E asserts payload `event: "schema_drift_detected"` and both `old_schema` and `new_schema`.
- `DIRECTED_COVERAGE.md` contains MCB-03, MCB-04, MCB-05, and MCB-17.
- `test_mcp_broker_phase_b.py` contains the required scenario function names and passes through the directed runner.

## User Setup Required

None - no new external service configuration required. Verification used existing `.env.test` credentials and local fixture MCP server processes.

## Next Phase Readiness

Plan 140-06 can add the Phase B YAML workflow and validation record on top of the now-public TOFU mediation path and directed coverage rows.

## Self-Check: PASSED

- Created file exists: `tests/scenarios/directed/testcases/test_mcp_broker_phase_b.py`.
- Summary file exists at `.planning/phases/140-tofu-schema-pinning-and-tool-list-change-handling/140-05-SUMMARY.md`.
- Commits exist: `b47ce5c`, `db3e2d8`.
- Verification commands passed.

---
*Phase: 140-tofu-schema-pinning-and-tool-list-change-handling*
*Completed: 2026-05-18*
