# Phase 125: Unified Search + Memory Consolidation - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Source:** User-provided MCP Tool Consolidation requirements and test plan

<domain>
## Phase Boundary

Phase 125 consolidates document/memory search and memory lifecycle tools into the final MCP surface defined by the MCP Tool Consolidation product docs.

In scope:
- `search` replaces `search_all`, `search_documents`, `search_memory`, and `list_memories` for the Phase 125 search surface.
- `search` supports `mode: "filesystem" | "semantic" | "mixed"`, list-mode for documents/memories, default mixed search, `entity_types`, `include_archived`, global limits, deterministic tie-breaking, disabled-domain degradation, and embedding fallback semantics.
- `write_memory(mode: "create")` replaces `save_memory`.
- `write_memory(mode: "update")` replaces `update_memory` and creates a new latest memory version rather than mutating the previous version in place.
- `get_memory` and `archive_memory` use `memory_ids`, ordered batch semantics, include vocabulary, structured memory identification blocks, idempotent archival, and version-chain archive behavior.
- Legacy memory/search coverage is ported to final tool tests before legacy removals happen in Phase 128.
- Unit, integration, E2E, directed scenario, and integration scenario coverage ships with this phase.

Out of scope:
- Final host/delegated surface removal audit for all legacy names; that is Phase 128.
- Document write primitives already covered by Phase 124 except where search integration tests need `write_document`.
- Record consolidation, directory management, vault maintenance, and document removal phases.
- Literal body grep, regex, line-range, or arbitrary string search; those remain macro/string-operation territory.
- Any web UI.
</domain>

<decisions>
## Implementation Decisions

### Canonical Source Documents
- Downstream planning, implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- If roadmap details and product docs appear to conflict, treat `.planning/ROADMAP.md` as the phase boundary and the two product docs above as the detailed contract inside that boundary.
- Implementation agents should answer their own scope questions from those docs first, then from phase artifacts, before asking the user.

### Tool-Specific Locked Scope
- `search` must be the unified document/memory search tool and must not steer callers to legacy domain-specific search tools.
- `search.mode` accepts only `"filesystem"`, `"semantic"`, and `"mixed"`; omitted mode defaults to `"mixed"` except list-mode responses report `"list"`.
- `mode: "semantic"` requires non-empty `query`.
- Empty `query` with no filters requires `list_all: true`; otherwise return canonical `invalid_input`.
- Empty `query` with `tags` or `path_filter` is list-mode and requires explicit `entity_types`.
- Omitted `entity_types` defaults to enabled searchable host domains for non-empty semantic/mixed queries.
- Disabled categories narrow available domains silently when not explicitly requested, warn when a requested multi-domain call is degraded, and return `unsupported` when the caller explicitly requests only an unavailable domain.
- Mixed mode dedupes by `fq_id` for documents and `memory_id` for memories, keeps the highest score, aggregates `match_source`, and applies one global `limit` after merge/dedupe/sort.
- Default archived filtering excludes archived documents and memories unless `include_archived: true`.
- Memory search/list behavior returns latest memory versions by default; previous versions remain directly retrievable by `get_memory`.
- `write_memory` requires explicit `mode: "create" | "update"` and must not infer mode from parameter presence.
- `write_memory(mode: "create")` requires `content`, defaults `plugin_scope`, rejects caller-supplied generated fields, and returns the memory identification block.
- `write_memory(mode: "update")` requires `memory_id` and at least one mutable field, rejects non-latest updates with `conflict`, inserts a new version row, marks the previous row `is_latest: false`, and marks the new row `is_latest: true` transactionally.
- `write_memory(mode: "update", tags)` replaces the tag list. Additive/removal tag edits remain in `apply_tags`.
- `get_memory` uses `memory_ids` (`string | string[]`), supports `include: ["content", "tags_full"]`, returns ordered per-element results, and can retrieve previous versions directly.
- `archive_memory` uses `memory_ids` (`string | string[]`), archives the full version chain, sets/preserves shared `archived_at`, is idempotent on re-archive, and hides archived memories from default `search`.

### Testing And Traceability
- The first implementation task must instantiate a phase-local traceability table mapping SRCH-01 through SRCH-06 and MEM-01 through MEM-04 to unit, integration, E2E, directed scenario, and integration scenario evidence.
- Tests must be bundled with implementation and must not be deferred to Phase 128.
- Directed and integration scenario coverage ledgers must be updated before scenario files are changed, following the MCP Tool Consolidation Test Plan ordering rules.
- Legacy behaviors must be ported into final-tool tests before old test files are deleted or renamed.
- The implementation must include coverage for `search` high-risk tests, `write_memory` high-risk tests, and standard `get_memory` / `archive_memory` contracts from the test plan.

### the agent's Discretion
- Exact helper/module boundaries may follow existing repo patterns, but shared helpers in `src/mcp/utils/response-formats.ts` and existing Phase 121-124 output helpers should be preferred over per-tool JSON construction.
- Search implementation may be split into domain-specific adapters internally if the public MCP tool remains unified and preserves the specified result envelope.
- Existing tests may be expanded, renamed, or split where that reduces fixture complexity, provided legacy behavior coverage remains traceable.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Contract
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md` — cross-cutting decisions plus §4.12 `search`, §4.18 `write_memory`, standard `get_memory` / `archive_memory` entries, and legacy search/memory migration notes.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md` — five-layer test obligations, high-risk `search` and `write_memory` contracts, standard `get_memory` / `archive_memory` contracts, and scenario migration rules.

### Project Planning
- `.planning/ROADMAP.md` — Phase 125 boundary, dependency on Phase 124, and success criteria.
- `.planning/REQUIREMENTS.md` — SRCH-01 through SRCH-06 and MEM-01 through MEM-04 mapping and per-phase verification contract.

### Prior Foundation
- `.planning/phases/121-foundation-metadata-response-helpers-test-harness/121-01-SUMMARY.md` — shared JSON response helpers and traceability scaffolding.
- `.planning/phases/122-host-tool-exposure-config/122-01-SUMMARY.md` through `122-04-SUMMARY.md` — host exposure and tool metadata work that Phase 125 must not regress.
- `.planning/phases/123-document-read-standard-output-migration/123-CONTEXT.md` and `123-*-SUMMARY.md` — document output helper patterns and document identification contracts used by `search` document results.
- `.planning/phases/124-document-write-primitives/124-CONTEXT.md`, `124-PATTERNS.md`, and `124-*-SUMMARY.md` — final document write tools and Phase 125 dependency context.
</canonical_refs>

<specifics>
## Specific Ideas

- Update `src/mcp/tool-metadata.ts` descriptions for `search`, `write_memory`, `get_memory`, and `archive_memory` because metadata overrides registration descriptions.
- Prefer final public tool names in all new tests and scenario ledgers: `search`, `write_memory`, `get_memory`, and `archive_memory`.
- Port existing `search_all`, `search_documents`, `search_memory`, `list_memories`, `save_memory`, and `update_memory` tests into final-tool coverage rather than only adding greenfield tests.
- Include focused verification commands for unit, integration, E2E, directed scenario, integration scenario, and `npm run build`.
</specifics>

<deferred>
## Deferred Ideas

- Final host/delegated surface removal and absence audit for legacy search/memory names is Phase 128.
- Literal body grep/regex/line-range search is deferred to macro/string-operation work.
- Record consolidation, directory management, vault maintenance, and document removal are separate roadmap phases.
</deferred>

---

*Phase: 125-unified-search-memory-consolidation*
*Context gathered: 2026-05-12 from supplied product docs*
