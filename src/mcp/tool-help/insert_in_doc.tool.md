---
name: insert_in_doc
description: "Insert markdown into a document at top, bottom, before a heading, after a heading, or end of section. Pass {help: true} for full help."
help_hint: "Use insert_in_doc for heading-aware additive markdown placement without replacing existing section content."
tier: read-write
args:
  identifier: "Required document identifier."
  heading: "Optional heading anchor."
  position: "Required insertion position."
  content: "Required markdown content."
  occurrence: "Optional heading occurrence."
  include_nested: "Optional section nesting behavior."
  heading_match: "Optional contains or exact matching."
  heading_level: "Optional markdown heading level."
  expected_version: "Optional version_token precondition."
  if_match: "Alias for expected_version."
---

# insert_in_doc

## Purpose

Use `insert_in_doc` to add markdown to an existing document without replacing existing content. It supports whole-document positions (`top`, `bottom`) and heading-aware positions (`before_heading`, `after_heading`, `end_of_section`) with explicit controls for matching, heading level, occurrence, and nested sections.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifier` | string | yes | none | Document path, fq_id, or filename. |
| `position` | string | yes | none | `top`, `bottom`, `end`, `after_heading`, `before_heading`, or `end_of_section`. |
| `content` | string | yes | none | Markdown to insert, excluding the anchor heading itself. |
| `heading` | string | heading positions only | none | Heading text to match. |
| `occurrence` | number | no | `1` when needed | One-indexed match selection. |
| `include_nested` | boolean | no | `true` | For `end_of_section`, include child sections or stop before them. |
| `heading_match` | string | no | `contains` | `contains` or `exact`. |
| `heading_level` | number | no | any | Optional heading level filter, 1 through 6. |
| `expected_version` | string | no | none | Optional `version_token` from a prior read or write; when present, the insert runs only if current disk bytes still match. |
| `if_match` | string | no | none | Alias for `expected_version`. |

## Returns

Returns JSON text with document identification fields, post-write `version_token`, and, for heading-based insertions, an `inserted_at` block describing the resolved position, heading match mode, occurrence, and nesting behavior. Expected errors report invalid combinations, ambiguous headings, missing headings, lock contention, version mismatch, or unresolved documents.

When `expected_version` or `if_match` is stale, the write is refused before disk mutation with `error: "conflict"`, `details.reason: "version_mismatch"`, the current `version_token`, and `targeted_region`. Anchor inserts return the current anchor section; `bottom`/`end` appends return a document-end region.

## Examples

```json
{ "identifier": "Notes/Plan.md", "position": "bottom", "content": "\n## Next Steps\n- Review" }
```

Appends content to the document.

```json
{ "identifier": "Notes/Plan.md", "position": "after_heading", "heading": "Summary", "content": "New paragraph." }
```

Inserts content immediately after the matched heading.

```json
{ "identifier": "Notes/Plan.md", "position": "end_of_section", "heading": "Tasks", "include_nested": false, "content": "- New task" }
```

Adds content before the first child heading within the Tasks section.

```json
{ "identifier": "Notes/Plan.md", "position": "after_heading", "heading": "Summary", "content": "Fresh note.", "expected_version": "..." }
```

Only inserts if the whole-document `version_token` still matches.

## Gotchas

- `top` and `bottom` do not accept heading controls.
- `expected_version` and `if_match` are whole-document tokens, not section-scoped tokens.
- Ambiguous heading matches require `occurrence`.
- `content` should not include the heading line unless you intend to add a new heading.
- Use `replace_doc_section` when existing section content should be rewritten or deleted.

## Related Tools

- `replace_doc_section` replaces or deletes a matched section.
- `write_document` rewrites the whole document body.
- `get_document` can inspect headings before inserting.
