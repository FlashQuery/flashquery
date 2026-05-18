---
name: register_plugin
description: "Register or update a plugin YAML schema and create or migrate plugin tables safely. Pass {help: true} for full help."
help_hint: "Use register_plugin when installing a plugin schema or applying a safe additive schema version update."
tier: admin
args:
  schema_path: "Optional path to a YAML schema file; takes precedence over schema_yaml."
  schema_yaml: "Optional inline YAML schema string."
  plugin_instance: "Optional plugin instance name; defaults to default."
---

# register_plugin

## Purpose

Use `register_plugin` to install or update a FlashQuery plugin schema. The tool reads YAML from `schema_path` or `schema_yaml`, validates the plugin instance name, creates plugin tables, writes the registry entry, loads the schema into the in-memory plugin manager, rebuilds the global type registry, and reloads manifests.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `schema_path` | string | conditionally | none | Path to a YAML schema file on disk. Takes precedence when both YAML sources are provided. |
| `schema_yaml` | string | conditionally | none | Inline YAML schema string. Required when `schema_path` is absent. |
| `plugin_instance` | string | no | `default` | Plugin instance identifier for multi-instance plugin deployments. |

## Returns

Returns JSON text with plugin identification, status `registered`, table count, registration timestamp, `was_new`, plugin instance, and schema version. Re-registration with the same version is idempotent. Version upgrades apply safe additive table or column changes and return `safe_change_count`; unsafe changes return a structured conflict with guidance.

## Examples

```json
{ "schema_path": "/Users/matt/plugins/crm/plugin.yml" }
```

Registers a plugin from a local YAML file.

```json
{ "schema_yaml": "plugin:\n  id: crm\n  name: CRM\n  version: 1.0.0\ntables: []", "plugin_instance": "sales" }
```

Registers an inline schema for a named plugin instance.

## Gotchas

- Provide either `schema_path` or `schema_yaml`; `schema_path` wins if both are present.
- Safe migrations are additive only. Removed tables, removed columns, and type changes are rejected as conflicts.
- Downgrades update registry metadata without applying destructive DDL changes.
- Registering creates database objects with FlashQuery plugin table prefixes; this is an admin operation.
- Manifest reload failures are logged as non-blocking after successful registration.

## Related Tools

- `get_plugin_info` verifies registered plugin schema and table names.
- `unregister_plugin` removes plugin registry state.
- `write_record` creates records in registered plugin tables.
- `search_records` queries records after plugin registration.
