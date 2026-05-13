# Plan 128-04 Summary

## Status

Completed.

## Changes

- Added `test_phase128_legacy_surface` to assert removed/dead MCP tool names are absent from `tools/list` while final and transitional tools remain present.
- Ported directed scenario cases for cross-type search, memory search/list coverage, and briefing setup to final tools (`write_document`, `write_memory`, `search`, `get_memory`, `maintain_vault`).
- Removed the legacy `tests/scenarios/mcp/search_documents.py` helper.
- Added Phase 128 legacy-surface rows to directed and integration coverage ledgers.
- Classified existing ledger/tooling references to removed names as legacy migration evidence so active coverage no longer presents them as current public behavior.

## Verification

- `grep -q "legacy_surface" tests/scenarios/directed/DIRECTED_COVERAGE.md && grep -q "legacy_surface_final_audit" tests/scenarios/integration/INTEGRATION_COVERAGE.md`
- `! rg -n "\b(append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)\b" tests/scenarios/directed/DIRECTED_COVERAGE.md tests/scenarios/integration/INTEGRATION_COVERAGE.md | rg -v "legacy|removed|migration|replace|replaced|historical|deprecated|transitional|strikethrough|~~|absence|suggestion"`
- `! rg -n "(call_tool|get_tool|invoke_tool|tool_name|tool=|tool:|name:)\s*['\"]?\b(append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)\b" tests/scenarios --glob '!**/migration*/**' | rg -v "legacy|removed|migration|replace|replaced|historical|deprecated|transitional|strikethrough|~~|absence|suggestion"`
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup legacy_surface`

## Notes

- `get_briefing` is still transitional and still needs the structured JSON hardening from Plan 128-07.
