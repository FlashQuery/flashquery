---
name: write_memory
description: "Create a persistent memory or update an existing memory by creating a new latest version. Pass {help: true} for full help."
help_hint: "Use write_memory for durable user or project facts that should be searchable across sessions."
tier: read-write
args:
  mode: "Required create or update mode."
  content: "Required for create; optional replacement content for update."
  memory_id: "Required for update mode."
  tags: "Optional replacement tag list."
  plugin_scope: "Optional create-mode plugin scope."
  include: "Optional content and tags_full payload fields."
---

# write_memory

## Purpose

Use `write_memory` to save persistent memory facts or create a new latest version of an existing memory. Create mode inserts a new memory row. Update mode preserves history by creating a new version instead of mutating old content in place. Tags are validated and stored with the memory, and embeddings refresh in the background.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `mode` | string | yes | none | `create` or `update`. |
| `content` | string | create yes, update optional | existing content on update | Memory content. |
| `memory_id` | string | update only | none | Existing latest memory ID to version. |
| `tags` | string[] | no | `[]` on create, existing tags on update | Replacement tag list. |
| `plugin_scope` | string | create only | `global` | Scope name resolved to a plugin scope when available. |
| `include` | array | no | `[]` | Optional result payload fields: `content`, `tags_full`. |

## Returns

Returns JSON text with memory identification, timestamps, version metadata, optional requested include payloads, and tag/plugin scope data. Expected errors cover missing mode, invalid mode, invalid tags, generated fields, missing update IDs, non-latest updates, and missing memories.

## Examples

```json
{ "mode": "create", "content": "The user prefers concise status updates.", "tags": ["preference"] }
```

Creates a new memory.

```json
{ "mode": "update", "memory_id": "44b1...", "content": "The user prefers concise status updates with concrete next steps." }
```

Creates a new latest version.

```json
{ "mode": "create", "content": "CRM contacts live in the crm plugin.", "plugin_scope": "crm", "include": ["content"] }
```

Creates scoped memory and includes content in the result.

## Gotchas

- Update mode requires a latest memory ID; non-latest versions cannot be updated.
- Tags replace the tag list for the new version.
- Generated fields such as IDs, version, status, and timestamps cannot be provided.
- Use `archive_memory` when a memory should be hidden instead of versioned.

## Related Tools

- `get_memory` retrieves known memories.
- `search` discovers memories by content or tags.
- `archive_memory` archives memory chains.
