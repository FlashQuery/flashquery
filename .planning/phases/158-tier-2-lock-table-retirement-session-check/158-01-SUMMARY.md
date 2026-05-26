---
phase: 158-tier-2-lock-table-retirement-session-check
plan: 01
subsystem: database
tags: [postgres, advisory-locks, document-locks, vitest]
requires:
  - phase: 155-per-file-tier-1-live-defect-close
    provides: "Phase 155 document lock facade and Tier 1 striped mutex behavior"
  - phase: 157-records-memory-plugins-audit-guards
    provides: "Post-lock-table advisory coordination precedent"
provides:
  - "Native session-scoped Postgres advisory Tier 2 document locks"
  - "Same-process same-key burst collapse under one Tier 2 checkout"
  - "REQ-002 unit and integration coverage for T-U-003/T-U-004/T-U-005/T-I-003/T-I-004"
affects: [phase-158, phase-159, document-locks, postgres-session-capability]
tech-stack:
  added: []
  patterns:
    - "withPgClient-held session advisory lock span"
    - "per-lock-key in-process burst coordinator"
key-files:
  created:
    - tests/unit/document-lock-tier1.test.ts
    - tests/unit/document-lock-tier2.test.ts
    - tests/integration/two-tier-lock.integration.test.ts
  modified:
    - src/services/document-lock.ts
    - tests/unit/with-document-lock.test.ts
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "Derive document advisory keys from the Phase 155 document resource string using SHA-256 first 64 bits as a signed bigint string."
  - "Resolve same-process burst callers after advisory unlock completes so unlock failure surfaces to callers."
patterns-established:
  - "Document Tier 2 lock SQL is parameterized as SELECT pg_advisory_lock($1::bigint) and SELECT pg_advisory_unlock($1::bigint) AS released."
  - "Identical sorted lock-entry sets share a burst coordinator; unrelated file sets do not."
requirements-completed: [REQ-002]
duration: 9min
completed: 2026-05-26
---

# Phase 158 Plan 01: Native Tier 2 Advisory Document Locks Summary

**Document writes now use a checked-out Postgres session for native advisory Tier 2 locking, with same-process same-key bursts drained under one advisory acquire/release pair.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-26T20:19:03Z
- **Completed:** 2026-05-26T20:27:48Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Replaced `document-lock.ts` legacy-table Tier 2 calls with `withPgClient(config.supabase.databaseUrl, ...)` and session-scoped `pg_advisory_lock` / `pg_advisory_unlock`.
- Added a burst coordinator keyed by sorted unique document lock entries so same-process same-key contenders drain FIFO under one Tier 1/Tier 2 span.
- Added REQ-002 unit coverage for T-U-003, T-U-004, and T-U-005 plus integration coverage for T-I-003 and T-I-004.
- Updated the existing facade unit test to assert advisory-lock behavior instead of the retired temporary legacy-table behavior.

## Task Commits

1. **Task 1: Add REQ-002 Tier 1 and Tier 2 tests first** - `ed91674` (`test`)
2. **Task 2: Replace legacy Tier 2 with session advisory locks** - `b0522ee` (`feat`)

## Files Created/Modified

- `src/services/document-lock.ts` - Native advisory Tier 2 implementation, advisory key derivation, unlock result checking, and burst coordinator.
- `tests/unit/document-lock-tier1.test.ts` - T-U-003 same-key Tier 1 ordering coverage.
- `tests/unit/document-lock-tier2.test.ts` - T-U-004 same-client acquire/release coverage and T-U-005 burst-collapse coverage.
- `tests/integration/two-tier-lock.integration.test.ts` - T-I-003/T-I-004 real Postgres advisory-lock coverage.
- `tests/unit/with-document-lock.test.ts` - Existing facade coverage updated from legacy table mocks to advisory-lock fake PoolClient assertions.
- `tests/config/vitest.integration.config.ts` - Includes the new integration test in this repo's explicit integration file list.

## Verification

- `npm test -- tests/unit/document-lock-tier1.test.ts tests/unit/document-lock-tier2.test.ts` - PASS, 3 tests.
- `npm test -- tests/unit/document-lock-tier1.test.ts tests/unit/document-lock-tier2.test.ts tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts` - PASS, 9 tests.
- `npm test -- --testNamePattern "advisory-lock"` - PASS, 3 matching tests.
- `npm run typecheck` - PASS.
- `npm run build` - PASS.
- `npm run test:integration -- tests/integration/two-tier-lock.integration.test.ts` - FAIL in `.env.test` environment: T-I-004 observed `pg_try_advisory_lock` returning `true` while another logical client had already run `pg_advisory_lock` for the same key. The configured `DATABASE_URL` host is the Supabase pooler (`aws-1-us-west-2.pooler.supabase.com:6543`), which is consistent with transaction-pooler/session-instability behavior that Phase 158 Plan 03 is intended to self-test and fail at startup.

## Decisions Made

- Advisory keys are passed as parameters rather than interpolated SQL, satisfying T-158-01.
- The burst coordinator stays inside `document-lock.ts` and is keyed by the sorted unique basic-key set, preserving multi-file ordering and avoiding shared bursts for unrelated lock sets.
- Callback promises resolve only after Tier 2 unlock succeeds, so a false unlock result is not hidden behind an already-resolved critical section.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added new integration file to the explicit Vitest integration include list**
- **Found during:** Task 2 verification.
- **Issue:** `npm run test:integration -- tests/integration/two-tier-lock.integration.test.ts` could not discover the required new integration file because the repo integration config has an explicit include list.
- **Fix:** Added `tests/integration/two-tier-lock.integration.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** The command discovered and executed the file after the include update.
- **Committed in:** `b0522ee`

**2. [Rule 3 - Blocking] Updated existing facade test expectations for retired temporary Tier 2**
- **Found during:** Task 2 verification.
- **Issue:** `tests/unit/with-document-lock.test.ts` still asserted calls to `acquireLock` / `releaseLock`, which this plan removes from the document Tier 2 path.
- **Fix:** Replaced legacy table mocks with fake `PoolClient` assertions for advisory acquire/release and unlock failure handling.
- **Files modified:** `tests/unit/with-document-lock.test.ts`
- **Verification:** The plan unit verification command passed.
- **Committed in:** `b0522ee`

**3. [Process] Pre-staged plan edit included in RED commit**
- **Found during:** Task 1 commit.
- **Issue:** `.planning/phases/158-tier-2-lock-table-retirement-session-check/158-01-PLAN.md` was already staged before this agent staged test files, so Git included it in `ed91674`.
- **Fix:** No revert performed because the planning edit predated this agent and must not be discarded.
- **Files modified:** `.planning/phases/158-tier-2-lock-table-retirement-session-check/158-01-PLAN.md`
- **Committed in:** `ed91674`

**Total deviations:** 2 auto-fixed, 1 process note.

## Issues Encountered

- The integration environment uses a Supabase pooler `DATABASE_URL` on port 6543. Real session advisory locks cannot be proven there; T-I-004 fails before manual session-end recovery can be proven because the contender can acquire the same advisory lock immediately. Use a direct Postgres or session-mode pooler URL to make the integration gate meaningful.

## Known Stubs

None.

## Threat Flags

None beyond the planned advisory-lock SQL trust boundary.

## User Setup Required

Provide a session-capable `DATABASE_URL` in `.env.test` for the REQ-002 integration gate. The current pooler URL demonstrates the failure mode that Phase 158 Plan 03 will turn into a startup self-test.

## Next Phase Readiness

Plan 02 can retire the legacy table and unlock CLI from production surfaces. Plan 03 should add the startup session-capability self-test before relying on the integration environment's configured `DATABASE_URL`.

## Self-Check: PASSED

- Found all created/modified implementation and test files.
- Found task commits `ed91674` and `b0522ee`.

---
*Phase: 158-tier-2-lock-table-retirement-session-check*
*Completed: 2026-05-26*
