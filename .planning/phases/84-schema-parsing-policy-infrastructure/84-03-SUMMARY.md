---
phase: 84-schema-parsing-policy-infrastructure
plan: "03"
subsystem: plugins/tests
tags: [tests, policy-parsing, type-registry, unit-tests]
dependency_graph:
  requires: [84-01]
  provides: [TEST-01, TEST-02, declarative-policies-tests, global-type-registry-tests]
  affects: [tests/unit/declarative-policies.test.ts, tests/unit/global-type-registry.test.ts, src/plugins/manager.ts]
tech_stack:
  added: []
  patterns: [vitest-module-mocks, yaml-fixtures, vi.spyOn-singleton-override]
key_files:
  created:
    - tests/unit/declarative-policies.test.ts
    - tests/unit/global-type-registry.test.ts
  modified:
    - src/plugins/manager.ts
decisions:
  - "pluginManager singleton initialized to new PluginManager() at module level to allow safe pre-initPlugins() calls"
metrics:
  duration_seconds: 186
  completed_date: "2026-04-20"
  tasks_completed: 2
  files_modified: 3
---

# Phase 84 Plan 03: Unit Tests for Policy Parsing & Type Registry Summary

**One-liner:** 6 declarative-policy unit tests (D-14) and 4 global-type-registry unit tests (D-15) using YAML fixtures and module singleton spying patterns; all 10 pass with 0 failures.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create declarative-policies.test.ts — 6 tests per D-14 | 111c38d | tests/unit/declarative-policies.test.ts |
| 2 | Create global-type-registry.test.ts — 4 tests per D-15 | e2e394a | tests/unit/global-type-registry.test.ts, src/plugins/manager.ts |

## What Was Built

**Task 1 — declarative-policies.test.ts (6 tests):**

All 6 D-14 test cases implemented with YAML inline fixtures:
1. Parses all 7 policy fields (`access`, `on_added`, `on_moved`, `on_modified`, `track_as`, `template`, `field_map`) with correct values
2. Returns conservative defaults when policy fields are absent (`access=read-write`, `on_added=ignore`, `on_moved=keep-tracking`, `on_modified=ignore`, optional fields=undefined)
3. Throws with `/track_as/` regex when `on_added: auto-track` but `track_as` is missing
4. Throws with table name in message when `track_as` references a non-existent table
5. Warns (does not throw) for `field_map` column target not found in the `track_as` table; checks warn message contains `'field_map target column'` and the column name
6. Does not log a `field_map target column` warning when column exists in the table

**Task 2 — global-type-registry.test.ts (4 tests):**

All 4 D-15 test cases implemented using `vi.spyOn(pluginManager, 'getAllEntries').mockReturnValue()`:
1. Builds registry from 2 plugins with distinct type IDs — all types present with correct `pluginId`
2. First registration wins with `logger.warn` called containing `'first registration wins'` on collision
3. Reflects current state after register-then-unregister: `buildGlobalTypeRegistry()` called twice with different mock returns
4. Empty Map returned when no plugins loaded

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Initialized pluginManager module singleton**

- **Found during:** Task 2 — all 4 registry tests failing with "vi.spyOn() could not find an object to spy upon"
- **Issue:** `export let pluginManager: PluginManager;` declared without initialization; `buildGlobalTypeRegistry()` crashes on `pluginManager.getAllEntries()` if called before `initPlugins()`. This also means any isolated test file that imports from manager.ts starts with `pluginManager = undefined`.
- **Fix:** Changed declaration to `export let pluginManager: PluginManager = new PluginManager();` so the singleton is safe-to-use at module load time; `initPlugins()` still replaces it with a freshly-loaded instance.
- **Files modified:** src/plugins/manager.ts (line 436)
- **Commit:** e2e394a
- **Existing tests:** All 35 plugin-manager.test.ts tests still pass after change.

## Verification

- `npm test -- tests/unit/declarative-policies.test.ts tests/unit/global-type-registry.test.ts` — 10/10 pass, 0 fail
- Full unit suite: 1113 passed / 20 failed (all 20 failures are pre-existing; baseline before this plan was 24 failed / 1109 passed — the Rule 2 fix resolved 4 previously failing tests)

## Threat Flags

None — test-only files; no new production network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. The manager.ts change is a safe initialization default.

## Self-Check: PASSED

- [x] `tests/unit/declarative-policies.test.ts` exists and has 229+ lines
- [x] `tests/unit/global-type-registry.test.ts` exists and has 198+ lines
- [x] Commit 111c38d exists (declarative-policies.test.ts)
- [x] Commit e2e394a exists (global-type-registry.test.ts + manager.ts fix)
- [x] Both test files pass: 10/10 tests, 0 failures
- [x] All 6 D-14 test cases present in declarative-policies.test.ts
- [x] All 4 D-15 test cases present in global-type-registry.test.ts
