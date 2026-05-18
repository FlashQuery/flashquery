---
phase: 141-bm25-tool-search-help-pages-and-description-overrides
plan: 3
subsystem: llm
tags: [mcp-broker, native-tools, help-pages, dispatcher, vitest]

requires:
  - phase: 141-bm25-tool-search-help-pages-and-description-overrides
    provides: 141-02 TOOL_META loader via loadToolMeta
provides:
  - Native help:true dispatcher sentinel after native visibility/catalog lookup
  - Native-only canonical help footer on dispatcher failures
  - Brokered help:true and brokered error pass-through regressions
affects: [phase-141, mcp-broker, tool-search, call-model]

tech-stack:
  added: []
  patterns:
    - Module-cached loadToolMeta lookup for native dispatcher help pages
    - Native dispatch errors decorate messages through dispatchError only when kind=native

key-files:
  created:
    - .planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-03-SUMMARY.md
  modified:
    - src/llm/tool-dispatcher.ts
    - tests/unit/llm-tool-dispatcher.test.ts

key-decisions:
  - "Used the actual 141-02 loadToolMeta export with a dispatcher-local cache instead of the generated plan's nonexistent getToolMeta reference."
  - "Kept brokered dispatch unchanged by applying help footer decoration only to dispatchError calls with kind=native."

patterns-established:
  - "Native help sentinel: resolve native exposure and catalog membership first, then return TOOL_META helpPageBody before Zod parsing."
  - "Native failure footer: append the canonical help pointer idempotently so the footer appears exactly once."

requirements-completed: [REQ-093, REQ-096, REQ-098]

duration: 3m25s
completed: 2026-05-18T16:39:47Z
---

# Phase 141 Plan 03: Dispatcher Help Semantics Summary

**Native tool help dispatch now bypasses schema validation after exposure lookup, while native errors point models to help and brokered tools stay pass-through.**

## Performance

- **Duration:** 3m25s
- **Started:** 2026-05-18T16:36:22Z
- **Completed:** 2026-05-18T16:39:47Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `help:true` handling in `dispatchNativeToolCall` after native visibility/catalog checks and before Zod validation.
- Added the canonical native help footer to validation, abort, handler `isError`, and thrown-handler failures exactly once.
- Added dispatcher regressions for T-I-047, T-I-048, T-I-029, and brokered T-I-028 pass-through behavior.

## Task Commits

1. **Tasks 1-2: Native help sentinel and native-only footer/pass-through regressions** - `0780ef3` (`feat`)
2. **Plan metadata** - pending at summary creation

_Note: Both TDD tasks touched the same dispatcher/test surface and were committed together per the user request to commit production/test changes, then SUMMARY.md._

## Files Created/Modified

- `src/llm/tool-dispatcher.ts` - Loads TOOL_META through `loadToolMeta`, handles native `help:true`, and decorates native-only failures with the canonical footer.
- `tests/unit/llm-tool-dispatcher.test.ts` - Adds focused regressions for native help bypass, native footer exactness, and brokered pass-through semantics.
- `.planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-03-SUMMARY.md` - Captures execution outcome.

## Decisions Made

- Used `loadToolMeta()` because the actual 141-02 implementation exports `loadToolMeta`, `validateToolMeta`, and `DEFAULT_HELP_HINT`; the generated plan/interface reference to `getToolMeta(name)` was stale.
- Cached the `loadToolMeta()` promise in the dispatcher to avoid rescanning metadata files on each native help request.
- Applied the help footer in `dispatchError` only for `kind === 'native'`, preserving brokered error pass-through.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reconciled stale metadata interface name**
- **Found during:** Task 1
- **Issue:** The plan referenced `getToolMeta(name)`, but the actual 141-02 file exports `loadToolMeta`, `validateToolMeta`, and `DEFAULT_HELP_HINT`.
- **Fix:** Implemented the dispatcher integration with a module-cached `loadToolMeta()` call.
- **Files modified:** `src/llm/tool-dispatcher.ts`, `tests/unit/llm-tool-dispatcher.test.ts`
- **Verification:** `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts`
- **Committed in:** `0780ef3`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No behavioral scope change; the implementation follows the actual 141-02 API.

## Issues Encountered

- The focused RED test run failed on the expected missing behaviors: native `help:true` still hit Zod validation, and native failures lacked the canonical footer. The GREEN run passed after dispatcher changes.

## Verification

- RED: `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts` failed with 6 expected failures before production changes.
- GREEN: `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts` passed with 28 tests.

## Known Stubs

None. Stub scan only found existing empty-object/default/null-safe helper patterns, not UI/data-source placeholders.

## Threat Flags

None. The change stays inside existing model-args-to-native-dispatch and brokered-error trust boundaries already listed in the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Dispatcher semantics are ready for later Phase 141 work that registers real `.tool.md` metadata, search results, and call_model-facing help flows.

## Self-Check: PASSED

- Created file exists: `.planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-03-SUMMARY.md`
- Production/test commit exists: `0780ef3`
- Focused verification passed: `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts`

---
*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Completed: 2026-05-18*
