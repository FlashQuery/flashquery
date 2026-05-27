---
name: write_document
description: "Create a new vault document or update one existing document through explicit mode-based document writes. Pass {help: true} for full help."
help_hint: "Use write_document for whole-document creation, body replacement, title changes, frontmatter edits, or full tag replacement."
tier: read-write
args:
  mode: "Required create or update mode."
  identifier: "Required in update mode."
  path: "Required in create mode."
  title: "Optional title, required in create mode."
  content: "Optional markdown body."
  frontmatter: "Optional custom frontmatter."
  tags: "Optional replacement tag list."
  expected_version: "Optional version_token precondition."
  if_match: "Alias for expected_version."
---

# write_document

## Purpose

Use `write_document` to create a new Markdown document or update one existing document. It is a whole-document writer: it can set the body, title, custom frontmatter, and replacement tag list. FlashQuery manages identity, lifecycle, timestamps, vault writes, database sync, and background embedding updates.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `mode` | string | yes | none | `create` or `update`. |
| `identifier` | string | update only | none | Existing document identifier for update mode. |
| `path` | string | create only | none | Vault-relative path for the new document. |
| `title` | string | create only | existing title on update | Document title mapped to frontmatter. |
| `content` | string | no | empty on create, existing body on update | Markdown document body. |
| `frontmatter` | object | no | `{}` | Custom frontmatter fields. FQ-managed fields are rejected. |
| `tags` | string[] | no | `[]` on create, existing tags on update | Replacement tag list. |
| `expected_version` | string | no | none | Optional whole-file `version_token` precondition for update mode. |
| `if_match` | string | no | none | Alias for `expected_version`. |

## Returns

Returns JSON text with a document write result containing `mode`, document identification fields, `modified`, `size.chars`, and post-write `version_token`. Expected errors cover invalid mode, missing required fields, unsafe paths, path conflicts, reserved frontmatter, tag validation, missing documents, ambiguous identifiers, and stale `expected_version` / `if_match` conflicts.

## Examples

```json
{ "mode": "create", "path": "Notes/Idea.md", "title": "Idea", "content": "Initial note", "tags": ["idea"] }
```

Creates a new document.

```json
{ "mode": "update", "identifier": "Notes/Idea.md", "content": "Revised note" }
```

Replaces the body while preserving existing title and tags.

```json
{ "mode": "update", "identifier": "Notes/Idea.md", "content": "Revised note", "expected_version": "..." }
```

Updates only if the current whole-file `version_token` still matches. Omitting `expected_version` and `if_match` keeps last-writer-wins behavior.

```json
{ "mode": "update", "identifier": "Notes/Idea.md", "frontmatter": { "status": "review" }, "tags": ["idea", "review"] }
```

Updates custom frontmatter and replaces the tag list.

## Gotchas

- Tags are replacement semantics, not additive. Use `apply_tags` for incremental tag edits.
- Do not pass FQ-managed frontmatter fields such as `fq_id` directly.
- Use `insert_in_doc` or `replace_doc_section` for heading-aware partial edits.
- Create mode rejects existing paths and directory paths.
- Stale `expected_version` or `if_match` values return a `conflict` with the current `version_token`.

## Related Tools

- `get_document` reads the document after writing.
- `apply_tags` adds or removes tags without replacing all tags.
- `copy_document` duplicates an existing document.
