---
phase: 166-embedding-pipeline
plan: 04
subsystem: embedding
tags: [embedding-pipeline, plugins, pgvector, records, directed-scenarios]
requires:
  - phase: 165-foundation-infrastructure
    provides: Core embedding catalog, per-entry DDL/RPC helpers, stamping, and provider guards
  - phase: 166-embedding-pipeline
    provides: Per-entry write path, pending queue, rate limiting, and catalog-aware search
provides:
  - Plugin manifest `embedding` parsing and `register_plugin.embedding_name` override validation
  - Frozen plugin registration `embedding_name` resolution and legacy migration
  - Plugin-table per-entry column sets and `match_records_<table>_<name>` RPCs
  - Plugin `write_record` and `search_records` routing through a single resolved entry
  - Directed and integration coverage for plugin registration, DDL, record writes/search, re-registration, and legacy migration
affects: [167-lifecycle-operations-and-validation, plugin-embedding, records]
tech-stack:
  added: []
  patterns:
    - Plugin embedding choice is stored on `fqc_plugin_registry.embedding_name` with `embedding_resolved_at`
    - Plugin record embedding uses `createEmbeddingProviderForCatalogEntry` and per-entry stamped columns
    - Legacy plugin migration runs at `initPlugins` only for rows missing `embedding_resolved_at`
key-files:
  created:
    - tests/unit/plugin-manifest-embedding.test.ts
    - tests/unit/register-plugin-embedding-param.test.ts
    - tests/integration/plugin-embedding-columns.test.ts
    - tests/integration/plugin-record-embedding-helpers.ts
    - tests/integration/plugin-write-record-embed.test.ts
    - tests/integration/plugin-search-records-semantic.test.ts
    - tests/integration/plugin-legacy-registration-migration.test.ts
    - tests/scenarios/directed/testcases/plugin_embedding_scenario_helpers.py
    - tests/scenarios/directed/testcases/test_plugin_registration_resolution.py
    - tests/scenarios/directed/testcases/test_plugin_registration_specific_not_found.py
    - tests/scenarios/directed/testcases/test_plugin_registration_deactivated.py
    - tests/scenarios/directed/testcases/test_plugin_re_register_switch_entry.py
  modified:
    - src/plugins/manager.ts
    - src/mcp/tools/plugins.ts
    - src/mcp/tools/records.ts
    - src/storage/supabase.ts
    - tests/config/vitest.integration.config.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
key-decisions:
  - "Stored `embedding_resolved_at` distinguishes intentional null choices from legacy rows needing first-startup migration."
  - "Plugin table DDL creates only the resolved entry's column set/RPC; additional catalog entries require explicit re-registration."
  - "Opted-out or inactive plugin embeddings fall through to existing ILIKE/filter behavior in `search_records`."
patterns-established:
  - "Plugin per-entry DDL mirrors core entry column naming while scoping RPC names to full plugin table names."
  - "Directed plugin embedding scenarios use managed catalog config and public MCP registration envelopes."
requirements-completed: [REQ-006, REQ-008, REQ-021, REQ-028, REQ-029, REQ-030, REQ-031, REQ-032, REQ-033, REQ-034]
duration: 55min
completed: 2026-06-11
---

# Phase 166 Plan 04: Plugin-Table Integration Summary

**Plugin embedding registration with frozen per-plugin catalog choice, per-entry plugin table storage/RPCs, and single-entry record write/search routing**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-06-11T08:35:00Z
- **Completed:** 2026-06-11T09:31:00Z
- **Tasks:** 5 completed
- **Files modified:** 18

## Accomplishments

- Added plugin manifest `embedding` parsing for omitted/null, `"*"`, and specific names, plus strict invalid-type rejection.
- Added `register_plugin.embedding_name` override validation and registration-time resolution with `invalid_input`, `not_found`, `unsupported`, and `ambiguous_identifier` envelopes.
- Persisted frozen plugin embedding choices on `fqc_plugin_registry` and migrated legacy rows on startup without touching legacy singular `embedding` columns.
- Added plugin-table per-entry column sets, HNSW indexes, and `match_records_<plugin_table>_<name>` RPCs for the resolved entry only.
- Updated plugin `write_record` and `search_records` to use one resolved active entry or fall back cleanly when opted out.
- Added unit, integration, and directed scenario coverage for T-U-030 through T-U-035, T-I-061 through T-I-069, and D-100 through D-103.

## Task Commits

1. **Task 1: Parse manifest embedding and register_plugin override** - `2f918ba` (feat)
2. **Task 2: Resolve and freeze plugin embedding choice at registration** - `59f3973` (feat)
3. **Task 3: Add plugin table column sets and per-table RPCs** - `36fd0fe` (test)
4. **Task 4: Wire write_record and search_records to the plugin's chosen entry** - `c53fca7` (feat)
5. **Task 5: Implement re-registration and legacy registration migration** - `5b9d9f7` (test)

**Plan metadata:** included in the final docs commit.

## Files Created/Modified

- `src/plugins/manager.ts` - Parses manifest embedding intent, builds plugin per-entry table DDL, loads frozen choices, and migrates legacy registrations.
- `src/mcp/tools/plugins.ts` - Adds register override schema, resolution rules, frozen persistence, and plugin table DDL/RPC wiring.
- `src/mcp/tools/records.ts` - Routes plugin writes/searches through the active frozen entry or text fallback.
- `src/storage/supabase.ts` - Adds registry columns and plugin record RPC/column-set DDL helpers.
- `tests/config/vitest.integration.config.ts` - Includes plan-level plugin integration test filenames.
- `tests/unit/*.test.ts`, `tests/integration/plugin-*.test.ts`, `tests/scenarios/directed/testcases/test_plugin_*.py` - Adds planned coverage.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Adds D-100 through D-103 rows.

## Decisions Made

- Used `embedding_resolved_at` as the migration sentinel so a newly registered `null` choice is not later treated as a legacy row.
- Kept `search_records` single-entry only; no RRF was added for plugin records.
- Chose fallback behavior for inactive frozen entries in `write_record`/`search_records`: no embed call, no deferred warning, ILIKE/filter search path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Included plan plugin test files in Vitest integration config**
- **Found during:** Task 3 verification
- **Issue:** `npm run test:integration -- tests/integration/plugin-embedding-columns.test.ts` found no tests because root-level `plugin-*.test.ts` files were not in the integration include list.
- **Fix:** Added `tests/integration/plugin-*.test.ts` to `tests/config/vitest.integration.config.ts`.
- **Files modified:** `tests/config/vitest.integration.config.ts`
- **Verification:** Full plan integration verification passed.
- **Committed in:** `36fd0fe`

**2. [Rule 1 - Bug] Fixed `search_records` stale variable reference**
- **Found during:** Task 4 verification
- **Issue:** `search_records` referenced `resolved.entry` after destructuring only `fullTableName` and `tableSpec`, producing `resolved is not defined`.
- **Fix:** Destructured `entry` and passed it to `resolvePluginActiveEmbedding`.
- **Files modified:** `src/mcp/tools/records.ts`
- **Verification:** Plugin write/search integration tests and full plan integration verification passed.
- **Committed in:** `c53fca7`

**3. [Rule 3 - Blocking] Used local directed runner positional patterns**
- **Found during:** Task 2 verification
- **Issue:** The directed runner does not support the plan's documented `--pattern` flag.
- **Fix:** Ran equivalent positional patterns: `"test_plugin_registration_*"` and `"test_plugin_re_register_switch_entry"`.
- **Files modified:** None.
- **Verification:** Both directed suites passed.
- **Committed in:** N/A

**4. [Rule 3 - Blocking] Rebuilt `dist` before directed scenarios**
- **Found during:** Task 2 verification
- **Issue:** The directed runner's build freshness check only compared `src/index.ts`, so it initially ran stale `dist` code after plugin-source changes.
- **Fix:** Ran `npm run build` explicitly before rerunning directed scenarios.
- **Files modified:** Generated `dist/` output only.
- **Verification:** Directed registration scenarios passed after rebuild.
- **Committed in:** N/A

---

**Total deviations:** 4 auto-fixed (1 bug, 3 blocking).
**Impact on plan:** All fixes were required to verify and ship the planned behavior; no feature scope was added beyond plugin embedding integration.

## Issues Encountered

- `gsd-sdk query state.load` produced no output, consistent with earlier Phase 166 summaries. State, roadmap, and requirements tracking were updated manually.
- The full integration verification is slow because each file runs the integration build setup and exercises real Supabase DDL/RPC operations.

## Verification

- `npm run test:unit -- tests/unit/plugin-manifest-embedding.test.ts tests/unit/register-plugin-embedding-param.test.ts` - PASSED (2 files, 7 tests)
- `npm run test:integration -- tests/integration/plugin-embedding-columns.test.ts` - PASSED (1 file, 3 tests)
- `npm run test:integration -- tests/integration/plugin-write-record-embed.test.ts tests/integration/plugin-search-records-semantic.test.ts` - PASSED (2 files, 4 tests)
- `python3 tests/scenarios/directed/run_suite.py --managed "test_plugin_registration_*"` - PASSED (3 scenarios)
- `python3 tests/scenarios/directed/run_suite.py --managed "test_plugin_re_register_switch_entry"` - PASSED (1 scenario)
- `npm run test:integration -- tests/integration/plugin-legacy-registration-migration.test.ts` - PASSED (1 file, 3 tests)
- `npm run test:integration -- tests/integration/plugin-embedding-columns.test.ts tests/integration/plugin-write-record-embed.test.ts tests/integration/plugin-search-records-semantic.test.ts tests/integration/plugin-legacy-registration-migration.test.ts` - PASSED (4 files, 10 tests)
- `npm run typecheck` - PASSED

## User Setup Required

None - no new external service configuration required beyond the existing `.env.test` used for verification.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: plugin_manifest_embedding | `src/plugins/manager.ts` | Plugin-authored manifest metadata now controls whether plugin tables receive embedding storage; strict validation rejects malformed values. |
| threat_flag: plugin_registration_embedding_override | `src/mcp/tools/plugins.ts` | MCP operator input controls the frozen catalog entry used by plugin tables; invalid, unknown, ambiguous, and deactivated names are refused before DDL. |
| threat_flag: plugin_record_embedding_provider | `src/mcp/tools/records.ts` | Plugin record fields can be sent to the resolved embedding provider; only configured `embed_fields` are used and content is not logged. |
| threat_flag: plugin_table_vector_rpc | `src/storage/supabase.ts` | Plugin-owned tables now receive per-entry vector columns, HNSW indexes, and match RPCs for registered entries. |

## Next Phase Readiness

Phase 167 can now implement lifecycle operations knowing plugin conflicts, records-scope embedding resolution, plugin-table RPCs, and legacy plugin registration migration are present. Phase 166 is complete.

## Self-Check: PASSED

- Summary file created at `.planning/phases/166-embedding-pipeline/166-04-SUMMARY.md`.
- Task commits exist: `2f918ba`, `59f3973`, `36fd0fe`, `c53fca7`, `5b9d9f7`.
- Created test files exist.
- No unexpected tracked file deletions detected in task commits.

---
*Phase: 166-embedding-pipeline*
*Completed: 2026-06-11*
