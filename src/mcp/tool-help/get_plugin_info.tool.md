---
name: get_plugin_info
description: "Inspect a registered plugin's identity, tables, schema, and status details. Pass {help: true} for full help."
help_hint: "Use get_plugin_info before record calls when you need table names, schema details, or plugin registration status."
tier: read-only
args:
  plugin_id: "Required plugin identifier."
  plugin_instance: "Optional plugin instance name; defaults to default."
  include: "Optional sections: schema, tables, status_detail. Defaults to tables."
---

# get_plugin_info

## Purpose

Use `get_plugin_info` to inspect a registered plugin before creating, retrieving, or searching records. The tool reads the plugin manager registry and returns plugin identity plus include-gated table, schema, and status details.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugin_id` | string | yes | none | Registered plugin identifier. |
| `plugin_instance` | string | no | `default` | Plugin instance identifier. |
| `include` | string[] | no | `["tables"]` | Optional payload sections: `schema`, `tables`, `status_detail`. |

## Returns

Returns JSON text with plugin identification, status `registered`, table count, and requested include sections. `tables` returns table names. `schema` returns the parsed plugin schema. `status_detail` returns plugin instance, table prefix, and schema version. Missing plugins return an expected `not_found` error.

## Examples

```json
{ "plugin_id": "crm" }
```

Returns the CRM plugin identity and table list.

```json
{ "plugin_id": "crm", "plugin_instance": "sales", "include": ["tables", "schema", "status_detail"] }
```

Returns detailed schema and status information for a named instance.

## Gotchas

- This tool reads the in-memory plugin manager registry; register the plugin first.
- The default include is table names only, which is usually enough before record calls.
- It does not create or migrate tables; use `register_plugin` for schema installation.
- It does not inspect individual record rows; use `get_record` or `search_records`.

## Related Tools

- `register_plugin` installs or updates plugin schemas.
- `unregister_plugin` removes plugin registry state.
- `write_record` creates or updates plugin records.
- `search_records` queries plugin records by table.
