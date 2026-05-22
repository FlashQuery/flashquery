---
name: search_tools
description: "Search the visible FlashQuery-native and brokered tool index and return ranked SearchResult envelopes. Pass {help: true} for full help."
help_hint: "Use search_tools to discover the right tool by intent when tool_search is enabled or the available surface is large."
tier: read-only
args:
  query: "Required natural-language tool search query."
  limit: "Optional maximum result count."
---

# search_tools

## Purpose

Use `search_tools` to discover callable tools by intent. It searches the visible BM25 tool index for the current host or delegated purpose and returns ranked `SearchResult` envelopes with enough metadata to compose the next direct tool call. It is single-shot retrieval; there is no companion schema-fetch tool.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | yes | none | Natural-language tool search query. Empty queries return an empty result list. |
| `limit` | number | no | `8` | Maximum ranked results to return. |

## Returns

Returns an array of `SearchResult` objects. Each result includes `server`, `tool`, `registry_key`, `description`, `arg_summary`, `score`, and `normalizedScore`. `score` is the raw BM25 score; `normalizedScore` is scaled for comparing results within the same response. FlashQuery-native results also include `has_help: true` and `help_hint` from tool metadata. Brokered results omit `help_hint` and omit `has_help` or set it to `false`. Empty corpus or empty query returns `[]`, not an error.

## Examples

```json
{ "query": "insert text after a heading", "limit": 5 }
```

Finds document editing tools such as `insert_in_doc`.

```json
{ "query": "chain multiple operations with conditional logic" }
```

Finds composition-oriented tools such as `call_macro`.

```json
{ "query": "" }
```

Returns an empty array.

## Gotchas

- Results are only for tools visible to the current host or delegated purpose.
- `has_help` and `help_hint` are native-only help fields for `server === "flashquery"`.
- Brokered tool descriptions reflect any configured `description_override`.
- Use result `tool` names directly for FlashQuery-native calls; brokered dispatch follows the brokered surface exposed to the caller.

## Related Tools

- `call_model` may expose only `search_tools` up front for `tool_search: enabled` purposes.
- `call_macro` can use discovered tools in compound workflows.
- `get_document`, `insert_in_doc`, and other native tools provide `{help: true}` pages when `has_help` is true.
