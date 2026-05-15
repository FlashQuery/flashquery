---
phase: 138-handler-source-resolution-scenario-closure
plan: 01
subsystem: testing
tags: [macro, call_macro, source_ref, handler-schema, validation]
requires:
  - phase: 137-trace-progress-dry-run-budgets
    provides: trace, progress, dry-run, and budget handler behavior
provides:
  - T-U-216 through T-U-223 handler schema and source selector coverage
  - Canonical invalid_input validation before macro parse/evaluation
  - Confirmed T-U-001 through T-U-018 helper coverage remains green
affects: [macro-handler, source-ref-resolution, phase-138-plan-02]
tech-stack:
  added: []
  patterns:
    - Public call_macro schema tests assert documented fields and Zod stripping of deferred task-spec fields.
    - Handler source selector validation runs before parse/evaluation and before the temporary source_ref unsupported branch.
key-files:
  created:
    - .planning/phases/138-handler-source-resolution-scenario-closure/138-01-SUMMARY.md
  modified:
    - src/mcp/tools/macro.ts
    - tests/unit/macro-handler.test.ts
key-decisions:
  - "Kept Zod's default stripping behavior for deferred task-spec fields and asserted stripped parsed output instead of making the schema strict."
  - "Validated source_ref format and block selector names before the existing source_ref_not_implemented branch; full document resolution remains Plan 02."
requirements-completed: [MACRO-SRC-01, MACRO-SRC-02]
duration: 5min
completed: 2026-05-15
---

# Phase 138 Plan 01: Handler Source Contract Tests Summary

**call_macro handler schema and source selector contract coverage with canonical invalid_input preflight validation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-15T03:41:48Z
- **Completed:** 2026-05-15T03:46:20Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added T-U-216 and T-U-217 coverage for the production `call_macro` request schema, deferred task-spec field stripping, and default trace/progress/dry-run/timeout behavior.
- Added T-U-218 through T-U-223 coverage for invalid `source` / `source_ref` combinations and canonical `details.reason` values.
- Added handler preflight validation so malformed source selectors return `invalid_input` before parse/evaluation.
- Audited existing T-U-001 through T-U-018 named-block and fence extractor coverage; no additional helper rows were missing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin the production request schema** - `98881c7` (test)
2. **Task 2: Pin source/source_ref exclusivity failures** - `0301f64` (fix)
3. **Task 3: Preserve existing named-block helper coverage** - `10452ed` (test, no-op audit commit)

## Files Created/Modified

- `src/mcp/tools/macro.ts` - Adds empty source/source_ref and source_ref selector format validation before unsupported source_ref handling.
- `tests/unit/macro-handler.test.ts` - Adds T-U-216 through T-U-223 schema and invalid selector tests.
- `.planning/phases/138-handler-source-resolution-scenario-closure/138-01-SUMMARY.md` - Execution summary and validation record.

## Decisions Made

- Kept Zod's default unknown-key stripping behavior for `callMacroInputSchema` and asserted that deferred `task`, `taskHint`, `pollInterval`, and `ttl` fields do not appear in parsed output.
- Left valid `source_ref` execution on the existing `source_ref_not_implemented` branch for Plan 02, while validating invalid source_ref syntax now.

## Verification

- `npm test -- --reporter=verbose macro-handler` - passed.
- `npm test -- --reporter=verbose macro-handler macro-source-ref` - passed.
- `npm test -- --reporter=verbose macro-source-ref macro-fence-extractor` - passed.
- `npm test -- --reporter=verbose macro-handler macro-source-ref macro-fence-extractor` - passed, 33 tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added handler-side invalid source selector validation**
- **Found during:** Task 2 (Pin source/source_ref exclusivity failures)
- **Issue:** Existing handler only rejected both/neither populated and returned `unsupported` for all non-empty `source_ref` values; it did not produce the canonical `empty_source`, `empty_source_ref`, `invalid_source_ref_format`, or `invalid_block_name_format` preflight envelopes required by the threat model.
- **Fix:** Added validation in `registerMacroTools` before parse/evaluation and before the temporary source_ref unsupported branch.
- **Files modified:** `src/mcp/tools/macro.ts`, `tests/unit/macro-handler.test.ts`
- **Verification:** `npm test -- --reporter=verbose macro-handler macro-source-ref`
- **Committed in:** `0301f64`

---

**Total deviations:** 1 auto-fixed (Rule 2).
**Impact on plan:** Narrow correctness/security fix required by T-138-01-02; no full source_ref document resolution was implemented.

## Issues Encountered

Task 1 initially asserted default progress in the response payload. Progress defaults are observable through the notification path, so the test was corrected to use a progress token and notification sink.

## Known Stubs

None. The existing valid `source_ref` unsupported branch remains intentionally deferred to Plan 02 and does not block this plan's invalid-input goal.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can implement real `source_ref` document resolution with the handler schema and invalid source selector matrix already pinned and green.

## Self-Check: PASSED

- Summary file exists.
- Key modified files exist.
- Task commits `98881c7`, `0301f64`, and `10452ed` exist in git history.

---
*Phase: 138-handler-source-resolution-scenario-closure*
*Completed: 2026-05-15*
