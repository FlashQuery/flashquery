---
phase: 140-tofu-schema-pinning-and-tool-list-change-handling
plan: 03
subsystem: mcp-broker
tags: [mcp-broker, tofu, macro, needs-user-input, audit]

requires:
  - phase: 140-02
    provides: live tools/list_changed routing through shared TOFU, registry, and index-sink state
provides:
  - Macro needs_user_input termination path with preserved broker drift payloads
  - Typed broker schema-drift signal propagation from macro broker dispatch
  - Broker TOFU approve, reject, autonomous blocked_on_user, and audit event handling
affects: [phase-140-host-reapproval, phase-141-tool-search, macro-broker-dispatch]

tech-stack:
  added: []
  patterns:
    - Expected macro termination envelopes for user-mediated broker safety decisions
    - Broker-owned pending drift map with explicit approve/reject resolver
    - Structured broker audit records mirrored through trace helpers and optional audit sink

key-files:
  created: []
  modified:
    - src/macro/evaluator.ts
    - src/macro/types.ts
    - src/macro/registry.ts
    - src/services/mcp-broker/index.ts
    - src/services/mcp-broker/types.ts
    - src/services/mcp-broker/trace.ts
    - tests/unit/macro-termination.test.ts
    - tests/unit/macro-registry.test.ts

key-decisions:
  - "Macro needs_user_input is a non-runtime envelope with reason: needs_user_input and an opaque payload."
  - "Only typed SchemaDriftNeedsUserInputError broker signals are converted to macro needs_user_input; ordinary broker isError results still fail as tool_call_failed."
  - "Approval re-registers the pending changed tool and calls ToolIndexSink.addTools; rejection removes the pending state and keeps the changed tool blocked."
  - "Non-interactive list refreshes audit blocked_on_user and suppress prompt payload callbacks."

patterns-established:
  - "Broker drift propagation: SchemaDriftNeedsUserInputError -> MacroNeedsUserInputError -> evaluateProgram needs_user_input envelope."
  - "TOFU decisions: resolveSchemaDrift accepts pending scoped approve/reject decisions and emits mcp_broker_tofu_decision audit records."
  - "Autonomous drift: applyToolListSnapshot(..., { interactive: false }) records mcp_broker_tofu_blocked without onTofuDrift."

requirements-completed: [REQ-041, REQ-042, REQ-043, REQ-044, REQ-045, REQ-046, REQ-048, REQ-049, REQ-070, REQ-105]

duration: 7m23s
completed: 2026-05-18
---

# Phase 140 Plan 03: TOFU Schema Pinning And Tool-List Change Handling Summary

**Macro-visible TOFU drift now exits as needs_user_input, with broker approve/reject resolution and structured audit events**

## Performance

- **Duration:** 7m23s
- **Started:** 2026-05-18T13:39:09Z
- **Completed:** 2026-05-18T13:46:32Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added `MacroNeedsUserInputError` and evaluator handling that returns an expected `reason: "needs_user_input"` envelope while preserving broker drift payload fields.
- Added `SchemaDriftNeedsUserInputError` and macro registry propagation so broker-owned drift is the only broker path converted to `needs_user_input`.
- Added `McpBroker.resolveSchemaDrift`, pending drift inspection, autonomous `blocked_on_user` auditing, and TOFU decision audit records.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: needs_user_input termination tests** - `151e96b` (test)
2. **Task 1 GREEN: macro needs_user_input termination** - `61688cd` (feat)
3. **Task 2 RED: broker drift macro propagation test** - `2c7a9cb` (test)
4. **Task 2 GREEN: broker drift propagation** - `95b353d` (feat)
5. **Task 3 RED: TOFU decision and autonomous block tests** - `f4f6d60` (test)
6. **Task 3 GREEN: TOFU drift decision handling** - `34abf35` (feat)

## Files Created/Modified

- `src/macro/evaluator.ts` - Adds `MacroNeedsUserInputError` and a non-runtime needs-user-input result branch.
- `src/macro/types.ts` - Adds the macro needs-user-input payload contract.
- `src/macro/registry.ts` - Converts typed broker schema drift into macro needs-user-input while preserving ordinary broker failure behavior.
- `src/services/mcp-broker/index.ts` - Adds pending drift tracking, `getPendingSchemaDrift`, `resolveSchemaDrift`, autonomous blocking, and audit emission.
- `src/services/mcp-broker/types.ts` - Adds schema drift signal, resolver, snapshot options, interactivity, and TOFU audit event types.
- `src/services/mcp-broker/trace.ts` - Adds structured broker audit trace recording helpers.
- `tests/unit/macro-termination.test.ts` - Covers REQ-105 macro needs-user-input termination.
- `tests/unit/macro-registry.test.ts` - Covers broker drift propagation, approve, reject, and autonomous block behavior.

## Decisions Made

- Used an expected macro result envelope rather than `jsonRuntimeError`, so user mediation is distinguishable from runtime failure.
- Kept REQ-060 intact by converting only typed broker TOFU drift signals to `needs_user_input`; upstream `isError: true` broker results still map to `tool_call_failed`.
- Stored pending changed tools in the broker until resolution so approval can restore callable and indexed state without server-side sessions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. Stub scan found only normal empty arrays/objects and nullable values used for runtime state or tests, not placeholders or unimplemented behavior.

## Verification

- `npm test -- --run tests/unit/macro-termination.test.ts` - passed, 12 tests.
- `npm test -- --run tests/unit/macro-registry.test.ts tests/unit/macro-coerce.test.ts` - passed, 18 tests.
- `npm test -- --run tests/unit/macro-registry.test.ts tests/unit/macro-termination.test.ts` - passed, 27 tests.
- `npm test -- --run tests/unit/macro-termination.test.ts tests/unit/macro-registry.test.ts tests/unit/macro-coerce.test.ts && npm run build` - passed, 33 tests and production build.
- `rg -n "rateLimit|debounce|cooldown|throttle" src/services/mcp-broker || true` - no matches.

## Acceptance Criteria

- `src/macro/evaluator.ts` contains distinct `MacroNeedsUserInputError` handling and returns `reason: "needs_user_input"`.
- `tests/unit/macro-termination.test.ts` asserts `needs_user_input` preserves schema drift payload fields.
- `tests/unit/macro-registry.test.ts` proves typed broker drift returns a macro `needs_user_input` result containing `schema_drift_detected`.
- Existing broker `isError: true` coverage still returns `tool_call_failed`, not `needs_user_input`.
- `BrokerAuditEvent` represents `mcp_broker_tofu_decision` and `mcp_broker_tofu_blocked`.
- Tests prove approval restores the blocked tool, rejection keeps it blocked, and autonomous drift records `blocked_on_user` without prompt payload.
- No rate limiting, debounce, cooldown, or throttle identifiers were added under `src/services/mcp-broker`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Host and scenario layers can now consume the same broker drift payload and resolver APIs. Phase 141 can attach BM25 indexing to the existing `ToolIndexSink` knowing approval and rejection update index state synchronously.

## Self-Check: PASSED

- Modified files exist: `src/macro/evaluator.ts`, `src/macro/types.ts`, `src/macro/registry.ts`, `src/services/mcp-broker/index.ts`, `src/services/mcp-broker/types.ts`, `src/services/mcp-broker/trace.ts`, `tests/unit/macro-termination.test.ts`, and `tests/unit/macro-registry.test.ts`.
- Commits exist: `151e96b`, `61688cd`, `2c7a9cb`, `95b353d`, `f4f6d60`, `34abf35`.
- Verification commands passed.

---
*Phase: 140-tofu-schema-pinning-and-tool-list-change-handling*
*Completed: 2026-05-18*
