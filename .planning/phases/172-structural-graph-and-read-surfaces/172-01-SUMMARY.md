---
phase: 172-structural-graph-and-read-surfaces
plan: 01
subsystem: graph
tags: [graph, chunks, structural-edges, markdown-links, staleness, supabase]

requires:
  - phase: 171-graph-foundation-schema-and-vocabulary
    provides: graph schema tables, relation vocabulary, and edge metadata validation
provides:
  - Chunk-keyed graph node helper using existing fqc_chunks.id identity
  - Deterministic Tier 1 contains and references edge helpers
  - Markdown link and wikilink resolver with unresolved diagnostics
  - Changed-chunk stale-marking helpers for non-structural edges
affects: [phase-172, phase-173, graph-processing, graph-read-surfaces]

tech-stack:
  added: []
  patterns:
    - Pure graph draft builders plus instance-filtered PostgreSQL persistence helpers
    - Markdown links parsed through mdast/gfm; wikilinks scanned outside fenced code
    - Chunk diff outputs accepted directly by staleness helpers

key-files:
  created:
    - src/graph/structural.ts
    - src/graph/link-resolver.ts
    - src/graph/staleness.ts
    - tests/unit/graph-node-identity.test.ts
    - tests/unit/graph-structural.test.ts
    - tests/unit/graph-link-resolver.test.ts
    - tests/unit/graph-staleness.test.ts
    - tests/integration/graph/node-identity.test.ts
    - tests/integration/graph/structural-edges.test.ts
  modified: []

key-decisions:
  - "Graph node rows use ParsedChunk.id directly as fqc_graph_nodes.chunk_id; no alternate section IDs were introduced."
  - "Contains edges are derived from explicit parent_chunk_id when present and from heading-path hierarchy for current parser output."
  - "Resolved references omit extra metadata because the Phase 171 validator currently only allows unresolved-target metadata for the references relation."

patterns-established:
  - "Structural graph writes delete and reinsert active contains/references edges for the source document's chunks, filtered by instance_id."
  - "Changed chunks mark active non-structural touching edges stale while Tier 1 refresh remains synchronous and does not enqueue Tier 2/Tier 3 work."

requirements-completed: [GR-006, GR-009, GR-013A]

duration: 20min
completed: 2026-06-24
---

# Phase 172 Plan 01: Chunk-Keyed Structural Graph Helpers Summary

**Chunk-keyed graph node, deterministic structural edge, markdown reference resolution, and changed-chunk staleness helpers for Tier 1 graph processing**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-24T02:40:00Z
- **Completed:** 2026-06-24T02:59:54Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added `src/graph/structural.ts` helpers that build graph nodes from existing chunk IDs, generate `contains` edges, resolve `references` edges, and persist active Tier 1 edges with `instance_id` filtering.
- Added `src/graph/link-resolver.ts` for markdown links and wikilinks, including document-root links, anchor resolution, unresolved-target/unresolved-anchor diagnostics, and fenced-code exclusion.
- Added `src/graph/staleness.ts` helpers that accept `diffAndPersistDocumentChunks()` diff shapes, mark touching non-structural edges stale, and keep Tier 1 refresh synchronous without graph LLM queueing.
- Added unit and integration coverage for node identity, structural edges, link resolution, and staleness behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: structural graph tests** - `99c5bf1b` (test)
2. **Task 1 GREEN: structural graph helpers** - `6ee9ee74` (feat)
3. **Task 2 RED: staleness tests** - `046d71fa` (test)
4. **Task 2 GREEN: staleness helpers** - `b4a2a46f` (feat)
5. **Verification fix: remove graph import cycle** - `21cbc33b` (fix)

## Files Created/Modified

- `src/graph/structural.ts` - Chunk-keyed node rows, `contains`/`references` edge drafts, and instance-filtered structural graph persistence.
- `src/graph/link-resolver.ts` - Markdown link and wikilink resolution against known document chunks with unresolved diagnostics.
- `src/graph/staleness.ts` - Changed-chunk stale-marking and synchronous Tier 1 refresh planning.
- `tests/unit/graph-node-identity.test.ts` - Unit coverage for graph node identity matching existing chunk IDs.
- `tests/unit/graph-structural.test.ts` - Unit coverage for deterministic `contains` edges.
- `tests/unit/graph-link-resolver.test.ts` - Unit coverage for wikilinks, markdown links, unresolved targets/anchors, and fenced code.
- `tests/unit/graph-staleness.test.ts` - Unit coverage for stale marking and no Tier 2/Tier 3 enqueueing.
- `tests/integration/graph/node-identity.test.ts` - Supabase cascade coverage for graph node identity.
- `tests/integration/graph/structural-edges.test.ts` - Supabase persistence coverage for `contains` and `references` edges filtered by `instance_id`.

## Decisions Made

- Followed the existing chunk parser contract instead of changing parser identity behavior. Current `parent_chunk_id` links split chunks, so heading hierarchy containment is inferred from `heading_path` while still honoring explicit `parent_chunk_id`.
- Kept unresolved-link results as diagnostics rather than fake node rows. This preserves the REQ-009 no-fake-node invariant.
- Did not add Tier 2/Tier 3 candidate or pending-edge queueing. `planSynchronousTier1Refresh()` explicitly reports those as false for Phase 172 Plan 01.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed structural graph import cycle**
- **Found during:** Plan verification
- **Issue:** The exact aggregate unit command surfaced `graph/link-resolver.ts > graph/structural.ts` in the repo's circular dependency guard.
- **Fix:** Removed the type import from `link-resolver.ts` and kept the small resolved-reference edge draft shape local to that module.
- **Files modified:** `src/graph/link-resolver.ts`
- **Verification:** `npm run test:unit -- --run tests/unit/circular-deps.test.ts` passed.
- **Committed in:** `21cbc33b`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix reduced coupling and did not change the requested graph behavior.

## Issues Encountered

- The plan's exact unit command, `npm test -- --run ...`, passed the full unit suite but then failed in the macro-framework script because npm forwarded graph unit test filters into the macro-framework Vitest config, where no matching files exist. Focused unit verification used `npm run test:unit -- --run ...`, which passed.
- The existing edge metadata validator rejects arbitrary metadata for the `references` relation. Resolved reference edges therefore persist with `{}` metadata; unresolved references are returned as diagnostics for later lint/read-surface wiring.

## Verification

- PASS: `npm run test:unit -- --run tests/unit/graph-node-identity.test.ts tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts tests/unit/graph-staleness.test.ts` — 4 files, 12 tests passed.
- PASS: `npm run test:unit -- --run tests/unit/circular-deps.test.ts` — 1 file, 6 tests passed.
- PASS: `npm run test:integration -- --run tests/integration/graph/node-identity.test.ts tests/integration/graph/structural-edges.test.ts` — 2 files, 2 tests passed using `.env.test` Supabase settings.
- PARTIAL/COMMAND ISSUE: `npm test -- --run tests/unit/graph-node-identity.test.ts tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts tests/unit/graph-staleness.test.ts` — full `test:unit` half passed 224 files / 2440 tests; `test:macro-framework` half failed with "No test files found" because the graph unit filters do not match macro-framework include patterns.

## Known Stubs

None.

## Threat Flags

None. New graph DB helpers use `instance_id` predicates and do not add new network endpoints, auth paths, file access patterns, or schema changes.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used for integration tests.

## Next Phase Readiness

Plan 172-02 can wire these helpers into `fq_processing` gates and scanner/write-path processing. Tier 2/Tier 3 async classification and stale-edge reconciliation remain Phase 173 scope.

## Self-Check: PASSED

- Confirmed created files exist on disk.
- Confirmed task commits exist: `99c5bf1b`, `6ee9ee74`, `046d71fa`, `b4a2a46f`, `21cbc33b`.
- Confirmed final focused unit and integration verification passed after the last code commit.

---
*Phase: 172-structural-graph-and-read-surfaces*
*Completed: 2026-06-24*
