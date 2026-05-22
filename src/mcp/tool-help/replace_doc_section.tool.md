---
name: replace_doc_section
description: "Replace or delete one matched markdown heading section while preserving the rest of the document. Pass {help: true} for full help."
help_hint: "Use replace_doc_section for heading-scoped section rewrites or deletions without rewriting a whole document."
tier: read-write
args:
  identifier: "Required document identifier."
  heading: "Required heading text."
  content: "Required replacement body; empty deletes section."
  include_nested: "Optional nested-section replacement flag."
  heading_match: "Optional contains or exact matching."
  heading_level: "Optional markdown heading level."
  occurrence: "Optional heading occurrence."
---

# replace_doc_section

## Purpose

Use `replace_doc_section` to rewrite or delete the body of one markdown section identified by heading. Non-empty content preserves the matched heading line and replaces the section body. Empty content deletes the heading and section. The rest of the document is left untouched.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifier` | string | yes | none | Document path, fq_id, or filename. |
| `heading` | string | yes | none | Heading text to match. |
| `content` | string | yes | none | Replacement section body, excluding the heading line; empty string deletes the section. |
| `include_nested` | boolean | no | `true` | Replace nested subsections too, or preserve child headings. |
| `heading_match` | string | no | `contains` | `contains` or `exact`. |
| `heading_level` | number | no | any | Optional heading level filter, 1 through 6. |
| `occurrence` | number | no | inferred when unique | One-indexed match selection. |

## Returns

Returns JSON text with document identification and mutation metadata for the changed section. Expected errors cover documents with no headings, not-found headings, ambiguous heading matches, invalid identifiers, and write-lock contention.

## Examples

```json
{ "identifier": "Notes/Plan.md", "heading": "Risks", "content": "- Budget\n- Timeline" }
```

Replaces the Risks section body.

```json
{ "identifier": "Notes/Plan.md", "heading": "Draft Notes", "content": "" }
```

Deletes the Draft Notes heading and section.

```json
{ "identifier": "Notes/Plan.md", "heading": "Summary", "heading_match": "exact", "heading_level": 2, "content": "Updated summary." }
```

Uses precise heading selection.

## Gotchas

- `content` should not include the heading line unless you intentionally want a nested heading.
- Ambiguous matches require `occurrence`.
- `include_nested: false` preserves child headings under the section.
- Use `insert_in_doc` to append around a section without replacing it.

## Related Tools

- `insert_in_doc` adds markdown before, after, or inside sections.
- `write_document` replaces whole document bodies.
- `get_document` can list headings before replacement.
