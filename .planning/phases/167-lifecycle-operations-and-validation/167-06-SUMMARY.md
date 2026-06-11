---
phase: 167-lifecycle-operations-and-validation
plan: 06
subsystem: testing
tags: [directed-scenarios, maintain-vault, lifecycle-locks, heartbeat, abort]

requires:
  - phase: 167-lifecycle-operations-and-validation
    provides: durable lifecycle jobs, core lifecycle processors, records lifecycle execution, and public maintain_vault dispatch from Plans 167-02 through 167-05
provides:
  - Public directed scenario D-114 for same-entry lifecycle conflict and different-entry parallelism
  - Public directed scenario D-115 for stale heartbeat recovery and lock reuse
  - Public directed scenario D-116 for background lifecycle abort, partial counts, preserved rows, and lock release
  - Public directed scenario D-117 for abort expected-error envelopes
affects: [maintain_vault, lifecycle-validation, operator-recipes]

tech-stack:
  added: []
  patterns:
    - Directed lifecycle scenarios force dedicated managed embedding-enabled servers when catalog configuration matters.
    - Stale heartbeat scenario uses managed-test-only PostgreSQL setup, then verifies recovery through public maintain_vault calls.

key-files:
  created:
    - tests/scenarios/directed/testcases/test_lifecycle_lock_per_entry.py
    - tests/scenarios/directed/testcases/test_lifecycle_lock_heartbeat.py
    - tests/scenarios/directed/testcases/test_abort_background_job.py
    - tests/scenarios/directed/testcases/test_abort_unknown_job.py
  modified: []

key-decisions:
  - "Lifecycle lock and abort validation stays at the public maintain_vault surface; direct PostgreSQL is used only for managed scenario setup/inspection."
  - "Endpoint rate limits are injected in lock/abort scenarios to create deterministic background-job contention windows."

patterns-established:
  - "Scenario-level slow catalog configs use rate_limit.min_delay_ms to make lifecycle contention and abort checkpoints observable without production test hooks."

requirements-completed: [REQ-038, REQ-039]

duration: ~20min
completed: 2026-06-11
---

# Phase 167 Plan 06: Lifecycle Lock, Heartbeat, and Abort Scenario Summary

**Public directed scenarios for lifecycle lock conflicts, stale heartbeat recovery, and abort status semantics**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-11T15:27:54Z
- **Completed:** 2026-06-11T15:47:43Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added D-114 to verify same-entry lifecycle calls return `conflict` with `in_flight_action`, `in_flight_job_id`, `started_at`, and `elapsed_ms`, while different entries can run independently.
- Added D-115 to verify a stale durable heartbeat is marked failed and a new public caller can acquire the lifecycle lock.
- Added D-116 to verify aborting a background rebuild leaves partial counts/status visible, preserves completed row stamps, stops before all rows process, and releases the lock.
- Added D-117 to verify abort expected-error envelopes for unknown, completed, and already-aborted lifecycle jobs, plus abort parameter rejection.

## Task Commits

1. **Task 1: Add per-entry lock and heartbeat scenarios** - `5c886cb` (test)
2. **Task 2: Add abort scenarios** - `fd88244` (test)

**Plan metadata:** included in the final docs commit.

## Files Created/Modified

- `tests/scenarios/directed/testcases/test_lifecycle_lock_per_entry.py` - D-114 same-entry conflict, different-entry background parallelism, and post-completion lock reuse.
- `tests/scenarios/directed/testcases/test_lifecycle_lock_heartbeat.py` - D-115 managed stale heartbeat setup and public recovery verification.
- `tests/scenarios/directed/testcases/test_abort_background_job.py` - D-116 background rebuild abort, partial counts, preserved stamps, and lock-release follow-up.
- `tests/scenarios/directed/testcases/test_abort_unknown_job.py` - D-117 unknown/completed/already-aborted abort expected-error coverage.
- `.planning/STATE.md` - Manual plan-completion handoff update because `gsd-sdk` is unavailable on PATH.

## Decisions Made

- Used public `maintain_vault` calls for all lifecycle start, conflict, abort, status, and follow-up lock acquisition assertions.
- Used managed-test-only PostgreSQL setup for D-115 to simulate a crashed process with a heartbeat older than the production stale threshold.
- Injected per-endpoint rate limits in D-114 and D-116 scenario configs so background jobs remain observable long enough for conflict and abort assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added deterministic contention windows to lifecycle scenarios**
- **Found during:** Task 1 and Task 2 scenario design
- **Issue:** Backfill/rebuild jobs can complete too quickly for conflict and abort assertions to observe an in-flight state reliably.
- **Fix:** Scenario-managed catalog configs inject `rate_limit.min_delay_ms` for lifecycle embedding endpoints.
- **Files modified:** `tests/scenarios/directed/testcases/test_lifecycle_lock_per_entry.py`, `tests/scenarios/directed/testcases/test_abort_background_job.py`
- **Verification:** Final plan verification passed both directed suites.
- **Committed in:** `5c886cb`, `fd88244`

---

**Total deviations:** 1 auto-fixed missing critical test determinism issue.
**Impact on plan:** No production scope expansion; scenarios remain public-surface lifecycle validation.

## Issues Encountered

- `gsd-sdk` was unavailable on PATH, matching prior Phase 167 executions, so STATE was updated manually. ROADMAP.md was intentionally not updated per execution instruction.
- Task-level `tdd="true"` RED/GREEN commits were not split because this plan adds public directed scenarios over already-landed implementation. The scenario commits were still atomic by task and final behavioral verification passed.

## TDD Gate Compliance

- Warning: task-level TDD RED commits are missing. This execute-plan added and verified directed scenarios but did not commit failing tests before implementation.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: managed_stale_heartbeat_setup | `tests/scenarios/directed/testcases/test_lifecycle_lock_heartbeat.py` | Managed scenario inserts an aged running `fqc_maintenance_jobs` row to simulate crashed lifecycle state before public recovery verification. |

## Authentication Gates

None.

## Verification

- `python3 -m py_compile tests/scenarios/directed/testcases/test_lifecycle_lock_per_entry.py tests/scenarios/directed/testcases/test_lifecycle_lock_heartbeat.py` - passed.
- `python3 -m py_compile tests/scenarios/directed/testcases/test_abort_background_job.py tests/scenarios/directed/testcases/test_abort_unknown_job.py` - passed.
- `npm run build` - passed.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_lifecycle_lock_*"` - passed, 2/2 scenarios.
- `python3 tests/scenarios/directed/run_suite.py --managed "test_abort_*"` - passed, 2/2 scenarios.
- Final full verification in requested order passed: build, lifecycle-lock suite, abort suite.

## Self-Check: PASSED

- Created files exist: D-114 through D-117 scenario files.
- Commits exist: `5c886cb`, `fd88244`.
- Required plan checks passed using `.env.test` credentials.
- No unexpected tracked file deletions detected.

## User Setup Required

None - no new external service configuration required. Verification used `.env.test` credentials and managed embedding-enabled directed scenario servers.

## Next Phase Readiness

Lifecycle lock, stale heartbeat recovery, and abort behavior are now covered through public directed scenarios before operator recipe validation.

---
*Phase: 167-lifecycle-operations-and-validation*
*Completed: 2026-06-11*
