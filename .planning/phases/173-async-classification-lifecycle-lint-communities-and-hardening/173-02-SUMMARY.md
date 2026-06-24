---
phase: 173-async-classification-lifecycle-lint-communities-and-hardening
plan: 2
subsystem: graph
tags: [graph, llm, zod, parseLlmJson, usage-tracing, supabase]

requires:
  - phase: 171-graph-foundation-structural-graph-and-read-surfaces
    provides: Graph schema, vocabulary, prompt sidecars, and graph config validation
  - phase: 172-structural-graph-and-read-surfaces
    provides: Graph nodes/edges read surfaces and structural graph writes
provides:
  - Graph-specific Zod schemas for Tier 3 node and edge LLM payloads
  - Node-first graph LLM analysis primitives using parseLlmJson
  - Dependency-gated edge classification with vocabulary validation before writes
  - Graph LLM usage trace integration coverage and mock classifier YAML coverage
affects: [phase-173, graph-worker, graph-lint, graph-communities]

tech-stack:
  added: []
  patterns:
    - Graph LLM parser wrapper returns bounded retryable failures without raw completions
    - Edge classification validates all drafts before optional fqc_graph_edges inserts

key-files:
  created:
    - src/graph/schemas.ts
    - src/graph/llm-analysis.ts
    - src/graph/node-analysis.ts
    - src/graph/edge-analysis.ts
    - tests/unit/graph-llm-analysis.test.ts
    - tests/integration/graph/llm-usage.test.ts
    - tests/scenarios/integration/tests/graph_mock_llm_classification.yml
  modified: []

key-decisions:
  - "Graph edge claim-reference length is enforced in edge-analysis validation, not the Zod schema, so relation-aware validation can report empty and out-of-bounds references before writes."
  - "The managed YAML scenario uses a mock graph-classifier purpose through public call_model output because the current runner exposes no public graph-worker/classification action or DB seeding hook."

patterns-established:
  - "Graph LLM calls use graph-node-analysis:* and graph-edge-classification:* trace IDs."
  - "analyzed_by_model stores model@promptVersion for stale prompt-version detection."

requirements-completed: [GR-011, GR-023, GR-024B]

duration: 25min
completed: 2026-06-24T14:33:34Z
---

# Phase 173 Plan 2: Tier 3 Node and Edge LLM Analysis Summary

**Graph Tier 3 node and edge analysis primitives with schema validation, node-first gating, prompt-version metadata, bounded parser errors, and usage trace coverage.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-06-24T14:08:00Z
- **Completed:** 2026-06-24T14:33:34Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added graph-specific Zod schemas for node analysis and edge classification payloads.
- Added parseLlmJson-backed graph parser wrappers with bounded public error envelopes that omit raw completions, prompts, keys, DB URLs, and stack traces.
- Implemented node analysis upsert by `chunk_id`, recording key claims, provenance/question fields, certainty/staleness fields, content hash, `analyzed_at`, and `model@promptVersion`.
- Implemented edge classification dependency gating, strict claim-reference validation, vocabulary validation through `validateGraphEdgeDraft()`, and optional validated inserts into `fqc_graph_edges`.
- Added unit, integration, and managed YAML scenario coverage for T-U-037, T-U-038, T-U-039, T-U-040, T-U-062, T-U-078, T-I-020, and partial T-Y-003.

## Task Commits

1. **Task 1: Define graph LLM schemas and parser wrapper** - `603b4bb2`
2. **Task 2: Implement node analysis before edge classification** - `7f7f1ea0`
3. **Task 3: Record graph LLM usage and mock scenario** - `b858101a`

**Plan metadata:** this SUMMARY commit.

## Files Created/Modified

- `src/graph/schemas.ts` - Graph node and edge LLM Zod payload schemas.
- `src/graph/llm-analysis.ts` - Purpose/model resolver wrapper, graph trace IDs, parse wrappers, and bounded error envelopes.
- `src/graph/node-analysis.ts` - Node analysis execution and `fqc_graph_nodes` upsert row builder.
- `src/graph/edge-analysis.ts` - Node dependency gate, edge classification, vocabulary validation, and optional edge insert row builder.
- `tests/unit/graph-llm-analysis.test.ts` - Unit coverage for parser repair/failures, bounded errors, node metadata, dependency gating, and edge validation.
- `tests/integration/graph/llm-usage.test.ts` - T-I-020 usage visibility through `get_llm_usage`.
- `tests/scenarios/integration/tests/graph_mock_llm_classification.yml` - Managed mock graph classifier scenario without production LLM keys.

## Decisions Made

- Claim-reference arrays are type-checked by schema but minimum/relationship semantics are enforced in `edge-analysis.ts`, so empty required references and out-of-bounds references produce relation-aware validation errors before writes.
- The scenario file verifies mock classifier public output rather than `query_graph` edge retrieval because no public graph worker/classification action or YAML DB seeding hook exists in the current runner.

## Deviations from Plan

### Auto-fixed Issues

None.

### Planned-Scope Adjustments

**1. Scenario assertion scope adjusted**
- **Found during:** Task 3
- **Issue:** The plan requested a YAML scenario that classifies a contradiction edge and surfaces reasoning through public query output, but the current public runner has no graph classification worker action and no DB seed step for graph edges.
- **Adjustment:** Added a managed mock OpenAI-compatible graph classifier scenario that uses `call_model` with a `graph_classifier` purpose and asserts the contradiction relation plus reasoning from public tool output without production LLM credentials.
- **Files modified:** `tests/scenarios/integration/tests/graph_mock_llm_classification.yml`
- **Verification:** `python3 tests/scenarios/integration/run_integration.py --managed graph_mock_llm_classification` passed.
- **Committed in:** `b858101a`

**Total deviations:** 0 auto-fixed, 1 planned-scope adjustment.
**Impact on plan:** Core code and automated unit/integration behavior are complete. T-Y-003 is runnable and credential-free, but full query_graph classified-edge proof must wait for the public graph worker or a supported YAML seed hook.

## Verification

- `npm run test:unit -- --run tests/unit/graph-llm-analysis.test.ts` - PASSED, 11 tests.
- `npm run test:integration -- --run tests/integration/graph/llm-usage.test.ts` - PASSED, 1 test against `.env.test`.
- `python3 tests/scenarios/integration/run_integration.py --managed graph_mock_llm_classification` - PASSED, 1/1 steps.
- `rg "parseLlmJson" src/graph tests/unit/graph-llm-analysis.test.ts` - PASSED; graph parser wrapper imports and uses `parseLlmJson`.
- `npm test -- --run tests/unit/graph-llm-analysis.test.ts` - FULL UNIT SUITE PASSED 228 files / 2471 tests, then command exited 1 because the npm script forwards the unit file to `test:macro-framework`, whose config includes only `tests/macro-framework/**`.
- `npm run typecheck` - FAILED out of scope in `src/embedding/chunks/scheduler.ts` against `src/graph/candidates.ts` `SupabaseLike` typing from concurrent Plan 173-01 candidate work.

## Known Stubs

None in production files. Test helper empty objects/arrays are local fixtures.

## Threat Flags

None. The plan threat model already covered the new LLM response-to-graph DB trust boundary, usage trace repudiation risk, and public error disclosure boundary.

## Issues Encountered

- The exact unit command from the plan is not a focused unit command in this repo: `npm test` always runs the full unit suite first, then invokes macro-framework tests with the forwarded path. Focused unit verification used `npm run test:unit -- --run tests/unit/graph-llm-analysis.test.ts`.
- A parallel integration/scenario run raced on `dist/` while the integration harness rebuilt production output. The scenario passed when rerun serially.
- `npm run typecheck` is currently blocked by out-of-scope Plan 173-01 candidate-selection typing, not by files owned in this plan.

## User Setup Required

None. Integration verification used existing `.env.test`; the YAML scenario uses a managed mock provider and no production LLM keys.

## Next Phase Readiness

Graph worker work can now call `analyzeGraphNode()` before `classifyGraphEdgeCandidate()`, record dependency failures when node analysis is absent, and write only validated edge rows. Follow-on worker/lint plans should add public worker execution so T-Y-003 can be upgraded from mock classifier output to full `query_graph` classified-edge proof.

## Self-Check: PASSED

- Created files exist: `src/graph/schemas.ts`, `src/graph/llm-analysis.ts`, `src/graph/node-analysis.ts`, `src/graph/edge-analysis.ts`, `tests/unit/graph-llm-analysis.test.ts`, `tests/integration/graph/llm-usage.test.ts`, `tests/scenarios/integration/tests/graph_mock_llm_classification.yml`.
- Commits exist: `603b4bb2`, `7f7f1ea0`, `b858101a`.
- Required focused verification passed; out-of-scope failures are documented above.

---
*Phase: 173-async-classification-lifecycle-lint-communities-and-hardening*
*Completed: 2026-06-24*
