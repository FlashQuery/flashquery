---
phase: 154-residual-import-cycle-cleanup
plan: 03
subsystem: infra
tags: [mcp, shutdown, lifecycle, import-cycles, registry]
requires:
  - phase: 148
    provides: 15-second MCP request drain lifecycle behavior
provides:
  - Dependency-light MCP request lifecycle registry
  - MCP server/shutdown lifecycle cycle cleanup for REQ-012
  - Regression coverage for registry lookup, unregister cleanup, and shutdown drain behavior
affects: [phase-154, req-012, mcp-server, shutdown]
tech-stack:
  added: []
  patterns:
    - Shared MCP lifecycle state lives in a leaf registry module instead of server/shutdown back-edge imports
key-files:
  created:
    - src/mcp/request-lifecycle-registry.ts
  modified:
    - src/mcp/server.ts
    - src/server/shutdown.ts
    - tests/unit/mcp-request-drain.test.ts
    - tests/unit/mcp-server-correlation.test.ts
    - tests/integration/server/shutdown-mcp-drain.test.ts
key-decisions:
  - "Kept getMcpRequestLifecycleForServer re-exported from src/mcp/server.ts for existing public test/caller compatibility while moving storage to the registry."
  - "Unregistering a server removes both shutdown registration and lifecycle lookup state, matching closed-session cleanup requirements."
patterns-established:
  - "MCP shutdown coordination imports registry helpers directly; mcp/server.ts never imports server/shutdown.ts."
requirements-completed: [REQ-012]
duration: 4min
completed: 2026-05-26
---

# Phase 154 Plan 03: MCP Lifecycle Registry Summary

**MCP server and shutdown drain state now share a dependency-light lifecycle registry with preserved 15-second request drain semantics.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-25T23:59:13Z
- **Completed:** 2026-05-26T00:02:49Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `src/mcp/request-lifecycle-registry.ts` to own lifecycle lookup, active server listing, and unregister cleanup.
- Updated `createMcpServer` to register lifecycle state through the registry and clean it up on HTTP session close.
- Updated `ShutdownCoordinator` to drain registered MCP servers through the registry, removing the dynamic import back-edge to `mcp/server.ts`.
- Added T-U-037 coverage for register, lookup, active listing, unregister cleanup, and createMcpServer registration behavior.

## Task Commits

1. **Task 1: Add lifecycle registry regression coverage** - `efa21a2` (test)
2. **Task 2: Extract MCP lifecycle registry and remove shutdown back-edge** - `f4d2d8d` (feat)

## Files Created/Modified

- `src/mcp/request-lifecycle-registry.ts` - New leaf registry for MCP server lifecycle state.
- `src/mcp/server.ts` - Registers lifecycle state through the registry and re-exports lifecycle lookup for compatibility.
- `src/server/shutdown.ts` - Drains explicit or registered MCP servers through the registry without importing `mcp/server.ts`.
- `tests/unit/mcp-request-drain.test.ts` - Adds direct registry contract coverage.
- `tests/unit/mcp-server-correlation.test.ts` - Verifies `createMcpServer` registers lifecycle state while preserving correlation/catalog behavior.
- `tests/integration/server/shutdown-mcp-drain.test.ts` - Uses registry cleanup import while preserving drain behavior coverage.

## Verification

- `npm test -- tests/unit/mcp-request-drain.test.ts tests/unit/mcp-server-correlation.test.ts` - passed, 9 tests.
- `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` - passed, 4 tests.
- `sh -c 'npx --yes madge@8.0.0 src --extensions ts --circular > /tmp/fq-154-mcp-cycle.txt 2>&1 || true; ! rg "mcp/server\\.ts.*server/shutdown\\.ts|server/shutdown\\.ts.*mcp/server\\.ts" /tmp/fq-154-mcp-cycle.txt'` - passed.
- Acceptance greps confirmed `src/mcp/server.ts` imports shutdown helpers only from `request-lifecycle-registry.ts`, and `src/server/shutdown.ts` no longer imports `../mcp/server.js`.

## Decisions Made

- Kept the existing lifecycle lookup error message unchanged: `MCP request lifecycle has not been initialized for this server`.
- Kept the public `src/mcp/server.ts` lookup export by re-exporting from the registry, avoiding churn in existing callers.
- Treated unregister cleanup as removal from both active shutdown listing and lifecycle lookup state, so closed sessions cannot be drained later.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None - the lifecycle/shutdown trust boundary was already covered by the plan threat model.

## Issues Encountered

- The RED TDD gate failed as expected because `src/mcp/request-lifecycle-registry.ts` did not exist before implementation.
- Unrelated Phase 154-01 files appeared modified/untracked during execution; they were not staged or changed by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

REQ-012 is complete for the MCP server/shutdown cycle family. Remaining Phase 154 plans can continue addressing REQ-010 and REQ-011 without relying on `mcp/server.ts` and `server/shutdown.ts` importing each other.

## Self-Check: PASSED

- Confirmed created/modified files exist.
- Confirmed task commits `efa21a2` and `f4d2d8d` exist in git history.

---
*Phase: 154-residual-import-cycle-cleanup*
*Completed: 2026-05-26*
