---
phase: 170-json-validation-and-repair-infrastructure
plan: 01
subsystem: llm
tags: [jsonrepair, zod, parser, tdd, json-validation]
requires: []
provides:
  - "Runtime jsonrepair dependency for production parser use"
  - "Pure src/llm parseLlmJson<T>() utility with typed repair/parse/schema results"
  - "Focused parser unit coverage for T-U-001 through T-U-010"
affects: [phase-170, json-validation, macro-retrofits, provider-retrofits]
tech-stack:
  added: [jsonrepair]
  patterns:
    - "Pure LLM JSON boundary parser: jsonrepair -> JSON.parse -> Zod safeParse"
    - "Non-throwing discriminated parser results for caller-owned retry/failure policy"
key-files:
  created:
    - src/llm/json-repair.ts
    - tests/unit/llm-json-repair.test.ts
  modified:
    - package.json
    - package-lock.json
key-decisions:
  - "Kept parseLlmJson pure and dependency-narrow: jsonrepair plus Zod types only, with no macro/MCP imports."
  - "Returned concise schema/syntax summaries without echoing raw payloads by default."
patterns-established:
  - "Downstream LLM-adjacent parse sites should call parseLlmJson<T>() and map failures according to their local public contract."
  - "Schema-free callers can pass z.unknown() while known envelopes use caller-provided Zod schemas."
requirements-completed: [REQ-001, REQ-002, REQ-003, REQ-011]
duration: 4min
completed: 2026-06-22
---

# Phase 170 Plan 01: JSON Repair Utility Foundation Summary

**jsonrepair-backed LLM JSON parser with Zod validation, typed syntax/schema failures, repair metadata, and focused unit/build evidence**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-22T17:53:25Z
- **Completed:** 2026-06-22T17:57:00Z
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments

- Added `jsonrepair` as a runtime dependency in `dependencies` with lockfile resolution.
- Created `src/llm/json-repair.ts` exporting `parseLlmJson<T>()`, `LlmJsonParseResult<T>`, issue metadata, and summary formatting.
- Added `tests/unit/llm-json-repair.test.ts` covering T-U-001 through T-U-010: ESM import, source boundary, valid JSON, repair fixtures, `z.unknown()`, schema failures, syntax failures, stable discriminators, repair metadata, and no MCP envelope churn.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add jsonrepair dependency and minimal parser module shell** - `95a1f01` (`test(170-01): add jsonrepair parser foundation tests`)
2. **Task 2: Complete parseLlmJson result contract** - `3881529` (`feat(170-01): implement LLM JSON parse contract`)
3. **Task 3: Prove metadata and build behavior** - `e1dd819` (`feat(170-01): finalize JSON repair metadata`)

## Files Created/Modified

- `package.json` - Added `jsonrepair` under runtime `dependencies`.
- `package-lock.json` - Locked `jsonrepair@3.14.0`.
- `src/llm/json-repair.ts` - Pure repair/parse/validate utility with non-throwing typed results.
- `tests/unit/llm-json-repair.test.ts` - Parser evidence for T-U-001 through T-U-010.

## Decisions Made

- Kept the parser synchronous and stateless. It does not log, retry, call an LLM, write files, or import macro/MCP modules.
- Preserved caller-owned failure policy by returning `failure: 'syntax' | 'schema'` rather than throwing ordinary repair, parse, or validation failures.
- Bounded issue summaries by truncating individual issue messages while keeping machine-readable full issues available.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope changes.

## Issues Encountered

- `npm install jsonrepair` and `npm audit --omit=dev --json` reported existing runtime advisories on `gray-matter`/`js-yaml` and transitive `hono`. `jsonrepair` was not implicated. No unrelated dependency upgrades were attempted in this plan.

## Verification

- `npm run test:unit -- tests/unit/llm-json-repair.test.ts` - passed, 18 tests.
- `npm run typecheck` - passed.
- `npm run build` - passed; ESM and DTS builds completed without `jsonrepair` module-system warnings.

## Known Stubs

None.

## Threat Flags

None - the new LLM text parser boundary and runtime dependency were already covered by the plan threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 170-02 and 170-03 can import `parseLlmJson<T>()` from `src/llm/json-repair.js` and apply site-specific failure policy for macro, MCP, provider, and brokered tool parse surfaces.

## Self-Check: PASSED

- Files found: `src/llm/json-repair.ts`, `tests/unit/llm-json-repair.test.ts`, `package.json`, `package-lock.json`, and this summary.
- Commits found: `95a1f01`, `3881529`, `e1dd819`.
- Final verification rerun passed: `npm run test:unit -- tests/unit/llm-json-repair.test.ts && npm run typecheck && npm run build`.

---
*Phase: 170-json-validation-and-repair-infrastructure*
*Completed: 2026-06-22*
