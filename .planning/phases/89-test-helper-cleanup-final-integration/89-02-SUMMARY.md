---
phase: 89-test-helper-cleanup-final-integration
plan: "02"
subsystem: test-helpers
tags: [mock-plugins, reconciliation, cleanup, test-helper]
dependency_graph:
  requires: []
  provides: [reconciliation-policy-mock-builder]
  affects: [tests/helpers/mock-plugins.ts]
tech_stack:
  added: []
  patterns: [declarative-policy-builder, PluginSchemaPolicy]
key_files:
  modified:
    - tests/helpers/mock-plugins.ts
decisions:
  - "Stripped all push-callback infrastructure (DiscoveryCallback, ChangeCallback, SkillInvocation) — no production counterpart after phase 88 deletion of plugin-skill-invoker.ts"
  - "Added PluginSchemaPolicy interface as optional second param to buildPluginSchemaYaml() — keeps standalone export usable while enabling policy emission"
  - "Added buildSchemaYaml() convenience method to MockPluginBuilder — simplifies test usage when policy builder methods are combined"
  - "Used 'stop-tracking' (not 'untrack') for withOnMoved parameter type — matches DocumentTypePolicy.on_moved exactly"
metrics:
  duration: "approx 5 min"
  completed: "2026-04-21T14:49:24Z"
  tasks_completed: 2
  files_changed: 1
---

# Phase 89 Plan 02: Mock Plugins Callback Cleanup Summary

Removed all push-callback infrastructure from `tests/helpers/mock-plugins.ts` and added declarative reconciliation policy builder methods (`withAutoTrack`, `withOnMoved`, `withOnModified`) plus updated `buildPluginSchemaYaml()` to emit policy fields and a `tables:` section for `parsePluginSchema()` compatibility.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Strip callback API from MockPluginBuilder (D-01 through D-03, D-06) | 978944c |
| 2 | Add policy builder methods and update buildPluginSchemaYaml() (D-04, D-05) | 978944c |

Both tasks were implemented in a single atomic commit as they modified the same file.

## What Was Built

### Removed (Task 1)
- `import type { PluginClaim } from '../../src/services/plugin-skill-invoker.js'` — broken import after phase 88 deletion
- `DiscoveryCallback`, `ChangeCallback` type definitions
- `SkillInvocation` interface
- `MockPluginBuilder` private fields: `discoveryCallback`, `changeCallback`
- `MockPluginBuilder` public fields: `discoveryInvocations`, `changeInvocations`
- `onDiscovered()` and `onChanged()` builder methods
- `invokeDiscovery` / `invokeChange` closure implementations in `build()`
- `build()` return type simplified to `{ manifest: PluginManifest; pluginId: string }`
- Factory functions: `errorThrowingPlugin()`, `slowPlugin()`, `errorChangePlugin()`

### Added (Task 2)
- `PluginSchemaPolicy` interface (exported) with `autoTrack`, `onMoved`, `onModified` fields
- `MockPluginBuilder` private fields: `autoTrackConfig`, `onMovedPolicy`, `onModifiedPolicy`
- `withAutoTrack(tableName, fieldMap?, template?)` builder method
- `withOnMoved('keep-tracking' | 'stop-tracking')` builder method
- `withOnModified('sync-fields' | 'ignore')` builder method
- `buildSchemaYaml()` convenience method on `MockPluginBuilder`
- `buildPluginSchemaYaml(manifest, policy?)` updated with optional policy param
- Tables section emission in YAML when `policy.autoTrack` is set
- Policy field emission (`on_added`, `track_as`, `template`, `field_map`, `on_moved`, `on_modified`) per document type

## Verification Results

- `grep "PluginClaim"` — 0 matches
- `grep "onDiscovered|onChanged|discoveryInvocations|..."` — 0 matches
- `grep "errorThrowingPlugin|slowPlugin|errorChangePlugin"` — 0 matches
- `grep "withAutoTrack|withOnMoved|withOnModified|stop-tracking|on_added: auto-track"` — 13 matches
- `grep "tables:"` — 4 matches
- `npx tsc --noEmit` — no errors for mock-plugins.ts
- `npm test` — 12 failed / 1111 total (same pre-existing failures, no new regressions)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None. The `PluginSchemaPolicy` interface is test-only with no security surface.

## Self-Check: PASSED

- `tests/helpers/mock-plugins.ts` exists and was committed at 978944c
- Commit 978944c verified in git log
