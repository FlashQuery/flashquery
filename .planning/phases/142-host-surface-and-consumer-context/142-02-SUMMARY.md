---
phase: 142-host-surface-and-consumer-context
plan: 2
subsystem: mcp
tags: [mcp-broker, host-surface, consumer-context, tofu, trace, vitest]

requires:
  - phase: 142-host-surface-and-consumer-context
    provides: host config defaults and registry consumer filtering from 142-01
  - phase: 140-tofu-schema-pinning-and-tool-list-change-handling
    provides: TOFU pending-drift bundling contract
  - phase: 141-bm25-tool-search-help-pages-and-description-overrides
    provides: brokered description_override substitution in BrokeredTool.description
provides:
  - Host MCP registration for configured brokered tools by registry-key name
  - Host tools/call dispatch through the shared broker with consumer visibility re-checks
  - Host-scoped brokered tool-call trace recording after returned upstream results
  - T-I-030 host hidden registry-key rejection coverage
affects: [phase-142, mcp-broker-host-surface, mcp-server, tool-catalog, integration-tests]

tech-stack:
  added: []
  patterns:
    - uncataloged SDK registration for brokered host tools
    - host brokered callbacks re-check Broker.listToolsForConsumer before Broker.callTool
    - JSON Schema to minimal Zod raw-shape adaptation at the SDK registration boundary

key-files:
  created:
    - src/mcp/host-brokered-tools.ts
    - tests/integration/mcp-broker/host-surface.test.ts
    - .planning/phases/142-host-surface-and-consumer-context/142-02-SUMMARY.md
  modified:
    - src/mcp/server.ts
    - src/mcp/tool-catalog.ts
    - tests/unit/mcp-server-tools.test.ts
    - tests/config/vitest.integration.config.ts

key-decisions:
  - "142-02: Host brokered tools register through an uncataloged SDK path so they appear on host tools/list without becoming FQ-native catalog entries or requiring .tool.md metadata."
  - "142-02: Host registration converts broker JSON Schema into SDK-compatible Zod raw shapes at the MCP boundary while preserving BrokeredTool input schemas in broker state."
  - "142-02: Host brokered trace cost is recorded only after Broker.callTool returns, including upstream isError results, and not for thrown broker failures."

patterns-established:
  - "Brokered host callbacks use registry-key names for SDK registration and still re-check host visibility at call time."
  - "Same-server pending TOFU drifts are bundled at the host direct dispatch boundary."

requirements-completed: [REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-035, REQ-066, REQ-113, REQ-116]

duration: 8m
completed: 2026-05-18
---

# Phase 142 Plan 2: Host Brokered Surface Summary

**Host MCP clients can discover and call configured brokered tools by registry key while hidden keys, TOFU drift, and trace accounting stay behind the shared broker visibility gate.**

## Performance

- **Duration:** 8m
- **Started:** 2026-05-18T19:52:21Z
- **Completed:** 2026-05-18T19:59:48Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `registerHostBrokeredTools`, which lists host-visible brokered tools, registers them under `serverId__toolName`, uses `BrokeredTool.description`, and re-checks visibility before dispatch.
- Wired host brokered registration into the existing awaited host startup initializer before transport connection while keeping `createMcpServer` synchronous.
- Added host surface integration coverage for `tools/list`, `tools/call`, `description_override`, hidden registry-key rejection, and host trace cost entries.
- Preserved Phase 140 same-server schema drift bundling behavior for host direct brokered calls.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add host brokered registration tests** - `adaa6da` (test)
2. **Task 1 GREEN: Add host brokered registration helper** - `a84c1f2` (feat)
3. **Task 2 RED: Add host brokered surface integration** - `dd78650` (test)
4. **Task 2 GREEN: Wire brokered tools into host MCP surface** - `5ca0962` (feat)

## Files Created/Modified

- `src/mcp/host-brokered-tools.ts` - Host brokered registration helper, visibility re-checks, drift responses, sanitized thrown-error responses, trace recording, and SDK schema adaptation.
- `src/mcp/server.ts` - Awaits host brokered registration in `initializeHostToolSearchForServer` using the shared broker.
- `src/mcp/tool-catalog.ts` - Adds an uncataloged SDK registration seam so brokered host tools do not enter the native catalog.
- `tests/unit/mcp-server-tools.test.ts` - Unit coverage for Task 1 host brokered helper behavior.
- `tests/integration/mcp-broker/host-surface.test.ts` - Public MCP host-surface integration coverage.
- `tests/config/vitest.integration.config.ts` - Includes the new host-surface integration file.

## Verification

- `npm test -- --run tests/unit/mcp-server-tools.test.ts` - passed, 16 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker/host-surface.test.ts` - passed, 4 tests.

## Decisions Made

- Brokered host tools bypass native catalog capture. They are not FQ-native tools, do not require `TOOL_META`, and do not need `.tool.md` validation.
- Host `tools/call` records trace cost after returned `Broker.callTool` results, including upstream `isError: true` results; thrown broker failures return sanitized `isError: true` without cost entries.
- The MCP SDK registration boundary receives minimal Zod raw shapes derived from broker JSON Schema because the SDK validates tool calls with Zod schemas.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added host-surface integration file to Vitest include list**
- **Found during:** Task 2 RED gate
- **Issue:** `npm run test:integration -- --run tests/integration/mcp-broker/host-surface.test.ts` could not discover the new file because the integration config enumerates included test files.
- **Fix:** Added `tests/integration/mcp-broker/host-surface.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** The host-surface integration suite ran and failed for the intended missing implementation, then passed after GREEN.
- **Committed in:** `dd78650`

**2. [Rule 3 - Blocking] Adapted broker JSON Schema to SDK-compatible Zod raw shapes**
- **Found during:** Task 2 GREEN gate
- **Issue:** Upstream brokered tools expose JSON Schema, but `McpServer.registerTool` validates calls with Zod schemas. Passing JSON Schema directly produced SDK validation errors before broker dispatch.
- **Fix:** Added a small JSON Schema to Zod raw-shape adapter inside `src/mcp/host-brokered-tools.ts` for host SDK registration.
- **Files modified:** `src/mcp/host-brokered-tools.ts`
- **Verification:** `basic__echo` host `tools/call` returned upstream fixture content and recorded trace cost.
- **Committed in:** `5ca0962`

---

**Total deviations:** 2 auto-fixed (2 Rule 3 blocking)
**Impact on plan:** Both fixes were required to execute the planned tests and route brokered host calls through the SDK correctly. No scope was added beyond host brokered surface correctness.

## Issues Encountered

The hidden-key public MCP behavior resolves as an MCP `isError: true` result with not-found text rather than throwing to the client. The integration test was adjusted to assert the actual MethodNotFound-shaped host response.

## TDD Gate Compliance

Task 1 and Task 2 both produced RED test commits followed by GREEN implementation commits.

## Known Stubs

None.

## Threat Flags

None - the new host MCP trust boundary and brokered dispatch mitigations were already covered in the plan threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 142-03 can build on a host MCP surface that exposes configured brokered tools, uses overridden descriptions, blocks hidden registry keys, preserves pending drift bundling, and records host trace cost entries.

## Self-Check: PASSED

- Found `src/mcp/host-brokered-tools.ts`
- Found `tests/integration/mcp-broker/host-surface.test.ts`
- Found `.planning/phases/142-host-surface-and-consumer-context/142-02-SUMMARY.md`
- Found commit `adaa6da`
- Found commit `a84c1f2`
- Found commit `dd78650`
- Found commit `5ca0962`

---
*Phase: 142-host-surface-and-consumer-context*
*Completed: 2026-05-18*
