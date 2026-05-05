---
phase: 112-chat-primitive-envelope-migration
plan: 03
subsystem: mcp
tags: [call_model, envelope, return_messages, references]
requires:
  - phase: 112-01
    provides: CallModelMessage and CallModelEnvelope contracts
  - phase: 112-02
    provides: Text wrapper compatibility
provides:
  - Additive call_model messages envelope and widened round-trippable message input schema
affects: [call_model, directed-scenarios, phase-113]
tech-stack:
  added: []
  patterns: [discovery early returns, host-authored reference scanning, hydrated returned messages]
key-files:
  created: []
  modified: [src/mcp/tools/llm.ts, tests/unit/llm-tool.test.ts]
key-decisions:
  - "Discovery resolvers return before message/reference validation and ignore return_messages."
patterns-established:
  - "return_messages true returns hydrated host input plus final assistant output; false returns messages: []."
requirements-completed: [CHAT-03, CHAT-04, CHAT-05]
duration: 15 min
completed: 2026-05-05
---

# Phase 112 Plan 03: call_model Envelope Summary

**Additive `call_model` response messages envelope with round-trippable input messages**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-05T21:38:00Z
- **Completed:** 2026-05-05T21:53:19Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Widened `call_model` input messages to accept nullable content, `name`, `tool_call_id`, and `tool_calls`.
- Added optional `return_messages` and root `messages` on successful model/purpose envelopes.
- Ensured returned messages use post-hydration input and append one final assistant message.
- Added unit coverage proving discovery resolvers keep raw shapes and ignore `return_messages`.

## Task Commits

1. **Tasks 1-3: schema widening, response messages, discovery compatibility** - `8e5ac20`

## Files Created/Modified

- `src/mcp/tools/llm.ts` - Widened schema, host-reference scan, and `messages` envelope assembly.
- `tests/unit/llm-tool.test.ts` - MCP boundary tests for default/true `return_messages` and discovery raw shapes.

## Decisions Made

Reference parsing scans only string content from host-authored inputs; null/non-string content is treated as empty for Phase 112 reference parsing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04 can validate public `return_messages` behavior through the directed scenario harness.

---
*Phase: 112-chat-primitive-envelope-migration*
*Completed: 2026-05-05*
