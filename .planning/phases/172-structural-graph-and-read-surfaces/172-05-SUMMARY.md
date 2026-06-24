---
phase: 172-structural-graph-and-read-surfaces
plan: 05
subsystem: search
tags: [graph, search, mcp, supabase, scenarios]

requires:
  - phase: 172-03
    provides: Graph query schema, seeded community read-through, provenance/status filters
  - phase: 172-02
    provides: fq_processing gates and structural graph processing wiring
provides:
  - Opt-in graph-expanded unified search from semantic seed chunks
  - Graph match attribution and graph_context metadata for expanded/merged document hits
  - Deterministic graph ranking helper and T-Y-002 YAML scenario coverage
affects: [phase-172, graph-read-surfaces, search]

tech-stack:
  added: []
  patterns:
    - "Search graph expansion loads bounded instance-filtered graph rows through queryPgPool"
    - "Graph-expanded search merges graph attribution into semantic hits instead of replacing base search behavior"

key-files:
  created:
    - tests/unit/graph-search-ranking.test.ts
    - tests/integration/graph/search-graph-expansion.test.ts
    - tests/scenarios/integration/tests/graph_search_expansion.yml
  modified:
    - src/mcp/tools/compound.ts

key-decisions:
  - "Graph expansion is opt-in through additive search params; omitted graph options leave existing search result shaping untouched."
  - "Graph-expanded hits can merge with semantic hits, producing combined match_source attribution and graph_context metadata."
  - "T-Y-002 writes the graph target before the seed so save-time structural link resolution can create the reference edge."

patterns-established:
  - "Graph search ranking order: relation significance, active edge status, confidence score, seed semantic relevance, stable path tie-break."
  - "Disabled graph search requests warn with graph_disabled and skip graph DB work."

requirements-completed: [GR-016A, GR-018, GR-024A]

duration: 22min
completed: 2026-06-24
---

# Phase 172 Plan 05: Graph-Expanded Search Summary

**Opt-in graph-expanded unified search with graph attribution, deterministic ranking, disabled-mode warnings, and T-Y-002 workflow coverage.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-06-24T03:20:06Z
- **Completed:** 2026-06-24T03:42:19Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Added additive `search` graph params: `graph_expand`, relation/depth/stale/inactive filters, `include_community`, and `path_to`.
- Expanded only from semantic seed chunks, with instance-filtered graph reads and bounded traversal.
- Added `match_source` graph attribution plus `graph_context` metadata for relation, confidence, staleness, seed chunk, community, and path metadata.
- Preserved no-graph search compatibility and covered disabled graph requests with warning behavior.
- Added unit, integration, and YAML scenario coverage for T-U-061, T-I-010/T-I-011/T-I-012/T-I-038, and T-Y-002.

## Task Commits

1. **Task 1 RED: Extend search with additive graph parameters** - `4c1bbb84` (test)
2. **Task 1 GREEN: Implement graph-expanded search** - `50784bef` (feat)

**Plan metadata:** pending in the docs commit that adds this summary.

## Files Created/Modified

- `src/mcp/tools/compound.ts` - Added graph search option parsing, graph row loading, bounded expansion, ranking, attribution, and response metadata.
- `tests/unit/graph-search-ranking.test.ts` - Covers deterministic graph-expanded ranking order.
- `tests/integration/graph/search-graph-expansion.test.ts` - Covers compatibility, expansion attribution, disabled graph warnings, community metadata, and path metadata.
- `tests/scenarios/integration/tests/graph_search_expansion.yml` - Adds T-Y-002 linked-doc public workflow coverage.

## Decisions Made

- Graph expansion reads from `fqc_graph_nodes`/`fqc_graph_edges` using `queryPgPool` so graph reads can join chunks/documents with strict `instance_id` filters.
- Expanded graph candidates are merged into normal search results, which lets documents already returned semantically gain `graph` attribution instead of being duplicated.
- The YAML scenario writes the connected target before the seed because Phase 172 structural link resolution is save-time and does not reprocess an unchanged seed solely because a later target appears.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Merged graph attribution into semantic seed-adjacent hits**
- **Found during:** Task 1 YAML verification
- **Issue:** A graph-connected document that also appeared as a semantic result was skipped as an existing seed-adjacent result, so it lacked `graph_context`.
- **Fix:** Allowed graph candidates for any connected chunk except the same seed chunk, letting merge logic aggregate `semantic` and `graph` match sources.
- **Files modified:** `src/mcp/tools/compound.ts`
- **Verification:** `npm run test:integration -- --run tests/integration/graph/search-graph-expansion.test.ts`; `python3 tests/scenarios/integration/run_integration.py --managed graph_search_expansion`
- **Committed in:** `50784bef`

**2. [Rule 3 - Blocking] Added embedding fetch mock to the new integration test**
- **Found during:** Task 1 integration verification
- **Issue:** The new integration file used the existing embedding search harness but did not mock the embedding provider fetch, causing the test to wait on the fake endpoint.
- **Fix:** Added the same `globalThis.fetch` embedding mock pattern used by existing embedding search integration tests.
- **Files modified:** `tests/integration/graph/search-graph-expansion.test.ts`
- **Verification:** `npm run test:integration -- --run tests/integration/graph/search-graph-expansion.test.ts`
- **Committed in:** `50784bef`

**3. [Rule 1 - Test Workflow] Adjusted T-Y-002 write order for save-time link resolution**
- **Found during:** Task 1 YAML verification
- **Issue:** The initial scenario wrote the seed before the linked target, so the structural `references` edge was unresolved and no unchanged seed was reprocessed by sync.
- **Fix:** Wrote the connected target first, then the seed containing the link.
- **Files modified:** `tests/scenarios/integration/tests/graph_search_expansion.yml`
- **Verification:** `python3 tests/scenarios/integration/run_integration.py --managed graph_search_expansion`
- **Committed in:** `50784bef`

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking test harness issue).
**Impact on plan:** All fixes stayed inside the declared write set and were required to satisfy graph attribution and scenario coverage.

## Issues Encountered

- The exact plan command `npm test -- --run tests/unit/graph-search-ranking.test.ts tests/unit/search.test.ts` ran the unit suite successfully, then failed because the repo wrapper forwarded the file filters to `test:macro-framework`, where no macro tests matched. The clean targeted command `npm run test:unit -- --run tests/unit/graph-search-ranking.test.ts tests/unit/search.test.ts` passed.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used by integration/scenario tests.

## Verification

- PASS: `npm run test:unit -- --run tests/unit/graph-search-ranking.test.ts tests/unit/search.test.ts`
- PASS: `npm run test:integration -- --run tests/integration/graph/search-graph-expansion.test.ts`
- PASS: `python3 tests/scenarios/integration/run_integration.py --managed graph_search_expansion`
- WRAPPER ISSUE: `npm test -- --run tests/unit/graph-search-ranking.test.ts tests/unit/search.test.ts` passed unit tests but exited 1 after `test:macro-framework` received non-macro file filters.

## Known Stubs

None.

## Threat Flags

None - the new graph read surface was already covered by the plan threat model and uses instance-filtered reads plus bounded depth.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/172-structural-graph-and-read-surfaces/172-05-SUMMARY.md`.
- Task commits exist: `4c1bbb84`, `50784bef`.
- Required created files exist.

## Next Phase Readiness

Graph-expanded search is ready for Phase 172 final validation. `get_document` graph-aware behavior from adjacent plans remains untouched, and 172-02 `fq_processing` behavior in `compound.ts` was preserved.

---
*Phase: 172-structural-graph-and-read-surfaces*
*Completed: 2026-06-24*
