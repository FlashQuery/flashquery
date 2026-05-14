---
phase: 134-shell-verbs-vault-jail-introspection
reviewed: 2026-05-14T16:57:09Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/macro/path-wrapper.ts
  - src/macro/forbidden-flag-scan.ts
  - src/macro/shell-verbs.ts
  - src/macro/introspection.ts
  - src/macro/evaluator.ts
  - src/macro/parser.ts
  - src/macro/types.ts
  - tests/unit/macro-path-wrapper.test.ts
  - tests/unit/macro-forbidden-flags.test.ts
  - tests/unit/macro-shell-verbs.test.ts
  - tests/unit/macro-introspection.test.ts
  - tests/unit/macro-parser.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
resolved_findings:
  critical: 2
---

# Phase 134: Code Review Report

**Reviewed:** 2026-05-14T16:57:09Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** clean after fixes

## Summary

Reviewed Phase 134 macro source and focused unit tests for shell verbs, vault path jail, forbidden shell flag scanning, parser/evaluator introspection, and parser expectation updates. The review found two BLOCKER defects in the shell path boundary: symlinks could escape the vault jail, and missing paths could be silently treated as successful reads/listings. Both findings are now resolved.

## Critical Issues

### CR-01: BLOCKER - Vault Jail Can Be Bypassed Through Symlinks

**File:** `src/macro/path-wrapper.ts:13`
**Issue:** `assertInsideVault()` performs only lexical `path.resolve` / `path.normalize` containment checks. Callers then pass those paths to ShellJS and fast-glob in `src/macro/shell-verbs.ts:204` and `src/macro/shell-verbs.ts:218`, both of which can follow symlinks. A symlink stored inside the vault that points to `/etc/passwd` or another outside file still has a macro path like `/link.txt`, passes the jail check, and is read by `cat`, `grep`, `sed`, `wc`, `head`, or `tail`. A symlinked directory also lets glob expansion traverse outside the vault while returning paths that still look vault-rooted. The tests in `tests/unit/macro-path-wrapper.test.ts:56` and `tests/unit/macro-shell-verbs.test.ts:163` cover `..` and normal globs but do not cover symlink escapes.

**Fix:**
Resolve real filesystem paths before allowing access. For every non-glob host path and every fast-glob match, compare `realpath` of the target with `realpath` of the vault root before reading/listing. For glob patterns, keep lexical rejection for the pattern, then realpath-check each match before adding it to `output`.

```typescript
import { realpathSync } from 'node:fs';

function assertRealPathInsideVault(hostPath: string, vaultRoot: string, originalPath: string): string {
  const realRoot = realpathSync(vaultRoot);
  const realTarget = realpathSync(hostPath);
  return assertInsideVault(realTarget, realRoot, originalPath);
}
```

Add regression tests for a file symlink and a symlinked directory under the vault that point outside the vault; both should return `forbidden_path`.

**Resolution:** Fixed in `src/macro/path-wrapper.ts` and `src/macro/shell-verbs.ts` by adding realpath containment checks for direct shell filesystem access and disabling symlink following in glob/list traversal. Covered by new symlink regression tests in `tests/unit/macro-path-wrapper.test.ts` and `tests/unit/macro-shell-verbs.test.ts`.

### CR-02: BLOCKER - Missing Shell Paths Succeed Instead Of Returning Errors

**File:** `src/macro/shell-verbs.ts:205`
**Issue:** `readTextEntries()` ignores the `ShellString.code` / `stderr` returned by `sh.cat(hostPath)`, so a missing file is converted to `""` and the macro succeeds. This affects `cat`, `grep`, `sed`, `wc`, `head`, and `tail` because they all read through this helper. `ls -d` has the same issue at `src/macro/shell-verbs.ts:148`: it returns `["/missing"]` without checking whether the path exists. The tests only assert happy-path reads/listings in `tests/unit/macro-shell-verbs.test.ts:78` and `tests/unit/macro-shell-verbs.test.ts:111`, so this regression is not caught.

**Fix:**
Validate existence/readability before returning command output, and surface a stable runtime error for missing or unreadable paths. Apply the same check before the `ls -d` early return.

```typescript
const result = sh.cat(hostPath);
if (result.code !== 0) {
  throw new MacroRuntimeError('Shell path could not be read.', undefined, {
    reason: 'path_read_failed',
    path: macroPath,
    stderr: result.stderr,
  });
}
```

Add tests for `cat "/missing.md"`, `grep "x" "/missing.md"`, and `ls -d "/missing"` expecting an error rather than an empty result or fabricated path.

**Resolution:** Fixed in `src/macro/shell-verbs.ts` by validating shell paths before reads/listing and returning stable `path_not_found` runtime errors. Covered by missing-path regression tests in `tests/unit/macro-shell-verbs.test.ts`.

## Verification After Fixes

- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-path-wrapper.test.ts tests/unit/macro-shell-verbs.test.ts` - PASS, 2 files / 25 tests.
- `npm run build` - PASS.
- `npx vitest run --config tests/config/vitest.unit.config.ts tests/unit/macro-*.test.ts` - PASS, 16 files / 200 tests.
- `npm test` - PASS, 109 files / 1665 tests.

---

_Reviewed: 2026-05-14T16:57:09Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
