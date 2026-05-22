---
name: archive_document
description: "Archive one or more vault documents without deleting files, preserving identifiers and returning ordered archive results. Pass {help: true} for full help."
help_hint: "Use archive_document when a document should leave normal search/list workflows but remain recoverable in the vault."
tier: read-write
args:
  identifiers: "Required document identifier or identifier array."
---

# archive_document

## Purpose

Use `archive_document` to mark documents archived while keeping the Markdown files in place. The tool updates vault frontmatter, preserves each document's `fq_id`, records `archived_at`, and updates the matching `fqc_documents` row. It accepts path, filename, or `fq_id` identifiers and supports ordered batches.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifiers` | string or string[] | yes | none | One or more document identifiers. Each may be a vault-relative path, filename, or `fq_id`. |

## Returns

Returns JSON text. A single identifier returns one archive result or an expected error. Batch input returns an array preserving input order. Successful entries include `identifier`, `title`, `path`, `fq_id`, `modified`, `size.chars`, `status: "archived"`, and `archived_at`.

## Examples

```json
{ "identifiers": "Projects/Old Plan.md" }
```

Archives one document and returns its archived document block.

```json
{ "identifiers": ["Projects/Old Plan.md", "missing.md"] }
```

Archives the first document and reports a per-item error for the missing one.

## Gotchas

- This is not a delete operation. Use `remove_document` when the file should move to trash or be physically removed.
- Re-archiving is idempotent and preserves an existing `archived_at` timestamp.
- Ambiguous filenames return an expected `ambiguous_identifier` error.
- Document locking may return a conflict if another process is writing documents.

## Related Tools

- `remove_document` archives and then removes or trashes files.
- `get_document` can still read a known archived document.
- `search` excludes archived documents unless `include_archived` is true.
