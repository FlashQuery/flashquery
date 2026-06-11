---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Embedding Management & Multi-Provider Support
status: in_progress
last_updated: "2026-06-11T00:00:00.000Z"
last_activity: 2026-06-11
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 7
  completed_plans: 4
  percent: 57
---

# FlashQuery Core — State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-10)

**Core value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.
**Current focus:** v4.0 Embedding Management & Multi-Provider Support — Phase 166: Embedding Pipeline

## Current Position

Phase: 166 — Embedding Pipeline
Plan: 166-02 — Rate Limiting + 429 Backoff
Status: Phase 166 Plan 01 complete; ready to execute Phase 166 Plan 02
Last activity: 2026-06-11 — Phase 166 Plan 01 completed write fan-out, per-entry pending queue/retry, warning surface, and oversized-input truncation

Progress: ██████░░░░ 57% (4/7 milestone plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 4 (this milestone)
- Average duration: ~29 min
- Total execution time: ~1h 56m

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 165 | 3 | ~1h 30m | ~30m |
| 166 | 1/4 | 26m | 26m |
| 167 | ? | - | - |

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

### Todos

- Execute Phase 166 Plan 02: Rate Limiting + 429 Backoff

### Blockers

None

## Session Continuity

**Last session:** 2026-06-11 — Phase 166 Plan 01 executed
**Next action:** Execute `.planning/phases/166-embedding-pipeline/166-02-PLAN.md`
**Context needed:** Phase 166 execution should build on `.planning/phases/166-embedding-pipeline/166-CONTEXT.md`, `.planning/phases/165-foundation-infrastructure/165-01-SUMMARY.md`, `165-02-SUMMARY.md`, and `165-03-SUMMARY.md`, plus the two external source-of-truth docs named in every Phase 166 plan.

## v4.0 Deferred Items

None yet.
