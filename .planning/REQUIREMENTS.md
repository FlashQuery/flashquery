# Requirements: FlashQuery Core v3.3 MCP Tools Consolidation

**Defined:** 2026-05-11
**Milestone:** v3.3 MCP Tools Consolidation
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.

## Source Documents

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- `tests/scenarios/directed/DIRECTED_COVERAGE.md`
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md`

## v3.3 Requirements

### Foundation And Shared Contracts

- [x] **FND-01**: Developer can define every MCP tool's canonical name, categories, host eligibility, delegated eligibility, tier, and hard-exclusion reason in one central metadata registry.
- [x] **FND-02**: Host MCP registration, config validation, delegated native tool assembly, and legacy-name suggestions all consume the same central tool metadata instead of duplicating tool-name arrays.
- [x] **FND-03**: Developer can use shared JSON response helpers to emit success payloads, canonical error envelopes, warning arrays, batch envelopes, and entity identification blocks for documents, memories, records, plugins, and LLM calls.
- [x] **FND-04**: All expected validation, not-found, permission, conflict, unsupported, and partial-batch errors return structured JSON with `isError: false`; only unexpected runtime failures set `isError: true`.
- [x] **FND-05**: All canonical error and warning codes are lowercase snake_case and use the shared vocabulary unless a tool-specific namespaced extension is explicitly justified.
- [x] **FND-06**: All migrated entity-returning tools include their required identification block even when optional payload is controlled by `include`.
- [x] **FND-07**: Frontmatter access in migrated tool code uses centralized `FM.*` constants rather than raw `fq_*` string literals.
- [x] **FND-08**: Tool descriptions follow the required four-block template: summary, when-to-use signals, when-not-to-use alternative, and example invocation.

### Host And Delegated Tool Exposure

- [x] **CFG-01**: User can configure `host_mcp_tools.tools` and `host_mcp_tools.excluded_tools` with the same selector grammar used by delegated LLM purpose tools.
- [x] **CFG-02**: User can select tools by `tier:read-only`, `tier:read-write`, `category:<category>`, or explicit tool name, with `excluded_tools` applied as the final deny layer.
- [x] **CFG-03**: `doc-write` selection automatically includes the `doc-read` tool set, while `doc-read` remains valid as a standalone read-only deployment.
- [x] **CFG-04**: MCP `listTools` exposes only selected host-eligible tools, and delegated model tool belts can only start from tools enabled on the host surface.
- [x] **CFG-05**: Purpose config that references legacy removed tool names fails startup with a helpful old-name to new-name suggestion instead of silently rewriting aliases.
- [x] **CFG-06**: Suspicious category combinations produce startup warnings without refusing to start.

### Document Tool Consolidation

- [x] **DOC-01**: `get_document` keeps the shipped include/sections/follow_ref surface while migrating single-result errors to canonical envelopes and expected-error `isError: false` semantics.
- [x] **DOC-02**: `archive_document` returns document identification blocks with persisted `archived_at`, preserves idempotent re-archive behavior, and returns ordered per-element results for batches.
- [x] **DOC-03**: `write_document(mode:"create")` replaces `create_document` by creating markdown files from `path`, `title`, optional content, frontmatter, and tags while rejecting conflicts and reserved FQ-managed frontmatter.
- [x] **DOC-04**: `write_document(mode:"update")` replaces `update_document` and `update_doc_header` by updating body, title, frontmatter, or tags on one resolved document while preserving omitted fields.
- [x] **DOC-05**: `copy_document`, `move_document`, and `list_vault` retain their existing behavior while returning structured JSON envelopes instead of prose/table text.
- [x] **DOC-06**: `insert_in_doc` supports `include_nested` for `end_of_section`, preserves markdown-aware insertion semantics, and returns document identification plus insertion metadata.
- [x] **DOC-07**: `replace_doc_section` uses explicit `include_nested` semantics, supports empty-string section deletion including the heading line, and returns document identification plus replacement metadata.
- [x] **DOC-08**: `apply_tags` accepts explicit cross-domain `targets`, returns ordered document/memory identification results, and reports disabled-category failures per target.
- [x] **DOC-09**: `remove_document` archives lifecycle state before moving to the configured trash folder or hard-deleting the file, preserves input order for batch results, and honors existing git auto-commit/auto-push policy.
- [ ] **DOC-10**: `append_to_doc`, `create_document`, `update_document`, `update_doc_header`, and `search_documents` are removed from the final host and delegated tool surfaces with migrated tests and no compatibility aliases.

### Unified Search And Memory

- [x] **SRCH-01**: `search` replaces `search_all`, `search_documents`, `search_memory`, and `list_memories` with one result envelope over documents and memories.
- [x] **SRCH-02**: `search` supports explicit `mode: "filesystem" | "semantic" | "mixed"` with `"mixed"` as the default and stable validation for empty-query/list-mode cases.
- [x] **SRCH-03**: `search` supports document and memory list-mode when query is empty and filters or `list_all` make list intent explicit.
- [x] **SRCH-04**: `search` applies global limit after cross-domain merge/dedupe/sort and reports match sources deterministically.
- [x] **SRCH-05**: `search` excludes archived documents and memories by default and includes them only when requested.
- [x] **SRCH-06**: `search` degrades correctly when `doc-read` or `memory` categories are disabled, including warnings for explicitly requested disabled domains and hard `unsupported` when nothing requested is available.
- [x] **MEM-01**: `write_memory(mode:"create")` replaces `save_memory` while creating latest memory rows with default scope, tags, generated IDs, and optional content include behavior.
- [x] **MEM-02**: `write_memory(mode:"update")` replaces `update_memory` by creating a new latest version row, linking the previous version, and rejecting updates to non-latest memories.
- [x] **MEM-03**: `get_memory` accepts `memory_ids` as a single-or-array parameter and returns ordered memory envelopes with optional content payload.
- [x] **MEM-04**: `archive_memory` accepts single-or-array `memory_ids`, archives latest chains consistently, and returns ordered memory identification results.
- [ ] **MEM-05**: Legacy memory tools `save_memory`, `update_memory`, `search_memory`, and `list_memories` are removed from host and delegated surfaces with migrated coverage.

### Plugin And Record Tools

- [ ] **REC-01**: `register_plugin` returns a plugin identification block with `was_new` and preserves explicit upsert semantics.
- [ ] **REC-02**: `unregister_plugin` returns a plugin identification block with unregister metadata and preserves plugin cleanup behavior.
- [ ] **REC-03**: `get_plugin_info` returns a plugin envelope with `include: ["schema", "tables", "status_detail"]` payload control.
- [ ] **REC-04**: `write_record(mode:"create")` replaces `create_record` by validating plugin/table schema, rejecting generated or unknown fields, and returning a record identification block.
- [ ] **REC-05**: `write_record(mode:"update")` replaces `update_record` by validating partial data against plugin schema and returning a record identification block.
- [ ] **REC-06**: `get_record`, `archive_record`, and `search_records` keep behavior while returning structured JSON envelopes, include-controlled data, ordered batch results, and taggable-record search support.
- [ ] **REC-07**: `clear_pending_reviews` uses explicit `action: "list" | "clear"` and returns structured pending/cleared item envelopes.

### Directory, Maintenance, LLM, And Cleanup

- [x] **SYS-01**: `manage_directory(action:"create")` replaces `create_directory` with ordered per-path results, idempotent create status, path validation, and directory-scoped locking.
- [x] **SYS-02**: `manage_directory(action:"remove")` replaces `remove_directory` with ordered per-path results, empty-directory-only removal, conflict errors for non-empty paths, and directory-scoped locking.
- [x] **SYS-03**: `maintain_vault(action:"sync" | "repair" | "status" | ["repair","sync"])` replaces `force_file_scan` and `reconcile_documents` with structured per-action results, job status, dry-run repair, background sync, and maintenance conflict handling.
- [ ] **SYS-04**: `call_model` and `get_llm_usage` remain compliant reference tools and continue working with document reference resolution even when document MCP categories are hidden.
- [ ] **SYS-05**: Dead project tools `list_projects` and `get_project_info` stay absent from registration and stale source/tests are deleted.
- [ ] **SYS-06**: Transitional `get_briefing` and `insert_doc_link` remain only as macro-dependent legacy tools with structured output and explicit removal gates.

### Test And Scenario Governance

- [x] **TEST-01**: Every phase plan instantiates a phase-local traceability table that maps touched requirements to unit, integration, E2E, directed scenario, and integration scenario coverage before coding starts.
- [x] **TEST-02**: Every implementation phase adds or updates unit tests for schema validation, parameter parsing, output helpers, and error paths relevant to that phase.
- [x] **TEST-03**: Every implementation phase adds or updates integration tests covering at least one happy path and one expected-error path through the real handler plus filesystem/database layer where applicable.
- [x] **TEST-04**: Every implementation phase adds or updates E2E MCP protocol coverage for at least one touched host tool or tool group.
- [x] **TEST-05**: Every implementation phase adds or updates directed scenario coverage rows and runnable directed scenario cases for the public behavior it changes.
- [x] **TEST-06**: Every implementation phase adds or updates integration scenario coverage rows and runnable YAML integration workflows for cross-tool behavior it changes.
- [ ] **TEST-07**: Removed and merged tools have explicit test migration decisions: port, rewrite, absence assertion, or documented dependency-gated skip.
- [ ] **TEST-08**: The milestone closes only after scenario coverage ledgers, unit/integration/E2E suites, lint, build, and final coverage audit all agree that no v3.3 requirement is unverified.

## Future Requirements

### Macro Language And Composition

- **MACRO-01**: User can replace transitional composition tools such as `get_briefing` and `insert_doc_link` with `call_macro` workflows once macro parity exists.
- **MACRO-02**: User can perform literal body grep, regex, line-range, and string-level operations through macro/string primitives rather than expanding the MCP primitive surface.

### Trash Lifecycle

- **TRASH-01**: User can inspect, restore, purge, or apply retention policy to removed documents through a full trash lifecycle subsystem.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-server MCP split | Replaced by `host_mcp_tools` config in a single `flashquery` server. |
| Backward-compat aliases for removed tool names | The milestone is a hard cutover; helpful startup suggestions are allowed, silent compatibility aliases are not. |
| Literal body grep / regex / arbitrary line edits in `search` or document tools | These are macro/string-operation territory, not MCP primitives. |
| New `removed` lifecycle state or DB columns | `remove_document` archives then moves/deletes; archive remains the persistent lifecycle state. |
| MCP restore API for removed documents | Manual recovery and git history are sufficient for this consolidation. |
| Memory references in `call_model` | Document references remain the supported reference surface. |
| Runtime hot reload of host tool config | Restart-required behavior is accepted for v3.3. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 121 | Complete |
| FND-02 | Phase 121 | Complete |
| FND-03 | Phase 121 | Complete |
| FND-04 | Phase 121 | Complete |
| FND-05 | Phase 121 | Complete |
| FND-06 | Phase 121 | Complete |
| FND-07 | Phase 121 | Complete |
| FND-08 | Phase 121 | Complete |
| CFG-01 | Phase 122 | Complete |
| CFG-02 | Phase 122 | Complete |
| CFG-03 | Phase 122 | Complete |
| CFG-04 | Phase 122 | Complete |
| CFG-05 | Phase 122 | Complete |
| CFG-06 | Phase 122 | Complete |
| DOC-01 | Phase 123 | Complete |
| DOC-02 | Phase 123 | Complete |
| DOC-03 | Phase 124 | Complete |
| DOC-04 | Phase 124 | Complete |
| DOC-05 | Phase 123 | Complete |
| DOC-06 | Phase 124 | Complete |
| DOC-07 | Phase 124 | Complete |
| DOC-08 | Phase 124 | Complete |
| DOC-09 | Phase 127 | Complete |
| DOC-10 | Phase 128 | Pending |
| SRCH-01 | Phase 125 | Complete |
| SRCH-02 | Phase 125 | Complete |
| SRCH-03 | Phase 125 | Complete |
| SRCH-04 | Phase 125 | Complete |
| SRCH-05 | Phase 125 | Complete |
| SRCH-06 | Phase 125 | Complete |
| MEM-01 | Phase 125 | Complete |
| MEM-02 | Phase 125 | Complete |
| MEM-03 | Phase 125 | Complete |
| MEM-04 | Phase 125 | Complete |
| MEM-05 | Phase 128 | Pending |
| REC-01 | Phase 126 | Pending |
| REC-02 | Phase 126 | Pending |
| REC-03 | Phase 126 | Pending |
| REC-04 | Phase 126 | Pending |
| REC-05 | Phase 126 | Pending |
| REC-06 | Phase 126 | Pending |
| REC-07 | Phase 126 | Pending |
| SYS-01 | Phase 127 | Complete |
| SYS-02 | Phase 127 | Complete |
| SYS-03 | Phase 127 | Complete |
| SYS-04 | Phase 128 | Pending |
| SYS-05 | Phase 128 | Pending |
| SYS-06 | Phase 128 | Pending |
| TEST-01 | Phase 121 | Complete |
| TEST-02 | Phase 121 | Complete |
| TEST-03 | Phase 121 | Complete |
| TEST-04 | Phase 121 | Complete |
| TEST-05 | Phase 121 | Complete |
| TEST-06 | Phase 121 | Complete |
| TEST-07 | Phase 128 | Pending |
| TEST-08 | Phase 128 | Pending |

**Coverage:**
- v3.3 requirements: 56 total
- Mapped to phases: 57
- Unmapped: 0

---
*Requirements defined: 2026-05-11*
*Last updated: 2026-05-11 after v3.3 milestone initialization*
