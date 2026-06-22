---
phase: 170-json-validation-and-repair-infrastructure
plan: 03
subsystem: llm-macro-compatibility
tags: [jsonrepair, zod, llm, macro, mcp-broker]

requires:
  - phase: 170-json-validation-and-repair-infrastructure
    provides: Shared `parseLlmJson()` parser contract from plan 170-01.
provides:
  - Provider tool-call argument repair with existing invalid-JSON failure text.
  - Brokered CallToolResult text repair with structuredContent and isError ordering preserved.
  - Native FlashQuery tool response parsing regression coverage with no production strictness change.
affects: [170-json-validation-and-repair-infrastructure, macro-runtime, llm-client, mcp-broker]

tech-stack:
  added: []
  patterns:
    - `parseLlmJson(raw, schema)` at compatibility parse sites.
    - Conservative JSON-like fallback warning for brokered text results.

key-files:
  created:
    - .planning/phases/170-json-validation-and-repair-infrastructure/170-03-SUMMARY.md
  modified:
    - src/llm/client.ts
    - src/macro/coerce.ts
    - tests/unit/llm-client.test.ts
    - tests/unit/macro-coerce.test.ts
    - tests/unit/macro-registry.test.ts

key-decisions:
  - "Provider tool-call arguments use a Zod record schema so arrays, scalars, and null keep the existing fail-loud path."
  - "Brokered coercion keeps raw prose compatibility and warns only when fallback text conservatively looks JSON-like."
  - "Native FlashQuery tool response parsing stayed production-unchanged; only regression coverage was added."

patterns-established:
  - "Compatibility parse sites map `parseLlmJson()` failures back to their established local contracts."
  - "Regression-only scope is tested through public registry behavior rather than exporting private helpers."

requirements-completed: [REQ-007, REQ-008, REQ-009]

duration: 6min
completed: 2026-06-22T18:07:08Z
---

# Phase 170 Plan 03: Compatibility Retrofits Summary

**Provider and brokered tool JSON repair retrofits that preserve existing fail-loud, raw-prose, and native parsing contracts.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-22T18:01:07Z
- **Completed:** 2026-06-22T18:07:08Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Retrofitted provider tool-call argument normalization to repair string arguments through `parseLlmJson()` and reject irreparable or non-record values with the same invalid JSON error.
- Retrofitted brokered `CallToolResult` text coercion to repair JSON text, keep `structuredContent` precedence, keep `isError` fail-fast behavior, preserve prose fallback, and warn exactly once for JSON-like malformed fallback.
- Added regression evidence that native FlashQuery tool response parsing still parses valid JSON and still falls back to raw text without changing `src/macro/registry.ts`.

## TDD Evidence

- **Task 1 RED:** `npm run test:unit -- tests/unit/llm-client.test.ts` failed on T-U-024 because raw `JSON.parse()` rejected repairable provider arguments.
- **Task 1 GREEN:** `npm run test:unit -- tests/unit/llm-client.test.ts` passed 47/47 after `normalizeToolCallArguments()` used `parseLlmJson()` with a record schema.
- **Task 2 RED:** `npm run test:unit -- tests/unit/macro-coerce.test.ts tests/unit/macro-registry.test.ts` failed on T-U-029 and T-U-031 because brokered text repair and JSON-like fallback warnings were absent.
- **Task 2 GREEN:** `npm run test:unit -- tests/unit/macro-coerce.test.ts tests/unit/macro-registry.test.ts` passed 31/31 after `coerceCallToolResult()` used `parseLlmJson()` and the JSON-like warning predicate.

## Task Commits

1. **Task 1: Repair provider tool-call argument strings before rejection** - `0006e10` (`feat(170-03): repair provider tool call arguments`)
2. **Task 2: Repair brokered coercion and prove native parsing unchanged** - `ea488d43` (`feat(170-03): repair brokered tool result coercion`)

## Files Created/Modified

- `src/llm/client.ts` - Added `parseLlmJson()` + Zod record validation for provider tool-call argument strings.
- `src/macro/coerce.ts` - Added parser-based brokered text coercion and conservative JSON-like fallback warning.
- `tests/unit/llm-client.test.ts` - Added T-U-024 through T-U-027 coverage.
- `tests/unit/macro-coerce.test.ts` - Added/renumbered T-U-028 through T-U-032 coverage.
- `tests/unit/macro-registry.test.ts` - Added T-U-033 and T-U-034 unchanged-native parsing regressions.
- `.planning/phases/170-json-validation-and-repair-infrastructure/170-03-SUMMARY.md` - Execution summary.

## Verification

- `npm run test:unit -- tests/unit/llm-client.test.ts` - passed 47/47.
- `npm run test:unit -- tests/unit/macro-coerce.test.ts tests/unit/macro-registry.test.ts` - passed 31/31.
- `npm run test:unit -- tests/unit/llm-client.test.ts tests/unit/macro-coerce.test.ts tests/unit/macro-registry.test.ts` - passed 78/78.
- `npm run typecheck` - passed.

## Decisions Made

- Used `z.record(z.string(), z.unknown())` for provider arguments so repaired arrays, scalars, booleans, strings, and null values are schema failures mapped to the existing invalid JSON message.
- Kept `z.unknown()` for brokered tool text because external MCP servers can legitimately return any JSON value.
- Implemented the JSON-like warning predicate locally in `src/macro/coerce.ts` to avoid widening shared parser scope.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- `jsonrepair` can complete `{"query":` into `{ "query": null }`, so the invalid provider argument test fixture was changed to `not json` to keep testing the irreparable fail-loud path.
- `jsonrepair` can repair `{"count": ###}` into a string value, so the brokered warning fixture was changed to `{"count": true false}` to exercise a truly malformed JSON-like fallback.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 170-04 can rely on provider argument repair, brokered coercion repair, and unchanged native parsing behavior being covered by focused unit tests. No blockers were introduced.

## Self-Check: PASSED

- Summary file exists.
- Task commit `0006e10` exists.
- Task commit `ea488d43` exists.

---
*Phase: 170-json-validation-and-repair-infrastructure*
*Completed: 2026-06-22T18:07:08Z*
