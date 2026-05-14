---
phase: 131-lexer-parser-fence-extraction
plan: 05
subsystem: macro-mcp-handler
tags: [macro, call_macro, integration-test, parse-error]
requires:
  - phase: 131-lexer-parser-fence-extraction
    provides: parseMacroSource from Plan 03
  - phase: 130-foundation-metadata-broker-shim-archive-lock
    provides: call_macro scaffold
provides:
  - inline parse-error boundary in call_macro scaffold
  - T-I-001 integration coverage
affects: [call_macro, macro-parser]
tech-stack:
  added: []
  patterns: [expected-error parse boundary, integration include registration]
key-files:
  created:
    - tests/integration/macro-parse-error.test.ts
  modified:
    - src/mcp/tools/macro.ts
    - tests/config/vitest.integration.config.ts
requirements-completed:
  - MACRO-PARSE-10
duration: 10 min
completed: 2026-05-14
---

# Phase 131 Plan 05: Handler Parse Error Summary

**call_macro scaffold returns canonical parse_error envelopes for invalid inline macro source**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-14T12:24:00Z
- **Completed:** 2026-05-14T12:34:00Z
- **Tasks:** 1
- **Files modified:** 3

## Source Docs Read

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/src/parser.ts`
- `.planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-01-SUMMARY.md`
- `src/mcp/tools/macro.ts`
- `src/mcp/utils/response-formats.ts`
- `tests/config/vitest.integration.config.ts`

## Accomplishments

- Wired non-empty inline `source` through `parseMacroSource` inside `call_macro`.
- Returned parser failures via `jsonExpectedError(parseResult.error)` with `isError: false`.
- Preserved the existing unsupported scaffold for valid inline source.
- Added T-I-001 integration coverage and included it in the explicit integration config list.

## Task Commits

1. **Task 1: Add call_macro inline parse-error integration proof** - `84a47be` (test)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Verification

- `npm run test:integration -- --run tests/integration/macro-parse-error.test.ts` - PASS, 1 test.
- `npm test -- macro-lexer macro-parser macro-fence-extractor macro-source-ref` - PASS, 55 tests.
- `npm run build` - PASS.
- Acceptance greps for `parseMacroSource`, integration config inclusion, and absence of runtime/source-resolution implementation paths passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The public handler now proves parser errors cross the MCP boundary without implementing evaluator execution, dispatch, source document resolution, dry-run, budgets, progress, or task lifecycle.

---
*Phase: 131-lexer-parser-fence-extraction*
*Completed: 2026-05-14*
