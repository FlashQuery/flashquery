---
phase: 161-destination-locks-exdev-fallback
plan: 04
subsystem: testing
tags: [integration, directed-scenarios, exdev, req-008, req-022]
requires:
  - phase: 161-destination-locks-exdev-fallback
    provides: EXDEV unit proof and destination race integration proof
provides:
  - T-I-042 EXDEV fallback failure integration evidence
  - T-S-003 / D-WCO-03 directed copy destination race scenario
  - Phase 161 validation evidence record
affects: [integration-tests, directed-scenarios, validation]
tech-stack:
  added: []
  patterns: [directed scenario strict cleanup, Vitest selector fallback documentation]
key-files:
  created:
    - tests/integration/move-exdev-fallback.integration.test.ts
    - tests/scenarios/directed/testcases/test_copy_destination_race.py
  modified:
    - tests/config/vitest.integration.config.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - .planning/phases/161-destination-locks-exdev-fallback/161-VALIDATION.md
key-decisions:
  - "Record Vitest `--grep` rejection and use `--testNamePattern` as the supported selector."
patterns-established:
  - "Directed destination race scenarios classify success by JSON payload shape, not only framework `ok` status."
requirements-completed: [REQ-008, REQ-022]
duration: 20 min
completed: 2026-05-27
---

# Phase 161 Plan 04: EXDEV Integration and Directed Race Summary

**T-I-042 EXDEV failure coverage, D-WCO-03 directed copy race scenario, and green validation evidence**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-27T13:39:00Z
- **Completed:** 2026-05-27T13:48:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `T-I-042` integration coverage proving simulated EXDEV durable commit failure leaves source intact and no partial destination.
- Added directed scenario `test_copy_destination_race.py` for D-WCO-03 / T-S-003 and registered it in the coverage matrix.
- Updated `161-VALIDATION.md` with all Phase 161 test IDs, command evidence, and Vitest `--grep` deviation.

## Task Commits

1. **Task 1/2/3: EXDEV integration, directed scenario, validation evidence** - `abff668` (test)

## Files Created/Modified

- `tests/integration/move-exdev-fallback.integration.test.ts` - T-I-042.
- `tests/scenarios/directed/testcases/test_copy_destination_race.py` - D-WCO-03 directed scenario.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - D-WCO-03 coverage row.
- `tests/config/vitest.integration.config.ts` - T-I-042 file registration.
- `.planning/phases/161-destination-locks-exdev-fallback/161-VALIDATION.md` - final evidence.

## Decisions Made

The directed scenario uses a dedicated managed server and real parallel public `copy_document` calls. In this `.env.test` environment, transaction-pooler advisory locks cannot be used reliably, so the scenario avoids the advisory-lock mode while still proving public destination conflict behavior.

## Deviations from Plan

Vitest no longer accepts the roadmap’s `--grep` selector; both required `--grep` attempts were recorded and `--testNamePattern` fallback commands were used.

**Total deviations:** 1 selector deviation documented.
**Impact on plan:** No evidence loss; supported Vitest selectors passed.

## Issues Encountered

The directed framework marks expected conflict envelopes as non-OK tool results, so the scenario classifies success from JSON payload shape to count one success plus one structured conflict correctly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 161 has automated evidence for REQ-008 and REQ-022 and is ready for verification.

---
*Phase: 161-destination-locks-exdev-fallback*
*Completed: 2026-05-27*
