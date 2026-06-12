---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Embedding Management & Multi-Provider Support
status: milestone_complete
last_updated: "2026-06-12T20:50:00.000Z"
last_activity: 2026-06-12
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 14
  completed_plans: 14
  percent: 100
---

# FlashQuery Core — State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12)

**Core value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.
**Current focus:** Planning next milestone

## Current Position

Phase: Between milestones
Plan: v4.0 archived; next milestone not yet defined
Status: Milestone v4.0 shipped and archived with 43/43 requirements satisfied, 0 blockers, 0 broken flows, and 1 accepted non-blocking abort-timing note.
Last activity: 2026-06-12 — completed v4.0 closeout. Archived roadmap, requirements, and milestone audit; updated project state and roadmap; accepted unrelated open debug artifacts as deferred; prepared for the next milestone requirements cycle.

Progress: ██████████ 100% (3/3 milestone phases complete; 14/14 milestone plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 14 (this milestone)
- Average duration: ~43 min
- Total execution time: ~9h 00m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 165 | 3 | ~1h 30m | ~30m |
| 166 | 4/4 | ~3h 05m | ~46m |
| 167 | 7/7 | ~4h 33m | ~39m |

*Updated after each plan completion*

## Accumulated Context

### Roadmap Evolution

- v4.0 roadmap created 2026-06-10: initially 9 phases (165-173) aligned to spec §8 sub-steps 1.1 → 1.3 → 2.1 → 2.4 → 3.1 → 3.2
- v4.0 roadmap revised 2026-06-10: consolidated to 3 phases (165-167) matching spec §8 top-level phases exactly; sub-steps preserved as ordered in-phase work with their own DoD and verification gates

### Decisions

- v4.0 starts at Phase 165 because v3.9 ended at Phase 164.
- The 3-phase structure matches spec §8 top-level phases 1:1: Phase 165 = Spec Phase 1 (Foundation Infrastructure), Phase 166 = Spec Phase 2 (Embedding Pipeline), Phase 167 = Spec Phase 3 (Lifecycle Operations and Validation).
- Sub-steps are preserved as ordered internal work items within each GSD phase; each sub-step retains its own DoD and verification gate commands from spec §8.
- REQ-006 completes in Phase 166 (search-exclude refusal is the last of four refusal paths; lands in sub-step 2.3). Phase 165 references it as partial.
- REQ-008 completes in Phase 166 (plugin-table column sets added in sub-step 2.4). Phase 165 references it as partial.
- REQ-021 completes in Phase 166 (plugin-table RPCs added in sub-step 2.4). Phase 165 references it as partial.
- Traceability: 165 owns REQ-001,002,003,004,005,007,009,010,011,018,019 (11 REQs); 166 owns REQ-006,008,012,013,014,015,016,017,020,021,022,023,024,025,026,027,028,029,030,031,032,033,034 (23 REQs); 167 owns REQ-035,036,037,038,039,040,041,042,043 (9 REQs). Total 43, zero unmapped.
- Phase 165 Plan 02 completed core scope for REQ-008 and REQ-021: core table column sets, HNSW indexes, and `match_memories_<name>` / `match_documents_<name>` RPCs. Plugin-table completion remains in Phase 166.
- Catalog-aware `verifySchema(client, { instanceId })` is now the active-entry drift path; legacy `verifySchema(client, number)` remains for existing single-column verification.
- Destructive embedding dimension repair exists only through explicit `repairEmbeddingDimensionDrift(..., { enabled: true })`; default startup verification refuses and does not mutate schema.
- Phase 165 Plan 03 keeps legacy singular embedding compatibility explicit via `getLegacyEmbeddingDimensions` while catalog-driven embeddings use strict entry dimensions.
- Per-entry stamping is opt-in through `embeddingName` during Phase 165; Phase 166 will wire catalog fan-out and pending queue shape.
- Leaf embedding providers reject wrong-width vectors before callers can write them; OpenAI-compatible request bodies no longer include `dimensions`.
- Phase 166 Plan 01 completed the core write path slice: `fqc_pending_embeds.embedding_name`, per-active-entry fan-out for core writes/scanner, suffixed `embedding_deferred:<name>` warnings, per-entry pending retry with deactivated skip and retired-row cleanup, and `max_input_chars` truncation with one 75% reactive retry.
- REQ-006 remains partially complete after Plan 01: write-skip and pending-worker-skip paths are implemented; search-exclude and plugin-registration-refuse remain in later Phase 166 plans.
- `gsd-sdk` was unavailable on PATH during Plan 166-01 execution, so state/roadmap tracking was updated manually.
- Phase 166 Plan 02 completed REQ-017: endpoint `rate_limit` settings are parsed/preserved, OpenAI-compatible and Ollama leaf providers enforce in-process `min_delay_ms`, HTTP 429 retries on the same endpoint with exponential backoff before failover, and non-429 failures still fail over immediately.
- `gsd-sdk` remained unavailable on PATH during Plan 166-02 execution, so state/roadmap/requirements tracking was updated manually.
- Phase 166 Plan 03 completed REQ-020, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, and REQ-027: unified `search` is catalog-aware, validates `embedding_names`, uses app-side RRF with k=60 for multi-entry searches, applies deterministic tie breaks, handles zero-active semantic/mixed modes, and continues on partial retriever failure.
- REQ-006 deactivated-entry search behavior is complete: catalog defaults exclude deactivated entries, and explicit deactivated `embedding_names` return `unsupported`.
- `gsd-sdk query state.load` produced no output during Plan 166-03 execution, so state/roadmap/requirements tracking was updated manually.
- Phase 166 Plan 04 completed REQ-028 through REQ-034 and finished REQ-008/REQ-021 for plugin tables: plugin manifests parse `embedding`, `register_plugin` resolves and freezes choices, plugin tables receive only one resolved entry column set/RPC, plugin record writes/searches use that single entry or fall back, re-registration switches entries non-destructively, and legacy registrations migrate on startup without touching singular `embedding` columns.
- Phase 166 is now complete; all assigned embedding-pipeline requirements are complete.
- `gsd-sdk query state.load` again produced no output during Plan 166-04 execution, so state/roadmap/requirements tracking was updated manually.
- Phase 167 Plan 01 completed the lifecycle contract foundation: `maintain_vault` accepts lifecycle action names and parameters, lifecycle actions are rejected inside action arrays before work, `max_rows` pure validation covers T-U-036 through T-U-040, and pure-records rebuild confirm derivation is explicit for later processors.
- `gsd-sdk` was unavailable on PATH during Plan 167-01 execution, so SUMMARY and STATE were updated manually. ROADMAP.md was intentionally not updated per execution instruction.
- Phase 167 Plan 02 completed REQ-038 and REQ-039 foundation: `fqc_maintenance_jobs` now persists lifecycle status, heartbeat, abort, partial counts, failures, and errors; same-entry lifecycle actions are guarded by a partial unique running-job index; stale heartbeat recovery marks abandoned jobs failed; and `maintain_vault` status/abort routes through durable jobs while preserving legacy sync/repair status behavior.
- Durable lifecycle helpers require `supabase.databaseUrl` and return an expected `invalid_input` configuration envelope before mutation when direct PostgreSQL access is unavailable.
- `.env.test` loaded during Plan 167-02 verification, but direct PostgreSQL integration branches skipped because `HAS_DIRECT_DATABASE_URL` was false in the shared test helper; required targeted integration and typecheck commands still exited 0.
- Phase 167 Plan 03 completed REQ-035 and REQ-036 for core documents and memories: `backfill_embeddings` fills only NULL per-entry vectors, `rebuild_embeddings` overwrites guarded rows with confirm/max_rows, stale-only and mismatched-width predicates use stamping columns, and both paths persist durable counts/failures/status through `maintain_vault`.
- Core lifecycle processors require `supabase.databaseUrl` for row selection, max_rows counts, durable job invariants, and HNSW reindexing; vector/stamp writes still flow through `updateTargetEmbedding`.
- Records-scope lifecycle remains intentionally deferred to later Phase 167 work; Plan 167-03 returns explicit `unsupported` for records scope instead of partially implementing it.
- D-104 through D-110 directed scenarios passed using `.env.test` credentials and managed embedding-enabled servers.
- Phase 167 Plan 04 completed REQ-037 for retire_embedding: retire validates confirm/invalid parameters before lock acquisition, refuses active plugin conflicts with `details.affected_plugins`, supports deactivated entries, drops core and stale plugin RPC/index/column artifacts plus the catalog row in one PostgreSQL transaction, and dispatches through public `maintain_vault`.
- Retire artifact inventory handles PostgreSQL-truncated plugin index/RPC names by discovering indexed columns and deriving truncated `match_records_<table>_<entry>` identifiers from plugin tables that still carry the retired vector column.
- D-111 through D-113 directed scenarios passed using `.env.test` credentials and managed embedding-enabled servers.
- Phase 167 Plan 05 completed REQ-041: records-scope lifecycle work resolves from frozen `fqc_plugin_registry.embedding_name` values, rejects pure-records top-level `embedding_name`, skips opted-out plugin rows with `rows_skipped_no_embedding`, and executes records work through `recordEmbeddingTarget`/`updateTargetEmbedding`.
- Mixed lifecycle scopes now split core document/memory work from records work: top-level `embedding_name` applies to core rows only, while plugin records use their frozen registration choice. Pure-records rebuild derives confirm from resolved plugin choices and refuses multi-entry records scopes before mutation.
- D-118 and D-119 directed scenarios passed using `.env.test` credentials and managed embedding-enabled servers.
- Phase 167 Plan 06 added D-114 through D-117 directed scenarios for public lifecycle lock, heartbeat, and abort behavior: same-entry conflict envelopes, different-entry parallelism, stale heartbeat takeover, background abort partial counts, preserved completed rows, lock release, and unknown/completed/already-aborted abort envelopes.
- D-114 through D-117 directed scenarios passed using `.env.test` credentials and managed embedding-enabled servers.
- Phase 167 Plan 07 completed REQ-042 and REQ-043 recipe validation: D-120 first-time enablement directed scenario, D-121 managed legacy reset directed scenario, IS-50 YAML integration search scenario, D-104 through D-121 directed coverage rows, IS-50 integration coverage row, and `flashquery.example.yml` top-level embedding catalog guidance.
- During D-121 development, the narrower directed reset scenario exposed shared-schema hazards. Final REQ-043 coverage was re-pointed to `tests/integration/embedding/legacy-schema-reset.test.ts`, which now self-isolates, covers documents/memory/plugin records, asserts no legacy columns remain, and passes 2/2 per the gap-log follow-up execution audit.
- Phase 167 is closeout-complete: REQ-035 through REQ-043 now have passing evidence. The mixed core+records background lifecycle job-lifetime blocker is fixed by deferring shared-job finalization to the mixed wrapper and completing once with combined core+records counts.
- Milestone v4.0 audit status is `tech_debt`: Commit `52fbdd5` fixed hidden records-job acquisition by passing the returned `backgroundJob` into mixed backfill/rebuild records execution; commit `fd2407a` keeps that public job running through records completion. The follow-up integration checker found no blockers; the record-RPC runtime warning has been fixed, leaving only the documented abort timing warning.
- Earlier embedding-adjacent source gap: `fqc doctor` retry diagnostics still queried legacy singular `embedding` columns. That gap is fixed with active named-entry document/memory/record diagnostics and covered by unit + integration tests.
- Legacy embedding integration fixtures that inserted pending rows without `embedding_name` or expected bare `embedding_deferred` warnings were confirmed stale against REQ-013, REQ-014, REQ-015, and REQ-032 before being updated. Correct tests were allowed to fail until source/test classification was complete.
- Current validation: `npm run preflight` passed; targeted embedding/doctor integration files passed; `npm run test:e2e` passed after archive/remove protocol and auth readiness remediation; `npm run test:unit -- tests/unit/lifecycle-mixed-background-job.test.ts` passed after the lifecycle ownership fix; `npm run typecheck` passed; `npm run test:integration -- tests/integration/embedding/maintain-vault-lifecycle.test.ts` passed; `npx vitest run --config tests/config/vitest.integration.config.ts tests/integration/plugin-search-records-semantic.test.ts` passed; `npx vitest run --config tests/config/vitest.integration.config.ts tests/integration/mcp/tools/records-pg-pool.test.ts` passed; full `npm test` passed with 199 unit files / 2296 tests and 517 macro-framework tests; post-`627129e` integration checker reported 43/43 requirements satisfied, 0 blockers, 0 broken flows, and 1 non-blocking abort-timing warning.

### Todos

- Start the next milestone with `$gsd-new-milestone`.

### Blockers

None.

## Session Continuity

**Last session:** 2026-06-12 — archived v4.0 milestone and accepted the documented abort timing note.
**Next action:** start the next milestone with `$gsd-new-milestone`.
**Context needed:** Use `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/MILESTONES.md`, and the v4.0 archives under `.planning/milestones/`.

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-06-12:

| Category | Item | Status |
|----------|------|--------|
| tech_debt | lifecycle abort status releases the running-job lock before worker checkpoint return is externally proven | accepted |
| debug | cate-pi-brave-search-boundary | investigating |
| debug | root-folder-dsstore-remove | fixing |

## v4.0 Deferred Items

- Lifecycle abort status releases the running-job lock immediately; future work may add E2E proof of worker checkpoint return or tighten the contract.
