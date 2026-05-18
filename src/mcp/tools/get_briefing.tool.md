---
name: get_briefing
description: "Build transitional briefing groups from tagged documents, memories, and optional plugin record counts while call_macro parity is pending. Pass {help: true} for full help."
help_hint: "Use get_briefing for a read-only topic overview across tagged documents, memories, and plugin record counts."
tier: read-only
args:
  tags: "Tags to gather into briefing groups."
  plugin_id: "Optional plugin scope for record counts."
---

# get_briefing

## Purpose

Use `get_briefing` for a read-only overview of information grouped around tags. It is a transitional macro-dependent helper retained while `call_macro` grows parity for this workflow. It collects matching documents and memories and can include plugin record counts when a plugin id is supplied.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tags` | string[] | yes | none | Tags used to select relevant documents and memories. |
| `plugin_id` | string | no | none | Optional plugin id for related record count summaries. |

## Returns

Returns JSON text containing grouped briefing data. Document and memory entries identify matching items and preserve enough metadata to fetch full content with `get_document`, `get_memory`, or `search`. Plugin data is count-oriented rather than a full record export.

## Examples

```json
{ "tags": ["planning"] }
```

Builds a briefing around planning-tagged documents and memories.

```json
{ "tags": ["customer", "acme"], "plugin_id": "crm" }
```

Includes CRM-related record counts for the same tag context.

## Gotchas

- This is read-only and overview-oriented; it is not a content search replacement.
- Use `search` for full-text, semantic, or mixed document/memory discovery.
- Plugin counts do not include full record payloads.
- The tool is transitional and may be replaced by a `call_macro` workflow.

## Related Tools

- `search` finds documents and memories by query, tag, path, or mode.
- `get_document` and `get_memory` read the full items surfaced by a briefing.
- `call_macro` is the long-term orchestration surface for custom briefings.
