---
phase: 159-lock-timeout-canonical-key-derivation
plan: 5
subsystem: test-evidence
tags: [req-003, req-006, integration, directed-scenario]
key-files:
  created:
    - tests/integration/lock-timeout.integration.test.ts
    - tests/scenarios/directed/testcases/test_case_variant_path_locking.py
  modified:
    - tests/config/vitest.integration.config.ts
    - tests/integration/two-tier-lock.integration.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
metrics:
  tests: "npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern \"lock-timeout\"; python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_case_variant_path_locking"
---

## Summary

Added Phase 159 integration and directed scenario evidence for REQ-003 and REQ-006.

## Changes

| Evidence | Result |
|----------|--------|
| Integration | Added `T-I-009` / `T-I-010` real advisory lock timeout tests and registered the file in integration config. |
| Prior integration | Updated two-tier advisory key expectation from the retired `document:` namespace to `file:`. |
| Directed | Added `D-WCO-02` / `T-S-002` managed scenario for case-variant public writes and registered coverage. |

## Verification

- `npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern "lock-timeout"` exited 0; file skipped because `.env.test` uses a Supabase transaction pooler URL (`:6543`), so `HAS_SESSION_CAPABLE_DATABASE_URL` is false.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_case_variant_path_locking` passed: 1/1 steps, no residue.
- Full unit suite passed: 167 files, 2086 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- Full `npm run test:e2e` had one transient suite setup timeout in `authorize-flow.e2e.test.ts`; rerunning that file alone passed 8/8 tests.

## Deviations

The directed scenario uses the public `write_document` surface and verifies one case-variant create plus one structured conflict on case-insensitive filesystems. No private lock delay hook exists in the current directed harness.

## Self-Check

PASSED
