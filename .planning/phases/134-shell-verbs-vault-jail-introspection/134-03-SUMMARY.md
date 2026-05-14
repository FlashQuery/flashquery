---
phase: 134-shell-verbs-vault-jail-introspection
plan: 03
subsystem: macro
tags: [macro, shell-verbs, shelljs, fast-glob, vault-jail, vitest]

requires:
  - phase: 134-shell-verbs-vault-jail-introspection
    provides: Vault-jailed path wrapper and forbidden shell flag pre-scan
provides:
  - Read-only macro shell builtin registry for grep, find, sed, cat, wc, head, tail, and ls
  - Evaluator default shell builtin composition with vaultRoot and stage-local stdin
  - T-U-126 through T-U-136 plus T-U-143 and T-U-151 shell verb coverage
affects: [macro-evaluator, macro-shell-builtins, call_macro]

tech-stack:
  added: [shelljs, fast-glob, "@types/shelljs"]
  patterns:
    - Shell file/path arguments resolve through resolveMacroPath before host filesystem access
    - Pipelines pass stage-local stdin without mutating process-global cwd

key-files:
  created:
    - src/macro/shell-verbs.ts
    - .planning/phases/134-shell-verbs-vault-jail-introspection/134-03-SUMMARY.md
  modified:
    - package.json
    - package-lock.json
    - src/macro/evaluator.ts
    - tests/unit/macro-shell-verbs.test.ts

key-decisions:
  - "Kept shellBuiltins as the exact eight read-only verbs required by MACRO-SHELL-01."
  - "Implemented pipeline handoff by temporarily setting context.stdin per stage and restoring it immediately after each call."
  - "Used absolute vault-jailed host paths for ShellJS/fast-glob operations instead of mutating ShellJS or process cwd."

patterns-established:
  - "Macro shell builtins require context.vaultRoot for file-backed commands and return vault-rooted paths from find/recursive ls."
  - "Shell pipelines should be evaluated as RHS expressions before exit because exit terminates the current pipeline stage."

requirements-completed: [MACRO-SHELL-01, MACRO-SHELL-04]

duration: 7min
completed: 2026-05-14
---

# Phase 134 Plan 03: Shell Verbs and Cwd Retirement Summary

**ShellJS-backed read-only macro shell verbs with vault-jailed paths, pipeline stdin handoff, and no cwd mutation**

## Performance

- **Duration:** 7min
- **Started:** 2026-05-14T16:32:00Z
- **Completed:** 2026-05-14T16:39:10Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added T-U-126 through T-U-136, T-U-143, and T-U-151 coverage for shell verb behavior, registry absence of mutation verbs, glob handling, pipelines, static cwd scan, and concurrent vault-root isolation.
- Added `shellBuiltins` with exactly `cat`, `find`, `grep`, `head`, `ls`, `sed`, `tail`, and `wc`, backed by ShellJS/fast-glob and the Phase 134 vault jail path helpers.
- Wired evaluator defaults to merge `standardBuiltins` + `shellBuiltins`, expose `vaultRoot`, and pass/restores stage-local `stdin` for pipeline execution.

## Task Commits

1. **Task 1: Add shell verb and cwd-retirement tests** - `8d8f7ff` (test)
2. **Task 2: Implement shell builtins, dependencies, and evaluator pipeline wiring** - `a8dfc07` (feat)

## Files Created/Modified

- `src/macro/shell-verbs.ts` - Read-only shell builtin registry and helpers for grep/find/sed/cat/wc/head/tail/ls.
- `src/macro/evaluator.ts` - Adds default shell builtin merge, `vaultRoot`, `stdin`, and stage-local pipeline stdin handling.
- `tests/unit/macro-shell-verbs.test.ts` - Hermetic temp-vault tests covering T-U-126 through T-U-136, T-U-143, and T-U-151.
- `package.json` - Adds `shelljs`, `fast-glob`, and `@types/shelljs`.
- `package-lock.json` - Captures dependency resolution.

## Decisions Made

- Used stage-local `context.stdin` restoration around every pipeline stage to avoid shared process or invocation state.
- Kept file-backed commands hard-dependent on `vaultRoot` with `details.reason: "vault_root_required"` when missing.
- Treated fixture `TODO` strings in tests as data, not stubs.

## Verification

- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-shell-verbs.test.ts` - PASS, 12 tests.
- `npm run build` - PASS.
- `npx prettier --check src/macro/shell-verbs.ts src/macro/evaluator.ts tests/unit/macro-shell-verbs.test.ts package.json package-lock.json` - PASS.
- Acceptance greps for required test IDs, POC flag strings, shell implementation strings, evaluator wiring, dependencies, and absence of cwd mutation all passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected pipeline test shape for exit termination**
- **Found during:** Task 2 (Implement shell builtins, dependencies, and evaluator pipeline wiring)
- **Issue:** `exit cat file | grep PATTERN | wc -l` exits during the first stage because `exit` terminates evaluation immediately.
- **Fix:** Drove pipeline behavior as a RHS binding, then exited the bound result.
- **Files modified:** `tests/unit/macro-shell-verbs.test.ts`
- **Verification:** Focused shell verb suite passed.
- **Committed in:** `a8dfc07`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** No scope expansion; the fix aligns the tests with the existing parser/evaluator termination contract.

## Issues Encountered

- `npm install` reported 6 existing audit findings after dependency installation. They did not block this plan's focused verification and were left untouched as out of scope.
- Prettier initially reported formatting drift in touched files; formatting was applied before the implementation commit.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

MACRO-SHELL-01 and MACRO-SHELL-04 are complete. Later macro plans can depend on the exact read-only shell registry, vault-rooted shell path handling, pipeline stdin handoff, and cwd-retirement guarantees.

## Self-Check: PASSED

- Created files exist: `src/macro/shell-verbs.ts`, `tests/unit/macro-shell-verbs.test.ts`, `.planning/phases/134-shell-verbs-vault-jail-introspection/134-03-SUMMARY.md`.
- Task commits found in git history: `8d8f7ff`, `a8dfc07`.
- Focused unit verification passed after summary creation: `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-shell-verbs.test.ts`.

---
*Phase: 134-shell-verbs-vault-jail-introspection*
*Completed: 2026-05-14*
