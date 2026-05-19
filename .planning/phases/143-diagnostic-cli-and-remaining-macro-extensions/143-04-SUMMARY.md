---
phase: 143-diagnostic-cli-and-remaining-macro-extensions
plan: 4
subsystem: macro-runtime
tags: [macro, mcp-broker, health-checks, concurrency, tdd]

requires:
  - phase: 143-diagnostic-cli-and-remaining-macro-extensions
    provides: "REQ-103 _self binding and REQ-104 loop-control statements from Plans 02 and 03"
provides:
  - "REQ-109 macro _exists deep-probe health binding"
  - "REQ-110 shared brokered server macro concurrency coverage"
  - "T-I-050 integration coverage for concurrent macro response and trace isolation"
affects: [macro-runtime, mcp-broker, call_macro]

tech-stack:
  added: []
  patterns:
    - "Macro-facing broker health checks use explicit deepProbe true with 250 ms timeout."
    - "Shared broker macro concurrency tests pre-warm the broker registry, then assert concurrent call isolation against one process."

key-files:
  created:
    - .planning/phases/143-diagnostic-cli-and-remaining-macro-extensions/143-04-SUMMARY.md
  modified:
    - src/macro/introspection.ts
    - tests/unit/macro-introspection.test.ts
    - tests/integration/macro-concurrency.test.ts

key-decisions:
  - "Kept fq._exists() as a native true path that does not dispatch a handler."
  - "Kept a local macro timeout guard around broker.isConnected so broken broker implementations cannot hang macro evaluation."
  - "Pre-warmed the shared broker registry in T-I-050 to focus the test on concurrent JSON-RPC call isolation, not cold-start registry refresh behavior."

patterns-established:
  - "Brokered macro _exists tests should assert the exact Broker.isConnected options object."
  - "Macro shared-server concurrency assertions should cover payloads, task IDs, trace entries, and broker debug spawn evidence."

requirements-completed: [REQ-109, REQ-110]

duration: 6m
completed: 2026-05-19T00:49:58Z
---

# Phase 143 Plan 4: Macro Broker Health and Concurrency Summary

**Macro `_exists()` now uses a 250 ms broker deep probe, with integration coverage proving concurrent macros can share one brokered server process without response or trace contamination.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-19T00:44:26Z
- **Completed:** 2026-05-19T00:49:58Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Updated brokered macro `_exists()` to call `broker.isConnected(server, { deepProbe: true, timeoutMs: 250 })`.
- Updated unit coverage to assert the exact deep-probe options and 250 ms hung-probe behavior.
- Added T-I-050 macro integration coverage for concurrent `basic.slow` and `basic.echo` calls through one shared brokered server process.
- Verified existing T-I-023/T-I-024 lifecycle coverage remains green for deep vs. shallow hung-server probes.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add deep-probe `_exists()` contract** - `82d94ca` (test)
2. **Task 1 GREEN: Use deep probe for macro `_exists()`** - `ede8092` (feat)
3. **Task 2: Add shared broker macro concurrency coverage** - `b507f46` (test)

**Plan metadata:** committed separately in the SUMMARY commit.

## Files Created/Modified

- `src/macro/introspection.ts` - Uses the required 250 ms deep-probe broker health call for brokered `_exists()`.
- `tests/unit/macro-introspection.test.ts` - Pins the exact `isConnected` options and timeout behavior.
- `tests/integration/macro-concurrency.test.ts` - Adds T-I-050 shared-server macro concurrency coverage.
- `.planning/phases/143-diagnostic-cli-and-remaining-macro-extensions/143-04-SUMMARY.md` - Records execution outcome.

## Decisions Made

- Did not modify `tests/integration/mcp-broker/client-lifecycle.test.ts` because it already clearly covers T-I-023 and T-I-024.
- Kept the macro-level timeout wrapper at 250 ms in addition to passing `timeoutMs: 250` into the broker, preventing a faulty broker implementation from hanging macro evaluation.
- Pre-warmed the shared broker in T-I-050 so the test targets REQ-110 concurrent call routing over an already shared process.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. Stub-pattern scan found only ordinary test initializers and null checks.

## Issues Encountered

- An initial T-I-050 draft without broker pre-warm exposed an existing cold-start tool-visibility race. The final test pre-warms the shared server to isolate the planned REQ-110 contract; no broker-side mutex or production concurrency lock was added.

## Verification

- `npm test -- --run tests/unit/macro-introspection.test.ts` - passed, 5 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` - passed, 28 tests.
- `npm run test:integration -- --run tests/integration/macro-concurrency.test.ts` - passed, 3 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts tests/integration/macro-concurrency.test.ts` - passed, 31 tests.
- `npm run build` - passed.

## User Setup Required

None - `.env.test` was available and no external service configuration was required.

## Next Phase Readiness

REQ-109 and REQ-110 are ready for Plan 05 scenario closure.

## Self-Check: PASSED

- Verified all created/modified plan files exist.
- Verified task commits `82d94ca`, `ede8092`, and `b507f46` exist in git history.
- Verified focused unit, integration, and build gates passed after implementation.
- Verified no plan-owned implementation/test files remained unstaged or dirty before SUMMARY commit.

---
*Phase: 143-diagnostic-cli-and-remaining-macro-extensions*
*Completed: 2026-05-19*
