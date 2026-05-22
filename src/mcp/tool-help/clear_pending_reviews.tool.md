---
name: clear_pending_reviews
description: "List or clear pending plugin review rows by action, plugin, or review IDs. Pass {help: true} for full help."
help_hint: "Use clear_pending_reviews to inspect or administer plugin reconciliation review queues."
tier: admin
args:
  action: "Required action: list or clear."
  plugin_id: "Optional plugin identifier filter."
  ids: "Optional pending-review row IDs returned by list mode."
---

# clear_pending_reviews

## Purpose

Use `clear_pending_reviews` to inspect or clear rows in the pending plugin review queue. Pending reviews are created by plugin reconciliation when FlashQuery needs explicit review of plugin-owned document or record state. The tool supports list mode for discovery and clear mode for cleanup by plugin scope, specific row IDs, or all rows in the current FlashQuery instance.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | string | yes | none | `list` returns pending rows; `clear` deletes matching rows. |
| `plugin_id` | string | no | none | Optional plugin identifier filter. |
| `ids` | string[] | no | none | Optional pending review row IDs, usually from `action: "list"`. |

## Returns

For `action: "list"`, returns JSON text with `pending` and `items`. Each item includes review ID, optional `fqc_id`, type, plugin ID, table, path when present, and context. For `action: "clear"`, returns `cleared` plus the cleared items. Clearing by IDs with no matches returns a `no_matching_items` warning.

## Examples

```json
{ "action": "list", "plugin_id": "crm" }
```

Lists pending review rows for the CRM plugin.

```json
{ "action": "clear", "ids": ["7ac1...", "8bd2..."] }
```

Clears specific review rows returned by list mode.

```json
{ "action": "clear", "plugin_id": "crm" }
```

Clears all pending review rows for one plugin in the current FlashQuery instance.

## Gotchas

- Always use `action: "list"` first when you need precise review IDs.
- `action: "clear"` with no `plugin_id` and no `ids` clears all pending review rows for the current FlashQuery instance.
- This tool does not change plugin records; it only changes the pending review queue.
- Pending reviews may also be cleared indirectly by reconciliation or plugin unregister flows.

## Related Tools

- `search_records` and `get_record` can surface pending review metadata during record workflows.
- `write_record` may create or return pending review summaries after reconciliation.
- `unregister_plugin` clears pending reviews for the removed plugin.
- `get_plugin_info` confirms plugin identity before queue administration.
