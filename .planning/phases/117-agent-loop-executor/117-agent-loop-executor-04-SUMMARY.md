---
phase: 117-agent-loop-executor
plan: 04
subsystem: llm
tags: [call_model, agent-loop, mode-2, native-tools, vitest]

requires:
  - phase: 117-agent-loop-executor
    provides: non-recording purpose chat, native dispatcher, and executeAgentLoop from plans 02 and 03
  - phase: 116-model-visible-tool-registry
    provides: final purpose model-visible native registry and provider tool schemas
provides:
  - Public call_model Mode 2 routing through executeAgentLoop
  - Mode 3 caller-provided tool rejection at the MCP handler boundary
  - Mode 2 response envelope mapping with final assistant text, trace totals, public tool metadata, and return_messages rules
affects: [phase-117, phase-118, phase-119, agent-loop-executor, call_model]

tech-stack:
  added: []
  patterns:
    - "Mode 2 selection uses final provider tool definitions through hasModelVisibleTools(), not native-tool count."
    - "call_model maps executor output into the public envelope instead of returning executor internals directly."

key-files:
  created: []
  modified:
    - src/mcp/tools/llm.ts
    - tests/unit/llm-tool.test.ts
    - tests/e2e/call-model-agent-loop.e2e.test.ts

key-decisions:
  - "Caller-provided provider tools are rejected as deferred Mode 3 input before Mode 1/Mode 2 dispatch."
  - "Mode 2 public messages are derived from return_messages, while executor loop history remains internal unless explicitly requested."

patterns-established:
  - "Mode 2 trace_cumulative is computed from the pre-call usage snapshot plus aggregate loop totals."
  - "Loop diagnostics are converted to public snake_case metadata at the MCP boundary."

requirements-completed: [LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07, TOOL-05, TOOL-06, VAL-117]

duration: 16min
completed: 2026-05-06
---

# Phase 117 Plan 04: call_model Mode 2 Wiring Summary

**Public call_model purpose requests now execute FlashQuery-managed Mode 2 loops and return final assistant text with complete loop metadata.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-06T15:17:57Z
- **Completed:** 2026-05-06T15:33:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Routed purpose calls with a non-empty final model-visible registry into `executeAgentLoop()` using `chatByPurposeUnrecorded()`.
- Added a registry-level `hasModelVisibleTools()` selector so future template-only provider tools also choose Mode 2.
- Rejected caller-provided tool definitions as deferred Mode 3 input before dispatch.
- Mapped executor output into the public `CallModelEnvelope`: final `response`, `metadata.tools`, aggregate usage, trace cumulative totals, and `return_messages` behavior.
- Strengthened unit and E2E coverage for default empty Mode 2 messages, returned assistant/tool loop history, and native loop public contracts.

## Task Commits

1. **Task 1 RED: Route purpose calls with non-empty registry to the agent loop** - `db263ec` (test)
2. **Task 1 GREEN: Route purpose calls with non-empty registry to the agent loop** - `faf261b` (feat)
3. **Task 2 RED: Build Mode 2 response envelope and returned message behavior** - `1174072` (test)
4. **Task 2 GREEN: Build Mode 2 response envelope and returned message behavior** - `723e645` (feat)

## Files Created/Modified

- `src/mcp/tools/llm.ts` - Adds Mode 2 registry selector, caller-tool rejection, executor invocation, and public envelope adapter.
- `tests/unit/llm-tool.test.ts` - Covers Mode 2 routing, selector behavior, Mode 3 rejection, public metadata, trace totals, and returned message rules.
- `tests/e2e/call-model-agent-loop.e2e.test.ts` - Covers public native loop messages, default empty messages, nested calls-log tool entries, and Mode 3 rejection through MCP.

## Decisions Made

Mode 2 selection is based on final provider-visible tool definitions so template-only registries from Phase 118 will route through the loop without changing the selector.

The executor remains free to keep full loop history internally, while `call_model` owns the public envelope contract and suppresses `messages` unless `return_messages: true`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected stale E2E assertions for public loop metadata and error testing**
- **Found during:** Task 2
- **Issue:** The E2E parallel-tool assertion treated `calls_log` as if each tool call were a top-level iteration, and the Mode 3 rejection test used a success-only helper that hid MCP `isError` responses.
- **Fix:** Asserted nested `calls_log[].tool_calls` entries and called `client.callTool()` directly for the expected `isError: true` response.
- **Files modified:** `tests/e2e/call-model-agent-loop.e2e.test.ts`
- **Verification:** `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` passed.
- **Committed in:** `723e645`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Test assertions now match the public loop metadata shape and do not expand production scope.

## Issues Encountered

None beyond the auto-fixed E2E assertion/helper issue above.

## Verification

- `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts` - 3 files / 92 tests passed.
- `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` - 1 file / 5 tests passed.
- `npm run build` - production ESM and DTS build succeeded.
- Acceptance greps passed for `executeAgentLoop`, no `nativeToolNames.length > 0` selector, registry-level `hasModelVisibleTools` / `providerTools.length`, no Mode 2 `chatByPurpose(` iteration usage, and `stop_reason` / `calls_log` / `aggregate_usage` / `return_messages` assertions.

## Known Stubs

None. Stub scan matches were initialized test arrays, parser fixture placeholder strings, and existing null checks; no UI-facing or product-blocking stubs were introduced.

## Threat Flags

None. This plan wired the threat-modeled `call_model` Mode 2 branch and did not introduce new network endpoints, schema changes, auth paths, or file access surfaces outside the plan.

## User Setup Required

None - no external service configuration required beyond the existing managed E2E environment.

## Next Phase Readiness

Plan 117-05 can validate the broader Phase 117 surface using the public `call_model` Mode 2 route. Phase 118 can add template provider tools and rely on `hasModelVisibleTools()` to select Mode 2 for template-only registries.

## TDD Gate Compliance

- RED gate commits exist: `db263ec`, `1174072`.
- GREEN gate commits exist after RED gates: `faf261b`, `723e645`.
- No refactor gate was needed.

## Self-Check: PASSED

- Summary file exists: `.planning/phases/117-agent-loop-executor/117-agent-loop-executor-04-SUMMARY.md`.
- Task commits exist: `db263ec`, `faf261b`, `1174072`, `723e645`.
- Modified files exist: `src/mcp/tools/llm.ts`, `tests/unit/llm-tool.test.ts`, `tests/e2e/call-model-agent-loop.e2e.test.ts`.
- Verification commands passed.

---
*Phase: 117-agent-loop-executor*
*Completed: 2026-05-06*
