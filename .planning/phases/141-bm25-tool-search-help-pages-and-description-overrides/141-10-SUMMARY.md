---
phase: 141-bm25-tool-search-help-pages-and-description-overrides
plan: 10
subsystem: mcp-tool-search
tags: [tool-search, help-pages, tool-meta, bm25, mcp]
requires:
  - phase: 141-bm25-tool-search-help-pages-and-description-overrides
    provides: [tool metadata loader and previous help-page batches]
provides:
  - Valid .tool.md pages for LLM, macro, vault, editing, directory, maintenance, and search_tools surfaces
  - Unit coverage for the 141-10 help-page subset
  - Exact call_macro canonical description and help_hint assertions
affects: [tool-meta, search_tools, help-true, native-tool-docs]
tech-stack:
  added: []
  patterns: [one .tool.md page per native tool, batch-level metadata validation]
key-files:
  created:
    - src/mcp/tools/call_macro.tool.md
    - src/mcp/tools/call_model.tool.md
    - src/mcp/tools/get_briefing.tool.md
    - src/mcp/tools/get_llm_usage.tool.md
    - src/mcp/tools/insert_doc_link.tool.md
    - src/mcp/tools/insert_in_doc.tool.md
    - src/mcp/tools/list_vault.tool.md
    - src/mcp/tools/maintain_vault.tool.md
    - src/mcp/tools/manage_directory.tool.md
    - src/mcp/tools/move_document.tool.md
    - src/mcp/tools/remove_document.tool.md
    - src/mcp/tools/replace_doc_section.tool.md
    - src/mcp/tools/search_tools.tool.md
  modified:
    - tests/unit/tool-search/tool-meta.test.ts
key-decisions:
  - "Preserved call_macro description from corpus-flashquery.md and call_macro help_hint from Native Tool Search §9.8.5 verbatim."
  - "Kept search_tools documentation focused on the SearchResult envelope and native-only help fields required by REQ-082 and REQ-083."
patterns-established:
  - "Help-page batches share validation through expectHelpPageBatch while adding subset-specific assertions."
requirements-completed: [REQ-089, REQ-091, REQ-092, REQ-097]
duration: 5m22s
completed: 2026-05-18T16:54:30Z
---

# Phase 141 Plan 10: LLM, Macro, Vault, Editing, And Search Tools Help Pages Summary

**Validated `.tool.md` pages for LLM, macro, vault/editing, directory, maintenance, and `search_tools` surfaces with canonical `call_macro` strings protected by unit tests.**

## Performance

- **Duration:** 5m22s
- **Started:** 2026-05-18T16:49:08Z
- **Completed:** 2026-05-18T16:54:30Z
- **Tasks:** 1
- **Files modified:** 14

## Accomplishments

- Created valid help pages for all 13 tools in the 141-10 batch with required frontmatter and body sections.
- Preserved the canonical `call_macro` description and help hint exactly in `call_macro.tool.md`.
- Documented `search_tools` parameters, `SearchResult`, `score`, `normalizedScore`, `has_help`, `help_hint`, and empty-result behavior.
- Extended `tests/unit/tool-search/tool-meta.test.ts` without replacing prior batch coverage.

## Task Commits

1. **Task 1: Author LLM, macro, vault, editing, and search_tools help pages** - `d08768c` (docs)

**Plan metadata:** this summary commit

## Files Created/Modified

- `src/mcp/tools/call_macro.tool.md` - Canonical macro description/help hint plus macro language help.
- `src/mcp/tools/call_model.tool.md` - LLM model/purpose call help.
- `src/mcp/tools/get_briefing.tool.md` - Transitional briefing helper help.
- `src/mcp/tools/get_llm_usage.tool.md` - LLM usage inspection help.
- `src/mcp/tools/insert_doc_link.tool.md` - Transitional relationship-link helper help.
- `src/mcp/tools/insert_in_doc.tool.md` - Heading-aware insertion help.
- `src/mcp/tools/list_vault.tool.md` - Vault listing help.
- `src/mcp/tools/maintain_vault.tool.md` - Vault maintenance help.
- `src/mcp/tools/manage_directory.tool.md` - Directory management help.
- `src/mcp/tools/move_document.tool.md` - Document move/rename help.
- `src/mcp/tools/remove_document.tool.md` - Document removal lifecycle help.
- `src/mcp/tools/replace_doc_section.tool.md` - Section replacement/deletion help.
- `src/mcp/tools/search_tools.tool.md` - Tool-search help with required envelope fields.
- `tests/unit/tool-search/tool-meta.test.ts` - Added 141-10 batch validation plus canonical string/search_tools assertions.

## Decisions Made

The plan and REQ-097 pointed to `corpus-flashquery.md` for both `call_macro` strings, but that file contains the canonical description and only the help argument wording. Native Tool Search §9.8.5 contains the canonical `help_hint` and explicitly says it is the production frontmatter value. I used the corpus description and Native Tool Search §9.8.5 help hint verbatim, and protected both in tests.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Canonical source ambiguity for `call_macro.help_hint`: resolved by following Native Tool Search §9.8.5, which is the detailed implementation reference linked by the MCP Broker requirements.

## Verification

- `npm test -- --run tests/unit/tool-search/tool-meta.test.ts` - PASS, 1 file passed, 11 tests passed.
- Source assertion: `call_macro.tool.md` description and help hint match canonical strings - PASS.
- Source assertion: `search_tools.tool.md` includes `query`, `limit`, `SearchResult`, `score`, `normalizedScore`, `has_help`, and `help_hint` - PASS.
- Content assertion: each listed help body includes Purpose, Params, Returns, Examples, Gotchas, and Related Tools - PASS.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The 141-10 help-page batch is ready for downstream `TOOL_META`, `help: true`, and `search_tools` integration work. No blockers remain for this plan.

## Self-Check: PASSED

- Created/modified files exist on disk.
- Task commit `d08768c` exists in git history.
- Required focused unit test passes.

---
*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Completed: 2026-05-18T16:54:30Z*
