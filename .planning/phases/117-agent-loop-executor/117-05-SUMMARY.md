---
phase: 117-agent-loop-executor
plan: 05
subsystem: testing
tags: [agent-loop, validation, directed-scenarios, e2e, traceability]

requires:
  - phase: 117-agent-loop-executor
    provides: Mode 2 loop executor, native dispatcher, and call_model public wiring from plans 01-04
provides:
  - Final VAL-117 E2E and directed scenario validation closure
  - Directed coverage rows for ATL-DS-09, ATL-DS-12, ATL-DS-13, and VAL-117
  - Phase 117 validation, requirements, and roadmap traceability updates
affects: [phase-117, phase-118, phase-120, val-117, agent-loop-executor]

tech-stack:
  added: []
  patterns:
    - "Final validation gates use deterministic local OpenAI-compatible mock providers."
    - "Phase ledgers record aggregate-only Mode 2 usage and keep iteration detail in response metadata."

key-files:
  created:
    - .planning/phases/117-agent-loop-executor/117-VALIDATION.md
  modified:
    - tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "VAL-117 closure uses the focused Phase 117 gate rather than real provider assertions."
  - "The budget scenario treats pre-call max-token stops as zero-completed-iteration behavior with no provider request."

patterns-established:
  - "Directed budget scenarios assert zero public usage for guardrail stops before the first completed iteration."
  - "Coverage ledger rows can map ATL provisional IDs to L-* directed matrix IDs while preserving ATL Test Plan traceability."

requirements-completed: [LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07, TOOL-05, TOOL-06, VAL-117]

duration: 13min
completed: 2026-05-06
---

# Phase 117 Plan 05: Validation Closure Summary

**Final public validation and traceability closure for Mode 2 native tool loops, guardrails, fallback, usage aggregation, and calls-log metadata.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-06T15:37:26Z
- **Completed:** 2026-05-06T15:50:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Hardened the budget directed scenario to assert the correct zero-completed-iteration behavior: no provider request, no calls log, zero tokens, and zero cost.
- Ran the full Phase 117 gate: 133 focused unit tests, public E2E, three managed directed scenarios, and production build all passed.
- Added final directed coverage rows for ATL-DS-09, ATL-DS-12, ATL-DS-13, and VAL-117, including blocker-case traceability.
- Marked Phase 117 validation, requirements, and roadmap ledgers complete.

## Task Commits

1. **Task 1: Harden E2E and directed scenarios against the final implementation** - `971a3ee` (test)
2. **Task 2: Update coverage ledgers and run phase validation gate** - `23355b0` (docs)

## Files Created/Modified

- `tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py` - Asserts pre-call max-token guardrail stops produce zero completed iteration usage.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Adds L-86 through L-89 for ATL-DS-09/12/13 and VAL-117.
- `.planning/phases/117-agent-loop-executor/117-VALIDATION.md` - Records Phase 117 validation status as green.
- `.planning/REQUIREMENTS.md` - Updates last-updated marker for Phase 117 validation closure.
- `.planning/ROADMAP.md` - Marks Phase 117 and plans 117-03 through 117-05 complete.

## Decisions Made

VAL-117 validation remains deterministic: E2E and directed scenarios use local OpenAI-compatible mock providers and do not depend on OpenAI, OpenRouter, or Ollama correctness.

The literal ROADMAP-wide no-schema grep in the plan is over-broad because historical roadmap entries mention schema and migration work from earlier phases. I verified the Plan 05 diff instead and confirmed it adds no new database DDL, migration, or per-iteration usage storage claim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected budget scenario expectation for pre-call max-token stop**
- **Found during:** Task 1
- **Issue:** `test_call_model_agent_loop_budgets.py` expected one provider request, but the final implementation correctly stops before the first provider call when `max_tokens_budget` is already exceeded.
- **Fix:** Asserted zero-completed-iteration behavior: `stop_reason: "max_tokens"`, empty `calls_log`, zero top-level tokens/cost, and zero provider requests.
- **Files modified:** `tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py`
- **Verification:** Full Task 1 and Task 2 validation gates passed.
- **Committed in:** `971a3ee`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** The fix aligned the directed scenario with the documented guardrail contract and did not change production behavior.

## Issues Encountered

The acceptance check `rg "schema|migration|fqc_llm_usage.*per-iteration" .planning/phases/117-agent-loop-executor/117-VALIDATION.md .planning/ROADMAP.md` matches pre-existing ROADMAP text from prior phases. I treated that as out of scope and verified the Plan 05 diff with `git diff --unified=0 ... | rg "^\\+.*(schema|migration|fqc_llm_usage.*per-iteration)"`, which returned no matches.

## Verification

- `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py --managed` - passed.
- `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts && npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py --managed && npm run build` - passed.
- Acceptance greps for ATL-DS-09/12/13, VAL-117, blocker-case traceability, checked requirements, and diff-scoped no-DDL/per-iteration-storage claims passed.

## Known Stubs

None. Stub scan matches are reference/template placeholder syntax in documentation and coverage rows, not executable stubs or unwired data.

## Threat Flags

None. This plan modified deterministic tests and traceability ledgers only; no new network endpoint, auth path, file access surface, or trust-boundary schema was introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 118 can build template discovery and masquerade dispatch on top of a validated Mode 2 native loop. Phase 120 can consume the L-86 through L-89 rows as final Phase 117 traceability.

## Self-Check: PASSED

- Created file exists: `.planning/phases/117-agent-loop-executor/117-VALIDATION.md`.
- Summary file exists: `.planning/phases/117-agent-loop-executor/117-05-SUMMARY.md`.
- Task commits exist: `971a3ee`, `23355b0`.
- Verification commands passed.

---
*Phase: 117-agent-loop-executor*
*Completed: 2026-05-06*
