---
phase: 90-centralize-frontmatter-field-names-into-fm-constants-and-ren
plan: "02"
subsystem: frontmatter
tags: [frontmatter, constants, fm-fields, ordering, sanitizer]
dependency_graph:
  requires:
    - src/constants/frontmatter-fields.ts (from 90-01)
  provides:
    - src/mcp/utils/frontmatter-sanitizer.ts (user-first ordering, FM constants)
    - src/utils/frontmatter.ts (FM.UPDATED key)
    - src/storage/vault.ts (FM.ID, FM.STATUS in extractMinimalFrontmatter)
    - src/services/plugin-reconciliation.ts (FM.OWNER, FM.TYPE read/write)
    - src/mcp/utils/resolve-document.ts (typeof FM.ID type, FM.ID runtime)
  affects:
    - Plans 90-03 and 90-04 (scanner, documents, compound) consume these updated files
    - Plan 90-05 will fix the tests that now fail due to old field name assertions
tech_stack:
  added: []
  patterns:
    - "FM constants imported and used in place of string literals throughout"
    - "User-defined fields first, FQ-managed fields after (loop order inversion)"
    - "typeof FM.ID for type-safe resolvedVia union narrowing"
key_files:
  created: []
  modified:
    - src/mcp/utils/frontmatter-sanitizer.ts
    - src/utils/frontmatter.ts
    - src/storage/vault.ts
    - src/services/plugin-reconciliation.ts
    - src/mcp/utils/resolve-document.ts
decisions:
  - "FM.OWNER, FM.TYPE, FM.INSTANCE added to BOTH internalFields AND preserveOrder in frontmatter-sanitizer.ts — internalFields prevents them appearing in the user-fields loop (double-output guard)"
  - "Loop order inverted in serializeOrderedFrontmatter: user-defined fields first, FQ-managed fields after — this is the core ordering enforcement required by SPEC-18"
  - "resolve-document.ts targetedScan still reads parsed.data.fqc_id directly — this is reading disk file frontmatter which still uses old names; Plans 03/04 will address scanner-level field reads"
metrics:
  duration: "~6 minutes"
  completed: "2026-04-23"
  tasks_completed: 2
  files_created: 0
  files_modified: 5
---

# Phase 90 Plan 02: Update 5 Source Files with FM Constants Summary

5 source files updated to import FM and replace all string literals with FM constant references; critical loop-order inversion in frontmatter-sanitizer.ts (user fields first) applied; internalFields set expanded with FM.OWNER/TYPE/INSTANCE double-output guard.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite frontmatter-sanitizer.ts — invert loop order and use FM constants | 90606e1 | src/mcp/utils/frontmatter-sanitizer.ts |
| 2 | Update frontmatter.ts, vault.ts, plugin-reconciliation.ts, resolve-document.ts | 603e2aa | src/utils/frontmatter.ts, src/storage/vault.ts, src/services/plugin-reconciliation.ts, src/mcp/utils/resolve-document.ts |

## Verification Results

- `grep "import.*FM.*frontmatter-fields" [5 files]` — 5/5 matches confirmed
- `grep "FM.OWNER" src/mcp/utils/frontmatter-sanitizer.ts` — 2 matches (internalFields + preserveOrder)
- `grep "FM.UPDATED" src/utils/frontmatter.ts` — 1 match (`[FM.UPDATED]: new Date().toISOString()`)
- `grep "FM.ID\|FM.STATUS" src/storage/vault.ts` — 2 matches in extractMinimalFrontmatter
- `grep "FM.OWNER\|FM.TYPE" src/services/plugin-reconciliation.ts` — 3 matches (1 read, 2 writes)
- `grep "typeof FM.ID" src/mcp/utils/resolve-document.ts` — 1 match in type definition
- `grep "FM.ID" src/mcp/utils/resolve-document.ts` — 2 matches (type + runtime)
- `npm test` — 1100/1113 pass; 13 failures: 11 pre-existing + 2 expected new failures (RECON-05 and resolve-document UUID test, both fixed in Plan 05)

## Deviations from Plan

None — plan executed exactly as written. The 2 new test failures (plugin-reconciliation RECON-05 expecting `fqc_owner`/`fqc_type`; resolve-document expecting `'fqc_id'` string) are explicitly documented in the plan as expected failures to be resolved in Plan 05.

## Known Stubs

None — all changes are complete implementations, not stubs.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Changes are internal constant substitutions only. Threat T-90-02 (internalFields set prevents DB-only field leakage) maintained — FM.OWNER, FM.TYPE, FM.INSTANCE added to internalFields as required. Threat T-90-03 (plugin-reconciliation write guard) maintained — existingFm[FM.OWNER] guard check preserved with same logic.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/mcp/utils/frontmatter-sanitizer.ts — FM import | FOUND |
| src/utils/frontmatter.ts — FM import + FM.UPDATED | FOUND |
| src/storage/vault.ts — FM import + FM.ID + FM.STATUS | FOUND |
| src/services/plugin-reconciliation.ts — FM import + FM.OWNER + FM.TYPE | FOUND |
| src/mcp/utils/resolve-document.ts — FM import + typeof FM.ID + FM.ID | FOUND |
| Commit 90606e1 (Task 1) | FOUND |
| Commit 603e2aa (Task 2) | FOUND |
| Loop order inverted in frontmatter-sanitizer.ts (user fields first) | CONFIRMED |
| internalFields includes FM.OWNER, FM.TYPE, FM.INSTANCE | CONFIRMED |
