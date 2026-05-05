---
phase: 112-chat-primitive-envelope-migration
plan: 02
subsystem: llm
tags: [llm, chat, fallback, provider-normalization]
requires:
  - phase: 112-01
    provides: Canonical chat and finish reason contracts
provides:
  - Provider-normalized chat() primitive and shared purpose fallback for chat/text wrappers
affects: [call_model, phase-117, llm-client]
tech-stack:
  added: []
  patterns: [HTTP-only chat path, text wrapper over chat, generic purpose fallback]
key-files:
  created: []
  modified: [src/llm/client.ts, src/llm/resolver.ts, tests/unit/llm-client.test.ts, tests/unit/llm-resolver.test.ts]
key-decisions:
  - "chat() and chatByPurpose() do not record usage; complete()/completeByPurpose() remain the usage-recording text wrappers."
patterns-established:
  - "Purpose fallback is generic over the result shape so chat and text wrappers share retry/backoff behavior."
requirements-completed: [CHAT-01, CHAT-02, CHAT-06]
duration: 20 min
completed: 2026-05-05
---

# Phase 112 Plan 02: Chat Primitive Summary

**Provider-normalized `chat()` primitive with tool-call normalization and text-wrapper compatibility**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-05T21:38:00Z
- **Completed:** 2026-05-05T21:53:19Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added `chat()` and `chatByPurpose()` to the LLM client interface and concrete clients.
- Normalized tool-call arguments, `function_call` finish reasons, empty tool-call content, and missing usage errors.
- Rewrote text wrappers to reject tool-call responses clearly while preserving cost recording.
- Generalized `PurposeResolver` so chat and text paths share fallback and 429 backoff behavior.

## Task Commits

1. **Tasks 1-3: chat primitive, text wrapper, purpose fallback** - `b0dc365`

## Files Created/Modified

- `src/llm/client.ts` - `chat()`, tool-call normalization, wrapper rejection, usage recording boundaries.
- `src/llm/resolver.ts` - Generic purpose fallback and `chatByPurpose()`.
- `tests/unit/llm-client.test.ts` - Provider normalization and wrapper compatibility coverage.
- `tests/unit/llm-resolver.test.ts` - Chat fallback and 429 backoff coverage.

## Decisions Made

Kept usage writes in text wrapper paths only so the lower-level chat primitive can be reused by later loop execution without double-counting.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can build the public `call_model` envelope on top of existing text wrappers while preserving the lower-level chat primitive for later ATL phases.

---
*Phase: 112-chat-primitive-envelope-migration*
*Completed: 2026-05-05*
