---
phase: 141-bm25-tool-search-help-pages-and-description-overrides
plan: 6
subsystem: host-tool-search
tags: [mcp-broker, bm25, host-tool-search, list-changed]
requires:
  - phase: 141-01
    provides: PureBM25Indexer add/remove/search/getStats contracts
  - phase: 141-05
    provides: ToolSearchService and search_tools handler
  - phase: 140
    provides: ToolIndexSink list_changed add/remove seam
provides:
  - host.tool_search enabled startup index lifecycle
  - host-visible brokered ToolIndexSink filtering
  - host index list_changed update coverage
affects: [mcp-server-startup, mcp-broker-index-sink, tool-search]
tech-stack:
  added: []
  patterns:
    - mutable host ToolSearchService with existing immutable per-consumer build path preserved
    - WeakMap-backed test-visible host search service lookup for McpServer instances
key-files:
  created:
    - tests/integration/tool-search/host-index.integration.test.ts
  modified:
    - src/services/tool-search/tool-search-service.ts
    - src/mcp/server.ts
    - tests/unit/tool-search/search-tools-handler.test.ts
key-decisions:
  - "Kept createMcpServer synchronous by registering a mutable host search service immediately and awaiting host index initialization from async transport startup paths."
  - "Applied host.mcp_servers filtering inside the host ToolIndexSink so purpose-only broker updates never mutate the host index."
requirements-completed: [REQ-010, REQ-087, REQ-100]
duration: 17m
completed: 2026-05-18T17:17:23Z
---

# Phase 141 Plan 6: Host Tool Search Index Summary

**Host BM25 search lifecycle for `host.tool_search: enabled`, including FQ-native tools, host-visible brokered tools, and synchronous broker list-change updates.**

## Accomplishments

- Added a mutable host lifecycle to `ToolSearchService` while preserving existing per-purpose `buildForConsumer` behavior.
- Wired `createMcpServer` so enabled host sessions register `search_tools` against the host index and async startup awaits index construction before transport connection.
- Populated host indexes with host-visible FQ-native tools and brokered tools returned through the host `ConsumerContext`.
- Added a host-visible `ToolIndexSink` filter so only servers listed in `host.mcp_servers` can add/remove host index entries.
- Added focused integration coverage for T-I-038, T-I-039, and T-I-040-style host index behavior.

## Task Commits

1. **Host lifecycle implementation and tests** - `2e4cc0a` (feat)

## Files Created/Modified

- `src/services/tool-search/tool-search-service.ts` - Adds host rebuild, stats, mutable brokered add/remove, and host-visible sink filtering.
- `src/mcp/server.ts` - Creates enabled host search service, wires broker sink, replaces host `search_tools` handler, and awaits startup index build.
- `tests/unit/tool-search/search-tools-handler.test.ts` - Covers host sink visibility filtering.
- `tests/integration/tool-search/host-index.integration.test.ts` - Covers enabled startup, disabled no-index behavior, override descriptions, visible updates, and hidden-server filtering.

## Decisions Made

- Kept `createMcpServer` synchronous for compatibility with existing tests and call sites; startup paths call `initializeHostToolSearchForServer()` before connecting transports.
- Used a `WeakMap` for test-visible host index access instead of exposing a new MCP tool.
- Reused the existing broker `ToolIndexSink` seam; no additional `ToolListChangedNotificationSchema` handler was added.

## Deviations from Plan

None - implementation followed the planned host lifecycle and existing list_changed fanout path.

## Known Stubs

None. Stub-pattern scan found only normal empty default parameters/arrays and no placeholder behavior.

## Verification

- `npm test -- --run tests/unit/tool-search/search-tools-handler.test.ts` - PASS, 1 file / 4 tests.
- `npm run test:integration -- --run tests/integration/tool-search/host-index.integration.test.ts` - BLOCKED before execution: the repo integration Vitest config has a fixed include list that does not include `tests/integration/tool-search/host-index.integration.test.ts`, and updating that config was outside the requested write scope.
- `./node_modules/.bin/vitest run --root . --globals --testTimeout 30000 --maxWorkers 1 tests/integration/tool-search/host-index.integration.test.ts` - PASS, 1 file / 3 tests.
- `npm run build` - PASS.

## Acceptance Criteria

- Enabled host config builds a nonempty host index containing FQ-native tools - PASS.
- Enabled host config with `host.mcp_servers: [basic]` includes a brokered host-visible tool - PASS.
- Disabled host config does not create/build the host index - PASS.
- Brokered host search result description reflects `description_override` - PASS.
- Host-visible brokered list changes update the host index through the existing sink path - PASS.
- Non-host-visible brokered tools do not enter the host index - PASS.
- No second `ToolListChangedNotificationSchema` handler was added - PASS.

## Issues Encountered

- The required integration npm command cannot discover the new test file until `tests/config/vitest.integration.config.ts` includes it. That file was intentionally not changed because the user constrained writes to specific files.

## User Setup Required

None.

## Self-Check: PASSED

- Created summary exists: `.planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-06-SUMMARY.md`.
- Created integration test exists: `tests/integration/tool-search/host-index.integration.test.ts`.
- Implementation commit exists: `2e4cc0a`.
- Focused unit test, direct integration test, and build passed.

---
*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Completed: 2026-05-18*
