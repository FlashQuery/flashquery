---
name: archive_memory
description: "Archive one or more memory version chains so outdated memories stop appearing in default memory search. Pass {help: true} for full help."
help_hint: "Use archive_memory when a saved memory is wrong, obsolete, or should be hidden from normal retrieval."
tier: read-write
args:
  memory_ids: "Modern memory identifier or identifier array; required unless memory_id is supplied."
  memory_id: "Optional legacy singular memory identifier."
---

# archive_memory

## Purpose

Use `archive_memory` to mark one memory or an ordered set of memories as archived. When a memory belongs to a version chain, FlashQuery archives the chain so older and latest versions share the lifecycle transition. Archived memories are hidden from default memory search/list behavior but remain stored for history.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `memory_ids` | string or string[] | usually | none | One memory ID or an ordered array of memory IDs to archive. |
| `memory_id` | string | no | none | Legacy singular memory ID accepted during migration. |

## Returns

Returns JSON text. Single input returns one memory result or one error object. Batch input returns an ordered array. Successful entries include memory identification fields, `status: "archived"`, `archived_at`, and `archived_version_count`. Missing memories return `not_found` entries in the payload.

## Examples

```json
{ "memory_ids": "2b8b..." }
```

Archives the memory chain containing that ID.

```json
{ "memory_ids": ["2b8b...", "9aa1..."] }
```

Archives two requested chains and returns ordered results.

```json
{ "memory_id": "2b8b..." }
```

Uses the legacy singular parameter during migration.

## Gotchas

- Provide `memory_ids` or `memory_id`; omitting both returns `invalid_input`.
- Empty array input succeeds with an empty result array.
- To correct a memory while keeping it active, use `write_memory` with `mode: "update"` instead.
- Default `search` results exclude archived memories unless requested.

## Related Tools

- `write_memory` creates or versions memories.
- `get_memory` retrieves known memory IDs.
- `search` discovers active or archived memories.
