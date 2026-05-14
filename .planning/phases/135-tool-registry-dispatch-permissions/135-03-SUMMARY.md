---
phase: 135-tool-registry-dispatch-permissions
plan: 03
subsystem: macro
tags: [macro, permission-prescan, dispatch, hard-exclusions, vitest]

requires:
  - phase: 135-tool-registry-dispatch-permissions
    provides: ToolRegistry, dispatchMacroTool, and macro registry allowlist metadata from Plan 02
provides:
  - Recursive macro AST tool-reference collection
  - Static permission pre-scan before evaluator execution
  - Registry-backed evaluator dispatch with dispatchMacroTool allowlist backstop
  - Hard-exclusion classification for call_macro, template masquerades, and delegated call_model
affects: [135-tool-registry-dispatch-permissions, macro-support, call_macro-dispatch]

tech-stack:
  added: []
  patterns:
    - Permission preflight returns canonical expected-error ToolResult envelopes and evaluator converts them through MacroExpectedError
    - Injected dispatchTool remains a test seam while registry-backed calls use dispatchMacroTool

key-files:
  created:
    - src/macro/permission-prescan.ts
  modified:
    - src/macro/evaluator.ts
    - tests/unit/macro-permission-prescan.test.ts

key-decisions:
  - "Registry-backed expected errors halt macro execution through MacroExpectedError, while explicitly injected dispatchTool results retain existing branchable expected-envelope behavior."
  - "ToolExistsCall remains introspection-only and is intentionally excluded from collected dispatch references."

patterns-established:
  - "collectToolReferences mirrors evaluator preflight recursion across every Statement and Expr variant."
  - "Evaluator preflight order is shell flag scan, generic preflight, input-var validation, tool permission pre-scan, then execBlock."

requirements-completed:
  - MACRO-DISP-02
  - MACRO-DISP-03
  - MACRO-DISP-04
  - MACRO-DISP-05
  - MACRO-DISP-06

duration: 4m29s
completed: 2026-05-14
---

# Phase 135 Plan 03: Permission Pre-Scan And Hard Exclusions Summary

**Static macro tool-reference preflight rejects unknown, forbidden, template-masqueraded, and delegated recursive model calls before evaluator side effects.**

## Performance

- **Duration:** 4m29s
- **Started:** 2026-05-14T18:31:49Z
- **Completed:** 2026-05-14T18:36:18Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `collectToolReferences` and `preScanToolReferences` with full recursive coverage for statements, expressions, pipelines, loops, branches, field access, unary/binary expressions, and nested tool-call arguments.
- Wired evaluator preflight so registry-backed macro calls scan the full AST before `execBlock`.
- Routed registry-backed tool calls through `dispatchMacroTool` while preserving the existing injected `dispatchTool` seam for tests and legacy evaluator callers.
- Verified the exact hard-exclusion behaviors for `fq.call_macro`, template masquerade tools, and delegated `fq.call_model`.

## Task Commits

1. **Task 1: Implement recursive preScanToolReferences** - `ec059e3` (feat)
2. **Task 2: Wire pre-scan and hard exclusions into evaluator** - `4764870` (feat)

## Files Created/Modified

- `src/macro/permission-prescan.ts` - Recursively collects macro tool references, classifies template masquerades, unknown servers/tools, hard exclusions, and forbidden allowlist misses.
- `src/macro/evaluator.ts` - Carries registry/allowlist metadata in invocation context, runs permission preflight before execution, and dispatches registry-backed calls through `dispatchMacroTool`.
- `tests/unit/macro-permission-prescan.test.ts` - Corrected the nested pre-scan fixture to use current parser grammar while preserving the same AST coverage.

## Decisions Made

- Registry-backed dispatch errors are converted to `MacroExpectedError` so bypassed pre-scan failures halt the macro with a canonical expected-error envelope.
- Explicit `dispatchTool` remains branchable for expected tool envelopes to preserve the existing evaluator contract covered by `macro-termination.test.ts`.
- `_exists()` references are excluded from dispatch collection because namespace introspection is engine-resolved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed parser-invalid permission pre-scan fixture**
- **Found during:** Task 1 (Implement recursive preScanToolReferences)
- **Issue:** The existing nested pre-scan test used brace-style `if`/`for`/`while` syntax that the current macro parser rejects before the pre-scan behavior can run.
- **Fix:** Rewrote the fixture with current `if ... then ... else ... fi`, `for ... do ... done`, and `while ... do ... done` syntax while keeping nested branch/loop/expression/statement tool-call coverage.
- **Files modified:** `tests/unit/macro-permission-prescan.test.ts`
- **Verification:** `npm test -- --reporter=verbose macro-permission-prescan` passed.
- **Committed in:** `ec059e3`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation made the planned test executable without changing product behavior or broadening scope.

## Issues Encountered

- The first Task 1 verification failed on a parser error in the test fixture; after the syntax correction, all focused and plan-level gates passed.

## Verification

- `npm test -- --reporter=verbose macro-permission-prescan` - passed, 5 tests.
- `npm test -- --reporter=verbose macro-permission-prescan macro-hard-exclusions macro-dispatcher` - passed, 14 tests.
- `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` - passed, 15 tests.
- `npm run build` - passed.
- Task 1 acceptance greps passed for recursive walker hooks and required classifications.
- Task 2 acceptance greps passed for evaluator pre-scan wiring, dispatchMacroTool wiring, and hard-exclusion names.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 135 Plan 04 can wire public `call_macro` caller context, native catalog dispatch, and integration validation into the registry/pre-scan/evaluator surfaces implemented here.

## Self-Check: PASSED

- Created file exists: `src/macro/permission-prescan.ts`.
- Modified files exist: `src/macro/evaluator.ts`, `tests/unit/macro-permission-prescan.test.ts`.
- Task commits exist: `ec059e3`, `4764870`.
- Required verification command passed: `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher`.

---
*Phase: 135-tool-registry-dispatch-permissions*
*Completed: 2026-05-14*
