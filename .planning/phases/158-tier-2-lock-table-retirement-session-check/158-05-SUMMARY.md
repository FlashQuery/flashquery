---
phase: 158-tier-2-lock-table-retirement-session-check
plan: 05
subsystem: testing
tags: [vitest, config, schema-verification, postgres, lock-retirement]

requires:
  - phase: 158-02
    provides: "REQ-004 production lock-table retirement and deprecated locking.ttl_seconds compatibility"
provides:
  - "Config tests prove raw locking.ttl_seconds is accepted only as deprecated compatibility, not effective runtime TTL"
  - "Schema tests no longer require fqc_write_locks as an active table"
  - "E2E fixtures no longer carry camelCase ttlSeconds lock configuration"
affects: [phase-158, req-004, schema-tests, config-fixtures]

tech-stack:
  added: []
  patterns:
    - "Retired config keys may be accepted in raw YAML while omitted from effective FlashQueryConfig"
    - "Legacy schema objects are tested only through explicit drop/compatibility coverage"

key-files:
  created:
    - ".planning/phases/158-tier-2-lock-table-retirement-session-check/deferred-items.md"
  modified:
    - "tests/unit/config.test.ts"
    - "tests/integration/supabase-schema-verify.test.ts"
    - "tests/integration/supabase.test.ts"
    - "tests/integration/vault-write-coherency-phase155-helpers.ts"
    - "tests/fixtures/flashquery.e2e.yaml"
    - "tests/fixtures/flashquery.authorize.yaml"
    - "tests/fixtures/flashquery.token.yaml"
    - "tests/fixtures/flashquery.e2e.host-filtered.yaml"

key-decisions:
  - "Keep locking.ttl_seconds coverage as an explicit deprecation warning test while ensuring ttlSeconds is absent from runtime config."
  - "Use fqc_purpose_templates, not the retired write-lock table, for multi-missing-table schema verification."

patterns-established:
  - "Fixture lock config should declare only locking.enabled unless a test intentionally exercises deprecated raw-key compatibility."

requirements-completed: [REQ-004]

duration: 4min
completed: 2026-05-26
---

# Phase 158 Plan 05: Config and Schema Fixture Cleanup Summary

**REQ-004 test fixtures now treat the legacy write-lock table and TTL key as retired behavior, with only raw-key deprecation compatibility left covered.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-26T20:41:58Z
- **Completed:** 2026-05-26T20:46:24Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Updated `tests/unit/config.test.ts` so omitted locking config has no effective `ttlSeconds`, while raw `locking.ttl_seconds` still loads and emits exactly one deprecation warning.
- Removed active `fqc_write_locks` expectations from schema integration tests and Supabase table checks.
- Removed camelCase `ttlSeconds` from the owned E2E fixtures and the Phase 155 integration helper config.

## Task Commits

1. **Task 1: Update config/schema expectations and fixtures** - `fa743af` (test)

## Files Created/Modified

- `tests/unit/config.test.ts` - Deprecated raw TTL compatibility assertion without runtime `ttlSeconds`.
- `tests/integration/supabase-schema-verify.test.ts` - Multi-missing-table test now drops active schema tables.
- `tests/integration/supabase.test.ts` - Active schema table expectations no longer include the retired table.
- `tests/integration/vault-write-coherency-phase155-helpers.ts` - Helper config and cleanup no longer reference retired TTL/table state.
- `tests/fixtures/flashquery.e2e.yaml` - Removed legacy camelCase TTL field.
- `tests/fixtures/flashquery.authorize.yaml` - Removed legacy camelCase TTL field.
- `tests/fixtures/flashquery.token.yaml` - Removed legacy camelCase TTL field.
- `tests/fixtures/flashquery.e2e.host-filtered.yaml` - Removed legacy camelCase TTL field.
- `.planning/phases/158-tier-2-lock-table-retirement-session-check/deferred-items.md` - Logged out-of-scope stale-reference sweep findings.

## Decisions Made

- Kept raw `locking.ttl_seconds` only in the config unit test because Plan 02 compatibility requires accepting the deprecated key with a warning.
- Used `fqc_purpose_templates` for the integration missing-table case because it is an active required table and keeps the test's multiple-missing behavior.

## Deviations from Plan

None - plan executed as scoped. Out-of-scope stale references were documented rather than edited because they are outside Plan 05 ownership.

## Issues Encountered

- The repository-wide stale-reference sweep still reports legacy references in non-owned tests and scenario helpers. These are tracked in `deferred-items.md`; Plan 05 owned files no longer contain `ttlSeconds` or `fqc_write_locks` stale references.

## Verification

- `npm test -- tests/unit/config.test.ts tests/unit/schema-verify.test.ts tests/unit/no-legacy-write-lock-imports.test.ts` - passed, 3 files / 52 tests.
- `npm run test:integration -- tests/integration/supabase-schema-verify.test.ts tests/integration/supabase.test.ts` - passed, 1 integration file / 12 tests under configured `.env.test` Supabase.
- `npm run typecheck` - passed.
- `npm run build` - passed.
- Scoped stale-reference check across Plan 05 owned files for `ttlSeconds|fqc_write_locks` - no hits.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 05's owned config/schema/fixture surface is aligned with REQ-004. Remaining stale references reported by the broad sweep need their owning plans/files to complete cleanup before the full repository sweep can pass.

## Self-Check: PASSED

- Found all created/modified Plan 05 files.
- Found task commit `fa743af`.

---
*Phase: 158-tier-2-lock-table-retirement-session-check*
*Completed: 2026-05-26*
