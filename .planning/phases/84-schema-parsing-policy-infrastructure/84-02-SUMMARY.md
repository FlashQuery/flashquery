---
phase: 84-schema-parsing-policy-infrastructure
plan: "02"
subsystem: plugins
tags: [type-registry, mcp-tools, wiring, ddl, tests]
dependency_graph:
  requires: [84-01]
  provides: [buildGlobalTypeRegistry-call-sites-register, buildGlobalTypeRegistry-call-sites-unregister, implicit-columns-test-last_seen_updated_at]
  affects: [src/mcp/tools/plugins.ts, tests/unit/plugin-manager.test.ts]
tech_stack:
  added: []
  patterns: [registry-rebuild-on-mutation, idempotent-rebuild]
key_files:
  created: []
  modified:
    - src/mcp/tools/plugins.ts
    - tests/unit/plugin-manager.test.ts
decisions:
  - "buildGlobalTypeRegistry() called synchronously after each loadEntry/removeEntry — no async needed since the function is synchronous"
metrics:
  duration_seconds: 120
  completed_date: "2026-04-20"
  tasks_completed: 2
  files_modified: 2
---

# Phase 84 Plan 02: Registry Wiring & Test Update Summary

**One-liner:** Wired buildGlobalTypeRegistry() into three MCP tool call sites (register update path, register new path, unregister path) and extended the implicit columns DDL test to assert last_seen_updated_at TIMESTAMPTZ.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add buildGlobalTypeRegistry to plugins.ts import and insert 3 call sites | 13266ba | src/mcp/tools/plugins.ts |
| 2 | Update plugin-manager.test.ts implicit columns assertion for last_seen_updated_at | e4bba43 | tests/unit/plugin-manager.test.ts |

## What Was Built

**Task 1 — plugins.ts wiring:**
- Added `buildGlobalTypeRegistry` to the import from `../../plugins/manager.js`
- Inserted `buildGlobalTypeRegistry()` after the update-path `loadEntry` call (~line 251) in register_plugin's re-registration branch
- Inserted `buildGlobalTypeRegistry()` after the new-registration `loadEntry` call (~line 317) in register_plugin's new-plugin branch
- Inserted `buildGlobalTypeRegistry()` after `removeEntry` call (~line 703) in unregister_plugin cleanup path
- All three call sites use Phase 84 comment labels for traceability

**Task 2 — Test update:**
- Updated "includes implicit columns" test description to include `last_seen_updated_at` in the column name list
- Added `expect(ddl).toContain('last_seen_updated_at TIMESTAMPTZ')` as the sixth assertion
- All 35 tests in plugin-manager.test.ts pass

## Verification

- `grep -c "buildGlobalTypeRegistry" src/mcp/tools/plugins.ts` returns 4 (1 import + 3 calls)
- `grep "last_seen_updated_at TIMESTAMPTZ" tests/unit/plugin-manager.test.ts` returns line 187
- `npm test -- tests/unit/plugin-manager.test.ts` — 35/35 tests pass
- `npx tsc --noEmit` — no errors in plugins.ts (pre-existing errors in other files are unrelated to this plan)

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — changes are internal function calls only. buildGlobalTypeRegistry() on unregister is idempotent (T-84-04 accepted per threat model).

## Self-Check: PASSED

- [x] `src/mcp/tools/plugins.ts` modified at commit 13266ba — 4 `buildGlobalTypeRegistry` references confirmed
- [x] `tests/unit/plugin-manager.test.ts` modified at commit e4bba43 — `last_seen_updated_at TIMESTAMPTZ` assertion at line 187
- [x] plugin-manager.test.ts 35/35 pass
- [x] No errors introduced in plugins.ts (tsc pre-existing errors are in other files)
