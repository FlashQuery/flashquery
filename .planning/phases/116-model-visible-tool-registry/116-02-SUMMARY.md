---
phase: 116-model-visible-tool-registry
plan: 02
subsystem: llm
tags: [tool-registry, mcp, zod, openai-tools, tdd, vitest]

requires:
  - phase: 116-model-visible-tool-registry
    provides: Pure native tool tier expansion, hard exclusions, and diagnostics from Plan 01
provides:
  - Native MCP tool registration metadata catalog capture
  - Zod/raw MCP input schema conversion to OpenAI-compatible function tools
  - Strict tool JSON Schema normalization for selected strict-capable models
affects: [phase-117-agent-loop-executor, phase-119-discovery-diagnostics]

tech-stack:
  added: []
  patterns: [Catalog wrapper around MCP registration, Zod 4 toJSONSchema provider translation, strict schema normalization]

key-files:
  created:
    - src/mcp/tool-catalog.ts
  modified:
    - src/mcp/server.ts
    - src/llm/tool-registry.ts
    - tests/unit/llm-tool-registry.test.ts

key-decisions:
  - "Captured native tool metadata by wrapping McpServer.registerTool before registration instead of reading SDK internals."
  - "Provider tools are generated only after hard exclusions, so hard-excluded requests omit providerTools when no safe tools remain."
  - "Strict mode normalizes object schemas by setting additionalProperties: false and requiring every property key."

patterns-established:
  - "Catalog capture records only name, description, and inputSchema while delegating handlers unchanged."
  - "Provider tool translation accepts both FlashQuery's raw MCP Zod shape objects and direct z.object schemas."

requirements-completed: [TOOL-04, VAL-116]

duration: 4m11s
completed: 2026-05-06
---

# Phase 116 Plan 02: Model-Visible Tool Schema Translation Summary

**Native MCP registration capture with Zod-to-OpenAI function tool translation and strict schema normalization**

## Performance

- **Duration:** 4m11s
- **Started:** 2026-05-06T11:50:56Z
- **Completed:** 2026-05-06T11:55:07Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added RED unit coverage for raw MCP shape conversion, direct `z.object` conversion, strict schema normalization, non-strict definitions, and hard-excluded provider omission.
- Added `src/mcp/tool-catalog.ts` to capture native MCP tool metadata at registration time without altering handler dispatch.
- Wired catalog capture before all native tool registration in `src/mcp/server.ts`.
- Implemented OpenAI-compatible function tool definitions from Zod JSON Schema with strict and non-strict modes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add catalog capture contract tests** - `ad368dc` (test)
2. **Task 2: Implement catalog wrapper and provider tool translation** - `e5530fe` (feat)

**Plan metadata:** final docs commit

## Files Created/Modified

- `src/mcp/tool-catalog.ts` - Catalog helper that wraps `McpServer.registerTool` once and records tool name, description, and input schema before delegating.
- `src/mcp/server.ts` - Wires `wrapServerWithToolCatalog(server)` immediately after correlation wrapping and before tool registration.
- `src/llm/tool-registry.ts` - Adds OpenAI function tool types, Zod/raw shape conversion, JSON Schema normalization, and provider tool assembly.
- `tests/unit/llm-tool-registry.test.ts` - Adds schema translation and strict-mode coverage and updates registry assembly expectations.

## Decisions Made

- Used a WeakMap-backed catalog keyed by `McpServer` so catalog state is associated with the server instance and does not require SDK private introspection.
- Preserved handler behavior by wrapping only `registerTool`, recording metadata, then returning the original registration result.
- Used Zod 4 `z.toJSONSchema()` as the conversion source and kept OpenAI-specific constraints in a small normalizer.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## Issues Encountered

- The first implementation pass failed lint on an unnecessary type assertion in `src/mcp/tool-catalog.ts`; removed the assertion and reran lint successfully.

## Known Stubs

None. The stub scan found only internal empty object/array initialization in `src/mcp/server.ts` and `src/llm/tool-registry.ts`, not placeholder behavior or unwired UI/data output.

## Verification

- RED: `npm test -- tests/unit/llm-tool-registry.test.ts` - FAIL as expected before implementation, with missing helper/provider output failures.
- `grep -n "toOpenAiToolDefinition" tests/unit/llm-tool-registry.test.ts` - PASS.
- `grep -n "additionalProperties" tests/unit/llm-tool-registry.test.ts` - PASS.
- `grep -n "z.object" tests/unit/llm-tool-registry.test.ts` - PASS.
- `grep -n "export function wrapServerWithToolCatalog" src/mcp/tool-catalog.ts` - PASS.
- `grep -n "wrapServerWithToolCatalog(server)" src/mcp/server.ts` - PASS, before `registerMemoryTools(server, config)`.
- `grep -n "z\\.toJSONSchema" src/llm/tool-registry.ts` - PASS.
- `grep -n "strict: true" src/llm/tool-registry.ts tests/unit/llm-tool-registry.test.ts` - PASS.
- `npm test -- tests/unit/llm-tool-registry.test.ts` - PASS, 14 tests.
- `npm run lint` - PASS.
- `npm run build` - PASS.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 117 can consume `nativeToolNames` and `providerTools` for delegated model loop execution, with hard-excluded tools removed before provider definitions are assembled.

## Self-Check: PASSED

- Found `src/mcp/tool-catalog.ts`
- Found `src/mcp/server.ts`
- Found `src/llm/tool-registry.ts`
- Found `tests/unit/llm-tool-registry.test.ts`
- Found `.planning/phases/116-model-visible-tool-registry/116-02-SUMMARY.md`
- Found commits `ad368dc` and `e5530fe`

---
*Phase: 116-model-visible-tool-registry*
*Completed: 2026-05-06*
