---
phase: 88-legacy-infrastructure-removal
plan: "06"
subsystem: tests
tags:
  - test-cleanup
  - benchmarks
  - reconciliation
dependency_graph:
  requires:
    - "88-03"
    - "88-04"
  provides:
    - "Scenario test directory free of discover_document test"
    - "Reconciliation performance benchmark replacing discovery throughput benchmark"
  affects:
    - tests/benchmark/discovery-performance.bench.ts
    - tests/scenarios/directed/testcases/
tech_stack:
  added: []
  patterns:
    - "Reconciliation staleness cache benchmarking (invalidateReconciliationCache + two-call pattern)"
key_files:
  created: []
  modified:
    - tests/benchmark/discovery-performance.bench.ts
  deleted:
    - tests/scenarios/directed/testcases/test_discover_document.py
decisions:
  - "invalidateReconciliationCache() takes no arguments (not pluginId/instanceId as plan pseudocode suggested) — adapted benchmark calls accordingly"
  - "reconcilePluginDocuments third arg is optional databaseUrl string, not a config object — pg mock added so benchmarks run without real DB"
metrics:
  duration: "2 minutes"
  completed: "2026-04-21T13:43:22Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 88 Plan 06: Delete discover_document Test and Rewrite Discovery Benchmark Summary

Deleted test_discover_document.py (447 lines, covers F-16/F-17 for deleted MCP tool) and rewrote discovery-performance.bench.ts to benchmark reconciliation query cost (3 benchmarks: cold start, staleness cache hit, 500-doc scale) instead of discovery throughput.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Delete test_discover_document.py | f31945e | tests/scenarios/directed/testcases/test_discover_document.py (deleted) |
| 2 | Rewrite discovery-performance.bench.ts for reconciliation | afc4cb7 | tests/benchmark/discovery-performance.bench.ts |

## Verification Results

- `test_discover_document.py` deleted — confirmed "No such file or directory"
- `test_file_scan_lifecycle.py` untouched — still present
- `grep "executeDiscovery" tests/benchmark/discovery-performance.bench.ts` — zero matches
- `grep "reconcilePluginDocuments" tests/benchmark/discovery-performance.bench.ts` — 8 matches
- `grep -r "fqc_change_queue|needs_discovery|discovery_status|watcher_claims" tests/scenarios/directed/testcases/` — zero matches

## Deviations from Plan

### Automatic Adaptations

**1. [Rule 1 - Bug] invalidateReconciliationCache() signature mismatch**
- **Found during:** Task 2 implementation
- **Issue:** Plan pseudocode called `invalidateReconciliationCache(pluginId, instanceId)` with two args, but the actual function signature is `invalidateReconciliationCache(): void` (clears the entire cache map, no arguments)
- **Fix:** Benchmark calls `invalidateReconciliationCache()` with no arguments before each cold-start test
- **Files modified:** tests/benchmark/discovery-performance.bench.ts
- **Commit:** afc4cb7

**2. [Rule 2 - Missing mock] pg-client mock required**
- **Found during:** Task 2 implementation
- **Issue:** Plan said "reconcilePluginDocuments will invoke mocked Supabase and pg, so it can run without a real DB connection" but pg-client was not in the existing mock set; the function imports `createPgClientIPv4` directly which would fail without a mock
- **Fix:** Added `vi.mock('../../src/utils/pg-client.js', ...)` returning a mock pg client with connect/query/end stubs
- **Files modified:** tests/benchmark/discovery-performance.bench.ts
- **Commit:** afc4cb7

**3. [Rule 2 - Missing mock] vault + frontmatter mocks required**
- **Found during:** Task 2 implementation
- **Issue:** `reconcilePluginDocuments` also imports `vaultManager` and `atomicWriteFrontmatter`; without mocks these would attempt real filesystem ops
- **Fix:** Added `vi.mock('../../src/storage/vault.js', ...)` and `vi.mock('../../src/utils/frontmatter.js', ...)` stubs
- **Files modified:** tests/benchmark/discovery-performance.bench.ts
- **Commit:** afc4cb7

## Known Stubs

None — no hardcoded placeholders or TODO markers introduced.

## Threat Flags

None — only test file deletions and benchmark rewrites; no production code or trust boundaries modified.

## Self-Check: PASSED

- `tests/benchmark/discovery-performance.bench.ts` exists and is valid TypeScript (tsc --noEmit reported no errors on this file)
- `tests/scenarios/directed/testcases/test_discover_document.py` deleted (confirmed missing)
- Commits f31945e and afc4cb7 both present in git log
