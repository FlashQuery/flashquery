---
phase: 146-embedding-reliability-foundation
plan: 3
subsystem: embedding
tags: [embedding, retry-worker, scanner, doctor, diagnostics, vitest]
requires:
  - phase: 146-embedding-reliability-foundation
    plan: 1
    provides: fqc_pending_embeds schema and centralized background embedding target helper
provides:
  - Pending embedding retry worker for document, memory, and record targets
  - Scanner-integrated bounded pending retry path
  - Doctor diagnostic for embedding-null rows without pending retry state
affects: [embedding, scanner, doctor, diagnostics]
tech-stack:
  added: []
  patterns:
    - Instance-scoped pending retry selection
    - Shared target embedding update helper
    - Escaped dynamic record-table diagnostics
key-files:
  created:
    - src/embedding/pending-worker.ts
    - tests/unit/pending-embed-worker.test.ts
    - tests/integration/embedding/pending-embed-worker.test.ts
    - tests/integration/doctor/embedding-diagnostics.test.ts
  modified:
    - src/embedding/background-embed.ts
    - src/services/scanner.ts
    - src/cli/doctor.ts
    - tests/unit/scanner-embed-drain-status.test.ts
key-decisions:
  - "146-03 deletes pending embedding rows after successful retry, while repeated failures keep status=pending with incremented attempt_count, last_error, and next_retry_at."
  - "146-03 invokes pending retries from runScanOnce with a fixed limit of 25 and preserves drain_query_failed/timed_out precedence."
  - "146-03 doctor diagnostics enumerate plugin record tables from information_schema and escape identifiers before dynamic SQL."
requirements-completed: [REQ-004]
duration: 20m
completed: 2026-05-24
---

# Phase 146 Plan 3: Pending Embedding Retry and Diagnostics Summary

**Recoverable pending embeddings with scanner reachability and doctor visibility for untracked embedding gaps**

## Performance

- **Duration:** 20m
- **Completed:** 2026-05-24T09:21:07Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added `processPendingEmbeddings` with instance-scoped due-row selection, bounded `limit`, document/memory/record target coverage, shared target updates, success cleanup, and repeated-failure metadata.
- Integrated pending retries into `runScanOnce` after existing EMBED-DRAIN handling without masking `drain_query_failed` or timeout precedence.
- Added `checkEmbeddingRetryGaps` to `doctor`, reporting document, memory, and plugin record rows where `embedding IS NULL` and no pending retry row exists.
- Added TDD coverage for T-U-009, T-U-010, T-I-005, and T-I-006 using `.env.test` integration credentials.

## Task Commits

1. **Task 1 RED: Pending worker coverage** - `a60afdb` (test)
2. **Task 1 GREEN: Pending retry worker** - `28b1966` (feat)
3. **Task 2 RED: Scanner reachability coverage** - `02f6403` (test)
4. **Task 2 GREEN: Scanner-integrated retry** - `adb1a28` (feat)
5. **Task 3 RED: Doctor diagnostic coverage** - `4ef9cc0` (test)
6. **Task 3 GREEN: Doctor embedding gap diagnostic** - `8349776` (feat)
7. **Follow-up fix: Worker query typing** - `c820c56` (fix)
8. **Follow-up fix: Supabase boundary typing** - `a75512a` (fix)

## Files Created/Modified

- `src/embedding/pending-worker.ts` - Pending retry selection, target reconstruction, retry processing, success cleanup, and failure metadata updates.
- `src/embedding/background-embed.ts` - Exported shared target update helper and loosened the Supabase helper boundary to avoid deep structural type expansion.
- `src/services/scanner.ts` - Invokes bounded pending retries from `runScanOnce`.
- `src/cli/doctor.ts` - Adds embedding retry coverage diagnostics for documents, memories, and plugin records.
- `tests/unit/pending-embed-worker.test.ts` - T-U-009 and T-U-010 coverage.
- `tests/unit/scanner-embed-drain-status.test.ts` - Scanner retry reachability regression.
- `tests/integration/embedding/pending-embed-worker.test.ts` - T-I-005 worker and scanner-path integration coverage.
- `tests/integration/doctor/embedding-diagnostics.test.ts` - T-I-006 diagnostic coverage.

## Decisions Made

- Successful retries delete pending rows instead of marking them complete, matching the plan allowance to clear or complete state and keeping the pending table operationally focused.
- Pending retry is scanner-integrated instead of a standalone interval worker, avoiding new lifecycle/shutdown ownership in this plan.
- Doctor output reports counts and identifiers only; it does not print `embed_text`, memory content, document body, or record field values.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed worker/Supabase structural typing after typecheck**
- **Found during:** Plan-level verification
- **Issue:** TypeScript attempted deep structural comparison between real Supabase clients and helper-local query interfaces.
- **Fix:** Loosened helper Supabase boundaries to `from(): unknown` and kept casts internal to embedding helper modules.
- **Files modified:** `src/embedding/background-embed.ts`, `src/embedding/pending-worker.ts`
- **Commit:** `a75512a`

**2. [Rule 1 - Bug] Removed concurrent queries on a single pg client in doctor diagnostics**
- **Found during:** Task 3 verification
- **Issue:** The initial diagnostic implementation emitted a `pg` deprecation warning for concurrent `client.query()` calls on one client.
- **Fix:** Queried document, memory, and record diagnostics sequentially.
- **Files modified:** `src/cli/doctor.ts`
- **Commit:** `8349776`

## Verification

- `npm test -- tests/unit/pending-embed-worker.test.ts` - passed.
- `npm test -- tests/unit/scanner-embed-drain-status.test.ts tests/unit/pending-embed-worker.test.ts` - passed.
- `npm run test:integration -- tests/integration/embedding/pending-embed-worker.test.ts` - passed with `.env.test`.
- `npm run test:integration -- tests/integration/doctor/embedding-diagnostics.test.ts` - passed with `.env.test`.
- `npm test -- tests/unit/scanner-embed-drain-status.test.ts tests/unit/pending-embed-worker.test.ts && npm run test:integration -- tests/integration/embedding/pending-embed-worker.test.ts tests/integration/doctor/embedding-diagnostics.test.ts && npm run typecheck && npm run lint` - passed.

## Known Stubs

None. Stub scan found only ordinary empty-array/object initializers in tests and existing scanner code.

## Threat Flags

None. The worker target selection, dynamic record-table diagnostics, bounded retry behavior, repeated-failure metadata, and diagnostic privacy requirements were all in the plan threat model.

## Self-Check: PASSED

- Created files verified: `src/embedding/pending-worker.ts`, `tests/unit/pending-embed-worker.test.ts`, `tests/integration/embedding/pending-embed-worker.test.ts`, `tests/integration/doctor/embedding-diagnostics.test.ts`, and this summary.
- Task commits verified: `a60afdb`, `28b1966`, `02f6403`, `adb1a28`, `4ef9cc0`, `8349776`, `c820c56`, `a75512a`.

---
*Phase: 146-embedding-reliability-foundation*
*Completed: 2026-05-24*
