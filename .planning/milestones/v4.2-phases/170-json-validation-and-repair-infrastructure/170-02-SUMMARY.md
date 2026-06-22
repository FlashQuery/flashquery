---
phase: 170-json-validation-and-repair-infrastructure
plan: 02
subsystem: api
tags: [json-repair, macro-runtime, mcp, host-template-tools, vitest]
requires:
  - phase: 170-json-validation-and-repair-infrastructure
    plan: 01
    provides: shared parseLlmJson parser contract
provides:
  - Repaired macro evaluator tool-result payload parsing
  - Repaired host-template structured payload mapping with bounded invalid_json_payload errors
  - Macro task result transition failure for unreadable structured envelopes
affects: [macro-evaluator, host-template-tools, call_macro, json-validation]
tech-stack:
  added: []
  patterns:
    - parseLlmJson with z.unknown for schema-free macro values
    - Minimal Zod object schemas for structured host-template and task-result envelopes
    - Bounded invalid_json_payload runtime errors at MCP-facing trust boundaries
key-files:
  created:
    - tests/unit/host-template-tools.test.ts
    - tests/unit/macro-task-result.test.ts
  modified:
    - src/macro/evaluator.ts
    - src/mcp/host-template-tools.ts
    - src/mcp/tools/macro.ts
    - tests/unit/macro-evaluator.test.ts
key-decisions:
  - "Exported focused host-template and macro task result helpers for unit coverage instead of building brittle full-server fixtures."
  - "Irreparable macro task result envelopes now return a replacement invalid_json_payload runtime error after failing the task."
patterns-established:
  - "Repair first, then apply site-specific failure policy."
  - "Keep ordinary prose compatibility only where the call site contract allows it."
requirements-completed: [REQ-004, REQ-005, REQ-006, REQ-010]
duration: 7min
completed: 2026-06-22
---

# Phase 170 Plan 02: High-Priority Parse Retrofit Summary

**Macro, host-template, and task-result parse sites now repair structured JSON-like payloads and fail visibly when structured envelopes cannot be trusted.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-22T18:00:55Z
- **Completed:** 2026-06-22T18:07:20Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Macro evaluator tool-result parsing now uses `parseLlmJson(text, z.unknown())`, preserving raw prose fallback while enabling repaired field access, expected-error envelopes, and model token extraction.
- Host-template tool results now repair structured `{ ok: ... }` payloads into `structuredContent`, set `isError` for `ok: false`, and return bounded `invalid_json_payload` runtime errors for irreparable JSON-like text.
- Macro task result transitions now repair success/cancellation envelopes and fail tasks with an `isError: true` `invalid_json_payload` result when the envelope is unreadable.

## Task Commits

1. **Task 1: Repair macro evaluator tool-result payload parsing** - `b5d47e9`
2. **Task 2: Repair host-template payload parsing and structured errors** - `00147a28`
3. **Task 3: Fail unreadable macro task result envelopes** - `a2d0498d`

## Files Created/Modified

- `src/macro/evaluator.ts` - Replaced raw `JSON.parse()` tool-result parsing with shared repair utility and raw fallback.
- `src/mcp/host-template-tools.ts` - Added repaired structured payload parsing and bounded invalid JSON error results.
- `src/mcp/tools/macro.ts` - Added repaired macro task result envelope parsing and replacement error result on unreadable envelopes.
- `tests/unit/macro-evaluator.test.ts` - Added T-U-011 through T-U-014 coverage.
- `tests/unit/host-template-tools.test.ts` - Added T-U-015 through T-U-018 and T-U-022 coverage.
- `tests/unit/macro-task-result.test.ts` - Added T-U-019 through T-U-021 and T-U-023 coverage.

## Decisions Made

- Exported focused result-shaping helpers for unit tests so the parse/transition behavior is directly covered without requiring full MCP server setup.
- Used `jsonRuntimeError()` for irreparable structured-channel failures because both host-template and macro task result failures mean the result envelope cannot be trusted.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Initial evaluator RED fixtures needed explicit tool registry entries so macro preflight allowed dispatched test tools. Fixed before implementation.
- Initial irreparable host-template fixture was repairable by `jsonrepair`; replaced it with `{ok: true, result: 1 2}` to exercise the intended failure path.

## Verification

- `npm run test:unit -- tests/unit/macro-evaluator.test.ts` - passed, 38 tests.
- `npm run test:unit -- tests/unit/host-template-tools.test.ts` - passed, 4 tests.
- `npm run test:unit -- tests/unit/macro-task-result.test.ts` - passed, 4 tests.
- `npm run test:unit -- tests/unit/macro-evaluator.test.ts tests/unit/host-template-tools.test.ts tests/unit/macro-task-result.test.ts` - passed, 46 tests across 3 files.
- `npm run typecheck` - passed.

## Known Stubs

None.

## Threat Flags

None beyond the plan threat model; changed trust-boundary behavior is covered by T-170-02-01 through T-170-02-04 mitigations.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

REQ-004, REQ-005, REQ-006, and REQ-010 have focused unit evidence. Plan 170-03 can continue in the provider/coercion files without relying on additional changes from this plan.

## Self-Check: PASSED

- Created files exist: `tests/unit/host-template-tools.test.ts`, `tests/unit/macro-task-result.test.ts`.
- Modified files exist: `src/macro/evaluator.ts`, `src/mcp/host-template-tools.ts`, `src/mcp/tools/macro.ts`, `tests/unit/macro-evaluator.test.ts`.
- Task commits found: `b5d47e9`, `00147a28`, `a2d0498d`.
- Required verification commands passed.

---
*Phase: 170-json-validation-and-repair-infrastructure*
*Completed: 2026-06-22*
