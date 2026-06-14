---
phase: 168-chunking-foundation-and-write-pipeline
plan: 04
subsystem: embedding
tags: [chunks, documents, scanner, scenarios, embeddings]

requires:
  - 168-01
  - 168-02
  - 168-03
provides:
  - Document write/create/update chunk diff scheduling
  - Document copy chunk diff scheduling
  - Scanner chunk drain/discovery scheduling
  - Compound/document-output chunk scheduling path
  - Directed public chunk write and heading rename scenarios
affects: [phase-168-complete, phase-169-search-lifecycle]

tech-stack:
  added: []
  patterns:
    - Shared `scheduleChangedDocumentChunks` wrapper around chunk diffing plus active-entry scheduling
    - Public write paths schedule only new/changed chunks
    - Scanner drain now treats missing `fqc_chunks` rows as the document semantic backlog

key-files:
  created:
    - src/embedding/chunks/scheduler.ts
    - tests/integration/embedding/chunk-write-roundtrip.test.ts
    - tests/scenarios/directed/testcases/test_chunk_write_roundtrip.py
    - tests/scenarios/directed/testcases/test_chunk_heading_rename.py
  modified:
    - src/mcp/tools/documents/write.ts
    - src/mcp/tools/documents/copy.ts
    - src/mcp/tools/documents/helpers.ts
    - src/mcp/tools/compound.ts
    - src/services/scanner.ts

key-decisions:
  - "Document mutations no longer schedule whole-document semantic embeddings; they persist chunks and schedule `document_chunk` targets."
  - "Scanner drain no longer looks for NULL document vectors; it finds active documents with no chunk rows."
  - "Phase 168 scenarios verify chunk rows/RPC-visible metadata directly, without implementing Phase 169 `matched_chunks` aggregation."

patterns-established:
  - "Call sites pass frontmatter-stripped body, title, document path, document id, and instance config into the shared chunk scheduler."
  - "`embedding_deferred:<name>` warnings are preserved from chunk scheduling results."

requirements-completed:
  - REQ-CHUNK-009
  - REQ-CHUNK-010

duration: 21min
completed: 2026-06-14
---

# Phase 168 Plan 04: Document Write Chunk Wiring Summary

**Public document mutations now populate `fqc_chunks`, remove stale chunk rows, and schedule only changed chunks for embedding**

## Performance

- **Duration:** 21 min
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Added `scheduleChangedDocumentChunks` to combine parser-backed chunk diffing with per-active-entry `document_chunk` scheduling.
- Replaced whole-document embedding scheduling in `write_document` create/update and `copy_document`.
- Routed compound document mutation paths and document-output helper scheduling through the shared chunk scheduler.
- Updated scanner content-change/discovery and drain behavior to populate chunks and schedule changed chunks.
- Added integration coverage for create, body-only update, heading rename orphan cleanup, copy, and scanner discovery.
- Added directed public workflow scenarios D-chunk-1/T-A-001 and D-chunk-2/T-A-002.

## Task Commits

1. **Task 1: Wire public document write and copy flows** - committed with this summary close-out
2. **Task 2: Wire scanner, compound, and document-output paths** - committed with this summary close-out
3. **Task 3: Add directed public workflow scenarios** - committed with this summary close-out

## Files Created/Modified

- `src/embedding/chunks/scheduler.ts` - Shared chunk diff plus changed-chunk scheduling wrapper.
- `src/mcp/tools/documents/write.ts` - `write_document` create/update chunk scheduling.
- `src/mcp/tools/documents/copy.ts` - `copy_document` chunk scheduling.
- `src/mcp/tools/documents/helpers.ts` - document-output scheduling helper now delegates to chunk scheduling.
- `src/mcp/tools/compound.ts` - compound document edits use chunk scheduling.
- `src/services/scanner.ts` - scanner discovery/content-change and missing-chunk drain use chunk scheduling.
- `tests/integration/embedding/chunk-write-roundtrip.test.ts` - T-I-014 through T-I-017.
- `tests/scenarios/directed/testcases/test_chunk_write_roundtrip.py` - D-chunk-1 / T-A-001.
- `tests/scenarios/directed/testcases/test_chunk_heading_rename.py` - D-chunk-2 / T-A-002.

## Verification

- `npm run test:integration -- tests/integration/embedding/chunk-write-roundtrip.test.ts` - passed, 4 tests.
- `npm run test:integration -- tests/integration/embedding/chunk-pending-queue.test.ts` - passed, 2 tests.
- `python3 tests/scenarios/directed/run_suite.py --managed chunk_write` - passed, 1 scenario.
- `python3 tests/scenarios/directed/run_suite.py --managed chunk_heading_rename` - passed, 1 scenario.
- `npm run typecheck` - passed.

## Decisions Made

- Kept Phase 169 search result aggregation out of scope; scenarios assert persisted chunk rows and stale-heading cleanup directly.
- Scanner missing-embedding drain was translated to missing-chunk drain to match the new document semantic source of truth.

## Deviations from Plan

- Wave 4 executor stopped returning progress after producing the implementation and scenarios. The orchestrator stopped the agent and completed verification/summary locally.
- The documented `chunk_write` directed pattern selected only `test_chunk_write_roundtrip`; `test_chunk_heading_rename` was run explicitly as a second managed scenario.

**Total deviations:** 2 process deviations, 0 product behavior deviations.
**Impact:** No product scope change.

## Issues Encountered

- Directed scenario pattern matching is substring-based; `chunk_write` does not match `chunk_heading_rename`.

## Known Stubs

None.

## Threat Flags

None. Public mutation paths use the shared `(instance_id, document_id)` scoped chunk store and preserve existing warning-only embedding failure behavior.

## User Setup Required

None. Integration and scenario verification used `.env.test` credentials.

## Next Phase Readiness

Phase 168 is ready for phase-level verification. Phase 169 can build lifecycle, search routing, `matched_chunks`, and broader preservation behavior on top of populated chunks and chunk RPCs.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/168-chunking-foundation-and-write-pipeline/168-04-SUMMARY.md`.
- Required integration, scenario, and typecheck commands passed.
- No Phase 169 lifecycle/search aggregation work was implemented.

---
*Phase: 168-chunking-foundation-and-write-pipeline*
*Completed: 2026-06-14*
