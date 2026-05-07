---
phase: 120-cross-phase-atl-validation-coverage-closure
plan: 01
subsystem: testing
tags: [atl, e2e, call_model, capabilities, discovery]
requires:
  - phase: 119
    provides: call_model discovery/help resolver surfaces
provides:
  - Explicit ATL-E2E-01 Mode 1 envelope and raw discovery E2E coverage
  - Explicit ATL-E2E-08 capability guard E2E coverage before provider dispatch
  - Focused ATL E2E gate evidence for agent-loop and template-tool suites
affects: [phase-120, atl-validation, e2e]
tech-stack:
  added: []
  patterns: [local OpenAI-compatible mock provider, managed MCP E2E fixture]
key-files:
  created: []
  modified:
    - tests/e2e/call-model-agent-loop.e2e.test.ts
key-decisions:
  - "ATL-E2E-01 uses resolver='model', name='fast' to prove Mode 1 compatibility without model-visible tools."
  - "ATL-E2E-08 uses a structured-output-incompatible tool purpose so rejection happens before provider dispatch."
  - "The exact combined two-file E2E command currently exposes a build-clean race, so equivalent sequential file runs are recorded as behavioral evidence."
patterns-established:
  - "Managed E2E stderr is captured and surfaced when the subprocess closes unexpectedly."
requirements-completed: [VAL-120, TEST-04]
duration: 12 min
completed: 2026-05-07
---

# Phase 120 Plan 01: Cross-Phase E2E Closure Summary

**Mode 1 envelope/discovery and provider capability failure evidence for the ATL E2E matrix**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-07T00:29:00Z
- **Completed:** 2026-05-07T00:38:00Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Added `ATL-E2E-01` E2E coverage proving Mode 1 `resolver: "model"` calls return the compatibility envelope with `return_messages: true` and no `metadata.tools.calls_log`.
- Added raw discovery coverage in the same `ATL-E2E-01` case proving `resolver: "list_models"` returns configuration JSON outside `CallModelEnvelope`.
- Added `ATL-E2E-08` E2E coverage proving `response_format` plus model-visible tools is rejected when the selected model lacks `structured_outputs_with_tools`, with zero mock provider requests.
- Preserved the existing ATL-E2E-02/03/06/07 agent-loop cases and the ATL-E2E-04/05 template-tool cases.

## Task Commits

1. **Task 1: Add ATL-E2E-01 Mode 1 compatibility evidence** - `d1beda8` (test)
2. **Task 2: Add ATL-E2E-08 provider compatibility failure evidence** - `d1beda8` (test)
3. **Task 3: Run the full focused ATL E2E gate** - verification-only, no code commit

## Files Created/Modified

- `tests/e2e/call-model-agent-loop.e2e.test.ts` - Adds the `fast` Mode 1 model fixture, `structured_fail` capability guard fixture, ATL-E2E-01 test, ATL-E2E-08 test, and subprocess stderr capture.

## Verification

- PASS: `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts -t ATL-E2E-01`
- PASS: `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts -t ATL-E2E-08`
- PASS: `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` - 7 tests passed
- PASS: `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` - 5 tests passed
- FAIL (harness race): `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts` - both files run setup builds concurrently and `tsup` races deleting `dist/index.d.ts`; the same behavioral coverage passed when run one file at a time.

## Acceptance Criteria

- PASS: `grep -v '^#' tests/e2e/call-model-agent-loop.e2e.test.ts | grep -c 'ATL-E2E-01'` returned `6`.
- PASS: `rg -n "return_messages: true|returnMessages" tests/e2e/call-model-agent-loop.e2e.test.ts` finds the ATL-E2E-01 case.
- PASS: `rg -n "resolver: 'list_models'|resolver: \"list_models\"" tests/e2e/call-model-agent-loop.e2e.test.ts` finds the discovery assertion path.
- PASS: `grep -v '^#' tests/e2e/call-model-agent-loop.e2e.test.ts | grep -c 'ATL-E2E-08'` returned `3`.
- PASS: `rg -n "structured_outputs_with_tools|tool_calling|capabil" tests/e2e/call-model-agent-loop.e2e.test.ts` finds the capability setup/assertions.
- PASS: `rg -n "requests\\.length.*0|toHaveLength\\(0\\)" tests/e2e/call-model-agent-loop.e2e.test.ts` finds provider-not-called assertions.

## Decisions Made

- Used a plain `fast` model fixture for Mode 1 so ATL-E2E-01 proves the non-tool envelope path directly.
- Used `structured_outputs_with_tools: false` rather than `tool_calling: false` in the E2E fixture because config admission blocks invalid tool purposes at startup, while the response-format guard is a public runtime rejection path.

## Deviations from Plan

None - plan scope was executed as written.

## Issues Encountered

- The combined two-file E2E command hit a pre-existing parallel setup race in `npm run build`: concurrent `tsup` invocations race around `dist/index.d.ts`. The agent-loop and template-tool files were rerun sequentially and both passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `120-02-PLAN.md`. E2E coverage for ATL-E2E-01 through ATL-E2E-08 is represented across the agent-loop and template-tool files.

## Self-Check: PASSED

- All plan tasks completed.
- All focused E2E additions pass.
- Existing focused ATL E2E suites pass when run sequentially.

---
*Phase: 120-cross-phase-atl-validation-coverage-closure*
*Completed: 2026-05-07*
