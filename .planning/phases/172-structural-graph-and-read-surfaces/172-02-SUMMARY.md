---
phase: 172-structural-graph-and-read-surfaces
plan: 02
subsystem: graph
tags: [graph, fq_processing, embeddings, chunks, mcp]

requires:
  - phase: 172-01
    provides: chunk-keyed structural graph helpers and stale marking
provides:
  - canonical fq_processing frontmatter parsing for full, embedded, and none
  - scheduler wiring for synchronous Tier 1 structural graph refresh after chunk diffing
  - disabled graph and processing-level gates for graph/chunk work
affects: [172-05-search-graph-options, 172-06-get-document-graph-output, graph-processing]

tech-stack:
  added: []
  patterns:
    - parse frontmatter processing level before chunk scheduling
    - keep Tier 1 graph refresh synchronous and Tier 2/Tier 3 absent

key-files:
  created:
    - tests/unit/graph-processing-level.test.ts
    - tests/integration/graph/fq-processing.test.ts
  modified:
    - src/constants/frontmatter-fields.ts
    - src/embedding/chunks/scheduler.ts
    - src/mcp/tools/compound.ts

key-decisions:
  - "fq_processing is exposed as FM.PROCESSING while preserving existing enumerable frontmatter write order."
  - "embedded mode removes document graph nodes after chunk diffing but preserves chunk and embedding scheduling behavior."
  - "none mode removes document chunks and pending chunk embedding rows, letting chunk foreign keys cascade graph cleanup."

patterns-established:
  - "Processing-level gates live in the chunk scheduler so document write surfaces can forward parsed frontmatter without duplicating policy."
  - "Graph-disabled and embedded processing short-circuit before graph mutation."

requirements-completed: [GR-013A, GR-014A]

duration: 78min
completed: 2026-06-24
---

# Phase 172 Plan 02: fq_processing Gates Summary

**Frontmatter-controlled chunk, embedding, and structural graph processing with synchronous Tier 1 refresh and disabled-graph compatibility**

## Performance

- **Duration:** 78 min
- **Started:** 2026-06-24T02:59:00Z
- **Completed:** 2026-06-24T03:17:43Z
- **Tasks:** 1
- **Files modified:** 5

## Accomplishments

- Added `FM.PROCESSING` for canonical `fq_processing` access and parsing.
- Implemented `full`, `embedded`, `none`, and invalid-value processing behavior in `scheduleChangedDocumentChunks`.
- Wired graph-enabled `full` processing to refresh Tier 1 structural graph edges after chunk diff persistence.
- Preserved disabled graph behavior by skipping graph mutation even when frontmatter requests `full`.
- Added unit and integration coverage for default, valid, invalid, transition, and disabled graph behavior.

## Task Commits

1. **Task 1 RED: fq_processing gate tests** - `547c7ae3` (test)
2. **Task 1 GREEN: fq_processing graph gates** - `5ac9bfff` (feat)

## Files Created/Modified

- `src/constants/frontmatter-fields.ts` - Adds canonical `FM.PROCESSING` without changing existing enumerable frontmatter order.
- `src/embedding/chunks/scheduler.ts` - Parses processing level, gates chunk/embedding/graph work, refreshes structural graph state, and cleans up chunk/graph state for `embedded` and `none`.
- `src/mcp/tools/compound.ts` - Forwards parsed frontmatter into the scheduler from existing document write paths.
- `tests/unit/graph-processing-level.test.ts` - Covers absent default, valid values, and invalid diagnostics.
- `tests/integration/graph/fq-processing.test.ts` - Covers `full`, `embedded`, `none`, and graph-disabled scheduler behavior.

## Decisions Made

- `FM.PROCESSING` is non-enumerable to avoid changing the existing ordered frontmatter serialization contract.
- Scheduler-owned processing policy keeps later read-surface plans free to extend `compound.ts` search graph options without coupling to processing-level parsing.
- No Tier 2 or Tier 3 graph workers were introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used a direct pg client for combined chunk diff and graph refresh**
- **Found during:** Task 1 integration verification
- **Issue:** Passing an already-connected pool client into `diffAndPersistDocumentChunks` caused `Client has already been connected`.
- **Fix:** Switched the scheduler graph path to `createPgClientIPv4`, allowing the chunk store to own connection setup while the scheduler reuses the connected client for graph refresh before closing it.
- **Files modified:** `src/embedding/chunks/scheduler.ts`
- **Verification:** `tests/integration/graph/fq-processing.test.ts` passed.
- **Committed in:** `5ac9bfff`

**2. [Rule 1 - Bug] Cast chunk UUIDs for pending embedding cleanup**
- **Found during:** Task 1 integration verification
- **Issue:** `fqc_pending_embeds.target_id` is text while chunk IDs are UUID, causing `operator does not exist: text = uuid` during `fq_processing:none` cleanup.
- **Fix:** Cast chunk IDs to text in the pending-embed cleanup subquery.
- **Files modified:** `src/embedding/chunks/scheduler.ts`
- **Verification:** `tests/integration/graph/fq-processing.test.ts` passed.
- **Committed in:** `5ac9bfff`

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes were required to make the planned scheduler gates work against the existing database/client contracts. No scope was added beyond the declared write set.

## Issues Encountered

- The exact plan command `npm test -- --run tests/unit/graph-processing-level.test.ts` runs the full unit suite successfully, then fails in `test:macro-framework` because that Vitest config only includes `tests/macro-framework/...` and excludes the requested unit file. Direct unit verification passed with `npm run test:unit -- --run tests/unit/graph-processing-level.test.ts`.
- Concurrent 172-06 commits landed on the branch while this plan was executing. They were left intact; this summary records only 172-02 commits.

## Verification

- `npm run test:unit -- --run tests/unit/graph-processing-level.test.ts` - PASSED (1 file, 3 tests)
- `npm test -- --run tests/unit/graph-processing-level.test.ts` - PARTIAL: unit suite PASSED (225 files, 2449 tests), macro-framework wrapper failed with no matching macro test files.
- `npm run test:integration -- --run tests/integration/graph/fq-processing.test.ts tests/integration/graph/structural-edges.test.ts` - PASSED (2 files, 3 tests)

## Known Stubs

None.

## Threat Flags

None beyond the plan threat model for user-authored frontmatter controlling processing behavior.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used for integration tests.

## Next Phase Readiness

Plan 172-05 can extend `src/mcp/tools/compound.ts` for graph search options with only the two frontmatter-forwarding changes from this plan in place.

## Self-Check: PASSED

- Summary file exists: `.planning/phases/172-structural-graph-and-read-surfaces/172-02-SUMMARY.md`
- Task commit found: `547c7ae3`
- Task commit found: `5ac9bfff`

---
*Phase: 172-structural-graph-and-read-surfaces*
*Completed: 2026-06-24*
