---
phase: 169-lifecycle-search-and-deployment-verification
plan: 02
subsystem: mcp-search
tags: [chunks, search, rrf, matched-chunks]

requires:
  - 169-01
provides:
  - Chunk-backed document semantic search
  - Document-centric `matched_chunks` search payloads
  - `limit_chunks_per_result` validation and result capping
  - Chunk search unit and integration coverage

key-files:
  created:
    - tests/unit/chunk-search-results.test.ts
    - tests/integration/embedding/chunk-search-mode-matrix.test.ts
  modified:
    - src/mcp/tools/compound.ts
    - src/mcp/utils/search-results.ts
    - tests/integration/embedding/search-test-helpers.ts

requirements-completed:
  - REQ-CHUNK-012
  - REQ-CHUNK-013

completed: 2026-06-14
---

# Phase 169 Plan 02: Chunk Search Summary

Unified document semantic search now routes through `match_chunks_<name>` and returns one top-level row per document with nested `matched_chunks`.

## Accomplishments

- Replaced catalog document semantic retrieval from `match_documents_<name>` to `match_chunks_<name>`.
- Added `matched_chunks` to public search result items with chunk id, heading path, breadcrumb, content, score, per-entry ranks, and indexed-at freshness maps.
- Added `limit_chunks_per_result` validation and per-document capping.
- Preserved RRF fusion metadata while merging chunk hits by parent document.
- Updated the integration search harness to seed semantic vectors on `fqc_chunks`.

## Verification

- `npm run test:unit -- tests/unit/chunk-search-results.test.ts tests/unit/rrf-fusion.test.ts` - passed, 10 tests.
- `npm run test:integration -- tests/integration/embedding/chunk-search-mode-matrix.test.ts` - passed, 4 tests.
- `npm run test:integration -- tests/integration/embedding/chunk-search-mode-matrix.test.ts tests/integration/embedding/search-mode-matrix.test.ts` - existing matrix passed 8/9 tests before the freshness-map merge fix; the only failure was fixed and reverified in the focused chunk search run.
- `npm run typecheck` - passed.

## Deviations from Plan

- YAML public search scenarios are not yet added in this slice; they remain for the phase scenario/verification pass.

## Self-Check: PASSED

- T-U-034 through T-U-039 exist and pass.
- T-I-024, T-I-026, and T-I-027 exist and pass.
- Existing zero-active and mixed search behavior was included in the combined run and did not fail.
- Unified search no longer imports or calls the retired `searchDocumentsSemantic` helper.
