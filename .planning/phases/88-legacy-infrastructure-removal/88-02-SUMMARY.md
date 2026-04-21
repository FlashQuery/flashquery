---
phase: 88-legacy-infrastructure-removal
plan: "02"
subsystem: services, mcp-tools, cli, frontmatter-sanitizer
tags: [legacy-removal, deletion, refactor]
dependency_graph:
  requires:
    - 88-01 (dependency severance pre-deletion prep)
  provides:
    - 6 legacy source files deleted from disk
    - index.ts free of discovery coordinator and discover CLI command
    - src/mcp/server.ts free of registerDiscoveryTools
    - plugins.ts unregister_plugin free of watcher_claims and legacy column references
    - frontmatter-sanitizer.ts with discovery_status removed from strip list
  affects:
    - src/index.ts
    - src/mcp/server.ts
    - src/mcp/tools/plugins.ts
    - src/mcp/utils/frontmatter-sanitizer.ts
tech_stack:
  added: []
  patterns:
    - surgical deletion pattern: source files removed, test files co-deleted
    - cascading reference cleanup: delete source → remove imports → remove registrations
key_files:
  created: []
  modified:
    - src/index.ts
    - src/mcp/server.ts
    - src/mcp/tools/plugins.ts
    - src/mcp/utils/frontmatter-sanitizer.ts
    - tests/unit/frontmatter-sanitizer.test.ts
    - tests/unit/document-tools.test.ts
    - tests/unit/mcp-server-tools.test.ts
  deleted:
    - src/services/discovery-orchestrator.ts
    - src/services/plugin-skill-invoker.ts
    - src/services/discovery-coordinator.ts
    - src/services/document-ownership.ts
    - src/mcp/tools/discovery.ts
    - src/cli/commands/discover.ts
    - tests/unit/change-notifications.test.ts
    - tests/unit/discovery-coordinator.test.ts
    - tests/unit/discovery-orchestrator.test.ts
    - tests/unit/plugin-skill-invoker.test.ts
decisions:
  - "All 6 legacy source files deleted in single commit for atomicity"
  - "4 test files for deleted source files co-deleted (Rule 1 auto-fix — they would fail on import)"
  - "frontmatter-sanitizer.test.ts and document-tools.test.ts updated to reflect discovery_status no longer stripped"
  - "mcp-server-tools.test.ts updated to remove registerDiscoveryTools import and all 3 call sites"
metrics:
  duration: "501 seconds"
  completed_date: "2026-04-21T11:55:48Z"
  tasks_completed: 3
  files_changed: 14
---

# Phase 88 Plan 02: Delete Legacy Source Files & Clean Surviving Files Summary

**One-liner:** Deleted 6 legacy discovery/notification source files and removed all import/registration references from the 4 surviving files; also deleted 4 orphaned test files and updated 3 test files to match new behavior.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Delete 6 legacy source files | 0c2fa45 | 6 files deleted |
| 2 | Clean index.ts and server.ts imports and registrations | c330a12 | src/index.ts, src/mcp/server.ts |
| 3 | Clean plugins.ts and frontmatter-sanitizer.ts; run test gate | b84dff1 | src/mcp/tools/plugins.ts, src/mcp/utils/frontmatter-sanitizer.ts, 7 test files |

## What Was Built

### Task 1 — Delete 6 legacy source files

Deleted in one `git rm` commit:
- `src/services/discovery-orchestrator.ts` (multi-plugin orchestration)
- `src/services/plugin-skill-invoker.ts` (in-process skill invocation)
- `src/services/discovery-coordinator.ts` (async discovery queue processor)
- `src/services/document-ownership.ts` (ownership update abstraction — inlined in Plan 01)
- `src/mcp/tools/discovery.ts` (MCP discovery tool registrations)
- `src/cli/commands/discover.ts` (`flashquery discover` CLI subcommand)

`src/services/plugin-propagation.ts` intentionally kept per D-02.

### Task 2 — index.ts and server.ts cleanup

**src/index.ts (5 changes):**
1. Removed `import { discoverCommand } from './cli/commands/discover.js'`
2. Removed `import { processDiscoveryQueueAsync } from './services/discovery-coordinator.js'`
3. Removed `DiscoveryQueueItem` from re-export (`export type { ScanResult }` only)
4. Removed `discoveryQueue` from `runScanCommand` scanResult destructure
5. Removed fire-and-forget discovery block and `program.addCommand(discoverCommand)`

**src/mcp/server.ts (2 changes):**
1. Removed `import { registerDiscoveryTools } from './tools/discovery.js'`
2. Removed `registerDiscoveryTools(server, config)` call

### Task 3 — plugins.ts, frontmatter-sanitizer.ts, test files

**src/mcp/tools/plugins.ts (D-09, D-10, D-11):**
- Removed watcher_claims count query (6 lines) from dry-run section
- Removed `claimsCount` dry-run message line
- Removed `discovery_status: 'pending'` and `needs_discovery: true` from ownership update
- Deleted entire watcher_claims cleanup try/catch block (~32 lines) including RPC call and manual fallback loop
- Removed stale `claimsCount` reference from teardown response message

**src/mcp/utils/frontmatter-sanitizer.ts (D-12):**
- Removed `'discovery_status'` from `internalFields` Set
- Updated JSDoc in two places to remove `discovery_status` from fields-removed listing

**Test files (auto-fix):**
- Deleted `tests/unit/change-notifications.test.ts` — imported deleted `plugin-skill-invoker.ts`
- Deleted `tests/unit/discovery-coordinator.test.ts` — imported deleted `discovery-coordinator.ts`
- Deleted `tests/unit/discovery-orchestrator.test.ts` — imported deleted `discovery-orchestrator.ts`
- Deleted `tests/unit/plugin-skill-invoker.test.ts` — imported deleted `plugin-skill-invoker.ts`
- Updated `tests/unit/mcp-server-tools.test.ts` — removed `registerDiscoveryTools` import and 3 call sites
- Updated `tests/unit/frontmatter-sanitizer.test.ts` — removed `discovery_status` from 2 tests
- Updated `tests/unit/document-tools.test.ts` — removed `discovery_status` from SPEC-18 test

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Deleted 4 unit test files for removed source files**
- **Found during:** Task 3 verification (`npm test`)
- **Issue:** `change-notifications.test.ts`, `discovery-coordinator.test.ts`, `discovery-orchestrator.test.ts`, `plugin-skill-invoker.test.ts` all failed with "Cannot find module" because they imported the now-deleted source files
- **Fix:** Deleted all 4 test files
- **Files modified:** 4 test files deleted
- **Commit:** b84dff1

**2. [Rule 1 - Bug] Updated 3 test files reflecting discovery_status sanitizer change**
- **Found during:** Task 3 verification (`npm test`)
- **Issue:** `frontmatter-sanitizer.test.ts` (2 tests) and `document-tools.test.ts` (1 test) asserted `discovery_status` would be stripped by the sanitizer — but D-12 removed it from the strip list
- **Fix:** Updated test assertions to remove `discovery_status` from expected internal fields
- **Files modified:** `tests/unit/frontmatter-sanitizer.test.ts`, `tests/unit/document-tools.test.ts`
- **Commit:** b84dff1

**3. [Rule 1 - Bug] Stale `claimsCount` reference in teardown response**
- **Found during:** Task 3 acceptance criteria check
- **Issue:** After removing the watcher_claims dry-run query (D-09), a `teardownLines.push` referencing `claimsCount` remained in the actual teardown response section (~line 684) — this would cause a ReferenceError at runtime
- **Fix:** Removed the stale `teardownLines.push` line referencing `claimsCount`
- **Files modified:** `src/mcp/tools/plugins.ts`
- **Commit:** b84dff1

## Test Results

`npm test` exits with 22 pre-existing failures, 0 new failures from Plan 02 changes.

Pre-existing failures (unchanged from pre-Plan-02 baseline):
- `tests/unit/auth-middleware.test.ts` (6 failures)
- `tests/unit/compound-tools.test.ts` (1 failure)
- `tests/unit/config.test.ts` (2 failures)
- `tests/unit/embedding.test.ts` (1 failure)
- `tests/unit/git-manager.test.ts` (9 failures)
- `tests/unit/pending-plugin-review.test.ts` (1 failure)
- `tests/unit/record-tools.test.ts` (1 failure)
- `tests/unit/resolve-document.test.ts` (1 failure)

## Final Acceptance Gate

```
grep -r "invokeChangeNotifications|plugin-skill-invoker|discovery-orchestrator|discovery-coordinator|document-ownership" src/
→ ZERO MATCHES
```

## Known Stubs

None. All changes are functional deletions and reference removals.

## Threat Flags

None. The removed watcher_claims RPC (T-88-02) was defensive fallback code; its removal was the intended outcome.

## Self-Check: PASSED

- src/services/discovery-orchestrator.ts: MISSING (expected — deleted)
- src/services/plugin-skill-invoker.ts: MISSING (expected — deleted)
- src/services/discovery-coordinator.ts: MISSING (expected — deleted)
- src/services/document-ownership.ts: MISSING (expected — deleted)
- src/mcp/tools/discovery.ts: MISSING (expected — deleted)
- src/cli/commands/discover.ts: MISSING (expected — deleted)
- src/index.ts: FOUND
- src/mcp/server.ts: FOUND
- src/mcp/tools/plugins.ts: FOUND
- src/mcp/utils/frontmatter-sanitizer.ts: FOUND
- Commit 0c2fa45: FOUND
- Commit c330a12: FOUND
- Commit b84dff1: FOUND
