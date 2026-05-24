---
phase: 148-mcp-lifecycle-and-shutdown
plan: 01
subsystem: api
tags: [mcp, shutdown, lifecycle, vitest, tdd]
requires:
  - phase: 148-mcp-lifecycle-and-shutdown
    provides: Phase context, REQ-009 test contract, and MCP shutdown remediation scope
provides:
  - Dependency-light MCP request lifecycle tracker
  - T-U-019 counter balance unit coverage
  - T-U-020 wait-for-idle timeout metadata unit coverage
affects: [mcp-server-wrapper, shutdown-drain, req-009]
tech-stack:
  added: []
  patterns:
    - Generic tracked handler wrapper with try/finally request accounting
    - waitForIdle drain metadata with timedOut, remaining, and elapsedMs
key-files:
  created:
    - src/mcp/request-lifecycle.ts
    - tests/unit/mcp-request-drain.test.ts
  modified: []
key-decisions:
  - "Kept request lifecycle tracking dependency-light and separate from MCP server, shutdown, transport, Supabase, and session state."
  - "Used TDD RED/GREEN commits so T-U-019 and T-U-020 prove the helper contract before production wiring."
patterns-established:
  - "MCP handlers can be wrapped through createMcpRequestLifecycle().trackHandler() to increment immediately and decrement in finally."
  - "Shutdown-facing drain consumers can call waitForIdle(timeoutMs) and inspect timedOut, remaining, and elapsedMs without mutating active work."
requirements-completed: [REQ-009]
duration: 4min
completed: 2026-05-24
---

# Phase 148 Plan 01: MCP Request Lifecycle Helper Summary

**Dependency-light MCP request lifecycle tracker with RED/GREEN coverage for request counting and drain timeout metadata**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-24T18:56:00Z
- **Completed:** 2026-05-24T18:58:51Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `createMcpRequestLifecycle()` with `trackHandler`, `waitForIdle`, and `getInFlightCount`.
- Proved T-U-019 behavior for successful handlers, `isError: true` handler results, and thrown handlers.
- Proved T-U-020 behavior where hung handlers produce timeout metadata while remaining in-flight.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing request lifecycle drain tests** - `c7b88c5` (test)
2. **Task 2: Implement dependency-light MCP request lifecycle helper** - `4ce05ee` (feat)

## Files Created/Modified

- `src/mcp/request-lifecycle.ts` - Defines `McpDrainResult`, `McpRequestLifecycle`, and `createMcpRequestLifecycle`.
- `tests/unit/mcp-request-drain.test.ts` - Adds focused T-U-019 and T-U-020 Vitest coverage.

## Decisions Made

- Kept the lifecycle helper independent from shutdown, transport, Supabase, and session state so later wrapper and shutdown plans can consume it without coupling.
- Returned drain metadata from `waitForIdle(timeoutMs)` rather than throwing on timeout, preserving shutdown's ability to log and continue.
- Used short unit-test timeout values to verify hung-handler metadata without production-length waits.

## Verification

- `npm test -- tests/unit/mcp-request-drain.test.ts` - PASS, 1 file / 4 tests.
- `npm run typecheck` - PASS.
- `rg -n "setTimeout\\(15_000|15000|15_000" tests/unit/mcp-request-drain.test.ts` - PASS, no matches.
- `rg -n "server/shutdown|transport|supabase|session" src/mcp/request-lifecycle.ts` - PASS, no matches.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The RED run failed as expected because `src/mcp/request-lifecycle.ts` did not exist yet.

## Known Stubs

None. The empty arrays in `tests/unit/mcp-request-drain.test.ts` are test-local observation buffers, not UI or runtime stubs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The lifecycle helper is ready for the production MCP registration wrapper and shutdown drain integration plans.

## Self-Check: PASSED

- Found `src/mcp/request-lifecycle.ts`.
- Found `tests/unit/mcp-request-drain.test.ts`.
- Found `.planning/phases/148-mcp-lifecycle-and-shutdown/148-01-SUMMARY.md`.
- Found task commit `c7b88c5`.
- Found task commit `4ce05ee`.

---
*Phase: 148-mcp-lifecycle-and-shutdown*
*Completed: 2026-05-24*
