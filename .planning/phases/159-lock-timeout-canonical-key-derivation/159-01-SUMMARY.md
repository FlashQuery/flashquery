---
phase: 159-lock-timeout-canonical-key-derivation
plan: 1
subsystem: document-lock
tags: [req-003, canonical-lock-key, unit-tests]
key-files:
  created:
    - tests/unit/lock-key-derivation.test.ts
  modified:
    - src/services/document-lock.ts
    - tests/unit/lock-helper-only.test.ts
    - tests/unit/document-lock-registry.test.ts
metrics:
  tests: "npm test -- tests/unit/lock-key-derivation.test.ts tests/unit/lock-timeout.test.ts tests/unit/config-loader.test.ts tests/unit/document-lock-tier2.test.ts tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts --testNamePattern \"canonical-key|case-fold|T-U-006|T-U-007|T-U-008|T-U-009|T-U-010|T-U-014|T-U-015|T-U-016|T-U-017|T-U-018|ttl_seconds|lock_timeout|lock-timeout|document lock facade\""
---

## Summary

Implemented REQ-003 canonical file and directory lock resource derivation in `src/services/document-lock.ts`.

## Changes

| Area | Result |
|------|--------|
| Canonical paths | Existing files use realpath, missing destinations use real parent plus basename, and relative inputs resolve against the vault root. |
| Case behavior | Per-vault case-sensitivity probe caches filesystem behavior and folds canonical resources only when needed. |
| Namespaces | Lock resources now use `file:` and `dir:` namespaces before striping and advisory hashing. |
| Test surface | Added narrow `__testing` derivation helpers and updated the export guard to permit only that test namespace. |

## Verification

- Targeted REQ-003/REQ-006 unit slice passed: 5 files passed, 1 skipped; 19 tests passed, 3 skipped.
- Full unit suite passed: 167 files, 2086 tests.
- `npm run typecheck` passed.

## Deviations

None.

## Self-Check

PASSED
