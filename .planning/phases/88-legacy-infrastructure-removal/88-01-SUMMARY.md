---
phase: 88-legacy-infrastructure-removal
plan: "01"
subsystem: scanner, vault, plugin-reconciliation, frontmatter-utils
tags: [legacy-removal, refactor, dependency-severance]
dependency_graph:
  requires: []
  provides:
    - src/utils/frontmatter.ts exports atomicWriteFrontmatter
    - plugin-reconciliation.ts free of document-ownership.ts dependency
    - scanner.ts free of discoveryQueue/needs_discovery writes
  affects:
    - src/storage/vault.ts
    - src/services/plugin-reconciliation.ts
    - src/services/scanner.ts
tech_stack:
  added: []
  patterns:
    - re-export-from pattern for shared utility (vault.ts → utils/frontmatter.ts)
    - inlined supabase call replacing document-ownership.ts abstraction
key_files:
  created:
    - src/utils/frontmatter.ts
  modified:
    - src/storage/vault.ts
    - src/services/plugin-reconciliation.ts
    - src/services/scanner.ts
    - tests/unit/scanner.test.ts
decisions:
  - "atomicWriteFrontmatter extracted to src/utils/frontmatter.ts verbatim from vault.ts"
  - "vault.ts uses re-export-from pattern so existing importers continue to work"
  - "plugin-reconciliation.ts ownership update inlined as direct supabase call"
  - "4 Discovery Queue Building unit tests removed from scanner.test.ts (tested deleted code)"
  - "DiscoveryQueueItem still referenced in discovery-coordinator.ts/discovery-orchestrator.ts — both deleted in Plan 02"
metrics:
  duration: "323 seconds"
  completed_date: "2026-04-21T11:41:48Z"
  tasks_completed: 3
  files_changed: 5
---

# Phase 88 Plan 01: Dependency Severance (Pre-deletion Prep) Summary

**One-liner:** Extracted `atomicWriteFrontmatter` to `src/utils/frontmatter.ts`, severed `plugin-reconciliation.ts` from `document-ownership.ts`, and removed `discoveryQueue`/`needs_discovery` infrastructure from `scanner.ts`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create src/utils/frontmatter.ts | 473a06d | src/utils/frontmatter.ts (new) |
| 2 | Update vault.ts and plugin-reconciliation.ts | 40a3c43 | src/storage/vault.ts, src/services/plugin-reconciliation.ts |
| 3 | Remove discoveryQueue block from scanner.ts | ce2c3fe | src/services/scanner.ts, tests/unit/scanner.test.ts |

## What Was Built

### Task 1 — src/utils/frontmatter.ts (new)

New canonical home for `atomicWriteFrontmatter()`. Copied verbatim from `src/storage/vault.ts` lines 253-288. Imports `node:fs/promises`, `gray-matter`, and `logger`. Single export only.

### Task 2 — vault.ts and plugin-reconciliation.ts

**vault.ts:** Replaced the 64-line `atomicWriteFrontmatter` implementation with a single re-export-from line:
```typescript
export { atomicWriteFrontmatter } from '../utils/frontmatter.js';
```
Existing importers of vault.ts continue to work unchanged.

**plugin-reconciliation.ts:** Three changes:
1. Import `atomicWriteFrontmatter` from `../utils/frontmatter.js` (not vault.ts)
2. Import `vaultManager` from `../storage/vault.js` separately
3. Remove `import { updateDocumentOwnership } from './document-ownership.js'` — dependency severed
4. Replace `updateDocumentOwnership(...)` call with inlined supabase update:
   ```typescript
   await supabase.from('fqc_documents').update({
     ownership_plugin_id: pluginId,
     ownership_type: doc.typeId,
     updated_at: new Date().toISOString(),
   }).eq('id', doc.fqcId);
   ```

### Task 3 — scanner.ts cleanup

Removed all discoveryQueue infrastructure:
- `DiscoveryQueueItem` interface (8 lines)
- `discoveryQueue: DiscoveryQueueItem[]` field from `ScanResult`
- `discoveryQueue: []` from early-return object
- Entire DISC-04 try/catch block (~40 lines) including `needs_discovery: true` write
- `discoveryQueue` from return statement
- `getFolderClaimsMap` import (only used in deleted block)

Also removed 4 corresponding unit tests from `tests/unit/scanner.test.ts` (the "Discovery Queue Building" describe block) that tested the now-deleted functionality.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed Discovery Queue Building unit tests from scanner.test.ts**
- **Found during:** Task 3 verification (`npm test`)
- **Issue:** 4 tests in `tests/unit/scanner.test.ts` tested `discoveryQueue` behavior that was just removed from scanner.ts — they would fail after Task 3 changes
- **Fix:** Removed the entire `describe('Discovery Queue Building', ...)` block (lines 1528-1785) from scanner.test.ts
- **Files modified:** `tests/unit/scanner.test.ts`
- **Commit:** ce2c3fe (included in Task 3 commit)

## Test Results

`npm test` exits with pre-existing failures only (13 failures in 6 files — deferred per milestone baseline). Scanner tests: all pass. No new failures introduced.

Pre-existing failures (unchanged from baseline):
- tests/unit/auth-middleware.test.ts (6 failures)
- tests/unit/config.test.ts (2 failures)
- tests/unit/embedding.test.ts (1 failure)
- tests/unit/pending-plugin-review.test.ts (1 failure)
- tests/unit/plugin-reconciliation.test.ts (1 failure)
- tests/unit/record-tools.test.ts (1 failure)
- tests/unit/resolve-document.test.ts (1 failure)

## Known Stubs

None. All changes are functional removals or redirections.

## Threat Flags

None. `atomicWriteFrontmatter` was copied verbatim — no new trust boundaries or surface.

## Self-Check: PASSED

- src/utils/frontmatter.ts: FOUND
- src/storage/vault.ts: FOUND
- src/services/plugin-reconciliation.ts: FOUND
- src/services/scanner.ts: FOUND
- Commit 473a06d: FOUND
- Commit 40a3c43: FOUND
- Commit ce2c3fe: FOUND
