---
phase: 133-standard-library-builtins
plan: 01
subsystem: macro-runtime
tags: [macro, preflight, input-var, evaluator]
requires:
  - phase: 132-evaluator-core
    provides: evaluator control-flow, AST execution, and termination envelopes
provides:
  - input_var preflight contract collection and validation
  - named-argument builtin dispatch contract
  - input_var runtime binding with null-presence semantics
affects: [macro-standard-library, macro-evaluator, macro-tests]
tech-stack:
  added: []
  patterns: [AST preflight traversal, named-argument builtin dispatch]
key-files:
  created: [src/macro/preflight.ts, tests/unit/macro-preflight.test.ts]
  modified: [src/macro/evaluator.ts, tests/unit/macro-test-helpers.ts]
key-decisions:
  - "Kept input_var runtime binding evaluator-owned for Plan 01, with standardBuiltins integration deferred to Plan 02."
  - "Added compatibility wrapping in unit helper extras so existing tests using the old two-argument callback shape still exercise evaluator behavior."
patterns-established:
  - "Preflight modules throw MacroPreflightError and evaluator maps it through jsonExpectedError."
  - "Input presence checks use Object.prototype.hasOwnProperty.call so explicit null remains a provided value."
requirements-completed: [MACRO-SRC-07, MACRO-SRC-08, MACRO-BI-04]
duration: 3 min
completed: 2026-05-14
---

# Phase 133 Plan 01: Input Preflight and Builtin Dispatch Summary

**Input variable contract scanning with named-argument builtin dispatch and null-safe caller input validation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-14T14:40:34Z
- **Completed:** 2026-05-14T14:42:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added T-U-097 through T-U-108 coverage for required inputs, missing-input aggregation, defaults, explicit null, list/object defaults, extras, loops, and nested field access.
- Created `src/macro/preflight.ts` with `collectInputVarContract`, `validateInputVars`, and `MacroPreflightError`.
- Extended the evaluator builtin contract to pass positional args, named args, and invocation context while preserving existing macro behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add input_var preflight contract tests** - `3446d13` (test)
2. **Task 2: Implement preflight and named-arg builtin dispatch** - `8d21291` (feat)

## Files Created/Modified

- `src/macro/preflight.ts` - AST traversal, input_var contract collection, literal default conversion, and missing-input validation.
- `src/macro/evaluator.ts` - Named-argument builtin dispatch, preflight execution path, and temporary input_var runtime binding.
- `tests/unit/macro-preflight.test.ts` - T-U-097 through T-U-108 unit coverage.
- `tests/unit/macro-test-helpers.ts` - Test helper support for the new builtin signature and existing callback tests.

## Decisions Made

- Kept `input_var` evaluator-owned for this plan so Plan 01 can pass before the standard builtin registry is introduced in Plan 02.
- Preserved compatibility in `basicBuiltins` for older two-argument test callbacks to keep unrelated unit coverage focused on evaluator behavior.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

One existing unit helper shape passed the named-args object as the old context parameter after the evaluator contract changed. The helper now adapts two-argument callback tests while production builtins use the new three-argument contract.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can import a production `standardBuiltins` registry, move `input_var` into that registry, and use the established named-argument dispatch path.

---
*Phase: 133-standard-library-builtins*
*Completed: 2026-05-14*
