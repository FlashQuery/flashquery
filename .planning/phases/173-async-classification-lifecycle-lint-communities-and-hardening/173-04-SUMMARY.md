---
phase: 173-async-classification-lifecycle-lint-communities-and-hardening
plan: 04
subsystem: graph
tags: [graph, lifecycle, scanner, query_graph, fq_processing]

requires:
  - phase: 173-03
    provides: pending graph worker, stale edge completion, and durable pending-edge lifecycle
provides:
  - Lifecycle helpers for chunk, graph, pending-embed, and pending-edge cleanup
  - Scanner handling for archived drift that marks graph edges stale without reprocessing
  - Query graph document_status filtering while preserving provenance traversal
affects: [graph-lint, graph-communities, public-graph-scenarios]

tech-stack:
  added: []
  patterns:
    - Shared graph lifecycle SQL helpers under src/graph/lifecycle.ts
    - Surface-specific lifecycle filtering in src/graph/queries.ts

key-files:
  created:
    - src/graph/lifecycle.ts
    - tests/unit/graph-lifecycle.test.ts
    - tests/integration/graph/archive-missing-lifecycle.test.ts
  modified:
    - src/embedding/chunks/scheduler.ts
    - src/services/scanner.ts
    - src/graph/queries.ts
    - tests/unit/graph-query-status-filter.test.ts
    - tests/integration/graph/query-graph.test.ts

key-decisions:
  - "fq_processing none explicitly deletes pending graph jobs before deleting chunks, even though chunk FKs also cascade."
  - "Archived file drift marks touching graph edges stale and returns before embedding or graph candidate scheduling."
  - "query_graph document_status filters node-heavy actions, while provenance_chain intentionally ignores that filter to preserve historical traversal."

patterns-established:
  - "Lifecycle cleanup lives in graph/lifecycle.ts and is called from scheduler/scanner paths."
  - "Inactive read filtering stays surface-specific: search/get_document hide by default, query_graph labels and can filter, provenance always traverses."

requirements-completed: [GR-014B, GR-015, GR-016B, GR-020B]

duration: 1h21m
completed: 2026-06-24
---

# Phase 173 Plan 04: Lifecycle Completion and Surface Filtering Summary

**Lifecycle-aware graph maintenance for fq_processing transitions, archived/missing scanner drift, and query_graph document-status filters.**

## Performance

- **Duration:** 1h21m
- **Started:** 2026-06-24T14:54:42Z
- **Completed:** 2026-06-24T15:15:43Z
- **Tasks:** 3/3
- **Files modified:** 8

## Accomplishments

- Added `src/graph/lifecycle.ts` with shared cleanup/staleness helpers for graph lifecycle state.
- Updated `fq_processing: none` cleanup to explicitly remove pending graph jobs before chunk deletion.
- Updated scanner archived-drift handling to mark active graph edges stale without embedding, candidate enqueue, or classification.
- Applied `query_graph document_status` filtering to node-heavy actions while keeping provenance traversal inactive-aware.

## Task Commits

1. **Task 1 RED: lifecycle cleanup coverage** - `b96d9295` (test)
2. **Task 1 GREEN: lifecycle cleanup helpers** - `80030a61` (feat)
3. **Task 2: inactive graph lifecycle state** - `8e9d7e50` (feat)
4. **Task 3: query graph lifecycle status filters** - `bfa66660` (feat)

## Files Created/Modified

- `src/graph/lifecycle.ts` - Shared graph cleanup and stale-marking helpers.
- `src/embedding/chunks/scheduler.ts` - Routes processing-level cleanup through lifecycle helpers.
- `src/services/scanner.ts` - Marks archived drift stale without reprocessing inactive documents.
- `src/graph/queries.ts` - Applies `document_status` filter across query_graph actions except provenance.
- `tests/unit/graph-lifecycle.test.ts` - Covers lifecycle cleanup SQL contracts.
- `tests/unit/graph-query-status-filter.test.ts` - Covers surface filters and queryGraph action filtering.
- `tests/integration/graph/archive-missing-lifecycle.test.ts` - Covers archive drift, missing restore, and hard-delete FK cascade behavior.
- `tests/integration/graph/query-graph.test.ts` - Adds persisted `document_status` filter assertion.

## Decisions Made

- Explicit pending-edge deletion was added before `fq_processing: none` chunk deletion for clear correctness, not just FK reliance.
- Archived drift updates the archived document row hash/path and marks touching graph edges stale, but does not call chunk scheduling.
- `provenance_chain` bypasses explicit `document_status` filtering because GR-016B/GR-020B require historical inactive traversal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added explicit pending graph job cleanup for fq_processing none**
- **Found during:** Task 1
- **Issue:** Existing cleanup deleted chunks and pending embeds, relying on FK cascade for pending graph jobs.
- **Fix:** Added `removeDocumentChunkProcessingState()` that deletes `fqc_pending_edges`, pending chunk embeds, then chunks.
- **Files modified:** `src/graph/lifecycle.ts`, `src/embedding/chunks/scheduler.ts`
- **Verification:** `npm run test:unit -- --run tests/unit/graph-lifecycle.test.ts tests/unit/graph-processing-level.test.ts`
- **Committed in:** `80030a61`

**2. [Rule 2 - Missing Critical] Added inactive drift stale marking**
- **Found during:** Task 2
- **Issue:** Archived UUID scanner drift updated document hash/path but did not mark graph edges stale.
- **Fix:** Added `markDocumentGraphEdgesStale()` and called it from archived drift handling before returning without reprocessing.
- **Files modified:** `src/graph/lifecycle.ts`, `src/services/scanner.ts`
- **Verification:** `npm run test:integration -- --run tests/integration/graph/archive-missing-lifecycle.test.ts`
- **Committed in:** `8e9d7e50`

**3. [Rule 1 - Bug] query_graph document_status did not filter node-heavy actions**
- **Found during:** Task 3
- **Issue:** `document_status` filtered edge helpers but actions like `stats` and `node` loaded the full row set.
- **Fix:** Added action-level loaded-row filtering for query_graph actions, with a provenance exception.
- **Files modified:** `src/graph/queries.ts`, `tests/unit/graph-query-status-filter.test.ts`, `tests/integration/graph/query-graph.test.ts`
- **Verification:** `npm run test:unit -- --run tests/unit/graph-query-status-filter.test.ts`; `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts`
- **Committed in:** `bfa66660`

---

**Total deviations:** 3 auto-fixed (2 Rule 2, 1 Rule 1)  
**Impact on plan:** All fixes were required for lifecycle correctness and stayed within the owned files.

## Issues Encountered

- The literal plan unit command `npm test -- --run ...` runs the full unit suite and then invokes the macro-framework test script with the unit file filters; the macro-framework phase exits with "No test files found." The equivalent direct unit command passed.
- The combined Task 3 integration command hung after build with no assertion output. Running `query-graph.test.ts` and `provenance-question.test.ts` individually passed. `search-graph-expansion.test.ts` and `get-document-graph.test.ts` also hung after build when run individually and were interrupted.

## Verification

- `npm test -- --run tests/unit/graph-lifecycle.test.ts tests/unit/graph-processing-level.test.ts` - unit suite passed, then macro-framework filter failed with no matching files.
- `npm run test:unit -- --run tests/unit/graph-lifecycle.test.ts tests/unit/graph-processing-level.test.ts` - passed, 2 files / 6 tests.
- `npm run test:integration -- --run tests/integration/graph/archive-missing-lifecycle.test.ts` - passed, 1 file / 3 tests.
- `npm run test:unit -- --run tests/unit/graph-query-status-filter.test.ts` - passed, 1 file / 4 tests.
- `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts` - passed, 1 file / 3 tests.
- `npm run test:integration -- --run tests/integration/graph/provenance-question.test.ts` - passed, 1 file / 1 test.
- `npm run test:unit -- --run tests/unit/graph-lifecycle.test.ts tests/unit/graph-query-status-filter.test.ts` - passed, 2 files / 7 tests.
- `npm run test:integration -- --run tests/integration/graph/provenance-question.test.ts tests/integration/graph/query-graph.test.ts tests/integration/graph/search-graph-expansion.test.ts tests/integration/graph/get-document-graph.test.ts` - hung after build; interrupted.
- `npm run test:integration -- --run tests/integration/graph/search-graph-expansion.test.ts` - hung after build; interrupted.
- `npm run test:integration -- --run tests/integration/graph/get-document-graph.test.ts` - hung after build; interrupted.
- `npm run typecheck` - passed.
- `npm run build` - passed.

## Known Stubs

None. Stub scan findings were existing empty defaults/local test fixtures, not unfinished lifecycle behavior.

## Threat Flags

None beyond the plan threat model. Changes stay within existing DB lifecycle and graph read surfaces and preserve `instance_id` filtering.

## User Setup Required

None - no new external service configuration required.

## Next Phase Readiness

Plan 05 can build graph lint on top of lifecycle-aware status filters. In particular, `graph_lint` can reuse query/status semantics to ignore both-inactive edges and report active-to-inactive edges as informational.

## Self-Check: PASSED

- Created files exist: `src/graph/lifecycle.ts`, `tests/unit/graph-lifecycle.test.ts`, `tests/integration/graph/archive-missing-lifecycle.test.ts`, this summary file.
- Commits exist: `b96d9295`, `80030a61`, `8e9d7e50`, `bfa66660`.
- Shared orchestrator files `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified by this executor beyond pre-existing dirty state and were not staged.

---
*Phase: 173-async-classification-lifecycle-lint-communities-and-hardening*
*Completed: 2026-06-24*
