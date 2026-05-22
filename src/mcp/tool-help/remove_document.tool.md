---
name: remove_document
description: "Remove one or more documents from current vault workflows by archiving lifecycle state before trash or delete. Pass {help: true} for full help."
help_hint: "Use remove_document when a document should leave normal vault workflows and be moved to trash or deleted."
tier: read-write
args:
  identifiers: "Required document identifier or identifiers."
---

# remove_document

## Purpose

Use `remove_document` when documents should no longer appear in normal vault workflows. It archives lifecycle state first, then either moves the file to the configured trash folder or physically deletes it when trash is disabled. Batch input preserves order and reports per-document outcomes.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifiers` | string or string[] | yes | none | One or more document identifiers: path, fq_id, or filename. |

## Returns

Returns JSON text. Single-string input returns one removal result; array input returns ordered per-document results. Successful entries include document identification, archived lifecycle metadata, and removal destination details. Expected errors are returned per item for invalid identifiers, missing documents, unsafe trash config, or conflicts.

## Examples

```json
{ "identifiers": "Scratch/Old.md" }
```

Removes one document.

```json
{ "identifiers": ["Drafts/A.md", "Drafts/B.md"] }
```

Removes an ordered batch.

## Gotchas

- Use `archive_document` for reversible archive-only behavior.
- This tool has no restore API.
- Directory removal belongs to `manage_directory`.
- Trash destinations use basename-only collision handling.

## Related Tools

- `archive_document` hides documents while keeping files in place.
- `manage_directory` removes empty directories.
- `list_vault` confirms filesystem state after removal.
