# Plan 128-05 Summary

## Status

Completed.

## Changes

- Added `legacy_surface_final_audit.yml`, a managed YAML scenario that asserts all removed/dead MCP tool names are absent from `listTools` while final replacements and transitional helpers remain present.
- Ported active YAML scenario `op` fields from removed search surfaces to final `search`.
- Ported active YAML directory actions from removed directory tools to `manage_directory`.
- Ported active YAML document update actions from the removed update alias to `write_document`.
- Updated the YAML integration runner so `memory.write` dispatches to `write_memory` and embedding dependency probing uses final `search`.
- Added compatibility normalization in the runner for `manage_directory` YAML args (`path`, string `paths`, and `root_path`).

## Verification

- `! rg -n "(tool|action|op|operation|name):\s*['\"]?\b(append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)\b" tests/scenarios/integration/tests tests/scenarios/integration/INTEGRATION_COVERAGE.md | rg -v "legacy|removed|migration|replace|replaced|historical|deprecated|transitional|strikethrough|~~|absence|suggestion"`
- `grep -q "search" tests/scenarios/integration/tests/archive_doc_memory_in_searchall.yml tests/scenarios/integration/tests/tag_filtered_memories.yml`
- `grep -q "manage_directory" tests/scenarios/integration/tests/create_directory_then_search.yml tests/scenarios/integration/tests/directory_lifecycle.yml`
- `python3 tests/scenarios/integration/run_integration.py --managed legacy_surface_final_audit`
- Representative ported scenario subset:
  - `python3 tests/scenarios/integration/run_integration.py --managed --stop-on-fail append_then_search append_and_search create_directory_then_search create_directory_then_document create_directory_idempotent directory_lifecycle tag_filtered_memories`
  - `python3 tests/scenarios/integration/run_integration.py --managed archive_doc_memory_in_searchall`

## Notes

- Existing scenario labels/descriptions still mention older names as historical behavior text; active YAML dispatch fields are ported or classified.
