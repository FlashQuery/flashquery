---
phase: 141-bm25-tool-search-help-pages-and-description-overrides
plan: 11
subsystem: mcp
tags: [tool-search, tool-meta, mcp, native-tools]
requires:
  - phase: 141-bm25-tool-search-help-pages-and-description-overrides
    provides: "Plans 141-02, 141-04, 141-09, and 141-10 created the TOOL_META loader and help-page corpus."
provides:
  - "Startup loads .tool.md metadata before native tool registration."
  - "Native catalog descriptions prefer .tool.md frontmatter descriptions."
  - "Registered native tools fail validation when help metadata is missing."
affects: [mcp-server, native-tool-catalog, tool-search]
tech-stack:
  added: []
  patterns: [synchronous-startup-metadata-load, immutable-tool-meta-registry]
key-files:
  created:
    - .planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-11-SUMMARY.md
  modified:
    - src/services/tool-search/tool-meta.ts
    - src/mcp/tool-catalog.ts
    - src/mcp/server.ts
    - tests/unit/tool-search/tool-meta.test.ts
    - tests/unit/native-tool-catalog.test.ts
key-decisions:
  - "Kept createMcpServer synchronous by adding loadToolMetaSync alongside the async loader."
  - "Kept tool metadata immutable at startup; no watcher or hot-reload path was added."
patterns-established:
  - "createMcpServer loads TOOL_META once and passes it to catalog capture."
  - "Startup validation uses the final registered catalog, not a static guessed tool list."
requirements-completed: [REQ-089, REQ-092, REQ-095, REQ-099]
duration: 12min
completed: 2026-05-18
---

# Phase 141-11: TOOL_META Startup Wiring Summary

**Startup now loads validated `.tool.md` metadata once, feeds native registration descriptions, and fails when registered tools lack help metadata.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-18T16:46:00Z
- **Completed:** 2026-05-18T16:58:22Z
- **Tasks:** 1
- **Files modified:** 5

## Accomplishments

- Added a synchronous production metadata loader for startup use.
- Wired `createMcpServer` to load TOOL_META before native registration and validate the final native catalog.
- Updated catalog capture so live native tool descriptions prefer `.tool.md` frontmatter.
- Added focused unit coverage for production metadata loading, missing-page failures, and catalog description substitution.

## Task Commits

1. **Task 1: Enforce TOOL_META at startup and registration** - `4dfaf31` (feat)

## Files Created/Modified

- `src/services/tool-search/tool-meta.ts` - Added `loadToolMetaSync` and registered-catalog metadata assertion.
- `src/mcp/tool-catalog.ts` - Accepts startup TOOL_META and uses it for registered descriptions.
- `src/mcp/server.ts` - Loads metadata once and validates registered native tools before schema caching.
- `tests/unit/tool-search/tool-meta.test.ts` - Covers production corpus loading and missing registered metadata failures.
- `tests/unit/native-tool-catalog.test.ts` - Covers `.tool.md` descriptions in native catalog startup.

## Decisions Made

- Added a sync loader rather than changing `createMcpServer` to async because server construction is used synchronously across startup and unit tests.
- Validated against the actual captured native catalog so future native registrations must add `.tool.md` metadata automatically.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Agent thread limit prevented spawning a subagent for this plan, so the orchestrator executed it inline using the same plan gates.

## User Setup Required

None - no external service configuration required.

## Verification

- `npm test -- --run tests/unit/tool-search/tool-meta.test.ts tests/unit/native-tool-catalog.test.ts` - passed, 2 files and 15 tests.
- `rg -n "watch|fs\\.watch|chokidar|hot.?reload" src/services/tool-search src/mcp/tool-catalog.ts src/mcp/server.ts` - no matches.

## Next Phase Readiness

Plans 141-05 and later can now consume validated TOOL_META for `fq.search_tools`, native help hints, and registration descriptions.

---
*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Completed: 2026-05-18*
