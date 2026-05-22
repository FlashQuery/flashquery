---
name: unregister_plugin
description: "Unregister plugin registry state with live-record conflict checks and optional force cleanup. Pass {help: true} for full help."
help_hint: "Use unregister_plugin only when removing a plugin registration and accepting the documented cleanup effects."
tier: admin
args:
  plugin_id: "Required plugin identifier."
  plugin_instance: "Optional plugin instance name; defaults to default."
  force: "Optional boolean; when true, unregister despite live records and leave rows orphaned."
---

# unregister_plugin

## Purpose

Use `unregister_plugin` to remove a plugin registry entry from FlashQuery. The tool inventories plugin tables, blocks removal when live active records exist unless `force` is true, clears plugin-owned document ownership, deletes plugin-scoped memories, clears pending plugin review rows, removes the registry entry, unloads the plugin manager entry, rebuilds the type registry, and reloads manifests.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugin_id` | string | yes | none | Registered plugin identifier. |
| `plugin_instance` | string | no | `default` | Plugin instance identifier. |
| `force` | boolean | no | false | When true, unregister even when live records exist; existing plugin table rows are left orphaned. |

## Returns

Returns JSON text with plugin identification, status `unregistered`, plugin instance, unregister timestamp, count of document ownership rows cleared, and count of plugin-scoped memories deleted. If live records exist and `force` is false, returns a structured conflict. Forced unregister with live records returns an orphaned-record warning.

## Examples

```json
{ "plugin_id": "crm" }
```

Unregisters CRM only when no active plugin records remain.

```json
{ "plugin_id": "crm", "plugin_instance": "sales", "force": true }
```

Forces removal of a named plugin instance, leaving existing plugin rows orphaned.

## Gotchas

- This is an admin lifecycle operation, not a record deletion tool.
- Without `force`, live active records block unregister with a conflict.
- With `force: true`, plugin table rows are not dropped or rewritten; they become orphaned from registry state.
- Pending plugin reviews for the plugin are deleted during unregister.
- Plugin-scoped memories are deleted and plugin-owned document ownership is cleared.

## Related Tools

- `register_plugin` installs or updates plugin schemas.
- `get_plugin_info` confirms a plugin is registered before removal.
- `archive_record` archives plugin records before unregistering.
- `clear_pending_reviews` lists or clears pending plugin review rows directly.
