---
phase: 146-embedding-reliability-foundation
plan: 2
subsystem: embedding
tags: [embedding, mcp, warnings, directed-scenarios, vitest]
requires:
  - phase: 146-embedding-reliability-foundation
    plan: 1
    provides: durable background embedding helper and fqc_pending_embeds schema
provides:
  - Helper-backed MCP memory, document, compound, and record embedding writes
  - Public embedding_deferred warnings on successful writes when embedding is deferred
  - D-69 directed scenario coverage for public deferred warning behavior
affects: [mcp-write-tools, embedding, records, directed-scenarios]
tech-stack:
  added: []
  patterns:
    - scheduleBackgroundEmbedding call-site migration
    - withWarnings merge into successful MCP JSON responses
    - record target descriptors for dynamic plugin tables
key-files:
  created:
    - tests/scenarios/directed/testcases/test_background_embed_failure_warning.py
  modified:
    - src/mcp/tools/memory.ts
    - src/mcp/tools/documents.ts
    - src/mcp/tools/compound.ts
    - src/mcp/tools/records.ts
    - src/mcp/utils/document-output.ts
    - tests/integration/embedding/background-embed-doc-memory-record.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
key-decisions:
  - "146-02 awaits the helper scheduling boundary so successful write responses can include embedding_deferred deterministically."
  - "146-02 uses the existing plugin table resolver output as the record target_table source; raw table names are not accepted from MCP input."
  - "146-02 injects provider failure in D-69 with a managed test-only broken embedding purpose instead of adding production test hooks."
requirements-completed: [REQ-003]
duration: 15m47s
completed: 2026-05-24
---

# Phase 146 Plan 2: MCP Embedding Call-Site Migration Summary

**MCP write tools now route background embeddings through the durable helper and surface `embedding_deferred` in public success responses.**

## Performance

- **Duration:** 15m47s
- **Started:** 2026-05-24T09:05:42Z
- **Completed:** 2026-05-24T09:21:29Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Migrated `write_memory` create/update paths to `scheduleBackgroundEmbedding` and merged helper warnings into the existing JSON memory payloads.
- Migrated `write_document` create/update/copy paths plus `get_document` stale-hash re-embed to the helper-backed document target flow.
- Migrated `insert_in_doc`, `replace_doc_section`, and `write_record` `embed_fields` paths to the helper, including dynamic record `target_table` and `target_id` pending metadata.
- Added `.env.test`-backed integration coverage proving forced provider failures keep write responses successful while returning `warnings:["embedding_deferred"]`.
- Added directed scenario `test_background_embed_failure_warning` and registered D-69 coverage with a passing managed run.

## Task Commits

1. **Task 1 RED: Add public memory/document warning coverage** - `0d2eb57` (test)
2. **Task 1 GREEN: Migrate memory and document embed writes** - `f76ce7c` (feat)
3. **Task 2 RED: Add compound and record warning coverage** - `34a5cf9` (test)
4. **Task 2 GREEN: Migrate compound and record embed writes** - `7e350c6` (feat)
5. **Task 3: Add D-69 deferred embedding scenario** - `e46f89e` (test)

## Files Created/Modified

- `src/mcp/tools/memory.ts` - Memory write create/update now call helper targets and merge warnings.
- `src/mcp/tools/documents.ts` - Document create/update/copy now call helper targets and merge warnings.
- `src/mcp/utils/document-output.ts` - Stale-hash re-embed now uses the centralized helper after hash update.
- `src/mcp/tools/compound.ts` - Document mutation tools now use helper-backed re-embedding.
- `src/mcp/tools/records.ts` - Record `embed_fields` writes now use record target descriptors and helper scheduling.
- `tests/integration/embedding/background-embed-doc-memory-record.test.ts` - Public write response and pending-row assertions for memory, document, compound, and record paths.
- `tests/scenarios/directed/testcases/test_background_embed_failure_warning.py` - D-69 managed scenario for public warning behavior.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - D-69 coverage registration and summary count update.

## Decisions Made

- Awaited the helper scheduling result in write handlers because the public warning contract requires deterministic response payloads.
- Kept semantic search foreground query embeddings unchanged; only background write/re-embed paths were migrated.
- Used a managed directed scenario with an unreachable local embedding endpoint for D-69 failure injection, avoiding production-only test hooks.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- RED test setup initially mocked the embedding provider without preserving `getEmbeddingDimensions`; the mock was corrected before the RED commit so failures targeted the missing public warning behavior.
- The D-69 scenario initially failed startup because model capability flags are now required; the test-only model config was updated with explicit capabilities before the passing run.

## Verification

- `npm run test:integration -- tests/integration/embedding/background-embed-doc-memory-record.test.ts` - passed with `.env.test` credentials.
- `python3 tests/scenarios/directed/run_suite.py --managed test_background_embed_failure_warning` - passed.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `rg -n "void embeddingProvider" src/mcp` - no matches.

## Known Stubs

None. Stub scan found only normal empty collection initializers and existing TODO comments unrelated to this plan; no placeholder behavior was introduced.

## Threat Flags

None. The plan touched existing MCP write and scenario surfaces only; no new production network endpoint, auth path, file access boundary, or schema boundary was introduced.

## User Setup Required

None. Integration and directed verification used existing `.env.test` credentials.

## Next Phase Readiness

REQ-003 MCP call-site migration is complete. Plans 146-03 and 146-04 can continue retry/diagnostic and pooled SQL work on top of the same pending embedding target metadata.

## Self-Check: PASSED

- Created file verified: `tests/scenarios/directed/testcases/test_background_embed_failure_warning.py`.
- Modified files verified: `src/mcp/tools/memory.ts`, `src/mcp/tools/documents.ts`, `src/mcp/tools/compound.ts`, `src/mcp/tools/records.ts`, `src/mcp/utils/document-output.ts`, `tests/integration/embedding/background-embed-doc-memory-record.test.ts`, and `tests/scenarios/directed/DIRECTED_COVERAGE.md`.
- Task commits verified: `0d2eb57`, `f76ce7c`, `34a5cf9`, `7e350c6`, `e46f89e`.

---
*Phase: 146-embedding-reliability-foundation*
*Completed: 2026-05-24*
