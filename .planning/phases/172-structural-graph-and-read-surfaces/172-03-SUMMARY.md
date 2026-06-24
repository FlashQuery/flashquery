---
phase: 172-structural-graph-and-read-surfaces
plan: 03
subsystem: graph
tags: [graph, query_graph, provenance, communities, vitest, supabase]

requires:
  - phase: 171-graph-foundation-schema-and-vocabulary
    provides: graph schema, relation vocabulary, response conventions
provides:
  - Bounded graph query helper contracts
  - Graph-specific JSON response wrappers
  - Provenance, question lifecycle, and seeded community read tests
affects: [query_graph, graph-read-surfaces, graph-provenance, graph-communities]

tech-stack:
  added: []
  patterns:
    - Store-backed graph query helpers with in-memory and pg-compatible adapters
    - Graph response helpers wrap canonical MCP JSON envelopes

key-files:
  created:
    - src/graph/queries.ts
    - src/graph/response.ts
    - tests/unit/graph-query.test.ts
    - tests/unit/graph-query-status-filter.test.ts
    - tests/unit/graph-question-lifecycle.test.ts
    - tests/unit/graph-provenance.test.ts
    - tests/integration/graph/provenance-question.test.ts
  modified: []

key-decisions:
  - "Implemented graph query helpers against a small store interface with in-memory and pg-compatible adapters so MCP registration can wire the helpers later without coupling tests to transport."
  - "Kept community behavior to seeded read-through only; no community detection, lint population, density maintenance, or stable lifecycle code was added."

patterns-established:
  - "Graph query responses map stored graph rows into JSON-friendly node and edge payloads rather than exposing raw DB row shapes."
  - "Traversal helpers enforce instance-scoped store reads, bounded depth/limits, relation filters, stale filters, and visited-set cycle protection."

requirements-completed: [GR-016A, GR-017, GR-020A, GR-024A]

duration: 13 min
completed: 2026-06-24
---

# Phase 172 Plan 03: Graph Query Helpers Summary

**Bounded graph read helpers with canonical envelopes, provenance/question metadata, seeded community read-through, and focused unit/integration coverage**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-24T02:46:00Z
- **Completed:** 2026-06-24T02:59:18Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added `src/graph/queries.ts` with `node`, `edges`, `neighbors`, `path`, `subgraph`, `stats`, `schema`, `contradictions`, `impact`, `provenance_chain`, `weak_paths`, `ungrounded_edges`, and seeded community read actions.
- Added `src/graph/response.ts` to wrap graph success, expected-error, and runtime-error payloads with existing JSON MCP response conventions.
- Added unit coverage for invalid action/parameter errors, bounded traversal, cycle protection, status filtering, schema shaping, question lifecycle fields, provenance ordering, and seeded community reads.
- Added integration coverage proving provenance, inactive historical status labels, question metadata, and seeded community metadata are queryable from persisted graph rows.

## Task Commits

1. **Task 1 RED: Add failing graph query helper tests** - `0c36943a` (test)
2. **Task 1 GREEN: Implement graph query helper contracts** - `a0e24d82` (feat)
3. **Task 2: Cover graph provenance and community reads** - `a65112b7` (test)

## Files Created/Modified

- `src/graph/queries.ts` - Read-only graph query helpers, store adapters, traversal, filters, provenance, and community reads.
- `src/graph/response.ts` - Graph-specific response envelope helpers.
- `tests/unit/graph-query.test.ts` - Invalid input, traversal, cycle protection, and schema tests.
- `tests/unit/graph-query-status-filter.test.ts` - Surface-specific inactive filtering tests.
- `tests/unit/graph-question-lifecycle.test.ts` - Question lifecycle and seeded community read tests.
- `tests/unit/graph-provenance.test.ts` - Extracted-before-inferred provenance ordering tests.
- `tests/integration/graph/provenance-question.test.ts` - Persisted graph row provenance, question, inactive status, and community read-through test.

## Decisions Made

- Used a `GraphQueryStore` interface plus `createInMemoryGraphQueryStore` and `createPgGraphQueryStore` adapters to keep helper contracts independent of MCP registration while still testing persisted DB rows.
- Returned graph-specific payloads with stable identifiers, nested document metadata, confidence/stale fields, and community/question/provenance metadata, avoiding raw `source_chunk_id`/`target_chunk_id` DB row exposure in public payloads.
- Deferred community detection and maintenance logic exactly as planned; only nullable seeded fields already present on `fqc_graph_nodes` are read.

## Verification

- PASS: `npm run test:unit -- --run tests/unit/graph-query.test.ts tests/unit/graph-query-status-filter.test.ts`
- PASS: `npm run test:unit -- --run tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts tests/unit/graph-query.test.ts`
- PASS: `npm run test:unit -- --run tests/unit/graph-query.test.ts tests/unit/graph-query-status-filter.test.ts tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts`
- PASS: `npm run test:integration -- --run tests/integration/graph/provenance-question.test.ts`
- PARTIAL: `npm test -- --run tests/unit/graph-query.test.ts tests/unit/graph-query-status-filter.test.ts` ran the full unit suite successfully (`224` files, `2440` tests) but then failed in `test:macro-framework` because npm forwarded the unit test file paths to the macro-framework Vitest config, where no files match.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used direct unit test command for owned-file verification**
- **Found during:** Task 1 and plan verification
- **Issue:** The literal `npm test -- --run ...` command invokes `npm run test:unit` without forwarding the filter, then forwards the unit file paths to `test:macro-framework`, causing a no-matching-files failure after the unit suite passes.
- **Fix:** Verified owned tests with `npm run test:unit -- --run ...`, while also recording the literal wrapper behavior.
- **Files modified:** None
- **Verification:** Direct owned unit commands passed; the literal wrapper completed the full unit suite before the macro-framework filter failure.
- **Committed in:** N/A

**2. [Rule 1 - TDD Gate] Task 2 RED tests passed unexpectedly**
- **Found during:** Task 2
- **Issue:** Provenance ordering, question metadata, and seeded community reads were already covered by the shared query dispatcher implemented in Task 1.
- **Fix:** Confirmed the behavior with focused unit and integration tests and documented the TDD gate deviation instead of weakening tests to manufacture a failure.
- **Files modified:** tests/unit/graph-question-lifecycle.test.ts, tests/unit/graph-provenance.test.ts, tests/integration/graph/provenance-question.test.ts
- **Verification:** Task 2 unit and integration commands passed.
- **Committed in:** `a65112b7`

---

**Total deviations:** 2 auto-documented (1 blocking verification-command workaround, 1 TDD gate anomaly)
**Impact on plan:** Helper contracts and verification completed. No scope expansion beyond seeded read-through; no unplanned graph write/maintenance behavior added.

## Issues Encountered

- Concurrent work landed in adjacent Phase 172 graph structural files while this plan was executing. This plan staged and committed only its declared write set.
- The exact unit verification wrapper is awkward for file-filtered unit tests because of the repository-level `npm test` script shape; direct `test:unit` commands were used for owned-file assertions.

## Known Stubs

None. Stub-pattern scan found only typed defaults and intentional test setup values, not placeholder behavior that prevents the plan goal.

## Threat Flags

None. The graph read trust boundary was already in the plan threat model; no additional network endpoints, auth paths, file access patterns, or schema changes were introduced.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used successfully for integration verification.

## Next Phase Readiness

Graph read helpers are ready for public `query_graph` MCP registration and graph-aware read-surface wiring in later Phase 172 plans.

## Self-Check: PASSED

- All created files exist: `src/graph/queries.ts`, `src/graph/response.ts`, `tests/unit/graph-query.test.ts`, `tests/unit/graph-query-status-filter.test.ts`, `tests/unit/graph-question-lifecycle.test.ts`, `tests/unit/graph-provenance.test.ts`, `tests/integration/graph/provenance-question.test.ts`.
- Task commits found: `0c36943a`, `a0e24d82`, `a65112b7`.
- Verification results are recorded above.

---
*Phase: 172-structural-graph-and-read-surfaces*
*Completed: 2026-06-24*
