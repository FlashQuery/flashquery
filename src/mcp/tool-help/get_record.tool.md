---
name: get_record
description: "Retrieve one plugin-owned structured record by plugin, table, and record ID. Pass {help: true} for full help."
help_hint: "Use get_record when you already know the plugin table and record ID and need the canonical record payload."
tier: read-only
args:
  plugin_id: "Required plugin identifier."
  plugin_instance: "Optional plugin instance name; defaults to default."
  table: "Required table name from the plugin schema."
  id: "Required record UUID."
  include: "Optional result sections: data, schema_metadata."
---

# get_record

## Purpose

Use `get_record` to fetch a single structured record from a registered plugin table when you already know its ID. The tool runs plugin-document reconciliation, resolves the table through the plugin registry, selects the row scoped to the current FlashQuery instance, and returns a structured record result.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugin_id` | string | yes | none | Registered plugin identifier. |
| `plugin_instance` | string | no | `default` | Plugin instance identifier for multi-instance plugins. |
| `table` | string | yes | none | Table name as declared in the plugin schema. |
| `id` | string | yes | none | Record UUID to retrieve. |
| `include` | string[] | no | `["data"]` | Optional payload sections: `data`, `schema_metadata`. |

## Returns

Returns JSON text containing a record identification block with plugin/table metadata, timestamps, and include-gated payload sections. The default include behavior returns record data. Expected errors report missing records as `not_found`; runtime errors cover unexpected registry or database failures.

## Examples

```json
{ "plugin_id": "crm", "table": "contacts", "id": "2f4b..." }
```

Retrieves a contact with the default data payload.

```json
{ "plugin_id": "crm", "plugin_instance": "sales", "table": "opportunities", "id": "9d1c...", "include": ["data", "schema_metadata"] }
```

Retrieves a record from a named plugin instance with schema metadata.

## Gotchas

- This tool is not a discovery surface; use `search_records` if you do not already know the record ID.
- The plugin instance defaults to `default`, which must match how the plugin was registered.
- Archived records can still be retrieved by known ID if the row remains in the plugin table.
- Reconciliation warnings are logged rather than blocking normal retrieval when possible.

## Related Tools

- `search_records` finds records by filters, text, semantic search, or tag.
- `write_record` creates or updates plugin records.
- `archive_record` archives known plugin records.
- `get_plugin_info` inspects plugin table names and schema details.
