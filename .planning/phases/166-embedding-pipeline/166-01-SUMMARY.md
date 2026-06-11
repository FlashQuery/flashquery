---
phase: 166-embedding-pipeline
plan: 01
subsystem: embedding
tags: [embedding-pipeline, pending-queue, pgvector, truncation, catalog-fanout]
requires:
  - phase: 165-foundation-infrastructure
    provides: Catalog rows, per-entry core columns/RPCs, stamping helper, and provider length guard
provides:
  - Per-active-entry core write fan-out for documents, memories, compound document writes, and scanner reconciliation
  - Per-entry pending queue rows keyed by embedding_name
  - Pending-worker retry behavior for active, deactivated, and retired catalog entries
  - Provider max_input_chars truncation with one reactive 75 percent over-limit retry
affects: [166-embedding-pipeline, 167-lifecycle-operations-and-validation, plugin-embedding]
tech-stack:
  added: []
  patterns:
    - Active catalog fan-out wraps the existing single-entry scheduleBackgroundEmbedding path
    - Provider truncation metadata flows into stamping through getLastEmbeddingMetadata
    - Legacy singleton embedding fallback remains only when no embeddings catalog is configured
key-files:
  created:
    - tests/integration/embedding/parallel-per-entry-attempt.test.ts
    - tests/integration/embedding/pending-queue-per-entry.test.ts
    - tests/integration/embedding/pending-worker-per-entry.test.ts
    - tests/integration/embedding/truncation-reactive-fallback.test.ts
    - tests/unit/embedding-write-warnings.test.ts
    - tests/unit/embedding-truncation.test.ts
  modified:
    - src/storage/supabase.ts
    - src/embedding/background-embed.ts
    - src/embedding/pending-worker.ts
    - src/embedding/provider.ts
    - src/mcp/tools/documents/write.ts
    - src/mcp/tools/compound.ts
    - src/mcp/tools/memory.ts
    - src/services/scanner.ts
    - src/mcp/utils/response-formats.ts
key-decisions:
  - "Core write fan-out reads active rows from fqc_embeddings and preserves YAML order from config.embeddings when available."
  - "scheduleBackgroundEmbedding remains the single-entry primitive; catalog fan-out is a wrapper so plugin single-entry routing can reuse the primitive in later plans."
  - "Existing legacy singleton embedding behavior is preserved only for configs with no embeddings catalog."
patterns-established:
  - "Per-entry failures return embedding_deferred:<name> and upsert fqc_pending_embeds by (instance_id, target, embedding_name)."
  - "Deactivated pending rows are skipped without retry or deletion; retired-entry pending rows are deleted."
  - "Leaf providers truncate before API calls and retry one over-limit response at 75 percent of max_input_chars."
requirements-completed: [REQ-012, REQ-013, REQ-014, REQ-015, REQ-016]
requirements-partial: [REQ-006]
duration: 26min
completed: 2026-06-11
---

# Phase 166 Plan 01: Write Path: Best-Effort Per-Entry + Pending Queue Summary

**Catalog-driven embedding writes with per-entry pending retry, suffixed deferred warnings, and bounded oversized-input truncation**

## Performance

- **Duration:** 26 min
- **Started:** 2026-06-11T07:09:11Z
- **Completed:** 2026-06-11T07:34:58Z
- **Tasks:** 4 completed
- **Files modified:** 15

## Accomplishments

- Extended `fqc_pending_embeds` with `embedding_name` and replaced target-only uniqueness with target-plus-entry uniqueness.
- Added active catalog write fan-out for core document/memory write paths, compound document section writes, and scanner reconciliation.
- Added `embedding_deferred:<name>` warning behavior with dedupe and omit-empty response semantics.
- Updated pending retry to resolve each row's catalog entry, skip deactivated rows, delete retired rows, and stamp successful retries.
- Added provider-side `max_input_chars` truncation, paragraph/sentence boundary selection, `_truncated` stamping, and one 75 percent over-limit retry.

## Task Commits

1. **Task 1 RED: Extend pending queue tests for embedding_name** - `14cf991` (test)
2. **Task 1 GREEN: Key pending embeddings by entry name** - `72c3bd0` (feat)
3. **Task 2 RED: Per-entry fan-out and warning tests** - `9c23858` (test)
4. **Task 2 GREEN: Fan out core writes per active embedding** - `d96a317` (feat)
5. **Task 3 RED: Pending worker per-entry tests** - `8e35cd4` (test)
6. **Task 3 GREEN: Retry pending embeddings by catalog entry** - `243e2ee` (feat)
7. **Task 4 RED: Truncation tests** - `da2204c` (test)
8. **Task 4 GREEN: Truncate oversized embedding inputs** - `b2a4285` (feat)

**Plan metadata:** included in the final docs commit.

## Files Created/Modified

- `src/storage/supabase.ts` - Adds `embedding_name` to pending queue DDL, migrates existing rows, and creates target-plus-entry uniqueness.
- `src/embedding/background-embed.ts` - Adds active catalog fan-out, per-entry warning suffixes, per-entry pending keys, and truncation metadata stamping.
- `src/embedding/pending-worker.ts` - Resolves pending rows by catalog entry; handles active, deactivated, and retired states, completing the Plan 01 slice of REQ-006.
- `src/embedding/provider.ts` - Adds truncation helper, max input caps, provider metadata, and reactive over-limit retry.
- `src/mcp/tools/documents/write.ts` - Uses active catalog fan-out for document create/update embedding writes.
- `src/mcp/tools/compound.ts` - Uses active catalog fan-out for `insert_in_doc` and `replace_doc_section`.
- `src/mcp/tools/memory.ts` - Uses active catalog fan-out for memory create/update embedding writes.
- `src/services/scanner.ts` - Uses active catalog fan-out for scanner re-embedding and passes config to pending retry.
- `src/mcp/utils/response-formats.ts` - Deduplicates warnings while preserving omit-empty behavior.
- `tests/integration/embedding/*.test.ts` and `tests/unit/embedding-*.test.ts` - Adds T-I-034, T-I-035, T-I-037 through T-I-044, and T-U-014 through T-U-018 coverage.

## Decisions Made

- Kept plugin `write_record` on the existing single-entry primitive. Plugin entry resolution is Plan 166-04 scope; changing it here would cross the plan boundary.
- Implemented catalog fan-out as a wrapper over `scheduleBackgroundEmbedding` instead of replacing the primitive, preserving Phase 165 stamping behavior and legacy compatibility.
- Used `legacy` as the migration fill value for pre-existing pending rows without an `embedding_name`; new catalog paths always provide the real entry name.
- Recorded `truncated_inputs` only for successful truncated provider calls; failed over-limit writes route through existing pending/deferred behavior without stamping.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Preserved legacy singleton embedding fallback**
- **Found during:** Task 2
- **Issue:** Replacing write calls with catalog fan-out would have made existing non-catalog legacy configs skip embeddings entirely.
- **Fix:** Added an optional `legacyProvider` fallback that runs only when no `embeddings:` catalog is configured.
- **Files modified:** `src/embedding/background-embed.ts`, `src/mcp/tools/documents/write.ts`, `src/mcp/tools/memory.ts`, `src/mcp/tools/compound.ts`, `src/services/scanner.ts`
- **Verification:** Plan-level integration tests and `npm run typecheck` passed.
- **Committed in:** `d96a317`

**2. [Rule 2 - Missing Critical] Added safe migration fill for existing pending rows**
- **Found during:** Task 1
- **Issue:** Adding `embedding_name TEXT NOT NULL` would fail on existing databases with pending rows unless old rows were filled before enforcing NOT NULL.
- **Fix:** Added `ALTER TABLE ADD COLUMN`, `UPDATE ... SET embedding_name = 'legacy' WHERE NULL`, then `ALTER COLUMN SET NOT NULL`.
- **Files modified:** `src/storage/supabase.ts`
- **Verification:** `pending-queue-per-entry.test.ts` passed against `.env.test` database.
- **Committed in:** `72c3bd0`

---

**Total deviations:** 2 auto-fixed (2 missing critical functionality).
**Impact on plan:** Both preserve correctness and upgrade safety without changing the planned feature surface.

## Issues Encountered

- `gsd-sdk` was not available on PATH, so init/state/roadmap automation could not be invoked. Summary and planning state were updated manually.
- The combined integration verification builds the production bundle per target file, so the run took about three minutes; it completed successfully.

## Verification

- `npm run test:integration -- tests/integration/embedding/pending-queue-per-entry.test.ts` - PASSED
- `npm run test:unit -- tests/unit/embedding-write-warnings.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/parallel-per-entry-attempt.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/pending-worker-per-entry.test.ts` - PASSED
- `npm run test:unit -- tests/unit/pending-embed-worker.test.ts` - PASSED
- `npm run test:unit -- tests/unit/embedding-truncation.test.ts tests/unit/embedding-length-guard.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/truncation-reactive-fallback.test.ts` - PASSED
- `npm run test:unit -- tests/unit/embedding-write-warnings.test.ts tests/unit/embedding-truncation.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/parallel-per-entry-attempt.test.ts tests/integration/embedding/pending-queue-per-entry.test.ts tests/integration/embedding/pending-worker-per-entry.test.ts tests/integration/embedding/truncation-reactive-fallback.test.ts` - PASSED (4 files, 10 tests)
- `npm run typecheck` - PASSED

## User Setup Required

None - no new external service configuration required beyond the existing `.env.test` used for integration verification.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: provider_input_truncation | `src/embedding/provider.ts` | User content sent to embedding providers is now proactively truncated and retried once on over-limit errors; covered by T-U-016..T-U-018 and T-I-044. |
| threat_flag: pending_retry_catalog_state | `src/embedding/pending-worker.ts` | Pending rows now control per-entry retry based on catalog state; deactivated and retired states are explicitly handled. |

## Next Phase Readiness

Plan 166-02 can build endpoint rate limiting and 429 backoff on top of the leaf-provider truncation path. Plan 166-03 can consume populated `embedding_<name>` columns and pending semantics for catalog-driven search/RRF. Plan 166-04 still owns plugin table entry resolution and plugin `write_record` routing.

## Self-Check: PASSED

- Summary file created at `.planning/phases/166-embedding-pipeline/166-01-SUMMARY.md`.
- Task commits exist: `14cf991`, `72c3bd0`, `9c23858`, `d96a317`, `8e35cd4`, `243e2ee`, `da2204c`, `b2a4285`.
- Created test files exist.
- No unexpected tracked file deletions detected in task commits.

---
*Phase: 166-embedding-pipeline*
*Completed: 2026-06-11*
