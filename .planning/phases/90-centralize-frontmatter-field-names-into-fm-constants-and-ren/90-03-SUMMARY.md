---
phase: 90-centralize-frontmatter-field-names-into-fm-constants-and-ren
plan: "03"
subsystem: scanner
tags: [scanner, frontmatter, fm-constants, fq-rename]
dependency_graph:
  requires:
    - src/constants/frontmatter-fields.ts  # FM constants (from Plan 01)
  provides:
    - src/services/scanner.ts (updated — reads fq_* frontmatter field names via FM constants)
  affects:
    - All vault documents scanned by the background scanner
    - repairFrontmatter writes (now use fq_* field names)
tech_stack:
  added: []
  patterns:
    - "bracket notation frontmatter[FM.KEY] for dynamic key access on Record<string, unknown>"
    - "new RegExp(template literal) for dynamic regex from FM constant"
key_files:
  created: []
  modified:
    - src/services/scanner.ts
decisions:
  - "Use bracket notation (frontmatter[FM.ID]) throughout — frontmatter type is Record<string, unknown> so dot-notation on dynamic keys is not valid TypeScript"
  - "Dynamic regex new RegExp(`\\b${FM.ID}:\\s*([^\\s\\n]+)`) replaces hardcoded /\\bfqc_id:/ — functionally equivalent, now driven by FM constant"
  - "DB SQL column references (AND column_name = 'fqc_id', .eq('fqc_id', ...)) left unchanged — they reference Supabase schema columns, not frontmatter keys"
  - "repairFrontmatter uses existingFrontmatter[FM.TITLE] (not existingFrontmatter.title) to read existing title in the new fq_title field"
metrics:
  duration: "~4 minutes"
  completed: "2026-04-23"
  tasks_completed: 1
  files_created: 0
  files_modified: 1
---

# Phase 90 Plan 03: scanner.ts FM Constants Update Summary

scanner.ts updated to use FM constants (from `src/constants/frontmatter-fields.ts`) for all frontmatter key string accesses — 17 changes across 10 locations covering the regex recovery path, frontmatter property reads, DB insert/update column values, and the repairFrontmatter write-back block.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add FM import and replace all frontmatter key strings | 58f353b | src/services/scanner.ts |

## Verification Results

- `grep "import.*FM.*frontmatter-fields" src/services/scanner.ts` — 1 match (line 16)
- `grep "new RegExp.*FM\.ID" src/services/scanner.ts` — 1 match (dynamic regex at line 428)
- `grep -c "FM\.ID" src/services/scanner.ts` — 5 lines (6 usages; line 449 has 2 usages)
- `grep -c "FM\.STATUS\|FM\.TITLE\|FM\.CREATED\|FM\.OWNER\|FM\.TYPE\|FM\.INSTANCE" src/services/scanner.ts` — 17 matches
- `grep "frontmatter\.fqc_id\|frontmatter\.fqc_owner\|frontmatter\.fqc_type\|frontmatter\.title\b\|frontmatter\.created\b\|frontmatter\.status\b" src/services/scanner.ts` — 0 matches
- `grep "AND column_name = 'fqc_id'" src/services/scanner.ts` — 1 match (DB boundary, unchanged)
- `npm test` — 10 failures (all pre-existing, same count as baseline before changes)

## Change Locations Summary

| Location | Before | After |
|----------|--------|-------|
| Line 162 | `vaultFrontmatter['status']` | `vaultFrontmatter[FM.STATUS]` |
| Line 428 | `/\bfqc_id:\s*([^\s\n]+)/` | `new RegExp(\`\\b${FM.ID}:\\s*([^\\s\\n]+)\`)` |
| Line 444 | `fqc_id: recoveredFqcId` | `[FM.ID]: recoveredFqcId` |
| Lines 449-450 | `frontmatter.fqc_id` (x2) | `frontmatter[FM.ID]` (x2) |
| Line 468 | `frontmatter.title` | `frontmatter[FM.TITLE]` |
| Line 471 | `frontmatter.fqc_owner` | `frontmatter[FM.OWNER]` |
| Line 472 | `frontmatter.fqc_type` | `frontmatter[FM.TYPE]` |
| Lines 515-517, 644-646, 749-751, 793, 834-836 | `frontmatter.status`, `frontmatter.created` | `frontmatter[FM.STATUS]`, `frontmatter[FM.CREATED]` |
| Lines 1129-1133 (repairFrontmatter) | `fqc_id:`, `title:`, `created:`, `status:`, `fqc_instance:` | `[FM.ID]:`, `[FM.TITLE]:`, `[FM.CREATED]:`, `[FM.STATUS]:`, `[FM.INSTANCE]:` |

## Deviations from Plan

None — plan executed exactly as written. All 10+ frontmatter key string locations updated. DB column references (SQL strings) left unchanged as required.

## Known Stubs

None. All changes are functional — scanner.ts now reads and writes fq_* frontmatter field names via FM constants throughout.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The dynamic regex change (T-90-04) is functionally equivalent — UUID extraction is not weakened. repairFrontmatter write-back (T-90-05) uses server-controlled values; user cannot inject field names through this path. Both threats accepted per plan threat model.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/services/scanner.ts modified | FOUND |
| FM import at line 16 | FOUND |
| dynamic regex new RegExp FM.ID | FOUND |
| repairFrontmatter uses FM constants | FOUND |
| DB column SQL strings unchanged | VERIFIED |
| Commit 58f353b | FOUND |
| npm test no new failures (10 pre-existing, 10 post-change) | VERIFIED |
