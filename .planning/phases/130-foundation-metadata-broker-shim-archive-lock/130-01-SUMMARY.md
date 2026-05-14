---
phase: 130-foundation-metadata-broker-shim-archive-lock
plan: 01
subsystem: mcp-tools
tags: [macro, mcp, tool-metadata, response-formats, broker-shim, vitest]

requires:
  - phase: 121-foundation-metadata-response-helpers-test-harness
    provides: canonical JSON MCP response helpers and central tool metadata registry
  - phase: 117-agent-loop-executor
    provides: NativeToolHandler type and delegated native tool registry policy
provides:
  - additive macro response contracts and macroResult ToolResult wrapper
  - call_macro metadata with recursive delegated hard exclusion
  - call_macro MCP scaffold returning canonical unsupported expected error
  - McpBroker interface and NullMcpBroker implementation
affects: [macro-support, mcp-tool-surface, delegated-native-tools, broker-integration]

tech-stack:
  added: []
  patterns: [additive response-format exports, safe MCP scaffold registrar, null service shim]

key-files:
  created:
    - src/mcp/tools/macro.ts
    - src/services/mcp-broker.ts
    - tests/unit/mcp-broker.test.ts
  modified:
    - src/mcp/utils/response-formats.ts
    - src/mcp/tool-metadata.ts
    - src/mcp/server.ts
    - tests/unit/response-formats.test.ts
    - tests/unit/tool-metadata.test.ts
    - tests/unit/mcp-server-tools.test.ts

key-decisions:
  - "macroResult returns the existing JSON ToolResult envelope directly by delegating to jsonToolResult."
  - "call_macro is registered as final admin llm metadata and delegated-hard-excluded with RECURSIVE_MODEL_REASON."
  - "The Phase 130 call_macro handler accepts a permissive scaffold schema but performs no parsing, source_ref resolution, dry-run, budget, progress, or execution behavior."
  - "NullMcpBroker reuses NativeToolHandler for future dispatch compatibility while exposing no brokered connectivity in v0."

patterns-established:
  - "Macro success payload contracts live additively in response-formats.ts alongside canonical response helpers."
  - "Foundation-only MCP tools can register with safe canonical expected-error scaffolds before execution engines land."
  - "Future broker integration should swap the McpBroker implementation rather than rewriting macro dispatch call sites."

requirements-completed: [MACRO-RESP-01, MACRO-RESP-02, MACRO-RESP-03, MACRO-RESP-04, MACRO-OBS-01, MACRO-INT-05, MACRO-INT-06]

duration: 8m04s
completed: 2026-05-14
---

# Phase 130 Plan 01: Macro Foundation Summary

**Macro response contracts, call_macro metadata/scaffold registration, and a broker-ready null shim are in place for later macro engine phases.**

## Performance

- **Duration:** 8m04s
- **Started:** 2026-05-14T04:10:47Z
- **Completed:** 2026-05-14T04:18:51Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added `MACRO_ERROR_CODES`, macro payload interfaces, flat `TraceStep`, and `macroResult()` as additive exports without changing existing response helpers.
- Registered `call_macro` in canonical metadata as final/admin/llm with `RECURSIVE_MODEL_REASON`, keeping it out of delegated native access.
- Added `registerMacroTools()` and wired it into MCP server registration before native schema validation.
- Added a safe `call_macro` scaffold that returns `unsupported` with `details.reason: "phase_130_scaffold"` and performs no macro execution.
- Added `McpBroker` and `NullMcpBroker`, with tests proving disconnected/null-handler behavior.

## Task Commits

1. **Task 1 RED: macro response contract tests** - `67ec71f` (test)
2. **Task 1 GREEN: macro response contracts** - `60faf9a` (feat)
3. **Task 2 RED: call_macro scaffold tests** - `270bdaa` (test)
4. **Task 2 GREEN: call_macro scaffold** - `d5b91da` (feat)
5. **Task 3 RED: NullMcpBroker tests** - `f3ffac6` (test)
6. **Task 3 GREEN: NullMcpBroker shim** - `f894c8f` (feat)

## Files Created/Modified

- `src/mcp/utils/response-formats.ts` - Adds macro error codes, success payload interfaces, flat trace shape, and `macroResult()`.
- `src/mcp/tool-metadata.ts` - Adds `D.callMacro` and final `call_macro` metadata with recursive delegated hard exclusion.
- `src/mcp/tools/macro.ts` - Adds the non-executing `call_macro` MCP scaffold registrar.
- `src/mcp/server.ts` - Wires macro tool registration before native schema validation.
- `src/services/mcp-broker.ts` - Adds `McpBroker` and `NullMcpBroker`.
- `tests/unit/response-formats.test.ts` - Covers macro response contracts and unchanged helper behavior.
- `tests/unit/tool-metadata.test.ts` - Covers `call_macro` metadata, delegated exclusion, and legacy descriptions.
- `tests/unit/mcp-server-tools.test.ts` - Covers native catalog registration and scaffold expected-error response.
- `tests/unit/mcp-broker.test.ts` - Covers null broker connectivity and handler absence.

## Decisions Made

- `macroResult()` returns `ToolResult` by delegating directly to `jsonToolResult(payload)`, matching the plan's T-U-207 contract.
- `call_macro` uses the existing `RECURSIVE_MODEL_REASON` delegated hard-exclusion path instead of adding a macro-specific policy mechanism.
- The handler accepts only a permissive scaffold input shape in Phase 130; full source exclusivity, source resolution, dry-run, progress, budgets, and execution are deferred to later macro phases.
- `NullMcpBroker.getToolHandler()` returns `NativeToolHandler | null` so future brokered dispatch can share the native handler callable shape.

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

- Task 1 followed RED/GREEN: `67ec71f` added failing response-format tests, then `60faf9a` made them pass.
- Task 2 followed RED/GREEN: `270bdaa` added failing metadata/registrar tests, then `d5b91da` made them pass.
- Task 3 followed RED/GREEN: `f3ffac6` added failing broker tests, then `f894c8f` made them pass.

## Issues Encountered

- The single combined focused verification command hung after Vitest startup. The stuck process was terminated, and the same focused test set was rerun successfully in two smaller chunks.
- Plan 130-02 completed in parallel while this plan was executing. Its commits and state updates were left intact; this summary only documents plan 130-01 work.

## Known Stubs

None. Stub-pattern scan found only existing initialized collections and null checks, not placeholder data or incomplete macro implementation stubs.

## Verification

- `npm test -- --run tests/unit/response-formats.test.ts` - passed
- `npm test -- --run tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts` - passed
- `npm test -- --run tests/unit/mcp-broker.test.ts` - passed
- `npm test -- --run tests/unit/response-formats.test.ts tests/unit/mcp-broker.test.ts` - passed
- `npm test -- --run tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts` - passed
- `npm run build` - passed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Later macro phases can now import stable macro response contracts, discover `call_macro` in the native catalog, rely on delegated hard exclusion for recursive safety, and consume the broker seam without adding real broker connectivity.

## Self-Check: PASSED

- Created summary and key files exist on disk.
- Task commits `67ec71f`, `60faf9a`, `270bdaa`, `d5b91da`, `f3ffac6`, and `f894c8f` exist in git history.
- Focused tests and build passed after rerunning the focused suite in stable chunks.

---
*Phase: 130-foundation-metadata-broker-shim-archive-lock*
*Completed: 2026-05-14*
