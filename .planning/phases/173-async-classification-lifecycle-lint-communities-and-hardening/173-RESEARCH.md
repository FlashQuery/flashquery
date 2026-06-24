# Phase 173: Async Classification, Lifecycle, Lint, Communities, and Hardening - Research

**Researched:** 2026-06-24 [VERIFIED: gsd-sdk init.phase-op 173]  
**Domain:** FlashQuery graph document intelligence, async LLM classification, document lifecycle, maintenance/lint, community diagnostics, MCP workflow hardening [CITED: product requirements §6.3-§6.7]  
**Confidence:** HIGH for codebase anchors and phase scope; MEDIUM for community algorithm details because the product spec allows a deterministic fallback and does not lock an implementation algorithm [VERIFIED: codebase grep] [CITED: product requirements §6.6.2]

## Summary

Phase 173 completes the graph feature on top of the shipped Phase 171/172 foundation: graph schema/config/vocabulary already exist, structural `contains`/`references` writes already run from chunk diffs, and read surfaces already expose `query_graph`, graph-expanded `search`, and graph-aware `get_document` over stored graph rows. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: .planning/phases/172-structural-graph-and-read-surfaces/172-VERIFICATION.md] [VERIFIED: src/graph/queries.ts] [VERIFIED: src/mcp/tools/graph.ts]

The key planning constraint is that Phase 173 adds asynchronous work without changing the synchronous write contract: document writes may update chunks, mark stale non-structural edges, and refresh Tier 1 structural edges, but they must not wait for Tier 2/Tier 3 LLM classification. [CITED: product requirements §6.3.5] [VERIFIED: src/embedding/chunks/scheduler.ts:97] [VERIFIED: src/embedding/chunks/scheduler.ts:149]

The recommended plan shape is six implementation plans plus one hardening/verification plan: candidate selection and enqueueing; Tier 3 node/edge analysis; pending edge worker and stale completion; lifecycle and filtering; graph lint plus maintenance actions; community detection/labeling; and public workflow hardening. [VERIFIED: .planning/ROADMAP.md] [CITED: product requirements §8.6-§8.8]

**Primary recommendation:** Plan Phase 173 as a dependency-ordered async pipeline, not as isolated tools: first enqueue bounded candidates, then make the worker reliable, then use the worker outputs to complete lifecycle/lint/community read behavior, then close with public scenarios. [VERIFIED: codebase grep] [CITED: product requirements §8.6-§8.8]

## Source-of-Truth Docs

Downstream implementation agents MUST read these two product docs first, then local planning docs. [VERIFIED: .planning/phases/171-graph-foundation-structural-graph-and-read-surfaces/171-CONTEXT.md] [VERIFIED: .planning/phases/172-structural-graph-and-read-surfaces/172-CONTEXT.md]

1. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md` is authoritative for requirements and acceptance criteria. [CITED: product requirements §1]
2. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md` is authoritative for test IDs, test files, and verification layer strategy. [CITED: product test plan §1-§4]
3. `.planning/ROADMAP.md` maps Phase 173 to GR-010, GR-011, GR-012, GR-013B, GR-014B, GR-015, GR-016B, GR-020B, GR-021, GR-022, GR-023, and GR-024B. [VERIFIED: .planning/ROADMAP.md]
4. `.planning/REQUIREMENTS.md` carries the compressed GSD mapping and confirms Phase 173 covers product phases 4-6. [VERIFIED: .planning/REQUIREMENTS.md]
5. `.planning/STATE.md` says Phase 172 is complete and the next action is Phase 173 planning/execution. [VERIFIED: .planning/STATE.md]
6. Phase 171 and 172 contexts lock the source-of-truth priority: product requirements/test plan first, then `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md`. [VERIFIED: 171-CONTEXT.md] [VERIFIED: 172-CONTEXT.md]

## Project Constraints

- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- Use Node.js >= 20, TypeScript strict mode, ESM, `@modelcontextprotocol/sdk`, Supabase/Postgres, `tsup`, `tsx`, and Vitest. [VERIFIED: AGENTS.md]
- Use `async/await`; module-boundary failures should return typed errors, and MCP handlers should catch internally and return structured MCP error responses. [VERIFIED: AGENTS.md]
- Use Zod for external input validation. [VERIFIED: AGENTS.md]
- MCP tool responses use `content: [{ type: "text", text: "..." }]`; graph JSON success/error envelopes should follow the existing JSON helper conventions. [VERIFIED: AGENTS.md] [VERIFIED: src/mcp/utils/response-formats.ts]
- Do not use CommonJS or `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP remains stateless and project context is per call. [VERIFIED: AGENTS.md]

## Shipped Foundation

### Phase Status

| Foundation Area | Current State | Planning Implication |
|---|---|---|
| Phase 171 | Config, vocabulary, prompt sidecars, graph schema, and edge metadata contracts are complete. [VERIFIED: .planning/ROADMAP.md] | Phase 173 should extend existing graph config and DDL, not recreate foundation modules. [VERIFIED: codebase grep] |
| Phase 172 | Structural graph writes, `fq_processing` gates, `query_graph`, graph-expanded `search`, and graph-aware `get_document` are complete and verified. [VERIFIED: 172-VERIFICATION.md] | Phase 173 can use seeded read surfaces but must retest them against real Tier 3/lifecycle/community data. [VERIFIED: product test plan §4.4-§4.6] |
| Verification | Phase 172 verification passed 10/10 requirements with unit, integration, directed, YAML, typecheck, build, and full unit suite evidence. [VERIFIED: 172-VERIFICATION.md] | Phase 173 plans should include regression guardrails for the existing read surfaces while adding async/lifecycle assertions. [VERIFIED: 172-VERIFICATION.md] |

### Modules and Contracts Already Present

- `src/graph/config.ts` contains `GraphRuntimeConfig` with enabled, embedding, classification resolver, similarity, job cap, max attempts, relations, prompts, and overrides fields. [VERIFIED: src/graph/config.ts]
- `src/storage/supabase.ts` already declares `fqc_graph_nodes`, `fqc_graph_edges`, `fqc_pending_edges`, and `fqc_graph_maintenance_state`; `fqc_pending_edges` includes `status`, `attempt_count`, `max_attempts`, `result`, `last_error`, `next_retry_at`, and a unique `(instance_id, source_chunk_id, target_chunk_id)` dedupe constraint. [VERIFIED: src/storage/supabase.ts:440] [VERIFIED: src/storage/supabase.ts:529]
- `src/storage/supabase.ts` already declares `fqc_llm_usage` with instance, purpose, model, provider, tokens, cost, fallback, trace, and created time. [VERIFIED: src/storage/supabase.ts:881]
- `src/storage/supabase.ts` generates per-entry `match_chunks_<embedding_name>` RPCs with `filter_instance_id` and `include_archived` arguments. [VERIFIED: src/storage/supabase.ts:1260]
- `src/embedding/chunks/scheduler.ts` owns chunk diff persistence, `fq_processing`, synchronous stale marking, structural graph refresh, and chunk embedding scheduling. [VERIFIED: src/embedding/chunks/scheduler.ts:97]
- `src/graph/staleness.ts` currently marks changed non-structural edges stale and explicitly does not enqueue Tier 2 or Tier 3 work. [VERIFIED: src/graph/staleness.ts:25]
- `src/graph/queries.ts` supports `node`, `edges`, `neighbors`, `path`, `subgraph`, `stats`, `schema`, `contradictions`, `impact`, `provenance_chain`, `weak_paths`, `ungrounded_edges`, `community_for`, `community_members`, and `list_communities`. [VERIFIED: src/graph/queries.ts:8]
- `src/mcp/tools/graph.ts` registers `query_graph` and returns an `unsupported` expected-error envelope when graph is disabled. [VERIFIED: src/mcp/tools/graph.ts:30] [VERIFIED: src/mcp/tools/graph.ts:41]
- `src/mcp/tools/compound.ts` exposes graph search options including `graph_expand`, relation/depth/stale/inactive flags, `include_community`, and `path_to`. [VERIFIED: src/mcp/tools/compound.ts:471] [VERIFIED: src/mcp/tools/compound.ts:1954]
- `src/mcp/tools/documents/get.ts` exposes `include:["graph_summary"]` and graph-aware `connections` options. [VERIFIED: src/mcp/tools/documents/get.ts:26] [VERIFIED: src/mcp/tools/documents/get.ts:49]
- `src/graph/edge-validation.ts` already validates classified edge reasoning, qualifier arrays/nulls, discrete `llm_assessment`, boolean `low_confidence_flag`, and relation-specific metadata keys. [VERIFIED: src/graph/edge-validation.ts:26]

### Public Tool Surfaces Already Present

- `query_graph` is registered as the read-only graph tool; graph maintenance execution belongs under `maintain_vault`, not `query_graph`. [VERIFIED: src/mcp/tools/graph.ts:41] [CITED: product requirements §6.5.1, §6.6.1]
- Unified `search` already has graph expansion parameters and warnings for disabled graph or missing semantic seed. [VERIFIED: src/mcp/tools/compound.ts:721] [VERIFIED: src/mcp/tools/compound.ts:727]
- `get_document` already has graph summary and graph-primary connection options. [VERIFIED: src/mcp/tools/documents/get.ts:26] [VERIFIED: tests/integration/graph/get-document-graph.test.ts]
- `maintain_vault` currently supports `sync`, `repair`, `status`, embedding lifecycle actions, background jobs, dry run for sync/repair, and shutdown rejection. [VERIFIED: src/services/maintenance.ts:49] [VERIFIED: src/services/maintenance.ts:113]

### Data Contracts to Preserve

- Graph nodes are keyed by `fqc_chunks.id`; there is no parallel section identity system. [CITED: product requirements INV-03] [VERIFIED: src/storage/supabase.ts:440]
- Graph edges store directed source/target chunk IDs, relation, confidence, score, reasoning, model, status, metadata, and timestamps. [VERIFIED: src/storage/supabase.ts:478]
- Active graph edge uniqueness is `(instance_id, source_chunk_id, target_chunk_id, relation)` for active edges; pending edge job dedupe is `(instance_id, source_chunk_id, target_chunk_id)`. [VERIFIED: src/storage/supabase.ts:514] [VERIFIED: src/storage/supabase.ts:544]
- Tier 2 similarity must remain candidate-selection only and must not create stored semantic-similarity topology. [CITED: product requirements INV-04] [CITED: product requirements §6.3.2]
- Raw LLM output must not be exposed in public graph error envelopes. [CITED: product requirements INV-08] [CITED: product test plan T-U-062]

## Implementation Areas

### 1. Tier 2 Candidate Selection

Plan a new graph candidate module that uses the configured graph embedding name, calls the matching chunk RPC, filters by `instance_id`, excludes same-document pairs by default, supports threshold and percentile modes, and caps enqueued jobs per save. [CITED: product requirements §6.3.2] [VERIFIED: src/storage/supabase.ts:1260]

Candidate selection should run only after chunk embeddings exist or should return explicit skipped-work warnings when embeddings are missing; it should not silently no-op. [CITED: product requirements §6.7.1] [CITED: product test plan T-I-040]

Recommended code homes: `src/graph/candidates.ts` for pure selection/ranking, `src/graph/pending-edges.ts` for upsert/dedupe, and a call site from `scheduleChangedDocumentChunks` after chunks are persisted and embedding scheduling is known. [ASSUMED]

### 2. Tier 3 Node and Edge LLM Analysis

Plan a graph LLM module that resolves either `graph.classification_purpose` or `graph.classification_model`, analyzes node metadata before edge classification, validates every LLM JSON payload with `parseLlmJson`, and records model plus prompt version in `analyzed_by_model`. [CITED: product requirements §6.3.3] [VERIFIED: src/llm/json-repair.ts:26]

Node analysis should update `fqc_graph_nodes` fields already declared in DDL: `key_claims`, `chunk_summary`, `provenance_basis`, `question_status`, `question_resolution`, `certainty_level`, `staleness_risk`, `external_refs`, `temporal_markers`, `analyzed_content_hash`, `analyzed_by_model`, and `analyzed_at`. [CITED: product requirements §6.3.3] [VERIFIED: src/storage/supabase.ts:440]

Edge classification should reject malformed claim references, empty required claim references, non-rubric `llm_assessment`, malformed low-confidence flags, and any relation metadata outside the loaded vocabulary schema before writing graph edges. [CITED: product requirements §6.3.3] [VERIFIED: src/graph/edge-validation.ts:65]

### 3. Durable Pending Edge Worker

Model the graph worker on `processPendingEmbeddings`, but tighten behavior for Phase 173: eligible-row selection by instance/status/retry time, stable dedupe, dependency failure recording, max-attempt dead-lettering, shutdown checks, per-run limits, and enumerable remediation detail. [VERIFIED: src/embedding/pending-worker.ts:87] [CITED: product requirements §6.3.4]

`processPendingEmbeddings` has the useful pattern for selected/processed/succeeded/failed counts, retry backoff, instance filtering, and logger warnings. [VERIFIED: src/embedding/pending-worker.ts:94] [VERIFIED: src/embedding/pending-worker.ts:149]

The graph worker should differ from the embedding worker by moving jobs to `dead_letter` after bounded attempts and exposing those dead letters through maintenance/lint status. [CITED: product requirements §6.3.4] [CITED: product test plan T-U-042, T-U-073]

### 4. Stale-Edge Completion

Phase 172 already marks changed non-structural edges stale. [VERIFIED: src/graph/staleness.ts:35] Phase 173 must add the completion rules: confirmed same relation updates stale edge in place and clears stale; different relation or no relation deletes/replaces stale rows so stale history does not accumulate. [CITED: product requirements §6.3.5]

Plan this with unit tests around pure stale completion functions before integration tests touch real `fqc_graph_edges` rows. [CITED: product test plan T-U-056, T-U-057]

### 5. `fq_processing`, Archive, Missing, Unarchive, Hard Delete

`fq_processing` parsing currently defaults absent/empty to `full`; invalid values return diagnostics; `none` deletes pending chunk embeds and chunks; `embedded` persists chunks but removes graph nodes/edges through graph node deletion. [VERIFIED: src/embedding/chunks/scheduler.ts:67] [VERIFIED: src/embedding/chunks/scheduler.ts:114] [VERIFIED: src/embedding/chunks/scheduler.ts:143]

Archive and remove tools currently set document status to `archived`; remove then either moves to trash or deletes the file depending on trash config. [VERIFIED: src/mcp/tools/documents/archive.ts] [VERIFIED: src/mcp/tools/documents/remove.ts]

Scanner marks absent active documents as `missing` and restores missing rows to active when files reappear. [VERIFIED: src/services/scanner.ts:1030] [VERIFIED: src/services/scanner.ts]

Phase 173 must reconcile these shipped behaviors with graph requirements: archived/missing graph state is preserved, inactive content drift marks touching graph edges stale without re-embedding or re-classifying while inactive, unarchive with hash drift resumes normal processing, and hard delete cascades graph state. [CITED: product requirements §6.4.1-§6.4.3]

### 6. Graph Lint Maintenance Actions

Add `maintain_vault` actions `graph_lint`, `graph_lint_status`, and `graph_lint_prune`; do not put maintenance execution under `query_graph`. [CITED: product requirements §6.6.1] [VERIFIED: src/services/maintenance.ts:113]

`graph_lint` must run in order: community detection/labeling first, deterministic integrity auto-fixes second, LLM-assisted duplicate edge propagation third, and content observations fourth. [CITED: product requirements §6.6.1]

`graph_lint_status` must read stored results without rerunning lint, and `graph_lint_prune` must delete old run records by count or age. [CITED: product requirements §7.8] [CITED: product test plan T-I-035, T-I-043, T-U-075]

The existing `fqc_graph_maintenance_state` table is a state/cursor table, not a full run-history table; plan whether to extend it or add a graph lint run table before implementing status/list/prune semantics. [VERIFIED: src/storage/supabase.ts:577] [ASSUMED]

### 7. Semantic Lint Categories

The lint payload contract has six semantic categories: `questions`, `provenance`, `contradictions`, `duplicates`, `communities`, and `integrity`, plus `raw_findings` carrying rule IDs, severity, and affected IDs. [CITED: product requirements §7.7]

Deltas are per-item `"new"` or `"recurring"` or `null`, with top-level resolved item counts; status retrieval must preserve the original semantic payload shape. [CITED: product requirements §6.6.1] [CITED: product requirements §7.7]

Lifecycle filtering matters inside lint: ignore edges where both endpoints are inactive and report active-to-inactive edges as informational findings. [CITED: product requirements §6.4.3]

### 8. Community Detection and Labeling

Community detection must use stored graph topology only; it must not manufacture topology from embedding similarity. [CITED: product requirements §6.6.2] [CITED: product test plan T-U-049]

The first implementation may use a deterministic fallback community algorithm if Leiden dependency selection is deferred, and tests must assert contracts rather than Leiden-specific internals. [CITED: product requirements §6.6.2] [CITED: product test plan §8]

Community IDs, labels, summaries, strength, and health metadata are read-only and ephemeral in v1; stable community identity and user curation are future work. [CITED: product requirements §3.3] [CITED: product requirements §6.6.2]

Recommended planning choice: start with an in-process deterministic connected-components/weighted-components fallback and avoid a new package in Phase 173 unless the planner explicitly chooses and verifies one. [ASSUMED]

### 9. Cost and Resource Controls

Tier 3 is disabled unless a classification resolver is configured. [CITED: product requirements §6.7.1] [VERIFIED: src/mcp/tools/graph.ts:101]

Graph worker responses and public tool responses must include warnings for skipped work due to missing embeddings, missing LLM resolver, disabled graph, or exceeded job/cost bounds. [CITED: product requirements §6.7.1]

Graph LLM calls should flow through the existing LLM client/cost stack when possible so `fqc_llm_usage` and `get_llm_usage` can show purpose/model/trace separation. [VERIFIED: src/llm/cost-tracker.ts:80] [VERIFIED: src/mcp/tools/llm-usage.ts] [CITED: product requirements §6.7.1]

## Code Anchors

| Anchor | Why It Matters |
|---|---|
| `src/embedding/chunks/scheduler.ts:97` | Primary write/scan hook for chunk diffing, stale marking, structural graph refresh, and future candidate enqueueing. [VERIFIED: codebase grep] |
| `src/embedding/chunks/store.ts` | `diffAndPersistDocumentChunks()` returns new/changed/unchanged/orphan/chunks-needing-embedding sets used by stale marking and candidate selection. [VERIFIED: codebase grep] |
| `src/embedding/pending-worker.ts:87` | Best analog for pending worker selection, retry, result counts, and instance filtering. [VERIFIED: codebase grep] |
| `src/services/scanner.ts:1263` | Scanner drains pending embedding retries after embed drain; graph worker can hook here or behind maintenance with shutdown checks. [VERIFIED: codebase grep] |
| `src/server/shutdown-state.ts` | Global shutdown flag is used by tools and scanner; graph worker must honor it. [VERIFIED: codebase grep] |
| `src/llm/json-repair.ts:26` | Only approved LLM JSON parse/repair entry point for graph node/edge parse sites. [VERIFIED: codebase grep] |
| `src/llm/cost-tracker.ts:80` | Usage recording pattern for graph LLM calls and trace accounting. [VERIFIED: codebase grep] |
| `src/services/maintenance.ts:113` | Existing `maintain_vault` dispatcher and concurrency/shutdown/background patterns. [VERIFIED: codebase grep] |
| `src/graph/queries.ts:8` | Existing read actions that Phase 173 must populate with real Tier 3/community/lifecycle data. [VERIFIED: codebase grep] |
| `src/mcp/utils/document-connections.ts` | Graph-primary `get_document connections` logic that must respect lifecycle/stale/community behavior. [VERIFIED: codebase grep] |
| `src/mcp/tools/compound.ts:715` | Graph search expansion code path that must consume community/path/lifecycle state. [VERIFIED: codebase grep] |
| `src/storage/supabase.ts:529` | `fqc_pending_edges` DDL; worker plans should use existing columns before adding schema. [VERIFIED: codebase grep] |

## Test/Scenario Anchors

### Required Phase 173 Test Files

- Unit: `tests/unit/graph-candidates.test.ts`, `tests/unit/graph-llm-analysis.test.ts`, `tests/unit/graph-pending-worker.test.ts`, `tests/unit/graph-cost-controls.test.ts`, `tests/unit/graph-lifecycle.test.ts`, `tests/unit/graph-lint.test.ts`, and `tests/unit/graph-communities.test.ts`. [CITED: product test plan §4.4-§4.5]
- Integration: `tests/integration/graph/candidate-selection.test.ts`, `tests/integration/graph/pending-edge-worker.test.ts`, `tests/integration/graph/llm-usage.test.ts`, `tests/integration/graph/archive-missing-lifecycle.test.ts`, `tests/integration/graph/graph-lint.test.ts`, plus updates to `query-graph.test.ts` and `provenance-question.test.ts`. [CITED: product test plan §4.4-§4.5]
- E2E: `tests/e2e/graph-query.e2e.test.ts` and `tests/e2e/graph-search-get-document.e2e.test.ts`. [CITED: product test plan §4.6]
- Directed scenarios: `test_graph_archive_staleness.py`, `test_graph_get_document_summary.py`, `test_graph_processing_levels.py`, and `test_graph_disabled_and_partial.py`; Phase 172 already has `test_graph_structural_edges.py` and `test_query_graph_public_surface.py`. [CITED: product test plan §4.5-§4.6] [VERIFIED: tests/scenarios/directed/testcases]
- YAML scenarios: `graph_mock_llm_classification.yml` and `graph_lint_communities.yml`; Phase 172 already has `graph_disabled_noop.yml` and `graph_search_expansion.yml`. [CITED: product test plan §4.4-§4.6] [VERIFIED: tests/scenarios/integration/tests]

### Verification Commands to Assign

- Candidate/LLM/worker wave: `npm test -- --run tests/unit/graph-candidates.test.ts tests/unit/graph-llm-analysis.test.ts tests/unit/graph-pending-worker.test.ts tests/unit/graph-cost-controls.test.ts` and `npm run test:integration -- --run tests/integration/graph/candidate-selection.test.ts tests/integration/graph/pending-edge-worker.test.ts tests/integration/graph/llm-usage.test.ts`. [VERIFIED: .planning/ROADMAP.md]
- Lifecycle/lint/community wave: `npm test -- --run tests/unit/graph-lifecycle.test.ts tests/unit/graph-lint.test.ts tests/unit/graph-communities.test.ts` and `npm run test:integration -- --run tests/integration/graph/archive-missing-lifecycle.test.ts tests/integration/graph/provenance-question.test.ts tests/integration/graph/graph-lint.test.ts tests/integration/graph/query-graph.test.ts`. [VERIFIED: .planning/ROADMAP.md]
- Public hardening wave: `npm test -- --run tests/e2e/graph-query.e2e.test.ts tests/e2e/graph-search-get-document.e2e.test.ts`, `python3 tests/scenarios/directed/run_suite.py --managed graph`, and `python3 tests/scenarios/integration/run_integration.py --managed graph`. [VERIFIED: .planning/ROADMAP.md]
- Phase gate: `npm test`, `npm run test:integration`, `npm run typecheck`, and `npm run build`. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: AGENTS.md]

### Scenario Conventions

- Directed scenarios must verify through public tool responses, vault filesystem state, and tool return values; they should not query the DB directly. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md]
- Directed scenarios requiring embeddings or LLM config must force a dedicated managed server because shared managed mode does not apply per-test opt-in flags. [VERIFIED: tests/scenarios/directed/WRITING_SCENARIOS.md]
- YAML integration scenarios can use `deps: [embeddings]` or `deps: [llm]`, managed-only server modes, and `extra_config` style managed fixtures. [VERIFIED: tests/scenarios/integration/README.md]
- The YAML runner deletes all `fqc_*` rows before/after each test and must only point at throwaway Supabase/Postgres instances. [VERIFIED: tests/scenarios/integration/README.md]

## Risks

1. **Blocking writes on Tier 3:** Calling the LLM from `write_document`, `copy_document`, scanner write paths, or `scheduleChangedDocumentChunks` would violate the non-blocking write invariant. [CITED: product requirements INV-06] [VERIFIED: src/embedding/chunks/scheduler.ts:171]
2. **Cross-instance leakage:** Every graph query, candidate RPC call, pending job selection, lint run, and community update must filter by `instance_id`. [CITED: product requirements INV-02] [VERIFIED: src/graph/queries.ts:200]
3. **Persisted similarity topology:** Tier 2 candidates must not become `semantically_similar_to` graph edges or any stored topology. [CITED: product requirements INV-04]
4. **Wrong LLM parser:** Graph parse sites must use `parseLlmJson`; adding a second JSON repair path would regress Phase 170 decisions. [CITED: product requirements INV-10] [VERIFIED: src/llm/json-repair.ts:26]
5. **Dead-letter ambiguity:** Failed graph jobs must stop automatic retry at max attempts and remain enumerable with remediation detail; otherwise graph lint/status cannot explain skipped or failed classification. [CITED: product requirements §6.3.4]
6. **Lifecycle cleanup conflict:** Existing `fq_processing:embedded` and `none` behavior removes graph/chunk state, while archive/missing behavior must preserve graph state; plans must define precedence explicitly. [VERIFIED: src/embedding/chunks/scheduler.ts:114] [CITED: product requirements §6.4.1-§6.4.2]
7. **Read-surface drift:** Search and `get_document` hide inactive targets by default, while `query_graph`/provenance can include and label inactive nodes; Phase 173 must keep these surface-specific defaults. [CITED: product requirements §6.4.3] [VERIFIED: src/graph/queries.ts:25]
8. **Dry-run side effects:** `graph_lint dry_run:true` still runs analysis, but must not persist findings, auto-fixes, or community assignments. [CITED: product requirements §7.8]
9. **Community overreach:** Community detection must operate on stored graph topology and must produce no communities for insufficient sparse topology. [CITED: product test plan T-U-064]
10. **Security-bounded errors:** Public error payloads must omit raw LLM completion text, API keys, DB URLs, and stack traces. [CITED: product test plan T-U-062] [VERIFIED: src/mcp/utils/response-formats.ts]
11. **Existing dirty worktree:** Research observed existing modified files in `src/config/loader.ts`, `src/graph/queries.ts`, `src/mcp/tools/graph.ts`, `tests/scenarios/integration/tests/graph_disabled_noop.yml`, `tests/unit/graph-config.test.ts`, and `tests/unit/graph-query.test.ts`; planners/executors must not revert unrelated user changes. [VERIFIED: git status --short]

## Recommended Plan Breakdown

### Plan 173-01: Candidate Selection and Pending Edge Enqueue

Own GR-010 and part of GR-023. [VERIFIED: .planning/REQUIREMENTS.md]

- Add candidate selection helpers over `match_chunks_<embedding_name>()`, threshold/percentile selection, same-document exclusion, deterministic tie handling, instance filtering, and max jobs per save. [CITED: product requirements §6.3.2]
- Upsert pending jobs into `fqc_pending_edges` with stable dedupe keys and skipped-work warnings. [CITED: product requirements §6.3.4] [CITED: product requirements §6.7.1]
- Tests: T-U-033, T-U-034, T-U-035, T-U-036, T-U-058, T-I-018, and T-I-040. [CITED: product test plan §4.4]

### Plan 173-02: Tier 3 Node/Edge LLM Analysis

Own GR-011 and part of GR-023/GR-024B. [VERIFIED: .planning/REQUIREMENTS.md]

- Implement node analysis, edge classification, prompt version/model recording, `parseLlmJson` parsing, Zod schemas, bounded error summaries, edge validation, and LLM usage traces. [CITED: product requirements §6.3.3] [VERIFIED: src/llm/json-repair.ts:26]
- Tests: T-U-037, T-U-038, T-U-039, T-U-040, T-U-062, T-U-078, T-I-020, and T-Y-003. [CITED: product test plan §4.4]

### Plan 173-03: Pending Worker, Dead Letters, Shutdown, and Stale Completion

Own GR-012 and GR-013B. [VERIFIED: .planning/REQUIREMENTS.md]

- Implement graph worker selection, per-run limits, shutdown checks, retry/backoff, max-attempt dead-lettering, dependency failure state, remediation enumeration, and stale edge update/delete/replace. [CITED: product requirements §6.3.4-§6.3.5]
- Tests: T-U-041, T-U-042, T-U-056, T-U-057, T-U-059, T-U-072, T-U-073, T-I-019, and T-I-041. [CITED: product test plan §4.4]

### Plan 173-04: Lifecycle Completion and Surface Filtering

Own GR-014B, GR-015, GR-016B, and part of GR-020B. [VERIFIED: .planning/REQUIREMENTS.md]

- Finish `fq_processing` transition semantics, archive/missing/unarchive/hard-delete graph behavior, stale marking for inactive drift, and lifecycle filtering across search, get-document, query_graph, provenance, and lint. [CITED: product requirements §6.4]
- Tests: T-I-021, T-I-022, T-I-023, T-I-028, T-S-003, and T-S-005, plus regressions in existing `fq-processing`, `query-graph`, `get-document-graph`, and `search-graph-expansion` tests. [CITED: product test plan §4.5-§4.6]

### Plan 173-05: Graph Lint and Maintenance Actions

Own GR-021 and part of GR-020B/GR-023. [VERIFIED: .planning/REQUIREMENTS.md]

- Extend `maintain_vault` with `graph_lint`, `graph_lint_status`, and `graph_lint_prune`; define run persistence; implement semantic categories, raw findings, deltas, dry run, status list, and prune behavior. [CITED: product requirements §6.6.1, §7.7-§7.8]
- Tests: T-U-044, T-U-045, T-U-046, T-U-063, T-U-065, T-U-066, T-U-067, T-U-068, T-U-074, T-U-075, T-I-024, T-I-034, T-I-035, and T-I-043. [CITED: product test plan §4.5]

### Plan 173-06: Communities and Real-Data Query Integration

Own GR-022 and deferred real-data portions of GR-017/GR-018/GR-019. [VERIFIED: .planning/REQUIREMENTS.md] [CITED: product test plan §4.3 scope note]

- Implement deterministic community detection/labeling from stored topology, write ephemeral community metadata to nodes, compute strength/health metadata, and expose populated community reads through existing query/search/get-document surfaces. [CITED: product requirements §6.6.2]
- Tests: T-U-047, T-U-048, T-U-049, T-U-064, T-I-031, T-I-032, T-I-033, T-I-038, T-I-039, and T-Y-004. [CITED: product test plan §4.5]

### Plan 173-07: Public Workflow Hardening and Phase Gate

Own GR-024B and final cross-surface proof. [VERIFIED: .planning/REQUIREMENTS.md]

- Add E2E smoke tests, directed scenarios, YAML scenarios, coverage matrix updates, disabled/partial graph workflows, security-bounded error payload checks, and the Phase 6 guardrail that every planned graph test file exists or is explicitly folded into another file. [CITED: product requirements §8.8] [CITED: product test plan §4.6]
- Tests: T-E-001, T-E-002, T-S-004, T-S-006, T-Y-001 through T-Y-004, full graph scenario runners, `npm test`, `npm run test:integration`, `npm run typecheck`, and `npm run build`. [VERIFIED: .planning/ROADMAP.md] [CITED: product test plan §4.6]

## Open Questions

1. **Graph lint run storage:** Should `fqc_graph_maintenance_state` be extended with run-history fields, or should a new run table be added for persisted payloads/status listing/prune? What we know: `fqc_graph_maintenance_state` currently stores one row per `(instance_id, scope)` with cursor/status, not an obvious list of historical lint runs. [VERIFIED: src/storage/supabase.ts:577] Recommendation: choose this in Plan 173-05 before implementing `graph_lint_status limit` and prune. [ASSUMED]
2. **Community algorithm:** Should Phase 173 lock a deterministic fallback or introduce a graph community package? What we know: the product spec allows a deterministic fallback and tests must not assert Leiden internals. [CITED: product requirements §6.6.2] Recommendation: use deterministic in-process fallback unless the planner adds package legitimacy and human verification tasks. [ASSUMED]
3. **Worker trigger point:** Should graph pending edges drain during scanner sync, `maintain_vault graph_lint`, a new maintenance action, or startup? What we know: pending embeddings drain from scanner after embed drain, and graph work must remain scan-triggered, queue-driven, or tool-triggered, not scheduled session state. [VERIFIED: src/services/scanner.ts:1263] [CITED: product requirements §3.2] Recommendation: implement an explicit worker function callable from scanner/maintenance and expose counts in maintenance/tool responses. [ASSUMED]
4. **Mock LLM fixture shape:** Should tests mock the LLM client directly or use YAML managed LLM fixtures? What we know: core coverage must not require production LLM keys. [CITED: product requirements assumption 03] [CITED: product test plan §3] Recommendation: unit/integration tests should use injected fake clients; YAML scenario T-Y-003 should use mock/managed fixture behavior. [ASSUMED]

## Assumptions Log

| # | Claim | Risk if Wrong |
|---|---|---|
| A1 | Recommended new module names such as `src/graph/candidates.ts`, `src/graph/pending-edges.ts`, and graph LLM helper modules are proposed, not locked by existing code. [ASSUMED] | Planner may choose different file boundaries; implementation still succeeds if contracts and tests are preserved. |
| A2 | Deterministic in-process community fallback is preferable to adding a new package for Phase 173. [ASSUMED] | If user wants Leiden or another algorithm, planner must add package legitimacy and possibly broader algorithm tests. |
| A3 | `fqc_graph_maintenance_state` may not be sufficient for lint run history/list/prune and may need extension or a new table. [ASSUMED] | Bad storage choice can block `graph_lint_status limit` and prune semantics late in the phase. |
| A4 | Graph worker should be callable from scanner/maintenance rather than background scheduled session state. [ASSUMED] | If product intent is a different trigger, plan sequencing needs adjustment, but non-blocking write remains mandatory. |

## Sources

### Primary

- Product requirements: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md` - Phase 173 scope, requirements, invariants, data contracts, lint/community/maintenance contracts. [CITED]
- Product test plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md` - Phase 4-6 test IDs, filenames, scenarios, and coverage matrix. [CITED]
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` - GSD phase mapping and current state. [VERIFIED: codebase grep]
- Phase 171/172 contexts, research, plans, summaries, validation, and verification docs - shipped foundation and constraints. [VERIFIED: codebase grep]

### Codebase

- `src/embedding/chunks/scheduler.ts`, `src/embedding/chunks/store.ts`, `src/embedding/pending-worker.ts`, `src/services/scanner.ts`, `src/services/maintenance.ts`, `src/server/shutdown-state.ts`. [VERIFIED: codebase grep]
- `src/graph/*`, `src/mcp/tools/graph.ts`, `src/mcp/tools/compound.ts`, `src/mcp/tools/documents/get.ts`, `src/mcp/utils/document-connections.ts`, `src/mcp/utils/response-formats.ts`. [VERIFIED: codebase grep]
- `src/storage/supabase.ts`, `src/storage/schema-verify.ts`, `src/llm/json-repair.ts`, `src/llm/cost-tracker.ts`, `src/mcp/tools/llm-usage.ts`. [VERIFIED: codebase grep]
- Existing graph tests and scenario docs under `tests/unit`, `tests/integration/graph`, `tests/e2e`, `tests/scenarios/directed`, and `tests/scenarios/integration`. [VERIFIED: codebase grep]

## Metadata

**Confidence breakdown:**

- Shipped foundation: HIGH, because Phase 172 verification and current source files were read directly. [VERIFIED: 172-VERIFICATION.md] [VERIFIED: codebase grep]
- Implementation sequencing: HIGH, because product requirements explicitly split Phase 4 async processing before Phase 5 lifecycle/lint/community and Phase 6 hardening. [CITED: product requirements §8.6-§8.8]
- Community internals: MEDIUM, because the product spec allows fallback behavior and does not lock a concrete algorithm. [CITED: product requirements §6.6.2]
- Maintenance storage design: MEDIUM, because existing schema has maintenance state but not an obviously sufficient lint run-history/list/prune model. [VERIFIED: src/storage/supabase.ts:577] [ASSUMED]

**Research date:** 2026-06-24 [VERIFIED: environment context]  
**Valid until:** 2026-07-01 for planning details; re-check if Phase 173 source files change before implementation. [ASSUMED]
