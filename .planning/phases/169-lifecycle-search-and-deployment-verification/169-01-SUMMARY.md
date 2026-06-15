---
phase: 169-lifecycle-search-and-deployment-verification
plan: 01
subsystem: embedding
tags: [chunks, lifecycle, maintain-vault, embeddings]

requires:
  - 168-04
provides:
  - Document lifecycle processing over `fqc_chunks`
  - Chunk dry-run estimates and by-document reporting
  - Per-chunk lifecycle failure attribution
  - Integration coverage for chunk backfill/rebuild/stale/failure behavior
affects: [phase-169-search, maintain-vault]

key-files:
  created:
    - tests/unit/chunk-lifecycle.test.ts
    - tests/integration/embedding/chunk-maintain-vault-lifecycle.test.ts
  modified:
    - src/embedding/lifecycle/core-processor.ts
    - src/embedding/lifecycle/types.ts
    - src/embedding/lifecycle/scope.ts
    - src/mcp/tools/scan.ts
    - src/mcp/utils/response-formats.ts
    - src/services/maintenance.ts

requirements-completed:
  - REQ-CHUNK-011

completed: 2026-06-14
---

# Phase 169 Plan 01: Chunk Lifecycle Summary

Document-scoped `backfill_embeddings` and `rebuild_embeddings` now operate on chunk rows instead of whole-document vectors.

## Accomplishments

- Redirected document lifecycle planning to parse scoped markdown documents, persist/diff `fqc_chunks` for mutating runs, and select `document_chunk` rows for embedding.
- Preserved memory lifecycle selection and embedding behavior on `fqc_memory`.
- Added lifecycle response deltas: `by_document`, `by_document_truncated`, `would_process_chunks`, `would_process_documents`, and `max_documents_in_response`.
- Added per-chunk failure metadata with `entity_type: "document_chunk"`, `document_id`, `chunk_id`, `heading_path`, and error text.
- Exposed `max_documents_in_response` through `maintain_vault`.

## Verification

- `npm run test:unit -- tests/unit/chunk-lifecycle.test.ts tests/unit/lifecycle-core-contract.test.ts tests/unit/lifecycle-mixed-background-job.test.ts` - passed, 8 tests.
- `npm run test:integration -- tests/integration/embedding/chunk-maintain-vault-lifecycle.test.ts` - passed, 4 tests.
- `npm run typecheck` - passed.

## Deviations from Plan

None - plan executed as scoped for code and Vitest coverage. Directed public lifecycle scenarios remain for the broader phase scenario pass.

## Self-Check: PASSED

- T-U-031 through T-U-033 exist and pass.
- T-I-020 through T-I-023 exist and pass with `.env.test`.
- Document lifecycle rows are chunks; memory rows remain row-per-vector.
- Dry-run parses documents without persisting chunks.
- By-document reporting is capped and failure-preserving.
