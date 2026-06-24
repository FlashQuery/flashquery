---
name: query_graph
description: "Read the optional document graph with bounded node, edge, traversal, provenance, diagnostic, and seeded community actions. Pass {help: true} for full help."
help_hint: "Use query_graph when graph.enabled is true and you need read-only graph details for existing chunks."
tier: read-only
args:
  action: "Required graph read action."
  chunk_id: "Optional chunk/node id used by node, edges, neighbors, subgraph, impact, provenance_chain, and community_for."
  from: "Optional start chunk id for path."
  to: "Optional target chunk id for path."
  relations: "Optional relation filter."
  direction: "Optional traversal direction: in, out, or both."
  max_depth: "Optional traversal depth, capped at 5."
  max_hops: "Optional path hop cap, capped at 5."
  include_stale: "Optional stale-edge inclusion flag."
  include_resolved: "Optional contradiction stale-edge inclusion flag."
  document_status: "Optional document status filter."
  limit: "Optional result cap, capped at 250."
  confidence_threshold: "Optional weak_paths threshold."
  community_id: "Optional community id for community_members."
  min_members: "Optional minimum member count for list_communities."
---

# query_graph

Read the optional document graph through bounded public MCP actions.

Use `query_graph` when `graph.enabled:true` and you need graph details for chunks
that already exist in FlashQuery. The tool is read-only. It does not run graph
maintenance, graph lint, LLM classification, or community detection.

Supported actions:

- Primitive reads: `node`, `edges`, `neighbors`, `path`, `subgraph`, `stats`, `schema`
- Compound reads: `provenance_chain`, `impact`, `contradictions`, `weak_paths`, `ungrounded_edges`
- Seeded community reads: `community_for`, `community_members`, `list_communities`

Disabled graph behavior:

When `graph:` is absent or `graph.enabled:false`, the tool is still discoverable
and returns a canonical expected-error envelope with `error:"unsupported"` and
`details.code:"graph_disabled"`. The response includes remediation telling the
caller to enable graph configuration and initialize schema. This is not a runtime
failure and does not set `isError:true`.

Partial graph behavior:

Phase 172 reads deterministic structural graph rows and nullable seeded graph
metadata. Tier 2/Tier 3 classification, lint execution, and community detection
are Phase 173 work. Until those later jobs populate data, compound/community
actions return contract-shaped empty or not-applicable results instead of
inventing graph state.

Bounds and filters:

- Traversal depth is capped at 5.
- Result limit is capped at 250.
- `query_graph` includes inactive graph nodes by default and labels each node
  with `document.status`.
- Use `document_status`, `relations`, `direction`, `include_stale`, and
  action-specific parameters to narrow results.

Examples:

```json
{ "action": "schema" }
```

```json
{
  "action": "neighbors",
  "chunk_id": "00000000-0000-0000-0000-000000000000",
  "relations": ["contains", "references"],
  "max_depth": 1,
  "limit": 25
}
```
