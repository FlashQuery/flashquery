---
phase: 168-chunking-foundation-and-write-pipeline
plan: 03
subsystem: embedding
tags: [chunks, diffing, pending-queue, embeddings]

requires:
  - 168-01
  - 168-02
provides:
  - Transactional document chunk diff/persist helper
  - `document_chunk` background embedding target
  - Chunk vector stamping with per-entry `_indexed_at`
  - Pending retry reconstruction for chunk embedding rows
affects: [phase-168-write-pipeline]

tech-stack:
  added: []
  patterns:
    - Parser-backed chunk persistence through `diffAndPersistDocumentChunks`
    - Changed-chunk-only scheduling work returned from store helper
    - Target-kind-specific embedding stamp columns

key-files:
  created:
    - src/embedding/chunks/store.ts
    - tests/unit/chunk-store.test.ts
    - tests/integration/embedding/chunk-pending-queue.test.ts
  modified:
    - src/embedding/background-embed.ts
    - src/embedding/pending-worker.ts
    - tests/unit/background-embed-helper.test.ts
    - tests/unit/embedding-stamping.test.ts
    - tests/unit/pending-embed-worker.test.ts

key-decisions:
  - "`document_chunk` targets use `target_kind = document_chunk`, `target_table = fqc_chunks`, and chunk id as `target_id`."
  - "Chunk retry embed text prefers persisted pending `embed_text`, then reconstructs from `fqc_chunks.breadcrumb` plus `content`."
  - "Chunk vector success stamps only the active entry's `_indexed_at`; memory and record stamp behavior remains unchanged."

patterns-established:
  - "Chunk store selects existing rows by `(instance_id, document_id)`, writes current chunks, deletes orphans, and commits in one transaction."
  - "Pending rows remain unique by `(instance_id, target_kind, target_table, target_id, embedding_name)`."

requirements-completed:
  - REQ-CHUNK-009
  - REQ-CHUNK-010

duration: 14min
completed: 2026-06-14
---

# Phase 168 Plan 03: Chunk Store and Embedding Target Summary

**Shared chunk diffing and `document_chunk` embedding retry foundation are ready for document write-path wiring**

## Performance

- **Duration:** 14 min
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added `diffAndPersistDocumentChunks` and pure diff classification for new, changed, unchanged, and orphan chunks.
- Persisted chunks transactionally through `pg`, including same-transaction orphan deletion and changed-chunk scheduling output.
- Added `documentChunkEmbeddingTarget` and safe target-table validation for `fqc_chunks`.
- Updated stamped vector writes so chunk success populates entry-specific vector metadata and `embedding_<name>_indexed_at`.
- Updated pending worker reconstruction so deferred chunk rows retry against `fqc_chunks` and rebuild embed text from breadcrumb/content when needed.
- Added unit coverage T-U-026 through T-U-030 and integration coverage T-I-018/T-I-019.

## Task Commits

1. **Task 1: Create transactional chunk diff store** - `77aee4d` (feat)
2. **Task 2: Add `document_chunk` embedding target and pending retry** - committed with this summary close-out

## Files Created/Modified

- `src/embedding/chunks/store.ts` - Parser-backed transactional chunk diff/persist helper.
- `src/embedding/background-embed.ts` - `document_chunk` target construction, safe table validation, chunk stamping, and pending row support.
- `src/embedding/pending-worker.ts` - Chunk target reconstruction and embed-text lookup from `fqc_chunks`.
- `tests/unit/chunk-store.test.ts` - T-U-026 and T-U-027.
- `tests/unit/background-embed-helper.test.ts` - T-U-028.
- `tests/unit/embedding-stamping.test.ts` - T-U-029.
- `tests/unit/pending-embed-worker.test.ts` - T-U-030.
- `tests/integration/embedding/chunk-pending-queue.test.ts` - T-I-018 and T-I-019.

## Verification

- `npm run test:unit -- tests/unit/chunk-store.test.ts tests/unit/background-embed-helper.test.ts tests/unit/embedding-stamping.test.ts tests/unit/pending-embed-worker.test.ts` - passed, 4 files / 17 tests.
- `npm run test:integration -- tests/integration/embedding/chunk-pending-queue.test.ts` - passed, 2 tests.
- `npm run typecheck` - passed.

## Decisions Made

- Stored `ParsedChunk.heading_path` into PostgreSQL as `text[]` by splitting the deterministic breadcrumb path on ` > ` at the storage boundary.
- Kept document write/copy/scanner/compound call-site wiring out of this plan; Plan 168-04 owns those integrations.

## Deviations from Plan

- Wave 3 executor stopped returning progress after the first task commit. The orchestrator stopped the agent, completed verification, fixed test isolation, and closed out the remaining scheduler/pending-worker slice locally.
- T-I-018 initially inserted both active entries in the test catalog while expecting only a primary warning. The test setup was corrected so T-I-018 inserts only `primary`; T-I-019 inserts both entries.

**Total deviations:** 2 process/test-scope deviations, 0 product behavior deviations.
**Impact:** No product scope change.

## Issues Encountered

- The active-entry scheduler reads `fqc_embeddings`, so integration tests must make the database catalog match the expected active entry set, not just pass a filtered config object.

## Known Stubs

None.

## Threat Flags

None. Instance/document scoping and pending-row uniqueness remain covered by the helper contracts and tests.

## User Setup Required

None. Integration verification used `.env.test` credentials.

## Next Phase Readiness

Plan 168-04 can now route public document write, copy, scanner, compound, and document-output mutations through `diffAndPersistDocumentChunks`, then schedule only the returned changed chunks as `document_chunk` embedding targets.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/168-chunking-foundation-and-write-pipeline/168-03-SUMMARY.md`.
- Task commit found: `77aee4d`; the scheduler/pending-worker slice is ready to commit with this summary.
- Required unit, integration, and typecheck commands passed.

---
*Phase: 168-chunking-foundation-and-write-pipeline*
*Completed: 2026-06-14*
