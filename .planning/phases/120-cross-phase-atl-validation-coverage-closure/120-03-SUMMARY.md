---
phase: 120-cross-phase-atl-validation-coverage-closure
plan: 03
subsystem: testing
tags: [atl, directed, call_model, shutdown, references]
requires:
  - phase: 117
    provides: agent loop guardrails and usage aggregation
  - phase: 119
    provides: discovery/help directed surfaces
provides:
  - L-90 cooperative shutdown public directed coverage
  - Fresh focused ATL directed suite evidence
  - Even-parity reference hydration regression fix
affects: [phase-120, directed-coverage, reference-resolver]
tech-stack:
  added: []
  patterns: [managed directed scenario runner, local OpenAI-compatible mock provider]
key-files:
  created:
    - tests/scenarios/directed/testcases/test_call_model_agent_loop_shutdown.py
  modified:
    - tests/scenarios/framework/fqc_test_utils.py
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/directed/testcases/test_call_model_return_messages.py
    - tests/scenarios/directed/testcases/test_call_model_reference_system_core.py
    - tests/scenarios/directed/testcases/test_call_model_template_parameterization.py
    - src/llm/reference-resolver.ts
    - tests/unit/reference-resolver.test.ts
    - .planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md
key-decisions:
  - "Run the cooperative shutdown scenario separately from the shared focused suite because it intentionally SIGTERMs the managed server."
  - "Legacy directed scenario fixtures now declare model capabilities explicitly so capability admission is deterministic."
  - "The Phase 120 directed rerun exposed a real even-parity hydration regression; closing L-77 required a source fix plus unit regression."
patterns-established:
  - "Directed scenarios that rely on compiled FQC must be rerun after `npm run build` when TypeScript source changes."
requirements-completed: [VAL-120, TEST-04]
duration: 52 min
completed: 2026-05-07
---

# Phase 120 Plan 03: Directed ATL Closure Summary

**L-90 cooperative shutdown closure and focused directed matrix refresh**

## Performance

- **Duration:** 52 min
- **Started:** 2026-05-07T00:51:00Z
- **Completed:** 2026-05-07T01:43:00-03:00
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added `FQCServer.signal_graceful_shutdown()` as a non-blocking SIGTERM helper for in-flight public call tests.
- Added `test_call_model_agent_loop_shutdown.py` for `ATL-DS-12` / L-90, asserting the public `call_model` envelope returns `metadata.tools.stop_reason == "shutdown"` with completed-iteration calls-log, tokens, and cost.
- Updated `DIRECTED_COVERAGE.md` so L-90 is no longer pending and focused ATL directed rows have fresh `2026-05-07` Last Passing evidence.
- Fixed three legacy directed LLM fixtures by declaring model capability fields explicitly.
- Fixed even-parity active reference hydration in `hydrateMessages()` and added a unit regression for `\\{{ref:...}}` preserving one literal slash while hydrating the active ref.
- Recorded directed evidence and report paths in `120-VALIDATION.md`.

## Task Commits

1. **Task 1: Add non-blocking shutdown signal helper** - `378bbbb` (test)
2. **Task 2: Add cooperative shutdown directed scenario** - `c825fd0` (test)
3. **Task 3: Refresh focused directed suite evidence** - current commit (test/docs)

## Verification

- PASS: `python3 -m py_compile tests/scenarios/framework/fqc_test_utils.py`
- PASS: `python3 -m py_compile tests/scenarios/directed/testcases/test_call_model_agent_loop_shutdown.py`
- PASS: `npm test -- tests/unit/reference-resolver.test.ts -t "even-parity active refs"` - 1/1 selected
- PASS: `npm test -- tests/unit/reference-resolver.test.ts` - 84/84
- PASS: `npm run build`
- PASS: `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages test_call_model_reference_system_core test_call_model_template_parameterization` - 3/3, report `tests/scenarios/directed/reports/scenario-report-2026-05-07-012941.md`
- PASS: `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_return_messages test_call_model_reference_system_core test_call_model_template_parameterization test_call_model_agent_loop_capabilities test_call_model_native_tool_registry test_call_model_agent_loop_native test_call_model_agent_loop_budgets test_call_model_agent_loop_usage test_call_model_template_discovery test_call_model_template_tool_conflicts test_call_model_agent_loop_template_tool test_call_model_agent_loop_mixed_tools test_discovery_resolvers test_call_model_help_resolver` - 14/14, report `tests/scenarios/directed/reports/scenario-report-2026-05-07-014118.md`
- PASS: `python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_shutdown` - 1/1, report `tests/scenarios/directed/reports/scenario-report-2026-05-07-014240.md`

## Acceptance Criteria

- PASS: `rg -n 'def signal_graceful_shutdown\\(self\\).*bool' tests/scenarios/framework/fqc_test_utils.py`
- PASS: `rg -n 'signal\\.SIGTERM' tests/scenarios/framework/fqc_test_utils.py`
- PASS: helper body contains no `.wait(` or `.kill(`.
- PASS: `test -f tests/scenarios/directed/testcases/test_call_model_agent_loop_shutdown.py`
- PASS: `grep -v '^#' tests/scenarios/directed/testcases/test_call_model_agent_loop_shutdown.py | grep -c 'stop_reason.*shutdown'` returned at least `1`.
- PASS: `rg -n 'L-90.*test_call_model_agent_loop_shutdown.*2026-05-07' tests/scenarios/directed/DIRECTED_COVERAGE.md`
- PASS: `rg -n 'L-90.*PENDING|Accepted Phase 120 Gap: L-90' tests/scenarios/directed/DIRECTED_COVERAGE.md .planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md` returned no matches.
- PASS: `rg -n 'Phase 120 Directed Evidence' .planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md`
- PASS: `rg -n 'scenario-report-|PASS|SKIP|FAIL' .planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md`

## Issues Encountered

- A combined shared run including `test_call_model_agent_loop_shutdown` terminated the managed server for following tests. This is expected for a shutdown scenario, so final evidence splits shutdown into its own run.
- The first focused directed rerun exposed implicit model capabilities in three older scenario fixtures. The fixtures now declare capabilities explicitly.
- The reference-system scenario exposed an actual even-parity hydration bug in compiled FQC. `hydrateMessages()` now anchors position-aware replacement against the placeholder suffix of the scanned span, and the regression is covered in unit tests.

## Next Phase Readiness

Ready for `120-04-PLAN.md`. L-90 is closed through public directed coverage, the focused ATL directed suite is green, and validation artifacts record exact reports.

## Self-Check: PASSED

- All plan tasks completed.
- Directed coverage matrix refreshed.
- No L-90 pending language remains.
- Focused ATL directed evidence is split correctly around shutdown semantics.

---
*Phase: 120-cross-phase-atl-validation-coverage-closure*
*Completed: 2026-05-07*
