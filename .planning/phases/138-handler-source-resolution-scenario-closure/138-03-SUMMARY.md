---
phase: 138-handler-source-resolution-scenario-closure
plan: 03
subsystem: macro
tags: [macro, call_macro, write-locks, mcp-transport, e2e]
requires:
  - phase: 138-handler-source-resolution-scenario-closure
    provides: Plan 02 source_ref resolution and public handler execution path
provides:
  - Macro write-lock inheritance integration coverage for T-I-009 through T-I-011
  - Real Streamable HTTP MCP transport coverage for T-E-001 through T-E-004
  - Verification that macro production code does not acquire locks directly
affects: [macro-handler, macro-integration-tests, e2e-transport, phase-138-plan-04]
tech-stack:
  added: []
  patterns:
    - call_macro write tests drive real MCP handlers through createMcpServer and InMemoryTransport
    - E2E transport tests parse Streamable HTTP SSE frames and assert JSON-RPC responses plus notifications
key-files:
  created:
    - tests/integration/macro-write-lock.integration.test.ts
    - tests/e2e/macro-call-macro.test.ts
    - .planning/phases/138-handler-source-resolution-scenario-closure/138-03-SUMMARY.md
  modified:
    - tests/config/vitest.integration.config.ts
    - tests/integration/macro-concurrency.test.ts
key-decisions:
  - "Kept write locking exclusively in existing tool handlers; macro inheritance is proven by held-lock integration tests and source grep rather than adding macro-layer locks."
  - "E2E transport coverage uses a minimal no-LLM config so inline call_macro paths do not require Supabase runtime template bindings."
patterns-established:
  - "Held-lock proxy tests make lock_contention deterministic for macro-dispatched write tools."
  - "Streamable HTTP E2E tests collect all SSE data frames so progress notifications and final tool responses can be asserted together."
requirements-completed: [MACRO-SRC-01, MACRO-SRC-02, MACRO-SRC-03, MACRO-SRC-04, MACRO-INT-02]
duration: 13m09s
completed: 2026-05-15
---

# Phase 138 Plan 03: Handler Source Resolution Scenario Closure Summary

**Macro-dispatched writes now have integration proof of tool-layer lock inheritance, and real MCP transport covers call_macro success, dry-run, parse-error, and progress paths.**

## Performance

- **Duration:** 13m09s
- **Started:** 2026-05-15T04:01:30Z
- **Completed:** 2026-05-15T04:14:39Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `macro-write-lock.integration.test.ts` with T-I-009 through T-I-011 coverage using real `call_macro` dispatch and existing document write locks.
- Added `macro-call-macro.test.ts` with T-E-001 through T-E-004 over `StreamableHTTPServerTransport`, including `_meta.progressToken` and `notifications/progress`.
- Verified production macro code still does not call `acquireLock`; writes inherit lock behavior from `fq.write_document`, `fq.archive_document`, and `fq.remove_document`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add macro write-lock inheritance integration tests** - `b328ec0` (test)
2. **Task 2: Add real MCP transport E2E coverage** - `ad67448` (test)

**Plan metadata:** pending final docs commit.

## Files Created/Modified

- `tests/integration/macro-write-lock.integration.test.ts` - Adds real handler coverage for concurrent macro writes and inherited `lock_contention` envelopes.
- `tests/e2e/macro-call-macro.test.ts` - Adds real Streamable HTTP MCP coverage for success, dry-run, parse-error, and progress notifications.
- `tests/config/vitest.integration.config.ts` - Registers the new write-lock integration suite.
- `tests/integration/macro-concurrency.test.ts` - Aligns stale assertions with current native `fq.*` payload semantics.

## Decisions Made

- Kept macro execution free of direct lock acquisition; the tests prove inheritance from existing tool handlers instead.
- Used held-lock proxy checks for deterministic conflict coverage rather than timing-sensitive lock races.
- Kept E2E transport setup independent from Supabase by omitting unused LLM config in the fixture.

## Verification

- `npm run test:integration -- --reporter=verbose macro-write-lock archive-document-lock macro-concurrency` - passed, 3 files / 6 tests.
- `npx vitest run tests/e2e/macro-call-macro.test.ts --reporter=verbose` - passed, 4 tests.
- `rg -n "T-I-009|T-I-010|T-I-011|lock_contention|acquireLock|call_macro" tests/integration/macro-write-lock.integration.test.ts` - passed.
- `rg -n "macro-write-lock.integration.test.ts" tests/config/vitest.integration.config.ts` - passed.
- `! rg -n "acquireLock\\(" src/macro src/mcp/tools/macro.ts` - passed.
- `rg -n "T-E-001|T-E-002|T-E-003|T-E-004|StreamableHTTPServerTransport|notifications/progress|progressToken" tests/e2e/macro-call-macro.test.ts` - passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected stale native tool-call payload assertions**
- **Found during:** Task 1 (Add macro write-lock inheritance integration tests)
- **Issue:** The focused `macro-concurrency` verification still expected native `fq.*` calls to appear in `external_tool_calls` and top-level progress payloads, but current macro semantics reserve `external_tool_calls` for non-`fq` tools and expose progress through trace/notification paths.
- **Fix:** Updated focused concurrency assertions and the new write-lock test assertions to match the current response contract.
- **Files modified:** `tests/integration/macro-concurrency.test.ts`, `tests/integration/macro-write-lock.integration.test.ts`
- **Verification:** `npm run test:integration -- --reporter=verbose macro-write-lock archive-document-lock macro-concurrency`
- **Committed in:** `b328ec0`

**2. [Rule 3 - Blocking] Removed unused LLM config from E2E fixture**
- **Found during:** Task 2 (Add real MCP transport E2E coverage)
- **Issue:** The minimal E2E config declared an empty `llm` block, causing the macro handler to load runtime template bindings and request Supabase in an inline-source transport test.
- **Fix:** Omitted `llm` from the E2E fixture so the inline call_macro path stays independent from Supabase setup.
- **Files modified:** `tests/e2e/macro-call-macro.test.ts`
- **Verification:** `npx vitest run tests/e2e/macro-call-macro.test.ts --reporter=verbose`
- **Committed in:** `ad67448`

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 3).
**Impact on plan:** Both fixes were test-harness corrections needed to verify the planned behavior; no production behavior or architecture changed.

## Issues Encountered

- Integration setup still logs the pre-existing harmless schema migration message about dropping a missing `fqc_documents.description` column; the focused integration tests pass.

## TDD Gate Compliance

Both tasks were marked `tdd="true"` and produced RED runs before final green verification. The failures were in newly added or stale test expectations rather than missing production code, so both task commits are test-only and no GREEN production commit was required.

## Known Stubs

None.

## User Setup Required

None - no new external service configuration required. Integration coverage uses the existing `.env.test` Supabase setup and existing skip behavior when unavailable.

## Next Phase Readiness

Plan 04 can proceed to scenario matrix and migrated POC fixture closure with public handler, source_ref, write-lock inheritance, and real transport coverage already in place.

## Self-Check: PASSED

- Key files exist: `tests/integration/macro-write-lock.integration.test.ts`, `tests/e2e/macro-call-macro.test.ts`, `tests/config/vitest.integration.config.ts`, `tests/integration/macro-concurrency.test.ts`.
- Task commits exist: `b328ec0` and `ad67448`.
- No accidental tracked file deletions were found after task commits.

---
*Phase: 138-handler-source-resolution-scenario-closure*
*Completed: 2026-05-15*
