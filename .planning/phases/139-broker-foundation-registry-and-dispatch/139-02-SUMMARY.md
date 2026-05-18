---
phase: 139-broker-foundation-registry-and-dispatch
plan: 2
subsystem: mcp-broker
tags: [mcp-broker, registry, errors, macro, call-tool-result, vitest]
requires:
  - phase: 139-01
    provides: Broker public types, config shapes, and shared CallToolResult contracts
provides:
  - Pure broker registry key utilities and consumer-filtered ToolRegistry
  - Central broker error normalization taxonomy and raw-stripping serializer
  - Macro CallToolResult coercion helper with isError guard and argument passthrough helper
affects: [mcp-broker, registry, macro, dispatch, agent-loop]
tech-stack:
  added: []
  patterns:
    - Pure registry utilities with namespaced broker keys and bare FQ-native tool names
    - Centralized broker error formatting before logs, traces, or macro fail-fast paths
    - Consumer-owned CallToolResult shaping for brokered macro results
key-files:
  created:
    - src/services/mcp-broker/registry.ts
    - src/services/mcp-broker/errors.ts
    - src/macro/coerce.ts
    - tests/unit/mcp-broker-registry.test.ts
    - tests/unit/mcp-broker-errors.test.ts
    - tests/unit/macro-coerce.test.ts
  modified: []
key-decisions:
  - "ToolRegistry accepts structural config-shaped input rather than importing the full config loader, keeping the registry pure and reusable by broker/client/dispatch plans."
  - "McpError normalization uses structural detection in addition to instanceof because the SDK/runtime path can surface McpError-shaped Error objects."
  - "Macro broker coercion throws if called with isError=true while also exporting isCallToolErrorResult so Plan 139-04 can check fail-fast before binding values."
patterns-established:
  - "Brokered tools use serverId__toolName for LLM-facing registry keys and serverId.toolName for macro references."
  - "Registry list methods return copies so consumer-filtered views cannot mutate canonical registry entries."
  - "Brokered macro result conversion lives in src/macro/coerce.ts, not in the broker service."
requirements-completed: [REQ-027, REQ-028, REQ-029, REQ-030, REQ-031, REQ-032, REQ-050, REQ-051, REQ-052, REQ-053, REQ-106, REQ-107, REQ-108]
duration: 5m23s
completed: 2026-05-18
---

# Phase 139 Plan 2: Registry Utilities, Error Taxonomy, And Macro Coercion Summary

**Pure broker registry, normalized error taxonomy, and macro CallToolResult coercion for downstream dispatch integration**

## Performance

- **Duration:** 5m23s
- **Started:** 2026-05-18T01:21:42Z
- **Completed:** 2026-05-18T01:27:04Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added `makeRegistryKey`, `parseRegistryKey`, `isRegistryKey`, `parseMacroRef`, and `ToolRegistry` with host/purpose visibility filtering, description overrides, cost resolution, collision-safe keys, and no `fq__` native names.
- Added `formatToolError` and `stripRawFromToolError` covering `CallToolResult.isError`, SDK `McpError`, native transport/timeout/spawn errors, and `experimental_tasks_required` subkind detection.
- Added `coerceCallToolResult`, `isCallToolErrorResult`, and `coerceBrokerToolArguments` for macro-side brokered result handling without using native response parsing.

## Task Commits

1. **Task 1: Implement registry utilities and consumer filtering** - `0954eb6` (test), `082a56e` (feat)
2. **Task 2: Implement broker error taxonomy and raw-stripping behavior** - `5359380` (test), `6a01e56` (feat)
3. **Task 3: Implement macro CallToolResult coercion helper** - `8bce617` (test), `f15eea3` (feat)

_Note: All three tasks were TDD tasks, so each has a RED test commit and a GREEN implementation commit._

## Files Created/Modified

- `src/services/mcp-broker/registry.ts` - Broker registry key helpers and consumer-filtered `ToolRegistry`.
- `src/services/mcp-broker/errors.ts` - Broker error formatter and raw-stripping serializer.
- `src/macro/coerce.ts` - Brokered `CallToolResult` to `MacroValue` coercion and argument passthrough helper.
- `tests/unit/mcp-broker-registry.test.ts` - Covers T-U-006, T-U-007, T-U-046, T-U-047, and consumer filtering.
- `tests/unit/mcp-broker-errors.test.ts` - Covers T-U-008 through T-U-015.
- `tests/unit/macro-coerce.test.ts` - Covers T-U-016 through T-U-021.

## Verification

- `npm test -- --run tests/unit/mcp-broker-registry.test.ts` - passed, 5 tests.
- `npm test -- --run tests/unit/mcp-broker-errors.test.ts` - passed, 8 tests.
- `npm test -- --run tests/unit/macro-coerce.test.ts && npm run build` - passed, 6 tests and build.
- `npm test -- --run tests/unit/mcp-broker-registry.test.ts tests/unit/mcp-broker-errors.test.ts tests/unit/macro-coerce.test.ts && npm run build` - passed, 19 focused tests and build.

## Decisions Made

- Kept registry config input structural and narrow so later broker/client construction can pass resolved config without creating a config-loader dependency in the registry module.
- Used copy-on-read registry outputs because visibility filtering is a derived consumer view and must not mutate canonical entries.
- Used structural `McpError` detection as well as `instanceof` so SDK-shaped errors normalize correctly across runtime/import paths.
- Kept brokered macro coercion separate from `parseNativeToolResponse`; brokered results preserve raw `CallToolResult` semantics until the macro consumer boundary.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## Issues Encountered

- During Task 2 GREEN, focused tests showed SDK `McpError` objects reached the formatter as Error-like values that did not satisfy the simple `instanceof` path. The formatter now detects numeric MCP `code` structurally and strips the SDK's `MCP error <code>:` prefix for stable messages.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can build the stdio `BrokerClient` lifecycle on top of the registry and error helpers. Plan 04 can route agent-loop and macro broker dispatch through raw `Broker.callTool`, using `isCallToolErrorResult`, `formatToolError`, and `coerceCallToolResult` at the consumer boundary.

## Self-Check: PASSED

Verified all created files exist on disk and commits `0954eb6`, `082a56e`, `5359380`, `6a01e56`, `8bce617`, and `f15eea3` exist in git history.

---
*Phase: 139-broker-foundation-registry-and-dispatch*
*Completed: 2026-05-18*
