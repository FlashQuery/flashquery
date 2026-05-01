---
phase: 107
plan: "01"
subsystem: testing
tags: [tdd, red-state, document-output, markdown-sections, unit-tests]
dependency_graph:
  requires: []
  provides:
    - RED-state test contract for document-output.ts (GDOC-01, GDOC-02, GDOC-03, GDOC-05)
    - RED-state test contract for markdown-sections.ts (GDOC-06, GDOC-08, GDOC-09)
  affects:
    - plans/107-02 (turns these tests green via implementation)
    - plans/107-05 (directed coverage matrix — U-IDs are the reference IDs)
tech_stack:
  added: []
  patterns:
    - Pure-logic Vitest test files with no vi.mock (document-output.ts and markdown-sections.ts are I/O-free)
    - Coverage ID tagging: [U-08a]-style brackets in it() names for grep-able failure tracing
key_files:
  created:
    - tests/unit/document-output.test.ts
    - tests/unit/markdown-sections.test.ts
  modified: []
decisions:
  - Used double-quote describe for validateParameterCombinations to avoid ESLint quote conflict; corrected to single-quote to satisfy acceptance criteria
  - U-07 test uses case-insensitive search ("Action Items") which currently fails via exact match — this is an intentional additional failure that will be resolved when plan 107-02 makes findHeadingOccurrence case-insensitive
metrics:
  duration: "3 minutes"
  completed: "2026-05-01T21:00:01Z"
  tasks_completed: 2
  files_created: 2
---

# Phase 107 Plan 01: Wave 0 RED-State Test Scaffolds Summary

One-liner: RED-state Vitest scaffolds locking the GDOC-01..GDOC-09 API contract for document-output.ts and case-insensitive/multi-section extensions to markdown-sections.ts.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create tests/unit/document-output.test.ts | d7fc4cd | tests/unit/document-output.test.ts |
| 2 | Create tests/unit/markdown-sections.test.ts | 9927577 | tests/unit/markdown-sections.test.ts |

## Test Files Created

### tests/unit/document-output.test.ts (26 it() cases)

**Purpose:** RED-state scaffold for `src/mcp/utils/document-output.ts` (does not exist yet — plan 107-02 creates it).

**Coverage IDs:**

| Coverage ID | describe block | Description |
|-------------|---------------|-------------|
| U-08a | resolveTitle (GDOC-03) | fq_title present → returns as-is |
| U-08b | resolveTitle (GDOC-03) | fq_title with whitespace → trimmed |
| U-08c | resolveTitle (GDOC-03) | fq_title absent → basename without ext |
| U-08d | resolveTitle (GDOC-03) | fq_title empty string → basename |
| U-08e | resolveTitle (GDOC-03) | fq_title whitespace-only → basename |
| U-08f | resolveTitle (GDOC-03) | fq_title null → basename |
| U-08g | resolveTitle (GDOC-03) | fq_title numeric → String() coercion |
| U-08h | resolveTitle (GDOC-03) | fq_title boolean → String() coercion |
| U-08i | resolveTitle (GDOC-03) | deeply nested path → basename only |
| U-01 | buildMetadataEnvelope (GDOC-02) | all 6 required fields with correct values |
| U-01b | buildMetadataEnvelope (GDOC-07) | size.chars = full body length, not subset |
| U-01c | buildMetadataEnvelope | fallback modified timestamp when fq_updated absent |
| U-01d | buildMetadataEnvelope | fq_id taken from capturedFrontmatter.fqcId |
| U-02 | buildHeadingEntries (GDOC-05) | returns {level, text, chars} entries |
| U-02b | buildHeadingEntries (GDOC-05) | maxDepth:2 excludes H3+ |
| U-02c | buildHeadingEntries (GDOC-05) | document order preserved |
| U-05b | include_nested in buildHeadingEntries | parent chars includes child content |
| U-03a | buildConsolidatedResponse (GDOC-01) | include:['body'] → no frontmatter/headings |
| U-03b | buildConsolidatedResponse (GDOC-01) | include:['frontmatter'] → no body/headings |
| U-03c | buildConsolidatedResponse (GDOC-01) | include:['headings'] → no body/frontmatter |
| U-03d | buildConsolidatedResponse (GDOC-01) | include:all → all three plus envelope |
| U-08 | buildConsolidatedResponse (GDOC-01) | empty include defaults to body |
| U-08p | validateParameterCombinations (Error 9) | sections without body → error |
| U-08q | validateParameterCombinations (Error 9) | occurrence with multi-element sections → error |
| U-08r | validateParameterCombinations (Error 9) | single-element + occurrence → valid (null) |
| U-08s | validateParameterCombinations (Error 9) | multi-element + no occurrence → valid (null) |

**RED state:** `Cannot find module '../../src/mcp/utils/document-output.js'` — all tests fail to load.

### tests/unit/markdown-sections.test.ts (19 it() cases)

**Purpose:** RED-state scaffold for new behavior in `src/mcp/utils/markdown-sections.ts` — case-insensitive matching and `extractMultipleSections` (added in plan 107-02).

**Coverage IDs:**

| Coverage ID | describe block | Description |
|-------------|---------------|-------------|
| U-04 (x5) | headingMatchesQuery (GDOC-06) | case-insensitive substring match; "BLOCKERS" matches "2. Blockers"; empty query → null |
| U-05 | headingMatchesQuery (GDOC-06) | numeric anchor "3" matches "3. Scope" NOT "13. Conversations" |
| U-05a (x3) | headingMatchesQuery (GDOC-06) | multi-digit "12"; dot-hierarchy "3."; digit-prefix "3D Modeling" |
| U-04 (x2) | extractSection (GDOC-06) | case-insensitive extractSection with 'blockers' and 'BLOCKERS' |
| U-06 | U-06 single-section no match | throws "not found" error for missing heading |
| U-07 | U-07 occurrence out of range | throws when occurrence exceeds total occurrences |
| U-08j | extractMultipleSections (GDOC-08) | input order preserved; sequential repeats |
| U-08k | extractMultipleSections (GDOC-08) | interleaved repeats [A,B,A] in order |
| U-08l (x2) | extractMultipleSections (GDOC-08) | content is string (not joined); chars = content.length |
| U-08m | extractMultipleSections (GDOC-09) | all-fail no_match |
| U-08n | extractMultipleSections (GDOC-09) | per-distinct-name insufficient_occurrences aggregation (Pitfall 5) |
| U-08o | extractMultipleSections (GDOC-09) | mixed failure modes |
| (type contract) | extractMultipleSections type contract | MultiSectionResult shape verified at runtime |

**RED state:** 16/19 tests fail:
- U-04/U-05/U-05a assertions fail because `findHeadingOccurrence` uses exact-match `===`
- All `extractMultipleSections` tests fail with `TypeError: extractMultipleSections is not a function`
- U-06 and U-07 pass (locking existing contract)

## RED State Verification

```
npm test -- tests/unit/document-output.test.ts
→ Cannot find module '../../src/mcp/utils/document-output.js' — FAIL (load error)

npm test -- tests/unit/markdown-sections.test.ts
→ 16 tests FAIL, 3 tests pass (U-06, U-07, and U-04 empty-query)
```

Both files confirmed in RED state as required.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — test files contain no stubs or placeholder code.

## Threat Flags

None — test files introduce no new network endpoints, auth paths, file access, or schema changes.

## Self-Check

- [x] tests/unit/document-output.test.ts exists: `d7fc4cd`
- [x] tests/unit/markdown-sections.test.ts exists: `9927577`
- [x] Both commits verified in git log
- [x] Both files fail RED state as specified
- [x] No deletions in either commit
- [x] No .planning/ files modified
