---
phase: 165-foundation-infrastructure
plan: 02
subsystem: embedding
tags: [embedding-catalog, pgvector, schema-ddl, drift-detection, rpc]
requires:
  - phase: 165-01
    provides: fqc_embeddings catalog table, YAML parsing, and startup catalog sync
provides:
  - Core per-entry pgvector column sets on fqc_documents and fqc_memory
  - Core per-entry HNSW indexes and match RPCs
  - Catalog-aware vector width drift detection
  - Explicit gated test/dev destructive repair helper
affects: [165-foundation-infrastructure, 166-embedding-pipeline, 167-lifecycle-operations-and-validation]
tech-stack:
  added: []
  patterns:
    - Transactional DDL helpers for per-entry embedding storage
    - Catalog-aware schema verification via active fqc_embeddings rows
    - Explicit repair gate for destructive schema operations
key-files:
  created:
    - tests/integration/embedding/column-set-creation.test.ts
    - tests/integration/embedding/per-entry-rpcs.test.ts
    - tests/integration/embedding/drift-detection.test.ts
    - tests/integration/embedding/test-dev-repair.test.ts
    - src/storage/test-dev-repair.ts
  modified:
    - src/embedding/embedding-config-sync.ts
    - src/storage/supabase.ts
    - src/storage/schema-verify.ts
key-decisions:
  - "Catalog-aware verifySchema uses an options object while preserving the legacy numeric expected-dimensions path."
  - "PostgreSQL does not preserve pgvector typmod in function argument metadata, so RPC tests verify real function definitions plus runtime width enforcement against vector columns."
  - "Repair is exposed only as an explicit helper with an enabled gate; default verifySchema refuses drift and does not mutate schema."
patterns-established:
  - "Embedding SQL identifiers must match lowercase snake-case with a leading letter before deriving column, index, or function names."
  - "Core per-entry columns, HNSW indexes, and core RPCs are created in one transaction."
requirements-completed: [REQ-008, REQ-010, REQ-011, REQ-021]
duration: 35min
completed: 2026-06-10
---

# Phase 165 Plan 02: Per-Entry Columns + Drift Detection Summary

**Core per-entry pgvector storage, HNSW indexes, semantic RPCs, catalog drift detection, and gated destructive repair**

## Performance

- **Duration:** 35 min
- **Started:** 2026-06-10T22:12:24Z
- **Completed:** 2026-06-10T22:47:23Z
- **Tasks:** 4 completed
- **Files modified:** 8

## Accomplishments

- Added integration coverage for T-I-023, T-I-024, T-I-025, T-I-026, T-I-027, T-I-028, T-I-029, T-I-030, and T-I-050.
- Added transactional core DDL that creates `embedding_<name>` plus stamping columns, HNSW indexes, and `match_memories_<name>` / `match_documents_<name>`.
- Added orphaned base-vector-column refusal before partial DDL.
- Added catalog-aware `verifySchema(client, { instanceId })` drift detection for active core entries while preserving the legacy numeric dimension verifier.
- Added explicit `repairEmbeddingDimensionDrift(..., { enabled: true })` for test/dev destructive repair, with WARN logging and default refusal behavior.

## Task Commits

1. **Task 1: Add column-set and RPC integration tests** - `01113fb` (test)
2. **Task 2: Create core per-entry columns, HNSW indexes, and RPCs during catalog sync** - `14fda6c` (feat)
3. **Task 3: Add drift detection and repair tests** - `8fbe4bf` (test)
4. **Task 4: Generalize schema verification to catalog entries and add gated repair** - `683bcb5` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/embedding/embedding-config-sync.ts` - Calls core storage DDL during active catalog sync.
- `src/storage/supabase.ts` - Builds and executes transactional core column, HNSW index, and RPC DDL.
- `src/storage/schema-verify.ts` - Adds catalog-driven active-entry drift detection.
- `src/storage/test-dev-repair.ts` - Adds explicit gated destructive repair helper.
- `tests/integration/embedding/column-set-creation.test.ts` - Real metadata tests for column sets, rollback, and orphan refusal.
- `tests/integration/embedding/per-entry-rpcs.test.ts` - Real RPC creation and runtime vector-width enforcement coverage.
- `tests/integration/embedding/drift-detection.test.ts` - Real pgvector drift detection coverage.
- `tests/integration/embedding/test-dev-repair.test.ts` - Gated repair and default refusal coverage.

## Decisions Made

- Used an options-object overload for catalog drift detection instead of replacing the existing `verifySchema(client, number)` call sites.
- Kept plugin-table column sets and plugin RPCs out of scope; only `fqc_documents` and `fqc_memory` are touched.
- Used direct pg integration tests for drift/repair to avoid unrelated startup legacy-dimension verification during destructive schema probes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced unsupported Vitest `--grep` commands with file/name targeting**
- **Found during:** Task 2 verification
- **Issue:** Vitest 4 rejected `--grep` with `Unknown option --grep`.
- **Fix:** Used targeted file commands and `npm run test:unit -- ...` equivalents for verification.
- **Files modified:** None.
- **Verification:** Targeted unit/integration commands passed.
- **Committed in:** N/A.

**2. [Rule 1 - Bug] Adjusted RPC test metadata assertion for PostgreSQL pgvector typmod behavior**
- **Found during:** Task 2
- **Issue:** PostgreSQL stores function argument type metadata as `vector`, not `vector(N)`, even when DDL declares `vector(N)`.
- **Fix:** Test now verifies real function definitions reference per-entry columns and proves wrong-width query vectors fail at runtime against `vector(96)` columns.
- **Files modified:** `tests/integration/embedding/per-entry-rpcs.test.ts`
- **Verification:** `npm run test:integration -- tests/integration/embedding/per-entry-rpcs.test.ts` passed.
- **Committed in:** `14fda6c`

**3. [Rule 3 - Blocking] Removed full startup dependency from drift/repair tests**
- **Found during:** Task 4
- **Issue:** Destructive drift probes could race with full startup legacy-dimension verification in parallel integration files.
- **Fix:** Drift/repair tests now use direct pg plus the core DDL helper instead of `initSupabase`.
- **Files modified:** `tests/integration/embedding/drift-detection.test.ts`, `tests/integration/embedding/test-dev-repair.test.ts`
- **Verification:** Drift and repair integration tests passed in targeted runs.
- **Committed in:** `683bcb5`

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking).
**Impact on plan:** No scope expansion. The changes preserve the intended behavior and make verification reliable against the current toolchain and shared test database.

## Issues Encountered

- The `.env.test` Supabase database intermittently returned `EAUTHTIMEOUT`; retries succeeded. One combined drift/repair run reported `1 passed | 1 failed` due to this transient timeout, then the repair file passed when rerun.
- A failed RED run left `fqc_documents.embedding` temporarily at `vector(7)`; it was restored to `vector(1536)` and verified before close-out.

## Verification

- `npm run test:integration -- tests/integration/embedding/column-set-creation.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/per-entry-rpcs.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/drift-detection.test.ts tests/integration/embedding/test-dev-repair.test.ts` - PARTIAL: drift passed; repair hit transient `EAUTHTIMEOUT`
- `npm run test:integration -- tests/integration/embedding/test-dev-repair.test.ts` - PASSED
- `npm run test:unit -- tests/unit/schema-verify.test.ts` - PASSED
- `npm run typecheck` - PASSED
- Acceptance scan for T-I-023, T-I-024, T-I-025, T-I-026, T-I-027, T-I-028, T-I-029, T-I-030, T-I-050 - PASSED
- Shared DB legacy column check: `fqc_documents.embedding` is `vector(1536)` - PASSED

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used for verification.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: ddl-repair | `src/storage/test-dev-repair.ts` | New explicit destructive schema repair helper; gated by `enabled: true`, logs WARN with data-loss language, and covered by default-refusal tests. |

## Next Phase Readiness

Plan 03 can build on concrete core per-entry storage and drift guarantees to add stamping, provider length guards, and removal of the `includeDimensions` heuristic. Plugin-table column sets and plugin RPCs remain deferred to Phase 166 as planned.

## Self-Check: PASSED

- Summary file created at `.planning/phases/165-foundation-infrastructure/165-02-SUMMARY.md`.
- Task commits exist: `01113fb`, `14fda6c`, `8fbe4bf`, `683bcb5`.
- Created files exist: all key test files and `src/storage/test-dev-repair.ts`.
- No unexpected tracked file deletions detected in task commits.

---
*Phase: 165-foundation-infrastructure*
*Completed: 2026-06-10*
