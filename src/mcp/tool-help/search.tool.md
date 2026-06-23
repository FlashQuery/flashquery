---
name: search
description: "Search documents and memories together by text, tags, path filters, semantic similarity, or list-mode filters. Pass {help: true} for full help."
help_hint: "Use search when you need to discover documents or memories before calling get_document or get_memory."
tier: read-only
args:
  query: "Optional search query."
  mode: "Optional filesystem, semantic, or mixed mode."
  tags: "Optional tag filters."
  tag_match: "Optional any or all tag matching."
  limit: "Optional global result limit."
  limit_chunks_per_result: "Optional maximum matched chunks per document result."
  entity_types: "Optional documents and/or memories domains."
  list_all: "Optional unfiltered list-mode opt-in."
  path_filter: "Optional document path substring."
  embedding_names: "Optional embedding catalog entries for semantic or mixed search."
  include_archived: "Optional archived entity inclusion flag."
  body_contains: "Unsupported deferred literal body-search parameter."
  body_regex: "Unsupported deferred literal body-search parameter."
  regex: "Unsupported deferred literal body-search parameter."
  line_range: "Unsupported deferred literal body-search parameter."
  lines: "Unsupported deferred literal body-search parameter."
  byte_range: "Unsupported deferred literal body-search parameter."
---

# search

## Purpose

Use `search` to discover documents and memories through one unified result list. It can match document titles, paths, tags, memory content, semantic embeddings when available, or both filesystem and semantic sources in mixed mode. Catalog-backed semantic document results can include matched chunk metadata, and multiple active embedding entries are fused with reciprocal rank fusion. It also supports filtered list-mode for empty queries when tags, `path_filter`, or `list_all: true` make the listing intentional.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | no | empty | Search text. Empty queries require filters or `list_all: true`. |
| `mode` | string | no | `mixed` | `filesystem`, `semantic`, or `mixed`. |
| `tags` | string[] | no | none | Filter documents and memories by tags. |
| `tag_match` | string | no | `any` | `any` matches at least one tag; `all` requires every tag. |
| `limit` | number | no | `10` | Global limit after merge, dedupe, and sort. |
| `limit_chunks_per_result` | integer | no | `3` | Maximum matched chunks per document result. Must be between 1 and 25. |
| `entity_types` | array | no | enabled searchable domains | Choose `documents`, `memories`, or both. |
| `list_all` | boolean | no | `false` | Allows empty unfiltered list-mode search. |
| `path_filter` | string | no | none | Document path substring filter for filesystem/list searches. |
| `embedding_names` | string[] | no | active catalog entries | Embedding catalog entries to query for semantic/mixed search. Empty arrays are invalid; unknown or deactivated names return expected errors. Ignored with a warning in filesystem mode. |
| `include_archived` | boolean | no | `false` | Include archived documents and memories. |
| `body_contains`, `body_regex`, `regex`, `line_range`, `lines`, `byte_range` | any | no | none | Recognized only to return a clear `invalid_input`; literal body grep, regex, line-range, and byte-range search are deferred to macro/string operations. |

## Returns

Returns JSON text with `query`, `entity_types`, `mode`, optional `embeddings_queried`, optional `fusion`, optional `fusion_k`, `total`, optional `warnings`, and `results`. `embeddings_queried` lists successful catalog retrievers when catalog search is active. `fusion` is `none` or `rrf`; `fusion_k` is present for reciprocal rank fusion.

Document results include `entity_type`, `identifier`, `title`, `path`, `fq_id`, tags, modified time, size, optional score, `match_source`, and optional `matched_chunks`. RRF-fused document results can also include `fused_score`, `rank_sum`, and `per_embedding_ranks`. Each matched chunk includes `chunk_id`, `heading_path`, `breadcrumb`, `content`, `span_start`, `span_end`, `score`, `per_embedding_ranks`, and `indexed_at`. Memory results include `entity_type`, `identifier`, `memory_id`, `content_preview`, tags, plugin scope, timestamps, optional score, and `match_source`; memory results do not include `matched_chunks`.

## Examples

```json
{ "query": "planning", "entity_types": ["documents", "memories"], "mode": "mixed", "limit": 10 }
```

Searches both domains using mixed matching.

```json
{ "query": "", "tags": ["project/acme"], "entity_types": ["documents"], "mode": "filesystem" }
```

Lists tagged documents without semantic search.

```json
{ "query": "retention policy", "mode": "semantic", "entity_types": ["documents"], "embedding_names": ["primary"], "limit_chunks_per_result": 2 }
```

Searches documents semantically with the `primary` embedding catalog entry and returns up to two matched chunks per document.

## Gotchas

- This is not literal body grep or regex search.
- Semantic mode can return `unsupported` when embeddings are unavailable.
- `mode: "semantic"` requires a non-empty query.
- `embedding_names` requires catalog-backed semantic search; pass at least one active catalog entry name when specifying it.
- `embedding_names` is ignored in filesystem mode and returns an `embedding_names_ignored` warning.
- `limit_chunks_per_result` caps chunks per document result independently of the global result `limit`.
- `matched_chunks` are document-only; memory semantic hits preserve the memory result shape.
- Empty unfiltered queries require `list_all: true` to prevent accidental broad listings.
- Empty filtered list-mode searches require explicit `entity_types`.
- Passing deferred literal body-search parameters returns `invalid_input` instead of silently ignoring them.
- Use `get_document` or `get_memory` after search when full content is needed.

## Related Tools

- `get_document` reads selected document results.
- `get_memory` reads selected memory results.
- `apply_tags` changes tags that search can filter on.
