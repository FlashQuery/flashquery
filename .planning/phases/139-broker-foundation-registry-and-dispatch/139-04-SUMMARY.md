---
phase: 139-broker-foundation-registry-and-dispatch
plan: 4
subsystem: mcp-broker
tags: [mcp-broker, dispatch, agent-loop, macro, trace, vitest]
requires:
  - phase: 139-02
    provides: Registry keys, consumer filtering, broker error formatting, and macro CallToolResult coercion
  - phase: 139-03
    provides: Production BrokerClient, McpBroker, NullBroker, and fixture MCP servers
provides:
  - Delegated model tool assembly with consumer-visible brokered tools
  - Agent-loop registry-key dispatch through raw Broker.callTool
  - Macro dotted-ref dispatch through raw Broker.callTool with fail-fast broker errors
  - Sanitized brokered tool_calls trace accumulator with resolved cost
  - Fixture-backed dispatch seam integration coverage
affects: [mcp-broker, agent-loop, macro-runtime, cost-trace, integration-tests]
tech-stack:
  added: []
  patterns:
    - Consumer-owned raw CallToolResult adaptation at LLM and macro boundaries
    - Visibility-before-dispatch checks for brokered registry keys and macro refs
    - In-memory sanitized brokered tool_calls trace snapshots keyed by traceId
key-files:
  created:
    - src/services/mcp-broker/trace.ts
    - tests/integration/mcp-broker/dispatch.test.ts
  modified:
    - src/services/mcp-broker.ts
    - src/services/mcp-broker/index.ts
    - src/services/mcp-broker/registry.ts
    - src/macro/registry.ts
    - src/llm/agent-loop.ts
    - src/llm/tool-registry.ts
    - src/llm/tool-dispatcher.ts
    - src/llm/cost-tracker.ts
    - tests/config/vitest.integration.config.ts
    - tests/unit/llm-agent-loop.test.ts
    - tests/unit/llm-tool-dispatcher.test.ts
    - tests/unit/macro-registry.test.ts
key-decisions:
  - "McpBroker.listToolsForConsumer now connects only consumer-visible servers before returning brokered tool definitions, preserving no-visibility no-spawn behavior while making delegated discovery real."
  - "Brokered dispatcher success wraps only CallToolResult.content into the existing LLM tool-message success envelope; macro dispatch keeps raw CallToolResult until coerceCallToolResult."
  - "Brokered trace entries store only server, tool, count, and resolved cost; arguments and raw result payloads are intentionally excluded."
patterns-established:
  - "Use Broker.listToolsForConsumer(ctx) as both the delegated discovery source and the visibility gate before Broker.callTool."
  - "Use serverId__toolName for delegated provider tool names and serverId.toolName for macro refs, both resolving to the same Broker.callTool API."
requirements-completed: [REQ-002, REQ-003, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031, REQ-032, REQ-033, REQ-034, REQ-035, REQ-036, REQ-037, REQ-050, REQ-051, REQ-052, REQ-053, REQ-106, REQ-107, REQ-108]
duration: 13m34s
completed: 2026-05-18
---

# Phase 139 Plan 4: Agent-loop And Macro Broker Dispatch Seams Summary

**Production brokered dispatch through delegated and macro seams with raw CallToolResult adaptation and sanitized cost tracing**

## Performance

- **Duration:** 13m34s
- **Started:** 2026-05-18T01:45:48Z
- **Completed:** 2026-05-18T01:59:22Z
- **Tasks:** 5
- **Files modified:** 14

## Accomplishments

- Added brokered delegated tool assembly: `executeAgentLoop` builds a purpose `ConsumerContext`, asks `Broker.listToolsForConsumer`, appends visible brokered tools as `serverId__toolName`, and passes the same context into dispatch.
- Added agent-loop broker dispatch: registry-key calls are visibility-checked, sent to `Broker.callTool` with bit-exact provider arguments, and wrapped into existing LLM tool-message payloads.
- Replaced macro broker dispatch: `src/services/mcp-broker.ts` now re-exports production broker APIs, and macro dotted refs call raw `Broker.callTool`, fail fast on broker errors, and coerce successes via `coerceCallToolResult`.
- Added `src/services/mcp-broker/trace.ts` and wired both dispatch seams to record sanitized `tool_calls` trace entries with aggregated count and resolved cost.
- Added integration coverage using `server-basic` for delegated tool assembly, registry-key dispatch, macro dotted-ref dispatch, argument passthrough, and trace cost.

## Task Commits

1. **Task 1: Add brokered tools to delegated model tool assembly** - `0d66db2` (test), `5e4fc17` (feat)
2. **Task 2: Route agent-loop registry-key calls to Broker.callTool** - `042521c` (test), `962d302` (feat)
3. **Task 3: Rewrite macro broker wrapper to use raw Broker.callTool** - `901d34f` (test), `e769a9b` (feat)
4. **Task 4: Record brokered tool_calls trace entries with resolved cost** - `ae30cdf` (test), `70392d7` (feat)
5. **Task 5: Add dispatch seam integration coverage** - `7e470c0` (test), `b883fe3` (feat)

_All five tasks were TDD tasks, so each has a RED test commit followed by a GREEN implementation commit._

## Files Created/Modified

- `src/services/mcp-broker/trace.ts` - Sanitized brokered `tool_calls` trace accumulator.
- `src/services/mcp-broker.ts` - Compatibility module now re-exports production broker APIs and aliases `NullBroker` for older call sites.
- `src/services/mcp-broker/index.ts` - Public broker now discovers consumer-visible servers before returning visible tools.
- `src/services/mcp-broker/registry.ts` - Exposes visible server IDs for targeted broker discovery.
- `src/llm/agent-loop.ts` - Delegated brokered tool assembly and consumer context threading.
- `src/llm/tool-registry.ts` - Brokered tool to OpenAI-compatible function definition adapter.
- `src/llm/tool-dispatcher.ts` - Registry-key broker dispatch, visibility gate, raw argument passthrough, result wrapping, and trace recording.
- `src/macro/registry.ts` - Raw broker macro wrapper with visibility gate, fail-fast error handling, success coercion, and trace recording.
- `src/llm/cost-tracker.ts` - Adds a typed `tool_calls` trace metadata shape.
- `tests/unit/llm-agent-loop.test.ts` - Delegated brokered assembly coverage.
- `tests/unit/llm-tool-dispatcher.test.ts` - Brokered dispatcher coverage.
- `tests/unit/macro-registry.test.ts` - Macro broker wrapper coverage.
- `tests/integration/mcp-broker/dispatch.test.ts` - Fixture-backed dispatch seam integration coverage.
- `tests/config/vitest.integration.config.ts` - Includes dispatch integration test.

## Verification

- `npm test -- --run tests/unit/llm-agent-loop.test.ts` - passed, 28 tests.
- `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts` - passed, 18 tests.
- `npm test -- --run tests/unit/macro-registry.test.ts tests/unit/macro-coerce.test.ts` - passed, 15 tests.
- `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro-registry.test.ts` - passed, 29 tests.
- `npm run test:integration -- --run tests/integration/mcp-broker/dispatch.test.ts` - passed, 2 tests.
- `npm test -- --run tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro-registry.test.ts tests/unit/macro-coerce.test.ts` - passed, 63 tests.
- `npm run build` - passed.

## Decisions Made

- Connected only consumer-visible servers during `McpBroker.listToolsForConsumer(ctx)` so delegated brokered tool assembly can discover real tools without spawning unrelated servers.
- Kept brokered LLM dispatch result wrapping intentionally narrow: success exposes `{ content }` in the native-response envelope, while macro dispatch consumes full raw `CallToolResult` through `coerceCallToolResult`.
- Recorded brokered trace cost from the visible `BrokeredTool.costPerCall` entry instead of inspecting payloads or arguments.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Connected visible broker servers before delegated tool assembly**
- **Found during:** Task 5
- **Issue:** `McpBroker.listToolsForConsumer(ctx)` returned only already-registered tools. A delegated purpose with `mcp_servers: ['basic']` could miss `basic__echo` before any broker call had connected the server.
- **Fix:** Added `ToolRegistry.listVisibleServerIds(ctx)` and changed `McpBroker.listToolsForConsumer(ctx)` to connect only visible configured servers before returning the filtered tool list.
- **Files modified:** `src/services/mcp-broker/index.ts`, `src/services/mcp-broker/registry.ts`
- **Verification:** `npm run test:integration -- --run tests/integration/mcp-broker/dispatch.test.ts` passed.
- **Commit:** `b883fe3`

**Total deviations:** 1 auto-fixed (1 missing critical functionality).
**Impact on plan:** The fix is required for the plan's delegated discovery goal and preserves the no-visibility no-spawn constraint.

## Issues Encountered

- The new integration test initially used the default usage recorder, which can attempt Supabase writes during the agent-loop test. The test now injects `recordUsage: vi.fn()` because the dispatch seam is the target behavior.
- The macro integration config initially set `hostMcpTools.tools: []`, which is an invalid host-native selector. The test omits that field because host-native exposure is unrelated to broker dispatch.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required. Integration coverage uses local fixture MCP servers and the existing `.env.test` setup.

## Next Phase Readiness

Plan 05 can build on production brokered dispatch seams. Delegated and macro paths now share `Broker.callTool`, enforce consumer visibility before dispatch, preserve raw argument passthrough, and expose sanitized `tool_calls` cost trace data for later host-surface and scenario coverage.

## Self-Check: PASSED

Verified created files exist on disk, all task commits (`0d66db2`, `5e4fc17`, `042521c`, `962d302`, `901d34f`, `e769a9b`, `ae30cdf`, `70392d7`, `7e470c0`, `b883fe3`) exist in git history, and all plan-level verification commands passed.

---
*Phase: 139-broker-foundation-registry-and-dispatch*
*Completed: 2026-05-18*
