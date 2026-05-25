---
phase: 150-config-metadata-typing
plan: 01
subsystem: config
tags: [typescript, config, metadata, weakmap, vitest]
requires: []
provides:
  - Typed runtime metadata storage for loaded FlashQuery configs
  - REQ-012 unit and static coverage for config metadata accessors
affects: [config-loader, llm-config-sync, host-tool-exposure]
tech-stack:
  added: []
  patterns:
    - Module-local WeakMap runtime metadata store
key-files:
  created:
    - tests/unit/config-runtime-metadata.test.ts
  modified:
    - src/config/loader.ts
    - tests/unit/llm-config-sync.test.ts
key-decisions:
  - "Use WeakMap<FlashQueryConfig, ConfigRuntimeMetadata> so runtime metadata does not mutate the public config object shape."
  - "Keep accessors tolerant for manually constructed configs: warnings/raw refs default empty and host exposure recomputes from hostMcpTools."
patterns-established:
  - "Config runtime metadata is private to loader.ts and exposed only through typed accessor functions."
requirements-completed:
  - REQ-012
duration: 23 min
completed: 2026-05-25
---

# Phase 150 Plan 01: Config Runtime Metadata Typing Summary

**Typed WeakMap-backed config runtime metadata with REQ-012 tests for warning, host exposure, and raw LLM API key accessors**

## Performance

- **Duration:** 23 min
- **Started:** 2026-05-25T01:30:00Z
- **Completed:** 2026-05-25T01:53:07Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added `tests/unit/config-runtime-metadata.test.ts` covering T-U-026, T-U-027, T-U-028, and T-U-029.
- Replaced the selected underscore metadata side-channel casts in `src/config/loader.ts` with `ConfigRuntimeMetadata` stored in a module-local `WeakMap`.
- Updated `tests/unit/llm-config-sync.test.ts` so raw API key ref coverage uses real `loadConfig` YAML fixtures instead of writing `_rawLlmApiKeyRefs`.

## Task Commits

1. **Task 1: Add REQ-012 failing/targeted unit and static tests** - `0ff37c1` (test)
2. **Task 2: Replace selected underscore side-channel casts with typed metadata storage** - `c812db5` (feat)
3. **Task 3: Run final REQ-012 gates and record completion evidence** - this summary commit

## Files Created/Modified

- `tests/unit/config-runtime-metadata.test.ts` - New focused REQ-012 unit/static tests for T-U-026..T-U-029.
- `src/config/loader.ts` - Added typed runtime metadata storage and accessor reads.
- `tests/unit/llm-config-sync.test.ts` - Replaced direct raw-ref hidden-field test setup with YAML-backed `loadConfig` fixtures.

## Verification Evidence

- T-U-026: `getDeprecationWarnings` and `getStartupWarnings` preserve loaded warning metadata.
- T-U-027: `getResolvedHostToolExposure` returns stored metadata for loaded configs and recomputes fallback for manual configs.
- T-U-028: `getLlmApiKeyRefs` returns `${OPENAI_API_KEY}` while excluding `sk-resolved-secret`.
- T-U-029: static assertion rejects selected metadata casts in `src/config/loader.ts`.
- `npm test -- tests/unit/config-runtime-metadata.test.ts tests/unit/llm-config-sync.test.ts` - passed, 16 tests.
- Selected cast-removal grep - passed with no matches.
- `npm run typecheck` - passed.
- `npm run lint` - passed.

## Decisions Made

Used a `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>` instead of symbol-keyed metadata because the metadata should follow object identity without adding hidden properties to `FlashQueryConfig`.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope expansion.

## Issues Encountered

Initial test fixtures used a removed host selector and legacy purpose tool names. These were corrected to current tool names before the RED commit so the expected failures were limited to the REQ-012 side-channel behavior.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 150 is ready for phase-level verification. No schema push is required.

## Self-Check: PASSED

- All tasks executed.
- Each task has an atomic commit or documented evidence in this summary.
- SUMMARY.md created.
- Focused tests, selected grep, typecheck, and lint passed.

---
*Phase: 150-config-metadata-typing*
*Completed: 2026-05-25*
