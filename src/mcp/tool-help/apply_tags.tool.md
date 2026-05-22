---
name: apply_tags
description: "Apply additive or removal tag edits to ordered document and memory targets while preserving per-target results. Pass {help: true} for full help."
help_hint: "Use apply_tags when you need idempotent tag additions or removals across explicit document and memory targets."
tier: read-write
args:
  targets: "Optional array of { entity_type, identifier } targets."
  identifiers: "Optional legacy document identifier or identifier array."
  memory_id: "Optional legacy single memory identifier."
  add_tags: "Optional tags to add."
  remove_tags: "Optional tags to remove."
---

# apply_tags

## Purpose

Use `apply_tags` to add or remove tags on explicit document and memory targets in one ordered request. It is best for incremental tag edits: add tags without replacing the whole tag list, remove tags without failing when a tag is already absent, and receive one result per target. Document targets update vault frontmatter and sync the document row. Memory targets update the specified memory row in Supabase.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `targets` | array | no | derived from legacy fields | Ordered targets shaped as `{ "entity_type": "document" | "memory", "identifier": string }`. |
| `identifiers` | string or string[] | no | none | Legacy document-only input. Use instead of `targets` only for document tagging. |
| `memory_id` | string | no | none | Legacy memory-only input. Use instead of `targets` only for one memory. |
| `add_tags` | string[] | no | `[]` | Tags to add idempotently after normalization and validation. |
| `remove_tags` | string[] | no | `[]` | Tags to remove. Missing tags are ignored. |

## Returns

Returns JSON text. Successful document entries include document identification fields, `tags`, and `entity_type: "document"`. Successful memory entries include memory identification fields, `tags`, and `entity_type: "memory"`. Ordered per-target failures include `error`, `message`, and `identifier`.

## Examples

```json
{ "targets": [{ "entity_type": "document", "identifier": "Notes/Plan.md" }], "add_tags": ["planning"] }
```

Adds `planning` to the document without replacing other tags.

```json
{ "targets": [{ "entity_type": "memory", "identifier": "4f3c..." }], "remove_tags": ["stale"] }
```

Removes `stale` from one memory if present.

```json
{ "identifiers": ["Notes/A.md", "Notes/B.md"], "add_tags": ["review"], "remove_tags": ["draft"] }
```

Uses the legacy document shorthand for an ordered document batch.

## Gotchas

- At least one target and at least one of `add_tags` or `remove_tags` is required.
- Use `write_document` when replacing a document's full tag list.
- Tag validation runs after edits; conflicting status tags return per-target errors.
- Memory tagging depends on the memory category being enabled and applies to the exact memory ID provided.

## Related Tools

- `write_document` replaces document tags and frontmatter.
- `write_memory` creates or versions memories with a replacement tag list.
- `search` finds documents or memories by tag.
