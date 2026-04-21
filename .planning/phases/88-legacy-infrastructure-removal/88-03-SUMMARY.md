---
phase: 88-legacy-infrastructure-removal
plan: "03"
subsystem: storage/schema
tags: [legacy-removal, ddl, schema-migration, supabase]
dependency_graph:
  requires: ["88-02"]
  provides: ["88-05"]
  affects: ["src/storage/supabase.ts"]
tech_stack:
  added: []
  patterns: ["idempotent DROP IF EXISTS DDL migration at startup"]
key_files:
  created: []
  modified:
    - src/storage/supabase.ts
    - tests/unit/supabase.test.ts
key_decisions:
  - "DROP TABLE fqc_change_queue placed before DROP COLUMN statements to satisfy FK constraint ordering (D-07)"
  - "Updated supabase.test.ts test to assert DROP behavior replacing the stale ADD COLUMN assertion"
metrics:
  duration: "145s"
  completed: "2026-04-21T11:59:00Z"
  tasks_completed: 1
  tasks_total: 2
  files_changed: 2
---

# Phase 88 Plan 03: Legacy DDL Cleanup — DROP push-notification infrastructure Summary

Startup DDL in supabase.ts now drops fqc_change_queue table and three legacy columns (watcher_claims, needs_discovery, discovery_status) on every server start via idempotent IF EXISTS guards; all obsolete ADD COLUMN and CREATE TABLE statements removed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add DROP statements and remove legacy DDL from supabase.ts | 8ff8c55 | src/storage/supabase.ts, tests/unit/supabase.test.ts |

## Checkpoint Pending

| Task | Type | Status |
|------|------|--------|
| 2 | checkpoint:human-verify | Awaiting user verification |

The human-verify checkpoint requires the user to start the server (`npm run dev`) and confirm via SQL query that `fqc_change_queue` does not exist and the three columns are absent from `fqc_documents`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated stale test assertion in supabase.test.ts**
- **Found during:** Task 1 — `npm test` run post-edit
- **Issue:** Test `adds needs_discovery column to fqc_documents` asserted the ADD COLUMN statement still exists, but the plan intentionally removes it
- **Fix:** Replaced test with `drops legacy push-notification infrastructure (Phase 88 LEGACY-07)` which asserts all four DROP statements are present and all legacy ADD COLUMN / CREATE TABLE statements are absent
- **Files modified:** tests/unit/supabase.test.ts
- **Commit:** 8ff8c55

## Known Stubs

None — no UI or data-rendering stubs introduced.

## Threat Flags

None — DROP IF EXISTS guards are idempotent; threat T-88-03 accepted per plan threat model.

## Self-Check: PASSED

- src/storage/supabase.ts exists with DROP statements: confirmed
- tests/unit/supabase.test.ts updated: confirmed
- Commit 8ff8c55 exists: confirmed
- All acceptance criteria grep checks: PASSED (4 DROP matches, 0 ADD COLUMN / CREATE TABLE legacy matches)
- Unit tests: 22 failures all pre-existing deferred (auth-middleware×6, git-manager×9, config×2, embedding×1, compound-tools×1, resolve-document×1, pending-plugin-review×1); supabase.test.ts: all pass
