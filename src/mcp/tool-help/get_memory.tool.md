---
name: get_memory
description: "Retrieve one or more known memory IDs with optional full content and complete tags payloads. Pass {help: true} for full help."
help_hint: "Use get_memory after search returns memory IDs and you need exact stored memory details."
tier: read-only
args:
  memory_ids: "Required memory ID or memory ID array."
  include: "Optional array of content and tags_full."
---

# get_memory

## Purpose

Use `get_memory` to retrieve known persistent memories by ID. It is for direct lookup, not discovery. Single input returns one memory result, while array input preserves request order and reports per-ID missing entries. Optional include fields let the caller request full memory content and complete tag payloads.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `memory_ids` | string or string[] | yes | none | One memory UUID or an ordered array of memory UUIDs. |
| `include` | array | no | `[]` | Optional payload fields: `content` and/or `tags_full`. |

## Returns

Returns JSON text. Single input returns a memory identification object or expected `not_found`. Batch input returns an ordered array. Memory objects include identifiers, preview metadata, version fields, timestamps, and any requested include payloads.

## Examples

```json
{ "memory_ids": "44b1..." }
```

Retrieves metadata and preview information for one memory.

```json
{ "memory_ids": "44b1...", "include": ["content", "tags_full"] }
```

Retrieves full content and complete tags for one memory.

```json
{ "memory_ids": ["44b1...", "55c2..."], "include": ["content"] }
```

Retrieves an ordered batch with per-ID results.

## Gotchas

- Use `search` to discover memory IDs by text or tags.
- The tool queries memory rows directly by ID and instance.
- Missing IDs in batch mode are returned in the JSON array rather than as transport errors.
- Archived memories can still be retrieved if you know their IDs.

## Related Tools

- `search` finds memory IDs.
- `write_memory` creates or versions memories.
- `archive_memory` hides memory chains from default search.
