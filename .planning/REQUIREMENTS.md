# v2.8 — Requirements: Plugin Callback Overhaul

**Milestone Status:** Active
**Goal:** Replace FlashQuery's push-based plugin callback system with a reconcile-on-read pattern — giving plugins reliable, policy-driven document state tracking without fragile async notifications.
**Phase range:** Phases 84–89
**Defined:** 2026-04-20
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.

**Authoritative source documents** (resolve ambiguity by reading these directly):
- Development Plan: `../flashquery-product/Product/Definition/Plugin Callback Overhaul/Callback Overhaul Development Plan.md`
- Full Requirements: `../flashquery-product/Product/Definition/Plugin Callback Overhaul/Callback Overhaul Full Requirements.md`

These documents contain line-level implementation guidance, resolved open questions (OQ-1 through OQ-7), and detailed test case tables. The requirements below are derived from them; the source documents are authoritative where any conflict arises.

---

## v2.8 Requirements

### SCHEMA — Schema Parsing & Policy Infrastructure

- [ ] **SCHEMA-01:** Plugin schema YAML supports `access`, `on_added`, `on_moved`, `on_modified`, `track_as`, `template`, and `field_map` policy fields on document type entries; `ParsedPluginSchema` interface updated to `DocumentTypePolicy` with all fields
- [ ] **SCHEMA-02:** `parsePluginSchema()` extracts all policy fields with conservative defaults when absent: `access: 'read-write'`, `on_added: 'ignore'`, `on_moved: 'keep-tracking'`, `on_modified: 'ignore'`
- [ ] **SCHEMA-03:** Schema validation at parse time rejects `on_added: auto-track` without a valid `track_as` referencing a real table in the schema (throws with actionable error message)
- [ ] **SCHEMA-04:** `field_map` column targets that don't exist in the target table log a warning but do not reject the schema (deferred to runtime with graceful skip)
- [ ] **SCHEMA-05:** Global type registry built from all loaded plugins, keyed by document type ID, refreshed automatically on `register_plugin` and `unregister_plugin`; collision detection logs warning and first-registration wins
- [ ] **SCHEMA-06:** Every new plugin table automatically includes `last_seen_updated_at TIMESTAMPTZ` as an implicit column alongside the existing implicit columns

### RECON — Reconciliation Engine

- [ ] **RECON-01:** `reconcilePluginDocuments(pluginId, instanceId)` classifies every document into exactly one of six mutually exclusive states: `added`, `resurrected`, `deleted`, `disassociated`, `moved`, `modified` (or `unchanged`)
- [ ] **RECON-02:** Document discovery uses both folder-based (Path 1: `fqc_documents.path` under watched folders) and frontmatter-type-based (Path 2: `fqc_documents.ownership_type` matching plugin type IDs) methods
- [ ] **RECON-03:** Step 4 plugin table query fetches ALL rows (active AND archived) so resurrected documents are never misclassified as `added`
- [ ] **RECON-04:** Mechanical policy executor `executeReconciliationActions()` applies all configured policies without skill involvement: auto-tracks, archives, resurrects, updates paths, syncs fields
- [ ] **RECON-05:** Auto-track writes `fqc_owner` and `fqc_type` to document frontmatter atomically, updates `fqc_documents.content_hash`, and sets `last_seen_updated_at` to the post-write `updated_at` to prevent false `modified` classification on next pass
- [ ] **RECON-06:** `field_map` application sets target columns to NULL when the mapped frontmatter field is absent (never omits the column)
- [ ] **RECON-07:** Staleness cache skips reconciliation when called within 30 seconds of last run for the same plugin/instance; `force_file_scan` invalidates the cache
- [ ] **RECON-08:** Self-healing ALTER TABLE adds `last_seen_updated_at` to pre-existing plugin tables on first reconciliation pass; result cached per table name for process lifetime

### RECTOOLS — Record Tool Integration & Pending Review

- [x] **RECTOOLS-01
:** All five record tools (`create_record`, `get_record`, `update_record`, `archive_record`, `search_records`) call `reconcilePluginDocuments()` + `executeReconciliationActions()` before executing their operation (with staleness check)
- [ ] **RECTOOLS-02:** `fqc_pending_plugin_review` table created in schema: `id`, `fqc_id` (FK → fqc_documents ON DELETE CASCADE), `plugin_id`, `instance_id`, `table_name`, `review_type`, `context JSONB`, `created_at`; with indexes on `(plugin_id, instance_id)` and `fqc_id`
- [ ] **RECTOOLS-03:** `clear_pending_reviews` MCP tool supports query mode (`fqc_ids: []` → return all pending) and clear mode (`fqc_ids: [...]` → delete specified + return remaining); idempotent for non-existent IDs
- [x] **RECTOOLS-04
:** Record tool responses include count-based reconciliation summary (e.g., "Auto-tracked 2 new document(s)") and pending review note when items exist; no item-name enumeration in summary
- [x] **RECTOOLS-05
:** Auto-track with `template` declared creates a `fqc_pending_plugin_review` row with `review_type: 'template_available'`; auto-track without template creates no pending review row
- [x] **RECTOOLS-06
:** Resurrected documents create a `fqc_pending_plugin_review` row with `review_type: 'resurrected'`; no template pending review on resurrection
- [ ] **RECTOOLS-07:** `deleted` and `disassociated` documents cause the plugin table row to be archived AND any existing `fqc_pending_plugin_review` rows for that `fqc_id`/plugin to be explicitly deleted
- [ ] **RECTOOLS-08:** `unregister_plugin` deletes all `fqc_pending_plugin_review` rows for the plugin before removing the registry entry; calls `buildGlobalTypeRegistry()` after removal
- [ ] **RECTOOLS-09:** `access: read-only` plugin folder declaration causes document-writing MCP tools (`create_document`, `update_document`) to emit a warning in the response when the target file is in that folder; write still proceeds (guardrail, not hard block); FQC's own mechanical frontmatter writes bypass this guardrail entirely

### SCANNER — Scanner Modifications & Frontmatter Sync

- [ ] **SCANNER-01:** Scanner syncs `fqc_owner` frontmatter field to `fqc_documents.ownership_plugin_id` on every document INSERT and content-change UPDATE
- [ ] **SCANNER-02:** Scanner syncs `fqc_type` frontmatter field to `fqc_documents.ownership_type` on every document INSERT and content-change UPDATE; NULL when field absent
- [ ] **SCANNER-03:** Scanner no longer writes to `fqc_change_queue`, no longer calls `invokeChangeNotifications()` or `getWatcherMap()`; all 10 notification-related code blocks removed
- [ ] **SCANNER-04:** `propagateFqcIdChange()` sets `last_seen_updated_at = NOW()` in the same UPDATE that reassigns `fqc_id` in plugin tables; skips gracefully if column doesn't yet exist on the target table

### LEGACY — Legacy Infrastructure Removal

- [ ] **LEGACY-01:** `src/services/discovery-orchestrator.ts` deleted; all imports removed from other files; `atomicWriteFrontmatter()` extracted to `src/utils/frontmatter.ts` before deletion
- [ ] **LEGACY-02:** `src/services/plugin-skill-invoker.ts` deleted; all imports removed
- [ ] **LEGACY-03:** `src/services/discovery-coordinator.ts` deleted; `src/index.ts` import (line 42) and fire-and-forget call (lines 91–95) removed
- [ ] **LEGACY-04:** `src/services/document-ownership.ts` deleted; all imports removed
- [ ] **LEGACY-05:** `src/mcp/tools/discovery.ts` deleted; removed from MCP server tool registration
- [ ] **LEGACY-06:** `src/cli/commands/discover.ts` deleted; removed from CLI command registry
- [ ] **LEGACY-07:** `fqc_change_queue` table dropped; `watcher_claims`, `needs_discovery`, `discovery_status` columns dropped from `fqc_documents` via `ALTER TABLE IF EXISTS` migration; column definitions removed from DDL

### TEST — Test Coverage

- [ ] **TEST-01:** `tests/unit/declarative-policies.test.ts` — 6 tests covering policy field parsing, conservative defaults, auto-track validation (throws), and field_map warning behavior
- [ ] **TEST-02:** `tests/unit/global-type-registry.test.ts` — 4 tests covering registry build from multiple plugins, collision detection, refresh on register/unregister, empty registry
- [ ] **TEST-03:** `tests/unit/plugin-reconciliation.test.ts` — 20+ tests covering all six classification states, mutual exclusivity, idempotency, cross-table added check, Path 2 discovery, OQ-7 resurrection guard
- [ ] **TEST-04:** `tests/unit/reconciliation-staleness.test.ts` + `staleness-invalidation.test.ts` — staleness skip, expiry after threshold, cache invalidation by force_file_scan
- [ ] **TEST-05:** `tests/unit/field-map-null.test.ts` — NULL on auto-track, sync-fields, and resurrection for missing frontmatter fields
- [ ] **TEST-06:** `tests/unit/pending-plugin-review.test.ts` — pending review insert, query mode, clear mode, idempotency, CASCADE delete, unregister cleanup
- [x] **TEST-07
:** `tests/integration/plugin-reconciliation.integration.test.ts` — record tool triggers reconciliation, auto-track creates row + frontmatter, archival/disassociation behavior, pending review lifecycle
- [ ] **TEST-08:** `tests/integration/frontmatter-sync.integration.test.ts` — fqc_owner/fqc_type synced to columns, NULL on removal, no change_queue writes after scan
- [ ] **TEST-09:** `tests/integration/bulk-reconciliation.integration.test.ts` — 50-doc auto-track, count-based response format, no spurious modified after auto-track, incremental pending review processing
- [ ] **TEST-10:** Existing `tests/integration/scan-command.integration.test.ts` updated — remove change_queue/notification assertions, add frontmatter-sync assertions
- [ ] **TEST-11:** `tests/helpers/mock-plugins.ts` updated — remove `PluginClaim` import (from deleted `plugin-skill-invoker.ts`), remove `onDiscovered()`/`onChanged()`/`discoveryInvocations`/`changeInvocations` from `MockPluginBuilder`; add `withAutoTrack()`, `withOnMoved()`, `withOnModified()` builder methods
- [ ] **TEST-12:** `tests/helpers/discovery-fixtures.ts` updated — replace `fqc_change_queue` with `fqc_pending_plugin_review` in FK cleanup order
- [ ] **TEST-13:** 4 obsolete test files deleted: `tests/unit/change-notifications.test.ts`, `tests/integration/change-notifications.test.ts`, `tests/unit/plugin-skill-invoker.test.ts`, `tests/integration/scanner-change-notifications.test.ts`
- [ ] **TEST-14:** Discovery-related test files reviewed and updated: `discovery-orchestrator.integration.test.ts` deleted; `discovery-scenarios.test.ts`, `discovery-errors.test.ts`, `discovery-multi-plugin.test.ts` reviewed for notification/watcher_claims dependencies and updated or deleted; `plugin-records.integration.test.ts` updated to handle reconciliation running internally (mock or fixture isolation); `plugin-registration.integration.test.ts` updated to cover policy validation (SCHEMA-03)
- [x] **TEST-15
:** New `tests/integration/pending-plugin-review.integration.test.ts` — full pending review lifecycle with real Supabase: register plugin, create doc, scan, call record tool, verify auto-track + pending review in response, call clear_pending_reviews in query mode, process doc, call clear in clear mode, verify empty
- [x] **TEST-16
:** New integration tests for resurrection lifecycle: full resurrection with FK preservation, move-out untrack + move-back = resurrection, resurrection into another plugin's folder
- [ ] **TEST-17:** Scenario tests reviewed: `test_discover_document.py` and `test_file_scan_lifecycle.py` updated to remove assertions about `fqc_change_queue`, `needs_discovery`, `discovery_status`, `watcher_claims`; `tests/benchmark/discovery-performance.bench.ts` rewritten to benchmark reconciliation query cost

---

## Future Requirements (deferred)

### Future: Pending Review Extensions

- `review_on: new_document` schema field — create pending review for newly tracked docs even without a template (post-v2.8 per Req Doc §4.5.5)
- Bulk `clear_pending_reviews` with pagination — for plugins with very large pending queues
- Skill-callable pending review filtering by `review_type`

### Future: Reconciliation Enhancements

- Configurable staleness threshold (currently hardcoded 30s)
- Per-plugin reconciliation opt-out flag in schema
- Reconciliation history/audit log

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hard `access: read-only` enforcement (reject writes) | v2.8 implements warning-only guardrail; hard enforcement requires broader auth design |
| Automatic file relocation for Path 2 (out-of-folder) documents | Relocation is a skill-level decision; reconciler surfaces context but never moves files |
| Incremental/streaming reconciliation | All docs processed in one pass per call; streaming deferred to post-v2.8 |
| `flashquery discover` CLI command replacement | Command is removed without replacement; manual reconciliation is via record tool calls |
| Web UI for pending reviews | Post-MVP; v2.8 is CLI + MCP only |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHEMA-01 | Phase 84 | Pending |
| SCHEMA-02 | Phase 84 | Pending |
| SCHEMA-03 | Phase 84 | Pending |
| SCHEMA-04 | Phase 84 | Pending |
| SCHEMA-05 | Phase 84 | Pending |
| SCHEMA-06 | Phase 84 | Pending |
| RECON-01 | Phase 85 | Pending |
| RECON-02 | Phase 85 | Pending |
| RECON-03 | Phase 85 | Pending |
| RECON-04 | Phase 85 | Pending |
| RECON-05 | Phase 85 | Pending |
| RECON-06 | Phase 85 | Pending |
| RECON-07 | Phase 85 | Pending |
| RECON-08 | Phase 85 | Pending |
| RECTOOLS-01 | Phase 86 | Pending |
| RECTOOLS-02 | Phase 86 | Pending |
| RECTOOLS-03 | Phase 86 | Pending |
| RECTOOLS-04 | Phase 86 | Pending |
| RECTOOLS-05 | Phase 86 | Pending |
| RECTOOLS-06 | Phase 86 | Pending |
| RECTOOLS-07 | Phase 86 | Pending |
| RECTOOLS-08 | Phase 86 | Pending |
| RECTOOLS-09 | Phase 86 | Pending |
| SCANNER-01 | Phase 87 | Pending |
| SCANNER-02 | Phase 87 | Pending |
| SCANNER-03 | Phase 87 | Pending |
| SCANNER-04 | Phase 87 | Pending |
| LEGACY-01 | Phase 88 | Pending |
| LEGACY-02 | Phase 88 | Pending |
| LEGACY-03 | Phase 88 | Pending |
| LEGACY-04 | Phase 88 | Pending |
| LEGACY-05 | Phase 88 | Pending |
| LEGACY-06 | Phase 88 | Pending |
| LEGACY-07 | Phase 88 | Pending |
| TEST-01 | Phase 84 | Pending |
| TEST-02 | Phase 84 | Pending |
| TEST-03 | Phase 85 | Pending |
| TEST-04 | Phase 85 | Pending |
| TEST-05 | Phase 85 | Pending |
| TEST-06 | Phase 86 | Pending |
| TEST-07 | Phase 86 | Pending |
| TEST-09 | Phase 86 | Pending |
| TEST-15 | Phase 86 | Pending |
| TEST-16 | Phase 86 | Pending |
| TEST-08 | Phase 87 | Pending |
| TEST-10 | Phase 87 | Pending |
| TEST-13 | Phase 88 | Pending |
| TEST-14 | Phase 88 | Pending |
| TEST-17 | Phase 88 | Pending |
| TEST-11 | Phase 89 | Pending |
| TEST-12 | Phase 89 | Pending |

**Coverage:**
- v2.8 requirements: 47 total
- Mapped to phases: 47
- Unmapped: 0 ✓

---

*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 after milestone v2.8 initialization*
