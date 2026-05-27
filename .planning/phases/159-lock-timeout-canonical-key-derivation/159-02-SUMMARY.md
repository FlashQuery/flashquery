---
phase: 159-lock-timeout-canonical-key-derivation
plan: 2
subsystem: document-lock
tags: [req-006, lock-timeout, config]
key-files:
  created:
    - tests/unit/lock-timeout.test.ts
  modified:
    - src/config/types.ts
    - src/config/loader.ts
    - src/services/document-lock.ts
    - flashquery.example.yml
    - tests/unit/config-loader.test.ts
    - tests/unit/document-lock-tier2.test.ts
    - tests/unit/with-document-lock.test.ts
metrics:
  tests: "npm test; npm run typecheck; npm run build"
---

## Summary

Implemented REQ-006 bounded lock acquisition with `locking.lock_timeout_seconds` configuration.

## Changes

| Area | Result |
|------|--------|
| Config | Added `locking.lockTimeoutSeconds` runtime type and `locking.lock_timeout_seconds` Zod schema default/validation. |
| Timeout error | `LockTimeoutError` now carries `reason: lock_timeout`, resource, and timeout metadata. |
| Tier 1 / burst waits | Same-process queued/burst acquisition is bounded by the same helper deadline. |
| Tier 2 | Replaced unbounded `pg_advisory_lock` acquisition with a bounded `pg_try_advisory_lock` retry loop on one checked-out client. |
| Docs | Documented the default timeout in `flashquery.example.yml`. |

## Verification

- Full unit suite passed: 167 files, 2086 tests.
- `npm run typecheck` passed.
- `npm run build` passed.

## Deviations

The working tree already contained uncommitted `package.json` / `package-lock.json` dependency version edits; they were not required for this plan and were left unstaged.

## Self-Check

PASSED
