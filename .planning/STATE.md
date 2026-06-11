---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Embedding Management & Multi-Provider Support
status: in_progress
last_updated: "2026-06-11T13:37:31.000Z"
last_activity: 2026-06-11
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 8
  completed_plans: 8
  percent: 67
---

# FlashQuery Core — State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-10)

**Core value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.
**Current focus:** v4.0 Embedding Management & Multi-Provider Support — Phase 167: Lifecycle Operations and Validation

## Current Position

Phase: 166 — Embedding Pipeline
Plan: 167-03 — Lifecycle Operations and Validation
Status: Phase 167 in progress; Plan 167-02 complete
Last activity: 2026-06-11 — Phase 167 Plan 02 added durable lifecycle jobs, per-entry running-job locks, heartbeat recovery, pollable status, and abort dispatch through maintain_vault

Progress: ███████░░░ 67% (2/3 milestone phases complete; 8/8 currently executed milestone plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 8 (this milestone)
- Average duration: ~35 min
- Total execution time: ~4h 42m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 165 | 3 | ~1h 30m | ~30m |
| 166 | 4/4 | ~3h 05m | ~46m |
| 167 | 2/? | ~15m | ~8m |

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

### Todos

- Execute remaining Phase 167 lifecycle processor and operator recipe plans.

### Blockers

None

## Session Continuity

**Last session:** 2026-06-11 — Phase 167 Plan 02 executed
**Next action:** Execute remaining Phase 167 lifecycle operations and validation plans
**Context needed:** Phase 167 should build on `.planning/phases/166-embedding-pipeline/166-01-SUMMARY.md`, `166-02-SUMMARY.md`, `166-03-SUMMARY.md`, `166-04-SUMMARY.md`, plus the external source-of-truth requirements and test plan.

## v4.0 Deferred Items

None yet.
