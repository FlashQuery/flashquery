---
phase: 121-foundation-metadata-response-helpers-test-harness
plan: 02
subsystem: mcp
tags: [mcp, response-format, json, testing]

requires:
  - phase: 120-cross-phase-atl-validation
    provides: completed v3.2 validation baseline and existing get_document JSON envelope behavior
provides:
  - Shared MCP JSON response helper APIs
  - Canonical expected/runtime error response helpers
  - Document, memory, record, plugin, and LLM identification builders
  - Representative get_document helper-backed handler smoke coverage
affects: [phase-123-document-read-migration, phase-125-memory-consolidation, phase-126-plugin-record-consolidation]

tech-stack:
  added: []
  patterns:
    - MCP tool results encode JSON payloads inside content[0].text
    - Expected errors return structured JSON with isError false
    - Runtime failures use jsonRuntimeError with isError true

key-files:
  created: []
  modified:
    - src/mcp/utils/response-formats.ts
    - src/mcp/tools/documents.ts
    - tests/unit/response-formats.test.ts
    - tests/integration/tools-response-format.test.ts
    - tests/e2e/protocol.test.ts

key-decisions:
  - "Kept legacy key-value response helpers exported while adding JSON helper APIs for migrated tools."
  - "Used get_document as the representative helper-backed path because it already had a JSON-oriented envelope."
  - "Mapped get_document validation and missing-document responses to expected JSON errors with isError false."

patterns-established:
  - "jsonToolResult(payload): returns MCP text content whose text is JSON.stringify(payload)."
  - "jsonExpectedError(envelope): returns structured expected errors with isError false."
  - "Identification builders return required blocks for document, memory, record, plugin, and LLM call entities."

requirements-completed: [FND-03, FND-04, FND-05, FND-06, TEST-01, TEST-02, TEST-03, TEST-04]

duration: 6min
completed: 2026-05-11
---

# Phase 121 Plan 02: JSON Response Helpers Summary

**Shared JSON MCP response helpers now back a representative get_document path with unit, integration, E2E, and build proof.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-11T20:56:22Z
- **Completed:** 2026-05-11T21:02:03Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, warning, batch, and identification builder exports while preserving legacy helper exports.
- Replaced the old response-format unit suite with JSON-first helper contract tests plus a transitional legacy compatibility block.
- Routed representative `get_document` success and expected-error branches through shared helpers, with integration and E2E JSON parse smoke coverage.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add JSON response helper exports while preserving legacy helpers** - `9c68e98` (feat)
2. **Task 2: Replace legacy response helper tests with JSON foundation tests** - `be7dbf4` (test)
3. **Task 3: Wire one representative handler smoke path through the JSON helper** - `ff24d4a` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/mcp/utils/response-formats.ts` - Adds JSON MCP response helpers, canonical error code constants, warning/batch helpers, and entity identification builders.
- `src/mcp/tools/documents.ts` - Uses JSON helpers for `get_document` success, expected validation errors, expected not-found errors, and runtime errors.
- `tests/unit/response-formats.test.ts` - Verifies parseable JSON text content, expected/runtime error semantics, warnings, batch ordering, identification builders, and canonical code casing.
- `tests/integration/tools-response-format.test.ts` - Adds representative helper-backed success/error smoke tests and a real `get_document` validation branch assertion.
- `tests/e2e/protocol.test.ts` - Parses helper-backed `get_document` success and expected-error responses through the MCP protocol.

## Decisions Made

- Legacy prose/key-value helpers remain available because broad tool migration is intentionally deferred to later phases.
- `get_document` was the safest representative path: it already returns JSON envelopes, so shared helper adoption avoids broad domain churn.
- Missing `get_document` identifiers now return canonical `not_found` expected errors with `isError: false`, matching the v3.3 response contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The worktree contained unrelated Phase 121 Plan 01 metadata changes while this plan was executing. They were left untouched and excluded from the plan task commits.

## Known Stubs

None. Stub-pattern scan only found legitimate local initialization and null checks, not UI/data placeholders.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema trust boundaries were introduced.

## Verification

- `npm test -- tests/unit/response-formats.test.ts` - passed
- `npm run test:integration -- tests/integration/tools-response-format.test.ts` - passed
- `npm run test:e2e -- tests/e2e/protocol.test.ts` - passed
- `npm run build` - passed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Later migration phases can import shared response helpers instead of inventing per-tool JSON envelopes. `get_document` provides the representative expected-error pattern for Phase 123 document read migration.

## Self-Check: PASSED

- Summary file exists.
- All five modified plan files exist.
- Task commits `9c68e98`, `be7dbf4`, and `ff24d4a` exist in git history.

---
*Phase: 121-foundation-metadata-response-helpers-test-harness*
*Completed: 2026-05-11*
