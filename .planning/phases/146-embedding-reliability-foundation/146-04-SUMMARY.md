---
phase: 146-embedding-reliability-foundation
plan: 4
subsystem: embedding
tags: [embedding, records, pg-pool, shutdown, integration-scenarios]
requires:
  - phase: 146-embedding-reliability-foundation
    plan: 2
    provides: helper-backed record embedding scheduling
  - phase: 146-embedding-reliability-foundation
    plan: 3
    provides: pending retry worker and shared target embedding updates
provides:
  - Process-scoped pooled Postgres query and borrowed-client helpers
  - Shutdown cleanup for pooled Postgres connections
  - Pooled record embedding update and search SQL paths
  - IS-15 YAML integration scenario for record embed/search workflow
affects: [records, embedding, shutdown, pg-client, integration-scenarios]
tech-stack:
  added: []
  patterns:
    - pg Pool map keyed by connection string
    - pooled vector SQL with escaped table identifiers and parameterized values
    - managed YAML scenario with deps: [embeddings]
key-files:
  created:
    - tests/unit/pg-client-pool.test.ts
    - tests/integration/mcp/tools/records-pg-pool.test.ts
    - tests/scenarios/integration/tests/record_embed_pool_concurrency.yml
  modified:
    - src/utils/pg-client.ts
    - src/server/shutdown.ts
    - src/mcp/tools/records.ts
    - src/embedding/background-embed.ts
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
key-decisions:
  - "146-04 keeps createPgClientIPv4 exported for legacy callers while moving record vector paths to queryPgPool."
  - "146-04 routes both semantic and ILIKE record search SQL through the pool so records.ts owns no per-call pg client lifecycle."
  - "146-04 adds a narrow pg pool test factory export to avoid opening real sockets in unit resource-lifecycle tests."
requirements-completed: [REQ-005]
duration: 15m35s
completed: 2026-05-24
---

# Phase 146 Plan 4: Pooled Record SQL Summary

**Record embedding updates and record search now use pooled Postgres access with shutdown cleanup and IS-15 coverage.**

## Performance

- **Duration:** 15m35s
- **Started:** 2026-05-24T09:26:10Z
- **Completed:** 2026-05-24T09:41:45Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Extended `src/utils/pg-client.ts` with `queryPgPool`, `withPgClient`, and `closePgPools`, backed by a process-scoped `pg.Pool` map keyed by connection string.
- Preserved `createPgClientIPv4` and existing timestamp parser behavior.
- Added shutdown cleanup for pg pools after Supabase flush and before Git/scanner cleanup.
- Migrated record target embedding updates from per-call `pg.Client` lifecycle to `queryPgPool`.
- Migrated semantic `search_records` vector SQL and the direct SQL ILIKE branch to pooled queries.
- Added focused unit and integration coverage for T-U-011, T-U-012, T-I-007, and T-I-008.
- Added managed YAML scenario `record_embed_pool_concurrency` for IS-15 / T-Y-001 and registered it in `INTEGRATION_COVERAGE.md`.

## Task Commits

1. **Task 1 RED: Pg pool helper coverage** - `f1cc9c3` (test)
2. **Task 1 GREEN: Pg pool helper and shutdown cleanup** - `73ab452` (feat)
3. **Task 2 RED: Record pg pool integration coverage** - `f8d353b` (test)
4. **Task 2 GREEN: Record vector SQL pool migration** - `bbffefe` (feat)
5. **Task 3: IS-15 pooled record scenario** - `ff378d6` (test)

## Files Created/Modified

- `src/utils/pg-client.ts` - Adds pooled query/borrow/close APIs and test-only pool factory seam.
- `src/server/shutdown.ts` - Calls `closePgPools()` during graceful shutdown.
- `src/embedding/background-embed.ts` - Uses pooled SQL for record embedding target updates.
- `src/mcp/tools/records.ts` - Uses pooled SQL for semantic vector search and ILIKE search.
- `tests/unit/pg-client-pool.test.ts` - T-U-011 and T-U-012 coverage.
- `tests/integration/mcp/tools/records-pg-pool.test.ts` - T-I-007 and T-I-008 coverage.
- `tests/scenarios/integration/tests/record_embed_pool_concurrency.yml` - IS-15 / T-Y-001 managed scenario.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - IS-15 registration with passing date.

## Decisions Made

- Kept `createPgClientIPv4` as a compatibility export because other non-record-vector paths still use it.
- Used `queryPgPool` instead of `withPgClient` for record vector updates/search because these paths only need single SQL statements and do not require transaction-scoped borrowed clients.
- Migrated the ILIKE direct SQL branch in `records.ts` too, eliminating per-call pg lifecycle ownership from the record tool.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added a test-only pg pool factory seam**
- **Found during:** Task 1 GREEN
- **Issue:** Unit tests for pool release/close behavior would otherwise open real database sockets or depend on brittle `pg` module mocking.
- **Fix:** Added `__setPgPoolFactoryForTesting()` so tests can inject a structural pool while production defaults to `new Pool({ connectionString, allowExitOnIdle: true })`.
- **Files modified:** `src/utils/pg-client.ts`, `tests/unit/pg-client-pool.test.ts`
- **Commit:** `73ab452`

**2. [Rule 2 - Missing Critical Functionality] Routed record ILIKE SQL through the pool**
- **Found during:** Task 2 GREEN
- **Issue:** The plan focused on vector SQL, but leaving the ILIKE branch on direct `pg.Client` would keep `records.ts` owning per-call direct SQL lifecycle and fail the source assertion.
- **Fix:** Migrated the ILIKE branch to `queryPgPool` with the same escaped identifiers and parameterized values.
- **Files modified:** `src/mcp/tools/records.ts`
- **Commit:** `bbffefe`

## Verification

- `npm test -- tests/unit/pg-client-pool.test.ts` - passed.
- `npm test -- tests/unit/pg-client-pool.test.ts && npm run test:integration -- tests/integration/mcp/tools/records-pg-pool.test.ts` - passed with `.env.test` integration setup.
- `python3 tests/scenarios/integration/run_integration.py --managed record_embed_pool_concurrency` - passed with `.env.test`; IS-15 recorded.
- `npm test -- tests/unit/background-embed-helper.test.ts tests/unit/pending-embed-worker.test.ts tests/unit/pg-client-pool.test.ts && npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts tests/integration/embedding/pending-embed-worker.test.ts tests/integration/doctor/embedding-diagnostics.test.ts tests/integration/mcp/tools/records-pg-pool.test.ts` - passed with `.env.test`.
- `python3 tests/scenarios/directed/run_suite.py --managed test_background_embed_failure_warning` - passed with `.env.test`.
- `python3 tests/scenarios/integration/run_integration.py --managed record_embed_pool_concurrency && npm run typecheck && npm run lint` - passed.
- `rg -n "void embeddingProvider" src/mcp` - no matches.
- `rg -n "createPgClientIPv4|new pg\\.Client|\\.end\\(\\)\\.catch\\(\\(\\) => \\{\\}\\)" src/mcp/tools/records.ts src/embedding/background-embed.ts src/embedding/pending-worker.ts` - no matches.
- `rg -n "coverage: \\[IS-15\\]|deps: \\[embeddings\\]" tests/scenarios/integration/tests/record_embed_pool_concurrency.yml` - confirmed.

## Known Stubs

None. Stub scan found only pre-existing TODO comments in shutdown/record logging and normal empty collection initializers; no placeholder behavior was introduced.

## Threat Flags

None. The plan touched the expected MCP record-to-SQL and pool lifecycle trust boundaries. Dynamic table names remain escaped through `pg.escapeIdentifier`, vector/user values remain parameterized, and record updates preserve `instance_id` filters.

## User Setup Required

None. Integration and scenario verification used existing `.env.test` credentials.

## Next Phase Readiness

REQ-005 is complete. Phase 146 now has REQ-003 deferred warning behavior, REQ-004 pending retry/diagnostics, and REQ-005 pooled record SQL covered by focused unit, integration, directed, YAML, typecheck, and lint gates.

## Self-Check: PASSED

- Created files verified: `tests/unit/pg-client-pool.test.ts`, `tests/integration/mcp/tools/records-pg-pool.test.ts`, `tests/scenarios/integration/tests/record_embed_pool_concurrency.yml`, and this summary.
- Modified files verified: `src/utils/pg-client.ts`, `src/server/shutdown.ts`, `src/mcp/tools/records.ts`, `src/embedding/background-embed.ts`, and `tests/scenarios/integration/INTEGRATION_COVERAGE.md`.
- Task commits verified: `f1cc9c3`, `73ab452`, `f8d353b`, `bbffefe`, `ff378d6`.

---
*Phase: 146-embedding-reliability-foundation*
*Completed: 2026-05-24*
