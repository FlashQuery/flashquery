---
phase: 162-version-fingerprint-check
plan: 02
subsystem: testing
tags: [vitest, integration, directed-scenarios, version-token, scanner]
requires:
  - phase: 162-version-fingerprint-check
    provides: Phase 162 unit contract coverage from plan 162-01
provides:
  - Public integration coverage for T-I-019 through T-I-033
  - Directed scenario coverage for D-WCO-05, D-WCO-06, and D-WCO-07
affects: [version-token, document-tools, scanner, directed-scenarios]
tech-stack:
  added: []
  patterns: [public MCP handler integration tests, managed directed scenarios]
key-files:
  created:
    - tests/integration/version-token-shape.integration.test.ts
    - tests/integration/version-token-precondition.integration.test.ts
    - tests/integration/version-check-inside-lock.integration.test.ts
    - tests/integration/token-equals-disk.integration.test.ts
    - tests/integration/refused-write-envelope.integration.test.ts
    - tests/integration/scanner-zero-writes.integration.test.ts
    - tests/scenarios/directed/testcases/test_version_token_round_trip.py
    - tests/scenarios/directed/testcases/test_read_triggered_repair_token.py
    - tests/scenarios/directed/testcases/test_scanner_token_stability.py
  modified:
    - tests/config/vitest.integration.config.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
key-decisions:
  - "Plan 162-02 is coverage-only: production implementation gaps are recorded as RED verification evidence, not patched in this plan."
patterns-established:
  - "Phase 162 integration tests use the existing Phase 155 public handler harness with canonicalized temp vault roots."
requirements-completed: [REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-017]
duration: 16min
completed: 2026-05-27
---

# Phase 162 Plan 02: Public Version-token Coverage Summary

**Public integration and directed scenario coverage for version-token round trips, stale-write refusals, token/disk invariants, conflict regions, and scanner stability**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-27T16:17:23Z
- **Completed:** 2026-05-27T16:33:36Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Added Vitest integration coverage for `T-I-019` through `T-I-033`.
- Registered all new integration files in `tests/config/vitest.integration.config.ts`.
- Added managed directed scenarios for `D-WCO-05`, `D-WCO-06`, and `D-WCO-07`, with coverage matrix rows.

## Task Commits

1. **Task 1: Add version-token integration tests** - `74b4593`
2. **Task 2: Add token-equals-disk, conflict-region, and scanner integration tests** - `6431b38`
3. **Task 3: Add directed version-token scenarios and coverage rows** - `9c7e379`

## Files Created/Modified

- `tests/integration/version-token-shape.integration.test.ts` - `T-I-019` public `get_document` token shape and disk SHA-256 check.
- `tests/integration/version-token-precondition.integration.test.ts` - `T-I-020` through `T-I-024` expected-version and alias/precondition coverage.
- `tests/integration/version-check-inside-lock.integration.test.ts` - `T-I-025` intervening disk-write conflict coverage.
- `tests/integration/token-equals-disk.integration.test.ts` - `T-I-026` through `T-I-028` repair-token and DB/disk/token equality coverage.
- `tests/integration/refused-write-envelope.integration.test.ts` - `T-I-029` through `T-I-031` conflict targeted-region coverage.
- `tests/integration/scanner-zero-writes.integration.test.ts` - `T-I-032` and `T-I-033` scanner zero-write stability coverage.
- `tests/config/vitest.integration.config.ts` - registered the six new integration files.
- `tests/scenarios/directed/testcases/test_version_token_round_trip.py` - `D-WCO-05` managed round-trip scenario.
- `tests/scenarios/directed/testcases/test_read_triggered_repair_token.py` - `D-WCO-06` repair-token scenario.
- `tests/scenarios/directed/testcases/test_scanner_token_stability.py` - `D-WCO-07` scan stability scenario.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - added `D-WCO-05` through `D-WCO-07` rows and crosswalk entries.

## Verification

- `npm run test:integration -- tests/integration/version-token-shape.integration.test.ts tests/integration/version-token-precondition.integration.test.ts tests/integration/version-check-inside-lock.integration.test.ts`  
  **Result:** RED as intended. 1 passed, 7 failed because current public handlers do not yet return `version_token` or enforce `expected_version` / `if_match` conflicts.
- `npm run test:integration -- tests/integration/token-equals-disk.integration.test.ts tests/integration/refused-write-envelope.integration.test.ts tests/integration/scanner-zero-writes.integration.test.ts`  
  **Result:** RED as intended. `scanner-zero-writes` passed 2/2; token equality and refused-write envelope tests failed because current handlers omit `version_token` and ignore stale-token conflict behavior.
- `python3 tests/scenarios/directed/run_suite.py --managed version_token_round_trip read_triggered_repair_token scanner_token_stability`  
  **Result:** RED as intended. `test_scanner_token_stability` passed; `test_version_token_round_trip` and `test_read_triggered_repair_token` failed at missing `version_token` assertions. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-27-133028.md`.
- `npm run test:integration -- --grep "version-token|version-check|token-equals-disk|refused-write|scanner-zero-writes"`  
  **Result:** Vitest rejected `--grep` with `CACError: Unknown option --grep`.
- `npm run test:integration -- --testNamePattern "version-token|version-check|token-equals-disk|refused-write|scanner-zero-writes"`  
  **Result:** Interrupted after repeated per-file rebuilds across the explicit integration config. Focused file-level commands above provide the relevant evidence.

## Decisions Made

Plan 162-02 intentionally leaves implementation gaps RED. The plan goal was to create executable public integration and directed coverage before later implementation work.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Canonicalized temp vault roots in new integration tests**
- **Found during:** Task 1
- **Issue:** New tests using temporary macOS vault paths hit the existing directory-lock guard because `/var/...` resolves to `/private/var/...`.
- **Fix:** Canonicalized `harness.vaultPath` with `realpath()` and updated `config.instance.vault.path`, matching the existing destination-lock integration pattern.
- **Files modified:** Task 1 and Task 2 integration files
- **Verification:** Subsequent focused integration runs reached the intended RED assertions instead of setup failures.
- **Committed in:** `74b4593`, `6431b38`

**Total deviations:** 1 auto-fixed blocking issue.  
**Impact on plan:** No scope expansion; the adjustment made the tests exercise the intended public behaviors.

## Issues Encountered

- Current production handlers do not yet expose `version_token`, accept/enforce stale-token conflicts, or return targeted-region conflict envelopes, so most new tests are expected RED.
- `.env.test` exists and the integration/directed commands used it. Background embedding warnings appeared because no embedding API key is configured; these did not block coverage execution.

## Known Stubs

None.

## Threat Flags

None. This plan added tests and scenario coverage only; it did not introduce new runtime endpoints, auth paths, file access surfaces, or schema changes.

## User Setup Required

None.

## Next Phase Readiness

Coverage is in place for the public Phase 162 behaviors. Later implementation plans can drive these RED tests green.

## Self-Check: PASSED

- Created files exist.
- Task commits exist: `74b4593`, `6431b38`, `9c7e379`.
- Test IDs `T-I-019` through `T-I-033` and directed IDs `D-WCO-05` through `D-WCO-07` are present.

---
*Phase: 162-version-fingerprint-check*
*Completed: 2026-05-27*
