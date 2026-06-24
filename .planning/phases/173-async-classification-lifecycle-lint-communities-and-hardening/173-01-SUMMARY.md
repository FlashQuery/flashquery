---
phase: 173-async-classification-lifecycle-lint-communities-and-hardening
plan: 1
subsystem: graph
tags: [graph, candidates, pending-edges, embeddings, supabase, vitest]
requires:
  - phase: 171-graph-foundation-structural-graph-and-read-surfaces
    provides: graph config, vocabulary, schema, and pending edge table
  - phase: 172-structural-graph-and-read-surfaces
    provides: chunk scheduler graph hooks, stale marking, and Tier 1 structural refresh
provides:
  - bounded Tier 2 candidate selection over configured chunk embedding RPCs
  - stable fqc_pending_edges enqueue/upsert helper
  - non-blocking scheduler enqueue hook after chunk persistence and Tier 1 graph refresh
affects: [graph-worker, graph-llm-analysis, graph-cost-controls, document-write-path]
tech-stack:
  added: []
  patterns:
    - pure graph selection helpers with structured skipped reasons and warnings
    - pending edge queue metadata stored in existing result JSONB field
    - scheduler-visible graph candidate and pending job counts
key-files:
  created:
    - src/graph/candidates.ts
    - src/graph/pending-edges.ts
    - tests/unit/graph-candidates.test.ts
    - tests/integration/graph/candidate-selection.test.ts
  modified:
    - src/embedding/chunks/scheduler.ts
key-decisions:
  - "Tier 2 selection returns warnings/skipped reasons instead of silently no-oping when resolver or embeddings are missing."
  - "Pending edge enqueue uses the existing unique instance/source/target key and stores selection metadata in result JSONB."
  - "The scheduler hook runs after chunk embedding scheduling and never imports graph LLM analysis."
patterns-established:
  - "Graph candidate helpers are topology-free: they do not write graph edges."
  - "Graph scheduler enqueue is best-effort and returns counts/warnings to callers."
requirements-completed: [GR-010, GR-012, GR-023]
duration: 9min
completed: 2026-06-24T14:26:50Z
---

# Phase 173 Plan 1: Candidate Selection and Pending Edge Enqueue Summary

**Bounded Tier 2 graph candidate discovery with durable pending-edge enqueue and non-blocking scheduler integration**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-24T14:18:00Z
- **Completed:** 2026-06-24T14:26:50Z
- **Tasks:** 3/3
- **Files modified:** 5

## Accomplishments

- Added `selectGraphEdgeCandidates()` for threshold/percentile candidate selection through configured `match_chunks_<embedding>()` RPCs with `filter_instance_id`.
- Added `enqueuePendingEdgeCandidates()` to upsert `fqc_pending_edges` by stable instance/source/target pairs and preserve candidate metadata.
- Wired `scheduleChangedDocumentChunks()` to enqueue bounded graph candidate work after chunk persistence, stale marking, structural refresh, and embedding scheduling, without LLM calls.

## Task Commits

1. **Task 1: Implement candidate selection**
   - `f35082a1` test RED: candidate selection coverage
   - `d0616c0b` feat: candidate selection helper
2. **Task 2: Upsert pending edge jobs**
   - `e9f3323d` test RED: pending edge enqueue coverage
   - `30115c61` feat: pending edge enqueue helper
3. **Task 3: Wire non-blocking scheduler enqueue**
   - `adb4ac8f` test RED: scheduler candidate enqueue coverage
   - `e70ec16a` feat: scheduler enqueue hook

## Files Created/Modified

- `src/graph/candidates.ts` - Selects bounded graph edge candidates from chunk similarity RPCs, with deterministic ordering, cap handling, same-document filtering, and warnings.
- `src/graph/pending-edges.ts` - Upserts pending edge jobs with instance/source/target dedupe and candidate metadata.
- `src/embedding/chunks/scheduler.ts` - Calls candidate selection and pending enqueue after existing chunk/graph write work and embedding scheduling.
- `tests/unit/graph-candidates.test.ts` - Covers T-U-033, T-U-034, T-U-035, T-U-036, T-U-058, and T-U-059.
- `tests/integration/graph/candidate-selection.test.ts` - Covers T-I-018, T-I-040, and scheduler no-LLM import contract for T-I-041.

## Decisions Made

- Percentile selection sorts by similarity descending, then source/target chunk IDs for deterministic ties.
- Same-document classification remains excluded unless a classified relation metadata schema explicitly advertises same-document allowance.
- Scheduler candidate enqueue is best-effort: enqueue errors become warnings so document writes do not block on graph classification.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npm test -- --run tests/unit/graph-candidates.test.ts` completed the full unit suite successfully but failed afterward because the repo `test` script passes the unit file filter into `test:macro-framework`, where no macro-framework test file matches that filter.
- The exact plan grep for `semantically_similar_to` fails on pre-existing vocabulary rejection coverage in `src/graph/vocabulary.ts` and `tests/unit/graph-vocabulary.test.ts`. This plan did not add stored similarity topology, and `src/graph/candidates.ts` contains no forbidden relation or `fqc_graph_edges` write.

## Verification

- `npm run test:unit -- --run tests/unit/graph-candidates.test.ts` - PASSED, 6 tests.
- `npm run test:integration -- --run tests/integration/graph/candidate-selection.test.ts` - PASSED, 3 tests; integration setup build succeeded.
- `npm test -- --run tests/unit/graph-candidates.test.ts` - PARTIAL/FAILED: 228 unit files and 2471 tests passed; macro-framework subcommand failed with no matching files for the unit-test filter.
- `grep -R "semantically_similar_to" -n src/graph src/embedding/chunks tests | grep -v "rejected\\|MUST NOT\\|not create" && exit 1 || true` - FAILED due pre-existing vocabulary rejection text, not this plan's candidate/enqueue files.

## Known Stubs

None.

## Auth Gates

None.

## Next Phase Readiness

Plan 173-02 can consume queued candidate pairs from `fqc_pending_edges` and rely on scheduler-visible warnings/counts. Plan 173-03 can extend the queue worker using the stable pending-edge metadata shape introduced here.

## Self-Check: PASSED

- Found all created/modified files.
- Found task commits: `f35082a1`, `d0616c0b`, `e9f3323d`, `30115c61`, `adb4ac8f`, `e70ec16a`.
- Verified summary documents the two plan-level command caveats and no shared orchestrator artifacts were intentionally updated by this executor.

---
*Phase: 173-async-classification-lifecycle-lint-communities-and-hardening*
*Completed: 2026-06-24T14:26:50Z*
