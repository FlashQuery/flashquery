---
phase: 159-lock-timeout-canonical-key-derivation
plan: 3
subsystem: document-tools
tags: [req-006, lock-timeout, single-document-tools]
key-files:
  modified:
    - src/mcp/tools/documents/write.ts
    - src/mcp/tools/documents/copy.ts
    - src/mcp/tools/documents/move.ts
    - tests/unit/copy-document.test.ts
    - tests/unit/move-document.test.ts
metrics:
  tests: "npm test -- tests/unit/write-document.test.ts tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/advanced-document-tools.test.ts tests/unit/archive-document.test.ts tests/unit/document-batch-lock-contention.test.ts tests/unit/document-tool-lock-call-sites.test.ts tests/unit/replace-doc-section.test.ts --testNamePattern \"lock timeout|lock_timeout|lock call sites|archive_document|remove_document|copy_document|move_document|write_document|replace_doc_section\""
---

## Summary

Updated single-document write/copy/move timeout envelopes to expose `details.reason: "lock_timeout"`.

## Changes

| Tool | Result |
|------|--------|
| `write_document` | `LockTimeoutError` maps to a conflict envelope with `lock_timeout`. |
| `copy_document` | Timeout conflict reason changed to `lock_timeout`; unrelated path/tag errors unchanged. |
| `move_document` | Timeout conflict reason changed to `lock_timeout`; path_exists, identical_path, and untracked_document behavior unchanged. |

## Verification

- Targeted document tool envelope tests passed: 8 files, 46 tests passed, 2 skipped.
- Full unit suite passed: 167 files, 2086 tests.

## Deviations

None.

## Self-Check

PASSED
