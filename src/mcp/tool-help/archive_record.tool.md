---
name: archive_record
description: "Archive one or more plugin records by setting active rows to archived while preserving history. Pass {help: true} for full help."
help_hint: "Use archive_record when plugin records should leave active search without deleting their database rows."
tier: read-write
args:
  targets: "Required ordered array of archive targets with plugin_id, optional plugin_instance, table, and id."
---

# archive_record

## Purpose

Use `archive_record` to soft-archive plugin-owned structured records. The tool accepts an ordered list of targets, resolves each plugin table, runs reconciliation, updates the row status to `archived`, updates timestamps, and preserves the row for historical access.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `targets` | object[] | yes | none | Ordered archive targets. Each target contains `plugin_id`, optional `plugin_instance`, `table`, and `id`. |
| `targets[].plugin_id` | string | yes | none | Registered plugin identifier. |
| `targets[].plugin_instance` | string | no | `default` | Plugin instance identifier. |
| `targets[].table` | string | yes | none | Table name from the plugin schema. |
| `targets[].id` | string | yes | none | Record UUID to archive. |

## Returns

Returns JSON text containing an array of per-target results in the same order as the request. Successful entries contain record identification fields, reconciliation metadata when applicable, and `archived_at` when the table supports that column. Tables without `archived_at` still archive by updating row status and return `warnings: ["archived_at_unavailable"]`. Missing tables or records produce per-item expected error envelopes where possible.

## Examples

```json
{ "targets": [{ "plugin_id": "crm", "table": "contacts", "id": "2f4b..." }] }
```

Archives one contact record.

```json
{ "targets": [{ "plugin_id": "crm", "plugin_instance": "sales", "table": "opportunities", "id": "9d1c..." }] }
```

Archives a record from a named plugin instance.

## Gotchas

- This is not a hard delete and does not drop plugin table rows.
- Archived records are excluded from normal `search_records` active-result paths.
- The archived row's `status` field is updated in the database but is not included in the default response unless you later retrieve the record with data included.
- Tables without an `archived_at` column still update status and return an `archived_at_unavailable` warning.
- Batch results preserve request order, so callers can match successes and expected errors back to targets.
- Write locks may block the operation while another process is modifying records.

## Related Tools

- `search_records` finds active plugin records before archival.
- `get_record` can retrieve a known record by ID.
- `write_record` changes record field values.
- `unregister_plugin` removes plugin registry state, not individual record lifecycle.
