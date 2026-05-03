---
phase: 111
plan: "03"
subsystem: document-output
tags: [typed-errors, section-extraction, occurrence-out-of-range, get_document, follow_ref]
dependency_graph:
  requires: [111-01, 111-02]
  provides: [SectionExtractError class, occurrence_out_of_range error emission in both catch blocks]
  affects: [src/mcp/utils/markdown-sections.ts, src/mcp/utils/document-output.ts]
tech_stack:
  added: []
  patterns: [typed-error-class, instanceof-branching]
key_files:
  created: []
  modified:
    - src/mcp/utils/markdown-sections.ts
    - src/mcp/utils/document-output.ts
decisions:
  - "SectionExtractError extends Error with kind:'no_match'|'occurrence_out_of_range', matched[], requestedOccurrence — replaces fragile string-matching in catch blocks"
  - "Matched headings array carried in the error object so the catch block can emit matched_headings without re-scanning"
  - "no_match path preserved as section_not_found with one-element missing_sections — unchanged behavior"
  - "Multi-section path (sectionsList.length > 1) untouched — uses extractMultipleSections which aggregates per-distinct-name"
metrics:
  duration_minutes: 15
  completed_date: "2026-05-03"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 111 Plan 03: CMR Verification Fixes — Wave 2 / Phase B Summary

## One-liner

Typed `SectionExtractError` class with `kind:'no_match'|'occurrence_out_of_range'` introduced in `markdown-sections.ts`; both `document-output.ts` catch blocks updated to emit spec-correct `error='occurrence_out_of_range'` with `query`/`matches_found`/`matched_headings`/`requested_occurrence` fields.

## What Was Built

### Task 1: SectionExtractError class + typed throws in markdown-sections.ts (commit d5d2fda)

Replaced the two `throw new Error(...)` calls in `extractSection` with `throw new SectionExtractError(kind, matched, requestedOccurrence, message)`:

- `kind='no_match'` when `matched.length === 0` — no heading matches the query
- `kind='occurrence_out_of_range'` when `matched.length >= 1` but `occurrence > match count` — covers both the multi-occurrence case AND the edge case flagged in the verification report (1 match + occurrence >= 2, which previously went through no-match path because `total > 1` was false)

The `SectionExtractError` class exports `matched: Array<{level, text, line}>` so callers get the full heading list without re-scanning.

Wave 1 RED test [U-07] flipped to GREEN.

### Task 2: Update document-output.ts catch blocks (commit bc6fe8b)

Three edits applied:

**Import:** Added `SectionExtractError` to the import from `./markdown-sections.js`.

**follow_ref single-section catch (was lines 497-527):** Replaced fragile string-matching with `instanceof SectionExtractError` guard:
- `kind='occurrence_out_of_range'` → `error: 'occurrence_out_of_range'` with `followed_ref.{reference, resolved_to, resolved_fq_id, query, matches_found, matched_headings, requested_occurrence}` — top-level identifier is SOURCE document
- `kind='no_match'` (or non-typed fallback) → `error: 'section_not_found'` with `followed_ref.missing_sections=[{query, reason:'no_match'}]`

**source single-section catch (was lines 577-601):** Same pattern at top level:
- `kind='occurrence_out_of_range'` → `error: 'occurrence_out_of_range'` with `{identifier, query, matches_found, matched_headings, requested_occurrence}` — no `missing_sections` key
- `kind='no_match'` → `error: 'section_not_found'` with `missing_sections=[{query, reason:'no_match'}]`

**Removed:** `isOccurrenceErr` variable, `/appears (\d+) times/` regex, `insufficient_occurrences` reason in single-section path.

## Before/After Error Code Mapping

| Scenario | Before | After |
|----------|--------|-------|
| Heading not found | `section_not_found`, `reason:'no_match'` | `section_not_found`, `reason:'no_match'` (unchanged) |
| 1 match, occurrence=2 | `section_not_found`, `reason:'no_match'` (BUG: wrong reason + wrong error code) | `occurrence_out_of_range`, `matches_found:1, matched_headings:[...], requested_occurrence:2` |
| N matches, occurrence>N | `section_not_found`, `reason:'insufficient_occurrences'` (BUG: wrong error code) | `occurrence_out_of_range`, `matches_found:N, matched_headings:[...], requested_occurrence:M` |
| follow_ref + 1 match, occurrence=2 | `section_not_found` nested under `followed_ref` (BUG: wrong error code) | `occurrence_out_of_range` with `followed_ref.{query, matches_found, matched_headings, requested_occurrence}` |

## Test Results

| Test suite | Before | After |
|------------|--------|-------|
| markdown-sections.test.ts | 49/50 (U-07 FAIL) | 50/50 (GREEN) |
| document-output.test.ts | 33/33 | 33/33 |
| Full unit suite | 1407/1408 | 1408/1408 |

Wave 1 RED tests now GREEN:
- [U-07]: `extractSection throws SectionExtractError(kind="occurrence_out_of_range") on overflow`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both catch blocks are fully wired with real data from `SectionExtractError.matched`.

## Threat Flags

None — no new network endpoints or auth paths introduced. This change is internal to the section extraction error path.

## Self-Check: PASSED

- `src/mcp/utils/markdown-sections.ts` — verified modified with SectionExtractError class
- `src/mcp/utils/document-output.ts` — verified modified with two occurrence_out_of_range catch blocks
- Task 1 commit d5d2fda — exists in git log
- Task 2 commit bc6fe8b — exists in git log
- All 1408 unit tests passing
