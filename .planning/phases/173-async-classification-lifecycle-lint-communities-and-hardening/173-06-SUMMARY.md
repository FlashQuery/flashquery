---
phase: 173-async-classification-lifecycle-lint-communities-and-hardening
plan: 6
subsystem: graph-read-surfaces
tags: [graph, communities, query-graph, search, get-document, integration-scenarios]

requires:
  - phase: 173-05
    provides: Topology-only community detection and graph_lint community category payloads
provides:
  - Populated community metadata on query_graph list/community actions
  - Weak path diagnostics with path-shaped below-threshold provenance chains
  - Search community context without requiring graph expansion
  - Managed YAML workflow for graph_lint community labeling and query_graph member reads
affects: [graph-read-surfaces, graph-lint, public-workflows]

tech-stack:
  added: []
  patterns:
    - Read-time community health metrics derived from stored graph topology
    - include_community search annotation separated from graph expansion

key-files:
  created:
    - tests/scenarios/integration/tests/graph_lint_communities.yml
  modified:
    - src/graph/queries.ts
    - src/mcp/tools/compound.ts
    - tests/integration/graph/query-graph.test.ts
    - tests/integration/graph/get-document-graph.test.ts

key-decisions:
  - "Community strength/density/provenance metrics are derived at read time from stored graph rows rather than adding new schema."
  - "search include_community annotates existing semantic results independently from graph_expand so callers can request community context without changing result membership."
  - "The public YAML scenario declares embeddings because graph.enabled requires a configured graph.embedding_name in managed mode."

patterns-established:
  - "query_graph weak_paths keeps the legacy flat edges list while adding path-shaped diagnostics for richer callers."
  - "query_graph remains read-only; graph_lint execution and community assignment mutation stay under maintain_vault."

requirements-completed: [GR-022, GR-016B, GR-020B]

duration: 13m
completed: 2026-06-24T15:58:02Z
---

# Phase 173 Plan 6: Community Read Integration Summary

**Topology-only community metadata now reaches query_graph, search, get_document coverage, and a public graph_lint YAML workflow.**

## Performance

- **Duration:** 13m
- **Started:** 2026-06-24T15:44:50Z
- **Completed:** 2026-06-24T15:58:02Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Added path-shaped `weak_paths` output containing below-threshold relation chains while preserving the existing flat `edges` field.
- Added `list_communities` strength, density, average confidence, provenance coverage, sparse flag, and representative members from stored graph topology.
- Split `search include_community` from graph expansion so community context can annotate semantic seed results without adding graph-expanded results.
- Added `graph_lint_communities.yml` to exercise graph_lint community labeling and public `query_graph list_communities` reads.

## Task Commits

1. **Task 1: Populate query/search/get_document community reads** - `e8321ab0`
2. **Task 2: Add community lint scenario and category integration** - `6b23918d`

## Files Created/Modified

- `src/graph/queries.ts` - Adds weak path structures and read-time community health summaries.
- `src/mcp/tools/compound.ts` - Adds community annotation for semantic search results and separates annotation from expansion.
- `tests/integration/graph/query-graph.test.ts` - Strengthens T-I-029 and T-I-033 assertions for paths and community metrics.
- `tests/integration/graph/get-document-graph.test.ts` - Asserts graph-primary connections expose community labels.
- `tests/scenarios/integration/tests/graph_lint_communities.yml` - Adds T-Y-004/IG-04 managed public workflow.

## Decisions Made

- Derived community metrics from existing node/edge state to avoid schema churn and keep v1 community metadata ephemeral.
- Kept `query_graph` read-only; no graph_lint or community detection execution is invoked from query reads.
- Left `src/graph/lint-categories.ts` unchanged because Plan 173-05 already included `strength_score`, document membership, and structural health fields; focused unit coverage for that contract passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added managed scenario embedding dependency**
- **Found during:** Task 2 verification
- **Issue:** Managed graph-enabled startup rejected the scenario because `graph.embedding_name` requires a configured embedding entry.
- **Fix:** Added `graph.embedding_name: primary` and `deps: [embeddings]` to the YAML scenario, matching existing graph search scenario conventions.
- **Files modified:** `tests/scenarios/integration/tests/graph_lint_communities.yml`
- **Verification:** YAML parsed successfully; managed runner progressed past the missing-embedding-name error.
- **Committed in:** `6b23918d`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Scenario configuration was required for managed graph startup. No product scope change.

## Issues Encountered

- The required Vitest integration command hung twice after the build phase with no test output and was interrupted after multiple 30s waits.
- The managed YAML scenario then reached server startup but was blocked by the shared test database having inconsistent embedding vector widths: `fqc_memory.embedding_primary` width 3 and `fqc_chunks.embedding_primary` width 768. Running with `FQC_TEST_EMBEDDING_DIMENSIONS=3` inverted the drift failure, so no single setting could satisfy startup in this DB state.

## Verification

- `npm run typecheck` - passed.
- `npm run test:unit -- --run tests/unit/graph-query.test.ts tests/unit/graph-search-ranking.test.ts tests/unit/graph-lint.test.ts` - passed, 3 files / 17 tests.
- `python3 -c "import yaml; yaml.safe_load(open('tests/scenarios/integration/tests/graph_lint_communities.yml'))"` - passed.
- `rg -n "graph_lint|detectAndApplyTopologyCommunities|maintain_vault" src/graph/queries.ts src/mcp/tools/graph.ts` - no matches; query_graph remains read-only.
- `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts tests/integration/graph/search-graph-expansion.test.ts tests/integration/graph/get-document-graph.test.ts tests/integration/graph/graph-lint.test.ts` - blocked/hung after build, interrupted.
- `python3 tests/scenarios/integration/run_integration.py --managed graph_lint_communities` - blocked by embedding dimension drift in the shared test DB.

## User Setup Required

The shared Supabase test schema needs embedding column widths reconciled before managed embedding-dependent scenarios can start. Current observed conflict: `fqc_memory.embedding_primary` width 3 versus `fqc_chunks.embedding_primary` width 768.

## Known Stubs

None. Stub-pattern scan only found ordinary local empty arrays/defaults and null checks, not placeholder read-surface behavior.

## Threat Flags

None. This plan added no new network endpoints, auth paths, file access patterns, schema changes, or mutation surfaces.

## Next Phase Readiness

Plan 173-07 can consume populated community read metadata and the public YAML workflow. Full DB-backed verification should be rerun after the test database embedding width drift is corrected.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/173-async-classification-lifecycle-lint-communities-and-hardening/173-06-SUMMARY.md`.
- Task commits exist: `e8321ab0`, `6b23918d`.
- Key created/modified files exist.
- Shared orchestrator files were not updated or staged.

---
*Phase: 173-async-classification-lifecycle-lint-communities-and-hardening*
*Completed: 2026-06-24*
