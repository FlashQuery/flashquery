---
phase: 139-broker-foundation-registry-and-dispatch
plan: 3
subsystem: mcp-broker
tags: [mcp-broker, stdio, lifecycle, integration, modelcontextprotocol-sdk, vitest]
requires:
  - phase: 139-01
    provides: Broker config parsing, public broker types, and TOFU hash helpers
  - phase: 139-02
    provides: ToolRegistry utilities, broker error normalization, and macro CallToolResult coercion
provides:
  - Production BrokerClient using SDK Client and StdioClientTransport
  - Public McpBroker, NullBroker, and createBroker orchestration exports
  - Fixture MCP servers and lifecycle integration coverage for Phase A process behavior
affects: [mcp-broker, broker-client, registry, macro-dispatch, agent-loop-dispatch]
tech-stack:
  added: []
  patterns:
    - Lazy one-client-per-server stdio process lifecycle with shared cold-start promise
    - Raw CallToolResult preservation at broker boundary with normalized lifecycle failures
    - Minimal reverse-request audit event without raw payload logging
key-files:
  created:
    - src/services/mcp-broker/client.ts
    - src/services/mcp-broker/index.ts
    - tests/fixtures/mcp-servers/server-basic.ts
    - tests/fixtures/mcp-servers/server-auth.ts
    - tests/fixtures/mcp-servers/server-quirky.ts
    - tests/integration/mcp-broker/client-lifecycle.test.ts
  modified:
    - src/services/mcp-broker.ts
    - src/services/mcp-broker/types.ts
    - src/services/mcp-broker/errors.ts
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "BrokerClient returns raw CallToolResult for successful protocol responses, including upstream isError results; lifecycle failures reject with NormalizedToolError."
  - "Unsupported reverse-request attempts are audited from SDK fallback/error surfaces with server ID, method, status, and trace context only."
  - "The existing src/services/mcp-broker.ts stub remains compatible for Plan 139-04 while re-exporting the new production broker factory."
patterns-established:
  - "Use SDK request timeouts for brokered calls and health probes; default health probes are live tools/list checks."
  - "Use fixture MCP servers under tests/fixtures/mcp-servers for deterministic subprocess lifecycle coverage."
requirements-completed: [REQ-013, REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-036, REQ-054, REQ-055, REQ-056, REQ-057, REQ-058, REQ-059, REQ-060]
duration: 28m43s
completed: 2026-05-18
---

# Phase 139 Plan 3: Stdio BrokerClient Lifecycle And Public Broker Orchestration Summary

**Lazy stdio MCP BrokerClient with process lifecycle controls, public broker orchestration, and fixture-backed integration coverage**

## Performance

- **Duration:** 28m43s
- **Started:** 2026-05-18T01:13:03Z
- **Completed:** 2026-05-18T01:41:46Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Added `BrokerClient` with lazy stdio spawn, shared cold-start promise, env substitution, tools/list discovery, per-call timeout, bounded stderr capture, one restart after process death, graceful shutdown with kill fallback, and live deep/shallow probes.
- Added public `McpBroker`, `NullBroker`, and `createBroker` orchestration over per-server clients and one shared `ToolRegistry`.
- Added executable MCP fixture servers and integration tests for T-I-001, T-I-002, T-I-003, T-I-008 through T-I-012, T-I-021 through T-I-025, and T-S-018 audit behavior.

## Task Commits

1. **Task 1: Add MCP fixture servers for lifecycle integration tests** - `bb0ae70` (test)
2. **Task 2: Implement BrokerClient process lifecycle** - `5ffdb37` (feat)
3. **Task 3: Implement Broker orchestration and public exports** - `75ed76d` (feat)

## Files Created/Modified

- `src/services/mcp-broker/client.ts` - Production stdio BrokerClient lifecycle around SDK Client and StdioClientTransport.
- `src/services/mcp-broker/index.ts` - Public broker module with `McpBroker`, `NullBroker`, `createBroker`, registry/error/tofu/type exports.
- `src/services/mcp-broker.ts` - Existing macro stub module now re-exports the production broker factory while preserving Plan 139-04 call-site compatibility.
- `src/services/mcp-broker/types.ts` - Added `ensureConnected` and audit event types to the broker contracts.
- `src/services/mcp-broker/errors.ts` - Recognizes already-normalized broker errors so remapping does not erase error kind.
- `tests/fixtures/mcp-servers/server-basic.ts` - Echo, slow, crash, stderr, and deterministic suspended-process fixture behavior.
- `tests/fixtures/mcp-servers/server-auth.ts` - Missing-env connect failure fixture with deterministic stderr.
- `tests/fixtures/mcp-servers/server-quirky.ts` - Reverse-request fixture for unsupported capability posture and audit coverage.
- `tests/integration/mcp-broker/client-lifecycle.test.ts` - Phase A lifecycle and public broker integration tests.
- `tests/config/vitest.integration.config.ts` - Includes the new broker lifecycle integration test file.

## Verification

- `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` - passed, 14 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts && npm run build` - passed, 14 tests and production build.

## Decisions Made

- Preserved raw SDK `CallToolResult` at the broker boundary. Upstream tool `isError` responses are returned raw; lifecycle and transport failures reject with normalized broker errors.
- Used SDK request timeout options for calls, discovery, and health probes instead of a separate Promise-only timeout wrapper.
- Kept reverse-request support negative-only: no sampling or elicitation capability is advertised, and no capability-specific handler is registered. The broker only emits a minimal audit event when an unsupported reverse request is observed.
- Re-exported the production broker factory from the existing stub module without replacing `McpBroker.getToolHandler`; Plan 139-04 can migrate dispatch call sites in lockstep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Included the new integration test in Vitest config**
- **Found during:** Task 1
- **Issue:** `npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` could not find the new file because the integration Vitest config has an explicit include list.
- **Fix:** Added `tests/integration/mcp-broker/client-lifecycle.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** RED run found and executed the file, then failed on the intentionally missing broker module.
- **Commit:** `bb0ae70`

**2. [Rule 1 - Bug] Preserved normalized broker error kind through secondary formatting**
- **Found during:** Task 2
- **Issue:** Shutdown and reconnect paths could pass an already-normalized broker error back through `formatToolError`, losing the original kind.
- **Fix:** Added normalized-error detection in `formatToolError` and explicit shutdown transport-closed mapping in `BrokerClient`.
- **Files modified:** `src/services/mcp-broker/errors.ts`, `src/services/mcp-broker/client.ts`
- **Verification:** Lifecycle integration tests passed, including shutdown and restart cases.
- **Commit:** `5ffdb37`

**Total deviations:** 2 auto-fixed (1 blocking harness issue, 1 lifecycle error bug).
**Impact on plan:** Both fixes were required to execute and verify the planned behavior. No feature scope was added beyond the plan.

## Issues Encountered

- The SDK returns unsupported reverse-request attempts as raw tool `isError` results when surfaced through a tool handler. Tests and broker behavior preserve that raw result while auditing the unsupported method.
- The hung-process health probe uses a deterministic fixture self-suspend path instead of relying on external SIGSTOP orchestration from the test runner.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: subprocess_spawn | `src/services/mcp-broker/client.ts` | New external stdio child-process boundary; mitigated by config-derived command/args only, bounded stderr, call timeouts, shutdown kill fallback, and no reverse capabilities. |

## User Setup Required

None - no external service configuration required. The focused integration suite used local fixture processes and the existing `.env.test` loader.

## Next Phase Readiness

Plan 139-04 can route macro and agent-loop dispatch through `Broker.callTool`, using the new `createBroker`/`McpBroker` exports, shared registry, raw `CallToolResult` behavior, and `NullBroker` fallback.

## Self-Check: PASSED

Verified all created files exist on disk, all task commits (`bb0ae70`, `5ffdb37`, `75ed76d`) exist in git history, and final verification passed.

---
*Phase: 139-broker-foundation-registry-and-dispatch*
*Completed: 2026-05-18*
