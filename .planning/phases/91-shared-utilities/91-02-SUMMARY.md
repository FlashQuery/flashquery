---
phase: 91-shared-utilities
plan: "02"
subsystem: mcp-utils
tags: [utilities, formatting, date-parsing, file-size, table-rendering, tdd]
dependency_graph:
  requires: []
  provides:
    - src/mcp/utils/format-file-size.ts
    - src/mcp/utils/date-filter.ts
    - formatTableHeader in src/mcp/utils/response-formats.ts
    - formatTableRow in src/mcp/utils/response-formats.ts
  affects:
    - Phase 92 (create_directory handler — uses formatFileSize)
    - Phase 93 (list_vault handler — uses all four utilities)
tech_stack:
  added: []
  patterns:
    - base-1000 size threshold formatting
    - NaN-safe date string parsing
    - markdown table rendering
key_files:
  created:
    - src/mcp/utils/format-file-size.ts
    - src/mcp/utils/date-filter.ts
    - tests/unit/format-file-size.test.ts
    - tests/unit/date-filter.test.ts
  modified:
    - src/mcp/utils/response-formats.ts
    - tests/unit/response-formats.test.ts
decisions:
  - "base-1000 thresholds for size formatting per SPEC-21: < 1000 B, < 1_000_000 KB, < 1_000_000_000 MB, else GB"
  - "999_999 bytes → 1000.0 KB (not 1.0 MB) — threshold is strict less-than"
  - "NaN bug fixed in extracted parseDateFilter: isNaN(ts) check replaces broken try/catch"
  - "compound.ts keeps its own parseDateFilter copy until Phase 94 (D-02 preserved)"
metrics:
  duration_seconds: 178
  completed_date: "2026-04-24"
  tasks_completed: 3
  files_changed: 6
requirements:
  - REFAC-03
  - TEST-02
  - TEST-03
---

# Phase 91 Plan 02: Shared Utilities (format-file-size, date-filter, response-formats) Summary

**One-liner:** Extracted parseDateFilter (NaN bug fixed) and added formatFileSize, formatTableHeader, formatTableRow as tested utility modules for Phase 92/93 consumers.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create format-file-size.ts and tests U-44 through U-53 | 75b16a2 | src/mcp/utils/format-file-size.ts, tests/unit/format-file-size.test.ts |
| 2 | Create date-filter.ts with NaN fix and regression tests | 650570f | src/mcp/utils/date-filter.ts, tests/unit/date-filter.test.ts |
| 3 | Add formatTableHeader and formatTableRow to response-formats.ts | e1fc108 | src/mcp/utils/response-formats.ts, tests/unit/response-formats.test.ts |

## What Was Built

### `src/mcp/utils/format-file-size.ts`
Single export `formatFileSize(bytes: number): string`. Uses base-1000 thresholds (not base-1024): < 1000 → `N B`, < 1_000_000 → `N.N KB`, < 1_000_000_000 → `N.N MB`, else `N.N GB`. The critical boundary case: 999,999 bytes → `'1000.0 KB'` (threshold is strict `< 1_000_000`).

### `src/mcp/utils/date-filter.ts`
Single export `parseDateFilter(dateStr: string): number | null`. Extracted from `compound.ts` verbatim with the NaN bug fixed: `new Date('garbage').getTime()` returns `NaN` (never throws), so the original `try/catch` was ineffective. Now uses `isNaN(ts)` guard to return `null` for invalid input. compound.ts keeps its own copy per D-02 until Phase 94.

### `src/mcp/utils/response-formats.ts` (additions)
Two new exports appended to the existing file:
- `formatTableHeader(): string` — returns the two-line markdown table header+separator for vault listing
- `formatTableRow(name, type, size, created, updated): string` — returns a pipe-delimited row; passes Name value through unchanged (caller assembles it)

## Test Coverage

| File | Tests | IDs |
|------|-------|-----|
| tests/unit/format-file-size.test.ts | 10 new | U-44 through U-53 |
| tests/unit/date-filter.test.ts | 7 new | relative formats, ISO, NaN fix regression |
| tests/unit/response-formats.test.ts | 7 new (42 existing) | U-59 through U-65 |

Full suite result: **1137/1137 tests pass** (net +26 from this plan).

## Deviations from Plan

None — plan executed exactly as written. All TDD cycles completed (RED → GREEN for each task). compound.ts was not modified (D-02 constraint satisfied throughout).

## Threat Model Coverage

| Threat ID | Status |
|-----------|--------|
| T-91-05 (parseDateFilter NaN) | Mitigated — `isNaN(ts)` guard returns `null`; NaN fix regression test in date-filter.test.ts |
| T-91-06 (formatTableRow injection) | Accepted — pure string formatter, values are display strings from validated sources |

## Known Stubs

None — all functions are fully implemented with no hardcoded placeholders.

## Self-Check: PASSED

- `src/mcp/utils/format-file-size.ts` exists: FOUND
- `src/mcp/utils/date-filter.ts` exists: FOUND
- `formatTableHeader` in `src/mcp/utils/response-formats.ts`: FOUND
- `formatTableRow` in `src/mcp/utils/response-formats.ts`: FOUND
- Commit 75b16a2: FOUND
- Commit 650570f: FOUND
- Commit e1fc108: FOUND
- compound.ts unmodified (D-02): CONFIRMED
- Full test suite 1137/1137: CONFIRMED
