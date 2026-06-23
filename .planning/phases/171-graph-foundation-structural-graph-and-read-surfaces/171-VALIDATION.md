---
phase: 171
slug: graph-foundation-structural-graph-and-read-surfaces
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-23
---

# Phase 171 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for unit/integration/e2e; Python scenario runners for directed/YAML scenarios |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- --run <graph unit files>` |
| **Full suite command** | `npm test` plus graph-specific `npm run test:integration -- --run ...` commands from `.planning/ROADMAP.md` |
| **Estimated runtime** | ~30-180 seconds for focused unit groups; integration runtime depends on `.env.test` Supabase availability |

---

## Sampling Rate

- **After every task commit:** Run the focused unit file(s) for the edited graph module.
- **After every plan wave:** Run all Phase 171 unit commands listed in `.planning/ROADMAP.md`.
- **Before `$gsd-verify-work`:** Run graph integration commands from `.planning/ROADMAP.md`; run full `npm test`; run full `npm run test:integration` when `.env.test` is configured.
- **Max feedback latency:** 180 seconds for focused feedback.

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| GR-001 | Disabled graph no-op and unsupported discoverability | unit + YAML | `npm test -- --run tests/unit/graph-config.test.ts`; `python3 tests/scenarios/integration/run_integration.py --managed graph_disabled_noop` | W0 | pending |
| GR-002 | Graph config cross-validation | unit | `npm test -- --run tests/unit/graph-config.test.ts` | W0 | pending |
| GR-003 | Vocabulary and prompt sidecars | unit | `npm test -- --run tests/unit/graph-vocabulary.test.ts tests/unit/graph-prompts.test.ts` | W0 | pending |
| GR-004 | Namespaced template variables | unit + integration | `npm test -- --run tests/unit/reference-resolver-namespaces.test.ts`; `npm run test:integration -- --run tests/integration/graph/namespaced-template-vars.test.ts` | W0 | pending |
| GR-005 | Graph schema, including full `fqc_graph_nodes` inventory from Spec §6.2.1 AC2 / T-I-044 | integration | `npm run test:integration -- --run tests/integration/graph/graph-schema.test.ts` | W0 | pending |
| GR-006 | Chunk-based node identity | unit + integration | `npm test -- --run tests/unit/graph-node-identity.test.ts`; `npm run test:integration -- --run tests/integration/graph/node-identity.test.ts` | W0 | pending |
| GR-007 | Relation vocabulary semantics | unit | `npm test -- --run tests/unit/graph-relations.test.ts` | W0 | pending |
| GR-008 | Edge confidence and metadata validation | unit | `npm test -- --run tests/unit/graph-edge-validation.test.ts` | W0 | pending |
| GR-009 | Structural contains/references edges plus T-S-001 public structural workflow | unit + integration + directed scenario | `npm test -- --run tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts`; `npm run test:integration -- --run tests/integration/graph/structural-edges.test.ts`; `python3 tests/scenarios/directed/run_suite.py --managed test_graph_structural_edges.py` | W0 | pending |
| GR-013A | Staleness and nonblocking Tier 1 behavior | unit | `npm test -- --run tests/unit/graph-staleness.test.ts` | W0 | pending |
| GR-014A | `fq_processing` full/embedded/none gates | unit + integration | `npm test -- --run tests/unit/graph-processing-level.test.ts`; `npm run test:integration -- --run tests/integration/graph/fq-processing.test.ts` | W0 | pending |
| GR-016A | Surface-specific inactive filtering | unit | `npm test -- --run tests/unit/graph-query-status-filter.test.ts` | W0 | pending |
| GR-017 | `query_graph` read actions plus T-S-002 public MCP surface workflow | unit + integration + directed scenario | `npm test -- --run tests/unit/graph-query.test.ts`; `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts`; `python3 tests/scenarios/directed/run_suite.py --managed test_query_graph_public_surface.py` | W0 | pending |
| GR-018 | Search graph expansion plus T-Y-002 YAML workflow | unit + integration + YAML scenario | `npm test -- --run tests/unit/graph-search-ranking.test.ts`; `npm run test:integration -- --run tests/integration/graph/search-graph-expansion.test.ts`; `python3 tests/scenarios/integration/run_integration.py --managed graph_search_expansion` | W0 | pending |
| GR-019 | `get_document` graph output | integration | `npm run test:integration -- --run tests/integration/graph/get-document-graph.test.ts` | W0 | pending |
| GR-020A | Provenance and question read shaping | unit + integration | `npm test -- --run tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts`; `npm run test:integration -- --run tests/integration/graph/provenance-question.test.ts` | W0 | pending |
| GR-024A | Canonical graph envelopes | unit + integration | Covered by `graph-query`, `search-graph-expansion`, `get-document-graph`, and disabled/noop tests | W0 | pending |

---

## Wave 0 Requirements

- [ ] `tests/unit/graph-config.test.ts` - covers GR-001 and GR-002.
- [ ] `tests/unit/graph-vocabulary.test.ts` - covers GR-003 and GR-007.
- [ ] `tests/unit/graph-prompts.test.ts` - covers GR-003.
- [ ] `tests/unit/reference-resolver-namespaces.test.ts` - covers GR-004.
- [ ] `tests/unit/graph-edge-validation.test.ts` - covers GR-008.
- [ ] `tests/unit/graph-node-identity.test.ts` - covers GR-006.
- [ ] `tests/unit/graph-structural.test.ts`, `tests/unit/graph-link-resolver.test.ts`, `tests/unit/graph-staleness.test.ts`, and `tests/unit/graph-processing-level.test.ts` - cover structural graph and processing gates.
- [ ] `tests/unit/graph-query.test.ts`, `tests/unit/graph-query-status-filter.test.ts`, `tests/unit/graph-search-ranking.test.ts`, `tests/unit/graph-question-lifecycle.test.ts`, and `tests/unit/graph-provenance.test.ts` - cover read surfaces.
- [ ] `tests/integration/graph/graph-schema.test.ts` explicitly covers T-I-044 full initial `fqc_graph_nodes` column inventory.
- [ ] `tests/integration/graph/node-identity.test.ts` explicitly covers graph node identity integration.
- [ ] `tests/integration/graph/` test files listed in `.planning/ROADMAP.md` - cover schema, node identity, structural writes, namespaced variables, `fq_processing`, `query_graph`, search expansion, get-document graph output, provenance, and question reads.
- [ ] `tests/scenarios/directed/testcases/test_graph_structural_edges.py` explicitly covers T-S-001 public structural graph workflow.
- [ ] `tests/scenarios/directed/testcases/test_query_graph_public_surface.py` explicitly covers T-S-002 public `query_graph` workflow.
- [ ] `tests/scenarios/integration/tests/graph_search_expansion.yml` explicitly covers T-Y-002 graph search expansion YAML workflow.

---

## Manual-Only Verifications

All Phase 171 behaviors have automated verification targets. T-S-001, T-S-002, and T-Y-002 scenario coverage are Phase 171 targets; broader public workflow hardening scenarios remain Phase 172 scope.

---

## Validation Sign-Off

- [x] All Phase 171 requirements have automated verification targets.
- [x] Sampling continuity requires focused tests after every task and phase-specific commands after every wave.
- [x] Wave 0 identifies all currently missing graph test files.
- [x] No watch-mode flags are used.
- [x] Feedback latency target is less than 180 seconds for focused test groups.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
