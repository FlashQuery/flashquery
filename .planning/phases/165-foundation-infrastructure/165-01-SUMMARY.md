---
phase: 165-foundation-infrastructure
plan: 01
subsystem: embedding
tags: [embedding-catalog, config, supabase, yaml, startup-sync]
requires: []
provides:
  - Strict top-level embeddings YAML parsing
  - fqc_embeddings catalog table foundation
  - Startup catalog sync for YAML entries
  - Instance-scoped catalog identity safeguards
affects: [165-foundation-infrastructure, 166-embedding-pipeline, 167-lifecycle-operations-and-validation]
tech-stack:
  added: []
  patterns:
    - Strict Zod validation with explicit post-parse catalog checks
    - Supabase catalog sync scoped by instance_id
key-files:
  created:
    - src/embedding/embedding-config-sync.ts
    - tests/unit/embedding-yaml-parser.test.ts
    - tests/integration/embedding/catalog-schema.test.ts
    - tests/integration/embedding/yaml-validation.test.ts
    - tests/integration/embedding/config-sync-add-entry.test.ts
    - tests/integration/embedding/in-place-yaml-refusal.test.ts
    - tests/integration/embedding/yaml-deletion-deactivation.test.ts
    - tests/integration/embedding/multi-tenancy.test.ts
  modified:
    - src/config/loader.ts
    - src/config/types.ts
    - src/storage/supabase.ts
    - src/index.ts
key-decisions:
  - "Catalog entries preserve endpoint order as JSONB while comparing vector-space identity by dimensions and endpoint model set."
  - "YAML deletion deactivates yaml-sourced rows and leaves runtime-sourced rows untouched."
  - "Startup wires catalog sync after Supabase schema initialization and before embedding initialization."
patterns-established:
  - "Embedding catalog sync performs all identity refusal checks before any mutation."
  - "Deactivated catalog rows emit repeated remediation logs but are not dropped."
requirements-completed: [REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007]
duration: interrupted/recovered
completed: 2026-06-10
---

# Phase 165 Plan 01: Catalog Foundation Summary

**Strict embedding catalog YAML parsing, fqc_embeddings DDL, and instance-scoped startup sync with identity refusal and deactivation handling**

## Performance

- **Duration:** Interrupted by outage, then recovered on 2026-06-10
- **Started:** 2026-06-10
- **Completed:** 2026-06-10T22:10:48Z
- **Tasks:** 4 completed
- **Files modified:** 12

## Accomplishments

- Added strict top-level `embeddings:` config parsing with required name, dimensions, and endpoints.
- Added `fqc_embeddings` schema DDL with `UNIQUE(instance_id, name)`, ordered endpoint JSONB storage, and status constraints.
- Added `syncEmbeddingCatalog` and startup wiring for insert, benign update, vector-space identity refusal, YAML deletion deactivation, same-shape reactivation, runtime-row preservation, and instance isolation.
- Added unit and integration coverage for parser, schema, validation, sync, refusal, deactivation, reactivation, and multi-tenancy behavior.

## Task Commits

1. **Task 1: Add strict embeddings YAML parser tests** - `1b2b7a6` (test)
2. **Task 2: Parse and type top-level embeddings catalog config** - `783e6dc` (feat)
3. **Task 3: Add fqc_embeddings DDL and schema tests** - `ed1b80b`, `185ffa3` (test, feat)
4. **Task 4: Implement catalog config-sync insert, identity refusal, deactivation, and instance scoping** - `4024474`, `0727afb` (test, feat)

## Files Created/Modified

- `src/embedding/embedding-config-sync.ts` - Catalog reconciliation, identity refusal, deactivation/reactivation, instance-scoped mutations.
- `src/config/loader.ts` - Strict parser and validation for top-level `embeddings:` entries.
- `src/config/types.ts` - Typed `FlashQueryConfig.embeddings` catalog entries.
- `src/storage/supabase.ts` - `fqc_embeddings` DDL.
- `src/index.ts` - Startup and scan-path catalog sync wiring.
- `tests/unit/embedding-yaml-parser.test.ts` - Parser and validation coverage.
- `tests/integration/embedding/*.test.ts` - Real Supabase schema and catalog sync coverage.

## Decisions Made

- Same-name vector-space identity changes are refused before any catalog mutation.
- Endpoint provider/rate-limit changes that do not alter dimensions or model set are treated as benign updates.
- Phase 165 Plan 01 only records deactivated status and remediation logs; downstream operation refusal remains owned by later plans/phases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Interrupted close-out after outage**
- **Found during:** Resume of Task 4
- **Issue:** Production/test commits existed without `165-01-SUMMARY.md`, and Task 4 had uncommitted implementation changes.
- **Fix:** Audited git state, completed Task 4 verification, committed the recovered implementation, and wrote this summary before proceeding to Wave 2.
- **Files modified:** `src/embedding/embedding-config-sync.ts`, `src/index.ts`, integration test files, summary file.
- **Verification:** Targeted unit tests, targeted integration tests using `.env.test`, and typecheck passed.
- **Committed in:** `0727afb` plus this summary commit.

---

**Total deviations:** 1 auto-fixed (recovery/close-out).
**Impact on plan:** No scope expansion. Recovery restored the required production-code commit -> SUMMARY commit ordering before dependent work.

## Issues Encountered

- `npm test -- tests/unit/...` forwards file arguments into the macro-framework script and fails there after unit tests pass. Used `npm run test:unit -- ...` for targeted unit verification.
- Integration tests are slow because each file builds and initializes Supabase schema, but they completed successfully with `.env.test`.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used for verification.

## Verification

- `npm run test:unit -- tests/unit/embedding-yaml-parser.test.ts tests/unit/config-loader.test.ts tests/unit/llm-config.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/catalog-schema.test.ts tests/integration/embedding/yaml-validation.test.ts tests/integration/embedding/config-sync-add-entry.test.ts tests/integration/embedding/in-place-yaml-refusal.test.ts tests/integration/embedding/yaml-deletion-deactivation.test.ts tests/integration/embedding/multi-tenancy.test.ts` - PASSED (19 passed, 1 skipped)
- `npm run typecheck` - PASSED

## Next Phase Readiness

Plan 02 can build on the active catalog rows to create per-entry core columns, HNSW indexes, per-entry RPCs, and drift detection. The catalog sync currently does not create per-entry columns; that is intentionally owned by Plan 02.

## Self-Check: PASSED

---
*Phase: 165-foundation-infrastructure*
*Completed: 2026-06-10*
