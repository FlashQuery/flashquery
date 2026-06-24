---
phase: 173-async-classification-lifecycle-lint-communities-and-hardening
plan: 5
subsystem: graph-maintenance
tags: [graph-lint, communities, supabase, maintenance, vitest]

requires:
  - phase: 173-03
    provides: Graph pending worker, dead letters, and stale completion foundations
  - phase: 173-04
    provides: Lifecycle-aware graph filtering and provenance/question read behavior
provides:
  - Durable fqc_graph_lint_runs run-history storage
  - maintain_vault graph_lint, graph_lint_status, and graph_lint_prune actions
  - Topology-only deterministic community detection for lint payloads
  - GraphLintPayload semantic category builders with deltas and raw findings
affects: [graph-maintenance, graph-readiness, phase-173-hardening]

tech-stack:
  added: []
  patterns:
    - Instance-scoped graph lint run history in fqc_graph_lint_runs
    - Dynamic imports from maintain_vault to graph lint orchestration
    - Topology-only connected-component community fallback

key-files:
  created:
    - src/graph/communities.ts
    - src/graph/lint.ts
    - src/graph/lint-categories.ts
    - tests/unit/graph-communities.test.ts
    - tests/unit/graph-lint.test.ts
    - tests/integration/graph/graph-lint.test.ts
  modified:
    - src/storage/supabase.ts
    - src/storage/schema-verify.ts
    - src/services/maintenance.ts
    - tests/integration/graph/provenance-question.test.ts
    - tests/unit/schema-verify.test.ts

key-decisions:
  - "Graph lint history uses a focused fqc_graph_lint_runs table rather than overloading fqc_graph_maintenance_state."
  - "Community detection uses deterministic stored-topology traversal only; no embedding similarity topology is used."
  - "The explicit Supabase CLI schema gate was operator-verified after the executor hit missing CLI tooling."

patterns-established:
  - "Graph maintenance actions validate wrong-action parameters before touching storage."
  - "Status reads return stored GraphLintPayloads or GraphLintListPayload summaries without rerunning lint."
  - "Dry-run lint computes the same payload shape while skipping persistence and community assignment writes."

requirements-completed: [GR-020B, GR-021, GR-023]

duration: 2 sessions
completed: 2026-06-24
---

# Phase 173 Plan 5: Graph Lint and Maintenance Actions Summary

**Graph lint run-history storage plus maintain_vault graph_lint/status/prune with topology-only communities and semantic diagnostics.**

## Performance

- **Duration:** 2 executor sessions with a blocking schema-push checkpoint between them
- **Completed:** 2026-06-24T15:40:02Z
- **Tasks:** 3/3
- **Files modified:** 11

## Accomplishments

- Added `fqc_graph_lint_runs` with idempotent DDL, instance/run lookup indexes, JSONB counts/payload storage, and schema verification.
- Added deterministic topology-only community detection that writes ephemeral community metadata during non-dry-run lint.
- Added `maintain_vault` actions `graph_lint`, `graph_lint_status`, and `graph_lint_prune` with stored status reads, list mode, run lookup, background job status, retention pruning, dry-run, rules, scope, and max-findings behavior.
- Added semantic `GraphLintPayload` categories for questions, provenance, contradictions, duplicates, communities, integrity, plus raw findings and delta tracking.

## Task Commits

1. **Task 1: Add lint run storage and schema verification** - `8829b7f2`
2. **Task 2: Push schema changes to Supabase** - operator verified, no repo commit
3. **Task 3: Implement topology-only communities and graph_lint/status/prune categories** - `67561ba0`

## Files Created/Modified

- `src/storage/supabase.ts` - Added `fqc_graph_lint_runs` DDL and indexes.
- `src/storage/schema-verify.ts` - Verifies the new run-history table, columns, and `(instance_id, run_id)` uniqueness.
- `src/services/maintenance.ts` - Routes and validates graph lint maintenance actions.
- `src/graph/communities.ts` - Detects deterministic topology-only communities and applies ephemeral node labels.
- `src/graph/lint.ts` - Orchestrates graph lint, status reads, pruning, persisted payloads, deltas, and warnings.
- `src/graph/lint-categories.ts` - Defines GraphLintPayload/ListPayload types and shared delta/capping helpers.
- `tests/unit/graph-communities.test.ts` - Covers T-U-047, T-U-048, T-U-049, and T-U-064.
- `tests/unit/graph-lint.test.ts` - Covers lint category contracts, dry-run/invalid-parameter validation, pruning validation, and raw finding mirrors.
- `tests/integration/graph/graph-lint.test.ts` - Covers persisted runs, deltas, status latest/by-run/list, pruning, max_findings, background status, and duplicate propagation details.
- `tests/integration/graph/provenance-question.test.ts` - Adds lint proof for resolved question dependent follow-up flags.
- `tests/unit/schema-verify.test.ts` - Updates schema verification expectations for the required lint run-history table.

## Decisions Made

- Used `fqc_graph_lint_runs` for durable run history because `fqc_graph_maintenance_state` is a cursor/state table and cannot satisfy list/prune/status-by-run contracts cleanly.
- Kept communities topology-only by reading graph nodes and `fqc_graph_edges`; no `match_chunks_*` RPC or embedding-similarity helper is used in community detection.
- Treated the operator-provided `supabase db push --db-url "$DATABASE_URL"` result as satisfying the blocking Task 2 gate.

## Schema Gate

Initial executor attempt:

```bash
supabase db push
```

Result: blocked because `supabase` was not installed on PATH.

Operator verification:

```bash
set -a
source .env.test
set +a
npx --yes supabase db push --db-url "$DATABASE_URL"
```

Result:

```text
Connecting to remote database...
Remote database is up to date.
```

The CPU AVX/Bun warning was non-blocking; the command exited 0.

## Verification

- `npm run typecheck` - passed
- `npm run test:unit -- --run tests/unit/graph-lint.test.ts tests/unit/graph-communities.test.ts` - passed, 2 files / 15 tests
- `npm run test:integration -- --run tests/integration/graph/graph-lint.test.ts tests/integration/graph/provenance-question.test.ts` - passed, 2 files / 8 tests
- `rg -n "rules|scope|background|job_id|max_findings|run_id.*limit|keep_last|older_than|expected-error|invalid" tests/unit/graph-lint.test.ts tests/integration/graph/graph-lint.test.ts` - passed

Note: the literal plan wrapper `npm test -- --run ...` was attempted in the first session. The full unit suite passed, but the wrapper exited nonzero afterward because `test:macro-framework` received unit-test file filters and found no macro test files. Focused unit verification used the repo's `test:unit` target.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated schema verification unit expectations**
- **Found during:** Task 1 verification
- **Issue:** Existing `tests/unit/schema-verify.test.ts` asserted the old required-table list and query count.
- **Fix:** Added `fqc_graph_lint_runs` to expected missing-table/order assertions and updated the query count for new required table/column/constraint checks.
- **Files modified:** `tests/unit/schema-verify.test.ts`
- **Verification:** `npm run test:unit -- --run tests/unit/graph-lint.test.ts tests/unit/graph-communities.test.ts`; full unit suite also passed during first-session wrapper attempt before macro filter failure.
- **Committed in:** `8829b7f2`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Test-only adjustment required by the new required schema surface; no product scope change.

## Issues Encountered

- The executor environment lacked `supabase` CLI on PATH, so Task 2 paused at a blocking human-verify checkpoint. The operator later verified `npx --yes supabase db push --db-url "$DATABASE_URL"` exited 0 with "Remote database is up to date."
- The repo's `npm test -- --run ...` wrapper is not suitable for unit-file filtering because it forwards the filters to the macro-framework test script. Focused graph unit tests were verified through `npm run test:unit`.

## User Setup Required

None remaining. The schema gate was operator-verified against `.env.test`.

## Known Stubs

None. Stub-pattern scan only found normal local empty-array/string initializers and nullable client state, not placeholder UI/data-source stubs.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: schema-run-history | `src/storage/supabase.ts` | New `fqc_graph_lint_runs` table persists graph lint diagnostic payloads. Mitigated by instance-scoped table/indexes and schema verification. |
| threat_flag: maintenance-mutation | `src/services/maintenance.ts` | New graph lint/prune maintenance actions can mutate community assignment metadata or delete run-history rows. Mitigated by dry_run, parameter validation, `instance_id` filters, and required prune retention parameters. |

## Next Phase Readiness

Plan 173-06 can consume topology-only communities and stored graph lint payloads. `query_graph` remains read-only; maintenance execution stays under `maintain_vault`.

## Self-Check: PASSED

- Created summary exists at `.planning/phases/173-async-classification-lifecycle-lint-communities-and-hardening/173-05-SUMMARY.md`.
- Task commits exist: `8829b7f2`, `67561ba0`.
- Key source/test files exist.
- Post-gate verification passed after operator schema push confirmation.

---
*Phase: 173-async-classification-lifecycle-lint-communities-and-hardening*
*Completed: 2026-06-24*
