---
phase: 85-reconciliation-engine
plan: "04"
subsystem: reconciliation-engine
tags: [recon, cache-invalidation, force-file-scan, test]
dependency_graph:
  requires: []
  provides: [RECON-07, TEST-04]
  affects: [src/mcp/tools/scan.ts, tests/unit/staleness-invalidation.test.ts]
tech_stack:
  added: []
  patterns: [cache-invalidation-on-scan, fake-timers-for-staleness]
key_files:
  created:
    - tests/unit/staleness-invalidation.test.ts
  modified:
    - src/mcp/tools/scan.ts
decisions:
  - "invalidateReconciliationCache() called as first statement in both force_file_scan branches to ensure cache cleared before scan begins"
  - "Test file mirrors reconciliation-staleness.test.ts structure exactly (same 7 mocks, same helpers, same beforeEach/afterEach pattern)"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-20"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
  files_created: 1
---

# Phase 85 Plan 04: Staleness Invalidation Wiring Summary

## One-liner

Wired `invalidateReconciliationCache()` into both `force_file_scan` branches in `scan.ts` and created `staleness-invalidation.test.ts` with 3 passing tests covering the invalidation path.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire invalidateReconciliationCache() into force_file_scan (both branches) | e9050e9 | src/mcp/tools/scan.ts |
| 2 | Create tests/unit/staleness-invalidation.test.ts — 3 force_file_scan invalidation tests | a2febb6 | tests/unit/staleness-invalidation.test.ts |

## What Was Built

**Task 1 — scan.ts wiring:**
- Added import: `import { invalidateReconciliationCache } from '../../services/plugin-reconciliation.js';`
- Added call as first statement inside `if (background) {` block (before `void runScanOnce(config).catch(...)`)
- Added call on line immediately before `const result = await runScanOnce(config)` in sync branch
- `grep -c invalidateReconciliationCache src/mcp/tools/scan.ts` returns 3 (1 import + 2 call sites)

**Task 2 — staleness-invalidation.test.ts:**
- 3 `it()` test cases across 3 `describe` blocks
- Mirrors `reconciliation-staleness.test.ts` mock structure exactly (7 identical vi.mock blocks)
- All 3 tests pass: `npm test -- staleness-invalidation` shows 3/3 green

## Verification Results

```
grep -c "invalidateReconciliationCache" src/mcp/tools/scan.ts  → 3
grep -c "it(" tests/unit/staleness-invalidation.test.ts        → 3
npm test -- staleness-invalidation                              → 3 passed (0 failed)
npm test (full suite)                                           → 1149 passed, 10 failed (pre-existing)
```

The 10 pre-existing failures are in `auth-middleware.test.ts`, `config.test.ts`, `embedding.test.ts`, and `resolve-document.test.ts` — none related to this plan's changes.

## Deviations from Plan

None — plan executed exactly as written.

## Requirements Satisfied

| Requirement | Status |
|-------------|--------|
| RECON-07 | Satisfied — force_file_scan now calls invalidateReconciliationCache() in both sync and background branches |
| TEST-04 | Satisfied — tests/unit/staleness-invalidation.test.ts exists with 3 passing it() cases |

## Known Stubs

None.

## Threat Flags

None — changes are purely internal module wiring (scan.ts imports plugin-reconciliation.ts) with no new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

| Item | Result |
|------|--------|
| src/mcp/tools/scan.ts exists | FOUND |
| tests/unit/staleness-invalidation.test.ts exists | FOUND |
| 85-04-SUMMARY.md exists | FOUND |
| commit e9050e9 exists | FOUND |
| commit a2febb6 exists | FOUND |
