---
phase: 123-document-read-standard-output-migration
plan: 04
subsystem: mcp
tags: [list-vault, json-output, mcp-protocol, scenario-coverage, vitest]

requires:
  - phase: 123-document-read-standard-output-migration
    provides: get/archive/copy/move JSON output contracts from plans 01-03
provides:
  - list_vault structured JSON envelope with path, counts, truncation, and entries
  - include-gated list_vault metadata and tracking payloads without null filler
  - list_vault unit, integration, E2E, directed, and YAML integration coverage closure
affects: [document-tools, filesystem-tools, scenario-coverage, e2e-protocol]

tech-stack:
  added: []
  patterns:
    - list/query tools return named JSON envelopes with counts and entries
    - optional list payloads are gated through include arrays and omitted when unavailable

key-files:
  created:
    - tests/unit/list-vault.test.ts
    - tests/integration/list-vault.integration.test.ts
    - .planning/phases/123-document-read-standard-output-migration/123-04-SUMMARY.md
  modified:
    - src/mcp/tools/files.ts
    - src/mcp/tool-metadata.ts
    - tests/unit/files-tools.test.ts
    - tests/unit/tool-metadata.test.ts
    - tests/e2e/protocol.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - tests/scenarios/integration/tests/list_vault_show_modes.yml
    - tests/scenarios/integration/tests/list_vault_extension_filter_with_directories.yml
    - tests/scenarios/integration/tests/list_vault_format_modes.yml
    - tests/scenarios/integration/tests/list_vault_table_file_size.yml

key-decisions:
  - "Kept list_vault path/show/recursive/extensions/date/limit behavior intact while replacing only the output contract."
  - "Returned expected list_vault path/date/include failures as canonical JSON with isError:false."
  - "Added E2E fixture row cleanup because stale Supabase rows can poison path-based list_vault tracking enrichment."

patterns-established:
  - "list_vault entries always include name, path, type, modified, and structured size."
  - "Untracked list_vault files omit tracking fields entirely instead of emitting null placeholders."

requirements-completed: [DOC-05]

duration: 17min
completed: 2026-05-12
---

# Phase 123 Plan 04: list_vault Structured JSON Output Summary

**list_vault now returns parseable JSON entries with include-gated metadata/tracking fields and full five-layer coverage**

## Performance

- **Duration:** 17 min
- **Started:** 2026-05-12T00:57:19Z
- **Completed:** 2026-05-12T01:14:07Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- Replaced `list_vault` markdown table/detailed output with `{ path, total, displayed, truncated, entries }`.
- Added `include: ["metadata", "tracking"]` support, with directory `created`/`children` and tracked-file `title`/`tags`/`status`/`fq_id`.
- Preserved show modes, recursion, extension filters, dotfile hiding, date filters, limit/truncation, and sorting behavior.
- Added focused unit, Supabase-backed integration, MCP protocol E2E, directed coverage, and YAML integration scenario coverage.

## Task Commits

1. **Task 1 RED: list_vault JSON contract tests** - `f3eb4e6` (test)
2. **Task 1 GREEN: list_vault structured JSON envelope** - `8f5213f` (feat)
3. **Task 2: list_vault integration and E2E JSON coverage** - `f05953c` (test)
4. **Task 3: list_vault scenario JSON coverage** - `4cfaf9d` (test)

## Files Created/Modified

- `tests/unit/list-vault.test.ts` - Structured envelope, include gating, invalid include, empty entries, and no-null-filler unit coverage.
- `src/mcp/tools/files.ts` - Migrated `list_vault` schema and response assembly to JSON.
- `src/mcp/tool-metadata.ts` - Updated authoritative `list_vault` description/example for entries and include vocabulary.
- `tests/unit/files-tools.test.ts` - Updated legacy list_vault unit assertions to parse JSON.
- `tests/unit/tool-metadata.test.ts` - Added list_vault metadata description coverage.
- `tests/integration/list-vault.integration.test.ts` - Real filesystem/DB handler coverage for show modes, extension filtering, hidden dot entries, and tracking enrichment.
- `tests/e2e/protocol.test.ts` - Added list_vault MCP JSON parse round-trip and fixture DB cleanup.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Added D-list-vault structured output rows.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Updated IF-11/IF-12/IF-15/IF-16 to structured JSON entries.
- `tests/scenarios/integration/tests/list_vault_*.yml` - Replaced format/table expectations with JSON path assertions.

## Decisions Made

- Directory entries always return `size: { entries: childCount }`; `include:["metadata"]` adds the duplicate-friendly `children` field plus `created`.
- Tracked file fields are emitted only when `include:["tracking"]` is requested and a DB row exists.
- The existing `format` parameter was removed from the registered schema; old direct-handler tests were updated instead of preserving a compatibility branch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated stale legacy list_vault unit assertions**
- **Found during:** Task 1 verification.
- **Issue:** `tests/unit/files-tools.test.ts` still asserted table/prose output and expected `isError:true` for list_vault expected errors.
- **Fix:** Migrated those assertions to parse JSON envelopes and check `isError:false` for expected list errors.
- **Files modified:** `tests/unit/files-tools.test.ts`
- **Verification:** `npm test -- tests/unit/list-vault.test.ts tests/unit/tool-metadata.test.ts tests/unit/files-tools.test.ts` passed, 52 tests.
- **Committed in:** `8f5213f`

**2. [Rule 3 - Blocking] Cleaned E2E fixture DB rows before protocol tests**
- **Found during:** Task 2 E2E verification.
- **Issue:** Stale `fqc_documents` rows for the shared E2E instance could cause path-based `list_vault` tracking enrichment and copy/move retrieval assertions to see old IDs.
- **Fix:** Added setup/teardown cleanup for `e2e-shutdown-test` rows and vault files in `tests/e2e/protocol.test.ts`.
- **Files modified:** `tests/e2e/protocol.test.ts`
- **Verification:** `npm run test:e2e -- tests/e2e/protocol.test.ts` passed, 17 tests.
- **Committed in:** `f05953c`

---

**Total deviations:** 2 auto-fixed (Rule 1: 1, Rule 3: 1)
**Impact on plan:** Both changes were required to keep the existing test suite and E2E fixture deterministic after the list_vault output migration.

## Issues Encountered

- Task 2’s TDD RED gate could not fail after Task 1 because the production behavior already satisfied the newly added integration tests. Coverage was still added and verified.
- Supabase integration startup still logs the known handled attempt to drop absent `fqc_documents.description`; the integration command passed.

## User Setup Required

None - no external service configuration required beyond the existing `.env.test` credentials used for integration and E2E tests.

## Verification

- `npm test -- tests/unit/list-vault.test.ts tests/unit/tool-metadata.test.ts` - passed, 20 tests.
- `npm run test:integration -- tests/integration/list-vault.integration.test.ts` - passed, 3 tests.
- `npm run test:e2e -- tests/e2e/protocol.test.ts` - passed, 17 tests.
- `python3 tests/scenarios/integration/run_integration.py --managed list_vault_show_modes list_vault_extension_filter_with_directories list_vault_format_modes list_vault_table_file_size` - passed, 4/4 workflows.
- `npm run build` - passed.
- Acceptance greps for D-list-vault rows, structured/JSON/entries integration coverage, and absence of active legacy format/table expectations passed.

## Known Stubs

None.

## Threat Flags

None.

## TDD Gate Compliance

- Task 1 completed RED (`f3eb4e6`) and GREEN (`8f5213f`) commits.
- Task 2 was marked TDD in the plan, but its new integration/E2E tests passed immediately because Task 1 had already implemented the list_vault JSON behavior. This is documented as a gate-sequencing limitation rather than skipped coverage.
- Task 3 was non-TDD and completed as scenario coverage commit `4cfaf9d`.

## Next Phase Readiness

Phase 124 can assume all Phase 123 read/list/archive/copy/move tools now return parseable JSON for expected user-facing paths and have five-layer coverage evidence.

## Self-Check: PASSED

- Verified created/modified files exist on disk.
- Verified task commits exist in git history: `f3eb4e6`, `8f5213f`, `f05953c`, `4cfaf9d`.

---
*Phase: 123-document-read-standard-output-migration*
*Completed: 2026-05-12*
