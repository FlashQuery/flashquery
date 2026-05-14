---
phase: 131-lexer-parser-fence-extraction
plan: 02
subsystem: macro-source-resolution
tags: [macro, source-ref, markdown-fences]
requires:
  - phase: 131-lexer-parser-fence-extraction
    provides: parser contracts and macro error helpers from Plan 01
provides:
  - fqm fence extraction
  - source_ref::name selector parsing
  - named macro block selection error matrix
affects: [call_macro, macro-source-resolution]
tech-stack:
  added: []
  patterns: [line-based markdown scanning, typed validation results, pure selector utilities]
key-files:
  created:
    - src/macro/fence-extractor.ts
    - src/macro/source-ref.ts
    - tests/unit/macro-fence-extractor.test.ts
    - tests/unit/macro-source-ref.test.ts
  modified:
    - src/macro/types.ts
key-decisions:
  - "MacroSourceBlock now uses name: string | null and openingLine to match source extraction semantics."
  - "source_ref selector utilities do not resolve vault documents; they only split and select from provided blocks."
requirements-completed:
  - MACRO-SRC-05
  - MACRO-SRC-06
duration: 18 min
completed: 2026-05-14
---

# Phase 131 Plan 02: Fence Extraction And Source Ref Summary

**Pure macro-library fence extraction and source_ref::name block selection utilities**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-14T11:26:00Z
- **Completed:** 2026-05-14T11:44:00Z
- **Tasks:** 2
- **Files modified:** 5

## Source Docs Read

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/src/run.ts`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/sample-vault/Macros/projections.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/sample-vault/Macros/research-batch.md`
- `src/mcp/utils/markdown-sections.ts`
- `src/mcp/utils/path-validation.ts`

## Accomplishments

- Added `extractMacroFences()` with deterministic line-based scanning for bare and named `fqm` fences.
- Added canonical macro block-name validation with leading-letter requirement, underscore/hyphen support after the first character, and 64-character maximum.
- Added `splitMacroSourceRef()`, `validateMacroBlockName()`, `describeAvailableMacroBlocks()`, and `selectMacroSourceBlock()`.
- Covered T-U-001 through T-U-009 and T-U-010 through T-U-018 with focused unit tests.

## Task Commits

1. **Task 1: Extract fqm fenced macro blocks** - `9d28440` (feat)
2. **Task 2: Split source_ref selectors and select extracted blocks** - `8600a5c` (feat)

## Files Created/Modified

- `src/macro/fence-extractor.ts` - Extracts `fqm` fenced blocks and returns parse errors for malformed attributes.
- `src/macro/source-ref.ts` - Splits selectors and selects blocks from already-extracted macro blocks.
- `tests/unit/macro-fence-extractor.test.ts` - Covers fence extraction and malformed attribute behavior.
- `tests/unit/macro-source-ref.test.ts` - Covers the full selector and selection error matrix.
- `src/macro/types.ts` - Aligns `MacroSourceBlock` with extraction output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Aligned MacroSourceBlock contract**
- **Found during:** Task 1 implementation
- **Issue:** Plan 01's initial source block contract used optional `name` and `startLine`, while Plan 02 required `name: string | null` and `openingLine`.
- **Fix:** Updated `MacroSourceBlock` to the Plan 02 source-resolution contract.
- **Files modified:** `src/macro/types.ts`
- **Verification:** Fence/source-ref/parser focused tests passed.
- **Committed in:** `9d28440`

---

**Total deviations:** 1 auto-fixed.
**Impact on plan:** Positive contract alignment for downstream parser/handler phases.

## Issues Encountered

None.

## Verification

- `npm test -- --run tests/unit/macro-fence-extractor.test.ts tests/unit/macro-source-ref.test.ts` - PASS, 18 tests.
- `npm test -- macro-lexer macro-parser macro-fence-extractor macro-source-ref` - PASS after Plan 03, 54 tests.
- Acceptance greps for malformed fence attributes, selector error reasons, canonical name regex, and absence of resolver imports passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The handler/source-resolution phase can plug resolved Markdown text into these pure utilities without duplicating fence parsing or selector semantics.

---
*Phase: 131-lexer-parser-fence-extraction*
*Completed: 2026-05-14*
