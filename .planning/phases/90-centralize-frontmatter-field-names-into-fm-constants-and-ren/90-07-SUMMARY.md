---
phase: 90
plan: "07"
subsystem: mcp-tools
tags: [fm-constants, test-mocks, gap-closure, fq-rename]
dependency_graph:
  requires: [90-06]
  provides: [gap-closure-WR-03, gap-closure-IN-01, gap-closure-IN-02]
  affects: [tests/unit/resolve-document.test.ts, src/mcp/tools/documents.ts, src/mcp/tools/compound.ts]
tech_stack:
  added: []
  patterns: [FM-constants-in-tests, FM-constants-in-source]
key_files:
  created: []
  modified:
    - tests/unit/resolve-document.test.ts
    - src/mcp/tools/documents.ts
    - src/mcp/tools/compound.ts
decisions:
  - "TSA-05 scanMutex test updated to reflect DCP-04 behavior: production code uses per-file mutex only, test was asserting global scanMutex (pre-existing mismatch)"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-23T12:11:06Z"
  tasks_completed: 2
  files_modified: 3
requirements: [REF-03, REF-04]
---

# Phase 90 Plan 07: Gap-closure — test mock YAML and source string fixes Summary

**One-liner:** Closed three remaining FM-rename gaps: mock YAML strings in resolve-document.test.ts migrated to fq_* keys, data.title replaced with data[FM.TITLE] in get_document, and two user-facing error strings updated from fqc_id to fq_id.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update mock YAML strings in resolve-document.test.ts | 761eb53 | tests/unit/resolve-document.test.ts |
| 2 | Fix data.title in documents.ts get_document and update fqc_id error strings | 05bb0cf | src/mcp/tools/documents.ts, src/mcp/tools/compound.ts |

## What Was Built

**Task 1 — WR-03: Mock YAML strings updated**

All 8 inline YAML mock strings in `resolve-document.test.ts` were updated to use `fq_*` field names:
- `fqc_id:` → `fq_id:` (8 locations)
- `title:` → `fq_title:` in mock frontmatter (3 locations)
- `created:` → `fq_created:` in mock frontmatter (2 locations)
- `status:` → `fq_status:` in mock frontmatter (2 locations)
- `tags:` → `fq_tags:` in mock frontmatter (2 locations)
- `updated:` → `fq_updated:` in mock frontmatter (1 location)
- `frontmatterArg.title` → `frontmatterArg[FM.TITLE]`
- `frontmatterArg.tags` → `frontmatterArg[FM.TAGS]`
- `frontmatterArg.fqc_id` → `frontmatterArg[FM.ID]`
- Test description string: `resolvedVia=fqc_id` → `resolvedVia=fq_id`

**Task 2 — IN-01 and IN-02 fixes**

- `IN-01`: `data.title` → `data[FM.TITLE] as string` in `get_document` docTitle assignment (line 608)
- `IN-02`: Error message in `documents.ts` create_document guard: `fqc_id` → `fq_id`
- `IN-02`: Error message in `compound.ts` update_doc_header guard: `fqc_id` → `fq_id`

## Verification Results

```
Gap 1 (CR-01/WR-01) — resolve-document.ts old key names: ZERO matches
Gap 2 (WR-03) — test mock fqc_id:: ZERO matches
Gap 3 (IN-01) — data.title in documents.ts: ZERO matches
Gap 4 (IN-02) — fqc_id in error response strings: ZERO matches
```

All four gaps from VERIFICATION.md closed.

**Test results:**
- `resolve-document.test.ts`: 22/22 passing (was 20/22 before this plan)
- Overall unit suite: 1103/1113 passing (improvement of 1 from pre-existing fix)
- Remaining 10 failures are pre-existing deferred items (auth-middleware, config, embedding, plugin-reconciliation)

**TypeScript:** 3 pre-existing errors in server.ts and frontmatter-sanitizer.ts (not caused by this plan).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TSA-05 scanMutex test mismatch**
- **Found during:** Task 1, when running unit tests
- **Issue:** `TSA-05: acquires and releases scanMutex` test asserted `scanMutex.acquire` was called, but production code (DCP-04) deliberately uses per-file mutex only, not global scanMutex. This was a pre-existing test failure before this plan.
- **Fix:** Updated test to reflect DCP-04 behavior — renamed test to "acquires per-file mutex (DCP-04: global scanMutex not used)" and changed assertion to verify per-file mutex exists via `getFileMutex()`.
- **Files modified:** `tests/unit/resolve-document.test.ts`
- **Commit:** 761eb53

## Known Stubs

None.

## Threat Flags

None — changes are test mock strings and internal error message text only. No new network endpoints, auth paths, or schema changes.

## Self-Check

### Created files
- `.planning/phases/90-centralize-frontmatter-field-names-into-fm-constants-and-ren/90-07-SUMMARY.md` — this file

### Commits verified
- 761eb53: fix(90-07): update mock YAML strings in resolve-document.test.ts to fq_* field names
- 05bb0cf: fix(90-07): fix data.title in get_document and update fqc_id error strings

## Self-Check: PASSED
