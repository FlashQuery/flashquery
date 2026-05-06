---
phase: 115-purpose-config-bindings-capabilities
plan: 04
subsystem: llm
tags: [capabilities, admission, call-model, mode2, llm]

requires:
  - phase: 115-purpose-config-bindings-capabilities
    provides: Purpose config schema and model capability declarations
provides:
  - Shared structured capability defaulting and diagnostics service
  - Startup Mode 2 admission validation for tool/template exposing purposes
  - call_model response_format plus tools pre-dispatch guard
affects: [phase-117, phase-118, phase-119, llm-discovery, agent-loop]

tech-stack:
  added: []
  patterns:
    - Pure capability admission service with reusable result objects
    - Runtime guard before provider dispatch for capability-sensitive requests

key-files:
  created:
    - src/llm/capabilities.ts
    - .planning/phases/115-purpose-config-bindings-capabilities/115-04-SUMMARY.md
  modified:
    - src/config/loader.ts
    - src/mcp/tools/llm.ts
    - tests/unit/llm-config.test.ts
    - tests/unit/llm-tool.test.ts

key-decisions:
  - "Only provider name openai with type openai-compatible receives default true structured capabilities."
  - "Unknown capability declarations and declared unsupported values both block Mode 2, but diagnostics distinguish them."
  - "response_format with model-visible exposure is blocked before provider dispatch unless structured_outputs_with_tools is true."

patterns-established:
  - "Capability checks return { ok, message } results so startup and runtime guards can share diagnostics."
  - "Discovery projection now exposes tags separately from structured capabilities."

requirements-completed: [CAP-01, CAP-03, CAP-05]

duration: 6 min
completed: 2026-05-06
---

# Phase 115 Plan 04: Capability Admission Summary

**Structured model capability defaults, Mode 2 startup admission, and response_format pre-dispatch guard**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-06T03:32:00Z
- **Completed:** 2026-05-06T03:37:52Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added capability defaulting and admission tests for OpenAI, OpenRouter, custom OpenAI-compatible providers, and Ollama.
- Created `src/llm/capabilities.ts` with reusable defaulting, Mode 2 admission, and response_format/tool compatibility checks.
- Wired `loadConfig()` to reject tool/template-exposing purposes when any fallback model lacks required tool capabilities.
- Updated `call_model` discovery to expose `tags` and structured `capabilities`, and added a pre-dispatch guard for unsupported `response_format` with tools.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add capability admission and pre-dispatch tests** - `8ada5f6` (test)
2. **Task 2: Implement shared capability defaulting and startup admission** - `3e84d6c` (feat)
3. **Task 3: Wire discovery projection and response_format guard** - `c0156af` (feat)

**Plan metadata:** this SUMMARY/tracking commit (docs)

## Files Created/Modified

- `src/llm/capabilities.ts` - Pure service for structured capability defaults, diagnostics, and admission checks.
- `src/config/loader.ts` - Calls capability admission after config normalization and final runtime config assembly.
- `src/mcp/tools/llm.ts` - Projects tags in discovery and blocks unsupported response_format plus tool exposure before provider calls.
- `tests/unit/llm-config.test.ts` - Covers capability defaults and startup Mode 2 admission diagnostics.
- `tests/unit/llm-tool.test.ts` - Covers discovery projection and CAP-05 runtime guard behavior.

## Decisions Made

- Used `undefined` to represent unknown capability declarations; unknown and false both deny Mode 2 but produce different messages.
- Treated explicit purpose `tools` and `templates` as the Phase 115 model-visible exposure signals.
- Kept runtime guard text human-readable because MCP tool errors are consumed directly by calling models.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool.test.ts` - passed
- `npm test -- tests/unit/llm-tool.test.ts && npm run build` - passed
- Plan gate `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool.test.ts && npm run build` - passed

## Self-Check: PASSED

- Key files exist on disk.
- Task commits exist for `115-04`.
- Plan-level verification passed.
- Requirements completed: CAP-01, CAP-03, CAP-05.

## Next Phase Readiness

Capability diagnostics are ready for config sync/runtime binding reuse in 115-03 and later agent-loop enforcement.

---
*Phase: 115-purpose-config-bindings-capabilities*
*Completed: 2026-05-06*
