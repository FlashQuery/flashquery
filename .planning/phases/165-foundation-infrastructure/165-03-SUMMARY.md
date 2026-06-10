---
phase: 165-foundation-infrastructure
plan: 03
subsystem: embedding
tags: [embedding-stamping, provider-guard, native-dimensions, pgvector]
requires:
  - phase: 165-02
    provides: Core per-entry pgvector columns, stamping columns, and RPC/storage foundation
provides:
  - Atomic vector plus model/dimensions/provider/truncated stamping helper
  - Provider-boundary vector length guard for OpenAI-compatible and Ollama embeddings
  - Removal of the OpenAI-compatible dimensions request heuristic
  - Native-width embedding catalog example configuration
affects: [165-foundation-infrastructure, 166-embedding-pipeline, 167-lifecycle-operations-and-validation]
tech-stack:
  added: []
  patterns:
    - Optional per-entry embedding write stamp preserves legacy singular embedding compatibility
    - Leaf providers validate vector width before callers can write returned vectors
    - Legacy dimension lookup is explicitly named as compatibility-only
key-files:
  created:
    - tests/unit/embedding-stamping.test.ts
    - tests/unit/embedding-length-guard.test.ts
    - tests/integration/embedding/stamping-write-roundtrip.test.ts
    - tests/integration/embedding/dimensions-from-yaml.test.ts
  modified:
    - src/embedding/provider.ts
    - src/embedding/background-embed.ts
    - src/embedding/pending-worker.ts
    - src/embedding/legacy-dimensions.ts
    - src/mcp/tools/plugins.ts
    - src/storage/supabase.ts
    - tests/unit/embedding-provider.test.ts
    - tests/unit/embedding.test.ts
    - flashquery.example.yml
key-decisions:
  - "Phase 165 keeps legacy singular embedding compatibility explicit via getLegacyEmbeddingDimensions while catalog-driven embeddings use strict entry dimensions."
  - "Per-entry stamping is opt-in through embeddingName during Phase 165; legacy callers continue writing the singular embedding column until Phase 166 fan-out lands."
patterns-established:
  - "Embedding write stamps are derived from provider.getProviderInfo() and vector.length, not catalog entry aliases."
  - "Wrong-width provider responses fail inside leaf providers with provider, model, expected width, actual width, and remediation text."
requirements-completed: [REQ-009, REQ-018, REQ-019]
duration: 20min
completed: 2026-06-10
---

# Phase 165 Plan 03: Stamping, Length Guard, Heuristic Removal Summary

**Atomic per-entry embedding stamps, provider-side vector width validation, and native-width-only embedding API requests**

## Performance

- **Duration:** 20 min
- **Started:** 2026-06-10T22:52:00Z
- **Completed:** 2026-06-10T23:12:07Z
- **Tasks:** 4 completed
- **Files modified:** 13

## Accomplishments

- Added RED/GREEN coverage for T-U-006 through T-U-013 and T-I-031 through T-I-033.
- Added optional per-entry stamping writes that update `embedding_<name>` plus `_model`, `_dimensions`, `_provider`, and `_truncated` in one payload/SQL statement.
- Added OpenAI-compatible and Ollama leaf-provider length guards before vectors return to callers.
- Removed the OpenAI-compatible `dimensions` request-body heuristic and retired the generic dimensions helper into explicit legacy compatibility.
- Updated `flashquery.example.yml` with a native-width top-level `embeddings:` catalog example.

## Task Commits

1. **Task 1: Add stamping, length guard, and no-dimensions tests** - `49c5892` (test)
2. **Task 2: Stamp vectors atomically on successful core embedding writes** - `4090ef7` (feat)
3. **Task 3: Add runtime vector-length guard in leaf providers** - `6519011` (feat)
4. **Task 4: Remove includeDimensions heuristic and dimensions request-body insertion** - `ed70891` (feat)
5. **Rule 1 follow-up: Align existing provider tests with length guard** - `87a0d2f` (test)

**Plan metadata:** included in the final docs commit

## Files Created/Modified

- `src/embedding/provider.ts` - Removes dimensions request insertion and validates returned vector width in leaf providers.
- `src/embedding/background-embed.ts` - Adds per-entry atomic stamping payload/SQL update support.
- `src/embedding/pending-worker.ts` - Allows pending retry paths to use the same optional stamping helper.
- `src/embedding/legacy-dimensions.ts` - Explicit compatibility-only replacement for the retired generic dimensions helper.
- `src/mcp/tools/plugins.ts` - Uses the explicit legacy helper for legacy plugin embedding columns.
- `src/storage/supabase.ts` - Uses the explicit legacy helper for singular legacy schema initialization.
- `tests/unit/embedding-stamping.test.ts` - T-U-006 and T-U-007 stamping assertions.
- `tests/unit/embedding-length-guard.test.ts` - T-U-008 through T-U-011 provider guard assertions.
- `tests/unit/embedding-provider.test.ts` - T-U-012/T-U-013 request-body and source-scan assertions.
- `tests/unit/embedding.test.ts` - Existing provider success fixtures aligned with the new length guard.
- `tests/integration/embedding/stamping-write-roundtrip.test.ts` - T-I-031 real DB stamping read-back.
- `tests/integration/embedding/dimensions-from-yaml.test.ts` - T-I-032/T-I-033 native-width and misconfiguration guard coverage.
- `flashquery.example.yml` - Native-width catalog configuration example.

## Decisions Made

- Kept per-entry stamping optional in Phase 165 so existing singular write paths remain compatible until Phase 166 changes write fan-out and pending queue shape.
- Used provider metadata as the stamping source for provider/model, and vector length as the stamping source for dimensions.
- Renamed the old dimension lookup to `getLegacyEmbeddingDimensions` instead of leaving a generic `dimensions.ts` helper that could be mistaken for catalog behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used targeted Vitest commands instead of unsupported grep wrapper**
- **Found during:** Verification
- **Issue:** `npm test -- --grep "embedding-provider"` does not filter the unit suite in this repo; it runs all unit tests and forwards grep only to the macro-framework command.
- **Fix:** Ran targeted Vitest file commands and the full unit suite after updating affected tests.
- **Files modified:** `tests/unit/embedding.test.ts`
- **Verification:** `npm run test:unit` passed.
- **Committed in:** `87a0d2f`

**2. [Rule 1 - Bug] Updated existing provider success tests for the new length guard**
- **Found during:** Full unit verification
- **Issue:** Existing success-path tests mocked 1- or 3-wide vectors while configuring 768/1536 dimensions, which is now correctly rejected by the provider guard.
- **Fix:** Updated those fixtures to configure dimensions matching their mocked vectors.
- **Files modified:** `tests/unit/embedding.test.ts`
- **Verification:** `npm run test:unit` passed.
- **Committed in:** `87a0d2f`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug).
**Impact on plan:** No scope expansion. Both fixes were required to verify the new provider-boundary invariant against the current test toolchain.

## Issues Encountered

- One combined integration run hit transient Supabase `EAUTHTIMEOUT` during DDL; rerunning `tests/integration/embedding/stamping-write-roundtrip.test.ts` passed.
- The exact `npm test -- --grep "embedding-provider"` command is not a valid provider-only filter for this repo; targeted unit commands and full unit verification were used instead.

## Verification

- `npm run test:unit -- tests/unit/embedding-stamping.test.ts tests/unit/embedding-length-guard.test.ts tests/unit/embedding-provider.test.ts tests/unit/pending-embed-worker.test.ts` - PASSED
- `npm run test:integration -- tests/integration/embedding/stamping-write-roundtrip.test.ts tests/integration/embedding/dimensions-from-yaml.test.ts` - PASSED once, then hit transient `EAUTHTIMEOUT` on a later combined rerun
- `npm run test:integration -- tests/integration/embedding/stamping-write-roundtrip.test.ts` - PASSED on retry
- `npm run test:unit` - PASSED (185 files, 2239 tests)
- `npm run typecheck` - PASSED
- `! grep -r "includeDimensions" src/` - PASSED
- Shared DB legacy column check: `fqc_documents.embedding` and `fqc_memory.embedding` are `vector(1536)` - PASSED

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` used for verification.

## Known Stubs

None.

## Next Phase Readiness

Phase 165 foundation is ready for Phase 166. The catalog, core per-entry columns/RPCs, drift detection, stamping helper, leaf-provider length guard, and no-dimensions request invariant are in place. Phase 166 can build the multi-entry write fan-out, per-entry pending queue shape, warnings, rate limiting, truncation, search/RRF, and plugin-table integration.

## Self-Check: PASSED

- Summary file created at `.planning/phases/165-foundation-infrastructure/165-03-SUMMARY.md`.
- Task commits exist: `49c5892`, `4090ef7`, `6519011`, `ed70891`, `87a0d2f`.
- Created test files exist.
- No unexpected tracked file deletions detected in task commits; `src/embedding/dimensions.ts` was intentionally renamed to `src/embedding/legacy-dimensions.ts`.

---
*Phase: 165-foundation-infrastructure*
*Completed: 2026-06-10*
