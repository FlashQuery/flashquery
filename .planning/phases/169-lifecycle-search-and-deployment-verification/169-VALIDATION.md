---
phase: 169
slug: lifecycle-search-and-deployment-verification
created: 2026-06-14
status: passed
---

# Phase 169 Validation Strategy

## Sampling Targets

- Lifecycle chunk work planning, dry-run, stale filters, by-document reporting, failures, locks, background jobs, abort, and `max_rows`.
- Search chunk RPC routing, chunk-to-document aggregation, RRF fusion, mixed merge, partial retriever failure, zero-active behavior, and `limit_chunks_per_result`.
- Fresh deployment public recipe and preservation of memory/plugin record embedding behavior.

## Required Evidence

- [x] T-U-031 through T-U-033 pass in `tests/unit/chunk-lifecycle.test.ts`.
- [x] T-I-020 through T-I-023 pass in `tests/integration/embedding/chunk-maintain-vault-lifecycle.test.ts`.
- [x] D-chunk-3 and D-chunk-4 pass through directed scenario runs.
- [x] T-U-034 through T-U-039 pass in `tests/unit/chunk-search-results.test.ts` and existing RRF coverage remains green.
- [x] T-I-024 through T-I-027 pass in `tests/integration/embedding/chunk-search-mode-matrix.test.ts`.
- [x] IS-chunk-1 and IS-chunk-2 pass through `embedding_chunks_search`.
- [x] T-I-028 through T-I-029 pass in `tests/integration/embedding/chunk-fresh-deployment.test.ts`.
- [x] T-I-030 through T-I-032 pass across preservation integration tests.
- [x] D-chunk-5 and IS-chunk-3 pass through directed/YAML scenario runs.
- [x] `npm run typecheck` passes after each plan.

## Source Traceability

- REQ-CHUNK-011: Plan 169-01
- REQ-CHUNK-012: Plan 169-02
- REQ-CHUNK-013: Plan 169-02
- REQ-CHUNK-014: Plan 169-03
- REQ-CHUNK-015: Plan 169-03

## Verification Notes

Integration tests that mutate schema should run sequentially or in isolated instances to avoid DDL races. Scenario coverage matrices should be regenerated or updated after adding new coverage IDs.

## Passing Evidence

- `npm run test:unit -- tests/unit/chunk-lifecycle.test.ts tests/unit/chunk-search-results.test.ts tests/unit/rrf-fusion.test.ts tests/unit/lifecycle-core-contract.test.ts tests/unit/lifecycle-mixed-background-job.test.ts` - passed 18 tests on 2026-06-14.
- `npm run test:integration -- tests/integration/embedding/chunk-maintain-vault-lifecycle.test.ts` - passed 4 tests on 2026-06-14.
- `npm run test:integration -- tests/integration/embedding/chunk-search-mode-matrix.test.ts` - passed 4 tests on 2026-06-14.
- `npm run test:integration -- tests/integration/embedding/chunk-fresh-deployment.test.ts` - passed 3 tests on 2026-06-14.
- `npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts` - passed 7 tests on 2026-06-14.
- `python3 tests/scenarios/directed/run_suite.py --managed chunk_lifecycle` - passed 2/2 tests on 2026-06-14.
- `python3 tests/scenarios/directed/run_suite.py --managed chunk_preserves_memory_plugin_embeddings` - passed 8/8 steps on 2026-06-14.
- `python3 tests/scenarios/integration/run_integration.py --managed embedding_chunks_search` - passed 4/4 steps on 2026-06-14.
- `python3 tests/scenarios/integration/run_integration.py --managed embedding_first_time_enablement_search` - passed 5/5 steps on 2026-06-14.
- `npm run typecheck` - passed on 2026-06-14.
