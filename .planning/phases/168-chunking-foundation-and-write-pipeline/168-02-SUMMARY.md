---
phase: 168-chunking-foundation-and-write-pipeline
plan: 02
subsystem: embedding
tags: [chunks, schema, pgvector, rpc, catalog]

requires:
  - 168-01
provides:
  - Fresh `fqc_chunks` table DDL with required constraints and indexes
  - Document semantic catalog columns on `fqc_chunks` instead of `fqc_documents`
  - `match_chunks_<name>` RPC generation and retire cleanup
  - Schema verification for chunk plus memory active catalog entries
affects: [phase-168-write-pipeline, phase-169-search-lifecycle]

tech-stack:
  added: []
  patterns:
    - Core document semantic storage targets `fqc_chunks`
    - Memory/plugin vector schemas preserve AS-BUILT behavior
    - Chunk RPCs join parent document metadata for downstream aggregation

key-files:
  created:
    - tests/integration/embedding/chunk-schema.test.ts
    - tests/integration/embedding/chunk-column-set.test.ts
    - tests/integration/embedding/chunk-rpcs.test.ts
    - tests/integration/embedding/chunk-fresh-deployment.test.ts
  modified:
    - src/storage/supabase.ts
    - src/storage/schema-verify.ts
    - src/embedding/embedding-config-sync.ts
    - src/embedding/lifecycle/retire.ts
    - tests/unit/schema-verify.test.ts
    - tests/integration/embedding/column-set-creation.test.ts
    - tests/integration/embedding/drift-detection.test.ts
    - tests/integration/embedding/per-entry-rpcs.test.ts

key-decisions:
  - "`fqc_documents` no longer receives document-content per-entry vector columns or fresh `match_documents_<name>` RPCs."
  - "`embedding_<name>_indexed_at` is chunk-only; memory and plugin column sets keep their prior stamp shape."
  - "Existing per-entry RPC regression coverage now validates chunk RPCs for document content while preserving memory RPC behavior."

patterns-established:
  - "Schema verification checks active catalog widths on `fqc_chunks` and `fqc_memory`."
  - "Retire cleanup discovers and drops chunk RPCs, indexes, columns, and chunk-only indexed-at stamp columns."

requirements-completed:
  - REQ-CHUNK-006
  - REQ-CHUNK-007
  - REQ-CHUNK-008
  - REQ-CHUNK-014

duration: 39min
completed: 2026-06-14
---

# Phase 168 Plan 02: Chunk Schema and Catalog DDL Summary

**Fresh document semantic storage now targets chunk rows through `fqc_chunks`, chunk vector columns, and `match_chunks_<name>` RPCs**

## Performance

- **Duration:** 39 min
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- Added `fqc_chunks` base DDL with document cascade, parent chunk cascade, deterministic uniqueness, and lookup indexes.
- Moved document semantic catalog artifacts from `fqc_documents` to `fqc_chunks`, including chunk-only `_indexed_at` stamping columns.
- Updated startup schema verification to require `fqc_chunks` and validate active catalog dimensions on `fqc_chunks` plus `fqc_memory`.
- Added `match_chunks_<name>` RPC generation returning chunk content, heading metadata, parent document metadata, similarity, and entry stamp fields.
- Updated retire cleanup to remove chunk RPCs, chunk indexes, chunk vector columns, and chunk `_indexed_at` columns.
- Added/updated integration and unit coverage for T-I-001 through T-I-013 plus the affected regression tests.

## Task Commits

1. **Task 1: Add `fqc_chunks` base table DDL** - `98d8bd8` (feat)
2. **Task 2: Move document catalog columns to chunks and update verification** - `cf86805` (feat)
3. **Task 3: Generate chunk RPCs, retire cleanup, and fresh deployment guards** - committed with this summary close-out

## Files Created/Modified

- `src/storage/supabase.ts` - Chunk table DDL, chunk column sets, chunk RPCs, and core schema verification logging.
- `src/storage/schema-verify.ts` - Required `fqc_chunks` table and active catalog drift checks for chunks plus memory.
- `src/embedding/embedding-config-sync.ts` - Affected core table reporting now names `fqc_chunks` and `fqc_memory`.
- `src/embedding/lifecycle/retire.ts` - Retire artifact discovery/cleanup includes chunk RPCs, indexes, columns, and indexed-at stamps.
- `tests/unit/schema-verify.test.ts` - Unit coverage for required chunk table and chunk/memory dimension drift.
- `tests/integration/embedding/chunk-schema.test.ts` - T-I-001 through T-I-003.
- `tests/integration/embedding/chunk-column-set.test.ts` - T-I-004 through T-I-007.
- `tests/integration/embedding/chunk-rpcs.test.ts` - T-I-008 through T-I-011.
- `tests/integration/embedding/chunk-fresh-deployment.test.ts` - T-I-012 and T-I-013.
- `tests/integration/embedding/column-set-creation.test.ts`, `tests/integration/embedding/drift-detection.test.ts`, `tests/integration/embedding/per-entry-rpcs.test.ts` - Existing regressions updated for chunk document semantics.

## Verification

- `npm run test:integration -- tests/integration/embedding/chunk-schema.test.ts` - passed, 3 tests.
- `npm run test:integration -- tests/integration/embedding/chunk-column-set.test.ts` - passed, 4 tests.
- `npm run test:integration -- tests/integration/embedding/column-set-creation.test.ts` - passed, 3 tests.
- `npm run test:unit -- tests/unit/schema-verify.test.ts` - passed, 16 tests.
- `npm run test:integration -- tests/integration/embedding/drift-detection.test.ts` - passed, 3 tests.
- `npm run test:integration -- tests/integration/embedding/chunk-rpcs.test.ts tests/integration/embedding/chunk-fresh-deployment.test.ts` - passed, 6 tests.
- `npm run test:integration -- tests/integration/embedding/per-entry-rpcs.test.ts` - passed, 2 tests.
- `npm run test:integration -- tests/integration/embedding/maintain-vault-lifecycle.test.ts` - passed, 4 passed / 7 skipped by existing test conditions.
- `npm run typecheck` - passed.

## Decisions Made

- Kept legacy singular `match_documents` and singular document `embedding` compatibility untouched; only fresh per-entry document-content RPC generation moved to chunks.
- Kept memory and plugin vector tables without `_indexed_at` to preserve existing stamp contracts.
- Did not add any legacy document-vector cleanup action to `maintain_vault`; catalog retirement remains the supported cleanup surface.

## Deviations from Plan

- Wave 2 executor was stopped after it stopped returning progress with uncommitted RPC/fresh-deployment files. The orchestrator completed verification, summary, and close-out locally.
- An attempted parallel rerun of schema-mutating integration tests produced false failures because tests share global DDL artifacts. The affected checks were rerun sequentially and passed.

**Total deviations:** 2 process deviations, 0 product behavior deviations.
**Impact:** No product scope change.

## Issues Encountered

- Schema integration tests mutate shared PostgreSQL table columns and RPCs. They should be run sequentially when validating this slice.

## Known Stubs

None.

## Threat Flags

None. The database/RPC trust boundary from the plan is covered by scoped instance filters, Postgres vector width checks, and retire cleanup tests.

## User Setup Required

None. Integration verification used `.env.test` credentials.

## Next Phase Readiness

The schema/catalog foundation is ready for Plan 168-03. Downstream work can persist parsed chunks into `fqc_chunks`, schedule `document_chunk` embedding targets, and rely on chunk per-entry vector columns plus `match_chunks_<name>` RPCs.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/168-chunking-foundation-and-write-pipeline/168-02-SUMMARY.md`.
- Task commits found: `98d8bd8`, `cf86805`; the RPC/fresh-deployment slice is ready to commit with this summary.
- Required verification commands passed after sequential rerun of schema-mutating tests.

---
*Phase: 168-chunking-foundation-and-write-pipeline*
*Completed: 2026-06-14*
