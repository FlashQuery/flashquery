---
name: search_records
description: "Search active plugin records with filters, text, semantic fields, or taggable-table discovery. Pass {help: true} for full help."
help_hint: "Use search_records when you need to find structured plugin rows instead of documents or memories."
tier: read-only
args:
  plugin_id: "Required unless taggable_tables_only is true."
  plugin_instance: "Optional plugin instance name; defaults to default."
  table: "Required unless taggable_tables_only is true."
  filters: "Optional equality filters applied with AND logic."
  query: "Optional text query; semantic search is used when embed_fields exist."
  tag: "Optional tag filter for taggable plugin tables."
  taggable_tables_only: "Optional cross-plugin taggable-table search mode."
  include: "Optional result sections: data, schema_metadata."
  limit: "Optional max result count; defaults to 10."
---

# search_records

## Purpose

Use `search_records` to discover active rows in plugin-owned structured tables. It supports equality filters, text queries, semantic search when a table has `embed_fields`, and taggable-table lookup across registered plugins. The tool is scoped to the current FlashQuery instance and returns record identification results.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugin_id` | string | conditionally | none | Required with `table` unless `taggable_tables_only` is true. |
| `plugin_instance` | string | no | `default` | Plugin instance identifier for the specific plugin table path. |
| `table` | string | conditionally | none | Table name from the plugin schema. |
| `filters` | object | no | none | Key-value equality filters applied with AND logic. |
| `query` | string | no | empty | Text query. Uses vector similarity when the table has embeddings; otherwise uses ILIKE over text-like fields. |
| `tag` | string | no | none | Tag to match when a plugin table has a `tags` or `tag` column. |
| `taggable_tables_only` | boolean | no | false | Search all registered taggable plugin tables instead of one plugin/table pair. |
| `include` | string[] | no | search default | Optional result sections: `data`, `schema_metadata`. |
| `limit` | number | no | 10 | Maximum number of rows to return. |

## Returns

Returns JSON text with `plugin_id` and `table` when a single table is searched, the query string, optional tag, `total`, and `results`. Results are record identification blocks and can include requested data or schema metadata. Semantic searches include a similarity score. Empty matches return `total: 0` and an empty `results` array.

## Examples

```json
{ "plugin_id": "crm", "table": "contacts", "filters": { "status": "active" }, "include": ["data"], "limit": 5 }
```

Finds active CRM contacts by field filter.

```json
{ "plugin_id": "crm", "table": "opportunities", "query": "renewal risk", "limit": 10 }
```

Searches opportunity records by semantic vector or text fallback, depending on table schema.

```json
{ "taggable_tables_only": true, "tag": "vip", "limit": 10 }
```

Searches registered plugin tables that expose a `tags` or `tag` column.

## Gotchas

- `plugin_id` and `table` are required unless `taggable_tables_only` is true.
- Normal table searches filter to `status: "active"`; archived rows are hidden from search.
- Semantic search only runs when the plugin table declares `embed_fields` and rows have embeddings.
- Taggable-table mode uses registered schemas and may return a warning when no taggable tables exist.
- Use `search` for documents and memories; this tool is for plugin records only.

## Related Tools

- `get_record` retrieves one known record by ID.
- `write_record` creates or updates plugin records.
- `archive_record` archives active plugin records.
- `get_plugin_info` shows plugin tables and schema details.
