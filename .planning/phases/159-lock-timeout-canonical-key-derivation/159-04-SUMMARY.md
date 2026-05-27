---
phase: 159-lock-timeout-canonical-key-derivation
plan: 4
subsystem: document-tools
tags: [req-006, lock-timeout, batch-compound-tools]
key-files:
  modified:
    - src/mcp/tools/documents/archive.ts
    - src/mcp/tools/documents/remove.ts
    - src/mcp/tools/compound.ts
    - tests/unit/archive-document.test.ts
    - tests/unit/document-batch-lock-contention.test.ts
    - tests/unit/document-tool-lock-call-sites.test.ts
    - tests/unit/replace-doc-section.test.ts
metrics:
  tests: "npm test -- tests/unit/write-document.test.ts tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/advanced-document-tools.test.ts tests/unit/archive-document.test.ts tests/unit/document-batch-lock-contention.test.ts tests/unit/document-tool-lock-call-sites.test.ts tests/unit/replace-doc-section.test.ts --testNamePattern \"lock timeout|lock_timeout|lock call sites|archive_document|remove_document|copy_document|move_document|write_document|replace_doc_section\""
---

## Summary

Updated batch archive/remove and compound document mutation timeout envelopes to use `lock_timeout`.

## Changes

| Area | Result |
|------|--------|
| Batch archive/remove | Item-level `LockTimeoutError` results now return conflict envelopes with `details.reason: "lock_timeout"`. |
| Compound tools | Renamed timeout helper to `lockTimeoutError` and updated insert/link/tag/section mutation timeout paths. |
| Tests | Updated source-shape and behavior assertions for batch and compound timeout mappings. |

## Verification

- Targeted document tool envelope tests passed: 8 files, 46 tests passed, 2 skipped.
- Full unit suite passed: 167 files, 2086 tests.
- Grep of edited write paths found no remaining timeout-envelope `lock_contention` usage.

## Deviations

None.

## Self-Check

PASSED
