---
phase: 116-model-visible-tool-registry
plan: 01
subsystem: llm
tags: [tool-registry, native-tools, tdd, vitest]

requires:
  - phase: 115-purpose-config-bindings-capabilities
    provides: Purpose-level tools/excludedTools config fields and structured model capabilities
provides:
  - Pure native tool registry tier expansion
  - Purpose exclusions after tier and explicit-name union
  - Hard-excluded native tool diagnostics for delegated model exposure
affects: [phase-117-agent-loop-executor, phase-119-discovery-diagnostics]

tech-stack:
  added: []
  patterns: [Pure LLM policy module, structured registry diagnostics, TDD red-green commits]

key-files:
  created:
    - src/llm/tool-registry.ts
    - tests/unit/llm-tool-registry.test.ts
  modified: []

key-decisions:
  - "Kept providerTools explicitly undefined until Phase 116 Plan 02 adds schema translation."
  - "Hard exclusions are removed after exclusions and reported through diagnostics rather than silently dropped."

patterns-established:
  - "Native tool tiers are static product policy constants, not inferred from the MCP server surface."
  - "Registry assembly is pure: it reads config/catalog input and returns deterministic names plus diagnostics without dispatching handlers."

requirements-completed: [TOOL-01, TOOL-02, TOOL-03]

duration: 12min
completed: 2026-05-06
---

# Phase 116 Plan 01: Native Tool Registry Policy Summary

**Pure native tool exposure policy with deterministic tier expansion, post-expansion exclusions, and hard-exclusion diagnostics**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-06T11:34:49Z
- **Completed:** 2026-05-06T11:46:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added RED unit coverage for read-only/read-write tier expansion, explicit tool union, duplicate removal, exclusions, hard exclusions, and empty registry output.
- Implemented `src/llm/tool-registry.ts` as a pure policy module exporting `TOOL_TIERS`, `HARD_EXCLUDED_NATIVE_TOOLS`, and `assembleNativeToolRegistry`.
- Verified hard-excluded tools `call_model`, `register_plugin`, `unregister_plugin`, and `get_plugin_info` never appear in `nativeToolNames` and produce exact diagnostics.

## Task Commits

1. **Task 1: Lock native tool expansion behavior** - `76ed625` (test)
2. **Task 2: Implement pure native registry assembly** - `d6cb407` (feat)

**Plan metadata:** final docs commit

## Files Created/Modified

- `tests/unit/llm-tool-registry.test.ts` - Focused Vitest coverage for tier expansion, explicit names, exclusion order, hard exclusions, and empty output.
- `src/llm/tool-registry.ts` - Pure native tool policy constants, diagnostics types, and deterministic registry assembly.

## Decisions Made

- Kept `providerTools: undefined` as an explicit no-schema state for Plan 02.
- Lowercased purpose lookup names during assembly to match Phase 115 normalization.
- Treated tool tiers as static product/security policy rather than deriving them from the full MCP registry.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. The stub scan found only internal empty-array accumulator initialization in `src/llm/tool-registry.ts`, not placeholder behavior.

## Threat Flags

None. This plan introduced no network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Verification

- `grep -n "tier:read-only" tests/unit/llm-tool-registry.test.ts` - PASS
- `grep -n "tier:read-write" tests/unit/llm-tool-registry.test.ts` - PASS
- `grep -n "call_model" tests/unit/llm-tool-registry.test.ts` - PASS
- RED: `npm test -- tests/unit/llm-tool-registry.test.ts` - FAIL as expected before implementation because `src/llm/tool-registry.ts` was missing.
- GREEN: `npm test -- tests/unit/llm-tool-registry.test.ts` - PASS, 8 tests.
- `npm run lint` - PASS.
- `npm run build` - PASS.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can build provider schema translation on top of the pure `NativeToolDefinition` catalog shape and the explicit `providerTools: undefined` placeholder.

## Self-Check: PASSED

- Found `src/llm/tool-registry.ts`
- Found `tests/unit/llm-tool-registry.test.ts`
- Found `.planning/phases/116-model-visible-tool-registry/116-01-SUMMARY.md`
- Found commits `76ed625` and `d6cb407`

---
*Phase: 116-model-visible-tool-registry*
*Completed: 2026-05-06*
