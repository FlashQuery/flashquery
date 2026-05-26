---
phase: 154-residual-import-cycle-cleanup
plan: 01
subsystem: config
tags: [typescript, config-loader, llm-policy, madge, import-cycles]

requires:
  - phase: 153-documents-tool-decomposition
    provides: document tool cycle cleanup baseline before residual cycle work
provides:
  - REQ-010 targeted config loader cycle guard
  - dependency-light FlashQueryConfig type leaf
  - dependency-light LLM native tool policy leaf
affects: [config-loader, llm-capabilities, llm-tool-registry, logging]

tech-stack:
  added: []
  patterns: [leaf type modules, leaf policy constants, targeted madge guards]

key-files:
  created:
    - src/config/types.ts
    - src/llm/tool-policy.ts
  modified:
    - src/config/loader.ts
    - src/llm/capabilities.ts
    - src/llm/tool-registry.ts
    - src/logging/logger.ts
    - tests/unit/circular-deps.test.ts

key-decisions:
  - "Kept config loader's public FlashQueryConfig export as a type re-export while moving cycle-sensitive imports to src/config/types.ts."
  - "Moved delegated native tool tiers and hard exclusions into src/llm/tool-policy.ts and re-exported them from tool-registry for compatibility."

patterns-established:
  - "Config-facing LLM constants live in dependency-light policy leaves instead of concrete registries."
  - "Targeted madge guards assert residual cycle families before the final zero-cycle phase."

requirements-completed: [REQ-010]

duration: 4m12s
completed: 2026-05-26
---

# Phase 154 Plan 01: Config/LLM Policy Import Cycle Cleanup Summary

**Config loader cycle cleanup with leaf config types, leaf LLM tool policy constants, and a targeted T-U-032 madge guard.**

## Performance

- **Duration:** 4m12s
- **Started:** 2026-05-25T23:59:21Z
- **Completed:** 2026-05-26T00:03:33Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added T-U-032 to fail on any madge cycle line containing `config/loader.ts`, including matching cycle lines in assertion output.
- Extracted `FlashQueryConfig` into `src/config/types.ts` and updated cycle-sensitive LLM/logger imports to use the leaf.
- Extracted `TOOL_TIERS`, `ToolTierName`, and `HARD_EXCLUDED_NATIVE_TOOLS` into `src/llm/tool-policy.ts` while preserving existing `tool-registry` exports.
- Verified focused config/LLM policy regressions and targeted pinned madge output.

## Task Commits

1. **Task 1: Add REQ-010 config cycle and policy regression guards** - `602f93b` (test)
2. **Task 2: Extract dependency-light config and tool policy leaves** - `3cb7f15` (feat)

## Files Created/Modified

- `src/config/types.ts` - Leaf `FlashQueryConfig` public type definition.
- `src/llm/tool-policy.ts` - Leaf delegated native tier and hard-exclusion constants.
- `src/config/loader.ts` - Imports config type and tool policy leaves; keeps runtime metadata and config parsing behavior.
- `src/llm/capabilities.ts` - Type-imports `FlashQueryConfig` from the leaf module.
- `src/llm/tool-registry.ts` - Reuses and re-exports leaf policy constants.
- `src/logging/logger.ts` - Type-imports `FlashQueryConfig` from the leaf module to remove the last config-loader cycle.
- `tests/unit/circular-deps.test.ts` - Adds T-U-032 targeted config loader cycle guard.

## Decisions Made

- Kept `src/config/loader.ts` as a compatibility type re-export for existing callers, while cycle-sensitive modules now import the leaf directly.
- Treated `src/logging/logger.ts` as an in-scope Rule 3 adjustment because its type-only import from `config/loader.ts` was the last failing T-U-032 cycle after the planned leaf extraction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated logger config type import**
- **Found during:** Task 2 (Extract dependency-light config and tool policy leaves)
- **Issue:** After extracting config and LLM policy leaves, T-U-032 still failed on `config/loader.ts > logging/logger.ts`.
- **Fix:** Changed `src/logging/logger.ts` to type-import `FlashQueryConfig` from `src/config/types.ts`.
- **Files modified:** `src/logging/logger.ts`
- **Verification:** Focused unit suite passed and pinned madge check returned no `config/loader.ts` lines.
- **Committed in:** `3cb7f15`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** The adjustment was required to satisfy REQ-010's targeted cycle gate and did not change runtime logging behavior.

## Issues Encountered

- TDD RED behaved as expected: the new T-U-032 guard failed against the baseline and printed current `config/loader.ts` cycle lines.
- First GREEN attempt exposed one remaining logger type back-edge; fixed with the leaf type import noted above.

## Verification

- `npm test -- tests/unit/circular-deps.test.ts tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts` - passed, 68 tests.
- `sh -c 'npx --yes madge@8.0.0 src --extensions ts --circular > /tmp/fq-154-config-cycle.txt 2>&1 || true; ! rg "config/loader\\.ts" /tmp/fq-154-config-cycle.txt'` - passed.
- `rg -n "from '../llm/(tool-registry|template-tools|client)\\.js'|from './(tool-registry|template-tools|client)\\.js'" src/config/loader.ts || true` - no matches.
- `npm run typecheck` - passed.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

REQ-010 is complete. Later Phase 154 plans can address the remaining REQ-011 and REQ-012 cycle families; the final repository zero-cycle gate remains deferred to Plan 154-06 as planned.

## Self-Check: PASSED

- Created files exist: `src/config/types.ts`, `src/llm/tool-policy.ts`, `.planning/phases/154-residual-import-cycle-cleanup/154-01-SUMMARY.md`.
- Task commits exist: `602f93b`, `3cb7f15`.
- Required verification commands passed after implementation.

---
*Phase: 154-residual-import-cycle-cleanup*
*Completed: 2026-05-26*
