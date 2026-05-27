---
name: move_document
description: "Move or rename one vault document while preserving its fq_id identity, history, and plugin associations. Pass {help: true} for full help."
help_hint: "Use move_document for a single document path change or rename; update links separately when needed."
tier: read-write
args:
  identifier: "Required source document identifier."
  destination: "Required vault-relative destination path."
  expected_version: "Optional source file version_token precondition."
  if_match: "Alias for expected_version."
---

# move_document

## Purpose

Use `move_document` to move or rename one tracked document inside the vault. The document keeps its `fq_id`, tracked identity, history, and plugin associations. Intermediate destination directories are created automatically. Existing links in other documents are not rewritten.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifier` | string | yes | none | Source document path, fq_id, or filename. |
| `destination` | string | yes | none | Vault-relative destination path, including filename. If extension is omitted, the source extension is used. |
| `expected_version` | string | no | none | Optional source-file `version_token` precondition. |
| `if_match` | string | no | none | Alias for `expected_version`. |

## Returns

Returns JSON text with document identification for the moved document plus the destination file `version_token`. Plugin-owned documents may include `warnings: ["plugin_ownership_path_expectation"]`. Expected errors cover missing or ambiguous sources, identical paths, destination conflicts, unsafe paths, untracked documents, stale `expected_version` / `if_match`, and lock contention.

## Examples

```json
{ "identifier": "Drafts/Plan.md", "destination": "Projects/Plan.md" }
```

Moves a document into another folder.

```json
{ "identifier": "Projects/Old Name.md", "destination": "Projects/New Name.md" }
```

Renames a document in place.

```json
{ "identifier": "Drafts/Plan.md", "destination": "Projects/Plan.md", "expected_version": "..." }
```

Moves only if the source file still has the supplied whole-file `version_token`. The success `version_token` describes the moved destination file. Omitting `expected_version` and `if_match` keeps last-writer-wins behavior.

## Gotchas

- This is single-target; call it once per move.
- Destination conflicts are rejected.
- Links in other documents are not automatically updated.
- Moving plugin-owned documents can violate plugin path expectations and returns a warning.
- Stale `expected_version` or `if_match` values refer to source bytes and return a `conflict` with the current `version_token`.

## Related Tools

- `copy_document` duplicates a document with a fresh identity.
- `remove_document` removes a document from active workflows.
- `insert_doc_link` can update relationship links after a move.
