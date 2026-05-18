---
phase: 140-tofu-schema-pinning-and-tool-list-change-handling
plan: 04
subsystem: mcp-broker
tags: [mcp-broker, tofu, list-changed, integration, audit]

requires:
  - phase: 140-03
    provides: broker TOFU drift callbacks, approval/rejection resolver, autonomous blocked_on_user audit events
provides:
  - Focused Phase B broker integration coverage for list_changed TOFU routing
  - Integration assertions for first trust, drift payloads, approval, rejection, bundling, restart reset, and retained in-process pins
  - Regression coverage for description_override hash isolation and autonomous blocked_on_user behavior
affects: [phase-140-host-reapproval, phase-141-tool-search, mcp-broker-regression-suite]

tech-stack:
  added: []
  patterns:
    - Fixture-backed broker integration tests with synchronous ToolIndexSink event recording
    - Manual broker snapshot tests for deterministic TOFU state-machine transitions that do not need child process refreshes

key-files:
  created:
    - tests/integration/mcp-broker/tofu-list-changed.test.ts
  modified:
    - tests/config/vitest.integration.config.ts

key-decisions:
  - "Kept Phase B integration coverage in a dedicated tofu-list-changed test file instead of further expanding client-lifecycle coverage."
  - "Used live quirky fixture processes for notification routing and manual broker snapshots for deterministic approval/rejection and same-process pin assertions."
  - "Asserted description_override behavior by comparing actual tofuHash values across fresh broker objects."

patterns-established:
  - "Integration ToolIndexSink recorder: capture add/remove events synchronously and assert registry/index ordering around drift blocking."
  - "TOFU lifecycle assertions compare actual hash values for approval, rejection, override isolation, restart reset, and retained same-process pins."

requirements-completed: [REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045, REQ-047, REQ-048, REQ-049, REQ-061, REQ-062, REQ-063, REQ-064, REQ-068, REQ-070]

duration: 9m26s
completed: 2026-05-18
---

# Phase 140 Plan 04: TOFU Schema Pinning And Tool-List Change Handling Summary

**Phase B broker integration coverage for TOFU schema drift, list_changed routing, override hash isolation, and autonomous blocking**

## Performance

- **Duration:** 9m26s
- **Started:** 2026-05-18T13:51:31Z
- **Completed:** 2026-05-18T14:00:57Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added `tests/integration/mcp-broker/tofu-list-changed.test.ts` and included it in the integration Vitest config.
- Covered Phase B integration IDs T-I-004..007, T-I-013..020, T-I-027, T-I-032a, and T-I-032b.
- Asserted real TOFU hash transitions, drift payload fields, index-sink add/remove behavior, bundled drift prompts, override isolation, and autonomous `blocked_on_user` audit behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Primary TOFU list_changed integration coverage** - `0341c8b` (test)
2. **Task 2: Broker TOFU drift lifecycle integration coverage** - `8618ead` (test)
3. **Task 3: TOFU override and autonomous block regression coverage** - `2cc314d` (test)

## Files Created/Modified

- `tests/integration/mcp-broker/tofu-list-changed.test.ts` - Focused integration coverage for Phase B TOFU/list_changed behavior and audit regressions.
- `tests/config/vitest.integration.config.ts` - Includes the new focused integration file in the explicit integration suite.

## Decisions Made

- Kept the new coverage in one focused file so Phase B test IDs can be audited without mining the broader client lifecycle suite.
- Used live `server-quirky` child processes for notification-driven add/change/remove routes and fresh broker objects for reset-between-start assertions.
- Used manual `applyToolListSnapshot` calls for rejection/reconnect-style state checks where a live fixture would re-fetch its later snapshot and obscure the specific TOFU transition under test.

## Deviations from Plan

None - plan executed within the requested test-only scope.

## Issues Encountered

- The first RED command failed because `tofu-list-changed.test.ts` did not exist and was not in the explicit integration include list.
- A draft assertion counted the initial index add as a changed-tool restore; the test was tightened to check for add events after removal.
- Manual revert and same-process pin assertions were moved off the live fixture client because `listToolsForConsumer` intentionally re-fetches live child-process tools before returning registry state.

## Known Stubs

None. Stub scan only found normal empty test accumulators and default object parameters.

## Threat Flags

None. This plan added integration tests only; no new network endpoints, auth paths, file access patterns, or schema trust boundaries were introduced.

## Verification

- `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts` - passed, 13 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts tests/integration/mcp-broker/client-lifecycle.test.ts` - passed, 35 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts tests/integration/mcp-broker/client-lifecycle.test.ts tests/integration/mcp-broker/dispatch.test.ts && npm run build` - passed, 37 integration tests and production build.

## Acceptance Criteria

- `tofu-list-changed.test.ts` contains T-I-004, T-I-005, T-I-006, T-I-007, T-I-013, T-I-014, T-I-015, T-I-016, T-I-017, T-I-018, T-I-019, T-I-020, T-I-027, T-I-032a, and T-I-032b.
- Changed and removed tools are absent from `broker.listToolsForConsumer`.
- Index sink removal is asserted before changed-tool restoration.
- Approval and rejection tests compare actual old/new hash behavior.
- Bundled drift test asserts exactly one prompt payload for at least two changed tools.
- Override tests compare actual `tofuHash` values.
- Autonomous test asserts no prompt payload and a `blocked_on_user` audit event.

## TDD Gate Compliance

This was a coverage-only execution plan over already-implemented behavior. The RED gate was observed by running the focused command before the file existed; subsequent task commits are test-only coverage commits, with no production GREEN commit required.

## User Setup Required

None - no external service configuration required. The integration suite used local fixture MCP server processes and the existing `.env.test` loader.

## Next Phase Readiness

Phase 140 host/E2E and scenario plans can consume the new focused integration file as the broker-level Phase B regression anchor before adding host-mediated re-approval and scenario coverage.

## Self-Check: PASSED

- Created file exists: `tests/integration/mcp-broker/tofu-list-changed.test.ts`.
- Modified file exists: `tests/config/vitest.integration.config.ts`.
- Commits exist: `0341c8b`, `8618ead`, `2cc314d`.
- Verification commands passed.

---
*Phase: 140-tofu-schema-pinning-and-tool-list-change-handling*
*Completed: 2026-05-18*
