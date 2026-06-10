# FlashQuery MCP Tool Guide

All tools are called with the `mcp__flashquery__` prefix in clients that expose MCP tool names directly. Example: `mcp__flashquery__write_document`.

This guide describes the current consolidated native host MCP tool surface. The exact native tools visible to a host can be filtered with `host_mcp_tools` in `flashquery.yml`; if `host_mcp_tools` is omitted, all current host-eligible final and transitional native tools are registered. Eligible vault templates may also appear as generated host template tools when template host exposure is enabled; those generated tools are described in [Document References and Templates](./Document%20Reference%20System.md#host-template-tools). Removed legacy names are listed only as migration references near the end.

## Response Conventions

Every tool returns MCP text content:

```json
{
  "content": [{ "type": "text", "text": "{...}" }]
}
```

Most current data tools put JSON in `content[0].text`. Successful tools usually omit `isError`; some explicitly return `isError: false`. Expected errors such as `not_found`, `invalid_input`, `conflict`, `unsupported`, and `ambiguous_identifier` return a JSON error envelope in `content[0].text` and use `isError: false` or omit runtime error semantics. Runtime failures set `isError: true`.

Expected JSON error payloads generally look like:

```json
{
  "error": "not_found",
  "message": "No document matches identifier 'missing.md'",
  "identifier": "missing.md",
  "details": {}
}
```

Batch tools preserve input order and usually return per-item errors inside the successful outer MCP response.

Document mutation tools serialize FlashQuery-managed writes with per-document locks and shared ancestor-directory locks when `locking.enabled` is true. Tools that touch two paths, such as move, copy with a source precondition, or trash removal, acquire the relevant file locks together in a stable order. Lock contention returns an expected conflict envelope with `details.reason: "lock_timeout"`; callers should retry after the competing write finishes. Vault writes use durable atomic replacement, so a successful response means the file write completed on disk before the response was returned.

Many document read and mutation responses include a `version_token`, which is the whole-file SHA-256 fingerprint of the current vault file. Pass that token as `expected_version` or `if_match` on supported mutation tools to opt into lost-update protection. If the file changed before the mutation lock was acquired, the tool returns `error: "conflict"` with the current `version_token` and targeted region details instead of overwriting newer content.

## Documents

### `write_document`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Creating a new Markdown document or updating an existing document body, title, custom frontmatter, or whole tag list.
**Do not use when:** You need heading-aware insertion or section replacement; use `insert_in_doc` or `replace_doc_section`. For additive tag edits, use `apply_tags`.

**Behavior**

`write_document` has explicit `create` and `update` modes. Create mode writes a new vault Markdown file, inserts a `fqc_documents` row, sets FlashQuery-managed frontmatter, and starts a fire-and-forget embedding update. Update mode resolves one existing document by `fq_id`, path, or filename; merges custom frontmatter; replaces the full tag list when `tags` is provided; preserves or sets FlashQuery-managed fields; updates the database row; and starts a background re-embed. When locking is enabled, create and update acquire a per-document lock plus shared locks on ancestor directories; update re-resolves the identifier under the lock before writing. FQ-managed frontmatter fields are rejected if passed directly through `frontmatter`. A `null` custom frontmatter value removes that custom field during update.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `mode` | `"create" \| "update"` | yes | none | Explicit write mode. |
| `identifier` | `string` | update | none | Existing document identifier for update mode. Accepts path, `fq_id`, or filename. |
| `path` | `string` | create | none | Vault-relative path for create mode. Must stay inside the vault and point to a file path. |
| `title` | `string` | create | none | Document title; maps to the canonical title frontmatter field. |
| `content` | `string` | no | `""` on create; existing body on update | Markdown body. |
| `frontmatter` | `object` | no | `{}` | Custom frontmatter. FlashQuery-managed fields are rejected. `null` removes a custom field on update. |
| `tags` | `string[]` | no | `[]` on create; existing tags on update | Replacement tag list, validated and deduplicated. |
| `expected_version` | `string` | no | none | Optional whole-file `version_token` precondition for update mode. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |

Create mode requires `path` and `title`. Update mode requires `identifier` and at least one of `content`, `title`, `frontmatter`, or `tags`.

**Output**

Success returns a document write JSON payload with `mode`, `identifier`, `title`, `path`, `fq_id`, `modified`, `size.chars`, and `version_token`. Create can include warnings such as `plugin_readonly_folder`. Expected errors include `invalid_input`, `conflict`, `not_found`, and `ambiguous_identifier`. Lock timeouts and version mismatches are `conflict` errors; version mismatches include the current `version_token`. Runtime errors set `isError: true`.

**Examples**

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

```json
{
  "mode": "create",
  "identifier": "Projects/Alpha/Plan.md",
  "title": "Alpha Plan",
  "path": "Projects/Alpha/Plan.md",
  "fq_id": "550e8400-e29b-41d4-a716-446655440000",
  "modified": "2026-05-17T12:00:00.000Z",
  "size": { "chars": 23 },
  "version_token": "7f83b1657ff1fc53b92dc18148a1d65dfa135f6b"
}
```

**Related tools**

Use `get_document` to read documents, `insert_in_doc` for anchored insertion, `replace_doc_section` for section replacement, `apply_tags` for additive tag changes, and `remove_document` for trash/delete lifecycle.

### `get_document`

**Status:** final
**Category:** doc-read
**Tier:** read-only
**Use when:** Reading one or more documents, extracting headings or sections, or following a frontmatter pointer.
**Do not use when:** You need search/discovery; use `search` or `list_vault`.

**Behavior**

`get_document` resolves each identifier as a vault-relative path, `fq_id`, or unique filename. A single string returns one flat object. An array returns an ordered array of per-document success or error objects; partial failures do not fail the outer call. By default it includes `body`. Section extraction is case-insensitive substring matching, with digit-leading queries anchored to the heading start. `follow_ref` resolves a dot-separated frontmatter path on the source document and returns the target document under `followed_ref`.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifiers` | `string \| string[]` | yes | none | One or more document identifiers: path, `fq_id`, or filename. |
| `include` | `("body" \| "frontmatter" \| "headings")[]` | no | `["body"]` | Payload sections to include. |
| `sections` | `string[]` | no | none | Heading names to extract. Requires `body` in `include`. |
| `include_nested` | `boolean` | no | `true` | Whether section extraction includes nested subsection content. |
| `occurrence` | `number` | no | `1` | 1-indexed heading occurrence. Valid only when `sections` has exactly one element. |
| `max_depth` | `number` | no | `6` | Heading depth for `headings`, integer 1-6. |
| `follow_ref` | `string` | no | none | Dot path into source frontmatter whose string value is resolved as a document identifier. |

**Output**

Success includes `identifier`, `title`, `path`, `fq_id`, `modified`, and `size.chars`, plus requested `body`, `frontmatter`, `headings`, and/or `followed_ref`. Expected errors use canonical JSON envelopes. `follow_ref` pre-resolution errors appear at the top level; post-resolution target errors can appear under `followed_ref`.

**Examples**

```js
mcp__flashquery__get_document({
  identifiers: "Projects/Alpha/Plan.md",
  include: ["body", "frontmatter", "headings"],
  sections: ["Scope"]
})
```

```json
{
  "identifier": "Projects/Alpha/Plan.md",
  "title": "Alpha Plan",
  "path": "Projects/Alpha/Plan.md",
  "fq_id": "550e8400-e29b-41d4-a716-446655440000",
  "modified": "2026-05-17T12:00:00.000Z",
  "size": { "chars": 320 },
  "body": "## Scope\n\nInitial notes.",
  "frontmatter": {},
  "headings": [{ "level": 2, "text": "Scope", "line": 1, "chars": 15 }]
}
```

**Related tools**

Use `search` to discover documents, `list_vault` to browse paths, and `call_model` document references when the target consumer is a configured model.

### `archive_document`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Hiding documents from normal search while keeping the vault file and FlashQuery identity.
**Do not use when:** You want trash or hard-delete behavior; use `remove_document`.

**Behavior**

Archives one or more documents by setting status to `archived` and preserving the file, `fq_id`, and history. Re-archiving is idempotent. Batch input returns ordered per-item results and errors. Each document write is protected by a per-document lock plus shared ancestor-directory locks when locking is enabled.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifiers` | `string \| string[]` | yes | none | One or more document identifiers: path, `fq_id`, or filename. |
| `expected_version` | `string` | no | none | Optional whole-file `version_token` precondition. For batch input, object-form identifiers can carry per-item `version_token` values. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |
| `version_tokens` | never | no | none | Unsupported; use object-form identifiers with per-item `version_token`. |

**Output**

Single success returns a document identification payload with `status: "archived"`, `archived_at`, and `version_token`. Batch success returns an ordered array. Expected per-item errors include `not_found`, `ambiguous_identifier`, lock conflicts, and version mismatch conflicts.

**Examples**

```js
mcp__flashquery__archive_document({
  identifiers: ["Notes/old.md", "missing.md"]
})
```

```json
[
  {
    "identifier": "Notes/old.md",
    "title": "Old Note",
    "path": "Notes/old.md",
    "fq_id": "550e8400-e29b-41d4-a716-446655440000",
    "modified": "2026-05-17T12:00:00.000Z",
    "size": { "chars": 42 },
    "status": "archived",
    "archived_at": "2026-05-17T12:00:00.000Z",
    "version_token": "7f83b1657ff1fc53b92dc18148a1d65dfa135f6b"
  },
  {
    "error": "not_found",
    "message": "No document matches identifier 'missing.md'",
    "identifier": "missing.md"
  }
]
```

**Related tools**

Use `remove_document` when the document should leave its current vault path. Use `search` with `include_archived: true` to include archived documents.

### `remove_document`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Removing documents from their current vault path through FlashQuery's archive-then-trash/delete lifecycle.
**Do not use when:** You only want reversible archive state; use `archive_document`.

**Behavior**

For each document, `remove_document` first writes archived lifecycle state, updates the database row, then either moves the file into the configured trash folder or physically deletes it when trash is disabled. When trash is enabled, the original path is recorded in frontmatter and trash basename collisions follow configured collision handling. Batch responses preserve input order and return per-document errors. Bulk removal over five items adds a warning. On removal failure after archive writes, it attempts rollback. The source path, and the trash destination when present, are locked together with shared ancestor-directory locks when locking is enabled.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifiers` | `string \| string[]` | yes | none | One or more document identifiers: path, `fq_id`, or filename. |
| `expected_version` | `string` | no | none | Optional source file `version_token` precondition. For batch input, object-form identifiers can carry per-item `version_token` values. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |
| `version_tokens` | never | no | none | Unsupported; use object-form identifiers with per-item `version_token`. |

**Output**

Single success returns document archive fields plus `moved_to`, which is a trash path when trash is enabled or `null` when hard-deleted. The removal result intentionally omits `version_token` because the source path no longer contains the active file after success. Batch success returns `{ "results": [...] }` and may include `warnings`. Lock timeouts and version mismatches are expected conflicts.

**Examples**

```js
mcp__flashquery__remove_document({
  identifiers: ["Scratch/old-plan.md"]
})
```

```json
{
  "identifier": "Scratch/old-plan.md",
  "title": "Old Plan",
  "path": "Scratch/old-plan.md",
  "fq_id": "550e8400-e29b-41d4-a716-446655440000",
  "modified": "2026-05-17T12:00:00.000Z",
  "size": { "chars": 100 },
  "status": "archived",
  "archived_at": "2026-05-17T12:00:00.000Z",
  "moved_to": "Trash/old-plan.md"
}
```

**Related tools**

Use `archive_document` for archive-only behavior and `manage_directory` for empty directory removal.

### `copy_document`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Duplicating one document as a new file with a fresh `fq_id`.
**Do not use when:** You need batch copying or customized metadata during copy; call once per target and update afterward.

**Behavior**

Copies one source document to one destination. It preserves source title, tags, and custom frontmatter, but assigns a new `fq_id`, timestamps, active status, and database row. If `destination` is omitted, it writes to the vault root using a sanitized title filename. It rejects destination conflicts, starts a fire-and-forget embedding update, and locks the destination path with shared ancestor-directory locks when configured. If `expected_version` is supplied, the source and destination paths are locked together and the source is re-read under lock before writing the copy.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifier` | `string` | yes | none | Source document identifier: path, `fq_id`, or filename. Array input is rejected. |
| `destination` | `string` | no | sanitized title at vault root | Vault-relative destination path. |
| `expected_version` | `string` | no | none | Optional source file `version_token` precondition. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |

**Output**

Success returns document identification for the new copy, including `version_token`. Expected errors include `invalid_input`, `conflict`, `not_found`, and `ambiguous_identifier`.

**Examples**

```js
mcp__flashquery__copy_document({
  identifier: "Templates/Contact.md",
  destination: "People/Ada.md"
})
```

```json
{
  "identifier": "People/Ada.md",
  "title": "Contact",
  "path": "People/Ada.md",
  "fq_id": "550e8400-e29b-41d4-a716-446655440000",
  "modified": "2026-05-17T12:00:00.000Z",
  "size": { "chars": 250 },
  "version_token": "7f83b1657ff1fc53b92dc18148a1d65dfa135f6b"
}
```

**Related tools**

Use `move_document` to preserve identity at a new path, and `write_document` to create a customized new file.

### `move_document`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Moving or renaming a document while preserving its identity.
**Do not use when:** You need automatic backlink rewriting or batch moves.

**Behavior**

Moves one document to a destination path, preserving `fq_id`, history, and plugin associations. Intermediate directories are created. If the destination extension is omitted, the source extension is used. Existing links in other files are not updated. Plugin-owned documents can return `warnings: ["plugin_ownership_path_expectation"]`. The tool locks source and destination paths together, wraps those locks in shared ancestor-directory locks, and updates the database path when configured locking is enabled.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifier` | `string` | yes | none | Source document path, `fq_id`, or filename. |
| `destination` | `string` | yes | none | Vault-relative destination path, filename required; extension optional. |
| `expected_version` | `string` | no | none | Optional source file `version_token` precondition. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |

**Output**

Success returns document identification for the moved document, plus optional warnings and `version_token`. Expected errors include `not_found`, `ambiguous_identifier`, `invalid_input`, and `conflict`.

**Examples**

```js
mcp__flashquery__move_document({
  identifier: "Notes/Draft.md",
  destination: "Archive/Draft.md"
})
```

```json
{
  "identifier": "Notes/Draft.md",
  "title": "Draft",
  "path": "Archive/Draft.md",
  "fq_id": "550e8400-e29b-41d4-a716-446655440000",
  "modified": "2026-05-17T12:00:00.000Z",
  "size": { "chars": 120 },
  "version_token": "7f83b1657ff1fc53b92dc18148a1d65dfa135f6b"
}
```

**Related tools**

Use `copy_document` for a fresh identity and `insert_doc_link` or manual edits to update references.

### `insert_in_doc`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Inserting Markdown at the top, bottom, before a heading, after a heading, or at the end of a section.
**Do not use when:** You need to replace or delete a section; use `replace_doc_section`.

**Behavior**

Resolves one document, reads its Markdown body, applies heading-aware insertion, writes the file, updates the content hash in `fqc_documents`, and starts a background embedding update. Heading modes support `contains` or `exact` matching, optional heading level, occurrence disambiguation, and nested-section behavior. `top` and `bottom` reject heading-specific options. The tool acquires a per-document lock with shared ancestor-directory locks when configured.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifier` | `string` | yes | none | Document identifier: path, `fq_id`, or filename. |
| `position` | `"top" \| "bottom" \| "after_heading" \| "before_heading" \| "end_of_section"` | yes | none | Insert position. |
| `content` | `string` | yes | none | Markdown content to insert, excluding the anchor heading. |
| `heading` | `string` | heading modes | none | Anchor heading for `after_heading`, `before_heading`, or `end_of_section`. |
| `occurrence` | `number` | no | `1` | 1-indexed heading occurrence. Omit only when a heading query resolves to one match. |
| `include_nested` | `boolean` | no | `true` | For `end_of_section`, whether child sections are included before insertion point. |
| `heading_match` | `"contains" \| "exact"` | no | `"contains"` | Heading matching mode. |
| `heading_level` | `number` | no | none | Optional Markdown heading level filter, 1-6. |
| `expected_version` | `string` | no | none | Optional whole-file `version_token` precondition. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |

**Output**

Success returns document identification plus `inserted_at` for heading-aware modes and `version_token`. Expected errors include `invalid_input`, `not_found`, `ambiguous_identifier`, and `conflict` for lock timeouts or version mismatches.

**Examples**

```js
mcp__flashquery__insert_in_doc({
  identifier: "Projects/Alpha/Plan.md",
  position: "end_of_section",
  heading: "Tasks",
  content: "- Confirm launch owner",
  include_nested: false
})
```

```json
{
  "identifier": "Projects/Alpha/Plan.md",
  "title": "Alpha Plan",
  "path": "Projects/Alpha/Plan.md",
  "fq_id": "550e8400-e29b-41d4-a716-446655440000",
  "modified": "2026-05-17T12:00:00.000Z",
  "size": { "chars": 350 },
  "inserted_at": {
    "position": "end_of_section",
    "heading": "Tasks",
    "heading_match": "contains",
    "occurrence": 1,
    "include_nested": false
  }
}
```

**Related tools**

Use `replace_doc_section` for replacement/deletion and `write_document` for whole-body replacement.

### `replace_doc_section`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Replacing or deleting one matched Markdown heading section.
**Do not use when:** You only need to append near a section; use `insert_in_doc`.

**Behavior**

Resolves one document, finds a heading by text, optional match mode, optional level, and optional occurrence, then replaces the section body while preserving the heading line. Passing empty `content` deletes the heading and section. With `include_nested: true`, nested headings are part of the replacement range; with `false`, child headings are preserved. The tool writes the file, updates document tracking, and acquires a per-document lock with shared ancestor-directory locks when configured.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifier` | `string` | yes | none | Document path, `fq_id`, or filename. |
| `heading` | `string` | yes | none | Heading text to match. |
| `content` | `string` | yes | none | New section body. Empty string deletes the heading and section. |
| `include_nested` | `boolean` | no | `true` | Whether nested headings are included in the replacement range. |
| `heading_match` | `"contains" \| "exact"` | no | `"contains"` | Heading matching mode. |
| `heading_level` | `number` | no | none | Optional Markdown heading level filter, 1-6. |
| `occurrence` | `number` | no | none | 1-indexed occurrence when multiple headings match. |
| `expected_version` | `string` | no | none | Optional whole-file `version_token` precondition. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |

**Output**

Success returns document identification plus `extracted_section` mutation metadata, top-level `heading_match`, optional top-level `heading_level`, and `version_token`. Expected errors include `not_found`, `ambiguous_identifier`, `invalid_input`, and `conflict` for lock timeouts or version mismatches.

**Examples**

```js
mcp__flashquery__replace_doc_section({
  identifier: "Projects/Alpha/Plan.md",
  heading: "Risks",
  heading_match: "exact",
  content: "No open risks."
})
```

```json
{
  "identifier": "Projects/Alpha/Plan.md",
  "title": "Alpha Plan",
  "path": "Projects/Alpha/Plan.md",
  "fq_id": "550e8400-e29b-41d4-a716-446655440000",
  "modified": "2026-05-17T12:00:00.000Z",
  "size": { "chars": 300 },
  "extracted_section": {
    "heading": "Risks",
    "level": 2,
    "old_content_length": 84,
    "new_content_length": 14,
    "include_nested": true,
    "heading_removed": false
  },
  "heading_match": "exact"
}
```

**Related tools**

Use `insert_in_doc` to insert without replacing and `get_document` with `sections` to inspect before changing.

### `apply_tags`

**Status:** final
**Category:** doc-write, memory
**Tier:** read-write
**Use when:** Adding or removing tags idempotently on explicit document and memory targets.
**Do not use when:** You need to replace a document or memory's entire tag list; use `write_document` or `write_memory`.

**Behavior**

`apply_tags` accepts the current `targets` array or transitional convenience inputs for document identifiers or one memory ID. It normalizes tags, applies idempotent additions and no-op removals, validates final tag sets, and returns ordered per-target results. Document targets update frontmatter and `fqc_documents` under the same per-document/ancestor-directory lock pattern as other document writes; memory targets update `fqc_memory`. If memory is disabled by config, memory targets return per-item `unsupported`.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `targets` | `{ entity_type, identifier }[]` | preferred | none | Ordered explicit targets. `entity_type` is `"document"` or `"memory"`. |
| `identifiers` | `string \| string[]` | no | none | Convenience input for document targets. Use instead of `targets`. |
| `memory_id` | `string` | no | none | Convenience input for one memory target. Use instead of `targets`. |
| `add_tags` | `string[]` | conditional | none | Tags to add. At least one of `add_tags` or `remove_tags` is required. |
| `remove_tags` | `string[]` | conditional | none | Tags to remove. Missing tags are silent no-ops. |
| `expected_version` | `string` | no | none | Optional document `version_token` precondition for document targets. |
| `if_match` | `string` | no | none | Alias for `expected_version`. |
| `version_tokens` | never | no | none | Unsupported; use object-form document targets with per-item `version_token`. |

**Output**

Success returns an ordered array. Document items contain document identification, `tags`, `entity_type: "document"`, and `version_token`. Memory items contain memory identification, `tags`, and `entity_type: "memory"`. Per-target expected errors are embedded in the array.

**Examples**

```js
mcp__flashquery__apply_tags({
  targets: [{ entity_type: "document", identifier: "Notes/Idea.md" }],
  add_tags: ["planning"],
  remove_tags: ["draft"]
})
```

```json
[
  {
    "identifier": "Notes/Idea.md",
    "title": "Idea",
    "path": "Notes/Idea.md",
    "fq_id": "550e8400-e29b-41d4-a716-446655440000",
    "modified": "2026-05-17T12:00:00.000Z",
    "size": { "chars": 120 },
    "tags": ["planning"],
    "entity_type": "document",
    "version_token": "7f83b1657ff1fc53b92dc18148a1d65dfa135f6b"
  }
]
```

**Related tools**

Use `write_document` or `write_memory` for replacement semantics and `search` for tag-filtered discovery.

## Memories

### `write_memory`

**Status:** final
**Category:** memory
**Tier:** read-write
**Use when:** Creating a persistent memory or creating a new latest version of an existing memory.
**Do not use when:** You only need retrieval or search; use `get_memory` or `search`.

**Behavior**

Create mode inserts a new active memory with version `1`, a chain root, optional tags, optional plugin scope, and a background embedding update. Update mode requires an existing latest memory and creates a new latest version through the memory-version RPC; it does not mutate a historical version in place. In update mode, omitted `content` preserves existing content and omitted `tags` preserves existing tags. The plugin scope is preserved on update. The tool acquires the `memory` lock when configured.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `mode` | `"create" \| "update"` | yes | none | Memory write mode. |
| `content` | `string` | create | existing content on update | Memory content or replacement content. |
| `memory_id` | `string` | update | none | Existing latest memory ID for update mode. |
| `tags` | `string[]` | no | `[]` on create; existing tags on update | Validated memory tags. Replaces the list in update mode. |
| `plugin_scope` | `string` | no | global | Plugin scope for create mode. Fuzzy-resolved to a registered plugin when possible. |
| `include` | `("content" \| "tags_full")[]` | no | identification only | Optional payload fields. |

**Output**

Success returns memory identification: `memory_id`, `content_preview`, `tags`, `plugin_scope`, `created_at`, and `updated_at`, plus version metadata and optional `content`/`tags_full` when requested. Expected errors include `invalid_input`, `not_found`, `conflict`, and tag validation errors.

**Examples**

```js
mcp__flashquery__write_memory({
  mode: "create",
  content: "The user prefers concise implementation updates.",
  tags: ["preference"],
  include: ["content"]
})
```

```json
{
  "memory_id": "550e8400-e29b-41d4-a716-446655440000",
  "content_preview": "The user prefers concise implementation updates.",
  "tags": ["preference"],
  "plugin_scope": "global",
  "version": 1,
  "previous_version_id": null,
  "is_latest": true,
  "archived_at": null,
  "created_at": "2026-05-17T12:00:00.000Z",
  "updated_at": "2026-05-17T12:00:00.000Z",
  "content": "The user prefers concise implementation updates."
}
```

**Related tools**

Use `get_memory` for exact retrieval, `archive_memory` to hide a memory chain, and `apply_tags` for additive tag changes.

### `get_memory`

**Status:** final
**Category:** memory
**Tier:** read-only
**Use when:** Retrieving one or more memories by exact ID.
**Do not use when:** You need to discover memories by query or tag; use `search`.

**Behavior**

Fetches one or more memory rows by ID scoped to the current FlashQuery instance. A single ID returns one object or an expected `not_found` error. Array input returns ordered per-ID results and per-ID errors.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `memory_ids` | `string \| string[]` | yes | none | Single memory ID or ordered array of IDs. |
| `include` | `("content" \| "tags_full")[]` | no | identification only | Optional payload fields. |

**Output**

Success returns memory identification plus version fields and optional included fields. Batch output is an ordered array.

**Examples**

```js
mcp__flashquery__get_memory({
  memory_ids: "550e8400-e29b-41d4-a716-446655440000",
  include: ["content", "tags_full"]
})
```

```json
{
  "memory_id": "550e8400-e29b-41d4-a716-446655440000",
  "content_preview": "The user prefers concise implementation updates.",
  "tags": ["preference"],
  "plugin_scope": "global",
  "version": 1,
  "previous_version_id": null,
  "is_latest": true,
  "archived_at": null,
  "created_at": "2026-05-17T12:00:00.000Z",
  "updated_at": "2026-05-17T12:00:00.000Z",
  "content": "The user prefers concise implementation updates.",
  "tags_full": ["preference"]
}
```

**Related tools**

Use `search` to find memory IDs and `write_memory` to create or version memories.

### `archive_memory`

**Status:** final
**Category:** memory
**Tier:** read-write
**Use when:** A memory is outdated, wrong, or should stop appearing in default search.
**Do not use when:** You want to preserve and correct a memory; use `write_memory` with `mode: "update"`.

**Behavior**

Archives one or more memory version chains. The preferred input is `memory_ids`; the singular `memory_id` is still accepted by the handler during migration. Archive is idempotent across the chain and records `archived_at`. Empty arrays return an empty array.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `memory_ids` | `string \| string[]` | preferred | none | Single memory ID or ordered array of IDs to archive. |
| `memory_id` | `string` | no | none | Legacy singular memory ID accepted during migration. |

**Output**

Success returns one memory result for single input, one error object for a failed single input, or an ordered array for batch input. Successful archive payloads include memory identification, version fields, `status: "archived"`, `archived_at`, and `archived_version_count`. Per-item errors include `not_found`.

**Examples**

```js
mcp__flashquery__archive_memory({
  memory_ids: ["550e8400-e29b-41d4-a716-446655440000"]
})
```

```json
[
  {
    "memory_id": "550e8400-e29b-41d4-a716-446655440000",
    "content_preview": "The user prefers concise implementation updates.",
    "tags": ["preference"],
    "plugin_scope": "global",
    "version": 1,
    "previous_version_id": null,
    "is_latest": true,
    "created_at": "2026-05-17T12:00:00.000Z",
    "updated_at": "2026-05-17T12:00:00.000Z",
    "archived_at": "2026-05-17T12:00:00.000Z",
    "status": "archived",
    "archived_version_count": 1
  }
]
```

**Related tools**

Use `search` with `include_archived: true` to include archived memories and `write_memory` to create a replacement version.

## Search And Vault Browsing

### `search`

**Status:** final
**Category:** doc-read, memory
**Tier:** read-only
**Use when:** Searching documents and memories by title, path, tags, content preview/text, semantic similarity, or mixed mode.
**Do not use when:** You need literal body grep, regex, line ranges, or byte ranges; those parameters are explicitly unsupported.

**Behavior**

`search` unifies document and memory search. `mode: "filesystem"` uses document title/path/tags and memory content/tags. `mode: "semantic"` uses embeddings and returns `unsupported` if semantic search is unavailable. `mode: "mixed"` combines semantic and filesystem results and falls back with warnings when embeddings are unavailable. Empty query requires filters or `list_all: true`; filtered list-mode also requires explicit `entity_types` so the target domains are unambiguous. Archived entities are excluded unless `include_archived` is true.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `query` | `string` | no | none | Search query. Empty query is list-mode and requires filters or `list_all: true`; filtered list-mode requires explicit `entity_types`. |
| `mode` | `"filesystem" \| "semantic" \| "mixed"` | no | `"mixed"` | Search mode. |
| `tags` | `string[]` | no | none | Tag filter. |
| `tag_match` | `"any" \| "all"` | no | `"any"` | Tag matching mode. |
| `limit` | `number` | no | `10` | Global result limit after merge/dedupe/sort. |
| `entity_types` | `("documents" \| "memories")[]` | no | enabled domains | Search domains. |
| `list_all` | `boolean` | no | `false` | Allows empty unfiltered list-mode search. |
| `path_filter` | `string` | no | none | Document path substring filter for filesystem/list searches. |
| `include_archived` | `boolean` | no | `false` | Include archived documents and memories. |
| `body_contains`, `body_regex`, `regex`, `line_range`, `lines`, `byte_range` | `unknown` | no | none | Unsupported literal body-search parameters; return validation guidance. |

**Output**

Success returns `{ query, entity_types, mode, total, warnings?, results }`. Document results include `entity_type`, `identifier`, `title`, `path`, `fq_id`, `tags`, `modified`, `size`, `match_source`, and optional `score`. Memory results include `entity_type`, `identifier`, `memory_id`, `content_preview`, `tags`, `plugin_scope`, timestamps, `match_source`, and optional `score`.

**Examples**

```js
mcp__flashquery__search({
  query: "alpha launch risks",
  entity_types: ["documents"],
  mode: "mixed",
  limit: 10
})
```

```json
{
  "query": "alpha launch risks",
  "entity_types": ["documents"],
  "mode": "mixed",
  "total": 1,
  "results": [
    {
      "entity_type": "document",
      "identifier": "Projects/Alpha/Plan.md",
      "title": "Alpha Plan",
      "path": "Projects/Alpha/Plan.md",
      "fq_id": "550e8400-e29b-41d4-a716-446655440000",
      "tags": ["project"],
      "modified": "2026-05-17T12:00:00.000Z",
      "size": { "chars": 320 },
      "match_source": ["filesystem"]
    }
  ]
}
```

**Related tools**

Use `get_document` or `get_memory` after search returns exact IDs. Use `search_records` for plugin-owned structured records.

### `list_vault`

**Status:** final
**Category:** doc-read
**Tier:** read-only
**Use when:** Browsing vault structure and metadata without reading full document bodies.
**Do not use when:** You need semantic or tag/content search; use `search`.

**Behavior**

Lists files and/or directories under a vault directory. Root paths such as `/`, empty string, or `.` list the vault root. Dotfiles and dot-directories are skipped. Symlinks are skipped silently. Directories sort by depth then path; files sort newest-first by selected date field. Optional tracking enrichment reads `fqc_documents` for tracked Markdown files. Date filters accept ISO dates or relative forms such as `7d`, `24h`, or `1w`.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `path` | `string` | no | `"/"` | Vault-relative directory path. Must be a directory. |
| `show` | `"files" \| "directories" \| "all"` | no | `"all"` | Entry types to include. |
| `include` | `("metadata" \| "tracking")[]` | no | `[]` | `metadata` adds created/children fields; `tracking` adds title, tags, status, and `fq_id` for tracked files. |
| `recursive` | `boolean` | no | `false` | Walk subdirectories recursively. |
| `extensions` | `string[]` | no | none | Case-insensitive file extension filter. Ignored for `show: "directories"`. |
| `after` | `string` | no | none | Date filter for entries after a relative or ISO time. |
| `before` | `string` | no | none | Date filter for entries before a relative or ISO time. |
| `date_field` | `"updated" \| "created"` | no | `"updated"` | Timestamp used for filtering and file sorting. |
| `limit` | positive integer | no | `200` | Maximum returned entries. |

**Output**

Success returns `{ path, total, displayed, truncated, entries }`. File entries include `name`, `path`, `type: "file"`, `modified`, and `size.chars`; tracking fields are optional. Directory entries include `name`, `path`, `type: "directory"`, `modified`, and `size.entries`; metadata can add `created` and `children`.

**Examples**

```js
mcp__flashquery__list_vault({
  path: "Projects",
  recursive: true,
  include: ["metadata", "tracking"],
  limit: 50
})
```

```json
{
  "path": "Projects",
  "total": 1,
  "displayed": 1,
  "truncated": false,
  "entries": [
    {
      "name": "Plan.md",
      "path": "Projects/Alpha/Plan.md",
      "type": "file",
      "modified": "2026-05-17T12:00:00.000Z",
      "size": { "chars": 320 },
      "title": "Alpha Plan",
      "tags": ["project"],
      "status": "active",
      "fq_id": "550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}
```

**Related tools**

Use `get_document` to read a file returned by `list_vault` and `manage_directory` to create, remove, rename, or move directories.

## Directories And Maintenance

### `manage_directory`

**Status:** final
**Category:** doc-write
**Tier:** read-write
**Use when:** Creating, removing, renaming, or moving vault folders.
**Do not use when:** You need file/document lifecycle; use document tools.

**Behavior**

Processes directory paths in order. Create mode is recursive and idempotent: existing directories return `status: "unchanged"`. Remove mode removes only empty directories and returns per-path conflicts for non-empty directories. Rename and move modes require `destinations` aligned positionally with `paths`, reject existing destinations, and lock source and destination directories together in stable order when locking is enabled. Paths are normalized, sanitized, and validated to stay inside the vault. Partial successes stay in the ordered results array.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `action` | `"create" \| "remove" \| "rename" \| "move"` | yes | none | Directory operation. |
| `paths` | `string[]` | yes | none | Vault-relative directory paths to process in order. Duplicate paths execute sequentially. |
| `destinations` | `string[]` | rename/move | none | Vault-relative destination directories. Required for `rename` and `move`, and must have the same length/order as `paths`. |

**Output**

Always returns JSON `{ "results": [...] }` with `isError: false` for normal per-path outcomes. Success items contain `path`, `action`, `status`, and `timestamp`. Error items contain canonical error fields.

**Examples**

```js
mcp__flashquery__manage_directory({
  action: "create",
  paths: ["Projects/Alpha", "Projects/Beta"]
})
```

```json
{
  "results": [
    {
      "path": "Projects/Alpha",
      "action": "create",
      "status": "created",
      "timestamp": "2026-05-17T12:00:00.000Z"
    }
  ]
}
```

**Related tools**

Use `write_document` to create files inside directories, `move_document` to move a single document while preserving its identity, and `remove_document` to remove files.

### `maintain_vault`

**Status:** final
**Category:** system
**Tier:** admin
**Use when:** Running administrative vault sync, repair, or background job status checks after external file changes.
**Do not use when:** A normal read/write tool can answer the request; normal tools return current authoritative state.

**Behavior**

Delegates to the maintenance service. `sync` scans external filesystem changes. `repair` reconciles tracked document state. Arrays can include `sync` and `repair`, with repair running before sync. `background` is valid only for `sync`; `dry_run` is valid only for `repair`; `status` requires `job_id`.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `action` | `"sync" \| "repair" \| "status" \| ("sync" \| "repair")[]` | yes | none | Maintenance action or run action array. |
| `dry_run` | `boolean` | no | `false` | Only valid for repair. |
| `background` | `boolean` | no | `false` | Only valid for sync. |
| `job_id` | `string` | status | none | Required for `action: "status"`. |

**Output**

Success returns the maintenance service payload. Run results include action timing, `dry_run`, counts for scanned/added/updated/repaired/archived, and optional warnings. Background sync returns job metadata; status returns job status. Expected validation errors use canonical JSON; runtime maintenance failures set `isError: true`.

**Examples**

```js
mcp__flashquery__maintain_vault({
  action: ["repair", "sync"],
  dry_run: false
})
```

```json
{
  "actions": [
    {
      "action": "repair",
      "started_at": "2026-05-17T12:00:00.000Z",
      "finished_at": "2026-05-17T12:00:01.000Z",
      "dry_run": false,
      "counts": { "scanned": 10, "added": 0, "updated": 1, "repaired": 1, "archived": 0 }
    }
  ]
}
```

**Related tools**

Use `list_vault`, `search`, and `get_document` for normal discovery and reads.

## Plugins And Records

### `register_plugin`

**Status:** final
**Category:** plugin
**Tier:** admin
**Use when:** Registering a plugin schema or applying a safe additive schema update.
**Do not use when:** You only need to inspect an installed plugin; use `get_plugin_info`.

**Behavior**

Reads plugin YAML from `schema_path` or `schema_yaml`, defaulting `plugin_instance` to `default`. `schema_path` takes precedence when both are provided. First registration creates plugin tables, inserts a registry row, loads the plugin manager, rebuilds type registry, and reloads manifests. Same-version re-registration is idempotent. Version upgrades analyze schema changes and apply safe additive table/column changes; unsafe removals or type changes return a `conflict` with guidance. Version downgrades update registry metadata without DDL downgrade. Plugin table names use the plugin and instance prefix.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `schema_path` | `string` | conditional | none | Path to YAML schema file on disk. Takes precedence over `schema_yaml`. |
| `schema_yaml` | `string` | conditional | none | Inline YAML schema. Required when `schema_path` is absent. |
| `plugin_instance` | `string` | no | `"default"` | Plugin instance identifier. |

**Output**

First registration, same-version re-registration, and version downgrades return plugin identification plus `registered_at`, `was_new`, `plugin_instance`, and `schema_version`. Safe additive upgrades return `status: "registered"`, `schema_version`, and `safe_change_count`; that upgrade response is intentionally narrower and does not include every first-registration field. Expected errors include invalid input and unsafe migration `conflict`. Runtime errors cover YAML/DDL/database failures.

**Examples**

```js
mcp__flashquery__register_plugin({
  schema_yaml: "plugin:\n  id: crm\n  name: CRM\n  version: 1.0.0\ntables: []"
})
```

```json
{
  "plugin_id": "crm",
  "name": "CRM",
  "status": "registered",
  "table_count": 0,
  "registered_at": "2026-05-17T12:00:00.000Z",
  "was_new": true,
  "plugin_instance": "default",
  "schema_version": "1.0.0"
}
```

**Related tools**

Use `get_plugin_info` after registration, `unregister_plugin` for removal, and `write_record` for plugin-owned rows.

### `get_plugin_info`

**Status:** final
**Category:** plugin
**Tier:** read-only
**Use when:** Inspecting a registered plugin's tables, schema, or status details.
**Do not use when:** You need to create or update plugin registration; use `register_plugin`.

**Behavior**

Reads the in-memory plugin manager entry for `plugin_id` and `plugin_instance`. Defaults include to `["tables"]`. Returns an expected `not_found` error if the plugin instance is not registered.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `plugin_id` | `string` | yes | none | Plugin identifier. |
| `plugin_instance` | `string` | no | `"default"` | Plugin instance identifier. |
| `include` | `("schema" \| "tables" \| "status_detail")[]` | no | `["tables"]` | Payload sections to include. |

**Output**

Success returns plugin identification. Optional `tables` is a list of schema table names, `schema` is the parsed schema object, and `status_detail` includes `plugin_instance`, `table_prefix`, and version.

**Examples**

```js
mcp__flashquery__get_plugin_info({
  plugin_id: "crm",
  include: ["tables", "status_detail"]
})
```

```json
{
  "plugin_id": "crm",
  "name": "CRM",
  "status": "registered",
  "table_count": 2,
  "tables": ["contacts", "opportunities"],
  "status_detail": {
    "plugin_instance": "default",
    "table_prefix": "fqcp_crm_default_",
    "version": "1.0.0"
  }
}
```

**Related tools**

Use `register_plugin` to create/update registrations and `search_records` to inspect plugin data.

### `unregister_plugin`

**Status:** final
**Category:** plugin
**Tier:** admin
**Use when:** Removing a plugin registry entry and clearing FlashQuery plugin state.
**Do not use when:** You want to delete plugin table rows; forced unregister leaves live records orphaned.

**Behavior**

Inventories plugin tables and live active rows. Without `force`, live records return a `conflict`. With `force: true`, the registry entry and pending review state are removed, in-memory plugin state is unloaded, type registry and manifests are refreshed, document ownership is cleared, and plugin-scoped memories are deleted. Existing plugin table rows are not dropped and can be orphaned. The tool acquires the `plugins` lock when configured.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `plugin_id` | `string` | yes | none | Plugin identifier. |
| `plugin_instance` | `string` | no | `"default"` | Plugin instance identifier. |
| `force` | `boolean` | no | `false` | Unregister even when live records exist. |

**Output**

Success returns plugin identification with `status: "unregistered"`, `plugin_instance`, `unregistered_at`, `documents_ownership_cleared`, `plugin_scoped_memories_deleted`, and optional warning `orphaned_records: N`.

**Examples**

```js
mcp__flashquery__unregister_plugin({
  plugin_id: "crm",
  force: true
})
```

```json
{
  "plugin_id": "crm",
  "name": "CRM",
  "status": "unregistered",
  "table_count": 2,
  "plugin_instance": "default",
  "unregistered_at": "2026-05-17T12:00:00.000Z",
  "documents_ownership_cleared": 0,
  "plugin_scoped_memories_deleted": 0,
  "warnings": ["orphaned_records: 3"]
}
```

**Related tools**

Use `archive_record` to archive individual records before unregistering and `clear_pending_reviews` for review queue administration.

### `write_record`

**Status:** final
**Category:** plugin
**Tier:** read-write
**Use when:** Creating or updating one schema-validated plugin-owned structured record.
**Do not use when:** The data belongs in Markdown documents or memories.

**Behavior**

Validates the plugin table, validates input against the plugin schema, runs plugin document reconciliation as a preamble, then inserts or updates one row in the plugin table. Create mode rejects caller-provided `id`; update mode requires `id`. Tables with `embed_fields` start fire-and-forget embedding updates. The response can include reconciliation and pending review payloads. The tool acquires the `records` lock when configured.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `mode` | `"create" \| "update"` | yes | none | Record write mode. |
| `plugin_id` | `string` | yes | none | Plugin identifier. |
| `plugin_instance` | `string` | no | `"default"` | Plugin instance identifier. |
| `table` | `string` | yes | none | Table name from plugin schema. |
| `id` | `string` | update | none | Record UUID. Required for update and not allowed for create. |
| `data` | `object` | yes | none | Schema-validated record fields. |
| `include` | `("data" \| "schema_metadata")[]` | no | identification only | Optional payload sections. |

**Output**

Success returns record identification: `id`, `plugin_id`, `table`, `created_at`, and `updated_at`, plus optional `data`, `schema_metadata`, `reconciliation`, and `pending_review`. Expected errors include invalid input, table not found, record not found, and schema validation failures.

**Examples**

```js
mcp__flashquery__write_record({
  mode: "create",
  plugin_id: "crm",
  table: "contacts",
  data: { name: "Ada Lovelace", status: "active" },
  include: ["data"]
})
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "plugin_id": "crm",
  "table": "contacts",
  "created_at": "2026-05-17T12:00:00.000Z",
  "updated_at": "2026-05-17T12:00:00.000Z",
  "data": { "name": "Ada Lovelace", "status": "active" }
}
```

**Related tools**

Use `get_record`, `search_records`, and `archive_record` for record lifecycle reads and archival.

### `get_record`

**Status:** final
**Category:** plugin
**Tier:** read-only
**Use when:** Retrieving one plugin-owned record by exact ID.
**Do not use when:** You need filtering or text search; use `search_records`.

**Behavior**

Runs plugin document reconciliation as a preamble, validates the plugin table, fetches one row scoped to the current FlashQuery instance, and returns a record payload. Missing rows return expected `not_found`.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `plugin_id` | `string` | yes | none | Plugin identifier. |
| `plugin_instance` | `string` | no | `"default"` | Plugin instance identifier. |
| `table` | `string` | yes | none | Table name from plugin schema. |
| `id` | `string` | yes | none | Record UUID. |
| `include` | `("data" \| "schema_metadata")[]` | no | `["data"]` | Optional payload sections. |

**Output**

Success returns record identification plus included data and optional reconciliation/pending review payloads.

**Examples**

```js
mcp__flashquery__get_record({
  plugin_id: "crm",
  table: "contacts",
  id: "550e8400-e29b-41d4-a716-446655440000",
  include: ["data"]
})
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "plugin_id": "crm",
  "table": "contacts",
  "created_at": "2026-05-17T12:00:00.000Z",
  "updated_at": "2026-05-17T12:00:00.000Z",
  "data": { "name": "Ada Lovelace", "status": "active" }
}
```

**Related tools**

Use `write_record` to create/update and `search_records` to discover records.

### `archive_record`

**Status:** final
**Category:** plugin
**Tier:** read-write
**Use when:** Soft-archiving plugin-owned records while preserving history.
**Do not use when:** You need to update fields; use `write_record`.

**Behavior**

Processes ordered archive targets. For each target, it runs plugin document reconciliation, validates the table, sets `status: "archived"` and `updated_at`, and sets `archived_at` when the table has that column. Tables without `archived_at` return `warnings: ["archived_at_unavailable"]`. The tool acquires the `records` lock when configured.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `targets` | `{ plugin_id, plugin_instance?, table, id }[]` | yes | none | Ordered archive targets. |

**Output**

Success returns an ordered array of record payloads or per-target errors. Runtime database failures can fail the outer call.

**Examples**

```js
mcp__flashquery__archive_record({
  targets: [{ plugin_id: "crm", table: "contacts", id: "550e8400-e29b-41d4-a716-446655440000" }]
})
```

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "plugin_id": "crm",
    "table": "contacts",
    "created_at": "2026-05-17T12:00:00.000Z",
    "updated_at": "2026-05-17T12:05:00.000Z",
    "archived_at": "2026-05-17T12:05:00.000Z"
  }
]
```

**Related tools**

Use `search_records` to find record IDs and `unregister_plugin` only for plugin registry lifecycle.

### `search_records`

**Status:** final
**Category:** plugin
**Tier:** read-only
**Use when:** Searching or filtering plugin-owned structured records.
**Do not use when:** You need documents or memories; use `search`.

**Behavior**

Can search one plugin table or, with `taggable_tables_only: true`, all registered plugin tables that have a `tags` or `tag` column. For one table, filters are equality predicates combined with AND; the `tag` field is echoed in the response but is only applied as a database filter in `taggable_tables_only` mode. With `query` and `embed_fields`, semantic vector search is used. With `query` and no embedding fields, text columns are searched with ILIKE. With no query, filters-only search runs. All normal searches are scoped to active rows in the current FlashQuery instance. Record tools run plugin document reconciliation as a preamble.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `plugin_id` | `string` | conditional | none | Required unless `taggable_tables_only` is true. |
| `plugin_instance` | `string` | no | `"default"` | Plugin instance identifier. |
| `table` | `string` | conditional | none | Required unless `taggable_tables_only` is true. |
| `filters` | `object` | no | none | Field equality filters. |
| `query` | `string` | no | none | Text or semantic query. |
| `tag` | `string` | no | none | Tag filter for `taggable_tables_only` aggregation. In single-table mode it is returned in the envelope but does not add a tag predicate. |
| `taggable_tables_only` | `boolean` | no | `false` | Search all registered taggable plugin tables. |
| `include` | `("data" \| "schema_metadata")[]` | no | result defaults | Optional payload sections. |
| `limit` | `number` | no | `10` | Maximum result count. |

**Output**

Single-table success returns a search envelope with `plugin_id`, `table`, `query`, optional `tag`, `total`, and `results`. `taggable_tables_only` success omits top-level `plugin_id` and `table`; each result carries its own record identification. Results contain record identification and optional `data`, `schema_metadata`, semantic `score`, and reconciliation information. If no taggable tables exist, returns total `0` with warning `plugin_no_taggable_tables`.

**Examples**

```js
mcp__flashquery__search_records({
  plugin_id: "crm",
  table: "contacts",
  filters: { status: "active" },
  query: "Ada",
  include: ["data"],
  limit: 5
})
```

```json
{
  "plugin_id": "crm",
  "table": "contacts",
  "query": "Ada",
  "total": 1,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "plugin_id": "crm",
      "table": "contacts",
      "created_at": "2026-05-17T12:00:00.000Z",
      "updated_at": "2026-05-17T12:00:00.000Z",
      "data": { "name": "Ada Lovelace", "status": "active" }
    }
  ]
}
```

**Related tools**

Use `get_record` for exact ID retrieval and `search` for documents/memories.

### `clear_pending_reviews`

**Status:** final
**Category:** plugin
**Tier:** admin
**Use when:** Listing or clearing pending plugin reconciliation review rows.
**Do not use when:** You need normal record lifecycle; use record tools.

**Behavior**

`action: "list"` returns matching pending review rows. `action: "clear"` deletes rows scoped by `plugin_id`, `ids`, or all current-instance pending rows when no filters are provided. The instance scope is the FlashQuery server instance ID, not the plugin instance name. Clearing by IDs with no matches returns warning `no_matching_items`.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `action` | `"list" \| "clear"` | yes | none | List or clear pending review rows. |
| `plugin_id` | `string` | no | none | Optional plugin filter. |
| `ids` | `string[]` | no | none | Pending review row IDs returned by list mode. |

**Output**

List mode returns `{ pending, items }`. Clear mode returns `{ cleared, items, warnings? }`. Each item includes `id`, `fqc_id`, `type`, `plugin_id`, `table`, `path`, and `context`.

**Examples**

```js
mcp__flashquery__clear_pending_reviews({
  action: "list",
  plugin_id: "crm"
})
```

```json
{
  "pending": 1,
  "items": [
    {
      "id": "review-row-id",
      "fqc_id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "orphaned_document",
      "plugin_id": "crm",
      "table": "contacts",
      "path": "People/Ada.md",
      "context": {}
    }
  ]
}
```

**Related tools**

Use `get_record`, `write_record`, and `archive_record` for record lifecycle changes.

## LLM And Macro Tools

### `call_model`

**Status:** final
**Category:** llm
**Tier:** admin
**Use when:** Calling a configured model or purpose, discovering model/purpose configuration, or hydrating document references for model calls.
**Do not use when:** You need local data operations; use the direct MCP tools. It is hard-excluded from delegated native tool access because it can recursively call models.

**Behavior**

`call_model` is always registered. If `llm:` is absent, only `resolver: "help"` succeeds; other resolvers return an LLM-not-configured runtime error. Execution resolvers `model` and `purpose` require `name` and `messages`. Discovery resolvers `list_models`, `list_purposes`, `search`, and `help` do not call a provider. Before execution calls, FlashQuery hydrates host-authored `{{ref:...}}` placeholders only in original `system` and `user` messages. Reference failures return `reference_resolution_failed` before any model call. Purpose calls may run a managed tool loop when the purpose exposes native tools or templates. Caller-provided provider tools are rejected; delegated model tool access is controlled by purpose configuration. When `trace_id` is provided, usage rows are correlated and response metadata includes trace totals.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `resolver` | `"model" \| "purpose" \| "list_models" \| "list_purposes" \| "search" \| "help"` | yes | none | Execution or discovery resolver. |
| `name` | `string` | model/purpose | none | Model alias or purpose name. Ignored by discovery resolvers. |
| `messages` | OpenAI-style message array | model/purpose | none | Required for execution. References are hydrated only in original system/user string content. |
| `return_messages` | `boolean` | no | `false` | Include post-hydration messages and final assistant message on success. |
| `parameters` | `object` | no | `{}` | Provider parameters and FlashQuery loop controls. For `search`, must contain non-empty `query`. |
| `template_params` | `object` | no | `{}` | Template/alias parameters for host-authored reference hydration. Ignored by discovery. |
| `trace_id` | `string` | no | none | Usage correlation ID. |

**Output**

Execution success returns a `CallModelEnvelope` JSON payload:

```json
{
  "response": "The model response.",
  "messages": [],
  "metadata": {
    "resolver": "purpose",
    "name": "summarizer",
    "resolved_model_name": "fast",
    "provider_name": "openai",
    "fallback_position": 1,
    "tokens": { "input": 1200, "output": 300 },
    "cost_usd": 0.00036,
    "latency_ms": 1800
  }
}
```

Discovery calls return resolver-specific JSON, not the execution envelope. `help` works even when LLM execution is unconfigured. `resolver: "search"` without `parameters.query` returns `isError: true` with text guidance.

**Examples**

```js
mcp__flashquery__call_model({
  resolver: "purpose",
  name: "summarizer",
  messages: [
    { role: "user", content: "Summarize {{ref:Docs/brief.md}}" }
  ],
  return_messages: true
})
```

```json
{
  "response": "Brief summary...",
  "messages": [
    { "role": "user", "content": "Summarize <hydrated document body>" },
    { "role": "assistant", "content": "Brief summary..." }
  ],
  "metadata": {
    "resolver": "purpose",
    "name": "summarizer",
    "resolved_model_name": "fast",
    "provider_name": "openai",
    "fallback_position": 1,
    "tokens": { "input": 1200, "output": 300 },
    "cost_usd": 0.00036,
    "latency_ms": 1800,
    "injected_references": [{ "ref": "{{ref:Docs/brief.md}}", "chars": 1000 }],
    "prompt_chars": 1030
  }
}
```

**Related tools**

See `docs/Document Reference System.md` for reference syntax and `docs/LLM Providers Models and Purposes.md` for configuration. Use `search_tools` for host or delegated tool discovery when tool search is enabled and `get_llm_usage` for usage reporting.

### `search_tools`

**Status:** final
**Category:** llm
**Tier:** read-only
**Use when:** Discovering the visible FlashQuery-native and brokered tool surface by intent.
**Do not use when:** You need to execute a tool or retrieve vault data; call the selected tool directly after discovery.

**Behavior**

Searches a BM25-style index of visible tools and returns ranked discovery results. As a host MCP tool, it searches the host-visible native tool surface, generated host template tools, and host-visible brokered MCP tools after the host tool-search index has been initialized; brokered host tools are indexed only when `host.tool_search: enabled`. Inside a managed `call_model` purpose loop, `tool_search: enabled` exposes this discovery tool so the delegated model can search the purpose-visible native, template, and brokered tool index before making direct calls. The search result is discovery metadata only; it does not execute the returned tool.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `query` | `string` | yes | none | Natural-language search query over tool names, descriptions, and argument summaries. |
| `limit` | positive integer up to 50 | no | `8` | Maximum number of ranked tool matches. |

**Output**

Success returns a JSON array of ranked results. Each result includes `server`, `tool`, `registry_key`, `description`, `arg_summary`, `score`, `normalizedScore`, and `has_help`. Native FlashQuery tools also include `help_hint`. Invalid input returns `isError: true` with text beginning `search_tools invalid input:`.

**Examples**

```js
mcp__flashquery__search_tools({
  query: "read a vault document with frontmatter",
  limit: 5
})
```

```json
[
  {
    "server": "flashquery",
    "tool": "get_document",
    "registry_key": "get_document",
    "description": "Read one or more vault documents and return structured document data.",
    "arg_summary": [
      { "name": "identifiers", "description": "One or more document identifiers.", "required": false }
    ],
    "score": 3.42,
    "normalizedScore": 1,
    "has_help": true,
    "help_hint": "Pass help:true to this tool for full usage guidance."
  }
]
```

**Related tools**

Use `call_model` with a `tool_search: enabled` purpose when a delegated model should discover tools during a managed loop. Use `call_macro` when deterministic orchestration should choose and call tools directly.

### `get_llm_usage`

**Status:** final
**Category:** llm
**Tier:** read-only
**Use when:** Inspecting aggregated LLM usage, costs, models, purposes, or trace records.
**Do not use when:** You need to call a model; use `call_model`.

**Behavior**

Queries `fqc_llm_usage` and returns pre-aggregated data, not arbitrary raw table dumps. Date filtering uses `period` or explicit `from_date`/`to_date`; explicit dates override period. `to_date` date-only values are interpreted as end-of-day inclusive. Purpose and model filters are lowercased. `recent` returns newest-first records. When filtering by `trace_id`, the open upper time bound is omitted to avoid race conditions with usage rows written just after model completion.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `mode` | `"summary" \| "by_purpose" \| "by_model" \| "recent"` | yes | none | Aggregation mode. |
| `period` | `"24h" \| "7d" \| "30d" \| "all"` | no | `"7d"` | Relative date shortcut. Overridden by explicit dates. |
| `from_date` | `string` | no | none | ISO lower bound, inclusive. |
| `to_date` | `string` | no | none | ISO upper bound, inclusive. |
| `purpose_name` | `string` | no | none | Filter to one purpose name. |
| `model_name` | `string` | no | none | Filter to one model alias. |
| `trace_id` | `string` | no | none | Filter to one trace. |
| `limit` | positive integer up to 1000 | recent only | `20` | Recent mode result limit. |

**Output**

Success returns mode-specific JSON. `summary` includes totals and prior-period comparison when applicable. `by_purpose` and `by_model` return grouped breakdowns. `recent` returns individual newest-first usage records. Invalid date parameters and Supabase unavailability return `isError: true`.

**Examples**

```js
mcp__flashquery__get_llm_usage({
  mode: "by_purpose",
  period: "7d"
})
```

```json
{
  "mode": "by_purpose",
  "period": { "from": "2026-05-10T12:00:00.000Z", "to": "2026-05-17T12:00:00.000Z" },
  "purposes": [
    {
      "purpose_name": "summarizer",
      "total_calls": 4,
      "input_tokens": 4000,
      "output_tokens": 1000,
      "cost_usd": 0.002
    }
  ]
}
```

**Related tools**

Use `call_model` for execution and `call_model({ resolver: "list_purposes" })` for configured purpose discovery.

### `call_macro`

**Status:** final
**Category:** llm
**Tier:** admin
**Use when:** Running a FlashQuery macro as a structured orchestration request.
**Do not use when:** A single direct MCP tool call is enough. It is hard-excluded from delegated native tool access because it can recursively orchestrate tools and models.

**Behavior**

Runs inline macro `source` or resolves macro code from `source_ref`. Exactly one of `source` or `source_ref` is required. It builds a native tool registry from the FlashQuery tool catalog and configured external broker tools, resolves template tool metadata, supports dry-run parsing, applies budgets, and can emit MCP progress notifications when the client provides a progress token. Macro expected errors return structured expected envelopes; runtime failures set `isError: true`.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `source` | `string` | conditional | none | Inline macro source. Mutually exclusive with `source_ref`. |
| `source_ref` | `string` | conditional | none | Document or fenced-block reference for macro source. Mutually exclusive with `source`. |
| `input_vars` | `object` | no | `{}` | Values for macro input variables. |
| `budget` | `object` | no | `timeout_ms` from `macro.default_timeout_ms` (`60000` unless configured) | Optional `max_total_tokens`, `max_model_calls`, `max_external_tool_calls`, and `timeout_ms`. |
| `dry_run` | `boolean` | no | `false` | Parse and analyze without side effects. |
| `trace` | `"full" \| "summary" \| "none"` | no | `"summary"` | Trace detail level. |
| `progress` | `"full" \| "milestones" \| "silent"` | no | `"milestones"` | Progress notification verbosity. |

**Output**

Execution success returns `{ task_id, result, trace?, token_total?, model_calls?, external_tool_calls?, warnings? }`. Dry-run success returns `{ task_id, parsed_ok: true, input_var_contract, tool_references, server_references, warnings? }`.

**Examples**

```js
mcp__flashquery__call_macro({
  source: "result = fq.search({ query: \"alpha\", entity_types: [\"documents\"] })\nexit result",
  dry_run: true
})
```

```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "parsed_ok": true,
  "input_var_contract": { "required": [], "optional": [] },
  "tool_references": ["fq.search"],
  "server_references": ["fq"]
}
```

**Related tools**

Use direct MCP tools for simple operations. Transitional `get_briefing` and `insert_doc_link` remain only until macro parity covers those workflows.

## Transitional Tools

### `get_briefing`

**Status:** transitional
**Category:** doc-read, memory, plugin
**Tier:** read-only
**Use when:** Getting a tag-scoped overview of related documents, memories, and optionally plugin records while macro parity is pending.
**Do not use when:** You need full-text search; use `search`. New workflow design should prefer `call_macro` once parity exists.

**Behavior**

Builds tag-grouped JSON over active matching documents, latest active memories, and taggable plugin records when record search is active. Entity domains are affected by enabled configuration categories. Explicitly requested disabled domains produce warnings. If records are requested and no taggable plugin tables are available, the response includes `plugin_no_taggable_tables`. Removal gate: `call_macro` parity.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `tags` | `string[]` | yes | none | Tags to filter by. |
| `tag_match` | `"any" \| "all"` | no | `"any"` | Tag matching mode. |
| `limit` | `number` | no | `20` | Maximum results per section. |
| `entity_types` | `("documents" \| "memories" \| "records")[]` | no | enabled docs/memories, plus records when `plugin_id` is provided | Domains to include. |
| `plugin_id` | `string` | no | none | Limit record groups to this plugin. When omitted and records are active, all registered taggable plugin tables are considered. |

**Output**

Success returns `generated_at`, `entity_types`, `tags`, `tag_match`, `limit`, `removal_gate: "call_macro parity"`, optional `warnings`, and `groups`. Each group has `type: "tag"`, the tag value, and an `items` array containing document, memory, and/or record identification payloads.

**Examples**

```js
mcp__flashquery__get_briefing({
  tags: ["alpha"],
  tag_match: "any",
  entity_types: ["documents", "memories"]
})
```

```json
{
  "generated_at": "2026-05-17T12:00:00.000Z",
  "entity_types": ["documents", "memories"],
  "tags": ["alpha"],
  "tag_match": "any",
  "limit": 20,
  "removal_gate": "call_macro parity",
  "groups": [
    {
      "type": "tag",
      "tag": "alpha",
      "items": []
    }
  ]
}
```

**Related tools**

Use `search` for active search workflows and `call_macro` for replaceable briefing orchestration.

### `insert_doc_link`

**Status:** transitional
**Category:** doc-write
**Tier:** read-write
**Use when:** Adding a wiki-style document link to one or more source documents while macro parity is pending.
**Do not use when:** New workflows can express this through `call_macro`.

**Behavior**

Resolves one target document, derives display text from its title, builds `[[Target Title]]`, and adds it to a frontmatter array property on each source document. The default property is `links`. Existing links are deduplicated and return `status: "unchanged"`. Source resolution errors are per-item. Target resolution errors fail the call as expected errors. Removal gate: `call_macro` parity.

**Inputs**

| Field | Type | Required | Default | Description |
|---|---:|---:|---:|---|
| `identifiers` | `string \| string[]` | yes | none | Source document identifier(s): path, `fq_id`, or filename. |
| `target_identifier` | `string` | yes | none | Target document identifier. |
| `property` | `string` | no | `"links"` | Frontmatter property to append to. |

**Output**

Success returns `{ results, removal_gate: "call_macro parity" }`. Each result contains document identification, `status: "updated" | "unchanged"`, `property`, `link`, and `target` details, or a per-source error object.

**Examples**

```js
mcp__flashquery__insert_doc_link({
  identifiers: ["Projects/Alpha/Plan.md"],
  target_identifier: "People/Ada.md",
  property: "related"
})
```

```json
{
  "results": [
    {
      "identifier": "Projects/Alpha/Plan.md",
      "title": "Alpha Plan",
      "path": "Projects/Alpha/Plan.md",
      "fq_id": "550e8400-e29b-41d4-a716-446655440000",
      "modified": "2026-05-17T12:00:00.000Z",
      "size": { "chars": 320 },
      "status": "updated",
      "property": "related",
      "link": "[[Ada Lovelace]]",
      "target": {
        "identifier": "People/Ada.md",
        "fq_id": "660e8400-e29b-41d4-a716-446655440000",
        "path": "People/Ada.md",
        "title": "Ada Lovelace"
      }
    }
  ],
  "removal_gate": "call_macro parity"
}
```

**Related tools**

Use `call_macro` once the link-insertion workflow has macro parity. Use `write_document` for general frontmatter updates.

## Host Tool Exposure

`host_mcp_tools` can reduce the host-visible tool surface:

```yaml
host_mcp_tools:
  tools:
    - category:doc-read
    - category:llm
  excluded_tools:
    - get_briefing
```

Valid selectors are exact current tool names, `tier:read-only`, `tier:read-write`, and categories: `category:doc-read`, `category:doc-write`, `category:memory`, `category:plugin`, `category:llm`, and `category:system`. `category:doc-write` includes document read tools as well as document write tools. Removed legacy names are rejected with replacement suggestions. `host_mcp_tools.tools: []` is invalid; omit `tools` to keep the default full host surface.

The native tool catalog still records all registered tools for macro/agent dispatch; host exposure filters SDK registration.

## Delegated Native Tool Exposure

Purpose-level delegated tool selectors use the same metadata but exclude unsafe tools. Broad delegated tiers include only data categories (`doc-read`, `doc-write`, `memory`, and `plugin`) and exclude hard-blocked tools. LLM-category tools such as `get_llm_usage` and `search_tools` are not included by `tier:read-only` or `tier:read-write`; use purpose `tool_search: enabled` to make `search_tools` available as the managed-loop discovery tool.

Hard-excluded delegated tools:

| Tool | Reason |
|---|---|
| `call_model` | Can recursively call models. |
| `call_macro` | Can recursively orchestrate tools and models. |
| `register_plugin` | Plugin administration is unsafe for delegated native access. |
| `unregister_plugin` | Plugin administration is unsafe for delegated native access. |
| `get_plugin_info` | Exposes plugin administration details and is not delegated. |
| `clear_pending_reviews` | Administrative review queue management. |
| `maintain_vault` | System administration. |

## Removed Legacy Migration Reference

The following names are removed legacy migration references and must not appear in active instructions or examples. FlashQuery does not alias them; selector validation rejects removed names with replacement suggestions.

| Removed legacy name | Final replacement | Notes |
|---|---|---|
| `create_document` | `write_document` with `mode: "create"` | `write_document` uses explicit mode and rejects FQ-managed frontmatter. |
| `update_document` | `write_document` with `mode: "update"` | Tags are replacement semantics. |
| `append_to_doc` | `insert_in_doc` | Use `position: "bottom"` or a heading-aware position. |
| `update_doc_header` | `write_document` with `mode: "update"` | Use `frontmatter` for custom fields or `title`/`tags` for canonical fields. |
| `search_documents` | `search` with `entity_types: ["documents"]` | Unified search handles documents and memories. |
| `save_memory` | `write_memory` with `mode: "create"` | New tool supports explicit create/update modes. |
| `update_memory` | `write_memory` with `mode: "update"` | Updates create a new latest version. |
| `search_memory` | `search` with `entity_types: ["memories"]` | Unified search handles tag and query filters. |
| `list_memories` | `search` with `entity_types: ["memories"]` | Use empty query with filters or `list_all: true`. |
| `force_file_scan` | `maintain_vault` with `action: "sync"` | System admin replacement. |
| `reconcile_documents` | `maintain_vault` with `action: "repair"` | System admin replacement. |
| `create_directory` | `manage_directory` with `action: "create"` | Directory create is recursive and idempotent. |
| `remove_directory` | `manage_directory` with `action: "remove"` | Empty-directory removal only. |
| `create_record` | `write_record` with `mode: "create"` | Plugin schema-validated write. |
| `update_record` | `write_record` with `mode: "update"` | Requires record `id`. |
| `search_all` | `search` with `entity_types` | Unified document/memory surface. |
