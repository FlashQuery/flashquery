---
phase: 172-structural-graph-and-read-surfaces
plan: 06
subsystem: mcp
tags: [get_document, graph, connections, supabase, vitest]

requires:
  - phase: 172-03
    provides: Graph tables, graph query row shapes, active/inactive/stale graph metadata
provides:
  - Graph-aware get_document graph_summary include
  - Graph-primary get_document connections with embedding-only and inactive-target opt-ins
  - Validation for legacy limit_per_chunk conflicts in graph-aware calls
affects: [graph-read-surfaces, get_document, document-connections]

tech-stack:
  added: []
  patterns:
    - Stored graph rows are read through bounded Supabase queries without read-time LLM calls.
    - Legacy embedding connections remain the default until graph-aware options are present.

key-files:
  created:
    - src/graph/document-summary.ts
    - tests/integration/graph/get-document-graph.test.ts
  modified:
    - src/mcp/tools/documents/get.ts
    - src/mcp/utils/document-output.ts
    - src/mcp/utils/document-connections.ts
    - tests/unit/document-output.test.ts
    - tests/unit/document-connections.test.ts

key-decisions:
  - "Graph-aware connection behavior is activated only by new graph-aware connection options, preserving legacy limit_per_chunk callers."
  - "graph_summary is built from persisted graph node and edge rows only; no read-time LLM call path was added."

patterns-established:
  - "Graph read overlays: graph connections carry basis, direction, relation, confidence, reasoning, stale, question_status, and community_label while preserving the existing connections envelope."

requirements-completed: [GR-016A, GR-019, GR-020A, GR-024A]

duration: 18m
completed: 2026-06-24
---

# Phase 172 Plan 06: Graph-Aware get_document Summary

**Graph-aware `get_document` reads now expose stored graph summaries and graph-primary connections while legacy embedding connections stay compatible by default.**

## Performance

- **Duration:** 18m
- **Started:** 2026-06-24T03:04:49Z
- **Completed:** 2026-06-24T03:16:20Z
- **Tasks:** 1
- **Files modified:** 8

## Accomplishments

- Added `include:["graph_summary"]` and a graph summary builder that reports edge counts, stale counts, community labels, contradiction flags, and open-question flags/counts from stored graph rows.
- Added graph-aware connection options: `graph_limit_per_chunk`, `embedding_limit_per_chunk`, `include_embedding_only`, `include_inactive_targets`, `relations`, and `include_stale`.
- Added graph-primary connection overlays with `basis`, `direction`, `relation`, `confidence_score`, `reasoning`, `stale`, `question_status`, and `community_label`.
- Preserved legacy `connections.limit_per_chunk` behavior when graph-aware options are absent, and added `invalid_input` guidance when it is mixed with graph-aware options.

## Task Commits

1. **Task 1 RED: graph get_document coverage** - `c50d8445` (test)
2. **Task 1 GREEN: graph-aware get_document output** - `bb4ed17b` (feat)

**Plan metadata:** recorded in the final summary commit.

## Files Created/Modified

- `src/graph/document-summary.ts` - Builds document-level graph summaries from persisted node and edge rows.
- `src/mcp/tools/documents/get.ts` - Accepts `graph_summary` and graph-aware connection options in the MCP input schema.
- `src/mcp/utils/document-output.ts` - Validates graph-aware connection conflicts and includes `graph_summary` in output envelopes.
- `src/mcp/utils/document-connections.ts` - Adds graph-primary connection assembly, graph/embedding composition, inactive-target filtering, relation filtering, and stale-edge filtering.
- `tests/unit/document-output.test.ts` - Covers graph summary output and graph-aware limit validation.
- `tests/unit/document-connections.test.ts` - Covers graph-primary overlays, embedding-only opt-in, inactive filtering, and legacy behavior.
- `tests/integration/graph/get-document-graph.test.ts` - Exercises `get_document` graph summary, graph connections, legacy compatibility, and validation through the registered MCP handler.

## Decisions Made

- Graph-aware behavior is opt-in via the new connection options. Existing callers that pass only `limit`, `limit_per_chunk`, or `embedding_names` continue to use the stored-vector connection path.
- Embedding-only neighbors are appended after graph-connected targets only when `include_embedding_only:true`.
- `get_document` hides inactive graph targets by default and includes them only with `include_inactive_targets:true`, matching GR-016A.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The exact plan unit command `npm test -- --run tests/unit/document-output.test.ts tests/unit/document-connections.test.ts` runs the repo's full unit wrapper before the scoped files. Final status: **FAIL** due to unrelated concurrent work in `tests/unit/frontmatter-fields.test.ts`, where `FM.PROCESSING` was added outside this plan's write set without updating the ordering test.
- A direct scoped unit run for this plan's files passed: `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/document-output.test.ts tests/unit/document-connections.test.ts`.

## Verification

- **PASS:** `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/document-output.test.ts tests/unit/document-connections.test.ts` - 2 files, 55 tests passed.
- **PASS:** `npm run test:integration -- --run tests/integration/graph/get-document-graph.test.ts` - 1 file, 3 tests passed.
- **FAIL (unrelated):** `npm test -- --run tests/unit/document-output.test.ts tests/unit/document-connections.test.ts` - full unit wrapper failed in `tests/unit/frontmatter-fields.test.ts`, outside this plan's write set.

## Known Stubs

None.

## Threat Flags

None. The new MCP option validation and inactive-target filtering are the mitigations already listed in the plan threat model.

## User Setup Required

None.

## Next Phase Readiness

`get_document` can now participate in Phase 172 graph read-surface validation. Remaining unrelated worktree changes are owned by concurrent plans and were not modified here.

## Self-Check: PASSED

- **Files:** `src/graph/document-summary.ts`, `tests/integration/graph/get-document-graph.test.ts`, and this summary file exist.
- **Commits:** `c50d8445` and `bb4ed17b` are present in git history.

---
*Phase: 172-structural-graph-and-read-surfaces*
*Completed: 2026-06-24*
