---
phase: 145-silent-failure-quick-wins
plan: 1
subsystem: mcp-memory-scanner
tags: [memory, scanner, supabase, maintenance, integration-tests]
requires: []
provides:
  - write_memory plugin-scope lookup failures fail closed with lookup_failed
  - scanner EMBED-DRAIN query failures return drain_query_failed
  - maintain_vault surfaces embedding_drain_query_failed without raw scanner internals
affects: [memory-tools, scanner, maintenance, integration-tests]
tech-stack:
  added: []
  patterns:
    - discriminated lookup result before persistence
    - explicit scanner status warning translation
key-files:
  created:
    - tests/unit/scanner-embed-drain-status.test.ts
    - tests/integration/mcp/tools/memory-plugin-scope.test.ts
    - tests/integration/services/scanner-embed-drain.test.ts
  modified:
    - src/mcp/tools/memory.ts
    - src/mcp/tool-help/write_memory.tool.md
    - src/mcp/tool-metadata.ts
    - src/services/scanner.ts
    - src/services/maintenance.ts
    - tests/unit/write-memory.test.ts
    - tests/unit/maintain-vault.test.ts
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "D-68 intentionally not added because T-U-002/T-U-003 plus T-I-001 prove the registered public write_memory handler returns lookup_failed and does not insert a global fallback row."
  - "maintain_vault exposes embedding_drain_query_failed as a stable warning while continuing to hide raw embedding_status and embeds_awaited internals."
patterns-established:
  - "Expected plugin-scope lookup failures use jsonExpectedError with details.reason=lookup_failed before any memory ID or insert row is created."
  - "Scanner drain query failures continue the scan, log [EMBED-DRAIN] drain_query_failed at error level, and only lose precedence to timed_out."
requirements-completed: [REQ-001, REQ-002]
duration: 16 min
completed: 2026-05-24
---

# Phase 145: Silent Failure Quick Wins Summary

**Fail-closed memory plugin-scope lookup and explicit scanner embed-drain failure status with focused unit and Supabase integration coverage**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-24T02:32:00Z
- **Completed:** 2026-05-24T02:48:14Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Replaced `write_memory` plugin-scope fallback with a typed lookup result that returns `lookup_failed` through `jsonExpectedError` before any insert can occur.
- Added `drain_query_failed` to scanner embedding status selection, with error-level `[EMBED-DRAIN] drain_query_failed` logging for both Supabase error objects and thrown query failures.
- Updated `maintain_vault` to translate the new scanner status into `embedding_drain_query_failed` while preserving the existing no-raw-internals public response boundary.
- Added focused unit and Supabase-backed integration coverage for T-U-001 through T-U-005 and T-I-001 through T-I-002.

## Task Commits

1. **Task 1: Hard-fail write_memory plugin-scope lookup failures before insert** - `61be49c`
2. **Task 2: Add drain_query_failed scanner status and explicit maintenance handling** - `33a053a`
3. **Task 3: Run final gates and add D-68 only if public MCP behavior remains unproven** - completed in this summary commit

## Files Created/Modified

- `src/mcp/tools/memory.ts` - Adds typed plugin-scope lookup result, runtime RPC shape narrowing, and pre-insert `lookup_failed` response.
- `src/mcp/tool-help/write_memory.tool.md` - Documents visible plugin-scope lookup failure behavior.
- `src/mcp/tool-metadata.ts` - Notes lookup-failure behavior in the tool description.
- `src/services/scanner.ts` - Adds `drain_query_failed`, error-level drain failure logging, and final status precedence.
- `src/services/maintenance.ts` - Adds explicit public warning translation for drain query failures.
- `tests/unit/write-memory.test.ts` - Covers global/matched scope success plus RPC error, thrown error, and unexpected payload failure paths.
- `tests/unit/scanner-embed-drain-status.test.ts` - Covers drain query error object, thrown failure, and timeout precedence.
- `tests/unit/maintain-vault.test.ts` - Covers public warning output and continued hiding of scanner internals.
- `tests/integration/mcp/tools/memory-plugin-scope.test.ts` - Proves registered `write_memory` handler returns `lookup_failed` and does not insert a global fallback row with `.env.test` credentials.
- `tests/integration/services/scanner-embed-drain.test.ts` - Proves real scanner execution returns `drain_query_failed` under controlled drain query failure.
- `tests/config/vitest.integration.config.ts` - Includes the new integration specs in the curated integration suite.

## Decisions Made

D-68 intentionally not added. The public behavior is proven by `tests/unit/write-memory.test.ts` parsing the registered handler response for `lookup_failed` and `tests/integration/mcp/tools/memory-plugin-scope.test.ts` exercising the registered MCP handler against real Supabase while asserting no global fallback row exists.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The integration test config uses a curated include list, so the new integration files were initially not discoverable. I added both Phase 145 integration files to `tests/config/vitest.integration.config.ts` and reran the targeted integration command successfully.

## Verification

- `npm test -- tests/unit/write-memory.test.ts` - passed, 9 tests.
- `npm test -- tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts` - passed, 17 tests.
- `npm test -- tests/unit/write-memory.test.ts tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts` - passed, 26 tests.
- `npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts tests/integration/services/scanner-embed-drain.test.ts` - passed, 2 tests with active `.env.test` credentials.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- Static grep: no `as unknown as Promise`, no lookup-failure fallback to global, and `drain_query_failed` coverage present in production and tests.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` already used for integration verification.

## Next Phase Readiness

Phase 146 can build durable embedding retry state on top of the now-explicit scanner drain failure status. No blockers remain from Phase 145.

---
*Phase: 145-silent-failure-quick-wins*
*Completed: 2026-05-24*
