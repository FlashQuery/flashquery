---
phase: 131-lexer-parser-fence-extraction
plan: 01
subsystem: macro-parser
tags: [macro, chevrotain, lexer, parser-contracts]
requires:
  - phase: 130-foundation-metadata-broker-shim-archive-lock
    provides: call_macro scaffold and macro response envelope foundation
provides:
  - Chevrotain dependency for parser-layer implementation
  - Macro AST and parse result contracts
  - Structured macro parse_error and invalid_input helpers
  - v0 macro lexer with focused unit coverage
affects: [macro-language, call_macro]
tech-stack:
  added: [chevrotain]
  patterns: [typed parser contracts, Chevrotain token surface, canonical expected-error envelopes]
key-files:
  created:
    - src/macro/types.ts
    - src/macro/errors.ts
    - src/macro/tokens.ts
    - tests/unit/macro-lexer.test.ts
  modified:
    - package.json
    - package-lock.json
key-decisions:
  - "Kept Phase 131 contracts parser-layer only; evaluator runtime and registry state remain deferred."
  - "Used Chevrotain longer_alt for all ten reserved keywords, with longer keyword tokens ordered before prefixes."
  - "Validated double-quoted escapes at the lexer pattern/helper layer so unknown escapes produce a lexical parse path."
patterns-established:
  - "Macro modules live under src/macro and export ESM .js-compatible imports."
  - "Parser-layer errors use canonical JSON envelope shapes but remain independent of MCP ToolResult construction."
requirements-completed:
  - MACRO-PARSE-01
  - MACRO-PARSE-03
  - MACRO-PARSE-10
duration: 20 min
completed: 2026-05-14
---

# Phase 131 Plan 01: Lexer Parser Foundation Summary

**Chevrotain-backed macro parser contracts and v0 lexer token surface with focused unit coverage**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-14T11:05:00Z
- **Completed:** 2026-05-14T11:25:55Z
- **Tasks:** 2
- **Files modified:** 6

## Source Docs Read

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/src/lexer.ts`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/src/types.ts`
- `src/mcp/utils/response-formats.ts`

## Accomplishments

- Installed `chevrotain@12.0.0` and recorded it in `package.json` and `package-lock.json`.
- Added stable parser-layer AST contracts, source block contracts, and parse result contracts in `src/macro/types.ts`.
- Added parser-layer `parse_error` and `invalid_input` envelope helpers with the stable Phase 131 reason strings.
- Implemented the v0 Chevrotain lexer token surface for keywords, variables, flags, literals, comparison/boolean operators, range syntax, comments, continuations, and punctuation.
- Added focused lexer tests covering T-U-019, T-U-020, T-U-024 through T-U-029, T-U-034, and T-U-043.

## Task Commits

1. **Task 1: Install Chevrotain and define parser contracts** - `7afcca9` (feat)
2. **Task 2: Implement the v0 Chevrotain lexer** - `718849e` (feat)

## Files Created/Modified

- `package.json` - Adds `chevrotain` dependency.
- `package-lock.json` - Locks Chevrotain dependency tree.
- `src/macro/types.ts` - Defines Program, Statement, Expr, source block, range/binary/unary, and parse result contracts.
- `src/macro/errors.ts` - Defines stable parser and input error envelopes for downstream parser/source utilities.
- `src/macro/tokens.ts` - Defines Chevrotain tokens, keyword/builtin constants, lexer instance, and token helper functions.
- `tests/unit/macro-lexer.test.ts` - Covers the required parser-layer lexer behavior.

## Decisions Made

- Kept AST contracts focused on parser output and intentionally excluded evaluator runtime state, task registry state, shell execution types, and dispatch registry types.
- Used a strict double-quoted string token pattern plus `validateDoubleQuotedEscapes` so unknown escape sequences fail before AST conversion.
- Ordered `Done` before `Do` in the token list so `do` does not shadow `done` during Chevrotain lexer validation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected keyword token order**
- **Found during:** Task 2 verification
- **Issue:** Chevrotain rejected the lexer because `Done` was unreachable when `Do` appeared first.
- **Fix:** Reordered the keyword token list so `Done` precedes `Do`.
- **Files modified:** `src/macro/tokens.ts`
- **Verification:** `npm test -- --run tests/unit/macro-lexer.test.ts` passed.
- **Committed in:** `718849e`

---

**Total deviations:** 1 auto-fixed (blocking lexer validation).
**Impact on plan:** No scope change; the fix was required for Chevrotain correctness.

## Issues Encountered

None beyond the token-order correction documented above.

## Verification

- `npm test -- --run tests/unit/macro-lexer.test.ts` - PASS, 10 tests.
- `npm run build` - PASS.
- `grep -n "longer_alt: Identifier" src/macro/tokens.ts | wc -l` - PASS, 10 keyword tokens.
- `grep -n "unexpected_token\\|missing_do\\|missing_done\\|missing_then\\|missing_fi\\|malformed_fence_attributes\\|reserved_keyword_assignment\\|builtin_name_shadowing\\|invalid_literal\\|input_var_key_must_be_literal" src/macro/errors.ts` - PASS.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can import `MacroSourceBlock`, `macroParseError`, and `macroInvalidInput` for fence extraction and source-ref selection. Plan 03 can import `macroLexer`, `allTokens`, AST contracts, and stable parse reason strings for grammar and CST-to-AST conversion.

---
*Phase: 131-lexer-parser-fence-extraction*
*Completed: 2026-05-14*
