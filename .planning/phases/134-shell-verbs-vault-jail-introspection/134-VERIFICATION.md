---
phase: 134-shell-verbs-vault-jail-introspection
status: passed
verified: 2026-05-14T17:05:00Z
requirements:
  - MACRO-SHELL-01
  - MACRO-SHELL-02
  - MACRO-SHELL-03
  - MACRO-SHELL-04
  - MACRO-SHELL-05
score: 5/5
human_verification: []
---

# Phase 134 Verification

## Verdict

Status: passed

Phase 134 delivers the shell verb, vault jail, forbidden flag, cwd-retirement, and `_exists()` introspection requirements. All five plans have summaries, code-review blockers were resolved, and automated validation is green.

## Requirement Coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| MACRO-SHELL-01 | `src/macro/shell-verbs.ts` exports exactly `grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, and `ls`; `tests/unit/macro-shell-verbs.test.ts` covers T-U-126 through T-U-136. | passed |
| MACRO-SHELL-02 | `src/macro/path-wrapper.ts` provides `resolveMacroPath`, `toMacroPath`, and realpath containment; shell reads/listing check real paths before access; tests cover lexical escapes, symlink escapes, and glob behavior. | passed |
| MACRO-SHELL-03 | `src/macro/forbidden-flag-scan.ts` rejects forbidden `sed` and `find` mutation flags before execution; evaluator calls `preScanForbiddenShellFlags(program)` before runtime execution. | passed |
| MACRO-SHELL-04 | `src/macro/shell-verbs.ts` avoids `sh.cd`, `shelljs.cd`, and `process.chdir`; static T-U-143 and concurrent T-U-151 prove cwd preservation. | passed |
| MACRO-SHELL-05 | `src/macro/introspection.ts`, parser/types/evaluator support native `fq._exists()` and brokered `<server>._exists()` without tool dispatch or caching; tests cover T-U-152 through T-U-155. | passed |

## Automated Gates

- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts tests/unit/macro-forbidden-flags.test.ts tests/unit/macro-introspection.test.ts` - passed, 4 files / 33 tests before review fixes.
- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts` - passed, 2 files / 25 tests after review fixes.
- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-*.test.ts` - passed, 16 files / 200 tests.
- `npm run build` - passed.
- `npm test` - passed, 109 files / 1665 tests.
- Schema drift check - `drift_detected: false`.
- Codebase drift check - skipped, `no-structure-md`.

## Review Closure

`134-REVIEW.md` initially found two blockers:

- Symlink bypass of the vault jail.
- Missing shell paths succeeding silently.

Both were fixed in `fix(134): harden shell path boundary` with realpath containment, no-follow traversal, stable `path_not_found` errors, and regression coverage. Review status is now clean.

## Scope Guard

Phase 134 does not claim MACRO-DISP-01 through MACRO-DISP-07. Namespaced dispatch permissions, dispatch backstops, and hard exclusions remain Phase 135 work.

## Gaps

None.
