---
phase: 140-tofu-schema-pinning-and-tool-list-change-handling
plan: 02
subsystem: mcp-broker
tags: [mcp-broker, tofu, list-changed, registry, integration]

requires:
  - phase: 140-01
    provides: pure TOFU store, snapshot diffing, and registry blocking APIs
provides:
  - BrokerClient subscription to notifications/tools/list_changed
  - Dynamic quirky fixture snapshots for list_changed integration scenarios
  - Broker-side synchronous TOFU, registry, and index-sink routing for refreshed tool lists
affects: [phase-141-tool-search, phase-142-host-surface, macro-tofu-reapproval]

tech-stack:
  added: []
  patterns:
    - Manual MCP SDK ToolListChangedNotificationSchema handler with explicit tools/list refresh
    - Broker-owned in-memory TOFU store shared by all BrokerClient instances
    - Synchronous ToolIndexSink seam for future BM25 index integration

key-files:
  created: []
  modified:
    - src/services/mcp-broker/client.ts
    - src/services/mcp-broker/index.ts
    - src/services/mcp-broker/types.ts
    - tests/fixtures/mcp-servers/server-quirky.ts
    - tests/integration/mcp-broker/client-lifecycle.test.ts

key-decisions:
  - "Used one manual ToolListChangedNotificationSchema handler per BrokerClient rather than SDK listChanged convenience options."
  - "Initial discovery and list_changed refreshes both route through McpBroker.applyToolListSnapshot so TOFU state is process-wide and shared."
  - "Changed tools are unregistered and removed from the index sink before bundled drift callbacks are emitted."

patterns-established:
  - "Quirky fixture dynamic snapshots: QUIRK_INITIAL_TOOLS, QUIRK_LATER_TOOLS, and QUIRK_EMIT_LIST_CHANGED_MS drive deterministic tools/list_changed tests."
  - "Broker refresh application: diff registry state against refreshed client tools, observe TOFU, unregister blocked/removed tools, then synchronously update ToolIndexSink."

requirements-completed: [REQ-039, REQ-040, REQ-041, REQ-045, REQ-047, REQ-048, REQ-061, REQ-062, REQ-063, REQ-064, REQ-068]

duration: 12m09s
completed: 2026-05-18
---

# Phase 140 Plan 02: TOFU Schema Pinning And Tool-List Change Handling Summary

**Live MCP tools/list_changed refreshes now update broker TOFU, registry, and index-sink state synchronously**

## Performance

- **Duration:** 12m09s
- **Started:** 2026-05-18T13:22:35Z
- **Completed:** 2026-05-18T13:34:44Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added env-driven `server-quirky` snapshots and direct SDK integration probes for added, changed, and removed tools after `notifications/tools/list_changed`.
- Added `BrokerClientConfig.onToolListChanged` and one manual `ToolListChangedNotificationSchema` handler that refreshes cached brokered tools.
- Added `McpBroker.applyToolListSnapshot` over a shared `InMemoryTofuStore`, registry blocking, synchronous `ToolIndexSink`, and bundled drift callback.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: list_changed fixture probes** - `acfe98c` (test)
2. **Task 1 GREEN: dynamic quirky fixture** - `b159f96` (feat)
3. **Task 2 RED: BrokerClient callback test** - `58b1877` (test)
4. **Task 2 GREEN: BrokerClient list_changed refresh** - `dd53454` (feat)
5. **Task 3 RED: broker routing tests** - `247ec8f` (test)
6. **Task 3 GREEN: TOFU, registry, and index-sink routing** - `e9ac252` (feat)

## Files Created/Modified

- `src/services/mcp-broker/client.ts` - Subscribes to tool-list change notifications, refreshes `tools/list`, updates cached brokered tools, and invokes the refresh callback.
- `src/services/mcp-broker/index.ts` - Owns shared TOFU state, applies refreshed snapshots, unregisters blocked/removed tools, and updates the index sink synchronously.
- `src/services/mcp-broker/types.ts` - Adds list_changed callback, TOFU drift bundle, and index-sink-facing contracts.
- `tests/fixtures/mcp-servers/server-quirky.ts` - Supports dynamic env snapshots and emits deterministic `notifications/tools/list_changed`.
- `tests/integration/mcp-broker/client-lifecycle.test.ts` - Covers T-I-004..007 and bundled T-I-018 behavior while preserving reverse-request audit coverage.

## Decisions Made

- Used manual `setNotificationHandler(ToolListChangedNotificationSchema, ...)` so refresh, TOFU application, and bundled drift signaling remain explicit.
- Kept index behavior as a synchronous seam only; no BM25 ranking, `fq.search_tools`, or host-surface registration was added.
- Modeled bundled drift as an internal `TofuDriftBundle` callback for this plan; macro/host re-approval propagation remains for later Phase 140 plans.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved reverse-request fixture result shape after dynamic fixture rewrite**
- **Found during:** Task 1 (dynamic quirky fixture)
- **Issue:** The low-level fixture rewrite initially threw the rejected reverse request as a broker transport error instead of returning the prior raw `isError` `CallToolResult`.
- **Fix:** Returned an `isError: true` result from `trigger_reverse_request` while preserving the SDK fallback audit event.
- **Files modified:** `tests/fixtures/mcp-servers/server-quirky.ts`
- **Verification:** `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` passed and the reverse-request audit assertion still excludes the raw prompt.
- **Committed in:** `b159f96`

---

**Total deviations:** 1 auto-fixed (Rule 1 bug).
**Impact on plan:** The fix preserved an explicit plan requirement and did not expand scope.

## Issues Encountered

- The first Task 1 RED run timed out waiting for list_changed notifications, confirming the fixture lacked dynamic notification behavior.
- The first Task 2 RED run timed out waiting for `BrokerClient` callback delivery, confirming the client had not subscribed to tool-list changes.
- The first Task 3 RED run timed out waiting for registry/index/drift changes, confirming broker orchestration had not yet consumed refreshed snapshots.

## Known Stubs

None. Stub scan found only normal empty accumulators and nullable connection fields used for runtime state, not placeholders or unimplemented behavior.

## Verification

- `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` - passed, 22 tests.
- `npm test -- --run tests/unit/mcp-broker-diff.test.ts tests/unit/mcp-broker-tofu.test.ts tests/unit/mcp-broker-registry.test.ts` - passed, 3 files / 20 tests.
- `npm run build` - passed.

## Acceptance Criteria

- `server-quirky.ts` contains `QUIRK_INITIAL_TOOLS`, `QUIRK_LATER_TOOLS`, and `QUIRK_EMIT_LIST_CHANGED_MS`.
- Direct SDK integration tests observe `notifications/tools/list_changed` and refresh `tools/list` for add, change, and remove cases.
- `client.ts` imports `ToolListChangedNotificationSchema` and registers one manual notification handler for tool-list changes.
- Existing reverse-request audit coverage still passes and does not include the raw prompt.
- `McpBroker` owns one shared `InMemoryTofuStore` and exposes a synchronous `ToolIndexSink` seam.
- Integration tests cover T-I-005, T-I-006, T-I-007, and bundled T-I-018 behavior.

## User Setup Required

None - no external service configuration required. The focused integration suite uses local fixture MCP server processes and the existing `.env.test` loader.

## Next Phase Readiness

Later Phase 140 plans can attach macro/host `needs_user_input` propagation and approval/rejection flows to the bundled drift callback. Phase 141 can attach BM25 indexing to `ToolIndexSink` without changing list_changed routing.

## Self-Check: PASSED

- Created/modified files exist: `src/services/mcp-broker/client.ts`, `src/services/mcp-broker/index.ts`, `src/services/mcp-broker/types.ts`, `tests/fixtures/mcp-servers/server-quirky.ts`, `tests/integration/mcp-broker/client-lifecycle.test.ts`, and this summary file.
- Commits exist: `acfe98c`, `b159f96`, `58b1877`, `dd53454`, `247ec8f`, `e9ac252`.
- Verification commands passed.

---
*Phase: 140-tofu-schema-pinning-and-tool-list-change-handling*
*Completed: 2026-05-18*
