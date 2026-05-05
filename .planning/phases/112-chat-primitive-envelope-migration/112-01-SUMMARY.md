---
phase: 112-chat-primitive-envelope-migration
plan: 01
subsystem: llm
tags: [llm, chat, types, call-model]
requires: []
provides:
  - Canonical LLM finish reason constants and chat/envelope TypeScript contracts
affects: [phase-113, phase-117, call_model, llm-client]
tech-stack:
  added: []
  patterns: [constants-backed finish reasons, separate narrow text messages and wider chat messages]
key-files:
  created: [src/constants/llm.ts, src/llm/types.ts]
  modified: []
key-decisions:
  - "Preserved ChatMessage as the narrow text-wrapper contract and added wider LlmChatMessage/CallModelMessage types separately."
patterns-established:
  - "Provider/tool-loop message shape lives in src/llm/types.ts instead of handler-local aliases."
requirements-completed: [CHAT-01, CHAT-03, CHAT-04, CHAT-06]
duration: 10 min
completed: 2026-05-05
---

# Phase 112 Plan 01: Canonical Message Contracts Summary

**Constants-backed finish reasons and shared LLM chat/envelope types for Phase 112 and later ATL work**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-05T21:38:00Z
- **Completed:** 2026-05-05T21:53:19Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added `FINISH_REASONS`, `FinishReason`, `LLM_PARTICIPANT_NAMES`, and `isFinishReason`.
- Added canonical `LlmChatToolCall`, `LlmChatMessage`, `LlmChatResult`, `CallModelMessage`, and `CallModelEnvelope` types.
- Kept the existing text wrapper `ChatMessage` contract narrow with `content: string`.

## Task Commits

1. **Task 1-2: Constants and canonical types** - `0f95dfd`
2. **Task 3: Contract coverage** - covered in `b0dc365` and `8e5ac20` focused tests

## Files Created/Modified

- `src/constants/llm.ts` - Finish reason and participant-name constants.
- `src/llm/types.ts` - Shared chat result/message and call_model envelope contracts.

## Decisions Made

Preserved text-wrapper compatibility by keeping `ChatMessage` unchanged and adding separate wider types for chat/envelope traffic.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can consume the canonical `LlmChatResult` and `FinishReason` contracts for provider normalization.

---
*Phase: 112-chat-primitive-envelope-migration*
*Completed: 2026-05-05*
