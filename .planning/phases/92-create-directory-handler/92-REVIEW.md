---
phase: 92-create-directory-handler
reviewed: 2026-04-24T16:41:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/mcp/tools/files.ts
  - src/mcp/utils/path-validation.ts
  - src/mcp/server.ts
  - tests/unit/files-tools.test.ts
  - tests/scenarios/directed/testcases/test_create_directory.py
  - tests/scenarios/directed/testcases/test_create_directory_batch.py
  - tests/scenarios/directed/testcases/test_create_directory_root_path.py
  - tests/scenarios/directed/testcases/test_create_directory_normalization.py
  - tests/scenarios/directed/testcases/test_create_directory_sanitization.py
  - tests/scenarios/directed/testcases/test_create_directory_rejection.py
  - tests/scenarios/directed/testcases/test_create_directory_special.py
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 92: Code Review Report

**Reviewed:** 2026-04-24T16:41:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 92 delivers the `create_directory` MCP tool: a pure filesystem primitive with batch support, per-segment sanitization, idempotency, partial-success semantics, and a comprehensive scenario test suite (F-19 through F-52). The implementation is well-structured, the unit tests all pass (9/9), and the security-critical path (traversal, symlink, absolute path rejection) is correct.

One warning-level logic bug was found: the total-path byte-length check at `files.ts:173` (Step C) is dead code — `validateVaultPath` at line 165 performs the same check first and short-circuits via `continue` before Step C is ever reached. This means the more informative error message (which includes the actual byte count) is never shown to users. Three info-level items were also found: an unused import in every scenario test file, a cosmetic response inconsistency for `root_path` values containing sanitizable characters, and a fragile relative path in the DIR-10 source-inspection test.

---

## Warnings

### WR-01: Step C total-path byte check is unreachable dead code

**File:** `src/mcp/tools/files.ts:165-175`

**Issue:** `validateVaultPath` (called at line 165) already checks `Buffer.byteLength(normalized) > 4096` and returns `valid: false` when the path is too long. Back in the handler, line 166 tests `if (!validation.valid)` and executes `continue`, so execution never reaches the Step C guard at line 173. The dead block is:

```typescript
// Step C: Total-path byte-length check (4096-byte limit — T-92-07)
const totalBytes = Buffer.byteLength(sanitizedPath, 'utf8');
if (totalBytes > 4096) {
  results.push({ kind: 'failed', original: originalInput, error: `Resolved path exceeds the 4,096-byte filesystem limit (${totalBytes} bytes).` });
  continue;
}
```

Two consequences: (1) this block can never be reached; (2) the error message from `validateVaultPath` (`'Path is too long — exceeds 4096-byte limit.'`) lacks the `(N bytes)` detail that Step C's message would have provided. The F-46 scenario test still passes because it matches on the substring `'4096'`.

**Fix:** Either remove Step C entirely (it is redundant), or reorder so Step C runs before `validateVaultPath` is called. Reordering is the better fix because it restores the informative `(N bytes)` message:

```typescript
// Step C: Total-path byte-length check — run BEFORE validateVaultPath
const totalBytes = Buffer.byteLength(sanitizedPath, 'utf8');
if (totalBytes > 4096) {
  results.push({ kind: 'failed', original: originalInput, error: `Resolved path exceeds the 4,096-byte filesystem limit (${totalBytes} bytes).` });
  continue;
}

// Step B: Validate the sanitized path (traversal, symlink, vault-root target)
const validation = await validateVaultPath(vaultRoot, sanitizedPath);
```

---

## Info

### IN-01: `expectation_detail` imported but never used in all seven scenario test files

**File:** All seven `tests/scenarios/directed/testcases/test_create_directory*.py`, line 35 (or 37)

**Issue:** Every scenario test file imports `expectation_detail` from `fqc_test_utils` but the function is never called in any of them. The import is copy-pasted from the template and was never cleaned up.

**Fix:** Remove `expectation_detail` from the import line in each of the seven files:

```python
# Before
from fqc_test_utils import TestContext, TestRun, expectation_detail

# After
from fqc_test_utils import TestContext, TestRun
```

Affected files:
- `test_create_directory.py:35`
- `test_create_directory_batch.py:35`
- `test_create_directory_root_path.py:35`
- `test_create_directory_normalization.py:35`
- `test_create_directory_sanitization.py:35`
- `test_create_directory_rejection.py:37`
- `test_create_directory_special.py:35`

---

### IN-02: `Root:` response line shows pre-sanitization `root_path` value

**File:** `src/mcp/tools/files.ts:253`

**Issue:** The `Root:` line in the response is built from `normalizedRoot` (the result of `normalizePath(root_path)`), which has not been processed by `sanitizeDirectorySegment`. If a caller passes `root_path='proj:folder'`, the response shows `Root: proj:folder/` while the directories are actually created under `proj folder/` (colon sanitized to space). The actual filesystem operations are correct — the mismatch is limited to the informational `Root:` line in the response text.

**Fix:** Compute a sanitized version of `normalizedRoot` for display purposes, or display the sanitized path that was actually used:

```typescript
// After Step A sanitization produces sanitizedPath, extract the root prefix for display
// (Only needed if normalizedRoot is non-empty)
const displayRoot = normalizedRoot
  ? normalizedRoot.split('/').map(seg => sanitizeDirectorySegment(seg).sanitized).join('/')
  : '';
// ...
if (displayRoot) lines.push(`Root: ${displayRoot}/`);
```

---

### IN-03: DIR-10 source-inspection test uses a relative `readFileSync` path

**File:** `tests/unit/files-tools.test.ts:169`

**Issue:** The DIR-10 test reads `'src/mcp/tools/files.ts'` with a relative path:

```typescript
const source = readFileSync('src/mcp/tools/files.ts', 'utf8');
```

This works when Vitest runs from the project root (the normal case) but would silently fail or throw if the working directory changed. Other test files in the codebase that do source inspection should use `new URL(...)` or `path.resolve(import.meta.url, ...)` for robustness.

**Fix:**

```typescript
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '../../src/mcp/tools/files.ts'), 'utf8');
```

---

_Reviewed: 2026-04-24T16:41:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
