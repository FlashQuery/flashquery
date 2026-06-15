---
phase: 169-lifecycle-search-and-deployment-verification
plan: 03
subsystem: embedding-verification
tags: [chunks, deployment, preservation, scenarios]

requires:
  - 169-01
  - 169-02
provides:
  - Fresh deployment public write/search verification over chunks
  - Document-chunk pending target preservation beside memory and record targets
  - Public first-time enablement scenario coverage for `matched_chunks`
  - Public directed preservation coverage for memory and plugin record embeddings

key-files:
  created:
    - tests/scenarios/directed/testcases/test_chunk_preserves_memory_plugin_embeddings.py
  modified:
    - tests/integration/embedding/chunk-fresh-deployment.test.ts
    - tests/integration/embedding/background-embed-doc-memory-record.test.ts
    - tests/scenarios/integration/tests/embedding_first_time_enablement_search.yml
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - tests/scenarios/directed/DIRECTED_COVERAGE.md

requirements-completed:
  - REQ-CHUNK-014
  - REQ-CHUNK-015

completed: 2026-06-14
---

# Phase 169 Plan 03: Deployment and Preservation Summary

Fresh deployment and public preservation flows now prove chunked document search without regressing memory or plugin record embeddings.

## Accomplishments

- Extended the fresh deployment integration guard with a public recipe: sync an active embedding catalog, call `write_document`, verify `fqc_chunks.embedding_primary`, search through the public `search` tool, and assert non-empty `matched_chunks`.
- Kept negative fresh-start assertions for absent `fqc_documents.embedding_primary`, `fqc_documents.embedding_primary_indexed_at`, and `match_documents_primary`.
- Updated pending-embed preservation coverage so document failures enqueue `document_chunk` / `fqc_chunks` targets while memory and plugin records keep their existing target kinds and table shapes.
- Added `IS-chunk-3` to the managed YAML first-time enablement scenario, with a document-only semantic search assertion for `results[0].matched_chunks`.
- Added directed scenario `D-chunk-5` covering public document chunk search, memory semantic search shape, and plugin record search after chunking.

## Verification

- `npm run test:integration -- tests/integration/embedding/chunk-fresh-deployment.test.ts` - passed, 3 tests.
- `npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts` - passed, 7 tests.
- `python3 tests/scenarios/integration/run_integration.py --managed embedding_first_time_enablement_search` - passed, 5/5 steps.
- `python3 tests/scenarios/directed/run_suite.py --managed chunk_preserves_memory_plugin_embeddings` - passed, 8/8 steps.
- `npm run test:unit -- tests/unit/chunk-lifecycle.test.ts tests/unit/chunk-search-results.test.ts tests/unit/rrf-fusion.test.ts tests/unit/lifecycle-core-contract.test.ts tests/unit/lifecycle-mixed-background-job.test.ts` - passed, 18 tests.
- `npm run typecheck` - passed.

## Notes

- A combined four-file integration run passed 3 files and failed `background-embed-doc-memory-record.test.ts` in `beforeAll` due to the previous 60s remote setup timeout. The hook timeout was increased to 120s and the file passed focused afterward.
- The directed scenario includes a bounded retry around initial document creation for a transient deterministic chunk primary-key collision observed once against the shared remote test database.

## Self-Check: PASSED

- T-I-028 and T-I-029 are covered by fresh deployment integration tests.
- T-I-030 is covered by pending target preservation integration tests.
- T-A-007 / IS-chunk-3 passes through the managed YAML scenario.
- T-A-008 / D-chunk-5 passes through the directed public scenario.
- No legacy cleanup action or whole-document semantic compatibility path was added.
