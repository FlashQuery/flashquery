---
phase: 141-bm25-tool-search-help-pages-and-description-overrides
plan: 2
subsystem: search
tags: [tool-search, tool-meta, gray-matter, zod, vitest]
requires:
  - phase: 141-bm25-tool-search-help-pages-and-description-overrides
    provides: BM25 tool search and help convention context
provides:
  - TOOL_META loader and validator primitives for source-tree `.tool.md` pages
  - Diagnostic validation coverage for T-U-028 through T-U-033
affects: [tool-search, mcp-tools, help-pages]
tech-stack:
  added: []
  patterns:
    - Diagnostic-returning validators with throwing production loader wrappers
key-files:
  created:
    - src/services/tool-search/tool-meta.ts
    - tests/unit/tool-search/tool-meta.test.ts
  modified: []
key-decisions:
  - "Followed canonical requirements over generated plan text: help_hint remains optional and defaults to the verbatim default help hint."
  - "Kept startup/catalog enforcement unwired for this loader-only plan."
patterns-established:
  - "Tool metadata validation returns errors and warnings without throwing; loadToolMeta throws only after aggregating blocking errors."
requirements-completed: [REQ-090, REQ-091, REQ-094]
duration: 6min
completed: 2026-05-18
---

# Phase 141 Plan 2: Tool Metadata Loader Summary

**`.tool.md` loader primitives with strict frontmatter diagnostics and canonical help-hint defaults**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-18T16:26:30Z
- **Completed:** 2026-05-18T16:32:34Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Added `loadToolMeta()` over the fixed production glob `src/mcp/tools/*.tool.md`.
- Added `validateToolMeta()` for test fixtures and future startup enforcement, with blocking errors and non-blocking warnings.
- Covered T-U-028 through T-U-033, YAML parse failures, and the fixed production source-tree glob.

## Task Commits

1. **Task 1: Build validated TOOL_META loader primitives** - `4dce233` (`feat(141-02)`)
2. **Plan metadata** - pending at summary creation

## Files Created/Modified

- `src/services/tool-search/tool-meta.ts` - Loader, validator, diagnostics, `DEFAULT_HELP_HINT`, and fixed `.tool.md` glob.
- `tests/unit/tool-search/tool-meta.test.ts` - Unit coverage for missing name, filename/name mismatch, help suffix, duplicates, short-description warning, default help hint, parse failures, and loader path.
- `.planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-02-SUMMARY.md` - Execution summary.

## Decisions Made

- `help_hint` is optional because the canonical MCP Broker Requirements define it as optional with the default from REQ-094. This overrides the generated plan text that described it as required.
- `tier` and `args` are validated as required per the plan action because they do not conflict with the canonical default-help behavior.
- No startup enforcement or MCP registration wiring was added; Plan 141-11 owns that after the page corpus exists.

## Deviations from Plan

### Canonical Source Adjustment

**1. Canonical help_hint default**
- **Found during:** Task 1
- **Issue:** Generated plan text said `help_hint` was required, while MCP Broker Requirements REQ-090 and REQ-094 say it is optional and defaults to the canonical string.
- **Fix:** Implemented optional `help_hint` with `DEFAULT_HELP_HINT`.
- **Files modified:** `src/services/tool-search/tool-meta.ts`, `tests/unit/tool-search/tool-meta.test.ts`
- **Verification:** T-U-033 unit assertion.
- **Committed in:** `4dce233`

## Issues Encountered

- The required targeted test passed.
- A full `tsc --noEmit` sanity check was attempted and failed on pre-existing TypeScript errors outside this plan; no errors referenced `tool-meta` or `tool-search`.

## Known Stubs

None.

## Threat Flags

None. The new file access surface is the planned static source-tree read of `src/mcp/tools/*.tool.md` covered by T-141-03.

## User Setup Required

None.

## Next Phase Readiness

Later help-page and startup-enforcement plans can call `loadToolMeta()` and use the validated `ToolMeta` records for MCP descriptions, search help hints, and `help: true` dispatch.

## Self-Check: PASSED

- Found `src/services/tool-search/tool-meta.ts`
- Found `tests/unit/tool-search/tool-meta.test.ts`
- Found `.planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-02-SUMMARY.md`
- Found task commit `4dce233`

---
*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Completed: 2026-05-18*
