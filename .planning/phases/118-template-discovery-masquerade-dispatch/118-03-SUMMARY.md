---
phase: 118-template-discovery-masquerade-dispatch
plan: 03
subsystem: llm
tags: [agent-loop, templates, tool-registry, list-purposes, directed-scenarios]

requires:
  - phase: 118-template-discovery-masquerade-dispatch
    provides: Fresh template-tool assembly, reverse maps, and diagnostics from Plan 02
provides:
  - Combined native/template model-visible registry assembly with final-name collision diagnostics
  - Purpose-call collision blocking before provider invocation
  - Phase 118 `list_purposes` diagnostics for template tools, conflicts, and dangling paths
affects: [phase-118, phase-119, phase-120, call_model, list_purposes]

tech-stack:
  added: []
  patterns:
    - Per-purpose native/template registry merge before Mode 2 selection
    - Public Phase 118 template diagnostics on purpose discovery without invoking providers

key-files:
  created:
    - .planning/phases/118-template-discovery-masquerade-dispatch/118-03-SUMMARY.md
  modified:
    - src/llm/tool-registry.ts
    - src/llm/template-tools.ts
    - src/llm/types.ts
    - src/mcp/tools/llm.ts
    - tests/unit/llm-tool.test.ts
    - tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py

key-decisions:
  - "Kept final registry ownership in `src/llm/tool-registry.ts` and re-exported the helper from `template-tools.ts` for Plan 01 compatibility."
  - "Kept `list_purposes` diagnostics limited to Phase 118 template metadata; broader discovery/help polish remains Phase 119 scope."
  - "STATE.md and ROADMAP.md were intentionally not updated because the orchestrator owns those writes for parallel execution."

patterns-established:
  - "Purpose calls now assemble native and template registries before `hasModelVisibleTools()` and provider invocation."
  - "Final-name collisions return `tool_registry_collision` with `template_tool_conflicts` before any provider request."

requirements-completed: [TMPL-06, TMPL-07, VAL-118]

duration: 16 min
completed: 2026-05-06
---

# Phase 118 Plan 03: Template Discovery Masquerade Dispatch Summary

**Collision-safe final model-visible registry assembly for native/template tools plus public Phase 118 purpose diagnostics.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-06T19:09:00Z
- **Completed:** 2026-05-06T19:25:07Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `mergeModelVisibleToolRegistries()` to combine native and template provider tools in deterministic native-then-template order while preserving reverse maps and template diagnostics.
- Updated `call_model` purpose handling to assemble template registries even when `purpose.tools` is absent, enabling template-only Mode 2 and blocking final-registry collisions before provider calls.
- Extended `list_purposes` with `template_tools`, `template_tool_conflicts`, and `dangling_template_paths` for each purpose.
- Tightened ATL-DS-08 to assert the public `tool_registry_collision` error and zero provider requests.

## Task Commits

Each task was committed atomically:

1. **Task 1: Merge native and template registry assemblies** - `c3ca294` (feat)
2. **Task 2: Add Phase 118 list_purposes diagnostics** - `4970c63` (test)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `src/llm/tool-registry.ts` - Added combined registry assembly, collision source aggregation, template reverse-map preservation, and additive template diagnostics on `ToolRegistryAssembly`.
- `src/llm/template-tools.ts` - Re-exported the merge helper and made vault discovery tolerate missing roots.
- `src/llm/types.ts` - Added optional `template_tool_names` to Mode 2 metadata.
- `src/mcp/tools/llm.ts` - Assembles native/template registries for purpose calls, rejects collisions before provider invocation, and exposes Phase 118 template diagnostics in `list_purposes`.
- `tests/unit/llm-tool.test.ts` - Uses real temp-vault template fixtures for list_purposes diagnostics.
- `tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py` - Asserts `tool_registry_collision`, `template_tool_conflicts`, and zero provider requests.
- `.planning/phases/118-template-discovery-masquerade-dispatch/118-03-SUMMARY.md` - Execution summary.

## Decisions Made

Kept the registry merge helper in `tool-registry.ts` because the final provider-visible registry is shared native/template state. The helper is re-exported from `template-tools.ts` so existing RED contracts remain compatible.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The first directed scenario run used stale `dist/index.js`, so it did not include the new TypeScript changes. Running `npm run build` refreshed the binary and both directed diagnostics passed.

## Verification

- `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-tool.test.ts` - passed, 83 tests.
- `npm test -- tests/unit/llm-tool.test.ts` - passed, 64 tests.
- `npm run build` - passed.
- `python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed` - passed, 1/1 step.
- `python3 tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py --managed` - passed, 2/2 steps.
- Acceptance greps for merge helper, template registry assembly, public diagnostics, discovery scenario fields, and collision scenario provider-blocking assertions passed.

## User Setup Required

None - no external service configuration required beyond existing test setup.

## Known Stubs

None. Stub-pattern scan matched normal initialized arrays/maps, null checks, fixture placeholders, and literal reference placeholders in tests; no unfinished stubs block the plan goal.

## Threat Flags

None. The new provider-visible registry merge and discovery diagnostics are the threat surfaces already covered by T-118-08 through T-118-11 in the plan.

## Next Phase Readiness

Ready for the remaining Phase 118 dispatch/loop plans to route template calls through the reverse map and validate mixed native/template calls end to end.

## Self-Check: PASSED

- Created SUMMARY exists at `.planning/phases/118-template-discovery-masquerade-dispatch/118-03-SUMMARY.md`.
- Task commits exist in git log: `c3ca294`, `4970c63`.
- Key modified files exist on disk.
- No tracked file deletions were introduced.
- STATE.md and ROADMAP.md were not modified.

---
*Phase: 118-template-discovery-masquerade-dispatch*
*Completed: 2026-05-06*
