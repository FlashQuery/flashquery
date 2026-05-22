---
name: list_vault
description: "List vault files and folders as structured JSON with optional metadata and tracking details for browsing. Pass {help: true} for full help."
help_hint: "Use list_vault to browse vault structure and lightweight file metadata without reading full document bodies."
tier: read-only
args:
  path: "Optional vault-relative folder."
  recursive: "Optional recursive traversal flag."
  include: "Optional metadata or tracking details."
  extensions: "Optional file extensions."
  limit: "Optional displayed-entry limit."
---

# list_vault

## Purpose

Use `list_vault` to browse the vault filesystem. It returns paths and lightweight metadata without loading full document bodies, making it useful for navigation, folder inspection, and confirming whether files are tracked. Use `include` when directory counts or tracking fields are needed.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `path` | string | no | vault root | Vault-relative folder to list. |
| `recursive` | boolean | no | `false` | Traverse nested folders. |
| `include` | string[] | no | `[]` | Optional `metadata` and/or `tracking`. |
| `extensions` | string[] | no | configured markdown extensions | File extensions to include. |
| `limit` | number | no | implementation default | Maximum entries displayed before truncation. |

## Returns

Returns JSON text shaped like `{ path, total, displayed, truncated, entries }`. Entries represent files or directories and can include metadata such as title, tags, modified time, size, directory counts, or tracking fields depending on `include`.

## Examples

```json
{ "path": "Projects" }
```

Lists immediate entries under `Projects`.

```json
{ "path": "Projects", "recursive": true, "include": ["metadata", "tracking"], "limit": 50 }
```

Recursively lists project files with metadata and tracking details.

## Gotchas

- This is not semantic or full-text search; use `search` for that.
- Dotfiles and dotfile directories are skipped by the underlying markdown listing.
- `tracking` depends on database state and may require Supabase availability.
- Large recursive listings may be truncated.

## Related Tools

- `search` finds documents and memories by content, tags, or path filters.
- `get_document` reads full document bodies and frontmatter.
- `manage_directory` creates or removes empty folders.
