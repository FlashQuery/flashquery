---
phase: 157-records-memory-plugins-audit-guards
plan: 01
subsystem: memory
tags: [memory, concurrency, supabase, rpc, vitest]
requires:
  - phase: 156-atomic-durable-write-primitive-consolidation
    provides: durable write primitive baseline
provides:
  - Memory write handler without coarse memory lock usage
  - T-I-043 concurrent memory update integration coverage
affects: [memory, write-lock-retirement, req-023]
tech-stack:
  added: []
  patterns: [database RPC as concurrency guard]
key-files:
  created: [tests/integration/memory-no-coarse-lock.integration.test.ts]
  modified: [src/mcp/tools/memory.ts, tests/config/vitest.integration.config.ts]
key-decisions:
  - "Memory gets no replacement lock; fqc_memory_create_version remains the concurrency guard."
patterns-established:
  - "REQ-023 memory updates route races through the transactional Supabase RPC."
requirements-completed: [REQ-023]
duration: 35min
completed: 2026-05-26
---

# Phase 157 Plan 01: Memory Coarse Lock Removal Summary

**Memory update races now rely on `fqc_memory_create_version` without a coarse `memory` write lock**

## Performance

- **Duration:** 35 min
- **Started:** 2026-05-26T18:18:00Z
- **Completed:** 2026-05-26T18:53:11Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Removed `acquireLock` / `releaseLock` usage for the `memory` resource in `write_memory`.
- Added a REQ-023 source comment at the RPC update path documenting why no replacement lock is correct.
- Added T-I-043 integration coverage for two concurrent updates to one memory chain.

## Task Commits

Implemented in the final Phase 157 commit.

## Files Created/Modified

- `src/mcp/tools/memory.ts` - Removes coarse memory lock usage and preserves RPC conflict mapping.
- `tests/integration/memory-no-coarse-lock.integration.test.ts` - Covers concurrent memory update convergence.
- `tests/config/vitest.integration.config.ts` - Registers Phase 157 integration tests.

## Decisions Made

Memory update correctness remains owned by the database RPC rather than any process-local or table-backed lock.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The ROADMAP grep command form uses `--grep`, which Vitest 4 rejects in this repo. Verification used the equivalent targeted file command.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Records and plugins can build on the Phase 157 integration include registration.

---
*Phase: 157-records-memory-plugins-audit-guards*
*Completed: 2026-05-26*
