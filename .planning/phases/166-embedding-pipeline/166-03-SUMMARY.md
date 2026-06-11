---
phase: 166-embedding-pipeline
plan: 03
subsystem: embedding
tags: [embedding-pipeline, search, rrf, pgvector, catalog]
requires:
  - phase: 166-embedding-pipeline
    provides: Plan 01 per-entry write fan-out and Plan 02 provider retry/rate-limit behavior
provides:
  - Catalog-aware unified search mode selection
  - `embedding_names` validation and explicit deactivated-entry refusal
  - App-side RRF fusion with k=60 and deterministic tie breaks
  - Zero-active semantic/mixed behavior and partial retriever failure handling
affects: [166-embedding-pipeline, 166-plugin-embedding, 167-lifecycle-operations-and-validation]
tech-stack:
  added: []
  patterns:
    - Unified search resolves selected catalog entries before semantic retrieval
    - Multi-entry semantic search embeds once per selected entry and fuses app-side
key-files:
  created:
    - tests/integration/embedding/search-test-helpers.ts
    - tests/integration/embedding/search-mode-matrix.test.ts
    - tests/integration/embedding/embedding-names-param.test.ts
    - tests/integration/embedding/search-zero-active-semantic.test.ts
    - tests/integration/embedding/search-zero-active-mixed.test.ts
    - tests/integration/embedding/partial-retriever-failure.test.ts
    - tests/integration/embedding/deactivated-operations.test.ts
    - tests/unit/rrf-fusion.test.ts
    - tests/unit/rrf-tie-break.test.ts
  modified:
    - src/mcp/tools/compound.ts
key-decisions:
  - "Catalog search is implemented inside the unified search tool while preserving legacy semantic helpers for non-catalog configs."
  - "RRF fused results expose fused_score, rank_sum, and per_embedding_ranks; final ordering uses fused_score DESC, rank_sum ASC, identifier ASC."
  - "All selected retrievers failing is a runtime error; partial failure succeeds with warnings and only successful entries in embeddings_queried."
patterns-established:
  - "Search uses active fqc_embeddings rows as the catalog default; deactivated rows are excluded unless explicitly requested, which returns unsupported."
  - "Integration search tests use unique per-test embedding names and clean their column/RPC state explicitly."
requirements-completed: [REQ-006, REQ-020, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-027]
duration: 1h 35m
completed: 2026-06-11
---

# Phase 166 Plan 03: Search + RRF Fusion Summary

**Catalog-aware unified search with embedding_names selection, k=60 RRF fusion, zero-active handling, and partial retriever failure semantics**

## Performance

- **Duration:** 1h 35m
- **Started:** 2026-06-11T07:06:00Z
- **Completed:** 2026-06-11T08:41:10Z
- **Tasks:** 3 completed
- **Files modified:** 10

## Accomplishments

- Added `embedding_names` to unified `search` and implemented validation for empty, unknown, deactivated, filesystem-ignored, singleton, and catalog-default cases.
- Implemented catalog-state-derived search behavior for zero active, one active, and multi-active entries.
- Added app-side RRF fusion using `k=60`, `prefetch_size=max(2*limit,20)` capped at 100, and deterministic tie breaks.
- Added partial retriever failure behavior: surviving retrievers continue with `partial_retriever_failure:<name>` warnings; all retrievers failing returns `isError: true`.
- Added targeted unit and integration coverage for T-U-023 through T-U-029, T-I-019, T-I-020, T-I-045 through T-I-057, T-I-059, and T-I-060.

## Task Commits

1. **Task 1: Add search mode matrix and embedding_names validation** - `5816ff7` (feat)
2. **Task 2: Implement RRF fusion and deterministic ordering** - `a2ada4c` (feat)
3. **Task 3: Handle partial retriever failures and deactivated search refusal** - `1e1c0c5` (feat)

**Plan metadata:** included in the final docs commit.

## Files Created/Modified

- `src/mcp/tools/compound.ts` - Adds catalog entry selection, `embedding_names`, per-entry retrieval, RRF fusion, zero-active behavior, deactivated refusal, and retriever failure handling.
- `tests/integration/embedding/search-test-helpers.ts` - Shared integration harness for catalog search tests with real Supabase column/RPC setup.
- `tests/integration/embedding/search-mode-matrix.test.ts` - Covers zero-active semantic/mixed, one-active semantic, and two-active RRF search.
- `tests/integration/embedding/embedding-names-param.test.ts` - Covers singleton, empty, unknown, deactivated, and filesystem ignored `embedding_names`.
- `tests/integration/embedding/search-zero-active-semantic.test.ts` - Focused zero-active semantic refusal coverage.
- `tests/integration/embedding/search-zero-active-mixed.test.ts` - Focused zero-active mixed filesystem-only coverage.
- `tests/integration/embedding/partial-retriever-failure.test.ts` - Covers partial and all retriever failure semantics.
- `tests/integration/embedding/deactivated-operations.test.ts` - Covers explicit deactivated search refusal and default exclusion.
- `tests/unit/rrf-fusion.test.ts` - Covers RRF formula, absent retriever contribution, and prefetch sizing.
- `tests/unit/rrf-tie-break.test.ts` - Covers deterministic fused ordering and limiting.

## Decisions Made

- Kept legacy `searchDocumentsSemantic` and `searchMemoriesSemantic` unchanged for non-catalog configurations. Catalog behavior is scoped to unified `search`.
- Used active DB catalog rows as the default retriever set, ordered by YAML declaration where available, then name.
- Returned all-retriever failure as runtime error instead of expected unsupported because provider/runtime failure is not an operator input validation issue.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved Supabase client binding during catalog lookup**
- **Found during:** Task 1 verification
- **Issue:** Extracting `supabase.from` into a local function lost the Supabase client `this` binding and produced `Cannot read properties of undefined (reading 'rest')`.
- **Fix:** Bound `supabase.from` to the client before using the narrowed local query interface.
- **Files modified:** `src/mcp/tools/compound.ts`
- **Verification:** Task 1 integration tests, full plan integration tests, and `npm run typecheck` passed.
- **Committed in:** `5816ff7`

**2. [Rule 3 - Blocking] Raised new integration test timeouts for real DDL setup**
- **Found during:** Task 1 verification
- **Issue:** New embedding integration tests create/drop pgvector columns and RPCs, and some exceeded Vitest's 30s default per-test timeout.
- **Fix:** Added explicit 90s per-test timeouts matching the existing embedding integration test pattern.
- **Files modified:** `tests/integration/embedding/search-mode-matrix.test.ts`, `tests/integration/embedding/embedding-names-param.test.ts`, `tests/integration/embedding/search-zero-active-semantic.test.ts`, `tests/integration/embedding/search-zero-active-mixed.test.ts`
- **Verification:** Full plan integration verification passed.
- **Committed in:** `5816ff7`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking).
**Impact on plan:** Both were required to complete the planned behavior and verification; no feature scope expansion.

## Issues Encountered

- `gsd-sdk query state.load` produced no output in this repo context, consistent with the previous two Phase 166 summaries noting SDK unavailability. State/roadmap tracking should be updated manually if the local SDK remains unavailable.
- The full six-file integration verification is slow because each file rebuilds the production bundle and exercises real Supabase DDL/RPC setup. It completed successfully.

## Verification

- `npm run test:unit -- tests/unit/rrf-fusion.test.ts tests/unit/rrf-tie-break.test.ts` - PASSED (2 files, 7 tests)
- `npm run test:integration -- tests/integration/embedding/search-mode-matrix.test.ts tests/integration/embedding/embedding-names-param.test.ts tests/integration/embedding/search-zero-active-semantic.test.ts tests/integration/embedding/search-zero-active-mixed.test.ts` - PASSED (4 files, 10 tests)
- `npm run test:integration -- tests/integration/embedding/search-mode-matrix.test.ts` - PASSED (1 file, 4 tests)
- `npm run test:integration -- tests/integration/embedding/partial-retriever-failure.test.ts tests/integration/embedding/deactivated-operations.test.ts` - PASSED (2 files, 4 tests)
- `npm run test:integration -- tests/integration/embedding/search-mode-matrix.test.ts tests/integration/embedding/embedding-names-param.test.ts tests/integration/embedding/search-zero-active-semantic.test.ts tests/integration/embedding/search-zero-active-mixed.test.ts tests/integration/embedding/partial-retriever-failure.test.ts tests/integration/embedding/deactivated-operations.test.ts` - PASSED (6 files, 15 tests)
- `npm run typecheck` - PASSED

## User Setup Required

None - no new external service configuration required beyond the existing `.env.test` used for integration verification.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: catalog_search_selection | `src/mcp/tools/compound.ts` | Caller-provided `embedding_names` controls retriever selection; empty, unknown, and deactivated names are validated before querying. |
| threat_flag: retriever_failure_surface | `src/mcp/tools/compound.ts` | Provider/RPC failures are surfaced as per-retriever warnings or runtime error details without including query text or provider secrets. |

## Next Phase Readiness

Plan 166-04 can build plugin `search_records` and plugin-table embedding selection on top of the same catalog search semantics: active-entry defaults, explicit deactivated refusal, RRF fused metadata, and partial retriever warnings.

## Self-Check: PASSED

- Summary file created at `.planning/phases/166-embedding-pipeline/166-03-SUMMARY.md`.
- Task commits exist: `5816ff7`, `a2ada4c`, `1e1c0c5`.
- Created test files exist.
- No unexpected tracked file deletions detected in task commits.

---
*Phase: 166-embedding-pipeline*
*Completed: 2026-06-11*
