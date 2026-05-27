---
phase: 160-folder-locks-manage-directory-migration
plan: 03
subsystem: mcp-tools
tags: [manage-directory, advisory-locks, integration]
requires:
  - phase: 160-folder-locks-manage-directory-migration
    provides: shared/exclusive directory lock helpers and shared file-write locks
provides:
  - manage_directory rename/move workflow
  - exclusive source directory locks for rename/move/remove
  - folder advisory integration test files
affects: [manage-directory, folder-coordination]
tech-stack:
  added: []
  patterns: [ordered per-path result envelopes for structural folder locks]
key-files:
  created:
    - tests/integration/folder-lock.integration.test.ts
    - tests/integration/manage-directory-advisory-lock.integration.test.ts
  modified:
    - src/mcp/tools/files.ts
    - tests/unit/manage-directory.test.ts
    - tests/config/vitest.integration.config.ts
requirements-completed: [REQ-007, REQ-024]
duration: 21 min
completed: 2026-05-27
---

# Phase 160 Plan 03: Manage Directory Advisory Locks Summary

**Public `manage_directory` rename/move plus exclusive advisory locks for structural folder operations**

## Accomplishments

- Added `rename` and `move` action support with positional `destinations`.
- Wrapped remove/rename/move structural operations in `withDirectoryLockExclusive`.
- Kept `create` exclusive-lock-free and idempotent.
- Added unit and integration evidence for T-I-011, T-I-046, and T-I-047.

## Task Commits

1. **Task 1: Manage directory tests** - `6a1d5ee`
2. **Task 2: Integration evidence** - `a1277db`

## Deviations from Plan

Vitest integration evidence skipped in this environment because `.env.test` uses a transaction-pooler DATABASE_URL, so session advisory locks cannot be proven there. The files are registered and skip via the existing session-capability gate.

## Issues Encountered

Managed scenario testing exposed a macOS `/var` vs `/private/var` canonicalization issue in ancestor directory enumeration; fixed in `src/services/document-lock.ts`.

## Next Phase Readiness

Plan 04 can record scenario-level INT-WCO-01 evidence and final validation.
