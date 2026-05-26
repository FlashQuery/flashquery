---
phase: 154-residual-import-cycle-cleanup
plan: 05
subsystem: embedding
tags: [typescript, embedding, storage, logging, import-cycles]

requires:
  - phase: 154-residual-import-cycle-cleanup
    provides: Plan 01 config type leaf used by embedding/storage/logging imports
provides:
  - REQ-011 embedding/storage/logging cycle cleanup slice
  - dependency-light embedding dimension resolver
  - focused embedding dimension policy regression coverage
affects: [embedding-provider, storage-schema, logging, madge]

tech-stack:
  added: []
  patterns: [leaf policy modules, type-only config imports, focused regression tests]

key-files:
  created:
    - src/embedding/dimensions.ts
    - tests/unit/embedding-provider.test.ts
  modified:
    - src/embedding/provider.ts
    - src/storage/supabase.ts

key-decisions:
  - "Moved embedding dimension policy into src/embedding/dimensions.ts with a type-only dependency on src/config/types.ts."
  - "Updated storage to import dimension policy from the leaf instead of concrete embedding provider implementation."
  - "Preserved Plan 01's logger import from src/config/types.ts; no logger source change was needed in this plan."

patterns-established:
  - "Storage schema code consumes embedding policy leaves, not concrete provider implementations."
  - "Embedding dimension regression tests import the leaf directly so future moves remain visible."

requirements-completed: [REQ-011]

duration: 2m17s
completed: 2026-05-26
---

# Phase 154 Plan 05: Embedding Dimension Policy Cleanup Summary

**Dependency-light embedding dimension policy with storage/provider imports detached from concrete provider cycles.**

## Performance

- **Duration:** 2m17s
- **Started:** 2026-05-26T00:09:11Z
- **Completed:** 2026-05-26T00:11:28Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added focused T-U-036 coverage for embedding dimension precedence and fallback behavior.
- Extracted `getEmbeddingDimensions` into `src/embedding/dimensions.ts`.
- Updated `src/storage/supabase.ts` to import dimension policy from the leaf module, removing its dependency on `src/embedding/provider.ts`.
- Updated `src/embedding/provider.ts` to type-import `FlashQueryConfig` from the Plan 01 config type leaf.

## Task Commits

Each task was committed atomically:

1. **Task 1: Preserve embedding and logging behavior** - `5cb852c` (test)
2. **Task 2: Extract embedding dimension policy and leaf config imports** - `409b872` (feat)

## Files Created/Modified

- `src/embedding/dimensions.ts` - Leaf embedding dimension resolver with default 1536 fallback.
- `src/embedding/provider.ts` - Imports dimension policy from the leaf and config types from `src/config/types.ts`.
- `src/storage/supabase.ts` - Imports `FlashQueryConfig` from the config type leaf and dimensions from `src/embedding/dimensions.ts`.
- `tests/unit/embedding-provider.test.ts` - T-U-036 regression coverage for LLM embedding purpose override, legacy dimensions, and default fallback.

## Decisions Made

- Kept provider construction and `initEmbedding` behavior unchanged; only dimension resolution moved.
- Did not edit `src/logging/logger.ts` because Plan 01 had already moved it to `src/config/types.ts` and the Plan 05 boundary check passed.
- Did not edit `src/embedding/background-embed.ts` because this slice did not require changing scheduling semantics or provider calls.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- `tests/unit/embedding-provider.test.ts` did not exist on this branch before Task 1, so the plan's named focused test file was created.
- RED failed as expected because `src/embedding/dimensions.ts` was missing before extraction.
- Concurrent Phase 154 work modified unrelated REQ-011 files during closeout; those files were left untouched.

## Verification

- `npm test -- tests/unit/embedding-provider.test.ts` - passed, 3 tests.
- `rg -n "from '../embedding/provider\\.js'|from '../config/loader\\.js'" src/storage/supabase.ts src/logging/logger.ts && exit 1 || exit 0` - passed, no matches.

## Known Stubs

None.

## Threat Flags

None.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 154-05's REQ-011 embedding/storage/logging slice is ready for the final Phase 154 zero-cycle and quality gates in Plan 154-06. Other REQ-011 leaves from parallel Plan 02/04 work remain outside this plan's ownership.

## Self-Check: PASSED

- Created files exist: `src/embedding/dimensions.ts`, `tests/unit/embedding-provider.test.ts`, `.planning/phases/154-residual-import-cycle-cleanup/154-05-SUMMARY.md`.
- Task commits exist: `5cb852c`, `409b872`.
- Required verification commands passed after implementation.

---
*Phase: 154-residual-import-cycle-cleanup*
*Completed: 2026-05-26*
