---
phase: 158-tier-2-lock-table-retirement-session-check
plan: 02
subsystem: database
tags: [postgres, schema-retirement, config, cli, vitest]
requires:
  - phase: 158-tier-2-lock-table-retirement-session-check
    provides: "Plan 01 native session-scoped advisory document locks"
provides:
  - "Legacy fqc_write_locks table retirement on startup"
  - "Removal of the legacy write-lock service and unlock CLI"
  - "Legacy locking.ttl_seconds compatibility with a single deprecation warning"
  - "REQ-004 static and integration coverage for T-U-011/T-I-005/T-I-006"
affects: [phase-158, phase-159, phase-160, schema, config, cli]
tech-stack:
  added: []
  patterns:
    - "One-way legacy table retirement DDL during initSupabase"
    - "Config deprecation metadata without effective TTL behavior"
key-files:
  created:
    - tests/unit/no-legacy-write-lock-imports.test.ts
    - tests/unit/config-loader.test.ts
    - tests/integration/fqc-write-locks-drop.integration.test.ts
  modified:
    - src/storage/supabase.ts
    - src/storage/schema-verify.ts
    - src/config/loader.ts
    - src/config/types.ts
    - src/index.ts
    - src/mcp/tools/files.ts
    - tests/unit/schema-verify.test.ts
    - tests/config/vitest.integration.config.ts
  deleted:
    - src/services/write-lock.ts
    - src/cli/commands/unlock.ts
key-decisions:
  - "Keep only locking.enabled in effective config; legacy locking.ttl_seconds is accepted, removed before camelCase conversion, and surfaced through getDeprecationWarnings."
  - "Run DROP TABLE IF EXISTS fqc_write_locks after normal schema DDL and before schema verification so startup retires existing legacy tables without recreating them."
patterns-established:
  - "Static guard allows only the one-way DROP TABLE IF EXISTS fqc_write_locks statement in production source."
requirements-completed: [REQ-004]
duration: 8min
completed: 2026-05-26
---

# Phase 158 Plan 02: Legacy Lock Table Retirement Summary

**FlashQuery startup now retires the obsolete lock table, removes manual unlock recovery, and keeps old TTL config files load-compatible without preserving TTL behavior.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-26T20:30:21Z
- **Completed:** 2026-05-26T20:38:14Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added REQ-004 RED coverage for T-U-011, T-I-005, and T-I-006.
- Removed the legacy `write-lock` service and `flashquery unlock` CLI registration.
- Removed legacy table-lock usage from `manage_directory`.
- Removed `fqc_write_locks` create/recreate/index DDL and schema verification requirements.
- Added startup retirement DDL and legacy `locking.ttl_seconds` deprecation compatibility.

## Task Commits

1. **Task 1: Add legacy-retirement guards and integration tests** - `ea4e5e5` (`test`)
2. **Task 2: Remove legacy lock table, service, CLI, and TTL behavior** - `ed98601` (`feat`)

## Files Created/Modified

- `tests/unit/no-legacy-write-lock-imports.test.ts` - T-U-011 production source guard.
- `tests/unit/config-loader.test.ts` - legacy `ttl_seconds` compatibility and deprecation assertions.
- `tests/integration/fqc-write-locks-drop.integration.test.ts` - T-I-005/T-I-006 startup retirement integration coverage.
- `src/storage/supabase.ts` - removes create/recreate/index DDL and adds one-way drop DDL.
- `src/storage/schema-verify.ts` - no longer requires the legacy table.
- `src/config/loader.ts` / `src/config/types.ts` - accepts raw TTL config but exposes only `locking.enabled`.
- `src/index.ts` - removes unlock CLI registration.
- `src/mcp/tools/files.ts` - removes directory table-lock calls and TTL reads.
- `src/services/write-lock.ts` - deleted.
- `src/cli/commands/unlock.ts` - deleted.

## Verification

- `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts tests/unit/schema-verify.test.ts tests/unit/config-loader.test.ts` - PASS, 14 tests.
- `npm run test:integration -- tests/integration/fqc-write-locks-drop.integration.test.ts` - PASS, 2 tests using `.env.test`.
- `npm run typecheck` - PASS.
- `npm run build` - PASS.
- Traceability fallback: `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts --testNamePattern "legacy-write-lock"` - PASS.
- Traceability fallback: `npm test -- tests/unit/no-legacy-write-lock-imports.test.ts tests/unit/schema-verify.test.ts tests/unit/config-loader.test.ts --testNamePattern "legacy-write-lock|ttl_seconds"` - PASS.
- Traceability fallback: `npm run test:integration -- tests/integration/fqc-write-locks-drop.integration.test.ts --testNamePattern "fqc-write-locks-drop|lock-startup"` - PASS.

Required product evidence strings preserved for verification mapping:
- `npm test -- --grep "advisory-lock|lock-startup|legacy-write-lock"`
- `npm run test:integration -- --grep "two-tier|fqc-write-locks-drop|lock-startup|session-capable"`

## Decisions Made

- Used `getDeprecationWarnings(config)` as the single startup-warning path for `locking.ttl_seconds`.
- Did not add Phase 159 `lock_timeout_seconds` runtime behavior in this plan.
- Did not add Phase 160 directory advisory locks in `manage_directory`; this plan only removed the retired table-lock dependency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the new integration file to the explicit Vitest include list**
- **Found during:** Task 1 RED integration run.
- **Issue:** The repo integration config uses an explicit include list, so the new integration file would not run through the integration command without being listed.
- **Fix:** Added `tests/integration/fqc-write-locks-drop.integration.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** The integration command discovered and passed the new file.
- **Committed in:** `ea4e5e5`

**2. [Rule 1 - Bug] Static source guard initially traversed nested dependencies**
- **Found during:** Task 1 RED unit run.
- **Issue:** `src/node_modules` entries were scanned when present locally, producing false positives from dependency type declarations.
- **Fix:** Excluded `node_modules` directories from the static guard's recursive source traversal.
- **Files modified:** `tests/unit/no-legacy-write-lock-imports.test.ts`
- **Verification:** The guard then failed only on real production legacy references before GREEN, and passed after removal.
- **Committed in:** `ea4e5e5`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test bug).
**Impact on plan:** Both fixes were necessary for the planned tests to execute accurately; no product scope was added.

## Issues Encountered

None.

## Known Stubs

None. Stub scan found only normal local accumulators and existing null checks.

## Threat Flags

None beyond the planned startup database schema boundary. The retirement DDL uses a constant table name and no user interpolation.

## User Setup Required

None.

## Next Phase Readiness

Plan 03 can add the session-capability startup self-test now that the legacy table and manual recovery path are gone.

## Self-Check: PASSED

- Found created files: `tests/unit/no-legacy-write-lock-imports.test.ts`, `tests/unit/config-loader.test.ts`, `tests/integration/fqc-write-locks-drop.integration.test.ts`.
- Found task commits: `ea4e5e5`, `ed98601`.
- Intentional deletions confirmed: `src/services/write-lock.ts`, `src/cli/commands/unlock.ts`.

---
*Phase: 158-tier-2-lock-table-retirement-session-check*
*Completed: 2026-05-26*
