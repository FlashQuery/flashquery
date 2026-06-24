---
phase: 173-async-classification-lifecycle-lint-communities-and-hardening
plan: 7
subsystem: graph-public-verification
tags: [graph, mcp, e2e, scenarios, integration, docs]
requires: [173-01, 173-02, 173-03, 173-04, 173-05, 173-06]
provides:
  - Public MCP graph E2E smoke tests
  - Directed graph lifecycle and partial-mode scenarios
  - Managed graph YAML coverage for disabled, mock LLM, and lint/community flows
  - query_graph and maintain_vault discoverability clarification
affects:
  - tests/e2e
  - tests/scenarios/directed
  - tests/scenarios/integration
  - src/mcp/tool-help
  - src/mcp/tool-metadata.ts
tech-stack:
  added: []
  patterns: [Vitest E2E, directed scenarios, managed YAML integration scenarios]
key-files:
  created:
    - tests/e2e/graph-query.e2e.test.ts
    - tests/e2e/graph-search-get-document.e2e.test.ts
    - tests/scenarios/directed/testcases/test_graph_archive_staleness.py
    - tests/scenarios/directed/testcases/test_graph_disabled_and_partial.py
    - tests/scenarios/directed/testcases/test_graph_get_document_summary.py
    - tests/scenarios/directed/testcases/test_graph_processing_levels.py
  modified:
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - src/mcp/tool-help/query_graph.tool.md
    - src/mcp/tool-metadata.ts
requirements-completed: [GR-024B, GR-010, GR-011, GR-012, GR-013B, GR-014B, GR-015, GR-016B, GR-020B, GR-021, GR-022, GR-023]
decisions:
  - Keep query_graph strictly read-only; graph lint, graph worker, and community refresh workflows remain under maintain_vault.
  - Treat graph-disabled and skipped-enrichment expected-error/warning envelopes as contract behavior, not runtime failures.
metrics:
  completed_at: 2026-06-24T17:17:22Z
  tasks_completed: 3
  commits: 5
---

# Phase 173 Plan 07: Public Graph Verification Summary

Public graph verification now covers MCP E2E smoke behavior, directed graph lifecycle cases, focused managed YAML graph scenarios, and discoverability text for the graph read/maintenance boundary.

## Task Results

| Task | Result | Commit |
| --- | --- | --- |
| Add public graph MCP E2E smoke tests | Completed | fefb6bc8 |
| Add directed and managed graph scenario coverage | Completed with deviations | f35e06a1 |
| Clarify public graph tool/help metadata | Completed | 6da1ff80 |
| Restore ownership boundary for out-of-scope scenario edit | Completed | e6fb0005 |
| Correct IG-02 coverage status after final-tree rerun | Completed | 9d10651d |

## Verification

| Command | Result |
| --- | --- |
| `npm run test:e2e -- --run tests/e2e/graph-query.e2e.test.ts tests/e2e/graph-search-get-document.e2e.test.ts` | PASS: 2 files, 4 tests, about 90.75s |
| `python3 tests/scenarios/directed/run_suite.py --managed graph` | PASS: 6/6 scenarios, report `tests/scenarios/directed/reports/scenario-report-2026-06-24-134559.md`, about 8m20.3s |
| `python3 tests/scenarios/integration/run_integration.py --managed graph` | Initial run PASS: 4/4 scenarios while a temporary out-of-scope assertion edit was present. Final-tree rerun PASS for `graph_disabled_noop`, `graph_lint_communities`, and `graph_mock_llm_classification`; BLOCKED on `graph_search_expansion` during server startup with embedding catalog dimension drift: `fqc_memory.embedding_primary configured width 768, actual width 3`. |
| `test -f tests/integration/graph/node-identity.test.ts && test -f tests/unit/graph-query-status-filter.test.ts` | PASS |
| `npm test` | PASS: unit 233 files / 2498 tests; macro-framework 1 file / 594 tests |
| `npm run test:integration` | FAIL/STUCK outside 173-07 scope: multiple embedding integration tests failed due missing/generated embedding columns and dimension drift in the shared `.env.test` database; command was interrupted after it stopped producing output. |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Verification command adjustment] E2E filter belongs to the e2e script**
- **Found during:** Task 1
- **Issue:** The literal plan command `npm test -- --run tests/e2e/...` forwards the E2E filter into the repo's full `npm test` chain, causing the macro-framework config to report no matching test files.
- **Fix:** Used `npm run test:e2e -- --run tests/e2e/graph-query.e2e.test.ts tests/e2e/graph-search-get-document.e2e.test.ts`.
- **Files modified:** None
- **Commit:** fefb6bc8

**2. [Rule 1 - Assertion alignment] Public graph scenario assertions needed current response envelopes**
- **Found during:** Task 2
- **Issue:** New tests initially assumed every expected-error envelope set `isError:true`, schema flags lived under `data.graph`, and graph-expanded search exposed a `graph_context` string.
- **Fix:** Directed tests assert the actual public JSON contracts: expected-error JSON envelopes can be ordinary successful MCP responses, schema flags live under `data.features`, and graph search attribution is represented by `match_source` when returned.
- **Files modified:** Task-owned directed tests and coverage docs
- **Commit:** f35e06a1

**3. [Rule 2 - Ownership boundary correction] Reverted temporary edit outside assigned files**
- **Found during:** Final review
- **Issue:** Task 2 temporarily changed `tests/scenarios/integration/tests/graph_search_expansion.yml`, which was not in the explicit ownership list for this executor.
- **Fix:** Restored the file and reran the focused graph integration gate on the final tree. IG-02 is now registered but not marked passing because the final rerun was blocked before assertions by shared embedding dimension drift.
- **Files modified:** `tests/scenarios/integration/tests/graph_search_expansion.yml`, `tests/scenarios/integration/INTEGRATION_COVERAGE.md`
- **Commits:** e6fb0005, 9d10651d

## Deferred Issues

The full `npm run test:integration` gate is unhealthy independently of 173-07. Failures observed were outside the owned graph files and centered on embedding integration tests that depend on generated embedding columns or catalog dimensions in the shared `.env.test` database, including:

- `tests/integration/embedding/deactivated-operations.test.ts`
- `tests/integration/embedding/parallel-per-entry-attempt.test.ts`
- `tests/integration/embedding/pending-worker-per-entry.test.ts`
- `tests/integration/embedding/config-sync-add-entry.test.ts`
- `tests/integration/embedding/test-dev-repair.test.ts`
- `tests/integration/embedding/in-place-yaml-refusal.test.ts`
- `tests/integration/embedding/truncation-reactive-fallback.test.ts`
- `tests/integration/embedding/stamping-write-roundtrip.test.ts`
- `tests/integration/embedding/pending-embed-worker.test.ts`
- `tests/integration/services/scanner-embed-drain.test.ts`

The final-tree focused graph integration rerun also hit the same ambient embedding catalog problem during `graph_search_expansion` startup: `entry primary: fqc_memory.embedding_primary configured width 768, actual width 3`.

## Known Stubs

None. Stub-pattern hits were intentional test literals or pre-existing coverage prose, not unimplemented graph behavior.

## Threat Flags

None. This plan added tests and tool discoverability text only; it introduced no new network endpoints, auth paths, file access paths, or schema trust boundaries.

## Self-Check

PASSED. Verified expected files exist and commits `fefb6bc8`, `f35e06a1`, `6da1ff80`, `e6fb0005`, and `9d10651d` are present in git history.
