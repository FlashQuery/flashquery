---
phase: 84-schema-parsing-policy-infrastructure
plan: "01"
subsystem: plugins
tags: [interfaces, schema-parsing, type-registry, ddl]
dependency_graph:
  requires: []
  provides: [DocumentTypePolicy, TypeRegistryEntry, globalTypeRegistry, parsePluginSchema-policy-fields, buildPluginTableDDL-last_seen_updated_at]
  affects: [src/plugins/manager.ts]
tech_stack:
  added: []
  patterns: [module-singleton, conservative-defaults, parse-time-validation]
key_files:
  created: []
  modified:
    - src/plugins/manager.ts
decisions:
  - "D-08 conservative defaults applied: access=read-write, on_added=ignore, on_moved=keep-tracking, on_modified=ignore"
  - "D-05 checked before D-06: auto-track+no-track_as fires first; track_as-table-not-found fires second"
  - "D-07 field_map column validation is warn-only (not throw) — deferred to runtime"
  - "buildGlobalTypeRegistry() called in both error and success paths of initPlugins()"
metrics:
  duration_seconds: 173
  completed_date: "2026-04-20"
  tasks_completed: 3
  files_modified: 1
---

# Phase 84 Plan 01: Schema Parsing & Policy Infrastructure Summary

**One-liner:** DocumentTypePolicy/TypeRegistryEntry interfaces plus extended YAML parser with D-05/D-06/D-07 validation and globalTypeRegistry singleton wired into initPlugins().

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add DocumentTypePolicy and TypeRegistryEntry interfaces; update ParsedPluginSchema | 53607a8 | src/plugins/manager.ts |
| 2 | Extend parsePluginSchema() documents.types parser loop with policy fields, validation, and defaults | 53607a8 | src/plugins/manager.ts |
| 3 | Add last_seen_updated_at to implicitCols; add globalTypeRegistry singleton; wire into initPlugins() | 53607a8 | src/plugins/manager.ts |

## What Was Built

All three tasks were implemented atomically in a single commit (53607a8) against `src/plugins/manager.ts`:

**Task 1 — Interfaces:**
- `DocumentTypePolicy` interface exported with 10 fields: id, folder, description, access, on_added, on_moved, on_modified, track_as, template, field_map
- `TypeRegistryEntry` interface exported with pluginId, instanceId, policy fields
- `ParsedPluginSchema.documents.types` updated from anonymous `Array<{id,folder,description?}>` to `DocumentTypePolicy[]`

**Task 2 — Parser extension:**
- Added `tableNames` Set built from `tables.map(t => t.name)` before the rawTypes.map() loop
- All 7 policy fields extracted with D-08 conservative defaults (access='read-write', on_added='ignore', on_moved='keep-tracking', on_modified='ignore'; track_as/template/field_map default to undefined)
- D-05 validation: throws when `on_added === 'auto-track' && !track_as`
- D-06 validation: throws when `track_as && !tableNames.has(track_as)` (D-05 checked first per spec)
- D-07 validation: warns (does not throw) when field_map column targets not found in track_as table columns

**Task 3 — DDL + registry:**
- Added `last_seen_updated_at TIMESTAMPTZ` as 6th entry in `implicitCols` array in `buildPluginTableDDL()`
- Added `export let globalTypeRegistry: Map<string, TypeRegistryEntry> = new Map()` module singleton
- Added `getTypeRegistryMap()` export returning live reference
- Added `buildGlobalTypeRegistry()` export — full rebuild with first-registration-wins collision handling
- Wired `buildGlobalTypeRegistry()` into `initPlugins()` success path (after `pluginManager = manager`) and error path (after early-return assignment)

## Verification

- `npx tsc --noEmit` — no errors in manager.ts (pre-existing errors in other files are unrelated to this plan)
- `npm test -- tests/unit/plugin-manager.test.ts` — 35/35 tests pass
- All spot-check grep assertions pass

## Deviations from Plan

None — plan executed exactly as written. Tasks 1, 2, and 3 were committed together (single file, all changes coherent) rather than as three separate commits since there was no meaningful intermediate state to checkpoint.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries were introduced. Changes are internal data structure and parse-time validation only.

## Self-Check: PASSED

- [x] `src/plugins/manager.ts` modified and committed at 53607a8
- [x] `grep -n "export interface DocumentTypePolicy"` returns line 26
- [x] `grep -n "export interface TypeRegistryEntry"` returns line 39
- [x] `grep -n "types: DocumentTypePolicy\[\]"` returns line 49
- [x] `grep -n "last_seen_updated_at TIMESTAMPTZ"` returns line 333
- [x] `grep -n "export let globalTypeRegistry"` returns line 438
- [x] `grep -n "export function buildGlobalTypeRegistry"` returns line 454
- [x] `grep -n "on_added === 'auto-track' && !track_as"` returns line 240
- [x] `grep -n "first registration wins"` returns line 461
