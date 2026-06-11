---
phase: 167-lifecycle-operations-and-validation
plan: 02
subsystem: maintenance
tags: [maintain-vault, lifecycle-jobs, postgres, embeddings, abort]

requires:
  - phase: 167-lifecycle-operations-and-validation
    provides: maintain_vault lifecycle input validation and max_rows contract from Plan 167-01
provides:
  - Durable fqc_maintenance_jobs schema for lifecycle lock/status/abort state
  - Per-entry running-job lock keyed by instance_id and embedding_name
  - Lifecycle job helper module for acquire, heartbeat, complete, fail, status, and abort
  - maintain_vault status/abort dispatch to durable lifecycle jobs
affects: [lifecycle-processors, maintain_vault, embedding-operator-recipes]

tech-stack:
  added: []
  patterns:
    - Durable lifecycle jobs return ErrorEnvelope-compatible expected errors at service boundaries
    - status checks durable lifecycle jobs before legacy in-memory jobs, then falls back on not_found
    - abort validates lifecycle-specific parameter rejection before durable job lookup

key-files:
  created:
    - src/embedding/lifecycle/jobs.ts
    - tests/integration/embedding/maintain-vault-lifecycle.test.ts
  modified:
    - src/storage/supabase.ts
    - src/services/maintenance.ts

key-decisions:
  - "Lifecycle locking uses fqc_maintenance_jobs with a partial unique index on running lifecycle rows instead of process-local state."
  - "Durable lifecycle helpers require supabase.databaseUrl and return an expected invalid_input configuration envelope before mutation when direct PostgreSQL is unavailable."
  - "maintain_vault status preserves legacy in-memory job behavior by falling back after durable not_found and by skipping durable lookup for non-UUID job ids."

patterns-established:
  - "Lifecycle job helpers own durable lock/status/abort mutation and expose MaintenanceStatus-compatible payloads."
  - "Stale heartbeat recovery marks the old running job failed with stale_heartbeat_recovered before acquiring a replacement lock."

requirements-completed: [REQ-038, REQ-039]

duration: ~7min
completed: 2026-06-11
---

# Phase 167 Plan 02: Lifecycle Operations and Validation Summary

**durable lifecycle job table with per-entry locks, heartbeat recovery, pollable status, and abort signaling**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-11T13:30:33Z
- **Completed:** 2026-06-11T13:37:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `fqc_maintenance_jobs` DDL with timestamps, heartbeat, abort signal, counts, failures, error, metadata, and a partial unique running lifecycle-job index.
- Added `src/embedding/lifecycle/jobs.ts` with acquire/conflict, heartbeat, complete, fail, status, abort, stale-lock recovery, and direct PostgreSQL precondition handling.
- Wired `maintain_vault({ action: "status" })` to check durable lifecycle jobs before legacy in-memory jobs and `maintain_vault({ action: "abort" })` to signal durable jobs after parameter validation.
- Added integration coverage for REQ-038/REQ-039 helper and service dispatch behavior.

## Task Commits

1. **Task 1 RED: lifecycle job helper coverage** - `e83bdf4` (test)
2. **Task 1 GREEN: durable lifecycle job locks** - `f9b3a42` (feat)
3. **Task 2 RED: maintain_vault lifecycle dispatch coverage** - `241b4ce` (test)
4. **Task 2 GREEN: status/abort service wiring** - `1bbc8cd` (feat)

## Files Created/Modified

- `src/embedding/lifecycle/jobs.ts` - Durable lifecycle job helpers for lock acquisition, heartbeat, terminal state updates, status polling, abort, and expected errors.
- `tests/integration/embedding/maintain-vault-lifecycle.test.ts` - REQ-038 and REQ-039 DDL, helper, and service dispatch coverage.
- `src/storage/supabase.ts` - `fqc_maintenance_jobs` schema, status check constraint, running-entry unique index, and status lookup index.
- `src/services/maintenance.ts` - Durable lifecycle status/abort dispatch while preserving legacy sync/repair/status behavior.

## Decisions Made

- Used a table-backed lock rather than advisory locks so status, heartbeat freshness, abort state, partial counts, and failure metadata survive process restarts.
- Marked stale running jobs as `failed` with `details.reason = "stale_heartbeat_recovered"` before inserting the replacement running job.
- Abort currently marks the durable job `aborted` and releases the partial unique lock immediately; later processors can still use `isLifecycleAbortRequested` and heartbeat helpers at checkpoints.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved legacy status behavior for non-UUID job ids**
- **Found during:** Task 2 verification
- **Issue:** The existing `maintain_vault` unit suite uses legacy/non-UUID job ids, and durable status lookup attempted a direct PostgreSQL connection for those ids when a dummy `databaseUrl` was present.
- **Fix:** Durable status lookup now runs only for UUID-shaped job ids and then falls back to legacy status on durable `not_found`.
- **Files modified:** `src/services/maintenance.ts`
- **Verification:** `npm run test:unit -- tests/unit/maintain-vault.test.ts` passed.
- **Committed in:** `1bbc8cd`

---

**Total deviations:** 1 auto-fixed bug.
**Impact on plan:** Preserved pre-existing legacy maintenance behavior while adding durable lifecycle dispatch.

## Issues Encountered

- `.env.test` loaded successfully, but `HAS_DIRECT_DATABASE_URL` was false in the shared test helper, so the live PostgreSQL integration cases in `maintain-vault-lifecycle.test.ts` skipped. The required command still exited 0 with DDL/no-direct-DB/service-validation coverage running.

## Known Stubs

- `src/services/maintenance.ts` still returns the existing expected `unsupported` placeholder for `backfill_embeddings`, `rebuild_embeddings`, and `retire_embedding` execution after validation. This is intentional: this plan provides the durable lifecycle foundation, while later Plan 167 processor work owns row/DDL execution.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: durable_lifecycle_lock_state | `src/storage/supabase.ts` | New `fqc_maintenance_jobs` table controls lifecycle lock, status, heartbeat, abort, counts, failures, and error state. |
| threat_flag: abort_dispatch | `src/services/maintenance.ts` | Caller-provided `job_id` can signal durable lifecycle abort after parameter validation. |

## Verification

- `npm run test:integration -- tests/integration/embedding/maintain-vault-lifecycle.test.ts` - passed (4 passed, 5 skipped due no direct `.env.test` database URL).
- `npm run typecheck` - passed.
- `npm run test:unit -- tests/unit/maintain-vault.test.ts` - passed (17 tests).

## Self-Check: PASSED

- Created files exist: `src/embedding/lifecycle/jobs.ts`, `tests/integration/embedding/maintain-vault-lifecycle.test.ts`.
- Modified files exist: `src/storage/supabase.ts`, `src/services/maintenance.ts`.
- Commits exist: `e83bdf4`, `f9b3a42`, `241b4ce`, `1bbc8cd`.
- Required plan checks passed: targeted integration test and typecheck.

## User Setup Required

None - no new external service configuration required. Live direct-PostgreSQL integration branches require `.env.test` to expose a non-pooler direct database URL.

## Next Phase Readiness

Backfill, rebuild, and retire processor plans can acquire durable per-entry locks, heartbeat progress, persist partial counts/failures, poll status through `maintain_vault`, and release locks through completion, failure, or abort.

---
*Phase: 167-lifecycle-operations-and-validation*
*Completed: 2026-06-11*
