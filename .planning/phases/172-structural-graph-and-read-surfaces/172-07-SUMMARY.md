---
phase: 172-structural-graph-and-read-surfaces
plan: 07
subsystem: testing
tags: [graph, structural-edges, query-graph, search, get-document, scenarios]

requires:
  - phase: 172-02
    provides: fq_processing graph gates
  - phase: 172-04
    provides: public query_graph read surface
  - phase: 172-05
    provides: graph-expanded search
  - phase: 172-06
    provides: graph-aware get_document and provenance/question reads
provides:
  - Final Phase 172 command evidence for structural graph and read surfaces
  - Unit, integration, directed scenario, and YAML scenario verification outcomes
  - Truthful record of npm test wrapper behavior for focused unit commands
affects: [phase-172, phase-173, graph-document-intelligence]

tech-stack:
  added: []
  patterns:
    - Verification-only GSD summary with exact command outcomes
    - Focused Vitest evidence recorded separately when npm wrapper command broadens/fails after passing unit suite

key-files:
  created:
    - .planning/phases/172-structural-graph-and-read-surfaces/172-07-SUMMARY.md
  modified: []

key-decisions:
  - "Recorded exact npm test wrapper failures and added focused npm run test:unit equivalent evidence instead of editing product code."
  - "Reused the fresh Task 1 integration run for Task 2's identical prerequisite integration command."

patterns-established:
  - "Final verification summaries must separate exact command exit status from supplemental focused evidence."

requirements-completed: [GR-006, GR-009, GR-013A, GR-014A, GR-016A, GR-017, GR-018, GR-019, GR-020A, GR-024A]

duration: 16m22s
completed: 2026-06-24
---

# Phase 172 Plan 07: Final Verification Evidence Summary

**Structural graph and graph read-surface verification evidence across unit, integration, directed, and YAML scenario layers**

## Performance

- **Duration:** 16m22s
- **Started:** 2026-06-24T04:25:10Z
- **Completed:** 2026-06-24T04:41:32Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Verified live Supabase integration coverage for node identity, structural edges, `fq_processing`, `query_graph`, `get_document`, search graph expansion, and provenance/question reads.
- Verified T-S-001 and T-S-002 directed public workflows.
- Verified T-Y-002 YAML graph search expansion workflow.
- Recorded exact focused unit command behavior, including the repo-level `npm test` wrapper failure after full unit success.

## Command Evidence

| Area | Command | Exit | Outcome |
| --- | --- | ---: | --- |
| Integration prerequisite | `npm run test:integration -- --run tests/integration/graph/node-identity.test.ts tests/integration/graph/structural-edges.test.ts tests/integration/graph/fq-processing.test.ts` | 0 | PASS: 3 files passed, 4 tests passed, duration 119.38s. Live `.env.test` Supabase credentials were present; schema verification reported all 12 required tables present. No skips. |
| Unit exact command 1 | `npm test -- --run tests/unit/graph-node-identity.test.ts tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts tests/unit/graph-staleness.test.ts tests/unit/graph-processing-level.test.ts` | 1 | FAIL at wrapper level: `test:unit` first passed 226 files / 2450 tests, then `test:macro-framework` received the graph unit file filters and exited with `No test files found`. |
| Unit focused equivalent 1 | `npm run test:unit -- --run tests/unit/graph-node-identity.test.ts tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts tests/unit/graph-staleness.test.ts tests/unit/graph-processing-level.test.ts` | 0 | PASS: 5 files passed, 15 tests passed, duration 1.21s. |
| Unit exact command 2 | `npm test -- --run tests/unit/graph-query.test.ts tests/unit/graph-query-status-filter.test.ts tests/unit/graph-search-ranking.test.ts tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts` | 1 | FAIL at wrapper level: `test:unit` first passed 226 files / 2450 tests, then `test:macro-framework` received the graph unit file filters and exited with `No test files found`. |
| Unit focused equivalent 2 | `npm run test:unit -- --run tests/unit/graph-query.test.ts tests/unit/graph-query-status-filter.test.ts tests/unit/graph-search-ranking.test.ts tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts` | 0 | PASS: 5 files passed, 11 tests passed, duration 1.66s. Includes `graph-query-status-filter.test.ts`. |
| Integration prerequisite repeated in Task 2 | `npm run test:integration -- --run tests/integration/graph/node-identity.test.ts tests/integration/graph/structural-edges.test.ts tests/integration/graph/fq-processing.test.ts` | 0 | PASS: reused the fresh identical Task 1 run above. Includes `node-identity.test.ts`. |
| Integration read surfaces | `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts tests/integration/graph/get-document-graph.test.ts tests/integration/graph/search-graph-expansion.test.ts tests/integration/graph/provenance-question.test.ts` | 0 | PASS: 4 files passed, 11 tests passed, duration 384.21s. Live `.env.test` Supabase credentials were present; no skips. |
| Directed scenarios | `python3 tests/scenarios/directed/run_suite.py --managed test_graph_structural_edges.py test_query_graph_public_surface.py` | 0 | PASS: 2/2 tests passed. `test_graph_structural_edges` 5/5 steps in 1m 6.7s; `test_query_graph_public_surface` 5/5 steps in 1m 28.8s. Report: `tests/scenarios/directed/reports/scenario-report-2026-06-24-014009.md` (ignored generated artifact). |
| YAML scenario | `python3 tests/scenarios/integration/run_integration.py --managed graph_search_expansion` | 0 | PASS: 1/1 test passed. `graph_search_expansion` 4/4 steps in 63198ms. Report: `tests/scenarios/integration/reports/integration-report-2026-06-24-014122.md` (ignored generated artifact). |

## Test Plan Coverage

- **T-U-019/T-U-020:** Covered by `tests/unit/graph-node-identity.test.ts` focused pass.
- **T-U-021/T-U-022/T-U-023/T-U-024/T-U-070/T-U-071:** Covered by structural/link resolver focused pass.
- **T-U-025/T-U-026/T-U-027:** Covered by staleness and `fq_processing` focused pass.
- **T-U-028/T-U-029/T-U-030/T-U-060/T-U-061/T-U-069:** Covered by graph query, status-filter, and search-ranking focused pass.
- **T-U-031/T-U-032:** Covered by question lifecycle and provenance focused pass.
- **T-I-005/T-I-006/T-I-007:** Covered by prerequisite integration pass.
- **T-I-008/T-I-010/T-I-011/T-I-012/T-I-013/T-I-014/T-I-015/T-I-016/T-I-017/T-I-026/T-I-027/T-I-029/T-I-030/T-I-031/T-I-032/T-I-033/T-I-036/T-I-037/T-I-038/T-I-039/T-I-042:** Covered by read-surface integration pass.
- **T-S-001/T-S-002:** Covered by directed scenario pass.
- **T-Y-002:** Covered by YAML integration scenario pass.

## Task Commits

1. **Task 1: Run structural/read integration prerequisite verification** - no implementation commit; evidence recorded here.
2. **Task 2: Run focused Phase 172 verification suite** - no implementation commit; evidence recorded here.

**Plan metadata:** this summary commit.

## Files Created/Modified

- `.planning/phases/172-structural-graph-and-read-surfaces/172-07-SUMMARY.md` - Final verification evidence.

## Decisions Made

- Did not edit product/source/test implementation. The only failing exact commands were `npm test -- --run ...` wrapper failures caused by `package.json` running `test:unit && test:macro-framework`; focused `npm run test:unit -- --run ...` equivalents passed the intended graph unit files.
- Did not treat Phase 173-only Tier 2/Tier 3 worker hardening, lint/community maintenance, full E2E hardening, or graph visualization as Phase 172 blockers.
- Did not commit generated scenario report files because reports are ignored artifacts and plan ownership is limited to this summary.

## Deviations from Plan

### Verification Deviations

**1. Exact unit commands failed after successful unit suite due npm wrapper behavior**
- **Found during:** Task 2
- **Issue:** The plan specified `npm test -- --run ...`. In this repo, `npm test` runs `npm run test:unit && npm run test:macro-framework`. The graph unit filters are passed to the macro-framework command, whose include set only covers `tests/macro-framework/**`, so it exits `1` with `No test files found`.
- **Fix:** No product code was changed. Recorded the exact command failures and ran focused equivalent `npm run test:unit -- --run ...` commands for the intended files.
- **Files modified:** `.planning/phases/172-structural-graph-and-read-surfaces/172-07-SUMMARY.md`
- **Verification:** Focused unit group 1 passed 5 files / 15 tests; focused unit group 2 passed 5 files / 11 tests.
- **Committed in:** this summary commit

**Total deviations:** 1 verification deviation, 0 auto-fixed code deviations.
**Impact on plan:** Phase 172 behavior evidence is present and passing at the intended focused layers. The exact repo-level unit wrapper commands remain non-zero and are recorded truthfully.

## Issues Encountered

- Live integration commands were slow because several integration files build and verify schema independently against Supabase. All live integration commands exited 0.
- No `.env.test` skip occurred; `.env.test` was available and tests used live Supabase/Postgres credentials. Output redacted DB credentials in logs.

## Known Stubs

None found in the created summary. Product/source/test files were not edited.

## Threat Flags

None. This plan created a summary only and introduced no new network endpoints, auth paths, file access patterns, or schema changes.

## User Setup Required

None.

## Next Phase Readiness

Phase 172 has final structural/read-surface evidence for node identity integration, graph query status filtering, T-S-001, T-S-002, and T-Y-002. Phase 173 can proceed with async classification, lifecycle/lint/community maintenance, and broader hardening.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/172-structural-graph-and-read-surfaces/172-07-SUMMARY.md`.
- Summary commit exists in git history.
- No `.planning/STATE.md` or `.planning/ROADMAP.md` updates were made.

---
*Phase: 172-structural-graph-and-read-surfaces*
*Completed: 2026-06-24*
