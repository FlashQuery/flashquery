---
phase: 117-agent-loop-executor
plan: 02
subsystem: llm
tags: [agent-loop, native-tools, dispatcher, zod, vitest]

requires:
  - phase: 116-model-visible-tool-registry
    provides: purpose-level native tool snapshots and OpenAI-compatible tool metadata
  - phase: 117-agent-loop-executor
    provides: Wave 1 RED dispatcher contracts
provides:
  - Captured native MCP handlers in the FlashQuery tool catalog
  - Snapshot-gated internal native tool dispatcher
  - Recoverable OpenAI-compatible tool messages for success, validation failures, handler errors, and aborts
affects: [phase-117, phase-118, phase-120, agent-loop-executor]

tech-stack:
  added: []
  patterns:
    - "Native tool catalog entries carry handler callbacks alongside registry metadata."
    - "Dispatcher returns stable JSON payloads instead of throwing through the loop."

key-files:
  created:
    - src/llm/tool-dispatcher.ts
  modified:
    - src/mcp/tool-catalog.ts
    - src/llm/tool-registry.ts
    - tests/unit/llm-tool-registry.test.ts
    - tests/unit/llm-tool-dispatcher.test.ts

key-decisions:
  - "Successful native dispatch payloads are serialized as { ok: true, result: rawHandlerResult }."
  - "Handler isError responses and thrown handler errors share the recoverable handler_error code."

patterns-established:
  - "Native dispatch accepts the immutable nativeToolNames snapshot and refuses names outside it even when they exist in the full catalog."
  - "Batch dispatch uses Promise.allSettled and preserves one tool message per requested tool_call_id."

requirements-completed: [TOOL-05, TOOL-06, LOOP-03]

duration: 9min
completed: 2026-05-06
---

# Phase 117 Plan 02: Internal Native Dispatcher Summary

**Snapshot-gated native tool dispatch through captured FlashQuery handlers with recoverable JSON tool messages.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-06T14:57:00Z
- **Completed:** 2026-05-06T15:02:04Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Captured native MCP tool handlers in `wrapServerWithToolCatalog()` without changing the SDK `registerTool` delegation path.
- Added `NativeToolDispatchContext`, `NativeToolHandler`, and `NativeToolResponse` types for loop timeout/shutdown context propagation.
- Implemented `dispatchNativeToolCall()` and `dispatchToolCalls()` with snapshot allowlist checks, Zod validation, abort handling, recoverable error payloads, and calls-log entries.

## Task Commits

1. **Task 1 RED: Capture native handlers in the MCP catalog** - `daed815` (test)
2. **Task 1 GREEN: Capture native handlers in the MCP catalog** - `2a0de9f` (feat)
3. **Task 2 RED: Implement snapshot-based native dispatch and tool messages** - `d656ae5` (test)
4. **Task 2 GREEN: Implement snapshot-based native dispatch and tool messages** - `d98a215` (feat)

## Files Created/Modified

- `src/llm/tool-dispatcher.ts` - Snapshot-based dispatcher with JSON tool messages and batch all-settled semantics.
- `src/llm/tool-registry.ts` - Native handler, response, and dispatch-context types added to catalog definitions.
- `src/mcp/tool-catalog.ts` - Captures adapted native handlers while preserving SDK registration behavior.
- `tests/unit/llm-tool-registry.test.ts` - Handler capture RED/GREEN coverage plus updated typed catalog fixtures.
- `tests/unit/llm-tool-dispatcher.test.ts` - Dispatcher payload and sibling-success contracts.

## Decisions Made

Successful tool messages wrap handler output as `{ ok: true, result: rawHandlerResult }` so success and error payloads share a stable discriminated envelope.

Handler `isError: true` and thrown handler failures both map to `handler_error`; details remain available in the JSON payload where useful.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Wave 1 RED tests included an older success serialization expectation. It was updated during the Task 2 RED gate to match this plan's stable `{ ok: true, result }` payload contract.

`VAL-117` appears in the plan frontmatter, but the full Phase 117 validation requirement remains pending because E2E, directed scenario, fallback, usage aggregation, and coverage-ledger closure are scheduled for 117-05.

## Verification

- `npm test -- tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool-registry.test.ts` - 30 tests passed.
- `npm run build` - production ESM and DTS build succeeded.
- Acceptance greps passed for handler/context capture, unchanged SDK delegation, `Promise.allSettled`, abort handling, stable error codes, and JSON serialization.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 117-03 can use captured catalog handlers and `dispatchToolCalls()` as the internal native dispatch primitive for the Mode 2 loop executor.

## TDD Gate Compliance

- RED gate commits exist: `daed815`, `d656ae5`.
- GREEN gate commits exist after RED gates: `2a0de9f`, `d98a215`.
- No refactor gate was needed.

## Self-Check: PASSED

- Created file exists: `src/llm/tool-dispatcher.ts`.
- Summary file exists: `.planning/phases/117-agent-loop-executor/117-agent-loop-executor-02-SUMMARY.md`.
- Task commits exist: `daed815`, `2a0de9f`, `d656ae5`, `d98a215`.
- Verification commands passed.

---
*Phase: 117-agent-loop-executor*
*Completed: 2026-05-06*
