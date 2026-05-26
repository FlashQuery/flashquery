---
phase: 154-residual-import-cycle-cleanup
plan: 02
subsystem: llm-runtime
tags: [typescript, llm, import-cycles, madge, runtime-types]

requires:
  - phase: 154-01
    provides: dependency-light config types used by LLM runtime leaves
provides:
  - REQ-011 client/resolver runtime cycle cleanup
  - dependency-light LLM runtime error leaf
  - dependency-light LLM client contract type leaf
affects: [llm-client, llm-resolver, call-model, embedding]

tech-stack:
  added: []
  patterns: [leaf error modules, leaf runtime contract modules, compatibility re-exports]

key-files:
  created:
    - src/llm/errors.ts
    - src/llm/runtime-types.ts
  modified:
    - src/llm/client.ts
    - src/llm/resolver.ts
    - tests/unit/llm-client.test.ts

key-decisions:
  - "Kept existing public imports from src/llm/client.ts and src/llm/resolver.ts working through compatibility re-exports."
  - "Removed resolver's client back-edge by keeping its caller-wins parameter merge local while preserving behavior."

patterns-established:
  - "Shared LLM runtime classes and contracts live in dependency-light leaves instead of concrete client/resolver modules."
  - "Concrete modules may re-export public contracts for compatibility while cycle-sensitive imports target leaves."

requirements-completed: [REQ-011]

duration: 4m51s
completed: 2026-05-26
---

# Phase 154 Plan 02: LLM Runtime Client/Resolver Cycle Cleanup Summary

**LLM client/resolver runtime contracts moved to leaf modules while preserving fallback behavior, cost recording, and public compatibility exports.**

## Performance

- **Duration:** 4m51s
- **Started:** 2026-05-26T00:08:27Z
- **Completed:** 2026-05-26T00:13:18Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added focused T-U-036 regression coverage for client purpose fallback ordering, permanent error attempts, successful usage recording, and resolver 429 retry-delay capping.
- Extracted `LlmHttpError`, `LlmNetworkError`, and `LlmFallbackError` into `src/llm/errors.ts`.
- Extracted `ChatMessage`, `LlmCompletionResult`, and `LlmClient` into `src/llm/runtime-types.ts`.
- Updated `src/llm/resolver.ts` so it no longer imports from `src/llm/client.ts`.
- Preserved existing public imports from `client.ts` and `resolver.ts` via re-exports.

## Task Commits

1. **Task 1: Preserve LLM runtime fallback and error behavior** - `560843a` (test)
2. **Task 2: Extract LLM runtime errors and types** - `cd3f95b` (feat)

## Files Created/Modified

- `src/llm/errors.ts` - Leaf LLM runtime error classes shared by client, resolver, and callers.
- `src/llm/runtime-types.ts` - Leaf chat/client/result contracts shared without importing the concrete client.
- `src/llm/client.ts` - Imports leaf errors/types, re-exports compatibility contracts, and type-imports config from the Plan 01 leaf.
- `src/llm/resolver.ts` - Imports leaf errors/types and removes all imports from the concrete client implementation.
- `tests/unit/llm-client.test.ts` - Adds behavior-level fallback, retry cap, attempts, and usage regression coverage.

## Decisions Made

- Kept compatibility re-exports in `client.ts` for `LlmHttpError`, `LlmNetworkError`, `ChatMessage`, `LlmCompletionResult`, and `LlmClient`.
- Kept compatibility re-export in `resolver.ts` for `LlmFallbackError`.
- Used a local resolver `mergeParameters` helper because importing the public helper from `client.ts` would preserve the back-edge this plan is meant to remove.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed resolver's runtime helper import from client**
- **Found during:** Task 2 (Extract LLM runtime errors and types)
- **Issue:** Extracting only errors and types still left `resolver.ts` importing `mergeParameters` from `client.ts`, so the client/resolver back-edge remained.
- **Fix:** Added an equivalent local caller-wins shallow merge helper in `resolver.ts`.
- **Files modified:** `src/llm/resolver.ts`
- **Verification:** Focused LLM client/resolver tests passed and the no-back-edge grep returned no matches.
- **Committed in:** `cd3f95b`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** The adjustment was required to satisfy the plan's no-import-from-client acceptance criterion and did not change merge precedence behavior.

## Issues Encountered

- An initial fake-timer client regression test timed out because the HTTP mock also schedules response completion with `setTimeout(0)`. The coverage was split so client fallback/cost recording uses real timers and the 429 cap is asserted directly through `PurposeResolver`.
- A broader opportunistic `npm run typecheck` was blocked by concurrent Phase 154 edits outside Plan 02 ownership (`src/mcp/tools/llm.ts` expecting `InjectionMetadata` from reference resolver and `src/mcp/tools/plugins.ts` expecting `getEmbeddingDimensions` from embedding provider). Those files belong to other Phase 154 cleanup slices and were not edited by this plan.

## Verification

- `npm test -- tests/unit/llm-client.test.ts` - passed, 44 tests.
- `npm test -- tests/unit/llm-client.test.ts tests/unit/llm-resolver.test.ts` - passed, 70 tests.
- `rg -n "from './client\\.js'|from '../llm/client\\.js'" src/llm/resolver.ts src/llm/types.ts && exit 1 || exit 0` - passed, no matches.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The client/resolver portion of REQ-011 is complete. Plans 154-04 and 154-05 own the remaining REQ-011 leaves for config-sync, template/reference metadata, embedding dimensions, storage, and logging; Plan 154-06 owns the final whole-phase zero-cycle and quality gates.

## Self-Check: PASSED

- Created files exist: `src/llm/errors.ts`, `src/llm/runtime-types.ts`, `.planning/phases/154-residual-import-cycle-cleanup/154-02-SUMMARY.md`.
- Modified files exist: `src/llm/client.ts`, `src/llm/resolver.ts`, `tests/unit/llm-client.test.ts`.
- Task commits exist: `560843a`, `cd3f95b`.
- Required verification commands passed after implementation.

---
*Phase: 154-residual-import-cycle-cleanup*
*Completed: 2026-05-26*
