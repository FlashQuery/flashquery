---
phase: 170-json-validation-and-repair-infrastructure
plan: 04
subsystem: testing
tags: [json-repair, macro, host-template, e2e, scenarios]
requires:
  - phase: 170-json-validation-and-repair-infrastructure
    provides: shared parseLlmJson utility and JSON parse-site retrofits
provides:
  - Public and near-public workflow evidence for JSON repair behavior
  - Directed scenario coverage rows ML-33 and ML-34
  - YAML integration coverage row IL-45
affects: [macro, host-template-tools, call-model, scenarios]
tech-stack:
  added: []
  patterns:
    - Managed scenario fixtures for JSON-like LLM/tool payload repair
    - Host-template MCP structuredContent success/error assertions
key-files:
  created:
    - tests/integration/macro-json-repair.test.ts
    - tests/integration/host-template-json-repair.test.ts
    - tests/scenarios/directed/testcases/test_macro_json_repair.py
    - tests/scenarios/directed/testcases/test_host_template_json_repair.py
    - tests/scenarios/integration/tests/macro_call_model_json_repair.yml
  modified:
    - tests/config/vitest.integration.config.ts
    - tests/e2e/call-model-template-tools.e2e.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
key-decisions:
  - "YAML IL-45 asserts repaired schema-valid tool-call arguments in calls_log; extra fixture-only keys are intentionally stripped by get_document argument normalization."
  - "archive_document is included in the YAML scenario host catalog so managed cleanup can archive created documents cleanly."
patterns-established:
  - "Public workflow JSON-repair scenarios should assert externally observable structured data and bounded error envelopes, not private parser metadata."
requirements-completed: [REQ-004, REQ-005, REQ-006, REQ-010, REQ-011]
duration: ~1h
completed: 2026-06-22
---

# Phase 170: JSON Validation Public Evidence Summary

**Public macro, host-template, E2E, and scenario coverage proving repaired JSON-like payloads and structured parse failures are visible through MCP workflows**

## Performance

- **Duration:** ~1h
- **Started:** 2026-06-22T18:17:00Z
- **Completed:** 2026-06-22T19:11:00Z
- **Tasks:** 2/2 complete
- **Files modified:** 9

## Accomplishments

- Added integration coverage for public `call_macro` JSON repair and host-template structured result/error behavior.
- Extended host-template E2E coverage for structuredContent success and structured error payloads.
- Added directed scenario coverage ML-33 and ML-34.
- Added YAML integration scenario IL-45 proving `fq.call_model` repairs JSON-like provider tool-call arguments before macro branching.

## Task Commits

1. **Task 1: Add Vitest public and near-public workflow coverage** - `d87865c5` (`test(170-04): add public JSON repair workflow coverage`)
2. **Task 2: Add scenario coverage and final phase verification** - `27708ad5` (`test(170-04): add JSON repair scenario coverage`)

## Files Created/Modified

- `tests/integration/macro-json-repair.test.ts` - In-memory/public macro JSON repair integration evidence.
- `tests/integration/host-template-json-repair.test.ts` - Host-template repair/error integration evidence.
- `tests/e2e/call-model-template-tools.e2e.test.ts` - Public host-template MCP structuredContent success/error E2E assertions.
- `tests/scenarios/directed/testcases/test_macro_json_repair.py` - ML-33 directed public `call_macro` repair scenario.
- `tests/scenarios/directed/testcases/test_host_template_json_repair.py` - ML-34 directed host-template structured success/error scenario.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - ML-33 and ML-34 coverage rows.
- `tests/scenarios/integration/tests/macro_call_model_json_repair.yml` - IL-45 YAML managed scenario.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - IL-45 coverage row.
- `tests/config/vitest.integration.config.ts` - Registers the new integration tests.

## Verification

- `npm run test:integration -- tests/integration/macro-json-repair.test.ts` - passed, 3 tests.
- `npm run test:integration -- tests/integration/host-template-json-repair.test.ts` - passed, 3 tests.
- `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` - passed on clean retry, 12 tests.
- `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts -t "T-E-010"` - passed after the first full-file run timed out on this pre-existing dynamic list-changed contract.
- `python3 tests/scenarios/directed/run_suite.py --managed json_repair` - passed, 2/2 directed tests.
- `python3 tests/scenarios/integration/run_integration.py --managed macro_call_model_json_repair` - passed, 2/2 steps.
- `npm run test:unit -- tests/unit/llm-json-repair.test.ts` - passed, 18 tests.
- `npm run test:unit -- tests/unit/macro-evaluator.test.ts tests/unit/host-template-tools.test.ts tests/unit/macro-task-result.test.ts` - passed, 46 tests.
- `npm run test:unit -- tests/unit/llm-client.test.ts tests/unit/macro-coerce.test.ts tests/unit/macro-registry.test.ts` - passed, 78 tests.
- `npm run typecheck` - passed.
- `npm run build` - passed.

## Decisions Made

- IL-45 branches on `calls_log` fields that survive native `get_document` argument normalization (`identifiers`, `include`, `status`) instead of extra mock-only keys (`marker`, `count`) that are intentionally stripped.
- The YAML scenario exposes `archive_document` to the host tool catalog solely to let the managed scenario cleanup path archive the document created by `vault.write`.

## Deviations from Plan

None - the plan's public workflow evidence, scenario coverage, and coverage-matrix updates were added. The YAML assertion was adjusted during debugging to assert the stable public call-log contract.

## Issues Encountered

- The first IL-45 YAML run failed because `vault.write` required `write_document` in the hosted tool catalog. Adding `write_document` fixed scenario setup.
- The next IL-45 YAML run proved provider argument repair but showed extra mock-only fields were stripped by native tool argument normalization. The scenario now asserts repaired schema-valid fields.
- The first full E2E file run had one timeout in an existing dynamic list-changed test. The isolated test passed, and the full file passed on clean retry.

## User Setup Required

None - all verification used existing `.env.test` credentials and managed local test servers.

## Next Phase Readiness

Phase 170 now has unit, integration, E2E, directed scenario, YAML scenario, typecheck, and build evidence for shared JSON repair and the selected parse-site retrofits.

## Self-Check: PASSED

- All plan tasks completed.
- Scenario matrices include ML-33, ML-34, and IL-45.
- Required verification commands passed after resolving the YAML scenario assertion issue.
- No unrelated macro-framework changes were staged or committed by this summary tail.

---
*Phase: 170-json-validation-and-repair-infrastructure*
*Completed: 2026-06-22*
