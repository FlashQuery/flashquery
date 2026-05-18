---
name: copy_document
description: "Copy one vault document to a new path with a fresh FlashQuery document identity and preserved source metadata. Pass {help: true} for full help."
help_hint: "Use copy_document for a single duplicate, such as creating a new note from a template."
tier: read-write
args:
  identifier: "Required source document identifier."
  destination: "Optional vault-relative destination path."
---

# copy_document

## Purpose

Use `copy_document` to duplicate one document as a new document. The source body, title, tags, and custom frontmatter are preserved, while FlashQuery assigns a new `fq_id`, timestamps, and database row for the copy. The source document is not modified.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifier` | string | yes | none | Source document identifier: vault-relative path, filename, or `fq_id`. |
| `destination` | string | no | root filename based on source title | Vault-relative path for the new copy. |

## Returns

Returns JSON text with a document identification block for the new copy: `identifier`, `title`, `path`, `fq_id`, `modified`, and `size.chars`. Expected errors cover missing/ambiguous source identifiers, unsafe destination paths, destination conflicts, and invalid source tags.

## Examples

```json
{ "identifier": "Templates/Meeting.md", "destination": "Meetings/2026-05-18.md" }
```

Creates a copy at the requested path.

```json
{ "identifier": "Templates/Contact.md" }
```

Copies to the vault root using the source title as the filename.

## Gotchas

- This tool is intentionally single-target. Array input is rejected.
- Destination paths must stay inside the vault and must not already exist.
- You cannot override title, body, tags, or frontmatter during copy. Copy first, then call `write_document` if customization is needed.
- Background embedding refresh happens after the MCP response.

## Related Tools

- `write_document` creates a custom document or updates the copy.
- `move_document` changes a document path while preserving identity.
- `get_document` reads the copied document.
