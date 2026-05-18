---
name: write_record
description: "Create or update a schema-validated plugin record in a registered plugin table. Pass {help: true} for full help."
help_hint: "Use write_record when structured data belongs to a plugin table rather than a markdown document or memory."
tier: read-write
args:
  mode: "Required write mode: create or update."
  plugin_id: "Required plugin identifier."
  plugin_instance: "Optional plugin instance name; defaults to default."
  table: "Required table name from the plugin schema."
  id: "Required for update mode and not allowed for create mode."
  data: "Required record field object validated against the plugin table schema."
  include: "Optional result sections: data, schema_metadata."
---

# write_record

## Purpose

Use `write_record` to create or update one structured record owned by a registered plugin. The tool resolves the plugin table, validates the submitted fields against that table's schema, runs plugin-document reconciliation, writes the row, and returns a record identification block. Tables with configured `embed_fields` refresh embeddings after successful writes.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `mode` | string | yes | none | `create` inserts a new row; `update` changes an existing row. |
| `plugin_id` | string | yes | none | Registered plugin identifier. |
| `plugin_instance` | string | no | `default` | Plugin instance identifier for multi-instance plugins. |
| `table` | string | yes | none | Table name as declared in the plugin schema. |
| `id` | string | update yes | none | Record UUID. Required for updates and rejected for creates. |
| `data` | object | yes | none | Schema-validated field values to insert or update. |
| `include` | string[] | no | write default | Optional payload sections: `data`, `schema_metadata`. |

## Returns

Returns JSON text containing the record identification block, timestamps, plugin/table metadata, optional requested include sections, optional reconciliation summary, and optional pending-review summary. Expected errors cover missing or unknown plugin tables, invalid input for the plugin schema, and update IDs that do not match a record.

## Examples

```json
{ "mode": "create", "plugin_id": "crm", "table": "contacts", "data": { "name": "Ada Lovelace", "status": "active" }, "include": ["data"] }
```

Creates a CRM contact and includes the stored data fields.

```json
{ "mode": "update", "plugin_id": "crm", "table": "contacts", "id": "2f4b...", "data": { "status": "archived" } }
```

Updates one known record by ID.

## Gotchas

- Register the plugin schema before writing records; unknown plugin tables return expected `not_found` errors.
- Create mode cannot provide an `id`; update mode must provide an `id`.
- `data` is validated against the plugin table schema, so generated fields and wrong types are rejected.
- This is not for markdown documents or memories; use `write_document` or `write_memory` for those domains.
- Writes may include reconciliation and pending-review payloads when plugin-owned documents need attention.

## Related Tools

- `register_plugin` creates or updates plugin schemas and tables.
- `get_record` retrieves one known plugin record.
- `search_records` discovers plugin records by filters, text, semantic query, or tag.
- `archive_record` hides plugin records from normal active search.
