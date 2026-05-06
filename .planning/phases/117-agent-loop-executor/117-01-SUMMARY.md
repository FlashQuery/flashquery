---
phase: 117-agent-loop-executor
plan: 01
subsystem: testing
tags: [agent-loop, call_model, vitest, directed-scenarios, mock-provider]

requires:
  - phase: 116-model-visible-tool-registry
    provides: purpose-level native tool exposure and provider tool diagnostics
provides:
  - Wave 0 RED-state unit contracts for the Phase 117 agent loop executor and dispatcher
  - Public E2E and directed scenario scaffolds for native loops, guardrails, fallback, and usage aggregation
affects: [phase-117, phase-120, val-117, agent-loop-executor]

tech-stack:
  added: []
  patterns: [dynamic RED-state module imports, deterministic OpenAI-compatible mock provider, managed directed scenarios]

key-files:
  created:
    - tests/unit/llm-agent-loop.test.ts
    - tests/unit/llm-tool-dispatcher.test.ts
    - tests/e2e/call-model-agent-loop.e2e.test.ts
    - tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py
    - tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py
    - tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py
  modified: []

key-decisions:
  - "Wave 0 tests intentionally remain RED until src/llm/agent-loop.ts and src/llm/tool-dispatcher.ts land."
  - "Directed scenario read_first paths were corrected from tests/scenarios/directed/framework to the repo's actual tests/scenarios/framework location."

patterns-established:
  - "Unit contracts dynamically import planned Phase 117 modules so test files parse cleanly while failing on missing production contracts."
  - "Public scenarios use local OpenAI-compatible mock providers with chunked request-body support."

requirements-completed: [LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07, TOOL-05, TOOL-06, VAL-117]

duration: 12min
completed: 2026-05-06
---

# Phase 117 Plan 01: Wave 0 Validation Scaffolding Summary

**Runnable RED-state contracts for Mode 2 native tool loops, dispatcher safety, loop guardrails, fallback accounting, and public usage metadata.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-06T14:41:21Z
- **Completed:** 2026-05-06T14:53:21Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added unit contracts for `ATL-U-13`, `ATL-U-14`, `TOOL-05`, and `TOOL-06`.
- Added E2E mock-provider contracts for `ATL-E2E-02`, `ATL-E2E-03`, `ATL-E2E-06`, and `ATL-E2E-07`.
- Added managed directed scenarios for `ATL-DS-09`, `ATL-DS-12`, and `ATL-DS-13`.

## Task Commits

1. **Task 1: Add failing unit contracts for loop executor and dispatcher** - `6571be0` (test)
2. **Task 2: Add failing public E2E and directed scenario scaffolds** - `99b3b6a` (test)

## Files Created/Modified

- `tests/unit/llm-agent-loop.test.ts` - Loop executor RED contracts for mode selection, message history, stop reasons, fallback, estimates, and aggregate usage.
- `tests/unit/llm-tool-dispatcher.test.ts` - Dispatcher RED contracts for immutable native allowlists, Zod validation, context passing, recoverable errors, aborts, and OpenAI-compatible tool messages.
- `tests/e2e/call-model-agent-loop.e2e.test.ts` - Public MCP-bound mock-provider contracts for native loops, parallel calls, guardrail stops, caller-provided tool rejection, and fallback.
- `tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py` - Managed `ATL-DS-09` native loop scenario.
- `tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py` - Managed `ATL-DS-12` budget and stop-reason scenario.
- `tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py` - Managed `ATL-DS-13` usage aggregation scenario.

## Decisions Made

Wave 0 remains test-only. The unit files intentionally import planned modules that do not exist yet; the public tests reach current `call_model` behavior and fail because Phase 116 metadata lacks `stop_reason`, `calls_log`, and loop dispatch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected directed scenario framework path drift**
- **Found during:** Task 2
- **Issue:** Plan `read_first` paths referenced `tests/scenarios/directed/framework/*`, but the repo stores these helpers under `tests/scenarios/framework/*`.
- **Fix:** Read the actual framework files and followed their import pattern.
- **Files modified:** None
- **Verification:** New scenarios import `Path(...).parent.parent.parent / "framework"` like existing directed tests.
- **Committed in:** `99b3b6a`

**2. [Rule 3 - Blocking] Added chunked request-body handling to Python mock providers**
- **Found during:** Task 2 verification
- **Issue:** The initial scenario mock provider assumed `Content-Length`; FlashQuery can send chunked bodies, causing JSON decode failures before reaching RED contract assertions.
- **Fix:** Added the existing chunked body reader pattern to all new Python mock providers.
- **Files modified:** `test_call_model_agent_loop_native.py`, `test_call_model_agent_loop_budgets.py`, `test_call_model_agent_loop_usage.py`
- **Verification:** All three scenarios now reach `call_model` and fail on missing Phase 117 loop metadata rather than mock-provider parsing.
- **Committed in:** `99b3b6a`

---

**Total deviations:** 2 auto-fixed (Rule 3)
**Impact on plan:** Both fixes were needed to make the RED scaffolds runnable. No production behavior was changed.

## Verification

- `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts` - RED as expected: 30 failing tests due missing `src/llm/agent-loop.js` and `src/llm/tool-dispatcher.js`.
- `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` - RED as expected: tests reach current `call_model` and fail because only Phase 116 tool diagnostics are returned.
- `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py --managed` - RED as expected: current response lacks `metadata.tools.stop_reason` and `calls_log`.
- `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py --managed` - RED as expected: current response lacks stop-reason accounting.
- `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py --managed` - RED as expected: current response lacks `calls_log` token aggregation.

## Known Stubs

None. Mock providers are deterministic test fixtures, not product stubs.

## Issues Encountered

The E2E command performs the standard E2E setup production build before running. No tracked `dist/` artifacts were generated.

## User Setup Required

None.

## Next Phase Readiness

Phase 117 implementation can now target executable RED contracts for the planned `AgentLoopExecutor`, `dispatchToolCalls`, public MCP loop behavior, and directed scenario coverage.

## Self-Check: PASSED

- Created files exist: all 6 found.
- Task commits exist: `6571be0`, `99b3b6a`.
- Verification commands reached expected RED-state failures caused by missing Phase 117 implementation.

---
*Phase: 117-agent-loop-executor*
*Completed: 2026-05-06*
