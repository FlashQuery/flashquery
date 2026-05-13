# Phase 128 Plan 06 Summary

## Plan

128-06 - Update active docs and local skill guidance to final tool names.

## Completed

- Replaced the stale user-facing MCP guide with a current final-surface guide centered on `write_document`, `search`, `write_memory`, `write_record`, `manage_directory`, `maintain_vault`, and current document edit/lifecycle tools.
- Updated LLM purpose-tool docs to show final tier contents and explicit native tool examples.
- Updated directed and integration scenario authoring/running skills in both `.agents/skills` and `.claude/skills` to use final tool vocabulary.
- Updated `fq-devplan` guidance in both skill trees to use `search`, `manage_directory`, `write_document`, and `get_document` for outline/frontmatter reads.
- Classified remaining removed-name mentions in active docs/skills as removed legacy migration or historical evidence.
- Retained `get_briefing` and `insert_doc_link` only as transitional macro-dependent helpers with the `call_macro` parity removal gate.

## Verification

- `! rg -n "mcp__flashquery__(append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)" docs`
- `! rg -n "\\b(append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)\\b" docs | rg -v "legacy|removed|migration|replace|replaced|historical|deprecated|transitional|strikethrough|~~|absence|suggestion"`
- `! rg -n "mcp__flashquery__(append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)" .agents/skills .claude/skills --glob '!**/.claude/worktrees/**'`
- `! rg -n "\\b(append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info)\\b" .agents/skills .claude/skills --glob '!**/.claude/worktrees/**' | rg -v "legacy|removed|migration|replace|replaced|historical|deprecated|transitional|strikethrough|~~|absence|suggestion"`
- `grep -q "write_document" docs/FlashQuery\ MCP\ Tool\ Guide.md`
- `grep -q "maintain_vault" .agents/skills/flashquery-directed-testgen/SKILL.md`

All verification commands passed.

## Notes

- Also updated `docs/ARCHITECTURE.md`, `.agents/skills/pre-release/SKILL.md`, `.claude/skills/pre-release/SKILL.md`, and `.claude/skills/document-maintenance/rules/architecture-review.md` because the plan's acceptance gates scan the wider docs/skills surfaces.
