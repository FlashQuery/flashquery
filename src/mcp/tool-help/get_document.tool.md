---
name: get_document
description: "Read one or more vault documents with include-gated bodies, frontmatter, headings, semantic connections, sections, and frontmatter references. Pass {help: true} for full help."
help_hint: "Use get_document when you already know the document identifier and need structured document content."
tier: read-only
args:
  identifiers: "Required document identifier or identifier array."
  include: "Optional array of body, frontmatter, headings, connections."
  sections: "Optional heading names to extract."
  include_nested: "Optional section extraction nesting flag."
  occurrence: "Optional one-based section occurrence."
  max_depth: "Optional heading depth limit from 1 to 6."
  follow_ref: "Optional dot-path into frontmatter pointing at another document."
  connections: "Optional settings for include:[connections]."
---

# get_document

## Purpose

Use `get_document` to read known documents from the vault and receive structured JSON rather than raw file text. It handles single or batch identifiers, include-gated output, section extraction by heading, heading summaries, full frontmatter, stored-vector semantic connections, and optional frontmatter reference following. It is the right tool after search or when the caller already knows a path, filename, or `fq_id`.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifiers` | string or string[] | yes | none | One document identifier or an array. Each may be path, filename, or `fq_id`. |
| `include` | array | no | `["body"]` | Any of `body`, `frontmatter`, `headings`, and `connections`. |
| `sections` | string[] | no | `[]` | Heading names to extract. Requires `body` in `include`. |
| `include_nested` | boolean | no | `true` | Include nested subsections when extracting sections. |
| `occurrence` | number | no | `1` | One-based occurrence when one section query matches multiple headings. |
| `max_depth` | number | no | `6` | Heading depth to include for `headings`; valid range is 1-6. |
| `follow_ref` | string | no | none | Dot path into source frontmatter whose string value resolves another document. |
| `connections` | object | no | defaults | Options for `include:["connections"]`: `limit` default 50, `limit_per_chunk` default 5, and optional `embedding_names`. Invalid unless `include` contains `connections`. |

## Returns

Returns JSON text. Single-string input returns a flat document object or expected error. Array input returns an ordered array where each element is either a document object or an error object. Document objects always include identification fields, `version_token`, and requested payload fields.

When `include` contains `connections`, the response includes a nested `connections` object with `overall` and `source_chunks`. `overall` is a deduped list of outbound target chunks across all embedded source chunks in the document, sorted by highest cosine similarity. `source_chunks` preserves per-source-chunk outbound links. This mode uses stored chunk embeddings only; it does not embed the whole document, sections, or query text.

`version_token` is the whole-file SHA-256 fingerprint of the current on-disk bytes. It is returned even when you request only `frontmatter`, `headings`, or one section, and can be passed as `expected_version` on later write tools to opt into conflict detection.

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

```json
{ "identifiers": "Projects/Plan.md", "include": ["connections"], "connections": { "limit": 40, "limit_per_chunk": 5 } }
```

Returns a stored-vector semantic graph rollup for the document.

## Gotchas

- Use `search` when you do not know the identifier.
- `sections` requires `body` in `include`.
- `occurrence` must be a positive integer; `max_depth` must be 1 through 6.
- `connections` options require `connections` in `include`.
- `version_token` is for the whole file, not the extracted section.
- Batch partial failures do not set MCP `isError`; they appear in the returned array.

## Related Tools

- `search` discovers documents and memories.
- `write_document` creates or updates documents.
- `copy_document` duplicates one document.
