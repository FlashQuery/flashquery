---
phase: 90-centralize-frontmatter-field-names-into-fm-constants-and-ren
plan: "04"
subsystem: mcp-tools
tags: [fm-constants, rename, documents, compound, frontmatter]
dependency_graph:
  requires:
    - 90-01-SUMMARY.md
  provides:
    - documents.ts using FM constants (fq_* field names)
    - compound.ts using FM constants (fq_* field names)
  affects:
    - tests/unit/document-tools.test.ts
    - tests/unit/compound-tools.test.ts
tech_stack:
  added: []
  patterns:
    - FM constants bracket notation: data[FM.TITLE], parsed.data[FM.TAGS], etc.
key_files:
  created: []
  modified:
    - src/mcp/tools/documents.ts
    - src/mcp/tools/compound.ts
    - tests/unit/document-tools.test.ts
    - tests/unit/compound-tools.test.ts
decisions:
  - "insert_doc_link target title resolution missed in initial pass — fixed via Rule 1 (test failure caught it)"
  - "archive_document archivedFm spread also missed status key — fixed via Rule 1"
  - "documents.ts findMissingFile helper also had fm.fqc_id — fixed via Rule 1"
metrics:
  duration: "~2 hours (across 2 agent sessions)"
  completed: "2026-04-22"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 90 Plan 04: Update documents.ts and compound.ts with FM Constants Summary

Migrated all frontmatter key string literals in `documents.ts` (34 usages) and `compound.ts` (25 usages) to use FM constants from `src/constants/frontmatter-fields.ts`. Updated corresponding test files to use new `fq_*` field names in mock YAML strings and assertions. All tests pass (10 pre-existing deferred failures unrelated to this plan).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update documents.ts — 9+ locations with FM constants | 46ca2ca | src/mcp/tools/documents.ts, tests/unit/document-tools.test.ts |
| 2 | Update compound.ts — 16 locations with FM constants | bb9dffa | src/mcp/tools/compound.ts, tests/unit/compound-tools.test.ts |

## Verification

```
grep "import.*FM.*frontmatter-fields" src/mcp/tools/documents.ts src/mcp/tools/compound.ts
# → 2 matches (one per file)

grep -c "FM\." src/mcp/tools/documents.ts
# → 34+ matches

grep -c "FM\." src/mcp/tools/compound.ts
# → 25+ matches

npm test
# → 1103 passed, 10 failed (all 10 are pre-existing deferred failures)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] archive_document archivedFm spread used bare `status: 'archived'`**
- **Found during:** Task 1, test verification
- **Issue:** `archivedFm` spread had `status: 'archived'` (raw string key) alongside other FM.* keys
- **Fix:** Changed to `[FM.STATUS]: 'archived'` for consistency
- **Files modified:** src/mcp/tools/documents.ts
- **Commit:** 46ca2ca

**2. [Rule 1 - Bug] findMissingFile helper in documents.ts used `fm.fqc_id`**
- **Found during:** Task 1 grep scan
- **Issue:** Line 175 `fm.fqc_id === fqcId` not covered by the plan's Groups A-K
- **Fix:** Changed to `fm[FM.ID] === fqcId` with cast
- **Files modified:** src/mcp/tools/documents.ts
- **Commit:** 46ca2ca

**3. [Rule 1 - Bug] insert_doc_link target title read used `targetParsed.data.title`**
- **Found during:** Task 2, test verification (Tests 10, 11, 13, 14 failed)
- **Issue:** The `insert_doc_link` function reads the target file's frontmatter to get its title for the wikilink; this line was missed in the initial compound.ts pass. The test mocks had `fq_title: My Doc` but the code was reading `data.title` (undefined), falling back to filename
- **Fix:** Changed to `targetParsed.data[FM.TITLE]`
- **Files modified:** src/mcp/tools/compound.ts
- **Commit:** bb9dffa

## Test Impact

- **document-tools.test.ts:** All 63 tests updated and passing. Mock YAML strings updated from `title:`, `status:`, `tags:`, `fqc_id:` to `fq_title:`, `fq_status:`, `fq_tags:`, `fq_id:`. Assertions updated accordingly.
- **compound-tools.test.ts:** All compound tests passing. Mock YAML strings and assertions updated to `fq_*` names throughout. `writtenFrontmatter.tags` → `writtenFrontmatter['fq_tags']`, etc.

## Known Stubs

None — all frontmatter field accesses are wired to live FM constants with no placeholder values.

## Threat Flags

None — frontmatter field name changes are purely internal to vault writes. Supabase query column refs (`.eq('fqc_id')`, `.select('title')`) were intentionally left unchanged per the plan's BOUNDARY constraint.

## Self-Check: PASSED

- src/mcp/tools/documents.ts: FOUND
- src/mcp/tools/compound.ts: FOUND
- tests/unit/document-tools.test.ts: FOUND
- tests/unit/compound-tools.test.ts: FOUND
- Commit 46ca2ca: FOUND (git log verified)
- Commit bb9dffa: FOUND (git log verified)
- npm test: 1103/1113 passing; 10 pre-existing deferred failures confirmed unrelated to this plan
