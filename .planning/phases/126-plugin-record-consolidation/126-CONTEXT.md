# Phase 126: Plugin + Record Consolidation - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Source:** User-provided MCP Tool Consolidation requirements and test plan

<domain>
## Phase Boundary

Phase 126 consolidates plugin and record MCP tools into the final structured output and explicit-action contracts defined by the MCP Tool Consolidation product docs.

In scope:
- `register_plugin` keeps explicit upsert semantics and returns a plugin identification block with `was_new`.
- `unregister_plugin` returns a plugin identification block with unregister metadata, preserves live-record conflict handling, and supports `force: true` orphan warnings.
- `get_plugin_info` returns a plugin envelope with `include: ["schema", "tables", "status_detail"]` payload control and default table-name payload.
- `write_record(mode: "create")` replaces `create_record`, validates plugin/table schema, rejects caller-supplied generated or unknown fields, and returns a record identification block.
- `write_record(mode: "update")` replaces `update_record`, validates partial record data against plugin schema, rejects generated or unknown fields, and returns a record identification block.
- `get_record`, `archive_record`, and `search_records` preserve current plugin-record behavior while returning structured JSON envelopes, include-controlled data, ordered batch results, archived-record handling, and taggable-record search support.
- `clear_pending_reviews` uses explicit `action: "list" | "clear"` and structured pending/cleared item envelopes keyed by pending-review row IDs.
- Unit, integration, E2E, directed scenario, and integration scenario coverage ships with this phase.

Out of scope:
- Final host/delegated surface removal audit for all legacy tool names; that is Phase 128 unless a local plan covers a narrow absence assertion after coverage is ported.
- Document, memory, search, directory, vault-maintenance, and document-removal consolidation except where plugin/record workflows must call already-final tools from prior phases.
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
- `register_plugin` output must be `{ plugin_id, name, status, table_count, registered_at, was_new }`; registration remains an upsert keyed by `plugin_id` and must not add a `mode` discriminator.
- `unregister_plugin` output must be a plugin identification block with `status: "unregistered"` and `unregistered_at`; live records return canonical `conflict` unless `force: true`, and forced unregister returns `warnings: ["orphaned_records: N"]`.
- `get_plugin_info` must support include values `schema`, `tables`, and `status_detail`; default output includes identification plus table names only.
- `write_record` requires explicit `mode: "create" | "update"` with no default. `plugin_id` and `table` are always required.
- `write_record(mode: "create")` requires `data` with all schema-required fields, permits omitted optional fields, rejects `id`, and rejects generated or unknown fields.
- `write_record(mode: "update")` requires compound `(plugin_id, table, id)` and partial `data`; required-on-create fields are not required on update, but generated and unknown fields remain rejected.
- `write_record` is single-target only. Full `data` is gated by `include: ["data"]`; schema metadata is gated by `include: ["schema_metadata"]`; default include is identification-only.
- Plugin-record reconciliation and pending-review side effects must be returned structurally as `reconciliation` and `pending_review` only when non-empty. These are plugin workflow outputs, not scanner/index sync internals.
- `get_record` default include is `["data"]`; callers may pass `include: []` for identification-only output and `include: ["schema_metadata"]` for schema metadata.
- `archive_record` accepts `targets: [{ plugin_id, table, id }]`, preserves input order, returns per-element expected errors, sets `archived_at` when available, and returns `warnings: ["archived_at_unavailable"]` when a plugin table lacks the column.
- `search_records` returns `{ plugin_id?, table?, query, tag?, total, results }`, uses `include: ["data"]` for payloads, includes `score` only in semantic mode, excludes archived records by default, and supports `tag` plus `taggable_tables_only` for transitional briefing parity.
- `clear_pending_reviews` requires `action`; `action: "list"` returns `{ pending, items }`; `action: "clear"` accepts optional `plugin_id` and/or pending-review row `ids` filters and returns `{ cleared, items }`; nonexistent ids return `warnings: ["no_matching_items"]`.

### Testing And Traceability
- The first implementation task must instantiate a phase-local traceability table mapping `REC-01` through `REC-07` to unit, integration, E2E, directed scenario, and integration scenario evidence.
- Tests must be bundled with implementation and must not be deferred to Phase 128.
- `write_record` is high-risk and must satisfy its full Test Plan §4.4 contract in this phase.
- Standard plugin and record tools must satisfy the Test Plan §5.3 rows and the detailed checklist rows for `register_plugin`, `unregister_plugin`, `get_plugin_info`, `get_record`, `archive_record`, `search_records`, and `clear_pending_reviews`.
- Existing `create_record` / `update_record` assertions and integration workflows must be ported to `write_record(mode: "create" | "update")` before old coverage is removed.
- Directed and integration scenario coverage ledgers must be updated before scenario files are changed, following the MCP Tool Consolidation Test Plan ordering rules.

### the agent's Discretion
- Exact helper/module boundaries may follow existing repo patterns, but shared helpers in `src/mcp/utils/response-formats.ts` and existing Phase 121-125 output helpers should be preferred over per-tool JSON construction.
- Plugin/record validation helpers may live beside the existing record tools or in a new utility module if that keeps handler code concise and unit-testable.
- Existing tests may be expanded, renamed, or split where that reduces fixture complexity, provided legacy behavior coverage remains traceable.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Contract
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md` — cross-cutting decisions plus §4.24 `register_plugin`, §4.25 `unregister_plugin`, §4.26 `get_plugin_info`, §4.27 `write_record`, §4.28 `get_record`, §4.30 `archive_record`, §4.31 `search_records`, and §4.32 `clear_pending_reviews`.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md` — five-layer test obligations, high-risk `write_record` contract, standard plugin/record tool contracts, scenario migration rules, and plugin reconciliation workflow updates.

### Project Planning
- `.planning/ROADMAP.md` — Phase 126 boundary, dependency on Phase 125, and success criteria.
- `.planning/REQUIREMENTS.md` — `REC-01` through `REC-07` mapping and per-phase verification contract.

### Prior Foundation
- `.planning/phases/121-foundation-metadata-response-helpers-test-harness/121-01-SUMMARY.md` — shared JSON response helpers and traceability scaffolding.
- `.planning/phases/122-host-tool-exposure-config/122-01-SUMMARY.md` through `122-04-SUMMARY.md` — host exposure and tool metadata work that Phase 126 must not regress.
- `.planning/phases/123-document-read-standard-output-migration/123-CONTEXT.md` and `123-*-SUMMARY.md` — structured document output helper and expected-error patterns.
- `.planning/phases/124-document-write-primitives/124-CONTEXT.md`, `124-PATTERNS.md`, and `124-*-SUMMARY.md` — final document write tools used by plugin reconciliation workflows.
- `.planning/phases/125-unified-search-memory-consolidation/125-CONTEXT.md`, `125-RESEARCH.md`, `125-PATTERNS.md`, and `125-*-SUMMARY.md` — final search/memory patterns, JSON response helper usage, and latest consolidation baseline.
</canonical_refs>

<specifics>
## Specific Ideas

- Update `src/mcp/tool-metadata.ts` descriptions for plugin and record tools where metadata controls exposed descriptions.
- Prefer final public tool names in all new tests and scenario ledgers: `register_plugin`, `unregister_plugin`, `get_plugin_info`, `write_record`, `get_record`, `archive_record`, `search_records`, and `clear_pending_reviews`.
- Port existing `create_record` and `update_record` unit/integration assertions into `write_record` coverage instead of only adding greenfield tests.
- Update plugin reconciliation tests to use `write_document`, `write_record`, and `clear_pending_reviews(action: "list" | "clear")` with pending-review row IDs.
- Include focused verification commands for unit, integration, E2E, directed scenario, integration scenario, and `npm run build`.
</specifics>

<deferred>
## Deferred Ideas

- Final host/delegated surface removal and absence audit for legacy record names is Phase 128 unless this phase includes a narrow, coverage-backed assertion.
- Macro-dependent legacy composition removals remain outside this phase.
- Directory, vault-maintenance, remove-document, and final cleanup phases remain separate roadmap phases.
</deferred>

---

*Phase: 126-plugin-record-consolidation*
*Context gathered: 2026-05-12 from supplied product docs*
