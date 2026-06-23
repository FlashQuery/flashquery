# Roadmap: FlashQuery Core

## Milestones

- [ ] **v4.3 Graph Document Intelligence** - Phases 171-172 (active)
- [x] **v4.2 JSON Validation** - Phase 170 (shipped 2026-06-22)
- [x] **v4.1 Embedding Chunks Migration** - Phases 168-169 (shipped 2026-06-15)

## Current Milestone: v4.3 Graph Document Intelligence

**Goal:** Add optional graph intelligence for markdown documents: chunk-keyed graph nodes, deterministic structural edges, graph-aware retrieval surfaces, asynchronous LLM classification, graph maintenance/linting, communities, and public workflow coverage while preserving disabled-by-default behavior.

**Source split:**

- Phase 171 implements documented phases 1-3 from the source requirements: Config/Schema/Vocabulary, Tier 1 Structural Graph, and Read Surfaces.
- Phase 172 implements documented phases 4-6 from the source requirements: Tier 2/Tier 3 Async Processing, Lifecycle/Lint/Communities, and End-to-End Hardening.

## Phases

### Phase 171: Graph Foundation, Structural Graph, and Read Surfaces

**Goal:** Establish the optional graph substrate and expose deterministic graph reads without requiring Tier 3 LLM classification.

**Source phases covered:** 1-3

**Requirements:** GR-001, GR-002, GR-003, GR-004, GR-005, GR-006, GR-007, GR-008, GR-009, GR-013A, GR-014A, GR-016A, GR-017, GR-018, GR-019, GR-020A, GR-024A

**Plans:** 11 plans

Plans:
- [ ] 171-01-PLAN.md — Graph config, sidecars, and relation vocabulary
- [ ] 171-02-PLAN.md — Graph namespace template variables
- [ ] 171-03-PLAN.md — Graph schema DDL and verification, including full `fqc_graph_nodes` inventory
- [ ] 171-04-PLAN.md — Chunk-keyed structural graph helpers and stale marking
- [ ] 171-05-PLAN.md — `fq_processing` gates and structural graph processing wiring
- [ ] 171-06-PLAN.md — Graph query helpers, seeded community read-through, provenance, and status filters
- [ ] 171-07-PLAN.md — Public `query_graph` MCP registration, metadata, help, and integration coverage
- [ ] 171-08-PLAN.md — Graph-expanded search
- [ ] 171-09-PLAN.md — Graph-aware `get_document`
- [ ] 171-10-PLAN.md — Blocking schema verification and final focused validation
- [ ] 171-11-PLAN.md — Edge confidence and metadata validation

**Implementation scope:**

- Add disabled-by-default `graph:` config, cross-validation for embedding/model/purpose references, graph relation/prompt sidecar loading, and namespaced `graph:` template variables.
- Add graph schema DDL and verification for `fqc_graph_nodes`, `fqc_graph_edges`, `fqc_pending_edges`, and graph maintenance state.
- Add relation vocabulary semantics, edge metadata validation, confidence/reasoning model, and chunk-based graph node identity.
- Build deterministic structural `contains` and `references` edges from chunk hierarchy and markdown links, with unresolved-link diagnostics.
- Add `fq_processing` parsing and initial full/embedded/none behavior for structural graph writes.
- Register `query_graph`, graph-expanded `search`, and graph-aware `get_document` read surfaces with disabled/unsupported behavior and canonical response envelopes.

**Success criteria:**

1. Starting without `graph:` or with `graph.enabled:false` leaves current write/search/get-document behavior unchanged and does not mutate graph tables or enqueue graph work.
2. Graph-enabled startup validates config, sidecars, vocabulary, schema, and graph tool metadata before serving.
3. Markdown writes/scans create chunk-keyed graph nodes plus deterministic `contains` and `references` edges without LLM calls.
4. `query_graph` primitive/read actions, graph-expanded `search`, and graph-aware `get_document` return structured responses, expected errors, graph-disabled remediation, and bounded traversal behavior.
5. Unit and integration coverage from Test Plan sections 4.1-4.3 passes for config, vocabulary, schema, structural edges, query_graph, search expansion, get_document graph output, and provenance/question read shaping.

**Verification commands:**

- `npm test -- --run tests/unit/graph-config.test.ts tests/unit/graph-vocabulary.test.ts tests/unit/graph-prompts.test.ts tests/unit/reference-resolver-namespaces.test.ts tests/unit/graph-relations.test.ts tests/unit/graph-edge-validation.test.ts`
- `npm test -- --run tests/unit/graph-node-identity.test.ts tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts tests/unit/graph-staleness.test.ts tests/unit/graph-processing-level.test.ts`
- `npm test -- --run tests/unit/graph-query.test.ts tests/unit/graph-query-status-filter.test.ts tests/unit/graph-search-ranking.test.ts tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts`
- `npm run test:integration -- --run tests/integration/graph/graph-schema.test.ts tests/integration/graph/node-identity.test.ts tests/integration/graph/namespaced-template-vars.test.ts tests/integration/graph/structural-edges.test.ts tests/integration/graph/fq-processing.test.ts`
- `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts tests/integration/graph/get-document-graph.test.ts tests/integration/graph/search-graph-expansion.test.ts tests/integration/graph/provenance-question.test.ts`
- `python3 tests/scenarios/directed/run_suite.py --managed test_graph_structural_edges.py test_query_graph_public_surface.py`
- `python3 tests/scenarios/integration/run_integration.py --managed graph_search_expansion`

### Phase 172: Async Classification, Lifecycle, Lint, Communities, and Hardening

**Goal:** Complete graph intelligence with bounded async classification, lifecycle-aware maintenance, community/lint diagnostics, cost visibility, and public workflow hardening.

**Source phases covered:** 4-6

**Requirements:** GR-010, GR-011, GR-012, GR-013B, GR-014B, GR-015, GR-016B, GR-020B, GR-021, GR-022, GR-023, GR-024B

**Implementation scope:**

- Add Tier 2 similarity candidate selection over existing chunk embedding RPCs without storing similarity topology.
- Add durable pending edge jobs, graph worker retry/dead-letter behavior, shutdown/per-run limits, and remediation reporting.
- Add Tier 3 node analysis and edge classification with graph-specific Zod schemas, `parseLlmJson`, dependency gating, trace IDs, purpose/model usage records, and bounded cost controls.
- Complete stale-edge update/delete behavior after re-analysis.
- Complete `fq_processing` transitions, archive/missing/unarchive/hard-delete lifecycle semantics, and lifecycle-aware filtering in search, get_document, query_graph, provenance, and lint.
- Add `maintain_vault` graph actions: `graph_lint`, `graph_lint_status`, and `graph_lint_prune`.
- Add semantic lint categories for questions, provenance, contradictions, duplicates, communities, and integrity, including deltas, raw findings, duplicate edge propagation, and retention pruning.
- Add community detection/labeling from stored topology and expose community metadata through read surfaces.
- Land directed scenarios, integration YAML scenarios, E2E smoke tests, and coverage matrix updates for graph workflows.

**Success criteria:**

1. Candidate selection is instance-filtered, bounded, deterministic, and never persists semantic similarity edges as topology.
2. Tier 3 jobs analyze nodes before edges, validate all LLM JSON through `parseLlmJson`, record usage traces, and dead-letter after bounded retries.
3. Document writes return without waiting on graph LLM calls while graph worker output and tool responses surface skipped-work warnings and processing counts.
4. Archive, missing, unarchive, hard-delete, `fq_processing`, stale-edge, provenance, and lifecycle filtering behavior match the source requirements.
5. Graph lint returns persisted semantic categories with deltas, raw findings, community metadata, duplicate edge propagation details, and stored-status retrieval without rerunning lint.
6. E2E, directed, and YAML scenario coverage proves public workflows for structural graph, query_graph, graph search/get-document, archive staleness, processing levels, disabled/partial graph, mock LLM classification, and graph lint communities.

**Verification commands:**

- `npm test -- --run tests/unit/graph-candidates.test.ts tests/unit/graph-llm-analysis.test.ts tests/unit/graph-pending-worker.test.ts tests/unit/graph-cost-controls.test.ts`
- `npm test -- --run tests/unit/graph-lifecycle.test.ts tests/unit/graph-lint.test.ts tests/unit/graph-communities.test.ts`
- `npm run test:integration -- --run tests/integration/graph/candidate-selection.test.ts tests/integration/graph/pending-edge-worker.test.ts tests/integration/graph/llm-usage.test.ts`
- `npm run test:integration -- --run tests/integration/graph/archive-missing-lifecycle.test.ts tests/integration/graph/provenance-question.test.ts tests/integration/graph/graph-lint.test.ts tests/integration/graph/query-graph.test.ts`
- `npm test -- --run tests/e2e/graph-query.e2e.test.ts tests/e2e/graph-search-get-document.e2e.test.ts`
- `python3 tests/scenarios/directed/run_suite.py --managed graph`
- `python3 tests/scenarios/integration/run_integration.py --managed graph`
- `npm test`
- `npm run test:integration`

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 172. Async Classification, Lifecycle, Lint, Communities, and Hardening | v4.3 | 0/0 | Pending | - |
| 171. Graph Foundation, Structural Graph, and Read Surfaces | v4.3 | 0/5 | Pending | - |
| 170. JSON Validation and Repair Infrastructure | v4.2 | 4/4 | Complete | 2026-06-22 |
| 169. Lifecycle, Search, and Deployment Verification | v4.1 | 3/3 | Complete | 2026-06-15 |
| 168. Chunking Foundation and Write Pipeline | v4.1 | 4/4 | Complete | 2026-06-14 |

## Traceability

| Requirement | Phase |
|-------------|-------|
| GR-001 | 171 |
| GR-002 | 171 |
| GR-003 | 171 |
| GR-004 | 171 |
| GR-005 | 171 |
| GR-006 | 171 |
| GR-007 | 171 |
| GR-008 | 171 |
| GR-009 | 171 |
| GR-013A | 171 |
| GR-014A | 171 |
| GR-016A | 171 |
| GR-017 | 171 |
| GR-018 | 171 |
| GR-019 | 171 |
| GR-020A | 171 |
| GR-024A | 171 |
| GR-010 | 172 |
| GR-011 | 172 |
| GR-012 | 172 |
| GR-013B | 172 |
| GR-014B | 172 |
| GR-015 | 172 |
| GR-016B | 172 |
| GR-020B | 172 |
| GR-021 | 172 |
| GR-022 | 172 |
| GR-023 | 172 |
| GR-024B | 172 |

## Archived Milestone Details

- [v4.2 ROADMAP archive](milestones/v4.2-ROADMAP.md)
- [v4.2 REQUIREMENTS archive](milestones/v4.2-REQUIREMENTS.md)
- [v4.2 milestone audit](milestones/v4.2-MILESTONE-AUDIT.md)
- [v4.2 phase artifacts](milestones/v4.2-phases/)
- [v4.1 ROADMAP archive](milestones/v4.1-ROADMAP.md)
- [v4.1 REQUIREMENTS archive](milestones/v4.1-REQUIREMENTS.md)
- [v4.1 milestone audit](milestones/v4.1-MILESTONE-AUDIT.md)
- [v4.0 ROADMAP archive](milestones/v4.0-ROADMAP.md)
- [v4.0 REQUIREMENTS archive](milestones/v4.0-REQUIREMENTS.md)
- [v4.0 milestone audit](milestones/v4.0-MILESTONE-AUDIT.md)

## Carried Tech Debt

- v4.0 accepted tech debt remains tracked: lifecycle abort marks a job aborted immediately and releases the status-based running lock before worker checkpoint return is externally proven.
- v4.1 documented v1 deferrals: `matched_chunks[].span_start`/`span_end` ship as always-null placeholders; operator-configurable `max_heading_level` deferred.

---
*Last updated: 2026-06-23 after starting v4.3 Graph Document Intelligence*
