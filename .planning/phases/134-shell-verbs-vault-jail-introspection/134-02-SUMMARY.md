---
phase: 134-shell-verbs-vault-jail-introspection
plan: 02
subsystem: macro-security
tags: [macro, shell-verbs, preflight, vitest]

requires:
  - phase: 133-standard-library-builtins
    provides: macro evaluator, parser, and shell builtin names
provides:
  - Forbidden shell flag AST pre-scan for sed and find
  - Evaluator pre-execution wiring before existing preflight and execution
  - T-U-144 through T-U-150 unit coverage for MACRO-SHELL-03
affects: [macro-evaluator, macro-shell-verbs, call_macro]

tech-stack:
  added: []
  patterns:
    - Recursive AST visitor preflight module
    - Expected-error envelope via MacroExpectedError

key-files:
  created:
    - src/macro/forbidden-flag-scan.ts
    - tests/unit/macro-forbidden-flags.test.ts
  modified:
    - src/macro/evaluator.ts

key-decisions:
  - "Run forbidden shell flag scanning before existing macro preflight so no statement, trace, log, or progress side effects can occur first."
  - "Detect both parser-expanded named flags and quoted positional string flag spellings for sed/find mutation options."

patterns-established:
  - "Macro security pre-scans live in dedicated visitor modules and throw MacroExpectedError for branchable expected failures."

requirements-completed: [MACRO-SHELL-03]

duration: 4m40s
completed: 2026-05-14
---

# Phase 134 Plan 02: Forbidden Shell Flags Summary

**AST pre-scan rejects mutating sed/find flags before macro execution can emit side effects**

## Performance

- **Duration:** 4m40s
- **Started:** 2026-05-14T16:25:08Z
- **Completed:** 2026-05-14T16:29:48Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added T-U-144 through T-U-150 evaluator-driven tests for `sed -i`, `sed --in-place`, bundled `sed -ie`, `find -exec`, and `find -delete`.
- Implemented `preScanForbiddenShellFlags(program)` with recursive traversal across statements, loops, conditionals, bindings, pipelines, tool call args, and nested expressions.
- Wired the scanner into `evaluateProgram` before existing macro preflight and `execBlock`, with T-U-150 proving no prior `echo "before"` log or trace output is emitted.

## Task Commits

1. **Task 1: Add forbidden flag scanner tests** - `19319b2` (test)
2. **Task 2: Implement forbidden flag scan and evaluator preflight wiring** - `493a571` (feat)

## Files Created/Modified

- `src/macro/forbidden-flag-scan.ts` - Recursive AST scanner rejecting forbidden sed/find mutation flags with `forbidden_shell_flag`.
- `src/macro/evaluator.ts` - Calls `preScanForbiddenShellFlags(program)` before existing preflight and execution.
- `tests/unit/macro-forbidden-flags.test.ts` - T-U-144 through T-U-150 coverage plus an allowed-flags regression check.

## Decisions Made

- Scanner handles both named args produced by parser flag tokens and positional string literals like `"-i"`, `"--exec"`, and `"--delete"`.
- `line` details use the call's parsed line number, matching existing macro error location behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- T-U-149 initially expected the nested forbidden call at line 5, but `parseProgram(source.trim())` makes the parsed call line 4. The test was corrected during the GREEN step.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-forbidden-flags.test.ts` - passed, 8 tests.
- Acceptance greps for T-U-144 through T-U-150, required reason strings, `case 'WhileLoop'`, and evaluator wiring all passed.

## Next Phase Readiness

MACRO-SHELL-03 is complete. Later shell verb implementation can rely on evaluator preflight rejecting mutating sed/find flags before runtime dispatch.

## Self-Check: PASSED

- Created files exist: `src/macro/forbidden-flag-scan.ts`, `tests/unit/macro-forbidden-flags.test.ts`.
- Modified file contains evaluator wiring: `preScanForbiddenShellFlags(program)`.
- Task commits found: `19319b2`, `493a571`.

---
*Phase: 134-shell-verbs-vault-jail-introspection*
*Completed: 2026-05-14*
