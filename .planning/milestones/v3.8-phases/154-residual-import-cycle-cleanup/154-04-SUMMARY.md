---
phase: 154-residual-import-cycle-cleanup
plan: 04
subsystem: llm
tags: [typescript, import-cycles, config-sync, templates, reference-metadata]

requires:
  - phase: 154-residual-import-cycle-cleanup
    provides: 154-01 config type and LLM tool policy leaves
provides:
  - REQ-011 config-sync adapter type leaf
  - REQ-011 reference metadata type leaf
  - focused sync/template/reference import-boundary guards
affects: [llm-config-sync, purpose-template-bindings, reference-resolver, template-tools, call-model]

tech-stack:
  added: []
  patterns: [leaf type modules, type-only service boundary imports, focused import-boundary tests]

key-files:
  created:
    - src/llm/config-sync-types.ts
    - src/llm/reference-metadata.ts
    - tests/unit/purpose-template-bindings.test.ts
    - tests/unit/template-tools.test.ts
  modified:
    - src/llm/config-sync.ts
    - src/llm/purpose-template-bindings.ts
    - src/llm/reference-resolver.ts
    - src/llm/template-tools.ts
    - src/llm/types.ts
    - src/mcp/tools/llm.ts
    - src/mcp/tools/plugins.ts
    - tests/unit/reference-resolver.test.ts
    - tests/config/vitest.integration.config.ts

key-decisions:
  - "Kept runtime template rendering in src/llm/reference-resolver.ts while moving metadata-only contracts to src/llm/reference-metadata.ts."
  - "Created exact plan-named unit boundary tests for purpose-template and template-tool imports because those files did not exist in the repo."
  - "Updated the stale plugin embedding-dimensions consumer introduced by concurrent Plan 154-05 work only enough to unblock required integration setup builds."

patterns-established:
  - "Config-sync service modules share adapter/result contracts through src/llm/config-sync-types.ts."
  - "Call-model and template metadata consumers import metadata contracts from src/llm/reference-metadata.ts instead of the resolver implementation."

requirements-completed: [REQ-011]

duration: 6m48s
completed: 2026-05-26
---

# Phase 154 Plan 04: Config Sync and Reference Metadata Cycle Cleanup Summary

**Config-sync adapter contracts and injected-reference/template metadata now live in dependency-light LLM leaf modules.**

## Performance

- **Duration:** 6m48s
- **Started:** 2026-05-26T00:08:37Z
- **Completed:** 2026-05-26T00:15:25Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added focused RED coverage for the config-sync and reference metadata import boundaries.
- Extracted `ConfigSyncAdapter` and `ConfigSyncResult` into `src/llm/config-sync-types.ts`.
- Extracted template/reference metadata contracts into `src/llm/reference-metadata.ts`.
- Updated config-sync, purpose-template, template-tools, reference-resolver, LLM metadata, and call_model type imports to consume leaves.
- Preserved sync/template/reference behavior under the focused unit and integration gates.

## Task Commits

1. **Task 1: Preserve config-sync, template, and reference behavior** - `320d382` (test)
2. **Task 2: Extract config-sync and reference metadata leaves** - `616062a` (feat)

## Files Created/Modified

- `src/llm/config-sync-types.ts` - Leaf config sync adapter/result contracts.
- `src/llm/reference-metadata.ts` - Leaf injected-reference and template metadata contracts.
- `src/llm/config-sync.ts` - Uses the config type leaf and sync contract leaf.
- `src/llm/purpose-template-bindings.ts` - Uses `ConfigSyncAdapter` from the leaf instead of importing `config-sync.ts`.
- `src/llm/reference-resolver.ts` - Uses metadata contracts from the leaf while retaining resolver/rendering runtime logic.
- `src/llm/template-tools.ts` - Imports template metadata types from the metadata leaf.
- `src/llm/types.ts` - Imports `InjectedReferenceMetadata` from the metadata leaf.
- `src/mcp/tools/llm.ts` - Imports `InjectionMetadata` from the metadata leaf.
- `src/mcp/tools/plugins.ts` - Uses the Plan 154-05 embedding dimensions leaf after concurrent extraction.
- `tests/unit/purpose-template-bindings.test.ts` - Pins purpose-template/config-sync import boundary.
- `tests/unit/template-tools.test.ts` - Pins template-tools/reference-metadata type import boundary.
- `tests/unit/reference-resolver.test.ts` - Pins injected reference metadata shape against the leaf contract.
- `tests/config/vitest.integration.config.ts` - Includes the existing reference resolver integration suite so the plan command can run it.

## Decisions Made

- Kept behavior-bearing functions (`normalizeTemplateParamDeclarations`, `renderTemplateDocument`, hydration, and prompt char computation) in `reference-resolver.ts`; only metadata contracts moved.
- Added plan-named boundary tests rather than renaming the existing broader `llm-template-tools.test.ts` suite.
- Treated `src/mcp/tools/llm.ts` as an in-scope metadata consumer because `InjectionMetadata` is part of the moved reference metadata contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added reference resolver integration suite to Vitest integration include list**
- **Found during:** Task 2 verification
- **Issue:** `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` exited before running because the file was not included by `tests/config/vitest.integration.config.ts`.
- **Fix:** Added the existing integration file to the include list.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** The exact integration command passed with 8 tests.
- **Committed in:** `616062a`

**2. [Rule 3 - Blocking] Updated stale plugin embedding dimension import after concurrent Plan 154-05 extraction**
- **Found during:** Task 2 verification
- **Issue:** Integration setup build failed because `src/mcp/tools/plugins.ts` still imported `getEmbeddingDimensions` from `embedding/provider.ts` after Plan 154-05 moved it to `embedding/dimensions.ts`.
- **Fix:** Changed that one import to `../../embedding/dimensions.js`.
- **Files modified:** `src/mcp/tools/plugins.ts`
- **Verification:** Integration setup build and the reference resolver integration suite passed.
- **Committed in:** `616062a`

**3. [Rule 3 - Blocking] Updated call_model metadata type import**
- **Found during:** Task 2 typecheck
- **Issue:** `src/mcp/tools/llm.ts` imported `InjectionMetadata` from `reference-resolver.ts` after the metadata contract moved.
- **Fix:** Imported `InjectionMetadata` from `src/llm/reference-metadata.ts`.
- **Files modified:** `src/mcp/tools/llm.ts`
- **Verification:** `npm run typecheck` passed.
- **Committed in:** `616062a`

---

**Total deviations:** 3 auto-fixed (Rule 3 blocking)
**Impact on plan:** All fixes were required to make the plan's verification commands runnable after concurrent Phase 154 changes. No MCP response envelopes, reference hydration behavior, or config-sync database semantics changed.

## Issues Encountered

- The plan referenced two unit test filenames that did not exist; exact plan-named boundary tests were created while existing behavior suites remained unchanged.
- Concurrent Phase 154 commits advanced around this plan. The implementation staged only Plan 154-04 files and the documented verification fixes.

## Verification

- `npm test -- tests/unit/llm-config-sync.test.ts tests/unit/purpose-template-bindings.test.ts tests/unit/template-tools.test.ts tests/unit/reference-resolver.test.ts` - passed, 99 tests.
- `npm run test:integration -- tests/integration/reference-resolver.integration.test.ts` - passed, 8 tests.
- `rg -n "from './config-sync\\.js'|from './reference-resolver\\.js'|from '../llm/reference-resolver\\.js'" src/llm/purpose-template-bindings.ts src/llm/types.ts && exit 1 || exit 0` - passed, no matches.
- `npm test -- tests/unit/llm-template-tools.test.ts` - passed, 20 tests.
- `npm run typecheck` - passed.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

This REQ-011 slice is ready for the remaining Phase 154 cycle work and final Plan 154-06 madge gates. The final all-cycle guard remains intentionally deferred to Plan 154-06.

## Self-Check: PASSED

- Created files exist: `src/llm/config-sync-types.ts`, `src/llm/reference-metadata.ts`, `tests/unit/purpose-template-bindings.test.ts`, `tests/unit/template-tools.test.ts`, `.planning/phases/154-residual-import-cycle-cleanup/154-04-SUMMARY.md`.
- Task commits exist: `320d382`, `616062a`.
- Required verification commands passed after implementation.

---
*Phase: 154-residual-import-cycle-cleanup*
*Completed: 2026-05-26*
