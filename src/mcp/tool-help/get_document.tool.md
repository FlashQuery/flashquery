---
name: get_document
description: "Read one or more vault documents with include-gated bodies, frontmatter, headings, sections, and frontmatter references. Pass {help: true} for full help."
help_hint: "Use get_document when you already know the document identifier and need structured document content."
tier: read-only
args:
  identifiers: "Required document identifier or identifier array."
  include: "Optional array of body, frontmatter, headings."
  sections: "Optional heading names to extract."
  include_nested: "Optional section extraction nesting flag."
  occurrence: "Optional one-based section occurrence."
  max_depth: "Optional heading depth limit from 1 to 6."
  follow_ref: "Optional dot-path into frontmatter pointing at another document."
---

# get_document

## Purpose

Use `get_document` to read known documents from the vault and receive structured JSON rather than raw file text. It handles single or batch identifiers, include-gated output, section extraction by heading, heading summaries, full frontmatter, and optional frontmatter reference following. It is the right tool after search or when the caller already knows a path, filename, or `fq_id`.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifiers` | string or string[] | yes | none | One document identifier or an array. Each may be path, filename, or `fq_id`. |
| `include` | array | no | `["body"]` | Any of `body`, `frontmatter`, and `headings`. |
| `sections` | string[] | no | `[]` | Heading names to extract. Requires `body` in `include`. |
| `include_nested` | boolean | no | `true` | Include nested subsections when extracting sections. |
| `occurrence` | number | no | `1` | One-based occurrence when one section query matches multiple headings. |
| `max_depth` | number | no | `6` | Heading depth to include for `headings`; valid range is 1-6. |
| `follow_ref` | string | no | none | Dot path into source frontmatter whose string value resolves another document. |

## Returns

Returns JSON text. Single-string input returns a flat document object or expected error. Array input returns an ordered array where each element is either a document object or an error object. Document objects always include identification fields and include requested payload fields.

## Examples

```json
{ "identifiers": "Projects/Plan.md", "include": ["body", "frontmatter"] }
```

Reads a document body and full frontmatter.

```json
{ "identifiers": "Projects/Plan.md", "include": ["body"], "sections": ["Risks"], "include_nested": false }
```

Returns only the matching section body.

```json
{ "identifiers": ["A.md", "B.md"], "include": ["headings"], "max_depth": 2 }
```

Returns ordered heading summaries for two documents.

## Gotchas

- Use `search` when you do not know the identifier.
- `sections` requires `body` in `include`.
- `occurrence` must be a positive integer; `max_depth` must be 1 through 6.
- Batch partial failures do not set MCP `isError`; they appear in the returned array.

## Related Tools

- `search` discovers documents and memories.
- `write_document` creates or updates documents.
- `copy_document` duplicates one document.
