---
phase: 163-multi-file-batch-contract
plan: 01
subsystem: api
tags: [mcp, zod, batch-input, version-token, vitest]
requires:
  - phase: 162-version-fingerprint-check
    provides: version_token helpers and conflict envelopes for file-affecting tools
provides:
  - Shared mixed batch identifier schema and normalization helper
  - REQ-018 batch item result wrapper helpers
  - Unit coverage for T-U-026 and T-U-027
affects: [archive_document, remove_document, insert_doc_link, apply_tags, phase-163]
tech-stack:
  added: []
  patterns:
    - Strict Zod object branch for tokened batch identifier items
    - Normalize batch items to identifier/version_token/index before handler loops
key-files:
  created:
    - src/mcp/utils/batch-input.ts
    - tests/unit/batch-input-shape.test.ts
  modified:
    - src/mcp/utils/response-formats.ts
    - src/mcp/tools/documents/archive.ts
    - src/mcp/tools/documents/remove.ts
    - src/mcp/tools/compound.ts
key-decisions:
  - "Per-item object version_token takes precedence over top-level expected_version for mixed batch entries."
  - "apply_tags keeps legacy document targets without version_token valid while adding tokened document target support."
patterns-established:
  - "batchIdentifiersSchema is the shared public schema for string, string[], and mixed tokened identifier arrays."
  - "Batch succeeded items carry legacy per-tool payloads under data so top-level status remains the unified REQ-018 status."
requirements-completed: [REQ-018, REQ-019]
duration: 8min
completed: 2026-05-27
---

# Phase 163 Plan 01: Multi-file Batch Contract Summary

**Mixed identifier/version-token batch schemas with shared normalization and non-colliding per-item result wrappers**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-27T19:49:31Z
- **Completed:** 2026-05-27T19:52:16Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `batchIdentifierItemSchema`, `batchIdentifiersSchema`, and `normalizeBatchIdentifiers` for mixed bare/tokened batch inputs.
- Widened the scoped public schemas for `archive_document`, `remove_document`, `insert_doc_link`, and document forms of `apply_tags`.
- Added `batchSucceeded`, `batchConflicted`, and `batchFailed` helpers so unified batch item status cannot be overwritten by legacy payload status fields.
- Added T-U-026/T-U-027 unit tests covering valid mixed shapes and rejection of positional token arrays and identifier-token maps.

## Task Commits

1. **Task 1: Add failing mixed batch schema unit coverage** - `3ca943a` (test)
2. **Task 2: Add shared batch contracts and widen tool schemas** - `7b1514c` (feat)

## Files Created/Modified

- `src/mcp/utils/batch-input.ts` - Shared mixed identifier schemas and ordered normalization helper.
- `src/mcp/utils/response-formats.ts` - REQ-018 batch item wrapper types and helper functions.
- `src/mcp/tools/documents/archive.ts` - Uses shared schema and per-item version token when archiving.
- `src/mcp/tools/documents/remove.ts` - Uses shared schema and per-item version token when removing.
- `src/mcp/tools/compound.ts` - Uses shared schema for `insert_doc_link`; widens document forms for `apply_tags`.
- `tests/unit/batch-input-shape.test.ts` - Covers T-U-026, T-U-027, and batch wrapper status collision behavior.

## Decisions Made

- Per-item object `version_token` wins over top-level `expected_version`/`if_match`; bare strings preserve legacy top-level precondition behavior.
- `apply_tags.targets` preserves legacy document targets without `version_token`; the new token is optional on explicit document targets and unavailable on memory targets.
- `batchSucceeded` stores the legacy success payload under `data`, keeping the top-level status reserved for `succeeded | conflicted | failed`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The initial RED test over-constrained legacy `apply_tags` document targets without `version_token`; corrected before the RED commit so backward-compatible target objects remain valid.

## Known Stubs

None.

## Threat Flags

None - all changed MCP schema and response-helper surfaces were already covered by the plan threat model.

## Verification

- `npm test -- tests/unit/batch-input-shape.test.ts` failed before Task 2 implementation as expected.
- `npm test -- tests/unit/batch-input-shape.test.ts` passed after Task 2: 5 tests passed.
- `npm run typecheck` passed.
- `rg -n "version_tokens" src/mcp/tools src/mcp/utils` returned no matches.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can use the shared normalization and response wrappers to implement the full ordered per-item batch envelope behavior in archive/remove handlers and integration coverage.

## Self-Check: PASSED

- Found all created/modified plan files.
- Found task commits `3ca943a` and `7b1514c` in git history.

---
*Phase: 163-multi-file-batch-contract*
*Completed: 2026-05-27*
