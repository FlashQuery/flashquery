---
phase: 171-graph-foundation-structural-graph-and-read-surfaces
plan: 01
subsystem: config
tags: [graph, config, vocabulary, prompts]
requires: []
provides:
  - Optional disabled-by-default graph config validation
  - Default graph relation vocabulary and prompt contracts
  - Graph relation semantics test coverage
affects: [graph, config, llm]
tech-stack:
  added: []
  patterns: [Zod YAML validation, vault-relative graph sidecars, default graph contracts]
key-files:
  created:
    - src/graph/config.ts
    - src/graph/vocabulary.ts
    - src/graph/prompts.ts
    - tests/unit/graph-config.test.ts
    - tests/unit/graph-vocabulary.test.ts
    - tests/unit/graph-prompts.test.ts
    - tests/unit/graph-relations.test.ts
  modified:
    - src/config/types.ts
    - src/config/loader.ts
key-decisions:
  - "Graph config defaults to enabled:false and validates sidecars only when enabled."
  - "Missing sidecar paths fall back to packaged defaults deterministically."
patterns-established:
  - "Graph sidecar loaders use strict Zod schemas and existing YAML error formatting patterns."
requirements-completed: [GR-001, GR-002, GR-003, GR-007]
duration: 16 min
completed: 2026-06-23
---

# Phase 171 Plan 01: Graph Config and Vocabulary Summary

**Disabled-by-default graph config with validated relation vocabulary and graph prompt contracts**

## Performance

- **Duration:** 16 min
- **Started:** 2026-06-23T21:25:00Z
- **Completed:** 2026-06-23T21:41:00Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Added typed optional `graph` config with disabled defaults and enabled-mode cross-validation for embeddings and LLM classifier references.
- Added default structural/classified relation vocabulary, prompt contract validation, and sidecar loaders.
- Covered disabled defaults, invalid graph config, vocabulary semantics, prompt variables, duplicate relations, missing sidecars, and rejected similarity topology.

## Task Commits

1. **Task 1: Add graph config and sidecar contracts** - `6dbe4625` (feat)

## Files Created/Modified

- `src/graph/config.ts` - Graph runtime config validation.
- `src/graph/vocabulary.ts` - Default relation vocabulary and YAML sidecar loader.
- `src/graph/prompts.ts` - Default graph prompt contract and prompt sidecar validation.
- `src/config/types.ts` - Typed graph config surface.
- `src/config/loader.ts` - Graph schema parsing and enabled-mode validation.
- `tests/unit/graph-config.test.ts` - T-U-001 through T-U-007, T-U-050, T-U-051.
- `tests/unit/graph-vocabulary.test.ts` - T-U-008, T-U-009, T-U-052, T-U-053, T-U-016.
- `tests/unit/graph-prompts.test.ts` - T-U-010, T-U-011, T-U-076.
- `tests/unit/graph-relations.test.ts` - T-U-015.

## Decisions Made

Graph sidecars are deterministic defaults when files are absent, and graph sidecars are validated only when graph is enabled so disabled instances keep existing startup behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `171-02` namespace rendering and `171-04` edge metadata validation.

## Self-Check: PASSED

Targeted unit verification passed: `npm run test:unit -- --run tests/unit/graph-config.test.ts tests/unit/graph-vocabulary.test.ts tests/unit/graph-prompts.test.ts tests/unit/graph-relations.test.ts tests/unit/graph-edge-validation.test.ts tests/unit/reference-resolver-namespaces.test.ts tests/unit/schema-verify.test.ts` (43 tests).

---
*Phase: 171-graph-foundation-structural-graph-and-read-surfaces*
*Completed: 2026-06-23*
