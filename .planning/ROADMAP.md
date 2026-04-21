# Roadmap: FlashQuery Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-03-25)
- ✅ **v1.5 Full MVP** — Phases 10-16 (shipped 2026-03-27)
- ✅ **v1.6 Prep for Open Source** — Phases 17-21 (shipped 2026-03-30)
- ✅ **v1.7 Issues Resolution & Pre-Release Hardening** — Phases 22-25 (shipped 2026-03-31)
- ✅ **v1.8 Bug Fixes: Plugin Scope & Token Security** — Phases 28-29 (shipped 2026-04-01)
- ✅ **v1.9 MCP Tool Overhaul** — Phases 30-33 (shipped 2026-04-06)
- ✅ **v2.0 Doc Sync Overhaul** — Phases 36-40 (shipped 2026-04-07)
- ✅ **v2.1 Test Suite Recovery** — Phases 41-44 (shipped 2026-04-07)
- ✅ **v2.2 Status Model Refactor & Infrastructure Hardening** — Phases 45-48 (shipped 2026-04-08)
- ✅ **v2.3 HTTP Authentication & Interoperability** — Phases 49-52 (shipped 2026-04-09)
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54–60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
  - Phase 69: Critical Security & Database Fixes ✅
  - Phase 70: Design Gaps & Quality ✅
  - Phase 71: Test Suite Maintenance ✅
  - **Result:** All v2.5 gaps closed. 40/40 E2E tests passing. Production ready.

---

## Archived Milestone: v2.6 — Test Infrastructure & Quality

**Status:** Complete — shipped 2026-04-15
**Goal:** All unit, integration, and E2E test suites run without broken skips and pass — or failures are explicitly identified as FQC bugs tracked for a future milestone.

Phases 72–80 complete. Phases 81–82 deferred to v2.7.

---

## Archived Milestone: v2.7 — Name Change & Pre-Launch Preparation

**Status:** Complete — shipped 2026-04-16
**Goal:** Prepare for public launch with targeted cosmetic rename (product name only, no code changes) and resolve administrative/deferred items.

- [x] **Phase 83: FQC Name Change Implementation** — "FlashQuery Core" → "FlashQuery" across ~48 files, ~268 replacements (completed 2026-04-16)
- [ ] **Phase 81: Verify 999.x Phases** — (deferred, administrative)
- [ ] **Phase 82: Tech Debt Cleanup** — (deferred, administrative)

---

## Active Milestone: v2.8 — Plugin Callback Overhaul

**Status:** Planning — requirements defined, roadmap created, not yet executing
**Goal:** Replace FlashQuery's push-based plugin callback system with a reconcile-on-read pattern — giving plugins reliable, policy-driven document state tracking without fragile async notifications.

### Phases

- [x] **Phase 84: Schema Parsing & Policy Infrastructure** — Parse and validate all 7 policy fields on document type entries; build global type registry; add `last_seen_updated_at` to plugin table DDL (completed 2026-04-20)
- [x] **Phase 85: Reconciliation Engine** — Six-state document classification engine with mechanical policy executor, staleness cache, and self-healing ALTER TABLE (completed 2026-04-20)
- [x] **Phase 86: Record Tool Integration & Pending Review** — Wire reconciliation into all 5 record tools; create `fqc_pending_plugin_review` table and `clear_pending_reviews` MCP tool (completed 2026-04-21)
- [x] **Phase 87: Scanner Modifications & Frontmatter Sync** — Sync `fqc_owner`/`fqc_type` frontmatter fields to DB columns; remove all notification code paths from scanner (completed 2026-04-21)
- [x] **Phase 88: Legacy Infrastructure Removal** — Delete 5 source files, remove `flashquery discover` CLI command, drop `fqc_change_queue` table and obsolete columns (completed 2026-04-21)
- [ ] **Phase 89: Test Helper Cleanup & Final Integration** — MockPluginBuilder updated, discovery-fixtures updated, full suite passes end-to-end

### Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 84. Schema Parsing & Policy Infrastructure | 3/3 | Complete    | 2026-04-20 |
| 85. Reconciliation Engine | 5/5 | Complete    | 2026-04-20 |
| 86. Record Tool Integration & Pending Review | 5/5 | Complete    | 2026-04-21 |
| 87. Scanner Modifications & Frontmatter Sync | 3/3 | Complete    | 2026-04-21 |
| 88. Legacy Infrastructure Removal | 6/6 | Complete    | 2026-04-21 |
| 89. Test Helper & Existing Test Updates | 0/4 | Not started | — |

---

## Phase Details

### Phase 84: Schema Parsing & Policy Infrastructure
**Goal**: Plugin schema YAML supports all 7 policy fields on document type entries with parse-time validation and conservative defaults; a global type registry is built from all loaded plugins; unit tests gate this foundation before Phase 85 builds on it
**Depends on**: Nothing (foundation for all v2.8 work)
**Requirements**: SCHEMA-01, SCHEMA-02, SCHEMA-03, SCHEMA-04, SCHEMA-05, SCHEMA-06, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. A plugin schema YAML with all 7 policy fields (`access`, `on_added`, `on_moved`, `on_modified`, `track_as`, `template`, `field_map`) parses without error and produces a `DocumentTypePolicy` with correct values for each field
  2. A schema with `on_added: auto-track` and no valid `track_as` reference throws at parse time with a clear, actionable error message naming the missing reference
  3. A schema with `field_map` column targets that don't exist in the target table loads successfully and logs a warning — no parse error, no rejection
  4. `buildGlobalTypeRegistry()` after registering 2 plugins returns a map containing all document type IDs from both plugins; registering a third plugin with a colliding type ID logs a warning and the first registration wins
  5. A newly registered plugin table DDL includes a `last_seen_updated_at TIMESTAMPTZ` column alongside the existing implicit columns
  6. `tests/unit/declarative-policies.test.ts` and `tests/unit/global-type-registry.test.ts` exist and pass with 0 failures (TEST-01, TEST-02)
**Plans**: 3 plans
Plans:
- [x] 84-01-PLAN.md — Extend manager.ts: DocumentTypePolicy/TypeRegistryEntry interfaces, parser policy fields, DDL column, globalTypeRegistry singleton
- [x] 84-02-PLAN.md — Wire buildGlobalTypeRegistry() into plugins.ts call sites; update plugin-manager.test.ts implicit columns assertion
- [x] 84-03-PLAN.md — Create declarative-policies.test.ts (6 tests) and global-type-registry.test.ts (4 tests)
**UI hint**: no

### Phase 85: Reconciliation Engine
**Goal**: `reconcilePluginDocuments()` classifies every document into exactly one of seven states, applies configured policies mechanically, and skips re-work within the 30-second staleness window; unit tests gate this engine before Phase 86 wires it into record tools
**Depends on**: Phase 84
**Requirements**: RECON-01, RECON-02, RECON-03, RECON-04, RECON-05, RECON-06, RECON-07, RECON-08, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. `reconcilePluginDocuments()` called on a plugin with 1 new document in its watched folder returns `added: [1 item]`, all other arrays empty — the document is tracked in the plugin table and `fqc_owner`/`fqc_type` are written to its frontmatter atomically
  2. An archived plugin table row with an active `fqc_documents` row for the same `fqc_id` is classified as `resurrected`, not `added` — the archived row is un-archived rather than a new row created
  3. Running reconciliation twice with no changes between runs returns all `unchanged` on the second pass; `last_seen_updated_at` set after auto-track prevents false `modified` classification
  4. A document with `field_map` targets where a mapped frontmatter field is absent gets NULL written to that target column — the column is never omitted from the update
  5. Calling `reconcilePluginDocuments()` twice within 30 seconds (same plugin/instance, no `force_file_scan`) skips reconciliation on the second call; calling `invalidateReconciliationCache()` (as `force_file_scan` does) causes the next call to run in full
  6. First reconciliation pass on a pre-existing plugin table that lacks `last_seen_updated_at` issues `ALTER TABLE ADD COLUMN IF NOT EXISTS` and succeeds; subsequent calls use the cached result without re-checking
  7. `tests/unit/plugin-reconciliation.test.ts`, `tests/unit/reconciliation-staleness.test.ts`, and `tests/unit/field-map-null.test.ts` all pass with 0 failures (TEST-03, TEST-04, TEST-05)
**Plans**: 5 plans (3 original + 2 gap closure)
Plans:
- [x] 85-01-PLAN.md — Create src/services/plugin-reconciliation.ts with interfaces, staleness cache, self-healing ALTER TABLE, two-path discovery, and 7-branch classification engine (RECON-01, 02, 03, 07, 08)
- [x] 85-02-PLAN.md — Extend plugin-reconciliation.ts with executeReconciliationActions() all 7 branches (resurrected, added+auto-track, deleted, disassociated, moved, modified) plus applyFieldMap NULL-preserving helper; 42P01-guarded pending review ops (RECON-04, 05, 06)
- [x] 85-03-PLAN.md — Create plugin-reconciliation.test.ts (9+ classification tests incl. OQ-7), reconciliation-staleness.test.ts (3+ tests, fake timers), field-map-null.test.ts (4+ tests) (TEST-03, 04, 05)
- [x] 85-04-PLAN.md — GAP CLOSURE: Wire invalidateReconciliationCache() into force_file_scan (both branches); create staleness-invalidation.test.ts (3+ tests) (RECON-07, TEST-04)
- [x] 85-05-PLAN.md — GAP CLOSURE: Add 6 it() cases to plugin-reconciliation.test.ts reaching 20+ total (TEST-03)
**UI hint**: no

### Phase 86: Record Tool Integration & Pending Review
**Goal**: All five record tools call reconciliation before executing; `fqc_pending_plugin_review` table tracks documents requiring skill follow-up; `clear_pending_reviews` MCP tool supports query and clear modes; integration tests verify the full reconcile-on-read flow
**Depends on**: Phase 84, Phase 85
**Requirements**: RECTOOLS-01, RECTOOLS-02, RECTOOLS-03, RECTOOLS-04, RECTOOLS-05, RECTOOLS-06, RECTOOLS-07, RECTOOLS-08, RECTOOLS-09, TEST-06, TEST-07, TEST-09, TEST-15, TEST-16
**Success Criteria** (what must be TRUE):
  1. Calling `search_records` for a plugin with 1 new document in its watched folder returns a response containing a count-based reconciliation summary (e.g., "Auto-tracked 1 new document(s)") — reconciliation ran transparently before the search executed
  2. `clear_pending_reviews` called with `fqc_ids: []` returns all pending items without deleting any; called with a populated list deletes those rows and returns the remaining items; calling it with a non-existent ID does not error
  3. Auto-tracking a document type that declares a `template` field creates a `fqc_pending_plugin_review` row with `review_type: 'template_available'`; no template → no pending review row; resurrected doc → `review_type: 'resurrected'`
  4. Calling `unregister_plugin` deletes all `fqc_pending_plugin_review` rows for that plugin before removing the registry entry
  5. A document write tool targeting a folder declared `access: read-only` by a plugin includes a warning in the response — the write still proceeds
  6. `tests/unit/pending-plugin-review.test.ts` passes (TEST-06); `plugin-reconciliation.integration.test.ts` and `bulk-reconciliation.integration.test.ts` pass (TEST-07, TEST-09); full pending review lifecycle integration test passes with real Supabase (TEST-15); resurrection lifecycle tests pass (TEST-16)
**Plans**: 5 plans
Plans:
- [x] 86-01-PLAN.md — DDL + executeReconciliationActions signature update + pending-review.ts tool + server.ts wiring (Wave 1)
- [x] 86-02-PLAN.md — Unit tests for pending review (TEST-06) + discovery-fixtures FK order fix (Wave 1)
- [x] 86-03-PLAN.md — Reconciliation preamble in all 5 record tools + unregister cleanup + read-only guardrail (Wave 2)
- [x] 86-04-PLAN.md — Integration tests: plugin-reconciliation (TEST-07, TEST-16) + pending-plugin-review lifecycle (TEST-15) (Wave 3)
- [x] 86-05-PLAN.md — Integration tests: bulk-reconciliation (TEST-09) + multi-table-reconciliation (Wave 3)
**UI hint**: no

### Phase 87: Scanner Modifications & Frontmatter Sync
**Goal**: The scanner syncs `fqc_owner` and `fqc_type` frontmatter fields to `fqc_documents` DB columns on every relevant write, contains zero notification code paths, and integration tests confirm the sync behavior
**Depends on**: Phase 84, Phase 85
**Requirements**: SCANNER-01, SCANNER-02, SCANNER-03, SCANNER-04, TEST-08, TEST-10
**Success Criteria** (what must be TRUE):
  1. After scanning a document that has `fqc_owner: crm` in its frontmatter, `fqc_documents.ownership_plugin_id` equals `'crm'` in the database; a document with no `fqc_type` field has `ownership_type` = NULL
  2. Running `flashquery scan` produces zero writes to `fqc_change_queue` and zero calls to `invokeChangeNotifications()` — `grep -r "invokeChangeNotifications" src/` returns no matches in source (notification removal already done in Phase 88, but scanner code must not call it)
  3. `propagateFqcIdChange()` sets `last_seen_updated_at = NOW()` in the same UPDATE that reassigns `fqc_id`; skips gracefully if column doesn't yet exist on the target table
  4. `tests/integration/frontmatter-sync.integration.test.ts` passes: `fqc_owner`/`fqc_type` synced to columns, NULL on removal (TEST-08); `scan-command.integration.test.ts` updated assertions pass — no change_queue writes, frontmatter-sync assertions added (TEST-10)
**Plans**: 3 plans
Plans:
- [x] 87-01-PLAN.md — Remove notification code from scanner.ts; add ownership column sync to all INSERT/UPDATE paths (SCANNER-01, 02, 03)
- [x] 87-02-PLAN.md — Export ensureLastSeenColumn; refactor propagateFqcIdChange() to unified pg connection with last_seen_updated_at (SCANNER-04)
- [x] 87-03-PLAN.md — Create frontmatter-sync integration test (TEST-08); add ownership assertion to scan-command test (TEST-10)
**UI hint**: no

### Phase 88: Legacy Infrastructure Removal
**Goal**: All push-notification source files, the `flashquery discover` CLI command, and the `fqc_change_queue` database table are permanently removed; obsolete test files deleted; discovery-related test files updated; scenario tests cleaned
**Depends on**: Phase 85, Phase 86, Phase 87
**Requirements**: LEGACY-01, LEGACY-02, LEGACY-03, LEGACY-04, LEGACY-05, LEGACY-06, LEGACY-07, TEST-13, TEST-14, TEST-17
**Success Criteria** (what must be TRUE):
  1. `grep -r "invokeChangeNotifications\|plugin-skill-invoker\|discovery-orchestrator\|discovery-coordinator\|document-ownership" src/` returns zero matches — all 5 deleted source files are fully dereferenced
  2. `flashquery --help` no longer lists a `discover` subcommand; `atomicWriteFrontmatter()` is importable from `src/utils/frontmatter.ts`
  3. `fqc_change_queue` table does not exist in `information_schema.tables` after startup migration; `watcher_claims`, `needs_discovery`, and `discovery_status` columns do not exist on `fqc_documents`
  4. 4 obsolete test files deleted and no longer collected by vitest: `change-notifications.test.ts` (unit + integration), `plugin-skill-invoker.test.ts`, `scanner-change-notifications.integration.test.ts` (TEST-13)
  5. Discovery-related integration test files updated or deleted (`discovery-orchestrator.integration.test.ts` deleted; `discovery-scenarios`, `discovery-errors`, `discovery-multi-plugin` cleaned of notification/watcher_claims dependencies; `plugin-records.integration.test.ts` updated for reconciliation-aware fixtures) (TEST-14)
  6. Scenario tests `test_discover_document.py` and `test_file_scan_lifecycle.py` updated to remove `fqc_change_queue`/`needs_discovery`/`watcher_claims` assertions; benchmark rewritten for reconciliation query cost (TEST-17)
**Plans**: 6 plans
Plans:
- [x] 88-01-PLAN.md — Dependency resolution: create src/utils/frontmatter.ts, update vault.ts/plugin-reconciliation.ts imports, remove scanner.ts discoveryQueue block
- [x] 88-02-PLAN.md — Delete 6 legacy source files; clean index.ts, server.ts, plugins.ts, frontmatter-sanitizer.ts
- [x] 88-03-PLAN.md — Schema migration: DROP TABLE fqc_change_queue and DROP COLUMN for watcher_claims/needs_discovery/discovery_status
- [x] 88-04-PLAN.md — Delete 8 obsolete test files; update mcp-server-tools.test.ts tool count to 34
- [x] 88-05-PLAN.md — Delete 3 discovery integration test files (discovery-scenarios/errors/multi-plugin)
- [x] 88-06-PLAN.md — Delete test_discover_document.py; rewrite discovery-performance.bench.ts for reconciliation
**UI hint**: no

### Phase 89: Test Helper Cleanup & Final Integration
**Goal**: Test helpers (`mock-plugins.ts`, `discovery-fixtures.ts`) updated for the reconciliation-based plugin model; full test suite passes end-to-end with no regressions
**Depends on**: Phase 84, Phase 85, Phase 86, Phase 87, Phase 88
**Requirements**: TEST-11, TEST-12
**Success Criteria** (what must be TRUE):
  1. `MockPluginBuilder` in `tests/helpers/mock-plugins.ts` supports `withAutoTrack()`, `withOnMoved()`, and `withOnModified()` builder methods; `onDiscovered()`, `onChanged()`, `discoveryInvocations`, and `changeInvocations` are removed; `PluginClaim` import from deleted `plugin-skill-invoker.ts` is gone (TEST-11)
  2. `tests/helpers/discovery-fixtures.ts` references `fqc_pending_plugin_review` (not `fqc_change_queue`) in FK cleanup order (TEST-12)
  3. `npm test` (unit suite) passes with 0 failures
  4. `npm run test:integration` passes all tests that have Supabase credentials (0 failures attributable to v2.8 changes)
  5. `npm run test:e2e` passes with 0 failures (no regressions from legacy removal)
**Plans**: 4 plans
Plans:
- [ ] 89-01-PLAN.md — Fix two v2.8 unit test regressions (record-tools + pending-plugin-review)
- [ ] 89-02-PLAN.md — Refactor mock-plugins.ts: remove callback API, add withAutoTrack/withOnMoved/withOnModified (TEST-11)
- [ ] 89-03-PLAN.md — Integration test fixes: plugin-records reconciliation mock + plugin-registration policy tests
- [ ] 89-04-PLAN.md — Extend pending-plugin-review integration test (RO-45/46) + full suite verification
**UI hint**: no

---

## Archive: Completed Milestones v1-v2.5

**For detailed information about completed milestones (v1-v2.5):**
- v2.5 + v2.5.1: [milestones/v2.5-ROADMAP.md](milestones/v2.5-ROADMAP.md) — Phases 61-68 + 69-71 detail
- v2.4: [milestones/v2.4-ROADMAP.md](milestones/v2.4-ROADMAP.md) — Phases 54-60b detail
- v2.2: [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md) — Phases 45-48 detail
- v1-v2.1: See milestones/ directory for complete historical records

**Roadmap structure:** Completed milestones are archived to keep the main ROADMAP lean and current.

---

*Last updated: 2026-04-20 — Phase 86 planned: 5 plans in 3 waves*
