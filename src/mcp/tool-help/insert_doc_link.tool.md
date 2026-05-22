---
name: insert_doc_link
description: "Add a wiki-style relationship link from source documents to one resolved target document while call_macro parity is pending. Pass {help: true} for full help."
help_hint: "Use insert_doc_link to add a deduplicated [[Target]] link into source document frontmatter relationship fields."
tier: read-write
args:
  identifiers: "Required source document identifier or identifiers."
  target_identifier: "Required target document identifier."
  property: "Optional frontmatter relationship property."
---

# insert_doc_link

## Purpose

Use `insert_doc_link` to add a wiki-style relationship link from one or more source documents to a single target document. The tool resolves the target, derives the display title, writes a `[[Target Title]]` link into a configurable frontmatter property, and returns ordered per-source results. It is transitional until `call_macro` covers this workflow.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `identifiers` | string or string[] | yes | none | Source document identifier or ordered source identifier array. |
| `target_identifier` | string | yes | none | Target document identifier used to resolve the link title and target metadata. |
| `property` | string | no | `links` | Frontmatter property to update, such as `related` or `parent`. |

## Returns

Returns JSON text. Each source result includes document identification fields, status `updated` or `unchanged`, the target property, the wikilink, and target document metadata. Target resolution failures stop the request; source failures are reported per source.

## Examples

```json
{ "identifiers": "Projects/Plan.md", "target_identifier": "People/Ada.md" }
```

Adds the target link to the `links` property.

```json
{ "identifiers": ["A.md", "B.md"], "target_identifier": "Index.md", "property": "related" }
```

Adds the same relationship to two source documents.

## Gotchas

- The target must resolve before any source updates run.
- Existing links are deduplicated and return `status: "unchanged"`.
- This updates frontmatter relationships, not body text links.
- Use direct document edit tools for arbitrary markdown insertion.

## Related Tools

- `insert_in_doc` inserts markdown into the body.
- `replace_doc_section` rewrites an existing section.
- `call_macro` will eventually cover relationship-link workflows.
