---
phase: 167-lifecycle-operations-and-validation
plan: 05
subsystem: maintenance
tags: [maintain-vault, embeddings, lifecycle, records, plugins, directed-scenarios]

requires:
  - phase: 166-embedding-pipeline
    provides: frozen plugin embedding choices, plugin table embedding columns/RPCs, and record stamped write helpers
  - phase: 167-lifecycle-operations-and-validation
    provides: core backfill/rebuild lifecycle processors and retire plugin conflict behavior
provides:
  - Records-scope lifecycle resolver using frozen `fqc_plugin_registry.embedding_name`
  - Pure-records and mixed-scope `backfill_embeddings` execution
  - Pure-records and mixed-scope `rebuild_embeddings` execution with derived confirm validation
  - Directed scenarios D-118 and D-119
affects: [maintain_vault, lifecycle-processors, plugin-embedding, records]

tech-stack:
  added: []
  patterns:
    - Records lifecycle work units resolve from plugin registry rows, not current YAML config.
    - Mixed lifecycle actions split core and records execution, then aggregate counts/failures/warnings.

key-files:
  created:
    - src/embedding/lifecycle/records-scope.ts
    - tests/scenarios/directed/testcases/test_records_scope_embedding_resolution.py
    - tests/scenarios/directed/testcases/test_records_scope_mixed.py
  modified:
    - src/embedding/lifecycle/backfill.ts
    - src/embedding/lifecycle/rebuild.ts
    - src/embedding/lifecycle/scope.ts
    - src/mcp/utils/response-formats.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - .planning/STATE.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Records lifecycle uses frozen plugin registry choices and rejects pure-records top-level `embedding_name` with the REQ-041 message."
  - "Mixed scope applies top-level `embedding_name` only to core document/memory work; plugin records always use per-registration choices."
  - "Pure-records rebuild derives confirm from resolved non-null plugin choices and refuses multi-entry records scopes before mutation."

patterns-established:
  - "Records lifecycle resolver returns typed work units with plugin/table identity, frozen embedding entry, selected rows, and opted-out skip counts."
  - "Record vector mutation stays on `recordEmbeddingTarget` plus `updateTargetEmbedding`; no ad hoc vector UPDATE path was added."

requirements-completed: [REQ-041]

duration: ~1h 25m
completed: 2026-06-11
---

# Phase 167 Plan 05: Records-Scope Lifecycle Summary

**Records-scope and mixed-scope backfill/rebuild lifecycle execution using frozen plugin embedding choices**

## Performance

- **Duration:** ~1h 25m
- **Started:** 2026-06-11T13:59:00Z
- **Completed:** 2026-06-11T15:24:23Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added `records-scope.ts` to resolve lifecycle work units from active `fqc_plugin_registry` rows and each plugin table's `embed_fields`.
- Wired `backfill_embeddings` to process pure-records and mixed scopes, including opted-out plugin rows counted as `rows_skipped_no_embedding`.
- Wired `rebuild_embeddings` to process records scopes with deterministic pure-records confirm derivation and multi-entry refusal before mutation.
- Added directed scenarios D-118 and D-119 and registered them in directed coverage.

## Task Commits

1. **Task 1 RED: Records lifecycle resolution scenario** - `a5c67a1` (test)
2. **Task 1 GREEN: Resolve records lifecycle work units** - `f9740d6` (feat)
3. **Task 2 RED: Mixed records lifecycle scenario** - `2b147f1` (test)
4. **Task 2 GREEN: Execute mixed records lifecycle scopes** - `c78eb51` (feat)

**Plan metadata:** included in the final docs commit.

## Files Created/Modified

- `src/embedding/lifecycle/records-scope.ts` - Records work-unit resolution, row selection, record provider execution, reindexing, estimates, and plugin breakdowns.
- `src/embedding/lifecycle/backfill.ts` - Pure-records and mixed-scope backfill dispatch and aggregation.
- `src/embedding/lifecycle/rebuild.ts` - Pure-records and mixed-scope rebuild dispatch, derived confirm validation, and aggregation.
- `src/embedding/lifecycle/scope.ts` - Exact REQ-041 rejection text and multi-entry pure-records rebuild refusal text.
- `src/mcp/utils/response-formats.ts` - Public lifecycle result type now includes `plugin_breakdown`.
- `tests/scenarios/directed/testcases/test_records_scope_embedding_resolution.py` - D-118 scenario.
- `tests/scenarios/directed/testcases/test_records_scope_mixed.py` - D-119 scenario.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - D-118 and D-119 coverage rows.
- `.planning/REQUIREMENTS.md` - REQ-041 marked complete.
- `.planning/STATE.md` - Plan 167-05 handoff notes added manually.

## Decisions Made

- Records lifecycle resolution reads `fqc_plugin_registry.embedding_name`; it does not inspect current plugin YAML to infer a lifecycle embedding choice.
- Opted-out plugin rows are skipped and counted without failure.
- Pure-records rebuild ignores opted-out plugins for confirm derivation; one resolved name must match `confirm`, while multiple names return `invalid_input` with `details.resolved_embedding_names`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `gsd-sdk` was unavailable on PATH, so STATE and REQUIREMENTS updates were made manually. ROADMAP.md was intentionally not updated per execution instruction.

## TDD Gate Compliance

- RED commits present: `a5c67a1`, `2b147f1`.
- GREEN commits present after RED: `f9740d6`, `c78eb51`.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: plugin_registry_policy | `src/embedding/lifecycle/records-scope.ts` | Frozen plugin registry state controls which embedding entry a records lifecycle action may use. |
| threat_flag: provider_content_processing | `src/embedding/lifecycle/records-scope.ts` | Plugin record embed fields are sent to configured embedding endpoints during lifecycle operations. |

## Authentication Gates

None.

## Verification

- `npm run build` - passed.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_records_scope_embedding_resolution"` - passed, 1/1 scenario.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_records_scope_mixed"` - passed, 1/1 scenario.
- `npm run typecheck` - passed.

## Self-Check: PASSED

- Created files exist: `src/embedding/lifecycle/records-scope.ts`, D-118 scenario, and D-119 scenario.
- Modified files exist: `src/embedding/lifecycle/backfill.ts`, `src/embedding/lifecycle/rebuild.ts`, `src/embedding/lifecycle/scope.ts`, `src/mcp/utils/response-formats.ts`, `tests/scenarios/directed/DIRECTED_COVERAGE.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`.
- Commits exist: `a5c67a1`, `f9740d6`, `2b147f1`, `c78eb51`.
- Required plan checks passed: build, D-118, D-119, and typecheck.
- No unexpected tracked file deletions detected.

## User Setup Required

None - no new external service configuration required. Verification used `.env.test` credentials and managed embedding-enabled directed scenario servers.

## Next Phase Readiness

REQ-041 records lifecycle behavior is ready for downstream lock/abort directed coverage and operator recipe validation.

---
*Phase: 167-lifecycle-operations-and-validation*
*Completed: 2026-06-11*
