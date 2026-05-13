# FlashQuery MCP Tool Guide

All tools are called with the `mcp__flashquery__` prefix in clients that expose MCP tool names directly. Example: `mcp__flashquery__write_document`. Tool responses use `content[0].text`; many current tools return JSON in that text field. Always check `isError: true` before acting on a result.

This guide describes the final consolidated tool surface. Removed legacy names are listed only as migration evidence near the end.

## Current Tool Surface

### Documents

Use `write_document` to create or update whole documents.

```js
mcp__flashquery__write_document({
  mode: "create",
  path: "Projects/Alpha/Plan.md",
  title: "Alpha Plan",
  content: "## Scope\n\nInitial notes.",
  tags: ["project", "alpha"],
  frontmatter: { status: "draft" }
})
```

For updates, pass `mode: "update"` and `identifier`, then include at least one of `content`, `title`, `frontmatter`, or `tags`. `tags` replaces the full document tag list; use `apply_tags` for additive tag changes.

Use `get_document` to read one or more documents by `fq_id`, vault-relative path, or filename. Use `include` for `body`, `frontmatter`, and `headings`; use `sections` for heading extraction.

```js
mcp__flashquery__get_document({
  identifiers: "Projects/Alpha/Plan.md",
  include: ["body", "frontmatter", "headings"],
  sections: ["Scope"]
})
```

Use `search` for document search. Set `entity_types: ["documents"]` when the search should not include memories.

```js
mcp__flashquery__search({
  query: "alpha launch risks",
  entity_types: ["documents"],
  mode: "mixed",
  limit: 10
})
```

Use `list_vault` to browse paths and inspect vault structure without reading full document bodies.

```js
mcp__flashquery__list_vault({
  path: "Projects",
  recursive: true,
  include: ["metadata", "tracking"]
})
```

Use `insert_in_doc` for markdown-aware insertion and `replace_doc_section` for section replacement.

```js
mcp__flashquery__insert_in_doc({
  identifier: "Projects/Alpha/Plan.md",
  position: "end_of_section",
  heading: "Tasks",
  content: "- Confirm launch owner",
  include_nested: false
})
```

```js
mcp__flashquery__replace_doc_section({
  identifier: "Projects/Alpha/Plan.md",
  heading: "Risks",
  heading_match: "exact",
  content: "No open risks."
})
```

Use `move_document`, `copy_document`, `archive_document`, and `remove_document` for document lifecycle operations. `archive_document` keeps the file and marks it archived; `remove_document` performs the configured removal lifecycle.

```js
mcp__flashquery__remove_document({
  identifiers: ["Scratch/old-plan.md"]
})
```

Use `apply_tags` to add or remove tags on documents and memories without replacing whole tag lists.

```js
mcp__flashquery__apply_tags({
  targets: [{ entity_type: "document", identifier: "Projects/Alpha/Plan.md" }],
  add_tags: ["reviewed"],
  remove_tags: ["draft"]
})
```

### Memories

Use `write_memory` to create or update persistent memories.

```js
mcp__flashquery__write_memory({
  mode: "create",
  content: "The user prefers concise implementation updates.",
  tags: ["preference"]
})
```

Use `mode: "update"` with `memory_id` to create a new latest version of an existing memory. Use `get_memory` for exact retrieval and `archive_memory` when a memory should stop appearing in normal search.

Use `search` for memory search or tag-filtered memory lists.

```js
mcp__flashquery__search({
  query: "communication preferences",
  entity_types: ["memories"],
  mode: "semantic",
  limit: 5
})
```

```js
mcp__flashquery__search({
  tags: ["preference"],
  entity_types: ["memories"],
  tag_match: "all",
  limit: 20
})
```

### Records And Plugins

Use `write_record` to create or update plugin-owned relational records.

```js
mcp__flashquery__write_record({
  mode: "create",
  plugin_id: "crm",
  table: "contacts",
  data: { name: "Ada Lovelace", status: "active" }
})
```

Use `get_record`, `search_records`, and `archive_record` for record reads, queries, and archival. Use `register_plugin`, `get_plugin_info`, and `unregister_plugin` for plugin lifecycle management.

### Vault Maintenance And Directories

Use `manage_directory` to create folders or remove empty folders.

```js
mcp__flashquery__manage_directory({
  action: "create",
  paths: ["Projects/Alpha", "Projects/Beta"]
})
```

Use `maintain_vault` for administrative maintenance when files changed outside FlashQuery or the index needs an explicit sync/repair/status check.

```js
mcp__flashquery__maintain_vault({
  action: ["repair", "sync"],
  dry_run: false
})
```

### LLM Tools

Use `call_model` for configured model-purpose calls and `get_llm_usage` for usage reporting. Delegated model tool access is controlled by purpose configuration; see `docs/LLM Providers Models and Purposes.md`.

## Transitional Tools

`get_briefing` and `insert_doc_link` are transitional macro-dependent legacy tools. They remain available only until `call_macro` reaches parity for those workflows. Any retained guidance must name that removal gate.

Use `get_briefing` for a tag-scoped overview of documents, memories, and optionally plugin records while macro parity is pending.

Use `insert_doc_link` to add a wiki-style document link to a frontmatter property while macro parity is pending. It returns structured JSON with `status: "updated"` or `status: "unchanged"` and a `removal_gate` value of `call_macro parity`.

## Removed Legacy Migration Reference

The following names are removed legacy migration references and must not appear in active instructions or examples: `append_to_doc`, `create_document`, `update_document`, `update_doc_header`, `search_documents`, `save_memory`, `update_memory`, `search_memory`, `list_memories`, `force_file_scan`, `reconcile_documents`, `create_directory`, `remove_directory`, `create_record`, `update_record`, `search_all`, `list_projects`, and `get_project_info`.

Replacement summary:

| Removed legacy name | Final replacement |
|---|---|
| Removed legacy migration: `create_document` | `write_document` with `mode: "create"` |
| Removed legacy migration: `update_document` | `write_document` with `mode: "update"` |
| Removed legacy migration: `append_to_doc` | `insert_in_doc` with `position: "bottom"` or a heading-aware position |
| Removed legacy migration: `update_doc_header` | `write_document` with `mode: "update"` and `frontmatter` |
| Removed legacy migration: `search_documents` | `search` with `entity_types: ["documents"]` |
| Removed legacy migration: `save_memory` | `write_memory` with `mode: "create"` |
| Removed legacy migration: `update_memory` | `write_memory` with `mode: "update"` |
| Removed legacy migration: `search_memory` | `search` with `entity_types: ["memories"]` |
| Removed legacy migration: `list_memories` | `search` with `entity_types: ["memories"]` and tag/list-mode arguments |
| Removed legacy migration: `force_file_scan` | `maintain_vault` with `action: "sync"` |
| Removed legacy migration: `reconcile_documents` | `maintain_vault` with `action: "repair"` |
| Removed legacy migration: `create_directory` | `manage_directory` with `action: "create"` |
| Removed legacy migration: `remove_directory` | `manage_directory` with `action: "remove"` |
| Removed legacy migration: `create_record` | `write_record` with `mode: "create"` |
| Removed legacy migration: `update_record` | `write_record` with `mode: "update"` |
| Removed legacy migration: `search_all` | `search` with `entity_types` |
| Removed legacy migration: `list_projects` | `list_vault` or `search` with path/tag filters |
| Removed legacy migration: `get_project_info` | `search`, `get_document`, or transitional `get_briefing` with the `call_macro` removal gate noted |
