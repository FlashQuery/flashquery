---
phase: 112-chat-primitive-envelope-migration
plan: 04
subsystem: testing
tags: [directed-scenarios, return_messages, validation]
requires:
  - phase: 112-02
    provides: Provider-normalized chat primitive
  - phase: 112-03
    provides: call_model return_messages envelope
provides:
  - Directed public scenario and coverage ledger entries for Phase 112 return_messages behavior
affects: [scenario-coverage, phase-120]
tech-stack:
  added: []
  patterns: [local OpenAI-compatible mock provider in directed scenario]
key-files:
  created: [tests/scenarios/directed/testcases/test_call_model_return_messages.py]
  modified: [tests/scenarios/directed/DIRECTED_COVERAGE.md, tests/scenarios/integration/INTEGRATION_COVERAGE.md]
key-decisions:
  - "Used a local mock OpenAI-compatible provider so the public scenario is deterministic and does not depend on external LLM credentials."
patterns-established:
  - "Exact envelope JSON assertions belong in directed Python when YAML integration can only assert substrings."
requirements-completed: [VAL-112, TEST-01, TEST-02, TEST-03]
duration: 25 min
completed: 2026-05-05
---

# Phase 112 Plan 04: Scenario Validation Summary

**Deterministic directed scenario proving `call_model` default and true `return_messages` behavior**

## Performance

- **Duration:** 25 min
- **Started:** 2026-05-05T21:38:00Z
- **Completed:** 2026-05-05T21:53:19Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added `test_call_model_return_messages.py` with a local OpenAI-compatible HTTP mock.
- Verified `return_messages: false` yields `messages: []`.
- Verified `return_messages: true` returns hydrated reference content, removes `{{ref:`, and appends a named assistant message.
- Updated directed and integration coverage ledgers for ATL-DS-01.

## Task Commits

1. **Tasks 1-3: directed scenario and coverage ledger updates** - `a8875a6`

## Files Created/Modified

- `tests/scenarios/directed/testcases/test_call_model_return_messages.py` - Public scenario for return_messages behavior.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - L-70 through L-72 and ATL-DS-01 mapping.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Note that directed Python owns exact JSON envelope assertions.

## Decisions Made

Did not add a weak YAML integration scenario because the runner's available assertions are substring-based and cannot enforce the exact parsed envelope contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The documented scenario command used `python` and `--filter`, but this repository runner expects `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages`. The scenario itself passed with that command.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 05 can close validation and traceability using focused unit, build, and directed scenario gates.

---
*Phase: 112-chat-primitive-envelope-migration*
*Completed: 2026-05-05*
