---
phase: 146-embedding-reliability-foundation
plan: 1
subsystem: database
tags: [embedding, supabase, postgres, retry-state, vitest]
requires:
  - phase: 145-silent-failure-quick-wins
    provides: scanner embed-drain failure handling and Phase 146 execution baseline
provides:
  - Durable fqc_pending_embeds schema with target identity and retry metadata
  - Schema verification for pending embedding table and required columns
  - Central background embedding helper for document, memory, and record targets
  - Unit and integration coverage for pending embedding failure recording
affects: [146-embedding-reliability-foundation, embedding, mcp-write-tools, records]
tech-stack:
  added: []
  patterns:
    - Typed embedding target descriptors
    - Durable pending-row upsert on provider or target update failure
    - Deferred embedding warning code for foreground success envelopes
key-files:
  created:
    - src/embedding/background-embed.ts
    - tests/unit/background-embed-helper.test.ts
    - tests/integration/embedding/background-embed-doc-memory-record.test.ts
  modified:
    - src/storage/supabase.ts
    - src/storage/schema-verify.ts
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "146-01 stores pending embedding retry state in fqc_pending_embeds keyed by instance_id,target_kind,target_table,target_id."
  - "146-01 validates dynamic record target table names in the target descriptor before optional direct pg update."
  - "146-01 uses embedding_deferred as the helper warning value for foreground success envelopes."
patterns-established:
  - "Embedding helpers accept typed document, memory, and record targets rather than raw MCP payload fields."
  - "Provider/update failures write fqc_pending_embeds and emit background_embed_failed without logging raw embed text."
requirements-completed: [REQ-003, REQ-004]
duration: 7m55s
completed: 2026-05-24
---

# Phase 146 Plan 1: Embedding Reliability Foundation Summary

**Durable pending embedding table plus a centralized helper that records retryable document, memory, and record embedding failures**

## Performance

- **Duration:** 7m55s
- **Started:** 2026-05-24T08:53:26Z
- **Completed:** 2026-05-24T09:01:21Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added `fqc_pending_embeds` DDL with required target fields, attempt metadata, retry indexes, and uniqueness scoped by `instance_id,target_kind,target_table,target_id`.
- Extended `verifySchema` so startup verification fails if the pending embedding table or any required column is missing.
- Added `src/embedding/background-embed.ts` with typed document, memory, and record targets, target embedding updates, pending-row upserts, `background_embed_failed` logging, and `embedding_deferred` warnings.
- Added focused unit and integration coverage, including `.env.test`-backed proof that forced provider failure creates pending rows for document, memory, and record targets.

## Task Commits

1. **Task 1 RED: Add pending schema integration gate** - `8e8856b` (test)
2. **Task 1 GREEN: Add durable pending embedding schema and verification** - `4d502ca` (feat)
3. **Task 2 RED: Add background embedding helper contract** - `a271e04` (test)
4. **Task 2 GREEN: Implement centralized background embedding helper** - `d42b923` (feat)
5. **Task 3: Verify schema push and helper foundation** - `54b7541` (chore)

## Files Created/Modified

- `src/embedding/background-embed.ts` - Central helper, target descriptors, target updates, pending-row upsert, and deferred warning result.
- `src/storage/supabase.ts` - `fqc_pending_embeds` table, status check, unique target index, retry selector index, and target lookup index.
- `src/storage/schema-verify.ts` - Required table and column verification for `fqc_pending_embeds`.
- `tests/unit/background-embed-helper.test.ts` - T-U-006, T-U-007, and T-U-008 helper coverage.
- `tests/integration/embedding/background-embed-doc-memory-record.test.ts` - T-I-003/T-I-004 schema and pending-row integration coverage using `.env.test`.
- `tests/config/vitest.integration.config.ts` - Curated include list now contains all four Phase 146 integration specs.

## Decisions Made

- Used a dedicated `fqc_pending_embeds` table rather than overloading scanner state, because retry state must survive process restarts and cover dynamic record tables.
- Stored `embed_text` in pending rows for Plan 1 so later retry worker plans can process documents, memories, and records through the same target abstraction without rehydrating every source type first.
- Logged only target metadata and error text in `background_embed_failed`; raw `embed_text` stays in the durable retry row and is not emitted to logs.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The Task 1 RED integration test initially failed cleanup when `fqc_pending_embeds` did not exist. The cleanup was made tolerant before the RED commit so the intentional failure remained focused on missing schema.

## Verification

- `npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts` - passed with `.env.test` credentials.
- `npm test -- tests/unit/background-embed-helper.test.ts` - passed.
- `npm test -- tests/unit/background-embed-helper.test.ts && npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts && npm run typecheck` - passed.
- `rg -n "fqc_pending_embeds|target_kind|attempt_count|last_attempt_at" src/storage/supabase.ts src/storage/schema-verify.ts` - confirmed DDL and verifier coverage.
- `rg -n "background-embed-doc-memory-record|pending-embed-worker|embedding-diagnostics|records-pg-pool" tests/config/vitest.integration.config.ts` - confirmed all Phase 146 integration specs are included.

## Known Stubs

None. Stub scan only found ordinary empty-array/null initializations in existing code and tests; no placeholder UI/data behavior was introduced.

## User Setup Required

None - no new external service configuration required. Integration verification used the existing `.env.test` credentials.

## Next Phase Readiness

Plan 2 can build the pending embedding worker on top of `fqc_pending_embeds` and the target descriptors. Later MCP call-site migration can merge helper warnings into existing JSON envelopes via `withWarnings`.

## Self-Check: PASSED

- Created files verified: `src/embedding/background-embed.ts`, `tests/unit/background-embed-helper.test.ts`, `tests/integration/embedding/background-embed-doc-memory-record.test.ts`, and this summary.
- Task commits verified: `8e8856b`, `4d502ca`, `a271e04`, `d42b923`, `54b7541`.

---
*Phase: 146-embedding-reliability-foundation*
*Completed: 2026-05-24*
