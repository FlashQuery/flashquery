---
phase: 117-agent-loop-executor
plan: 03
subsystem: llm
tags: [agent-loop, call_model, native-tools, usage-aggregation, vitest]

requires:
  - phase: 117-agent-loop-executor
    provides: RED loop contracts and internal native dispatcher from plans 01 and 02
  - phase: 116-model-visible-tool-registry
    provides: purpose-level native tool snapshots and OpenAI-compatible provider tools
provides:
  - Non-recording purpose chat path for Mode 2 loop iterations
  - Mode 2 stop reason constants and public calls-log metadata types
  - Guarded `executeAgentLoop()` state machine with native dispatch and aggregate usage accounting
affects: [phase-117, phase-118, phase-120, agent-loop-executor]

tech-stack:
  added: []
  patterns:
    - "Loop iterations use `chatByPurposeUnrecorded()` and write one aggregate usage row at completion."
    - "Detailed per-iteration usage remains in `metadata.tools.calls_log`; public usage storage receives aggregate totals only."

key-files:
  created:
    - src/llm/agent-loop.ts
  modified:
    - src/constants/llm.ts
    - src/llm/types.ts
    - src/llm/client.ts
    - tests/unit/llm-client.test.ts
    - tests/unit/llm-agent-loop.test.ts

key-decisions:
  - "The public recorded `chatByPurpose()` path remains unchanged; Mode 2 uses `chatByPurposeUnrecorded()` to avoid per-iteration rows."
  - "The executor preserves first successful iteration identity for the aggregate usage row while computing costs per completed iteration's actual model."

patterns-established:
  - "Mode 2 guardrails return stop reasons in `metadata.tools.stop_reason` and do not add stop metadata to usage rows."
  - "Native dispatch receives an AbortSignal plus trace/instance/logger context on each tool-call batch."

requirements-completed: [LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07, VAL-117]

duration: 6m33s
completed: 2026-05-06
---

# Phase 117 Plan 03: Mode 2 Loop Executor Summary

**Mode 2 loop executor with non-recording purpose chat, native dispatch guardrails, calls-log metadata, and single aggregate usage writes.**

## Performance

- **Duration:** 6m33s
- **Started:** 2026-05-06T15:07:09Z
- **Completed:** 2026-05-06T15:13:42Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added canonical Mode 2 stop reasons and public metadata contracts for calls logs, aggregate usage, and loop stop details.
- Added `chatByPurposeUnrecorded()` to the real and null LLM clients so loop iterations can use existing purpose fallback without recording usage per round.
- Implemented `executeAgentLoop()` with assistant/tool message history, native dispatcher context, timeout/shutdown/iteration/token/cost guardrails, per-model cost aggregation, and one aggregate usage write.

## Task Commits

1. **Task 1 RED: Add failing client loop contracts** - `3452656` (test)
2. **Task 1 GREEN: Add unrecorded purpose chat contracts** - `90c4543` (feat)
3. **Task 2 GREEN: Implement agent loop executor** - `ca50986` (feat)

## Files Created/Modified

- `src/llm/agent-loop.ts` - Mode 2 loop executor, guardrail checks, native dispatch integration, and aggregate usage write.
- `src/constants/llm.ts` - Canonical agent-loop stop reason constants and type.
- `src/llm/types.ts` - Public Mode 2 metadata, calls-log, tool-call log, and aggregate usage interfaces.
- `src/llm/client.ts` - `LlmClient` interface plus real/null `chatByPurposeUnrecorded()` methods.
- `tests/unit/llm-client.test.ts` - Stop reason, metadata type, and non-recording fallback client coverage.
- `tests/unit/llm-agent-loop.test.ts` - Corrected provider-error and fallback-cost contracts to require a non-final first turn before a second iteration.

## Decisions Made

Mode 2 cost recording is owned by the executor, not the client. The client now exposes a purpose-resolved chat path that preserves fallback behavior but delegates accounting to the caller.

The aggregate usage row uses the first successful iteration's model/provider/fallback identity, while `calls_log` preserves later fallback details and per-iteration cost arithmetic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected stale RED contracts that contradicted final-response stop behavior**
- **Found during:** Task 2
- **Issue:** Two existing loop tests expected the executor to make a second provider call after the first completed chat result returned final assistant text. The plan and product spec require the loop to stop at final assistant text.
- **Fix:** Updated those tests so provider-error and fallback-cost cases first return a tool-call assistant message, making the second iteration behavior valid.
- **Files modified:** `tests/unit/llm-agent-loop.test.ts`
- **Verification:** `npm test -- tests/unit/llm-agent-loop.test.ts` passed.
- **Committed in:** `ca50986`

**2. [Rule 1 - Bug] Isolated usage-recording mock state in the unrecorded client test**
- **Found during:** Task 1
- **Issue:** A previous client test left `recordLlmUsage` mock calls behind, causing the new unrecorded path assertion to read stale usage writes.
- **Fix:** Cleared mocks immediately before invoking `chatByPurposeUnrecorded()`.
- **Files modified:** `tests/unit/llm-client.test.ts`
- **Verification:** `npm test -- tests/unit/llm-client.test.ts` passed.
- **Committed in:** `90c4543`

---

**Total deviations:** 2 auto-fixed (Rule 1)
**Impact on plan:** Both fixes aligned tests with the documented Mode 2 contract and did not expand production scope.

## Issues Encountered

None beyond the auto-fixed test contract and mock-isolation issues above.

## Verification

- `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-client.test.ts` - 60 tests passed.
- `npm run build` - production ESM and DTS build succeeded.
- Acceptance grep for `executeAgentLoop`, `calls_log`, `stop_reason`, guardrail constants, `AbortController`, and `NativeToolDispatchContext` passed.
- Acceptance grep confirmed exactly one textual `recordLlmUsage` reference in `src/llm/agent-loop.ts`, the aliased import used for the single aggregate write path.

## Known Stubs

None. Empty arrays/strings found by the stub scan are local test fixtures, parser defaults, or safe initialized accumulators, not UI-facing or product stubs.

## Threat Flags

None. The new loop dispatch, provider, and usage-accounting surfaces are the planned trust boundaries from the 117-03 threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 117-04 can wire `call_model` purpose calls into `executeAgentLoop()` using the non-recording client path and Phase 116 registry assembly outputs.

## TDD Gate Compliance

- RED gate commit exists for Task 1: `3452656`.
- Task 2 reused the RED loop contracts created in 117-01 and made them pass in `ca50986`.
- GREEN commits exist after RED gates: `90c4543`, `ca50986`.
- No refactor gate was needed.

## Self-Check: PASSED

- Summary file exists: `.planning/phases/117-agent-loop-executor/117-03-SUMMARY.md`.
- Created file exists: `src/llm/agent-loop.ts`.
- Task commits exist: `3452656`, `90c4543`, `ca50986`.
- Verification commands passed.

---
*Phase: 117-agent-loop-executor*
*Completed: 2026-05-06*
