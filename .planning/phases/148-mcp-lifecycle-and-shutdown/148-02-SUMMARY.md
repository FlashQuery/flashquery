---
phase: 148-mcp-lifecycle-and-shutdown
plan: 02
subsystem: api
tags: [mcp, lifecycle, registerTool, correlation, vitest, tdd]
requires:
  - phase: 148-mcp-lifecycle-and-shutdown
    provides: Plan 01 MCP request lifecycle helper and drain unit contract
provides:
  - Typed MCP registerTool wrapper composition for correlation IDs and lifecycle tracking
  - Native tool catalog capture preserving help-schema injection and host filtering
  - T-U-016, T-U-017, and T-U-018 focused regression coverage
affects: [mcp-server-wrapper, native-tool-catalog, request-lifecycle, req-008, req-009]
tech-stack:
  added: []
  patterns:
    - McpServer registerTool wrappers use RegisterToolFunction = McpServer['registerTool']
    - Catalog-dispatched native handlers share the same lifecycle and correlation wrapper as registered SDK handlers
key-files:
  created:
    - tests/unit/mcp-server-correlation.test.ts
  modified:
    - src/mcp/server.ts
    - src/mcp/tool-catalog.ts
    - tests/unit/native-tool-catalog.test.ts
key-decisions:
  - "Removed the dead server.tool wrapping branch and kept production wrapping on typed registerTool composition only."
  - "Kept catalog capture before host exposure filtering while wrapping catalog handlers for correlation and request lifecycle tracking."
patterns-established:
  - "Use getMcpRequestLifecycleForServer(server) for tests or later shutdown integration that needs the server-local lifecycle tracker."
  - "Use wrapCatalogHandler only to decorate native catalog dispatch; uncataloged brokered registrations still use the uncataloged original SDK path."
requirements-completed: [REQ-008, REQ-009]
duration: 6m59s
completed: 2026-05-24
---

# Phase 148 Plan 02: MCP RegisterTool Lifecycle Wrapper Summary

**Typed registerTool wrapper composition with correlation IDs, native catalog preservation, and MCP request lifecycle tracking**

## Performance

- **Duration:** 6m59s
- **Started:** 2026-05-24T19:01:21Z
- **Completed:** 2026-05-24T19:08:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced the broad `(server as any).registerTool` and dead `.tool` wrapper branch in `src/mcp/server.ts`.
- Wired registered MCP handlers into the Plan 148-01 lifecycle tracker and fresh correlation-ID context.
- Preserved native tool catalog behavior, including help schema injection and host exposure filtering.
- Added focused unit coverage for T-U-016, T-U-017, T-U-018, and lifecycle attachment on the registerTool path.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add correlation and no-dead-tool-branch tests** - `549a3a0` (test)
2. **Task 2: Replace broad correlation monkey-patch with typed registerTool composition** - `5d077bd` (feat)

## Files Created/Modified

- `tests/unit/mcp-server-correlation.test.ts` - Adds registerTool correlation, no `.tool` dependency, and lifecycle tracking coverage.
- `tests/unit/native-tool-catalog.test.ts` - Labels and preserves T-U-016 native catalog and help-schema assertions.
- `src/mcp/server.ts` - Installs typed registerTool lifecycle/correlation wrapping and exposes server-local lifecycle lookup.
- `src/mcp/tool-catalog.ts` - Exports the registerTool function type and allows catalog handler decoration while preserving host filtering.

## Decisions Made

- Kept the startup order from the plan: lifecycle/correlation wrapping installs before `wrapServerWithToolCatalog`.
- Added `wrapCatalogHandler` so native catalog dispatch gets the same correlation and lifecycle guarantees without changing uncataloged brokered registration.
- Exported `RegisterToolFunction` from `tool-catalog.ts` to keep the typed SDK signature shared by both wrapper modules.

## Verification

- `npm test -- tests/unit/mcp-server-correlation.test.ts tests/unit/native-tool-catalog.test.ts` - RED before implementation: failed as expected because catalog handlers lacked correlation context and lifecycle lookup was missing.
- `npm test -- tests/unit/mcp-server-correlation.test.ts tests/unit/native-tool-catalog.test.ts tests/unit/mcp-request-drain.test.ts` - PASS, 3 files / 11 tests.
- `npm run typecheck` - PASS.
- `rg -n "server\\.tool|\\(server as any\\)\\.registerTool|\\(server as any\\)\\.tool" src/mcp src/server src/llm; test $? -eq 1` - PASS, no matches.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The first RED test draft attempted to observe SDK prototype registration directly, but the behavior needed by T-U-017 was better pinned through the native catalog handler created by `registerTool`. The test was corrected before the RED commit.

## Known Stubs

None. Empty arrays in the touched tests are test-local observation buffers, not runtime or UI stubs.

## Threat Flags

None. The changed files are the planned MCP wrapper and native catalog trust boundaries from the plan threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can consume `getMcpRequestLifecycleForServer(server)` to connect shutdown draining to the server-local lifecycle tracker without adding server-side session state.

## Self-Check: PASSED

- Found `tests/unit/mcp-server-correlation.test.ts`.
- Found `src/mcp/server.ts`.
- Found `src/mcp/tool-catalog.ts`.
- Found `tests/unit/native-tool-catalog.test.ts`.
- Found `.planning/phases/148-mcp-lifecycle-and-shutdown/148-02-SUMMARY.md`.
- Found task commit `549a3a0`.
- Found task commit `5d077bd`.

---
*Phase: 148-mcp-lifecycle-and-shutdown*
*Completed: 2026-05-24*
