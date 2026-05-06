---
phase: 116-model-visible-tool-registry
plan: 03
subsystem: config
tags: [llm, config, tool-registry, validation, tdd, vitest]

requires:
  - phase: 116-model-visible-tool-registry
    provides: Native tool tier constants, hard-exclusion constants, and registry diagnostics from Plan 01
provides:
  - Startup validation for purpose native tool declarations
  - Config errors for excluded_tools without tools
  - Config errors for unknown tool tiers and unknown native tool names
  - Preservation of hard-excluded tool declarations for registry warning/removal diagnostics
affects: [phase-117-agent-loop-executor, phase-119-discovery-diagnostics]

tech-stack:
  added: []
  patterns: [Config semantic validation against registry policy constants, TDD red-green commits]

key-files:
  created:
    - .planning/phases/116-model-visible-tool-registry/116-03-SUMMARY.md
  modified:
    - src/config/loader.ts
    - tests/unit/llm-config.test.ts

key-decisions:
  - "Validated purpose tool declarations from static registry policy constants rather than MCP runtime registration state."
  - "Allowed hard-excluded native tool names through config validation so registry diagnostics can warn/remove them."

patterns-established:
  - "Config startup validation rejects unknown tool exposure declarations before capability admission and provider calls."
  - "Hard-excluded native tools are known names for validation, but remain unsafe for exposure in registry assembly."

requirements-completed: [TOOL-01, TOOL-02, TOOL-03, VAL-116]

duration: 5m16s
completed: 2026-05-06
---

# Phase 116 Plan 03: Purpose Tool Declaration Validation Summary

**Startup semantic validation for purpose native tool declarations using registry policy constants**

## Performance

- **Duration:** 5m16s
- **Started:** 2026-05-06T11:58:52Z
- **Completed:** 2026-05-06T12:04:08Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added RED config parser coverage for `excluded_tools` without `tools`, unknown `tier:*` values, unknown native tool names in both `tools` and `excluded_tools`, and hard-excluded name preservation.
- Imported `TOOL_TIERS` and `HARD_EXCLUDED_NATIVE_TOOLS` into the loader and added semantic validation inside `validateLlmConfig()`.
- Preserved `call_model` and plugin admin tool declarations as valid config inputs so Plan 01 registry diagnostics remain responsible for warning/removal.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add config validation tests for tool declarations** - `42ce22d` (test)
2. **Task 2: Implement purpose tool declaration validation** - `cd3c161` (feat)

**Plan metadata:** final docs commit

## Files Created/Modified

- `tests/unit/llm-config.test.ts` - Adds TOOL-01 through TOOL-03 config validation coverage and updates older placeholder tool names to real native tool names.
- `src/config/loader.ts` - Validates purpose `tools` and `excluded_tools` against registry tier/native/hard-excluded names at config load.
- `.planning/phases/116-model-visible-tool-registry/116-03-SUMMARY.md` - Records plan execution and verification.

## Decisions Made

- Used the registry policy constants as the validation source of truth, matching the plan's `TOOL_TIERS|HARD_EXCLUDED_NATIVE_TOOLS` link.
- Kept validation before capability admission so malformed exposure declarations produce `[purpose]` config errors instead of later capability or provider failures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced legacy placeholder tool names in existing config tests**
- **Found during:** Task 2 (Implement purpose tool declaration validation)
- **Issue:** Two older ATL-U-08 tests used placeholder tool names `read` and `write`, which became invalid once real native tool declaration validation was added.
- **Fix:** Updated those tests to use `search_memory` and `get_memory`, preserving the original parse/admission intent while satisfying the new validation contract.
- **Files modified:** `tests/unit/llm-config.test.ts`
- **Verification:** `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts` passed.
- **Committed in:** `cd3c161`

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** The fix was required for correctness under the new validation rules; no scope expansion.

## Issues Encountered

- The workspace had pre-existing dirty ATL/template changes in `src/config/loader.ts` and `tests/unit/llm-config.test.ts`. Commits used patch-level index staging so only 116-03 hunks were committed; the unrelated dirty changes remain unstaged.

## Known Stubs

None. Stub scan found no placeholder/TODO/FIXME or hardcoded empty UI/data outputs in the 116-03 modified files.

## Threat Flags

None. This plan implemented the configured threat mitigations for the YAML config trust boundary and introduced no new network endpoints, auth paths, file access patterns, or schema changes.

## Verification

- RED acceptance greps:
  - `grep -n "excluded_tools requires tools" tests/unit/llm-config.test.ts` - PASS.
  - `grep -n "tier:unknown" tests/unit/llm-config.test.ts` - PASS.
  - `grep -n "not_a_tool" tests/unit/llm-config.test.ts` - PASS.
- RED: `npm test -- tests/unit/llm-config.test.ts` - FAIL as expected before loader validation, with 4 failing invalid-declaration tests.
- GREEN acceptance greps:
  - `grep -n "excluded_tools requires tools" src/config/loader.ts` - PASS.
  - `grep -n "unknown tool tier" src/config/loader.ts` - PASS.
  - `grep -n "unknown native tool" src/config/loader.ts` - PASS.
  - `grep -n "HARD_EXCLUDED_NATIVE_TOOLS" src/config/loader.ts` - PASS.
- Final: `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts` - PASS, 51 tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04 can rely on startup validation to reject malformed purpose tool declarations while preserving hard-excluded names for public diagnostics and registry warning/removal behavior.

## Self-Check: PASSED

- Found `.planning/phases/116-model-visible-tool-registry/116-03-SUMMARY.md`
- Found `src/config/loader.ts`
- Found `tests/unit/llm-config.test.ts`
- Found commits `42ce22d` and `cd3c161`
- Re-ran `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts` successfully.

---
*Phase: 116-model-visible-tool-registry*
*Completed: 2026-05-06*
