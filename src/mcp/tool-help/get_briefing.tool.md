---
name: get_briefing
description: "Build transitional briefing groups from tagged documents, memories, and optional plugin records while call_macro parity is pending. Pass {help: true} for full help."
help_hint: "Use get_briefing for a read-only topic overview across tagged documents, memories, and taggable plugin records."
tier: read-only
args:
  tags: "Tags to gather into briefing groups."
  tag_match: "Optional any or all tag matching."
  limit: "Optional maximum items per group."
  entity_types: "Optional documents, memories, and/or records domains."
  plugin_id: "Optional plugin filter for record items."
---

# get_briefing

## Purpose

Use `get_briefing` for a read-only overview of information grouped around tags. It is a transitional macro-dependent helper retained while `call_macro` grows parity for this workflow. It collects matching active documents, latest active memories, and taggable plugin records when requested.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tags` | string[] | yes | none | Tags used to select relevant documents, memories, and records. |
| `tag_match` | string | no | `any` | `any` matches at least one tag; `all` requires every requested tag. |
| `limit` | number | no | `20` | Maximum query results per domain and maximum items returned per tag group. |
| `entity_types` | string[] | no | enabled documents and memories; records only when `plugin_id` is provided | Domains to include: `documents`, `memories`, and/or `records`. |
| `plugin_id` | string | no | none | Optional plugin id filter for record items. Without it, explicit `records` searches all registered plugins. |

## Returns

Returns JSON text containing `generated_at`, `entity_types`, `tags`, `tag_match`, `limit`, optional `warnings`, and `groups`. Each group is keyed by tag and contains document, memory, and/or record identification items. Record items identify active rows from plugin tables with a `tags` or `tag` column; they are not full record exports.

## Examples

```json
{ "tags": ["planning"] }
```

Builds a briefing around planning-tagged documents and memories.

```json
{ "tags": ["customer", "acme"], "tag_match": "all", "entity_types": ["documents", "memories", "records"], "plugin_id": "crm", "limit": 10 }
```

Includes CRM record identifiers alongside document and memory items for the same tag context.

## Gotchas

- This is read-only and overview-oriented; it is not a content search replacement.
- Use `search` for full-text, semantic, or mixed document/memory discovery.
- Records are included by default only when `plugin_id` is provided; otherwise request `entity_types: ["records"]` explicitly.
- Plugin record items come only from active rows in tables with a `tags` or `tag` column.
- Disabled requested domains are omitted with warnings; if every requested domain is disabled, the tool returns `unsupported`.
- The tool is transitional and may be replaced by a `call_macro` workflow.

## Related Tools

- `search` finds documents and memories by query, tag, path, or mode.
- `get_document` and `get_memory` read the full items surfaced by a briefing.
- `get_record` reads full plugin records surfaced by a briefing.
- `call_macro` is the long-term orchestration surface for custom briefings.
