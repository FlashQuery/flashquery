---
phase: 142-host-surface-and-consumer-context
plan: 3
subsystem: mcp
tags: [mcp-broker, trace, consumer-context, macro, vitest]

requires:
  - phase: 142-host-surface-and-consumer-context
    provides: host brokered registration and host trace recording from 142-02
  - phase: 140-tofu-schema-pinning-and-tool-list-change-handling
    provides: autonomous interactive:false TOFU drift behavior
provides:
  - Public `call_model` brokered `tool_calls` metadata, including empty arrays on traced calls
  - Sanitized consumer scope fields on brokered tool-call trace entries
  - Nested `fq.call_macro` re-entry with inherited host/purpose trace and interactive context
  - T-E-D1 host macro trace inheritance evidence in broker E2E coverage
affects: [phase-142, mcp-broker-tracing, macro-runtime, delegated-consumer-context]

tech-stack:
  added: []
  patterns:
    - MacroCallerContext carries the outer ConsumerContext through NativeToolDispatchContext.
    - Public macro entry infers configured broker refs from source when live listing is unavailable.

key-files:
  created:
    - .planning/phases/142-host-surface-and-consumer-context/142-03-SUMMARY.md
  modified:
    - src/services/mcp-broker/trace.ts
    - src/services/mcp-broker/index.ts
    - src/llm/tool-dispatcher.ts
    - src/llm/tool-registry.ts
    - src/mcp/tools/llm.ts
    - src/mcp/tools/macro.ts
    - src/macro/registry.ts
    - src/macro/types.ts
    - tests/unit/llm-tool-dispatcher.test.ts
    - tests/unit/llm-tool.test.ts
    - tests/unit/macro-registry.test.ts
    - tests/e2e/mcp-broker.e2e.test.ts

key-decisions:
  - "142-03: `tool_calls` metadata is always present for traced `call_model` responses, using an empty array when no brokered calls occurred."
  - "142-03: Nested macro execution preserves the exact outer ConsumerContext via MacroCallerContext rather than reconstructing host defaults."
  - "142-03: `fq.call_macro` is callable from macro frames while `fq.call_model` remains delegated-hard-excluded."

patterns-established:
  - "Brokered trace entries expose only sanitized scope fields: consumer_kind, purpose_id, trace_id."
  - "Nested public call_macro re-entry uses parent macroCallerContext from NativeToolDispatchContext."

requirements-completed: [REQ-065, REQ-066, REQ-067, REQ-114, REQ-115]

duration: 18m48s
completed: 2026-05-18
---

# Phase 142 Plan 3: Trace Metadata And Nested ConsumerContext Summary

**Brokered tool calls now surface public `tool_calls` trace metadata and nested macros inherit the outer host or delegated consumer context.**

## Performance

- **Duration:** 18m48s
- **Started:** 2026-05-18T20:03:16Z
- **Completed:** 2026-05-18T20:22:04Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added `metadata.tool_calls` to traced `call_model` responses, including `[]` when no brokered calls occurred.
- Extended brokered trace entries with sanitized `consumer_kind`, `purpose_id`, and `trace_id` fields without exposing args, results, or raw errors.
- Threaded outer `ConsumerContext` through nested `fq.call_macro` execution so host trace scope, purpose visibility, and `interactive:false` survive re-entry.
- Added unit coverage for host trace inheritance, delegated hidden-server filtering, and autonomous pending-drift behavior across nested macro frames.
- Updated broker E2E coverage so T-E-D1 records host macro trace inheritance evidence.

## Task Commits

1. **Task 1 RED: Brokered trace metadata tests** - `9f71f2a` (test)
2. **Task 1 GREEN: Public tool_calls metadata and scope fields** - `52435b8` (feat)
3. **Task 2 RED: Nested macro context tests** - `683da27` (test)
4. **Task 2 GREEN: Nested macro context propagation** - `8c9e266` (feat)

## Files Created/Modified

- `src/services/mcp-broker/trace.ts` - Adds sanitized consumer scope to trace entries.
- `src/services/mcp-broker/index.ts` - Keeps consumer listing resilient to one unavailable visible server.
- `src/llm/tool-dispatcher.ts` - Records consumer context with delegated broker trace entries.
- `src/mcp/tools/llm.ts` - Emits traced `tool_calls` arrays in Mode 1 and Mode 2 metadata.
- `src/mcp/tools/macro.ts` - Establishes and propagates outer macro consumer context.
- `src/macro/registry.ts` - Reuses parent consumer context and enables nested `fq.call_macro`.
- `tests/unit/*` and `tests/e2e/mcp-broker.e2e.test.ts` - Focused coverage for trace metadata and nested context inheritance.

## Verification

- `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts` - passed, 28 tests.
- `npm test -- --run tests/unit/macro-registry.test.ts` - passed, 20 tests.
- `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro-registry.test.ts tests/unit/llm-tool.test.ts` - passed, 130 tests.
- `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` - passed, 3 tests.

## Decisions Made

- `tool_calls` is included for traced `call_model` responses even when empty; untraced responses still omit trace fields.
- Trace metadata uses flat snake_case fields to match public metadata conventions.
- Nested macro frames preserve the outer consumer context object through native dispatch context instead of re-deriving context per frame.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added public `call_model` handler coverage for empty `tool_calls`**
- **Found during:** Task 1
- **Issue:** The plan named `tests/unit/llm-tool-dispatcher.test.ts`, but the empty-array public metadata contract lives at the `call_model` handler boundary.
- **Fix:** Added focused coverage in `tests/unit/llm-tool.test.ts`.
- **Files modified:** `tests/unit/llm-tool.test.ts`
- **Verification:** Included in the 130-test unit verification run.
- **Committed in:** `9f71f2a`

**2. [Rule 3 - Blocking] Allowed public macro source refs to seed broker macro registry entries**
- **Found during:** Task 2 E2E verification
- **Issue:** In the E2E host macro path, live host listing could be empty before macro pre-scan, causing configured broker refs in source to fail as `unknown_server`.
- **Fix:** Inferred broker refs from macro source for servers visible to the current consumer, preserving cost config and still filtering out hidden servers.
- **Files modified:** `src/mcp/tools/macro.ts`, `src/macro/registry.ts`
- **Verification:** `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` passed.
- **Committed in:** `8c9e266`

**3. [Rule 3 - Blocking] Made consumer tool listing tolerate one unavailable visible server**
- **Found during:** Task 2 E2E verification
- **Issue:** Host startup registration could encounter an unavailable brokered server while another visible server was still usable.
- **Fix:** Changed `McpBroker.listToolsForConsumer` to settle per-server ensure attempts and return whatever visible tools are currently registered.
- **Files modified:** `src/services/mcp-broker/index.ts`
- **Verification:** Broker E2E suite passed without unhandled rejection.
- **Committed in:** `8c9e266`

---

**Total deviations:** 3 auto-fixed (1 Rule 2, 2 Rule 3)
**Impact on plan:** All fixes were required to expose the specified public metadata and keep nested macro execution correct under the existing E2E startup pattern.

## Issues Encountered

Existing tests encoded the old contract that `fq.call_macro` was unavailable inside macro frames. Those assertions were updated because Plan 142-03 intentionally introduces nested macro re-entry while keeping `fq.call_model` delegated-hard-excluded.

## Known Stubs

None.

## Threat Flags

None - the public trace metadata and nested consumer-context trust boundaries were already covered by the plan threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 142 can proceed to host search and shared lazy-spawn/TOFU integration with trace metadata, host macro trace inheritance, purpose visibility inheritance, and delegated autonomous fail-closed behavior in place.

## Self-Check: PASSED

- Found `src/services/mcp-broker/trace.ts`
- Found `src/mcp/tools/llm.ts`
- Found `src/mcp/tools/macro.ts`
- Found `src/macro/registry.ts`
- Found `tests/e2e/mcp-broker.e2e.test.ts`
- Found `.planning/phases/142-host-surface-and-consumer-context/142-03-SUMMARY.md`
- Found commit `9f71f2a`
- Found commit `52435b8`
- Found commit `683da27`
- Found commit `8c9e266`

---
*Phase: 142-host-surface-and-consumer-context*
*Completed: 2026-05-18*
