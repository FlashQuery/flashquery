---
phase: 88-legacy-infrastructure-removal
plan: "04"
subsystem: test-infrastructure
tags:
  - test-cleanup
  - legacy-removal
  - discovery-tools
dependency_graph:
  requires:
    - "88-02"
  provides:
    - clean-test-suite-post-legacy-deletion
  affects:
    - tests/unit/mcp-server-tools.test.ts
tech_stack:
  added: []
  patterns:
    - delete-obsolete-tests
key_files:
  created: []
  modified:
    - tests/unit/mcp-server-tools.test.ts
  deleted:
    - tests/integration/change-notifications.test.ts
    - tests/integration/scanner-change-notifications.test.ts
    - tests/integration/discovery-orchestrator.integration.test.ts
    - tests/integration/discovery-coordinator.integration.test.ts
decisions:
  - "Unit test files (change-notifications, plugin-skill-invoker, discovery-orchestrator, discovery-coordinator) were already absent in the worktree — deleted in a prior wave commit; only integration files required deletion"
  - "mcp-server-tools.test.ts had no registerDiscoveryTools import; only the tool count assertion (35 -> 34) needed updating"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-21"
  tasks_completed: 2
  files_changed: 5
requirements:
  - TEST-13
---

# Phase 88 Plan 04: Delete Obsolete Test Files and Update Tool Count Summary

Deleted 4 obsolete integration test files that import from source files removed in Plan 02, and updated the mcp-server-tools tool count assertion from 35 to 34 to reflect removal of the discovery tools module.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Delete 4 obsolete integration test files | 6096a8f | 4 test files deleted |
| 2 | Update mcp-server-tools.test.ts tool count | e674b45 | tests/unit/mcp-server-tools.test.ts |

## Deviations from Plan

### Observations During Execution

**1. [Rule 0 - Observation] Unit test files already absent in worktree**
- **Found during:** Task 1 pre-check
- **Issue:** The plan listed 8 files to delete but the 4 unit files (change-notifications, plugin-skill-invoker, discovery-orchestrator, discovery-coordinator) were already absent in the worktree. These were deleted in an earlier wave/branch commit.
- **Action:** Only the 4 integration files required deletion. No error — the plan's "(if it exists)" qualifier covers this case.
- **Files modified:** None (already gone)

**2. [Rule 0 - Observation] No registerDiscoveryTools import in mcp-server-tools.test.ts**
- **Found during:** Task 2 pre-check
- **Issue:** The plan specified removing the `registerDiscoveryTools` import and two call sites, but the file had already been cleaned — no such import existed.
- **Action:** Only updated the tool count description string from "35 tools (37 minus 2 deprecated)" to "34 tools (36 minus 2 deprecated)".
- **Files modified:** tests/unit/mcp-server-tools.test.ts

**3. [Rule 0 - Observation] Pre-existing deferred test failures**
- **Found during:** npm test verification
- **Issue:** 6 test files fail with 12 combined failures. These match the deferred list from MEMORY.md (20 failures in 6 files deferred to end-of-milestone). Files: config.test.ts, auth-middleware.test.ts, embedding.test.ts, pending-plugin-review.test.ts, record-tools.test.ts, resolve-document.test.ts.
- **Action:** Not in scope — pre-existing, deferred, unrelated to this plan's changes.
- **mcp-server-tools.test.ts:** Passes 13/13 tests including the updated "34 tools" assertion.

## Verification Results

- `ls tests/unit/` — no change-notifications, plugin-skill-invoker, discovery-orchestrator, or discovery-coordinator files
- `ls tests/integration/` — no change-notifications, scanner-change-notifications, discovery-orchestrator, or discovery-coordinator files
- `grep "registerDiscoveryTools" tests/unit/mcp-server-tools.test.ts` — zero matches
- `grep "35 tools\|37 minus" tests/unit/mcp-server-tools.test.ts` — zero matches
- `grep "34 tools" tests/unit/mcp-server-tools.test.ts` — 1 match (correct)
- `npx vitest run tests/unit/mcp-server-tools.test.ts` — 13/13 passed

## Known Stubs

None.

## Threat Flags

None — changes are test file deletions only; no production code affected.

## Self-Check: PASSED

- Commit 6096a8f: 4 integration test files deleted — verified via git log
- Commit e674b45: mcp-server-tools.test.ts updated — verified via grep and vitest run
- All acceptance criteria met
