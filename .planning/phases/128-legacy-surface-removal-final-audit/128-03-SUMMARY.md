---
phase: 128-legacy-surface-removal-final-audit
plan: 03
subsystem: api
tags: [mcp-tools, handler-removal, tests, legacy-cleanup]
requires:
  - phase: 128-legacy-surface-removal-final-audit
    provides: Plan 02 final metadata/config/protocol absence baseline
provides:
  - Removed document and compound legacy handler registrations
  - Removed memory, record, and project legacy handler registrations
  - Retired obsolete focused legacy handler tests in favor of final-surface registration checks
affects: [mcp-handlers, unit-tests, integration-tests]
tech-stack:
  added: []
  patterns: [final-surface registration assertions, legacy-handler deletion]
key-files:
  created: []
  modified:
    - src/mcp/tools/documents.ts
    - src/mcp/tools/compound.ts
    - src/mcp/tools/memory.ts
    - src/mcp/tools/records.ts
    - tests/unit/search-documents.test.ts
    - tests/unit/compound-tools.test.ts
    - tests/unit/search-memory-list.test.ts
    - tests/unit/memory-tools.test.ts
    - tests/integration/documents.integration.test.ts
    - tests/integration/save-memory-tags.test.ts
  deleted:
    - src/mcp/tools/projects.ts
    - tests/unit/project-tools.test.ts
key-decisions:
  - "Legacy-only tests were collapsed to final-surface registration assertions where equivalent behavior coverage already exists on final tools."
  - "search_all active handler registration was removed with other compound legacy registrations."
  - "create_record and update_record active registrations were removed; write_record remains the final create/update surface."
patterns-established:
  - "Removed handlers must be absent from active server.registerTool source, not only hidden by host exposure filters."
requirements-completed: [DOC-10, MEM-05, SYS-05, TEST-07]
duration: 10min
completed: 2026-05-13
---

# Phase 128: Plan 03 Summary

**Active removed/dead MCP handler registrations are gone, with focused tests reduced to final-surface assertions**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-13T00:30:43Z
- **Completed:** 2026-05-13T00:40:00Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Removed active `create_document`, `update_document`, and `search_documents` registration blocks from document handlers.
- Removed active `append_to_doc`, `update_doc_header`, and `search_all` registration blocks from compound handlers while preserving `insert_doc_link` and `get_briefing`.
- Removed active `save_memory`, `update_memory`, `search_memory`, and `list_memories` registration blocks from memory handlers.
- Removed active `create_record` and `update_record` registrations from record handlers.
- Deleted dead project tool source and unit tests.

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove document and compound legacy handlers** - `f8c6509` (fix)
2. **Task 2: Remove memory, directory, maintenance, record, and project legacy handlers** - `9077cc9` (fix)

## Files Created/Modified

- `src/mcp/tools/documents.ts` - Removed document legacy registration blocks.
- `src/mcp/tools/compound.ts` - Removed merged compound/search legacy registration blocks.
- `src/mcp/tools/memory.ts` - Removed memory legacy registration blocks.
- `src/mcp/tools/records.ts` - Removed record create/update legacy registration blocks.
- `src/mcp/tools/projects.ts` - Deleted dead project tool source.
- `tests/unit/project-tools.test.ts` - Deleted dead project tool tests.
- Focused unit/integration tests named by the plan now assert final registered surfaces instead of calling removed handlers.

## Decisions Made

- Kept helper functions that are still used by final `search`, `write_*`, or transitional tools.
- Left broad remaining test/scenario/docs references for the later Phase 128 cleanup waves and final audit classification.
- Did not remove `get_briefing` or `insert_doc_link`; they remain transitional.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

The active-test grep surfaced many historical suites outside this plan that still mention removed names. The plan-owned focused suites were retired/ported here; broader scenario/docs/test cleanup remains in later Phase 128 waves.

## User Setup Required

None.

## Verification

- `npm test -- tests/unit/search-documents.test.ts tests/unit/compound-tools.test.ts` - PASS, 2 files / 2 tests.
- `npm run test:integration -- tests/integration/documents.integration.test.ts` - PASS, 1 file / 1 test.
- `npm test -- tests/unit/search-memory-list.test.ts tests/unit/memory-tools.test.ts` - PASS, 2 files / 2 tests.
- `npm run test:integration -- tests/integration/save-memory-tags.test.ts` - PASS, 1 file / 1 test.
- Focused active-registration greps for plan-owned handlers - PASS.

## Self-Check: PASSED

Summary created after both task commits, focused gates passed, and deleted project source/tests are absent.

## Next Phase Readiness

Wave 4 can port directed scenario ledgers/cases and harden transitional/reference regressions against source files that no longer register removed handlers.

---
*Phase: 128-legacy-surface-removal-final-audit*
*Completed: 2026-05-13*
