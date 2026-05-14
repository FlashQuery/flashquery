---
phase: 135-tool-registry-dispatch-permissions
plan: 02
subsystem: macro
tags: [macro, tool-registry, dispatch, permissions, native-tools, broker]

requires:
  - phase: 135-tool-registry-dispatch-permissions
    provides: Wave 0 red tests for macro registry and dispatcher contracts
provides:
  - Shared macro ToolRegistry, ServerEntry, ToolFn, ToolReference, and MacroCallerContext contracts
  - buildToolRegistry for host/delegated native fq tools plus broker entries
  - dispatchMacroTool lookup errors and dispatch-time allowlist backstop
affects: [135-tool-registry-dispatch-permissions, macro-support, native-tool-dispatch]

tech-stack:
  added: []
  patterns:
    - Macro native tool wrappers validate catalog inputSchema with Zod before handler invocation
    - Macro dispatch uses a flat server.tool allowlist backstop immediately before handler calls

key-files:
  created:
    - src/macro/registry.ts
    - src/macro/dispatcher.ts
  modified:
    - src/macro/types.ts

key-decisions:
  - "Macro registry construction derives host permissions from resolveHostToolExposure and delegated permissions from assembleNativeToolRegistry."
  - "Native catalog handlers are wrapped into MacroValue-returning ToolFn functions instead of returning ToolResult envelopes."
  - "Delegated fq.call_model hard exclusions are surfaced as recursive_model_excluded_from_delegated_macros metadata for later pre-scan work."

patterns-established:
  - "ToolFn is the common dispatch unit for native and brokered macro tools."
  - "Dispatcher error paths return canonical expected ToolResult envelopes, while successful tool calls return MacroValue."

requirements-completed:
  - MACRO-DISP-01
  - MACRO-DISP-03
  - MACRO-DISP-04

duration: 3m15s
completed: 2026-05-14
---

# Phase 135 Plan 02: Tool Registry And Dispatcher Foundation Summary

**Flat macro tool registry with host/delegated native allowlists, broker-ready entries, Zod-validated native wrappers, and dispatch-time permission backstop.**

## Performance

- **Duration:** 3m15s
- **Started:** 2026-05-14T18:25:19Z
- **Completed:** 2026-05-14T18:28:34Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added shared macro registry contracts to `src/macro/types.ts`.
- Implemented `buildToolRegistry` for `fq` native tools and brokered server entries without direct MCP tool handler imports.
- Implemented `dispatchMacroTool` with `unknown_server`, `unknown_tool`, and `forbidden_tools` expected-error envelopes.
- Preserved the native/broker single `ToolFn` dispatch path and proved forbidden calls do not invoke handlers.

## Task Commits

1. **Task 1: Define registry contracts and buildToolRegistry** - `6eda9ce` (feat)
2. **Task 2: Implement dispatchMacroTool lookup and backstop** - `30e0b8d` (feat)

**Plan metadata:** committed after task commits.

## Files Created/Modified

- `src/macro/types.ts` - Added `ToolFn`, `ServerEntry`, `ToolRegistry`, `ToolReference`, and `MacroCallerContext`.
- `src/macro/registry.ts` - Builds macro registry entries from host/delegated allowlists, wraps native catalog handlers, tracks template and hard-exclusion metadata, and accepts broker entries through `McpBroker`.
- `src/macro/dispatcher.ts` - Resolves server/tool references, returns expected lookup/permission errors, and invokes the resolved `ToolFn` only after allowlist validation.

## Decisions Made

- Used `resolveHostToolExposure(config.hostMcpTools)` for host-origin macro calls and `assembleNativeToolRegistry(config, purposeName, catalog)` for delegated-origin macro calls.
- Kept `fq.call_macro` out of constructed macro registry entries even when present in host/delegated allowlists.
- Converted successful native `content[0].text` JSON payloads into macro values; non-JSON text remains a string value.
- Returned successful dispatcher results as `MacroValue`; lookup and permission failures remain canonical expected `ToolResult` envelopes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Accepted direct MacroValue broker handler results**
- **Found during:** Task 1 (Define registry contracts and buildToolRegistry)
- **Issue:** The broker unit test's mock handler returned a macro value directly, while the initial adapter only accepted native MCP text-content responses.
- **Fix:** Made response adaptation accept either native `NativeToolResponse` content or direct `MacroValue` results.
- **Files modified:** `src/macro/registry.ts`
- **Verification:** `npm test -- --reporter=verbose macro-registry` passed.
- **Committed in:** `6eda9ce`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix keeps the broker-ready ToolFn surface compatible with the test contract without adding scope.

## Issues Encountered

- The initial broker adapter assumed all broker handlers returned MCP-style content arrays. The focused registry suite caught this before commit; the adapter now handles both native responses and direct macro values.

## Verification

- `npm test -- --reporter=verbose macro-registry` - passed, 5 tests.
- `npm test -- --reporter=verbose macro-dispatcher` - passed, 5 tests.
- `npm test -- --reporter=verbose macro-registry macro-dispatcher` - passed, 10 tests.
- Task 1 acceptance greps passed for type exports, native allowlist hooks, template/hard-exclusion metadata, Zod validation, invalid-argument zero-handler-call coverage, and no direct `src/mcp/tools/*` imports.
- Task 2 acceptance greps passed for dispatcher error paths and native/broker/forbidden dispatcher test coverage.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 135 Plan 03 can consume `ToolRegistry`, `allowedToolNames`, `templateToolNames`, `templateReverseMap`, and `hardExcludedReasons` to implement static permission pre-scan and evaluator wiring.

## Self-Check: PASSED

- Created files exist: `src/macro/registry.ts`, `src/macro/dispatcher.ts`, `.planning/phases/135-tool-registry-dispatch-permissions/135-02-SUMMARY.md`.
- Modified contract file exists: `src/macro/types.ts`.
- Task commits exist: `6eda9ce`, `30e0b8d`.
- Required verification command passed: `npm test -- --reporter=verbose macro-registry macro-dispatcher`.

---
*Phase: 135-tool-registry-dispatch-permissions*
*Completed: 2026-05-14*
