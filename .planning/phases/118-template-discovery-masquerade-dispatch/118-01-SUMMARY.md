---
phase: 118-template-discovery-masquerade-dispatch
plan: 01
subsystem: testing
tags: [agent-loop, templates, call-model, vitest, directed-scenarios]

requires:
  - phase: 117-agent-loop-executor
    provides: Mode 2 agent loop, native dispatcher envelope, calls_log metadata, and model-visible tool routing
provides:
  - RED unit contracts for template discovery, generated names, collision diagnostics, reverse maps, and dispatch payloads
  - RED integration contracts for fresh vault template discovery, default access, bindings, and dangling diagnostics
  - RED E2E and directed scenario contracts for public template-tool and mixed native/template loops
affects: [phase-118, phase-119, phase-120, validation]

tech-stack:
  added: []
  patterns:
    - Dynamic imports for not-yet-created Phase 118 production module contracts
    - Deterministic local OpenAI-compatible mock providers for E2E and directed scenarios

key-files:
  created:
    - tests/unit/llm-template-tools.test.ts
    - tests/integration/template-tools.integration.test.ts
    - tests/e2e/call-model-template-tools.e2e.test.ts
    - tests/scenarios/directed/testcases/test_call_model_template_discovery.py
    - tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py
    - tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py
    - tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py
  modified:
    - tests/unit/llm-tool-registry.test.ts
    - tests/unit/llm-tool-dispatcher.test.ts
    - tests/unit/llm-tool.test.ts

key-decisions:
  - "Kept Phase 118 implementation untouched; all new coverage is intentionally RED."
  - "Used dynamic imports for src/llm/template-tools.js so tests parse before the production module exists."
  - "Directed scenarios assert public MCP responses, provider requests, and vault files only."

patterns-established:
  - "Template-tool contracts assert exact generated names: flashquery.skill.research_skill, flashquery.review.document_review, and flashquery.template.weekly_checklist."
  - "Template dispatch contracts require recoverable JSON tool errors including template_missing_required_param and tool_not_in_registry."

requirements-completed: [VAL-118, TMPL-06, TMPL-07, TMPL-08]

duration: 11 min
completed: 2026-05-06
---

# Phase 118 Plan 01: Template Discovery Masquerade Dispatch Summary

**Runnable RED validation contracts for Phase 118 template-tool masquerade discovery, dispatch, E2E loops, and directed public scenarios.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-06T18:55:40Z
- **Completed:** 2026-05-06T19:06:56Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added ATL-U-15 and ATL-I-03 RED contracts for template frontmatter validation, generated names, fresh reads, default access, bindings, dangling diagnostics, collisions, reverse maps, and recoverable dispatch errors.
- Added ATL-E2E-04 and ATL-E2E-05 RED contracts with deterministic local mock providers.
- Added ATL-DS-07, ATL-DS-08, ATL-DS-10, and ATL-DS-11 managed directed scenarios using public MCP behavior and vault fixtures.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RED unit and integration contracts** - `4b1fd52` (test)
2. **Task 2: Add RED E2E and directed scenario contracts** - `6bec971` (test)

## Files Created/Modified

- `tests/unit/llm-template-tools.test.ts` - RED contracts for template-tool naming, discovery, collisions, reverse map, and dispatch errors.
- `tests/unit/llm-tool-registry.test.ts` - RED combined registry collision contract.
- `tests/unit/llm-tool-dispatcher.test.ts` - RED mixed native/template dispatch and calls-log kind contracts.
- `tests/unit/llm-tool.test.ts` - RED public list_purposes template metadata contract.
- `tests/integration/template-tools.integration.test.ts` - RED real-vault fresh discovery, default access, binding, and dangling diagnostics contracts.
- `tests/e2e/call-model-template-tools.e2e.test.ts` - RED public MCP E2E contracts for template-only and mixed loops.
- `tests/scenarios/directed/testcases/test_call_model_template_discovery.py` - ATL-DS-07 managed scenario.
- `tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py` - ATL-DS-08 managed scenario.
- `tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py` - ATL-DS-10 managed scenario.
- `tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py` - ATL-DS-11 managed scenario.

## Decisions Made

Kept the work limited to RED validation contracts because this wave precedes Phase 118 production implementation. Dynamic imports are used where `src/llm/template-tools.js` is expected but not yet present.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Expected RED failures were observed:

- Focused unit suite fails on missing `src/llm/template-tools.js`, missing template metadata in `list_purposes`, native-only dispatch, and missing `kind` calls-log discrimination.
- Integration suite fails on missing `src/llm/template-tools.js`.
- E2E suite fails because template-only calls do not yet enter Mode 2 and mixed calls lack template `kind`.
- Directed scenarios fail because template discovery metadata, collision blocking, template dispatch, and mixed native/template metadata are not implemented yet.

## Verification

- `npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool.test.ts` - RED as expected, 15 failing contracts, no syntax errors.
- `npm run test:integration -- tests/integration/template-tools.integration.test.ts` - RED as expected, missing `src/llm/template-tools.js`, no syntax errors.
- `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` - RED as expected, managed server starts and current behavior lacks template-tool Mode 2 contracts.
- `python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed` - RED as expected, no `template_tools` public metadata yet.
- `python3 tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py --managed` - RED as expected, collisions are not yet surfaced or provider-blocking.
- `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py --managed` - RED as expected, template-only tool call stays in text wrapper path.
- `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py --managed` - RED as expected, template call returns `tool_not_in_registry` and calls-log kinds are absent.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` test setup.

## Next Phase Readiness

Ready for Phase 118 implementation plans to create `src/llm/template-tools.ts`, thread template registries into `call_model`, and make these contracts green.

## Self-Check: PASSED

- Created contract files exist on disk.
- Task commits exist: `4b1fd52`, `6bec971`.
- No tracked file deletions were introduced.
- Known stubs: none that prevent the plan goal; placeholder strings found by scan are existing reference-fixture literals in tests.

---
*Phase: 118-template-discovery-masquerade-dispatch*
*Completed: 2026-05-06*
