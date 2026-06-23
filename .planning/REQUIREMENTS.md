# Requirements: FlashQuery Core v4.3 Graph Document Intelligence

**Defined:** 2026-06-23
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns - across tools, across sessions, with zero vendor lock-in.

## Source Documents

- Requirements: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md`
- Test Plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md`

This GSD milestone compresses the source document's six implementation phases into two GSD phases:

- GSD Phase 171 covers source phases 1-3: Config, Schema, Vocabulary; Tier 1 Structural Graph; Read Surfaces.
- GSD Phase 172 covers source phases 4-6: Tier 2/Tier 3 Async Processing; Lifecycle, Lint, Communities; End-to-End Hardening.

## v4.3 Requirements

### Foundation, Schema, and Vocabulary

- [ ] **GR-001**: User can leave `graph:` absent or set `graph.enabled:false` and get unchanged FlashQuery behavior with no graph queueing, graph writes, graph LLM calls, or silent response-shape drift.
- [ ] **GR-002**: User can enable graph intelligence only with a valid graph config whose embedding and classification references are cross-validated against the active embedding catalog and LLM model/purpose config.
- [ ] **GR-003**: User can rely on strict graph relation and prompt sidecars, with deterministic packaged defaults or actionable remediation for missing files and validation failures before workers run.
- [ ] **GR-004**: User can use namespaced template variables such as `{{graph:classified_types}}` without regressing existing `{{ref:...}}` reference resolution, escaping, aliases, or unresolved-token behavior.
- [ ] **GR-005**: User gets idempotent graph schema DDL for graph nodes, graph edges, pending edge jobs, and graph maintenance state with instance isolation, chunk foreign keys, required indexes, and JSONB support.
- [ ] **GR-006**: User can trust that graph nodes use existing `fqc_chunks.id` identity and do not create an alternate document-section identity system.
- [ ] **GR-007**: User gets the v1 relation vocabulary with structural `contains` and `references` edges, ten classified relation types, explicit directionality/symmetry, and no persisted semantic-similarity topology.
- [ ] **GR-008**: User can inspect graph edges with tier-appropriate confidence, confidence score, reasoning for inferred edges, validated metadata qualifiers, and relation-specific metadata validation.

### Structural Graph and Read Surfaces

- [ ] **GR-009**: User gets deterministic Tier 1 graph edges from heading hierarchy and markdown cross-references, including unresolved-target diagnostics and no false links from fenced code blocks.
- [ ] **GR-013A**: User gets synchronous changed-chunk stale marking and Tier 1 structural edge updates after chunk diffing, while ordinary document writes never wait for graph LLM work.
- [ ] **GR-014A**: User can control document processing with `fq_processing: full|embedded|none`, where absent means `full`, embedded mode skips graph state, none mode skips chunks/embeddings/graph while preserving vault listing.
- [ ] **GR-016A**: User gets graph read surfaces whose default active/inactive filtering matches the surface: search and get-document hide inactive targets by default while query/provenance can include and label inactive nodes.
- [ ] **GR-017**: User can call a read-only `query_graph` MCP tool for node, edge, neighbor, path, subgraph, schema, stats, provenance, impact, weak-path, ungrounded-edge, contradiction, and community-oriented graph reads with bounded traversal and expected-error envelopes.
- [ ] **GR-018**: User can request graph-expanded unified `search` while preserving existing filesystem, semantic, and mixed search behavior for callers that do not opt into graph options.
- [ ] **GR-019**: User can request graph-aware `get_document` output, including `graph_summary`, graph-primary connections, optional embedding-only neighbors, inactive-target opt-in, and clear validation for graph-aware connection limits.
- [ ] **GR-020A**: User can query provenance chains and question lifecycle metadata surfaced from graph node/edge state, with extracted edges prioritized before inferred edges.
- [ ] **GR-024A**: User gets canonical JSON MCP success, warning, unsupported, and expected-error envelopes for the new graph tool and graph-aware extensions, including graph-disabled discoverability.

### Async Classification, Lifecycle, Lint, and Hardening

- [ ] **GR-010**: User gets bounded Tier 2 candidate selection using existing chunk embedding RPCs for candidate discovery only, with instance filtering, same-document exclusions, threshold/percentile modes, and save-time job caps.
- [ ] **GR-011**: User gets asynchronous Tier 3 node and edge analysis that sequences node analysis before edge classification, validates all LLM JSON through `parseLlmJson`, and records graph LLM trace/cost metadata.
- [ ] **GR-012**: User gets a durable pending edge queue with stable dedupe keys, retry scheduling, attempt counts, dead-letter status, remediation visibility, shutdown awareness, per-run limits, and instance filtering.
- [ ] **GR-013B**: User gets Tier 3 re-analysis that updates confirmed stale edges in place and deletes or replaces stale rows when relationships changed or disappeared.
- [ ] **GR-014B**: User gets complete `fq_processing` transition behavior across full, embedded, and none modes, including cleanup or preservation semantics for chunks, embeddings, and graph state.
- [ ] **GR-015**: User can archive, miss, unarchive, and hard-delete documents with graph state preserved for historical provenance where appropriate and cascaded only on hard delete.
- [ ] **GR-016B**: User gets lifecycle-aware graph filtering across search, get-document, query_graph, provenance, and graph lint after archived/missing states and stale graph state exist.
- [ ] **GR-020B**: User gets graph lint support for question-resolution discovery, dependent follow-up flags, and provenance traversal over inactive historical nodes.
- [ ] **GR-021**: User can run graph maintenance through `maintain_vault` actions `graph_lint`, `graph_lint_status`, and `graph_lint_prune`, receiving semantic categories for questions, provenance, contradictions, duplicates, communities, and integrity plus raw finding details and deltas.
- [ ] **GR-022**: User gets on-demand community detection and labeling from stored graph topology, with ephemeral read-only community IDs, labels, summaries, strength/health metadata, and no manufactured topology from embedding similarity.
- [ ] **GR-023**: User gets bounded graph cost/resource controls, visible graph worker counts, warnings for skipped work, and graph LLM usage separated by purpose/model/trace.
- [ ] **GR-024B**: User gets end-to-end public workflow hardening across MCP transport, directed scenarios, YAML scenarios, disabled/partial graph behavior, and security-bounded error payloads.

## Future Requirements

Deferred beyond this milestone:

- Stable community identity across lint runs.
- Edge history and supersession chains.
- Direct contradiction review lifecycle.
- User community curation such as rename, merge, split, pin, or hide.
- Non-markdown graph processing after the separate non-markdown feature ships.
- Scheduled autonomous research loops.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rebuilding section-level chunking, `fqc_chunks`, chunk embeddings, or `match_chunks_<name>()` | These are shipped dependencies from v4.1. |
| Rebuilding Macro Language additions from the research document | Already implemented and validated. |
| Rebuilding JSON Validation Phase A | v4.2 shipped `parseLlmJson`; this milestone only integrates graph-specific parse sites. |
| Non-markdown document graph processing | v1 graph intelligence operates on markdown chunks already tracked by FlashQuery. |
| Direct user editing of graph metadata | Graph state is source-derived and re-derived from documents. |
| Graph visualization UI | FlashQuery remains CLI + MCP only. |
| Server-side session state or scheduler | MCP remains stateless; graph work is scan-triggered, queue-driven, or tool-triggered. |
| Apache AGE, Neo4j, pg_graphql, or other graph databases/extensions | Supabase/Postgres tables and RPC functions are authoritative. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GR-001 | Phase 171 | Pending |
| GR-002 | Phase 171 | Pending |
| GR-003 | Phase 171 | Pending |
| GR-004 | Phase 171 | Pending |
| GR-005 | Phase 171 | Pending |
| GR-006 | Phase 171 | Pending |
| GR-007 | Phase 171 | Pending |
| GR-008 | Phase 171 | Pending |
| GR-009 | Phase 171 | Pending |
| GR-013A | Phase 171 | Pending |
| GR-014A | Phase 171 | Pending |
| GR-016A | Phase 171 | Pending |
| GR-017 | Phase 171 | Pending |
| GR-018 | Phase 171 | Pending |
| GR-019 | Phase 171 | Pending |
| GR-020A | Phase 171 | Pending |
| GR-024A | Phase 171 | Pending |
| GR-010 | Phase 172 | Pending |
| GR-011 | Phase 172 | Pending |
| GR-012 | Phase 172 | Pending |
| GR-013B | Phase 172 | Pending |
| GR-014B | Phase 172 | Pending |
| GR-015 | Phase 172 | Pending |
| GR-016B | Phase 172 | Pending |
| GR-020B | Phase 172 | Pending |
| GR-021 | Phase 172 | Pending |
| GR-022 | Phase 172 | Pending |
| GR-023 | Phase 172 | Pending |
| GR-024B | Phase 172 | Pending |

**Coverage:**
- v4.3 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-06-23*
*Last updated: 2026-06-23 after v4.3 milestone definition*
