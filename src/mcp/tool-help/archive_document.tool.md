---
name: archive_document
description: "Archive one or more vault documents without deleting files, preserving identifiers and returning ordered archive results. Pass {help: true} for full help."
help_hint: "Use archive_document when a document should leave normal search/list workflows but remain recoverable in the vault."
tier: read-write
args:
  identifiers: "Required document identifier, or array of strings and {identifier, version_token} items."
  expected_version: "Optional source file version_token precondition."
  if_match: "Alias for expected_version."
---

# archive_document

## Purpose

Use `archive_document` to mark documents archived while keeping the Markdown files in place. The tool updates vault frontmatter, preserves each document's `fq_id`, records `archived_at`, and updates the matching `fqc_documents` row. It accepts path, filename, or `fq_id` identifiers and supports ordered batches.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifiers` | string or Array<string \| { identifier, version_token }> | yes | none | One or more document identifiers. Batch arrays may mix bare strings with object-form `{ "identifier": "...", "version_token": "..." }` items. |
| `expected_version` | string | no | none | Optional source-file `version_token` precondition. |
| `if_match` | string | no | none | Alias for `expected_version`. |

## Returns

Returns JSON text. A single identifier returns one archive result or an expected error. Batch array input returns a raw ordered array. Each batch entry reports top-level `status: "succeeded"`, `"conflicted"`, or `"failed"` in input order. Successful batch entries include document data at the entry top level, use `result_status: "archived"` for the archive lifecycle value, and include post-archive `version_token`. Conflict entries expose `version_token`, `targeted_region`, and `details` at the entry top level.

```json
[
  { "identifier": "Projects/Old Plan.md", "status": "succeeded", "result_status": "archived", "path": "Projects/Old Plan.md", "version_token": "..." },
  { "identifier": "Projects/Raced.md", "status": "conflicted", "error": "conflict", "version_token": "...", "targeted_region": { "kind": "frontmatter" }, "details": { "reason": "version_mismatch" } },
  { "identifier": "missing.md", "status": "failed", "error": { "error": "not_found", "message": "No document matches identifier 'missing.md'" } }
]
```

## Examples

```json
{ "identifiers": "Projects/Old Plan.md" }
```

Archives one document and returns its archived document block.

```json
{ "identifiers": ["Projects/Old Plan.md", "missing.md"] }
```

Archives the first document and reports a per-item error for the missing one.

```json
{ "identifiers": ["Projects/A.md", { "identifier": "Projects/B.md", "version_token": "..." }] }
```

Uses a mixed batch. The object-form `version_token` applies only to that item; bare strings are untokened unless a top-level `expected_version` or `if_match` is supplied.

```json
{ "identifiers": "Projects/Old Plan.md", "if_match": "..." }
```

Archives only if the source file still has the supplied whole-file `version_token`. Omitting `expected_version` and `if_match` keeps last-writer-wins behavior.

## Gotchas

- This is not a delete operation. Use `remove_document` when the file should move to trash or be physically removed.
- Re-archiving is idempotent and preserves an existing `archived_at` timestamp.
- Ambiguous filenames return an expected `ambiguous_identifier` error.
- Document locking may return a conflict if another process is writing documents.
- Stale `expected_version` or `if_match` values refer to the source file and return a `conflict` with the current `version_token`.

## Related Tools

- `remove_document` archives and then removes or trashes files.
- `get_document` can still read a known archived document.
- `search` excludes archived documents unless `include_archived` is true.
