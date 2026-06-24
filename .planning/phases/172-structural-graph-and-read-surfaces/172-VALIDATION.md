---
phase: 172
slug: structural-graph-and-read-surfaces
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-23
---

# Phase 172 - Validation Strategy

> Per-phase validation contract for deterministic structural graph writes and graph read surfaces.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration; Python scenario runners for directed/YAML scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- --run <structural/read unit files>` |
| **Full suite command** | Phase 172 verification commands from `.planning/ROADMAP.md` |
| **Estimated runtime** | ~30-180 seconds for focused unit groups; integration/scenario runtime depends on `.env.test` and scenario fixtures |

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| GR-006 | Chunk-based node identity | unit + integration | `npm test -- --run tests/unit/graph-node-identity.test.ts`; `npm run test:integration -- --run tests/integration/graph/node-identity.test.ts` | W0 | passed |
| GR-009 | Structural contains/references edges plus T-S-001 public structural workflow | unit + integration + directed scenario | `npm test -- --run tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts`; `npm run test:integration -- --run tests/integration/graph/structural-edges.test.ts`; `python3 tests/scenarios/directed/run_suite.py --managed test_graph_structural_edges.py` | W0 | passed |
| GR-013A | Staleness and nonblocking Tier 1 behavior | unit | `npm test -- --run tests/unit/graph-staleness.test.ts` | W0 | passed |
| GR-014A | `fq_processing` full/embedded/none gates | unit + integration | `npm test -- --run tests/unit/graph-processing-level.test.ts`; `npm run test:integration -- --run tests/integration/graph/fq-processing.test.ts` | W0 | passed |
| GR-016A | Surface-specific inactive filtering | unit | `npm test -- --run tests/unit/graph-query-status-filter.test.ts` | W0 | passed |
| GR-017 | `query_graph` read actions plus T-S-002 public MCP surface workflow | unit + integration + directed scenario | `npm test -- --run tests/unit/graph-query.test.ts`; `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts`; `python3 tests/scenarios/directed/run_suite.py --managed test_query_graph_public_surface.py` | W0 | passed |
| GR-018 | Search graph expansion plus T-Y-002 YAML workflow | unit + integration + YAML scenario | `npm test -- --run tests/unit/graph-search-ranking.test.ts`; `npm run test:integration -- --run tests/integration/graph/search-graph-expansion.test.ts`; `python3 tests/scenarios/integration/run_integration.py --managed graph_search_expansion` | W0 | passed |
| GR-019 | `get_document` graph output | integration | `npm run test:integration -- --run tests/integration/graph/get-document-graph.test.ts` | W0 | passed |
| GR-020A | Provenance and question read shaping | unit + integration | `npm test -- --run tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts`; `npm run test:integration -- --run tests/integration/graph/provenance-question.test.ts` | W0 | passed |
| GR-024A | Canonical graph envelopes | unit + integration + scenarios | Covered by `graph-query`, `search-graph-expansion`, `get-document-graph`, disabled/noop, T-S-001, T-S-002, and T-Y-002 tests | W0 | passed |

---

## Wave 0 Requirements

- [x] `tests/unit/graph-node-identity.test.ts` - covers GR-006.
- [x] `tests/unit/graph-structural.test.ts`, `tests/unit/graph-link-resolver.test.ts`, `tests/unit/graph-staleness.test.ts`, and `tests/unit/graph-processing-level.test.ts` - cover structural graph and processing gates.
- [x] `tests/unit/graph-query.test.ts`, `tests/unit/graph-query-status-filter.test.ts`, `tests/unit/graph-search-ranking.test.ts`, `tests/unit/graph-question-lifecycle.test.ts`, and `tests/unit/graph-provenance.test.ts` - cover read surfaces.
- [x] `tests/integration/graph/node-identity.test.ts`, `tests/integration/graph/structural-edges.test.ts`, `tests/integration/graph/fq-processing.test.ts`, `tests/integration/graph/query-graph.test.ts`, `tests/integration/graph/get-document-graph.test.ts`, `tests/integration/graph/search-graph-expansion.test.ts`, and `tests/integration/graph/provenance-question.test.ts`.
- [x] `tests/scenarios/directed/testcases/test_graph_structural_edges.py` explicitly covers T-S-001 public structural graph workflow.
- [x] `tests/scenarios/directed/testcases/test_query_graph_public_surface.py` explicitly covers T-S-002 public `query_graph` workflow.
- [x] `tests/scenarios/integration/tests/graph_search_expansion.yml` explicitly covers T-Y-002 graph search expansion YAML workflow.

---

## Manual-Only Verifications

All Phase 172 behaviors have automated verification targets. Tier 2/Tier 3 async classification, lifecycle/lint/community maintenance, and broad hardening scenarios are Phase 173 targets.

---

## Validation Sign-Off

- [x] All Phase 172 requirements have automated verification targets.
- [x] Sampling continuity requires focused tests after every task and phase-specific commands after every wave.
- [x] Wave 0 identifies all currently missing structural/read-surface test files.
- [x] No watch-mode flags are used.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-24

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Requirements mapped | 10 |
| Automated coverage targets | 10 |
| Gaps found | 0 |
| Resolved | 10 |
| Manual-only | 0 |

Focused close-out reruns passed after review fixes:

- `npm run typecheck`
- `npm run test:unit -- --run tests/unit/document-output.test.ts tests/unit/graph-link-resolver.test.ts tests/unit/graph-search-ranking.test.ts tests/unit/graph-processing-level.test.ts`
- `npm run test:integration -- --run tests/integration/graph/fq-processing.test.ts tests/integration/graph/get-document-graph.test.ts`
- `npm run build`
- `npm test`
