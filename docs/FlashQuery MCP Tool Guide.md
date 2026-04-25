# FlashQuery MCP Tool Guide

FlashQuery is a local-first data management layer for AI workflows. It exposes 36 MCP tools that cover three core data types: **vault documents** (markdown files on disk), **memories** (persistent facts stored in Supabase), and **plugin records** (structured rows in custom plugin-defined tables). This guide explains what each tool does, why it exists, and how to call it correctly.

All tools are called with the prefix `mcp__flashquery__` (e.g., `mcp__flashquery__create_document`). All tools return a JSON response — always check `isError: true` before acting on a result.

## Document Identity: fqc_id

Every vault document has a `fqc_id` — a UUID stored in its frontmatter. This ID is **permanent**: it survives renames, moves, and re-indexing. When a tool call creates a document, parse `fqc_id` from the response and use it for all subsequent references to that document. Path-based identifiers work too, but `fqc_id` is the most reliable because it's immune to filesystem changes.

---

## Table of Contents

### Category 1 — Document Management
- [create_document](#create_document)
- [get_document](#get_document)
- [update_document](#update_document)
- [archive_document](#archive_document)
- [search_documents](#search_documents)
- [copy_document](#copy_document)
- [move_document](#move_document)
- [list_vault](#list_vault)

### Category 2 — Document Editing
- [append_to_doc](#append_to_doc)
- [insert_in_doc](#insert_in_doc)
- [replace_doc_section](#replace_doc_section)
- [update_doc_header](#update_doc_header)
- [apply_tags](#apply_tags)
- [insert_doc_link](#insert_doc_link)

### Category 3 — Memory Management
- [save_memory](#save_memory)
- [search_memory](#search_memory)
- [get_memory](#get_memory)
- [list_memories](#list_memories)
- [update_memory](#update_memory)
- [archive_memory](#archive_memory)

### Category 4 — Record Management
- [create_record](#create_record)
- [get_record](#get_record)
- [update_record](#update_record)
- [archive_record](#archive_record)
- [search_records](#search_records)

### Category 5 — Plugin Management
- [register_plugin](#register_plugin)
- [get_plugin_info](#get_plugin_info)
- [unregister_plugin](#unregister_plugin)

### Category 6 — Cross-Resource Tools
- [search_all](#search_all)
- [get_briefing](#get_briefing)
- [get_doc_outline](#get_doc_outline)

### Category 7 — Vault Maintenance
- [force_file_scan](#force_file_scan)
- [reconcile_documents](#reconcile_documents)
- [create_directory](#create_directory)
- [remove_directory](#remove_directory)
- [clear_pending_reviews](#clear_pending_reviews)

---

## Category 1 — Document Management

These tools create, read, update, archive, search, copy, move, and list vault documents. A vault document is a markdown file on disk with FlashQuery-managed frontmatter that includes a `fqc_id`, tags, status, and timestamps. The document body is owned by the user and AI; the frontmatter is owned by FlashQuery.

---

### create_document

**Overview**

`create_document` writes a new markdown file to the vault and registers it in the database with a freshly generated `fqc_id`. It exists because creating a document and registering it for AI tooling are two separate concerns — this tool handles both atomically. Without it, a file would need to be written by hand, then discovered by the scanner before the AI could reference it reliably. By using `create_document`, the AI gets an immediate, stable `fqc_id` it can use in follow-up calls.

The `path` parameter controls vault placement. If omitted, the file lands at the vault root with a filename derived from the title. Intermediate directories are created automatically if they don't exist.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | yes | Document title |
| `content` | string | yes | Document body (markdown). Pass `""` to create an empty document. |
| `path` | string | no | Vault-relative path (e.g., `"clients/acme/intake.md"`). Defaults to vault root. |
| `tags` | string[] | no | Tags for categorization |
| `frontmatter` | object | no | Additional frontmatter fields. Cannot override `fqc_id`, `status`, `created`, or `fqc_instance`. |

**Returns**

The new document's `fqc_id` (UUID), vault path, title, tags, and status.

**Examples**

Create a new client intake document:
```
mcp__flashquery__create_document({
  title: "Intake: Acme Corp - 2026-04-21",
  content: "## Background\n\nAcme Corp reached out about...",
  path: "clients/acme/intake.md",
  tags: ["#type/intake", "#status/new"]
})
```

Create an empty document with custom frontmatter:
```
mcp__flashquery__create_document({
  title: "Q2 Planning",
  content: "",
  path: "planning/q2.md",
  frontmatter: { owner: "engineering", quarter: "Q2-2026" }
})
```

**Usage Notes**
- Parse `fqc_id` from the response immediately. Use it — not the path — for all follow-up calls.
- If a file already exists at the path, the call fails. Use `update_document` or `append_to_doc` for existing files.
- `content` is required — pass `""` if you want an empty document.

---

### get_document

**Overview**

`get_document` reads a document's body content and returns it as a string. It exists as a dedicated read tool because documents can be large — the `sections` parameter lets you extract only the headings you need, dramatically reducing the tokens you consume. Without section filtering, reading large documents wastes context. The `identifier` accepts a path, UUID, or filename, making it convenient from any reference you have in hand.

For document structure without body content, use `get_doc_outline` instead. For navigation across a search result set, use `search_documents` first.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Document path, `fqc_id` UUID, or filename |
| `sections` | string[] | no | Heading names to extract (e.g., `["Configuration", "Examples"]`). Omit to get the full document. |
| `include_subheadings` | boolean | no | If `true` (default), include all nested content under each matching heading. If `false`, stop at the first subheading. |
| `occurrence` | number | no | Which occurrence of a heading when the same heading name appears multiple times (1-indexed). Default: `1` |

**Returns**

Document body content without frontmatter. Metadata includes path and change status.

**Examples**

Read the full document:
```
mcp__flashquery__get_document({
  identifier: "clients/acme/intake.md"
})
```

Read only the "Background" and "Next Steps" sections:
```
mcp__flashquery__get_document({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  sections: ["Background", "Next Steps"],
  include_subheadings: true
})
```

**Usage Notes**
- Prefer `sections` to limit context — loading a large document just to read one heading wastes tokens.
- UUID identifiers are the most reliable across renames and moves.
- Use `get_doc_outline` first to discover what headings exist before fetching specific sections.

---

### update_document

**Overview**

`update_document` replaces a document's body and/or updates frontmatter fields. It exists for cases where you need to rewrite a document's content from scratch — for example, after significantly reworking an analysis document based on new information. The entire body is replaced when `content` is provided.

For targeted section edits, prefer `replace_doc_section` or `insert_in_doc` — they preserve surrounding content and avoid unnecessary re-embedding. For tag changes alone, prefer `apply_tags`.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Document path, `fqc_id` UUID, or filename |
| `content` | string | no | New document body (markdown). Replaces entire body. If omitted, body is preserved unchanged. |
| `title` | string | no | New title. If omitted, existing title is preserved. |
| `tags` | string[] | no | Replacement tag list. Replaces all existing tags. If omitted, tags are preserved. |
| `frontmatter` | object | no | Additional frontmatter fields to merge. Cannot override `fqc_id`, `fqc_instance`, `created`, or `status`. |

**Returns**

Confirmation with updated metadata.

**Examples**

Overwrite the full body and title:
```
mcp__flashquery__update_document({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  content: "## Revised Background\n\nAfter our call...",
  title: "Intake: Acme Corp - Revised"
})
```

Update only a frontmatter field (body unchanged):
```
mcp__flashquery__update_document({
  identifier: "clients/acme/intake.md",
  frontmatter: { reviewed_by: "matt", review_date: "2026-04-21" }
})
```

**Usage Notes**
- This replaces the entire body and triggers re-embedding. For targeted edits, prefer `replace_doc_section` or `insert_in_doc`.
- If `tags` is provided, it replaces the full tag list. For incremental tag changes, use `apply_tags`.

---

### archive_document

**Overview**

`archive_document` marks one or more documents as archived by setting their `fq_status` frontmatter field to `'archived'` and updating the database status field. No file is deleted — the vault file remains in place with its `fqc_id` intact. Archived documents are excluded from search results by default.

This tool exists because "done" documents should leave search results without being permanently destroyed. The vault is a long-term record; archiving is the appropriate lifecycle step for documents the user no longer wants surfaced in active queries.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifiers` | string or string[] | yes | One or more document identifiers — each can be a vault-relative path, `fqc_id` UUID, or filename. Pass a single string or an array for batch archival. |

**Returns**

Confirmation message listing archived documents.

**Examples**

Archive a single document:
```
mcp__flashquery__archive_document({
  identifiers: "clients/acme/old-notes.md"
})
```

Archive multiple documents at once:
```
mcp__flashquery__archive_document({
  identifiers: [
    "a1b2c3d4-0000-0000-0000-000000000000",
    "e5f6g7h8-0000-0000-0000-000000000000"
  ]
})
```

**Usage Notes**
- The parameter is `identifiers` (plural), not `identifier`.
- Archiving is reversible — the file is never deleted.

---

### search_documents

**Overview**

`search_documents` finds vault documents by text query, tags, or semantic similarity. It exists because vault documents aren't a flat list — they live in nested folders, accumulate over time, and need to be found by content, not just by path. Three search modes serve different needs: filesystem (fast keyword/path scan), semantic (vector similarity via pgvector), and mixed (both combined, semantic-ranked first).

Archived documents are always excluded from results.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | no | Substring search on title or path (case-insensitive). Optional when filtering by tags alone. |
| `tags` | string[] | no | Filter results by tags |
| `tag_match` | `"any"` or `"all"` | no | How to combine multiple tags. `"any"` (default): at least one tag matches. `"all"`: every tag must be present. |
| `mode` | `"filesystem"` or `"semantic"` or `"mixed"` | no | Search strategy. `"filesystem"` (default): frontmatter scan. `"semantic"`: vector similarity. `"mixed"`: both combined. |
| `limit` | number | no | Maximum results. Default: `20` |

**Returns**

List of documents with path, title, tags, `fqc_id`, and match scores.

**Examples**

Keyword search (fast):
```
mcp__flashquery__search_documents({
  query: "acme",
  mode: "filesystem"
})
```

Semantic search with tag filter:
```
mcp__flashquery__search_documents({
  query: "client onboarding process",
  tags: ["#type/intake"],
  mode: "mixed",
  limit: 10
})
```

Tag-only filter (no search query):
```
mcp__flashquery__search_documents({
  tags: ["#status/draft"],
  tag_match: "all"
})
```

**Usage Notes**
- The parameter is `mode`, not `search_mode`.
- `query` is optional — you can search by tags alone with no query.
- `"mixed"` mode gives the best coverage: semantic first, then unindexed files appended.
- `"semantic"` requires that documents have been indexed. Newly created documents may not appear immediately.
- Use `list_vault` instead when you want to browse by folder structure rather than search by content.

---

### copy_document

**Overview**

`copy_document` duplicates a vault document to a new location, giving the copy its own fresh `fqc_id` and timestamps. It exists to support template-based workflows: keep a master template document and copy it whenever you need a new instance. The original is never modified.

The copy inherits the source's title, tags, and all custom frontmatter. Customize the copy afterwards with `update_document` or `apply_tags` if needed.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Source document path, `fqc_id` UUID, or filename |
| `destination` | string | no | Vault-relative path for the copy. Defaults to vault root using source title as filename. |

**Returns**

New document's `fqc_id`, path, and metadata.

**Examples**

Copy a template to start a new client file:
```
mcp__flashquery__copy_document({
  identifier: "templates/contact-template.md",
  destination: "clients/newcorp/contact.md"
})
```

**Usage Notes**
- The parameter is `destination`, not `new_path` or `new_title`.
- No title or tag customization at copy time — modify the copy afterwards.

---

### move_document

**Overview**

`move_document` relocates a document in the vault while preserving its `fqc_id` and all database associations. It exists because the vault's folder structure changes over time — clients get organized, projects graduate from inbox to archive — and documents need to follow those changes without losing their identity. Renaming is a special case of a move (same directory, different filename).

Intermediate directories are created automatically.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Source document path, `fqc_id` UUID, or filename |
| `destination` | string | yes | Vault-relative destination path including filename (extension optional — uses source extension if omitted) |

**Returns**

Confirmation with new path.

**Examples**

Move from inbox to a client folder:
```
mcp__flashquery__move_document({
  identifier: "inbox/meeting-notes.md",
  destination: "clients/acme/meeting-notes.md"
})
```

Rename in place:
```
mcp__flashquery__move_document({
  identifier: "clients/acme/notes.md",
  destination: "clients/acme/intake-notes.md"
})
```

**Usage Notes**
- The parameter is `destination`, not `new_path`.
- The document's `fqc_id` is preserved — no data is lost.
- References to this document in other vault files are NOT automatically updated.

---

### list_vault

**Overview**

`list_vault` browses the vault's file and directory tree by path. It exists because documents accumulate in nested folder hierarchies that search can't fully reveal — sometimes you need to see what's in a specific folder, what was changed recently, or what subdirectories exist under a project. Unlike `search_documents`, this is a filesystem-level traversal, not a content search.

For tracked documents (those with a `fqc_id`), rich metadata is returned: title, tags, size, and timestamps. For untracked files, only filesystem metadata is available.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | no | Vault-relative directory path. Use `""` or `"."` for vault root. Default: `"/"`. |
| `recursive` | boolean | no | If `true`, walk the entire subtree. Default: `false`. |
| `show` | string | no | What to include: `"files"`, `"directories"`, or `"all"`. Default: `"all"`. |
| `format` | string | no | Output format: `"table"` (markdown table, default) or `"detailed"` (key-value blocks). |
| `extensions` | string[] | no | Filter by file extensions (e.g., `[".md", ".txt"]`). Case-insensitive. Ignored when `show` is `"directories"`. |
| `after` | string | no | Include entries modified/created on or after this date. Relative (`"7d"`, `"24h"`, `"1w"`) or ISO (`"2026-04-01"`). |
| `before` | string | no | Include entries modified/created on or before this date. Relative or ISO format. |
| `date_field` | string | no | Which timestamp `after`/`before` filters against: `"updated"` (default) or `"created"`. |
| `limit` | integer | no | Maximum entries to return. Default: `200`. |

**Returns**

File and directory metadata with title, tags, `fqc_id`, size, and timestamps for tracked files. Untracked files show filesystem metadata only. Response ends with a summary line.

**Examples**

List a client folder:
```
mcp__flashquery__list_vault({
  path: "clients/acme"
})
```

Find recently changed markdown files across the vault:
```
mcp__flashquery__list_vault({
  path: "",
  recursive: true,
  extensions: [".md"],
  after: "7d",
  format: "detailed"
})
```

List only subdirectories:
```
mcp__flashquery__list_vault({
  path: "projects",
  show: "directories"
})
```

**Usage Notes**
- `extensions` is an array, not a single string. Use `[".md"]` not `".md"`.
- Use `format: "detailed"` when you need `fqc_id` or tags for follow-up tool calls — the default table format may omit them.
- When `show` is `"directories"`, `extensions` is silently ignored.

---

## Category 2 — Document Editing

These tools modify specific parts of a document without rewriting the whole thing. Prefer them over `update_document` for partial changes — they preserve surrounding content, avoid unnecessary re-embedding, and are less destructive when two operations are happening near each other.

---

### append_to_doc

**Overview**

`append_to_doc` adds markdown content to the bottom of a document. It exists for the common pattern of accumulating entries over time — interaction logs, meeting notes, daily entries — where new content always belongs at the end. It's simpler than `insert_in_doc` when position is always "last."

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Document path, `fqc_id` UUID, or filename |
| `content` | string | yes | Content to append (include any markdown structure such as headings) |

**Returns**

Confirmation with document path.

**Examples**

Log a follow-up call to a client document:
```
mcp__flashquery__append_to_doc({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  content: "\n## Follow-up — 2026-04-21\n\nDiscussed renewal timeline. Decision expected by end of month."
})
```

**Usage Notes**
- Prepend a newline in `content` to avoid running text into the previous line.
- For inserting at a specific location (not the bottom), use `insert_in_doc`.

---

### insert_in_doc

**Overview**

`insert_in_doc` places content at a precise location within a document: at the top, at the bottom, immediately after a named heading, immediately before a named heading, or at the end of a named section (after all its content, before the next sibling heading). It exists because many document workflows require position-specific insertion — adding a new log entry right after the "## Interactions" heading, for example, rather than at the end of the file.

The `heading` parameter anchors the insert to a named heading. The `occurrence` parameter handles documents where the same heading name appears multiple times.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Document path, `fqc_id` UUID, or filename |
| `content` | string | yes | Markdown content to insert (not including the anchor heading itself) |
| `position` | `"top"` or `"bottom"` or `"after_heading"` or `"before_heading"` or `"end_of_section"` | yes | Where to insert content |
| `heading` | string | no | Anchor heading name. Required for `after_heading`, `before_heading`, and `end_of_section` positions. |
| `occurrence` | number | no | Which occurrence of heading if multiple share the same name (1-indexed). Default: `1` |

**Returns**

Confirmation message.

**Examples**

Log a new interaction at the top of the Interactions section:
```
mcp__flashquery__insert_in_doc({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  content: "\n- 2026-04-21: Called about renewal\n",
  position: "after_heading",
  heading: "Interactions"
})
```

Prepend a status banner to the top of the document:
```
mcp__flashquery__insert_in_doc({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  content: "> **Status:** Under review as of 2026-04-21\n\n",
  position: "top"
})
```

**Usage Notes**
- The parameter is `heading`, not `anchor_heading`.
- `position` is required — there is no default.
- Heading matching is by text only — `"Configuration"` matches both `## Configuration` and `### Configuration`.

---

### replace_doc_section

**Overview**

`replace_doc_section` replaces the body of a specific section — everything between its heading and the next sibling heading — while leaving the heading line itself and all other sections untouched. It exists for workflows that maintain structured documents with predictable sections (e.g., "## Summary", "## Action Items") and need to overwrite one section without disturbing the rest.

The `include_subheadings` parameter controls whether child headings are replaced too, or preserved.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Document path, `fqc_id` UUID, or filename |
| `heading` | string | yes | Heading text to match (case-sensitive) |
| `content` | string | yes | New markdown content for the section body (does not include the heading line) |
| `include_subheadings` | boolean | no | When `true` (default), replace full section including nested headings. When `false`, preserve child headings. |
| `occurrence` | number | no | Which occurrence if heading appears multiple times (1-indexed). Default: `1` |

**Returns**

Confirmation message. Includes the old section content for undo purposes.

**Examples**

Replace the pricing section:
```
mcp__flashquery__replace_doc_section({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  heading: "Pricing",
  content: "\nRevised pricing: $5,000/month for the base tier.\n"
})
```

Replace a section without touching its subsections:
```
mcp__flashquery__replace_doc_section({
  identifier: "clients/acme/proposal.md",
  heading: "Executive Summary",
  content: "\nUpdated summary after stakeholder review.\n",
  include_subheadings: false
})
```

**Usage Notes**
- The parameter is `content`, not `new_content`.
- Heading match is by text, not heading level — `"Configuration"` matches `## Configuration` and `### Configuration`.

---

### update_doc_header

**Overview**

`update_doc_header` modifies frontmatter fields on a document without touching the body. It exists because frontmatter metadata — custom fields like `owner`, `stage`, `reviewed_by`, or `client_id` — needs to be updated independently of content edits. Setting a value to `null` removes the field entirely. When `tags` is included, the change is also synced to the database.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Document path, `fqc_id` UUID, or filename |
| `updates` | object | yes | Map of frontmatter field names to new values. Set a field to `null` to remove it. |

**Returns**

Confirmation message.

**Examples**

Update a custom field and remove a legacy one:
```
mcp__flashquery__update_doc_header({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  updates: {
    "client_stage": "active",
    "legacy_field": null
  }
})
```

Mark a document as reviewed:
```
mcp__flashquery__update_doc_header({
  identifier: "clients/acme/intake.md",
  updates: {
    "reviewed_by": "matt",
    "review_date": "2026-04-21"
  }
})
```

**Usage Notes**
- Prefer this over `update_document` when you only need to change frontmatter — it's less destructive and doesn't trigger re-embedding.
- For tag changes, `apply_tags` is even more targeted since it supports incremental add/remove without touching other frontmatter.

---

### apply_tags

**Overview**

`apply_tags` adds or removes tags on one or more documents (or a memory) in a single call. It exists because tags are the primary categorization mechanism in FlashQuery — status tracking, type classification, project membership — and they need to change frequently without the overhead of a full document update. Batch support means you can tag a set of search results in one call.

Adding a tag that already exists is a no-op. Removing a tag that isn't present is a silent no-op.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifiers` | string or string[] | no | One or more document identifiers. Use this OR `memory_id`, not both. |
| `memory_id` | string | no | UUID of the memory to tag. Use this OR `identifiers`, not both. |
| `add_tags` | string[] | no | Tags to add (idempotent) |
| `remove_tags` | string[] | no | Tags to remove (silent no-op if not present) |

**Returns**

Updated tag list.

**Examples**

Transition a document's status tag:
```
mcp__flashquery__apply_tags({
  identifiers: "a1b2c3d4-0000-0000-0000-000000000000",
  add_tags: ["#status/active"],
  remove_tags: ["#status/draft"]
})
```

Tag multiple documents at once:
```
mcp__flashquery__apply_tags({
  identifiers: [
    "a1b2c3d4-0000-0000-0000-000000000000",
    "e5f6g7h8-0000-0000-0000-000000000000"
  ],
  add_tags: ["#project/alpha"]
})
```

Tag a memory:
```
mcp__flashquery__apply_tags({
  memory_id: "f9e8d7c6-0000-0000-0000-000000000000",
  add_tags: ["preference"]
})
```

**Usage Notes**
- The parameter is `identifiers` (plural), not `identifier`.
- There is no `set_tags` — use `add_tags` and `remove_tags` for incremental changes.
- Documents can have only one `#status/*` tag at a time. Remove the old status before adding a new one.
- Can target documents OR a memory, but not both in the same call.

---

### insert_doc_link

**Overview**

`insert_doc_link` adds a wiki-style link (`[[Target Doc]]`) to a document's frontmatter `links` array (or another specified property). It exists to build an explicit relationship graph between vault documents — useful for CRM contact-to-company links, parent/child document hierarchies, or "related" cross-references. The display text is derived automatically from the target document's title; deduplication is handled automatically.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | yes | Source document path, `fqc_id` UUID, or filename |
| `target` | string | yes | Target document path, `fqc_id` UUID, or filename |
| `property` | string | no | Frontmatter property to add the link to. Default: `"links"`. Alternatives: `"related"`, `"parent"`, etc. |

**Returns**

Confirmation message.

**Examples**

Link a contact document to a company document:
```
mcp__flashquery__insert_doc_link({
  identifier: "a1b2c3d4-0000-0000-0000-000000000000",
  target: "clients/acme/company.md",
  property: "related"
})
```

Add a parent link:
```
mcp__flashquery__insert_doc_link({
  identifier: "clients/acme/meeting-2026-04-21.md",
  target: "clients/acme/intake.md",
  property: "parent"
})
```

**Usage Notes**
- The parameters are `target` and `property` — not `target_identifier`, `link_text`, or `anchor_heading`.
- Link display text is derived automatically from the target document's title — you don't specify it.
- Adding the same link twice is a no-op.

---

## Category 3 — Memory Management

Memories are short, persistent facts stored in Supabase — not vault files. They survive across sessions and are searchable by semantic similarity. Use memories for preferences, quick facts, and persistent context that doesn't warrant a full document. Each memory has a UUID, content string, tags, plugin scope, and a version history.

---

### save_memory

**Overview**

`save_memory` stores a persistent fact, preference, or observation that should be recalled in future sessions. It exists because AI context windows don't persist — every new session starts fresh. Memories bridge that gap by giving the AI a durable, searchable record of things the user wants remembered. Plugin scoping keeps memories organized when multiple workflows share the same FlashQuery instance.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `content` | string | yes | The memory text to store |
| `tags` | string[] | no | Tags for categorization |
| `plugin_scope` | string | no | Plugin scope (e.g., `"crm"`). Auto-corrected via fuzzy match against registered plugins. Default: `"global"` |

**Returns**

Memory ID (UUID), tags, and scope information.

**Examples**

Save a contact preference:
```
mcp__flashquery__save_memory({
  content: "Sarah at Acme prefers email over phone calls",
  tags: ["preference", "acme"],
  plugin_scope: "crm"
})
```

Save a global preference:
```
mcp__flashquery__save_memory({
  content: "User prefers responses in bullet points when listing options",
  tags: ["preference", "formatting"]
})
```

**Usage Notes**
- Keep memories concise and factual — they're retrieved by semantic search, so clear language improves recall.
- Parse the returned memory ID if you plan to update or archive this memory later.

---

### search_memory

**Overview**

`search_memory` finds memories by semantic similarity to a text query. It exists because memories accumulate — after dozens of saved facts, you can't scan them all. Semantic search lets the AI recall relevant memories naturally ("what do I know about Acme's preferences?") rather than requiring exact tags or text matches.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Search query |
| `tags` | string[] | no | Filter by tags |
| `tag_match` | `"any"` or `"all"` | no | How to combine tag filters. Default: `"any"` |
| `threshold` | number | no | Minimum similarity score (0–1). Default: `0.4` |
| `limit` | number | no | Maximum results. Default: `10` |

**Returns**

List of memories with ID, content, tags, match score, and creation date.

**Examples**

Find memories about communication preferences:
```
mcp__flashquery__search_memory({
  query: "communication preferences",
  tags: ["acme"],
  limit: 5
})
```

Search with a higher similarity threshold:
```
mcp__flashquery__search_memory({
  query: "pricing negotiations",
  threshold: 0.7
})
```

---

### get_memory

**Overview**

`get_memory` retrieves one or more memories by UUID and returns their full, untruncated content and version history. It exists because `search_memory` and `list_memories` return content previews — they truncate for efficiency. `get_memory` is the tool you use when you've found the IDs you need and want the complete text, often to edit or display it.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `memory_ids` | string or string[] | yes | Single memory UUID or array of UUIDs for batch retrieval |

**Returns**

Full memory content, tags, creation date, and last-updated date.

**Examples**

Fetch a single memory:
```
mcp__flashquery__get_memory({
  memory_ids: "f9e8d7c6-0000-0000-0000-000000000000"
})
```

Fetch multiple memories in one call:
```
mcp__flashquery__get_memory({
  memory_ids: [
    "f9e8d7c6-0000-0000-0000-000000000000",
    "a1b2c3d4-0000-0000-0000-000000000000"
  ]
})
```

**Usage Notes**
- The parameter is `memory_ids` (plural), not `memory_id`. It accepts a single string or an array.

---

### list_memories

**Overview**

`list_memories` returns memories filtered by tags without requiring a search query. It exists for browsing and auditing — when the user wants to review everything tagged with a particular category rather than search for something specific. Results include truncated content previews and memory IDs.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tags` | string[] | no | Filter by tags |
| `tag_match` | `"any"` or `"all"` | no | How to combine tag filters. Default: `"any"` |
| `limit` | number | no | Maximum results. Default: `50` |

**Returns**

List of memories with IDs, truncated content previews, tags, and metadata.

**Examples**

List all preference memories:
```
mcp__flashquery__list_memories({
  tags: ["preference"],
  limit: 20
})
```

List memories tagged with all of two tags:
```
mcp__flashquery__list_memories({
  tags: ["acme", "preference"],
  tag_match: "all"
})
```

**Usage Notes**
- Use `get_memory` after this to fetch full content for specific IDs.

---

### update_memory

**Overview**

`update_memory` replaces the content of an existing memory and increments its version. It exists because facts change — a contact's preferred communication channel, a project's status, a workflow preference. Rather than archiving and recreating, `update_memory` creates a versioned history so the change is traceable. Use `search_memory` or `list_memories` to find the memory ID first.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `memory_id` | string | yes | UUID of the memory to update |
| `content` | string | yes | New content to replace the existing memory text |
| `tags` | string[] | no | New tags. If omitted, existing tags are preserved. |

**Returns**

New version ID, previous version ID, and version number.

**Examples**

Update a changed preference:
```
mcp__flashquery__update_memory({
  memory_id: "f9e8d7c6-0000-0000-0000-000000000000",
  content: "Sarah at Acme now prefers Slack over email",
  tags: ["preference", "acme"]
})
```

---

### archive_memory

**Overview**

`archive_memory` marks a memory as inactive. Archived memories no longer appear in `search_memory` or `list_memories` results. It exists for the "forget this" use case — when a memory is outdated, incorrect, or the user explicitly asks to remove it. The memory is preserved in the database for audit purposes but is effectively invisible.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `memory_id` | string | yes | UUID of the memory to archive |

**Returns**

Confirmation message.

**Examples**

Archive an outdated memory:
```
mcp__flashquery__archive_memory({
  memory_id: "f9e8d7c6-0000-0000-0000-000000000000"
})
```

---

## Category 4 — Record Management

Records are structured data rows in plugin-defined Postgres tables. They exist for data that has fixed fields, needs relational querying, or requires semantic search across specific columns — CRM contacts, task trackers, inventory items, opportunity pipelines. Records require a plugin to be registered first (see [Category 5 — Plugin Management](#category-5--plugin-management)).

Plugin tables use the prefix `fqcp_` in the database and support optional pgvector embeddings via the `embed_fields` schema directive.

---

### create_record

**Overview**

`create_record` inserts a new row into a plugin table. It exists because structured data with fixed fields — contacts, tasks, log entries — doesn't fit naturally into unstructured vault documents. Records give that data a relational home with schema enforcement, embedding support, and clean CRUD semantics.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier |
| `plugin_instance` | string | no | Plugin instance identifier. Omit for single-instance plugins. |
| `table` | string | yes | Table name as defined in the plugin schema |
| `fields` | object | yes | Field values as key-value pairs |

**Returns**

New record's ID (UUID).

**Examples**

Create a CRM contact:
```
mcp__flashquery__create_record({
  plugin_id: "crm",
  table: "contacts",
  fields: {
    name: "Sarah Chen",
    company: "Acme Corp",
    role: "VP Engineering",
    email: "sarah@acme.com"
  }
})
```

---

### get_record

**Overview**

`get_record` retrieves a single record by its UUID from a plugin table. Use it after finding record IDs through `search_records` when you need the full field set for display or editing.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier |
| `plugin_instance` | string | no | Plugin instance identifier |
| `table` | string | yes | Table name as defined in the plugin schema |
| `id` | string | yes | Record UUID |

**Returns**

Full record as a JSON object with all fields.

**Examples**

Fetch a contact record:
```
mcp__flashquery__get_record({
  plugin_id: "crm",
  table: "contacts",
  id: "a1b2c3d4-0000-0000-0000-000000000000"
})
```

---

### update_record

**Overview**

`update_record` updates specific fields on an existing record. Only the provided fields are changed — all others are preserved. It exists for the common case of updating one or two fields on a record without having to read and rewrite the full row.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier |
| `plugin_instance` | string | no | Plugin instance identifier |
| `table` | string | yes | Table name as defined in the plugin schema |
| `id` | string | yes | Record UUID |
| `fields` | object | yes | Fields to update (key-value pairs). Only these fields are changed. |

**Returns**

Confirmation of update.

**Examples**

Update a contact's role:
```
mcp__flashquery__update_record({
  plugin_id: "crm",
  table: "contacts",
  id: "a1b2c3d4-0000-0000-0000-000000000000",
  fields: {
    role: "CTO",
    notes: "Promoted in Q1 2026"
  }
})
```

---

### archive_record

**Overview**

`archive_record` soft-deletes a record by setting its status to archived. The row is preserved in the database but excluded from search results. Use this when a record is no longer active but should be kept for history — a closed opportunity, a churned contact, a completed task.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier |
| `plugin_instance` | string | no | Plugin instance identifier |
| `table` | string | yes | Table name as defined in the plugin schema |
| `id` | string | yes | Record UUID |

**Returns**

Confirmation message.

**Examples**

Archive a closed opportunity:
```
mcp__flashquery__archive_record({
  plugin_id: "crm",
  table: "opportunities",
  id: "a1b2c3d4-0000-0000-0000-000000000000"
})
```

---

### search_records

**Overview**

`search_records` queries records in a plugin table by text, semantic similarity, or field equality filters. The search mode is determined automatically by the table schema: tables with `embed_fields` defined use pgvector semantic search; tables without use ILIKE text matching. `filters` applies additional field-level equality constraints with AND logic.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier |
| `plugin_instance` | string | no | Plugin instance identifier |
| `table` | string | yes | Table name as defined in the plugin schema |
| `query` | string | no | Text search query (semantic if table has `embed_fields`, ILIKE otherwise) |
| `filters` | object | no | Key-value field equality filters (AND logic) |
| `limit` | number | no | Maximum results. Default: `10` |

**Returns**

List of records with match scores.

**Examples**

Text search across a contacts table:
```
mcp__flashquery__search_records({
  plugin_id: "crm",
  table: "contacts",
  query: "engineering"
})
```

Filter by field value:
```
mcp__flashquery__search_records({
  plugin_id: "crm",
  table: "opportunities",
  filters: { stage: "proposal" },
  limit: 20
})
```

Combine semantic query with field filter:
```
mcp__flashquery__search_records({
  plugin_id: "crm",
  table: "contacts",
  query: "renewal discussion",
  filters: { relationship_type: "client" }
})
```

**Usage Notes**
- The parameter is `filters` (a key-value object), not `tags`, `tag_match`, or `status`.
- `query` is optional — you can filter by `filters` alone.

---

## Category 5 — Plugin Management

Plugins define custom table schemas that extend FlashQuery with structured data stores. A plugin is a YAML file that declares tables, columns, and optional embedding fields. Once registered, FlashQuery creates the tables in Postgres and exposes them through the Record tools.

---

### register_plugin

**Overview**

`register_plugin` installs a plugin from a YAML schema, creating its tables in Postgres. On re-registration with an updated schema version, it performs a safe migration: new tables and new columns are added automatically; removed tables or column type changes are rejected with an explanation. This tool is the entry point for any structured data workflow — you must register a plugin before you can use the Record tools against its tables.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `schema_path` | string | no | Path to a YAML schema file on disk. Provide this OR `schema_yaml`, not both. |
| `schema_yaml` | string | no | Inline YAML schema string. Provide this OR `schema_path`, not both. |
| `plugin_instance` | string | no | Plugin instance identifier. Omit for single-instance plugins. |

**Returns**

Registration confirmation with created or migrated tables.

**Schema Format**

Tables and columns are arrays, not maps. The `embed_fields` array at the table level enables semantic search for that table — the system automatically adds `embedding` and `embedding_updated_at` columns when `embed_fields` is present.

```yaml
id: crm
name: CRM Plugin
version: "1.0"

tables:
  - name: contacts
    description: People in the CRM
    embed_fields:
      - name
      - notes
    columns:
      - name: name
        type: text
        required: true
        description: Full name
      - name: company
        type: text
        description: Company name
      - name: role
        type: text
        description: Job title
      - name: email
        type: text
        description: Email address
      - name: notes
        type: text
        description: Freeform notes
```

**Examples**

Register from a file:
```
mcp__flashquery__register_plugin({
  schema_path: "/path/to/crm-schema.yml"
})
```

Register from inline YAML:
```
mcp__flashquery__register_plugin({
  schema_yaml: "id: my-plugin\nname: My Plugin\nversion: \"1.0\"\ntables:\n  - name: entries\n    columns:\n      - name: title\n        type: text\n        required: true\n"
})
```

**Schema Rules**
- `tables` must be an **array** (`- name: ...`). Map-style (`tables: { contacts: { ... } }`) is not supported.
- `columns` must be an **array**.
- Valid column types: `text`, `integer`, `boolean`, `uuid`, `timestamptz`.
- Do not manually define `embedding` or `embedding_updated_at` — they're added automatically when `embed_fields` is present.
- Plugin metadata (`id`, `name`, `version`) can be at root level or nested under a `plugin:` key.

---

### get_plugin_info

**Overview**

`get_plugin_info` returns the schema definition, table structure, version, and registration details for an installed plugin. Use it to check if a plugin is registered, inspect its column definitions, or confirm which version is active before running a migration.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier |
| `plugin_instance` | string | no | Plugin instance identifier |

**Returns**

Plugin name, version, instance, table prefix, and detailed table and column structure.

**Examples**

Inspect the CRM plugin:
```
mcp__flashquery__get_plugin_info({
  plugin_id: "crm"
})
```

---

### unregister_plugin

**Overview**

`unregister_plugin` tears down a plugin: it drops plugin tables, clears document ownership claims, deletes plugin-scoped memories, and removes the registry entry. Vault files are never deleted. The tool requires a two-step confirmation pattern — call without `confirm_destroy` first for a dry-run preview, then repeat with `confirm_destroy: true` to execute.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier |
| `plugin_instance` | string | no | Plugin instance identifier |
| `confirm_destroy` | boolean | no | Must be `true` to execute teardown. Omit or `false` for dry-run preview only. |

**Returns**

Inventory of what will be removed (dry-run) or teardown summary (confirmed).

**Examples**

Dry run — see what will be removed:
```
mcp__flashquery__unregister_plugin({
  plugin_id: "my-plugin"
})
```

Confirmed teardown:
```
mcp__flashquery__unregister_plugin({
  plugin_id: "my-plugin",
  confirm_destroy: true
})
```

**Usage Notes**
- Always do a dry run first. Show the user the inventory before destroying anything.

---

## Category 6 — Cross-Resource Tools

These tools work across multiple data types in a single call — searching both documents and memories, or aggregating metadata about everything tagged with a topic.

---

### search_all

**Overview**

`search_all` runs a semantic search across both documents and memories simultaneously and returns unified, ranked results. It exists for the common case where the user asks "what do I know about X" and the answer could be in a vault document, a saved memory, or both. Rather than calling `search_documents` and `search_memory` separately and merging manually, `search_all` handles it in one call.

Falls back to filesystem search for documents when semantic search is unavailable.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | yes | Search query |
| `tags` | string[] | no | Filter results to items with these tags |
| `tag_match` | `"any"` or `"all"` | no | How to combine tags. Default: `"any"` |
| `limit` | number | no | Maximum results per entity type. Default: `10` |
| `entity_types` | string[] | no | Which types to search: `["documents"]`, `["memories"]`, or both (default). |

**Returns**

Ranked results from both documents and memories with match scores and source type.

**Examples**

Search everything:
```
mcp__flashquery__search_all({
  query: "Acme Corp renewal timeline",
  limit: 10
})
```

Search only memories with a tag filter:
```
mcp__flashquery__search_all({
  query: "communication preferences",
  tags: ["crm"],
  entity_types: ["memories"]
})
```

**Usage Notes**
- `limit` is per entity type, not total. `limit: 10` returns up to 10 documents AND up to 10 memories.
- Use `entity_types` to restrict to a single type when the query is clearly document-specific or memory-specific.

---

### get_briefing

**Overview**

`get_briefing` returns a grouped overview of everything tagged with one or more tags: matching document metadata, memory content, and optionally full plugin records. It exists for orientation before working on a topic — "brief me on the Acme account" or "what do we have tagged project-alpha?" — without requiring the user to know which tool type holds relevant data.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tags` | string[] | yes | Tags to filter by. Documents and memories with any/all of these tags are included. |
| `tag_match` | `"any"` or `"all"` | no | Tag matching mode. Default: `"any"` |
| `limit` | number | no | Maximum results per section. Default: `20` |
| `plugin_id` | string | no | Include records from this plugin. Omit to exclude plugin records. |

**Returns**

Grouped results: document metadata (title, path, tags, `fqc_id`), memory content, and optionally full plugin records (all fields for each active record in the plugin's tables).

**Examples**

Brief on a client account:
```
mcp__flashquery__get_briefing({
  tags: ["acme"],
  tag_match: "any",
  plugin_id: "crm"
})
```

Brief on a project using multiple tags (all must match):
```
mcp__flashquery__get_briefing({
  tags: ["#project/alpha", "#status/active"],
  tag_match: "all"
})
```

**Usage Notes**
- `tags` is required. For full-text search across everything, use `search_all` instead.
- This is a tag-scoped overview, not a per-document briefing. Documents are listed by metadata, not body content.

---

### get_doc_outline

**Overview**

`get_doc_outline` returns a document's frontmatter and heading hierarchy without loading the body. It exists because reading a large document just to learn its structure is wasteful — often you need to know what sections exist before deciding which ones to fetch with `get_document`. Batch mode (array of identifiers) returns DB metadata for triage without any file I/O.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifiers` | string or string[] | yes | One or more document identifiers. Single string = full structural outline (file-based). Array = DB metadata for batch triage. |
| `max_depth` | number | no | Maximum heading level to include (1–6). Default: `6` (all levels). |
| `exclude_headings` | boolean | no | If `true`, omit headings from response (metadata only). Default: `false`. |

**Returns**

Frontmatter fields, heading outline with hierarchy, and linked file references.

**Examples**

Inspect one document's structure:
```
mcp__flashquery__get_doc_outline({
  identifiers: "clients/acme/intake.md"
})
```

Triage multiple documents (top-level headings only):
```
mcp__flashquery__get_doc_outline({
  identifiers: [
    "a1b2c3d4-0000-0000-0000-000000000000",
    "e5f6g7h8-0000-0000-0000-000000000000"
  ],
  max_depth: 2
})
```

**Usage Notes**
- The parameter is `identifiers` (plural), not `identifier`. Accepts a single string or array.
- Use this before calling `get_document` with `sections` — it tells you what headings exist to target.

---

## Category 7 — Vault Maintenance

These tools manage the health of the vault index and its physical file structure. Use them after bulk file operations, when the index falls out of sync, or when setting up or tearing down organizational folder structures.

---

### force_file_scan

**Overview**

`force_file_scan` triggers an immediate re-scan of the vault to detect new files, moves, and deletions, then updates the database index. It exists because the vault scanner normally runs on a schedule — if files have been added, moved, or deleted outside the AI chat (e.g., directly in the filesystem or via Obsidian), the index may be stale. Call this before semantic search in those situations to ensure the index is current.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `background` | boolean | no | If `true`, scan runs in background and returns immediately. Default: `false` (synchronous). |

**Returns**

Synchronous mode returns a JSON object with `status: "complete"` and counts: `new_files`, `updated_files`, `moved_files`, `deleted_files`, `status_mismatches`, `embedding_status`, and `embeds_awaited`. Background mode (`background: true`) returns immediately with `status: "started"` and a message — no counts are included.

**Examples**

Run a synchronous scan and get counts:
```
mcp__flashquery__force_file_scan({})
```

Start a background scan (no waiting):
```
mcp__flashquery__force_file_scan({
  background: true
})
```

---

### reconcile_documents

**Overview**

`reconcile_documents` scans the database for documents whose vault file is missing, then resolves each case. Files that moved but kept their `fqc_id` in frontmatter are detected by matching the UUID at the new location — their database path is updated. Files that are permanently gone are marked archived. This tool exists because bulk file moves (vault reorganizations, folder renames done outside the AI) can leave the database pointing to stale paths.

A `dry_run` mode lets you preview what would change before committing.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `dry_run` | boolean | no | If `true`, report what would change without updating the database. Default: `false` |

**Returns**

Summary of reconciliation actions: moved (file found at a new location — DB path updated) and archived (file not found anywhere — DB row marked archived).

**Examples**

Preview changes before applying:
```
mcp__flashquery__reconcile_documents({
  dry_run: true
})
```

Apply fixes:
```
mcp__flashquery__reconcile_documents({})
```

**Usage Notes**
- Run a dry run first after major file reorganizations.

---

### create_directory

**Overview**

`create_directory` creates one or more vault directories, with mkdir-style intermediary creation and idempotent behavior (existing directories are noted but not errored). It exists because skills that set up organizational structures — a CRM folder tree, a project hierarchy — need to ensure directories exist before saving documents into them. FlashQuery's document tools don't create arbitrary missing parent directories themselves.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `paths` | string or string[] | yes | One or more vault-relative directory paths to create. Accepts a single string or an array. |
| `root_path` | string | no | Vault-relative base prefix applied to all entries in `paths`. Default: `"/"` (vault root). |

**Returns**

Confirmation with created paths. Pre-existing directories are noted (not errored).

**Examples**

Create a single directory:
```
mcp__flashquery__create_directory({
  paths: "clients/acme/2026"
})
```

Create multiple directories under a shared root:
```
mcp__flashquery__create_directory({
  paths: ["contacts", "companies", "interactions"],
  root_path: "CRM"
})
```

**Usage Notes**
- The parameter is `paths` (plural), not `path`. It accepts a single string or an array.
- Calling on an existing directory succeeds silently — the response notes it as "already exists."
- Illegal filesystem characters in directory names are sanitized (replaced with spaces) and reported.
- Absolute paths starting with `/` are rejected — all paths must be vault-relative.

---

### remove_directory

**Overview**

`remove_directory` removes an empty directory from the vault. It refuses to delete non-empty directories and returns an error listing the contents. This is deliberate — FlashQuery has no recursive delete command, and accidental data loss from a force-remove is not recoverable. The correct workflow is to move or archive the contents first, then remove the empty directory.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Vault-relative path of the directory to remove |

**Returns**

Confirmation that the directory was removed.

**Examples**

Remove an empty staging folder:
```
mcp__flashquery__remove_directory({
  path: "temp/staging"
})
```

**Usage Notes**
- Only works on empty directories. If the directory has contents, the error response lists them.
- Cannot remove the vault root directory.
- Use `move_document` or `archive_document` to clear out files first.

---

### clear_pending_reviews

**Overview**

`clear_pending_reviews` is the entry point for **pull-based document processing** — the mechanism by which skills pick up and process newly discovered or resurrected documents without a push callback. When FlashQuery auto-tracks a new file or resurrects an archived one, it adds a row to the `fqc_pending_plugin_review` table. Scheduled skills call `clear_pending_reviews` to query that queue, process each item, and then clear the processed IDs.

Call with no `fqc_ids` (or empty array) to **query** what's pending. Call with `fqc_ids` populated to **clear** those items. The response is always the current pending list after any clearing.

This tool replaces the old `on_document_discovered` push-callback pattern. Skills are now scheduled and pull from the queue rather than being invoked reactively per file.

**Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `plugin_id` | string | yes | Plugin identifier. Always required — queries are scoped to one plugin. |
| `plugin_instance` | string | no | Plugin instance identifier. Default: `"default"` |
| `fqc_ids` | string[] | no | Document IDs to clear. Empty array or omitted = query mode (list pending items without deleting). Non-empty = clear matching rows, then return what remains. |

**Returns**

The current list of pending review items for the plugin (after any clearing). Each item includes:
- `fqc_id` — the document's UUID (use with `get_document` to read content)
- `table_name` — which plugin table the auto-tracked row lives in (e.g., `"contacts"`)
- `review_type` — why it was queued: `"template_available"`, `"new_document"`, `"resurrected"`, or `"custom"`
- `context` — JSONB metadata for the skill to act on (e.g., `{ "template": "contact_note.md" }`)

**When items are queued (automatically by FlashQuery):**
- `on_added: auto-track` fires and the `documents.types` entry declares a template → `review_type: "template_available"`
- `on_added: auto-track` fires with no template, plugin opts into new-document review → `review_type: "new_document"`
- An archived plugin row is resurrected (document reappeared in vault) → `review_type: "resurrected"`

**Calling pattern for a scheduled skill:**

```
Step 1 — Query what's pending:
clear_pending_reviews({ plugin_id: "crm", fqc_ids: [] })
→ returns list of items with fqc_id, table_name, review_type, context

Step 2 — Process each item:
  - get_document({ identifier: item.fqc_id }) to read content
  - Apply template, classify, enrich, or route as needed
  - Use move_document, update_document, apply_tags, etc.

Step 3 — Clear what was processed:
clear_pending_reviews({ plugin_id: "crm", fqc_ids: [processed_id_1, processed_id_2, ...] })
→ returns remaining pending items (if any)

Step 4 — If items remain, the next scheduled invocation picks them up
```

**Examples**

Query what's pending for the CRM plugin:
```
mcp__flashquery__clear_pending_reviews({
  plugin_id: "crm"
})
```

Clear processed items and see what remains:
```
mcp__flashquery__clear_pending_reviews({
  plugin_id: "crm",
  fqc_ids: [
    "a1b2c3d4-0000-0000-0000-000000000000",
    "e5f6g7h8-0000-0000-0000-000000000000"
  ]
})
```

**Usage Notes**
- `plugin_id` is always required — there is no "query all plugins" mode.
- Clearing an `fqc_id` that doesn't exist in the queue is a silent no-op.
- "No action needed" is a valid reason to clear — if a document doesn't need processing, clear it so it doesn't accumulate.
- Pending items are also surfaced passively in every record tool response, so an in-conversation skill can see them without a dedicated call.
