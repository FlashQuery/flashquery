---
phase: 86-record-tool-integration-pending-review
plan: "02"
subsystem: testing
tags: [unit-tests, pending-review, teardown-fixtures, TEST-06]
dependency_graph:
  requires: []
  provides: [TEST-06]
  affects: [tests/unit/pending-plugin-review.test.ts, tests/helpers/discovery-fixtures.ts]
tech_stack:
  added: []
  patterns: [vitest-mock-chain, supabase-chain-helper, mock-server-registration]
key_files:
  created:
    - src/mcp/tools/pending-review.ts
    - tests/unit/pending-plugin-review.test.ts
  modified:
    - tests/helpers/discovery-fixtures.ts
decisions:
  - "Created minimal pending-review.ts in this worktree to enable test compilation (Plan 01 runs in parallel)"
  - "Test 8 uses call-pattern verification with TODO pointing to TEST-15 for full integration coverage"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-20"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 86 Plan 02: Pending Review Unit Tests & Fixture FK Fix Summary

Unit tests for the `clear_pending_reviews` MCP tool (TEST-06) with 8 Vitest cases, plus FK teardown order fix in `discovery-fixtures.ts` replacing `fqc_change_queue` with `fqc_pending_plugin_review`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create pending-plugin-review.test.ts — 8 tests (TEST-06) | 66de05a | src/mcp/tools/pending-review.ts, tests/unit/pending-plugin-review.test.ts |
| 2 | Update discovery-fixtures.ts teardown FK order | 7fbd9bb | tests/helpers/discovery-fixtures.ts |

## What Was Built

**Task 1:** Created `tests/unit/pending-plugin-review.test.ts` with 8 unit tests covering:
1. `template_available` review type returned when template declared
2. Empty response when no pending reviews exist
3. Query mode (`fqc_ids: []`) returns all items without calling `.delete()`
4. Clear mode calls DELETE with `.in('fqc_id', ids)` then returns remaining items
5. Idempotent — non-existent IDs cause no error (Postgres IN() ignores missing rows)
6. Response shape always contains all 4 fields: `fqc_id`, `table_name`, `review_type`, `context`
7. CASCADE: tool correctly handles empty state after parent document delete
8. `unregister_plugin` cleanup call pattern verification (DELETE with `plugin_id` + `instance_id` filters)

Also created `src/mcp/tools/pending-review.ts` (minimal implementation) since Plan 01 runs in parallel in a separate worktree and has not yet produced this file.

**Task 2:** Updated `tests/helpers/discovery-fixtures.ts` `cleanupTest()`:
- Comment: `fqc_change_queue → fqc_documents → fqc_vault` → `fqc_pending_plugin_review → fqc_documents → fqc_vault`
- Delete call: `fqc_change_queue` → `fqc_pending_plugin_review`

This prevents FK constraint violations during integration test teardown (mitigates T-86-06).

## Verification Results

- `npm test -- pending-plugin-review`: 8/8 tests pass, 0 failures
- `grep fqc_change_queue discovery-fixtures.ts`: 0 matches (fully replaced)
- `grep fqc_pending_plugin_review discovery-fixtures.ts`: 1 match (delete call in cleanupTest)
- TypeScript: no errors in files modified by this plan (pre-existing errors in other files are out of scope)

## Deviations from Plan

### Auto-added Missing Dependency

**[Rule 3 - Blocking] Created src/mcp/tools/pending-review.ts to unblock test compilation**
- **Found during:** Task 1
- **Issue:** Plan 01 (runs in parallel wave 1) had not yet created `pending-review.ts`; test file imports `registerPendingReviewTools` from it
- **Fix:** Created minimal but complete implementation of `pending-review.ts` with `registerPendingReviewTools` exporting the `clear_pending_reviews` tool handler
- **Files modified:** src/mcp/tools/pending-review.ts (created)
- **Commit:** 66de05a
- **Note:** Plan 01 will produce a more complete version; when worktrees merge, the Plan 01 version should supersede this one if it differs

## Known Stubs

None — all test assertions exercise real mock behavior; no placeholder data flows to UI.

## Threat Flags

None — test files and fixture helpers introduce no new network endpoints or trust boundaries.

## Self-Check: PASSED
