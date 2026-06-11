---
type: requirements_spec
created: 2026-06-10
status: active
milestone: v4.0
feature: 'Embedding Management and Multi-Provider Support'
research_doc: 'Embedding Mgmt and Multi-Provider Support.md'
test_plan: 'Embedding Mgmt and Multi-Provider Support Test Plan.md'
source_folder: '/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Embedding Purpose Dimensions'
poc_path: ''
tags:
  - '#type/requirements'
---

# Requirements: v4.0 Embedding Management & Multi-Provider Support

**Defined:** 2026-06-10
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.

## 1. Purpose & Sources

This milestone replaces FlashQuery's legacy `embedding:` purpose construct with a dedicated per-instance `embeddings:` catalog. It adds per-entry column sets to every embedding-bearing table, three new `maintain_vault` lifecycle actions (`backfill_embeddings`, `rebuild_embeddings`, `retire_embedding`) plus a graceful `abort`, per-plugin embedding choice via `register_plugin`, multi-provider endpoint chains with rate limiting and 429 backoff, RRF-fused multi-embedding search, startup validation, drift detection, oversized-input truncation, and removal of the `includeDimensions` heuristic.

**The source spec is LOCKED and ready-for-dev.** Full acceptance criteria, invariants, architecture contracts, and the canonical phased implementation plan (§8) live in the source documents — this file is the milestone-scoped restatement with REQ-IDs and phase traceability.

**Sources.**
- Requirements spec: `<source_folder>/Embedding Mgmt and Multi-Provider Support Requirements.md` (43 REQs, 10 invariants, §7 contracts, §8 phased plan)
- Test plan: `<source_folder>/Embedding Mgmt and Multi-Provider Support Test Plan.md` (REQ↔test matrix, coverage IDs D-100..D-121, IS-50)
- Research doc: `<source_folder>/Embedding Mgmt and Multi-Provider Support.md`
- POC: none — the spec is the authority.

> **REQ acceptance criteria.** Each REQ below is a one-line summary. The authoritative Given/When/Then + MUST/MUST NOT acceptance criteria are in Requirements spec §6 (cited as `§6.X.Y`). Phase plans reference the spec §6 criteria directly.

---

## 2. Invariants (INV-01..10)

Project-level safety guarantees that apply across all REQs. Authoritative text: Requirements spec §4.

- **INV-01**: Writes MUST NOT be blocked by embedding-provider availability; per-entry failures defer to `fqc_pending_embeds` and surface as `embedding_deferred:<name>` warnings.
- **INV-02**: Config-sync MUST refuse startup when an in-place YAML edit changes an entry's vector-space identity (`dimensions` or model set). No DDL in the refusal path.
- **INV-03**: Every `embedding_<name>` column MUST be sized exactly to the entry's configured `dimensions`. No `?? 1536` fallbacks.
- **INV-04**: Vectors from different models MUST NOT be mixed in one column (enforced at config-sync and at the write-time length guard).
- **INV-05**: Lifecycle actions on the same entry MUST be mutually exclusive; concurrent calls return `conflict` naming the in-flight `job_id`.
- **INV-06**: A plugin's resolved `embedding_name` is frozen at `register_plugin` time; later catalog changes MUST NOT auto-update it.
- **INV-07**: `retire_embedding` MUST execute as a single transaction; crash mid-action rolls back to the pre-action state.
- **INV-08**: `retire_embedding` MUST refuse with `conflict` when any registered plugin resolves to the named entry (details list affected plugin IDs).
- **INV-09**: The pending-worker MUST skip (not delete) pending rows whose `embedding_name` references a deactivated entry.
- **INV-10**: FlashQuery MUST NOT send the `dimensions` request parameter to embedding APIs; YAML `dimensions:` is the source of truth.

---

## v1 Requirements

All 43 requirements are committed scope for v4.0. Each maps to exactly one phase per the "Canonical Phase Plan" below.

### Catalog Schema & Config-Sync

- [ ] **REQ-001**: `fqc_embeddings` per-instance catalog table with `(instance_id, name)` uniqueness, JSONB `endpoints`, and `status` orthogonal to `source` (§6.1.1)
- [ ] **REQ-002**: YAML `embeddings:` section parsed and strictly validated; no silent defaults; legacy `?? 1536` fallback removed (§6.1.2)
- [ ] **REQ-003**: Config-sync inserts newly-declared YAML entries and adds their per-entry column sets + HNSW indexes (§6.1.3)
- [ ] **REQ-004**: Config-sync refuses startup on in-place vector-space identity changes; benign changes apply silently with audit log (§6.1.4)
- [ ] **REQ-005**: Removing an entry's YAML block deactivates it in place (status → deactivated); columns/data preserved; ERROR log per restart (§6.1.5)
- [x] **REQ-006**: All operations against deactivated entries are refused except `retire_embedding` (write-skip, search-exclude, backfill-refuse, registration-refuse) (§6.1.6)
- [ ] **REQ-007**: Per-instance multi-tenancy isolation — every catalog op scoped by `instance_id` (§6.1.7)

### Per-Entry Columns, Stamping & Drift Detection

- [x] **REQ-008**: Per-entry column set creation (`embedding_<X>` + 4 stamping columns + HNSW index) transactionally per table, with orphaned-column pre-flight check (§6.2.1)
- [x] **REQ-009**: Per-row model-version stamping on write (model/dimensions/provider/truncated written atomically with the vector) (§6.2.2)
- [x] **REQ-010**: Dimension drift detection in `verifySchema` per catalog entry's columns; mismatch fails startup loudly (§6.2.3)
- [x] **REQ-011**: Gated test/dev destructive repair path (drop + recreate column at configured width); never runs in production by default (§6.2.4)

### Write Path (Best-Effort Per-Entry + Deferred Retry)

- [x] **REQ-012**: Parallel inline embed attempt per active entry; write awaits all N before returning (§6.3.1)
- [x] **REQ-013**: `fqc_pending_embeds` gains `embedding_name`; per-entry pending rows coexist for the same target (§6.3.2)
- [x] **REQ-014**: Write tools surface `embedding_deferred:<name>` warnings, one per deferred entry, deduplicated (§6.3.3)
- [x] **REQ-015**: Pending-worker retries per-entry using each entry's endpoint chain; skips deactivated, deletes retired (§6.3.4)
- [x] **REQ-016**: Oversized-input truncation at paragraph/sentence boundary with `_truncated` stamping, warning, and reactive 75% retry (§6.3.5)
- [x] **REQ-017**: Per-endpoint rate limiting (`min_delay_ms`) and 429 exponential backoff before failover (§6.3.6)
- [x] **REQ-018**: Runtime vector-length guard inside each leaf provider's `embed()` (§6.3.7)
- [x] **REQ-019**: Remove the `includeDimensions` heuristic entirely; never send `dimensions` to embedding APIs (§6.3.8)

### Search & RRF Fusion

- [x] **REQ-020**: Catalog-state-derived default search behaviour (0 / 1 / 2+ active entries × mode) (§6.4.1)
- [x] **REQ-021**: Per-entry semantic RPCs (`match_memories_<X>`, `match_documents_<X>`, `match_records_<table>_<X>`) generated/dropped with the column set (§6.4.2)
- [x] **REQ-022**: `embedding_names: string[]` parameter on `search` to select a subset of entries (§6.4.3)
- [x] **REQ-023**: RRF fusion across multiple active entries (k=60, app-side scoring, parallel per-entry query embedding) (§6.4.4)
- [x] **REQ-024**: Deterministic result ordering & tie-breaking (`fused_score DESC, rank_sum ASC, identifier ASC`) (§6.4.5)
- [x] **REQ-025**: `mode: "semantic"` with zero active entries → `unsupported` error with remediation hint (§6.4.6)
- [x] **REQ-026**: `mode: "mixed"` with zero active entries → filesystem-only results + `embedding_unavailable` warning (§6.4.7)
- [x] **REQ-027**: Partial retriever failure under fusion → continue with survivors + `partial_retriever_failure:<name>` warning (§6.4.8)

### Plugin-Table Embedding

- [x] **REQ-028**: Plugin manifest `embedding:` values (`null` / `"*"` / specific name) parsed and validated (§6.5.1)
- [x] **REQ-029**: `register_plugin` optional `embedding_name` override (`string | null`; `"*"` rejected) (§6.5.2)
- [x] **REQ-030**: Registration resolution rules with canonical refusals (`not_found`, `unsupported`, `ambiguous_identifier`); resolved value frozen (§6.5.3)
- [x] **REQ-031**: Plugin tables get only the resolved entry's column set (or none if `null`); no auto-grow on catalog change (§6.5.4)
- [x] **REQ-032**: `write_record` embeds against the plugin's single registered entry; `search_records` queries that column (§6.5.5)
- [x] **REQ-033**: Plugin re-registration switches entries; new column set added alongside; old persists until manual drop (§6.5.6)
- [x] **REQ-034**: First-startup migration of legacy plugin registrations (implicit `"*"`, resolution applied, legacy `embedding` column untouched) (§6.5.7)

### `maintain_vault` Lifecycle Actions & Concurrency

- [ ] **REQ-035**: `backfill_embeddings` action — embed NULL rows in scope, idempotent, dry-run + background, ends with HNSW reindex (§6.6.1)
- [ ] **REQ-036**: `rebuild_embeddings` action — overwrite in-scope vectors; requires `confirm` + `max_rows`; `stale_only` / `mismatched_width_only` narrowing (§6.6.2)
- [x] **REQ-037**: `retire_embedding` action — single-transaction drop of columns/indexes/RPCs/catalog row; refuses on plugin conflict (§6.6.3)
- [ ] **REQ-038**: Per-entry concurrency lock keyed on `(instance_id, embedding_name)` with heartbeat crash safety; independent across entries (§6.6.4)
- [ ] **REQ-039**: Background job `abort` action — stop at checkpoint, keep embedded rows, release lock, status `aborted` (§6.6.5)
- [ ] **REQ-040**: `max_rows` contract — hard ceiling (refuse before work), `0` = unlimited, backfill-optional / rebuild-required / retire-invalid (§6.6.6)
- [x] **REQ-041**: Records-scope embedding resolution — per-plugin choice drives records; top-level `embedding_name` rejected for pure-records scope (§6.6.7)

### Operator Recipes

- [ ] **REQ-042**: First-time enablement recipe (6 steps) validated as directed + integration scenarios (§6.7.1)
- [ ] **REQ-043**: Legacy schema reset recipe (7 steps, wipe-and-re-establish) validated as a directed scenario (§6.7.2)

---

## Out of Scope

Authoritative list: Requirements spec §3.2. Explicit exclusions for v4.0:

| Feature | Reason |
|---------|--------|
| OpenAI dimensions-reduction (`dimensions` request param) | v1 uses each model's native width only; deferred (needs per-endpoint flag) |
| Copy-from-legacy-column migration tooling | Only v1 migration path is wipe-and-re-establish (§11.2); copy tooling deferred |
| Cross-instance rate-limit coordination | Each process throttles independently; shared-quota coordination deferred |
| Per-content-type embedding routing | Routing doc types to different entries within one vault not built |
| Per-vault embedding overrides | Catalog is per-instance; per-vault subsets deferred |
| Advanced fusion strategies (tunable RRF k, weighted retrievers, rerankers) | v1 ships RRF k=60 only |
| FlashQuery-native sparse-index (BM25/SPLADE first-class) | Operators can configure a sparse model as an entry; dedicated support deferred |
| Runtime `add_embedding` MCP action | Adding an entry is YAML edit + restart; `source: 'runtime'` anticipated only |
| Standalone `reindex_embeddings` action | Reindex is implicit at end of backfill/rebuild |
| Bulk export / re-import migration tools | Out of scope; no operators with vector data worth preserving across instances |

---

## Canonical Phase Plan (Requirements spec §8)

The source spec carries a locked 3-phase × 9-sub-step plan with build-up dependencies and per-sub-step tests. **This plan is canonical** — the roadmap maps the 3 top-level spec phases to GSD phases 165–167 (continuing FlashQuery phase numbering from Phase 165). Each sub-step ships build + tests together.

| Spec Phase | GSD Phase | Name | Ordered sub-steps | REQs | Depends on |
|---|---|---|---|---|---|
| 1 | 165 | Foundation Infrastructure | 1.1 Catalog Foundation → 1.2 Per-Entry Columns + Drift Detection (+ core RPCs) → 1.3 Stamping, Length Guard, Heuristic Removal | REQ-001,002,003,004,005,007,009,010,011,018,019 (completed); REQ-006,008,021 (partial) | None |
| 2 | 166 | Embedding Pipeline | 2.1 Write Path + Pending Queue → 2.2 Rate Limiting + Oversized-Input → 2.3 Search + RRF Fusion → 2.4 Plugin-Table Integration | REQ-006,008,021 (completed); REQ-012,013,014,015,016,017,020,022,023,024,025,026,027,028,029,030,031,032,033,034 | Phase 165 |
| 3 | 167 | Lifecycle Operations & Validation | 3.1 `maintain_vault` Lifecycle Actions + Concurrency → 3.2 Operator Recipes (integration validation) | REQ-035,036,037,038,039,040,041,042,043 | Phase 165 + Phase 166 |

> REQ-006, REQ-008, and REQ-021 are implemented incrementally across sub-steps. The completing phase is the assigned phase for traceability. Phase 165 references these as partial; Phase 166 completes them.

---

## Traceability

Each requirement maps to exactly one roadmap phase. For incrementally-built REQs, the completing phase owns the traceability entry.

**Phase 165 owns 11 REQs:** REQ-001, 002, 003, 004, 005, 007, 009, 010, 011, 018, 019
**Phase 166 owns 23 REQs:** REQ-006, 008, 012, 013, 014, 015, 016, 017, 020, 021, 022, 023, 024, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034
**Phase 167 owns 9 REQs:** REQ-035, 036, 037, 038, 039, 040, 041, 042, 043

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-001 | Phase 165 | Pending |
| REQ-002 | Phase 165 | Pending |
| REQ-003 | Phase 165 | Pending |
| REQ-004 | Phase 165 | Pending |
| REQ-005 | Phase 165 | Pending |
| REQ-006 | Phase 166 | Complete |
| REQ-007 | Phase 165 | Pending |
| REQ-008 | Phase 166 | Complete |
| REQ-009 | Phase 165 | Complete |
| REQ-010 | Phase 165 | Complete |
| REQ-011 | Phase 165 | Complete |
| REQ-012 | Phase 166 | Complete |
| REQ-013 | Phase 166 | Complete |
| REQ-014 | Phase 166 | Complete |
| REQ-015 | Phase 166 | Complete |
| REQ-016 | Phase 166 | Complete |
| REQ-017 | Phase 166 | Complete |
| REQ-018 | Phase 165 | Complete |
| REQ-019 | Phase 165 | Complete |
| REQ-020 | Phase 166 | Complete |
| REQ-021 | Phase 166 | Complete |
| REQ-022 | Phase 166 | Complete |
| REQ-023 | Phase 166 | Complete |
| REQ-024 | Phase 166 | Complete |
| REQ-025 | Phase 166 | Complete |
| REQ-026 | Phase 166 | Complete |
| REQ-027 | Phase 166 | Complete |
| REQ-028 | Phase 166 | Complete |
| REQ-029 | Phase 166 | Complete |
| REQ-030 | Phase 166 | Complete |
| REQ-031 | Phase 166 | Complete |
| REQ-032 | Phase 166 | Complete |
| REQ-033 | Phase 166 | Complete |
| REQ-034 | Phase 166 | Complete |
| REQ-035 | Phase 167 | Pending |
| REQ-036 | Phase 167 | Pending |
| REQ-037 | Phase 167 | Complete |
| REQ-038 | Phase 167 | Pending |
| REQ-039 | Phase 167 | Pending |
| REQ-040 | Phase 167 | Pending |
| REQ-041 | Phase 167 | Complete |
| REQ-042 | Phase 167 | Pending |
| REQ-043 | Phase 167 | Pending |

**Coverage:**
- v1 requirements: 43 total
- Mapped to phases: 43
- Unmapped: 0

---
*Requirements defined: 2026-06-10*
*Last updated: 2026-06-11 — Phase 167 Plan 04 completed REQ-037 retire_embedding lifecycle behavior*
