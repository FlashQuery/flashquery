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
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54-60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
- ✅ **v2.6 Test Infrastructure & Quality** — Phases 72-80 (shipped 2026-04-15)
- ✅ **v2.7 Name Change & Pre-Launch Preparation** — Phase 83 (shipped 2026-04-16)
- ✅ **v2.8 Plugin Callback Overhaul** — Phases 84-89 (shipped 2026-04-21)
- ✅ **v2.9 Filesystem Primitive Tools** — Phases 90-97 (shipped 2026-04-25)
- ✅ **v3.0 Native LLM Access** — Phases 98-106 (shipped 2026-04-30)
- ✅ **v3.1 Call Model With Reference** — Phases 107-111 (shipped 2026-05-05)
- ✅ **v3.2 Agentic LLM Tools** — Phases 112-120 (shipped 2026-05-07)
- ✅ **v3.3 MCP Tools Consolidation** — Phases 121-129 (shipped 2026-05-14)
- ✅ **v3.4 macro-support** — Phases 130-138 (shipped 2026-05-17)
- ✅ **v3.5 MCP Broker** — Phases 139-143 (shipped 2026-05-19)
- ✅ **v3.6 Bug Fixes & Host Parity** — Phase 144 (shipped 2026-05-24)
- ✅ **v3.7 Technical Debt** — Phases 145-150 (shipped 2026-05-25)
- ✅ **v3.8 Codebase Audit Remaining Remediation** — Phases 151-154 (shipped 2026-05-26)
- ✅ **v3.9 Vault Write Coherency Locking** — Phases 155-164 (shipped 2026-06-03)
- 🚧 **v4.0 Embedding Management & Multi-Provider Support** — Phases 165-167 (active)

## Current Milestone

**v4.0 Embedding Management & Multi-Provider Support** — Phases 165-167

## Phases

- [ ] **Phase 165: Foundation Infrastructure** — Catalog table + YAML config-sync; per-entry column sets + HNSW indexes + core-table RPCs + drift detection; stamping, length guard, heuristic removal (Spec §8 Phase 1, sub-steps 1.1 → 1.2 → 1.3)
- [ ] **Phase 166: Embedding Pipeline** — Write path (parallel per-entry + pending queue); rate limiting + 429 backoff; search + RRF fusion; plugin-table integration (Spec §8 Phase 2, sub-steps 2.1 → 2.2 → 2.3 → 2.4)
- [ ] **Phase 167: Lifecycle Operations and Validation** — `maintain_vault` lifecycle actions + concurrency; operator recipes integration validation (Spec §8 Phase 3, sub-steps 3.1 → 3.2)

## Phase Details

### Phase 165: Foundation Infrastructure
**Goal**: The embedding catalog, per-entry storage schema, and provider-layer guarantees are in place — startup correctly manages catalog state, data tables carry the right column shape, and the embedding provider layer stamps, validates, and never misreports dimensions
**Depends on**: Nothing (first phase of milestone)
**Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-007, REQ-009, REQ-010, REQ-011, REQ-018, REQ-019 (completed in this phase); REQ-006 (partial — remaining refusal paths complete in Phase 166), REQ-008 (partial — plugin-table column sets complete in Phase 166), REQ-021 (partial — plugin-table RPCs complete in Phase 166)

**Ordered sub-steps (must complete in sequence):**

**Sub-step 1.1 — Catalog Foundation**
- Create `fqc_embeddings` DDL (REQ-001)
- `embeddings:` YAML section parser + strict validation; remove legacy `?? 1536` default (REQ-002)
- Config-sync at startup: insert new entries (REQ-003), refuse vector-space identity changes (REQ-004), deactivate orphaned rows (REQ-005), per-instance scoping (REQ-007); REQ-006 partial (operation refusals deferred to sub-steps where those operations land)
- Tests gate: `npm test -- --grep "embedding-catalog"` + `npm run test:integration -- --grep "embedding-config-sync"` exit 0

**Sub-step 1.2 — Per-Entry Columns + Drift Detection (+ core RPCs)**
- Depends on 1.1
- Per-entry column set creation DDL with orphaned-column pre-flight (REQ-008 partial — core tables; plugin tables in Phase 166 sub-step 2.4)
- Drift detection in `verifySchema` (REQ-010); gated test/dev repair path (REQ-011)
- Core-table RPC generation (`match_memories_<X>`, `match_documents_<X>`) in the same DDL pass as column creation (REQ-021 partial — plugin-table RPCs in Phase 166 sub-step 2.4; retire-time RPC drop in Phase 167 sub-step 3.1)
- Tests gate: `npm run test:integration -- --grep "embedding-columns"` + `npm test -- --grep "drift-detection"` + `npm run test:integration -- --grep "per-entry-rpcs"` exit 0

**Sub-step 1.3 — Stamping, Length Guard, Heuristic Removal**
- Depends on 1.2
- Per-row stamping: write four columns atomically alongside the vector (REQ-009)
- Runtime vector-length guard inside each leaf provider's `embed()` (REQ-018)
- Delete `includeDimensions` heuristic and `dimensions` request-body insertion; delete `dimensions.ts` (REQ-019)
- Tests gate: `npm test -- --grep "embedding-provider"` exits 0; `grep -r "includeDimensions" src/` returns no matches

**Success Criteria** (what must be TRUE when Phase 165 completes):
  1. `fqc_embeddings` table exists after startup; adding a catalog entry to YAML and restarting inserts the row, creates the per-entry column set AND the `match_memories_<X>` / `match_documents_<X>` RPCs on `fqc_documents` and `fqc_memory` in a single DDL pass
  2. Config-sync refuses startup when a YAML edit changes an existing entry's vector-space identity (dimensions or model set) without running any DDL; benign changes (rate-limit tuning, endpoint reorder) apply silently with an audit log entry
  3. Removing an entry's YAML block sets its `status` to `'deactivated'`; columns, indexes, and data are preserved; an ERROR log is emitted per restart until the operator resolves the state
  4. Drift detection in `verifySchema` catches any mismatch between a catalog entry's configured `dimensions` and the actual column width on `fqc_documents` or `fqc_memory`, and fails startup with the table, column, and both widths named
  5. A successful embed write atomically sets `embedding_<X>_model`, `_dimensions`, `_provider`, and `_truncated` alongside the vector; a returned vector of wrong width throws with provider, model, expected width, and actual width named; `dimensions` is never included in embedding API request bodies
**Plans**:
- `.planning/phases/165-foundation-infrastructure/165-01-PLAN.md` — Catalog Foundation
- `.planning/phases/165-foundation-infrastructure/165-02-PLAN.md` — Per-Entry Columns + Drift Detection (+ core RPCs)
- `.planning/phases/165-foundation-infrastructure/165-03-PLAN.md` — Stamping, Length Guard, Heuristic Removal

### Phase 166: Embedding Pipeline
**Goal**: All operational data paths — writes, deferred retry, rate-limited provider calls, search, and plugin-table embedding — are wired to the per-entry catalog and produce correct results end-to-end
**Depends on**: Phase 165
**Requirements**: REQ-006 (completed — search-exclude refusal, the last of four refusal paths), REQ-008 (completed — plugin-table column sets), REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017, REQ-020, REQ-021 (completed — plugin-table RPCs), REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031, REQ-032, REQ-033, REQ-034

**Ordered sub-steps (must complete in sequence):**

**Sub-step 2.1 — Write Path: Best-Effort Per-Entry + Pending Queue**
- Depends on Phase 165
- Extend `fqc_pending_embeds` schema: add `embedding_name TEXT NOT NULL`, update unique key to `(instance_id, target_kind, target_table, target_id, embedding_name)` (REQ-013)
- Generalise `scheduleBackgroundEmbedding` to fire one call per active catalog entry in parallel; write tool awaits all N (REQ-012)
- Per-entry pending retry in `pending-worker.ts`; skip deactivated entries; delete rows for retired entries (REQ-015)
- Surface `embedding_deferred:<name>` warnings on write responses (REQ-014)
- Oversized-input truncation at paragraph/sentence boundary; `_truncated = true` stamping; reactive 75% retry (REQ-016)
- Tests gate: `npm run test:integration -- --grep "embedding-write-path"` + `npm run test:integration -- --grep "pending-worker-per-entry"` exit 0

**Sub-step 2.2 — Rate Limiting + Oversized-Input Handling**
- Depends on 2.1
- Per-endpoint `rate_limit:` parsing; apply `min_delay_ms` proactive throttling in `OpenAICompatibleProvider` and `OllamaProvider` (REQ-017)
- HTTP 429 absorbed via exponential backoff on the same endpoint; other errors fail over to the next endpoint (REQ-017)
- Tests gate: `npm test -- --grep "rate-limit"` + `npm run test:integration -- --grep "429-backoff"` exit 0

**Sub-step 2.3 — Search + RRF Fusion**
- Depends on sub-step 1.2 (core-table RPCs exist) and sub-step 2.1 (write path populates columns)
- `search` tool: catalog-state-derived mode-aware behaviour (REQ-020); `embedding_names` parameter (REQ-022); RRF fusion k=60, app-side, parallel per-entry query embed (REQ-023); deterministic tie-breaking `fused_score DESC, rank_sum ASC, identifier ASC` (REQ-024); zero-active-entry `unsupported` error for semantic (REQ-025); zero-active-entry filesystem-only for mixed + `embedding_unavailable` warning (REQ-026); partial retriever failure warnings + continuation (REQ-027)
- Completes REQ-006: the search-exclude deactivated-entry refusal (the last of four refusal paths) lands here; run REQ-006 full tests at this point
- Tests gate: `npm run test:integration -- --grep "search-rrf"` + `npm test -- --grep "rrf-fusion"` exit 0

**Sub-step 2.4 — Plugin-Table Integration**
- Depends on sub-step 1.2 (column-set machinery) and sub-step 2.3 (`search_records` semantic mode)
- Plugin manifest `embedding:` field parsing and validation (REQ-028)
- `register_plugin` `embedding_name` override parameter; resolution rules per Research §5.9.3; frozen value on registration row (REQ-029, REQ-030)
- Plugin-table column sets (completes REQ-008) and `match_records_<table>_<X>` RPCs (completes REQ-021) added in the same DDL pass; only the resolved entry's columns; no auto-grow on catalog change (REQ-031)
- `write_record` embeds against plugin's single registered entry; `search_records` queries plugin's column (REQ-032)
- Re-registration workflow: new column set added alongside old (REQ-033)
- First-startup migration of legacy registrations: implicit `"*"` resolution applied (REQ-034)
- Tests gate: `npm run test:integration -- --grep "plugin-embedding"` + `python3 tests/scenarios/directed/run_suite.py --managed --pattern "test_plugin_embedding_*"` exit 0

**Success Criteria** (what must be TRUE when Phase 166 completes):
  1. With two active catalog entries, a document or memory write triggers parallel embed attempts for both entries; per-entry failures create coexisting rows in `fqc_pending_embeds` (keyed by `embedding_name`); write tools respond with `embedding_deferred:<name>` warnings for each deferred entry
  2. The pending-worker retries each entry independently using that entry's endpoint chain; it skips rows whose `embedding_name` references a deactivated entry (leaving them queued) and deletes rows whose entry has been retired
  3. Endpoints with `rate_limit.min_delay_ms` enforce that call spacing; HTTP 429 responses trigger exponential backoff on the same endpoint before failing over; other errors fail over immediately
  4. With two active entries, `mode: "semantic"` on `search` issues parallel per-entry RPC queries and returns RRF-fused results with `per_embedding_ranks` per result; tie-breaking is deterministic; `mode: "mixed"` with zero active entries returns filesystem-only results with `embedding_unavailable` warning; `mode: "semantic"` with zero active entries returns `unsupported`
  5. Plugin registration resolves the correct `embedding_name` per the Research §5.9.3 rules; the resolved value is stored and frozen; plugin tables receive only that entry's column set and RPC in a single DDL pass; `write_record` and `search_records` operate against the plugin's single choice; legacy registrations are migrated on first startup
  6. All deactivated-entry refusal paths are complete: write-skip (sub-step 2.1), search-exclude (sub-step 2.3), pending-worker-skip (sub-step 2.1), plugin-registration-refuse (sub-step 2.4)
**Plans**: TBD

### Phase 167: Lifecycle Operations and Validation
**Goal**: Operators can backfill, rebuild, retire, and abort embedding operations via `maintain_vault`; concurrent actions on the same entry are mutually exclusive; the complete feature is validated end-to-end through the two operator recipes as directed and integration scenarios
**Depends on**: Phase 165 + Phase 166
**Requirements**: REQ-035, REQ-036, REQ-037, REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043

**Ordered sub-steps (must complete in sequence):**

**Sub-step 3.1 — `maintain_vault` Lifecycle Actions + Concurrency**
- Depends on Phase 165 sub-step 1.3 (stamping enables `stale_only` selection) and Phase 166 sub-step 2.3 (search consumes backfill results in verification)
- `maintain_vault` tool schema: extend `action` enum to include `backfill_embeddings`, `rebuild_embeddings`, `retire_embedding`, `abort`; add top-level parameters `embedding_name`, `scope`, `max_rows`, `confirm`, `stale_only`, `mismatched_width_only`, `drop_stamping_columns` per spec §7.8 validity matrix (REQ-035, REQ-036, REQ-037, REQ-039)
- `backfill_embeddings`: embed NULL rows idempotently; `dry_run` + `background` support; end with HNSW reindex; hold per-entry concurrency lock (REQ-035)
- `rebuild_embeddings`: overwrite in-scope vectors; `confirm = embedding_name` required; `max_rows` required; `stale_only` / `mismatched_width_only` narrowing; end with HNSW reindex (REQ-036)
- `retire_embedding`: single-transaction DROP of columns, indexes, RPCs (per REQ-021 retire-time drop), and catalog row; refuse `conflict` when any plugin resolves to that entry; works on deactivated entries (REQ-037)
- Per-entry concurrency lock keyed on `(instance_id, embedding_name)` with heartbeat crash safety; independent across entries (REQ-038)
- Background job `abort` via `maintain_vault({ action: "abort", job_id })`; stop at checkpoint; keep embedded rows; release lock; status → `aborted` (REQ-039)
- `max_rows` contract: hard refuse before work when in-scope count exceeds cap; `0` = unlimited; required for rebuild, invalid for retire (REQ-040)
- Records-scope embedding resolution: top-level `embedding_name` rejected for pure-records scope; per-plugin choice drives records work (REQ-041)
- Tests gate: `python3 tests/scenarios/directed/run_suite.py --managed --pattern "test_maintain_vault_embedding_*"` + `npm run test:integration -- --grep "maintain-vault-lifecycle"` exit 0

**Sub-step 3.2 — Operator Recipes — Integration Validation**
- Depends on sub-step 3.1 (and transitively all prior sub-steps — recipes exercise the full feature stack)
- Create `tests/scenarios/directed/testcases/test_first_time_enablement.py` — 6-step recipe directed scenario (REQ-042)
- Create `tests/scenarios/directed/testcases/test_legacy_schema_reset.py` — 7-step wipe-and-re-establish directed scenario (REQ-043)
- Create `tests/scenarios/integration/tests/embedding_first_time_enablement_search.yml` — integration scenario (REQ-042)
- Update `flashquery.example.yml` to reflect final recipe YAML expectations
- Tests gate: `python3 tests/scenarios/directed/run_suite.py --managed --pattern "test_first_time_enablement"` + `python3 tests/scenarios/directed/run_suite.py --managed --pattern "test_legacy_schema_reset"` + `python3 tests/scenarios/integration/run_integration.py --managed --pattern "embedding_first_time_enablement_search"` all exit 0

**Success Criteria** (what must be TRUE when Phase 167 completes):
  1. `backfill_embeddings` embeds NULL rows for a named entry, is idempotent, reports `{ rows_examined, rows_embedded, rows_failed, rows_skipped_already_present }`, honours `dry_run` and `background`, and ends with an HNSW reindex
  2. `rebuild_embeddings` overwrites in-scope vectors; it requires `confirm` and `max_rows`; `stale_only` narrows to rows whose stamped model is no longer in the entry's endpoint set; `mismatched_width_only` narrows to rows whose stamped dimensions differ from the configured value
  3. `retire_embedding` executes atomically: drops the per-entry column set, HNSW indexes, matching RPCs, and the `fqc_embeddings` row in one transaction; refuses with `conflict` and lists affected plugin IDs when any registered plugin resolves to that entry; works on deactivated entries
  4. A second lifecycle invocation for the same `(instance_id, embedding_name)` while a job is in flight returns `conflict` naming the in-flight `job_id`; separate entries run concurrently without interference; a stale lock (heartbeat missed beyond threshold) is acquirable by the next caller
  5. A background job stops at the next checkpoint when `abort` is called; already-embedded rows remain; the concurrency lock is released; status transitions to `aborted`
  6. The first-time enablement directed scenario (add YAML entry → restart → optional dry-run → core backfill → plugin re-registration + records backfill → verification semantic search) completes with all per-step assertions passing; the legacy schema reset directed scenario (7 steps) completes with all per-step assertions passing; both are reproducible from documentation alone
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 165. Foundation Infrastructure | 2/3 | In progress | - |
| 166. Embedding Pipeline | 0/? | Not started | - |
| 167. Lifecycle Operations and Validation | 0/? | Not started | - |

## Archived Milestone Details

- [v3.9 ROADMAP archive](milestones/v3.9-ROADMAP.md)
- [v3.9 REQUIREMENTS archive](milestones/v3.9-REQUIREMENTS.md)
- [v3.9 milestone audit](milestones/v3.9-MILESTONE-AUDIT.md)
- [v3.9 phase artifacts](milestones/v3.9-phases/)
- [v3.8 ROADMAP archive](milestones/v3.8-ROADMAP.md)
- [v3.8 REQUIREMENTS archive](milestones/v3.8-REQUIREMENTS.md)
- [v3.8 milestone audit](milestones/v3.8-MILESTONE-AUDIT.md)
- [v3.8 phase artifacts](milestones/v3.8-phases/)
- [v3.7 ROADMAP archive](milestones/v3.7-ROADMAP.md)
- [v3.7 REQUIREMENTS archive](milestones/v3.7-REQUIREMENTS.md)
- [v3.7 milestone audit](milestones/v3.7-MILESTONE-AUDIT.md)
