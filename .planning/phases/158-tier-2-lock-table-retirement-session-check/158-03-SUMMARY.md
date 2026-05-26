---
phase: 158-tier-2-lock-table-retirement-session-check
plan: 03
subsystem: infra
tags: [postgres, advisory-locks, startup, supabase, vitest]

requires:
  - phase: 158-01
    provides: Session-scoped advisory lock primitives for document locks
  - phase: 158-02
    provides: Legacy fqc_write_locks retirement and ttl_seconds deprecation
provides:
  - REQ-005 startup self-test for session-capable Postgres advisory locks
  - Fail-closed startup wiring before MCP traffic is accepted
  - Unit and integration coverage for T-U-012, T-U-013, T-I-007, and T-I-008
  - Operator documentation for direct/session-mode DATABASE_URL requirements
affects: [startup, postgres, supabase-setup, operator-docs]

tech-stack:
  added: []
  patterns:
    - withPgClient owner/observer session probe
    - typed startup capability result converted to fatal startup error

key-files:
  created:
    - src/services/lock-startup.ts
    - tests/unit/lock-startup-self-test.test.ts
    - tests/integration/lock-startup.integration.test.ts
  modified:
    - src/index.ts
    - tests/config/vitest.integration.config.ts
    - README.md
    - .env.example
    - flashquery.yml
    - flashquery.example.yml
    - docs/ARCHITECTURE.md
    - docs/CLAUDE-CODE-SETUP.md

key-decisions:
  - "Use a deterministic positive bigint probe key for startup advisory-lock validation."
  - "Fail startup before plugin/MCP initialization when session advisory locks cannot be proven stable."
  - "Keep ignored flashquery.yml updated locally and commit the tracked flashquery.example.yml template for shipped config guidance."

patterns-established:
  - "Startup capability probes return typed results and expose a separate assert helper for fail-closed startup wiring."
  - "Session advisory-lock safety is proven by observing pg_locks from a second withPgClient checkout, not by trusting owner lock acquisition."

requirements-completed: [REQ-005]

duration: 8min
completed: 2026-05-26
---

# Phase 158 Plan 03: Lock Startup Session Check Summary

**Startup now proves session-scoped advisory-lock visibility before MCP serving and documents direct/session-mode DATABASE_URL setup.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-26T20:42:55Z
- **Completed:** 2026-05-26T20:50:27Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added `verifySessionAdvisoryLocks(databaseUrl)` and `assertSessionAdvisoryLocksOrThrow(databaseUrl)` in `src/services/lock-startup.ts`.
- Wired startup to run the self-test after `initSupabase(config)` and before plugin/MCP initialization.
- Added T-U-012/T-U-013 unit coverage and T-I-007/T-I-008 integration coverage for session-capable and transaction-mode failure behavior.
- Updated operator docs and config examples to require direct Postgres or session-capable/session-mode pooler URLs.

## Task Commits

1. **Task 1: Add session self-test unit and integration coverage** - `22b5c03` (test)
2. **Task 2: Implement fail-closed session-capability startup self-test** - `9c45449` (feat)
3. **Task 3: Document the session-capable DATABASE_URL requirement** - `4d125c6` and `ef07a57` (docs)

## Files Created/Modified

- `src/services/lock-startup.ts` - Session advisory-lock startup self-test and fatal assert helper.
- `src/index.ts` - Runs the self-test before serving MCP traffic.
- `tests/unit/lock-startup-self-test.test.ts` - Fake-pool T-U-012/T-U-013 coverage.
- `tests/integration/lock-startup.integration.test.ts` - Real `.env.test` pass path and fake transaction-pooler failure path.
- `tests/config/vitest.integration.config.ts` - Includes the new integration file in the explicit integration suite.
- `README.md`, `.env.example`, `flashquery.yml`, `flashquery.example.yml`, `docs/ARCHITECTURE.md`, `docs/CLAUDE-CODE-SETUP.md` - Session-capable `DATABASE_URL` guidance.

## Decisions Made

- The probe uses a deterministic positive bigint key and parameterized `$1::bigint` SQL for acquire, observe, and release.
- Failure messaging names session-capable Postgres and suspected transaction-mode pooler behavior without printing `DATABASE_URL`.
- `flashquery.yml` is ignored local config, so the same shipped guidance was added to tracked `flashquery.example.yml`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the new integration test to Vitest's explicit include list**
- **Found during:** Task 2
- **Issue:** `npm run test:integration -- tests/integration/lock-startup.integration.test.ts` found no tests because the integration config uses an explicit include list.
- **Fix:** Added `tests/integration/lock-startup.integration.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Verification:** `npm run test:integration -- tests/integration/lock-startup.integration.test.ts`
- **Committed in:** `9c45449`

**2. [Rule 2 - Missing Critical] Updated tracked config template in addition to ignored local config**
- **Found during:** Task 3
- **Issue:** The plan named `flashquery.yml`, but that file is ignored local config and cannot carry shipped operator guidance.
- **Fix:** Updated ignored `flashquery.yml` locally and committed equivalent guidance to tracked `flashquery.example.yml`.
- **Verification:** `rg -n "session-capable|session mode|session-mode|transaction-mode|advisory lock|advisory locks|DATABASE_URL" README.md .env.example flashquery.yml flashquery.example.yml docs/ARCHITECTURE.md docs/CLAUDE-CODE-SETUP.md`
- **Committed in:** `ef07a57`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both were required to make the planned tests executable and the operator guidance shippable.

## Issues Encountered

- Concurrent Phase 158 executors committed Plans 04/05/06 while this plan was executing. A docs amend briefly targeted a moving HEAD; subsequent work used forward-only commits and left concurrent plan changes intact.
- `flashquery.yml` is ignored. It was updated locally for this checkout; `flashquery.example.yml` carries the tracked version of the same guidance.

## Verification

- `npm test -- tests/unit/lock-startup-self-test.test.ts` - passed
- `npm run test:integration -- tests/integration/lock-startup.integration.test.ts` - passed with `.env.test`
- `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts` - passed
- `npm test -- tests/unit/lock-startup-self-test.test.ts tests/unit/no-legacy-write-lock-imports.test.ts` - passed
- `npm run typecheck` - passed
- `npm run build` - passed
- Doc grep for `session-capable|session mode|session-mode|transaction-mode|advisory lock|advisory locks|DATABASE_URL` - passed
- Stale unlock/TTL grep across edited operator docs - no matches

## Known Stubs

None.

## User Setup Required

Operators must use direct Postgres or a session-capable/session-mode pooler for `DATABASE_URL`. No new secrets or package installs are required.

## Next Phase Readiness

REQ-005 is complete. Later locking phases can assume startup has already rejected transaction-mode pooler endpoints before accepting MCP traffic.

## Self-Check: PASSED

- Found `src/services/lock-startup.ts`
- Found `tests/unit/lock-startup-self-test.test.ts`
- Found `tests/integration/lock-startup.integration.test.ts`
- Found `.planning/phases/158-tier-2-lock-table-retirement-session-check/158-03-SUMMARY.md`
- Found commits `22b5c03`, `9c45449`, `4d125c6`, and `ef07a57`

---
*Phase: 158-tier-2-lock-table-retirement-session-check*
*Completed: 2026-05-26*
