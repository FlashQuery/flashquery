---
name: manage_directory
description: "Create or remove vault directories through one explicit action-based directory management tool. Pass {help: true} for full help."
help_hint: "Use manage_directory for vault folder creation or empty-folder removal, not document moves or deletes."
tier: read-write
args:
  action: "Required create or remove."
  paths: "Required directory path or paths."
---

# manage_directory

## Purpose

Use `manage_directory` to create vault folders or remove empty vault folders. It is the directory-specific write surface and should be used when the target is a folder, not a document. Document creation, moves, and removal have separate tools with document lifecycle behavior.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | string | yes | none | `create` or `remove`. |
| `paths` | string or string[] | yes | none | One or more vault-relative directory paths. |

## Returns

Returns JSON text with ordered per-path results. Successful creates report created or already-existing status. Successful removes report directory removal. Expected errors cover invalid paths, traversal attempts, non-empty directories, files passed as directories, and lock contention.

## Examples

```json
{ "action": "create", "paths": ["Projects/Acme"] }
```

Creates one folder and any needed parents.

```json
{ "action": "remove", "paths": ["Scratch/Empty"] }
```

Removes an empty folder.

## Gotchas

- Removal is for empty folders only.
- Do not use this to delete documents; use `remove_document`.
- Do not use this to move documents between folders; use `move_document`.
- Paths are vault-relative and validated against traversal.

## Related Tools

- `list_vault` shows current folder contents.
- `write_document` creates a document at a path.
- `move_document` moves or renames existing documents.
