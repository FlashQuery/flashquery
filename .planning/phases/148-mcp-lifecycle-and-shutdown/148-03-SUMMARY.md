---
phase: 148-mcp-lifecycle-and-shutdown
plan: 03
subsystem: api
tags: [mcp, shutdown, lifecycle, vitest, tdd]
requires:
  - phase: 148-mcp-lifecycle-and-shutdown
    provides: Plan 01 lifecycle helper and Plan 02 typed registerTool request tracking
provides:
  - 15-second MCP request drain during graceful shutdown
  - Integration coverage for idle, active, and hung MCP shutdown drain behavior
  - Production MCP server registration into the shutdown drain registry
affects: [shutdown-drain, mcp-server-wrapper, req-009]
tech-stack:
  added: []
  patterns:
    - ShutdownCoordinator drains registered MCP server lifecycles before cost-write drain
    - Hung MCP shutdown drain logs aggregate remaining in-flight request count
key-files:
  created:
    - tests/integration/server/shutdown-mcp-drain.test.ts
  modified:
    - src/server/shutdown.ts
    - src/mcp/server.ts
    - tests/unit/shutdown.test.ts
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "Registered MCP servers with shutdown through a process-local drain registry so production startup uses the same lifecycle trackers as integration tests."
  - "Kept the production MCP drain deadline as an exported 15_000ms constant and used fake timers for the hung-handler integration path."
patterns-established:
  - "createMcpServer registers each server for shutdown draining immediately after creating its request lifecycle tracker."
  - "Shutdown aggregates remaining in-flight counts across registered MCP servers and logs count-only timeout warnings."
requirements-completed: [REQ-009]
duration: 6m13s
completed: 2026-05-24
---

# Phase 148 Plan 03: MCP Shutdown Drain Summary

**15-second MCP shutdown drain using registered request lifecycle trackers with focused integration coverage**

## Performance

- **Duration:** 6m13s
- **Started:** 2026-05-24T19:10:15Z
- **Completed:** 2026-05-24T19:16:28Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Replaced the 100ms placeholder MCP shutdown sleep with `waitForIdle(15_000)`.
- Added T-I-009, T-I-010, and T-I-011 coverage for idle, active, and hung MCP drains.
- Registered created MCP servers with shutdown so production shutdown drains the same lifecycle trackers used by registered handlers.
- Added a unit assertion for the production 15-second MCP drain deadline.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add shutdown MCP drain integration tests** - `36b27cf` (test)
2. **Task 2: Wire ShutdownCoordinator to waitForIdle with 15-second deadline** - `2b5a2bd` (feat)

## Files Created/Modified

- `tests/integration/server/shutdown-mcp-drain.test.ts` - Adds T-I-009, T-I-010, and T-I-011 integration coverage.
- `tests/config/vitest.integration.config.ts` - Adds the new shutdown MCP drain suite to the curated integration include list.
- `tests/unit/shutdown.test.ts` - Adds the 15-second deadline assertion.
- `src/server/shutdown.ts` - Adds `MCP_REQUEST_DRAIN_TIMEOUT_MS`, server lifecycle registration, lifecycle draining, and timeout warning logging.
- `src/mcp/server.ts` - Registers each created MCP server with shutdown after creating its request lifecycle.

## Decisions Made

- Used a process-local `Set<McpServer>` in shutdown rather than transport session state, keeping MCP stateless while still letting shutdown drain active handler lifecycles.
- Kept warning logs count-only: remaining in-flight request count is logged, but request arguments and document contents are not.
- Used fake timers for the hung-handler integration path so the test proves the 15-second deadline without waiting 15 real seconds.

## Verification

- RED: `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` - failed as expected before implementation: idle path still slept about 100ms and hung drain did not settle through lifecycle wait.
- RED: `npm test -- tests/unit/shutdown.test.ts` - failed as expected before implementation: `MCP_REQUEST_DRAIN_TIMEOUT_MS` was not exported.
- GREEN: `npm test -- tests/unit/shutdown.test.ts tests/unit/mcp-request-drain.test.ts` - PASS, 2 files / 14 tests.
- GREEN: `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` - PASS, 1 file / 3 tests.
- GREEN: `npm run typecheck` - PASS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Registered production MCP servers with shutdown**
- **Found during:** Task 2
- **Issue:** `ShutdownCoordinator` could drain an injected MCP server, but production `createMcpServer` instances were not yet connected to shutdown, so REQ-009 would only be test-local.
- **Fix:** Added `registerMcpServerForShutdown(server)` and called it from `createMcpServer` immediately after lifecycle creation.
- **Files modified:** `src/server/shutdown.ts`, `src/mcp/server.ts`, `tests/integration/server/shutdown-mcp-drain.test.ts`
- **Commit:** `2b5a2bd`

## Issues Encountered

- The first RED integration draft tried to spy on the uninitialized logger singleton. The test was corrected to use the existing logger mock pattern before the RED commit.

## Known Stubs

None. Empty object defaults in touched config/options code are normal configuration values, not UI or runtime stubs.

## Threat Flags

None. The added lifecycle registry and timeout warning are part of the planned MCP shutdown trust boundary and log only aggregate counts.

## User Setup Required

None. The focused integration command used the existing `.env.test` setup and did not require live Supabase operations.

## Self-Check: PASSED

- Found `src/server/shutdown.ts`.
- Found `src/mcp/server.ts`.
- Found `tests/unit/shutdown.test.ts`.
- Found `tests/integration/server/shutdown-mcp-drain.test.ts`.
- Found `tests/config/vitest.integration.config.ts`.
- Found `.planning/phases/148-mcp-lifecycle-and-shutdown/148-03-SUMMARY.md`.
- Found task commit `36b27cf`.
- Found task commit `2b5a2bd`.

---
*Phase: 148-mcp-lifecycle-and-shutdown*
*Completed: 2026-05-24*
