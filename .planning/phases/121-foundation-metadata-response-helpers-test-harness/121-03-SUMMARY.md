---
phase: 121-foundation-metadata-response-helpers-test-harness
plan: 03
subsystem: testing
tags: [frontmatter, scenario-tests, json-assertions, vitest, yaml]

requires:
  - phase: 121-foundation-metadata-response-helpers-test-harness
    provides: central metadata registry and JSON MCP response helpers from plans 01 and 02
provides:
  - frontmatter constant guardrails for consolidation-managed fields
  - directed scenario JSON parsing and JSON path assertion helpers
  - YAML integration JSON path assertion support
  - runnable foundation directed and YAML scenario coverage rows
affects: [phase-122-host-tool-exposure-config, phase-123-document-read-migration, scenario-harnesses]

tech-stack:
  added: []
  patterns:
    - shared MCP scenario JSON parsing via parse_mcp_json and get_json_path
    - additive YAML expect_json_* assertions alongside legacy substring checks
    - explicit legacy/fixture allowlist for managed frontmatter literal guard

key-files:
  created:
    - tests/scenarios/directed/testcases/test_foundation_json_response.py
    - tests/scenarios/integration/tests/foundation_json_response.yml
  modified:
    - src/constants/frontmatter-fields.ts
    - tests/unit/frontmatter-fields.test.ts
    - tests/unit/no-hardcoded-extensions.test.ts
    - tests/scenarios/framework/fqc_client.py
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/run_integration.py
    - tests/scenarios/integration/README.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md

key-decisions:
  - "Added FM.ARCHIVED_AT but deferred FM.ORIGINAL_PATH because this plan does not introduce trash recovery behavior that consumes it."
  - "The managed frontmatter literal guard uses an explicit legacy/fixture allowlist so later migration phases can shrink known debt without creating noisy false positives."
  - "Scenario JSON assertions are additive and preserve existing substring/count assertions for pre-migration tools."

patterns-established:
  - "Directed scenarios use parse_mcp_json(result) and get_json_path(payload, path) for MCP content[0].text JSON payloads."
  - "YAML integration tests can use expect_json_path, expect_json_equals, expect_json_contains, and expect_json_array_length."

requirements-completed: [FND-07, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06]

duration: 13min
completed: 2026-05-11
---

# Phase 121 Plan 03: Frontmatter And Scenario Harness Summary

**Frontmatter constants and scenario JSON assertion scaffolding now cover helper-backed MCP responses in unit, directed, and YAML integration layers.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-11T21:10:46Z
- **Completed:** 2026-05-11T21:23:00Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Added `FM.ARCHIVED_AT` and unit canaries, plus a managed `fq_*` literal guard with explicit legacy/fixture allowlists.
- Added directed scenario JSON parsing/path helpers and a runnable `test_foundation_json_response` scenario against helper-backed `get_document`.
- Added YAML `expect_json_*` assertions and a runnable `foundation_json_response.yml` workflow that verifies success, expected-error, and array JSON paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add consolidation frontmatter constants and hardcoded managed-field guard** - `94fd37b` (test)
2. **Task 2: Add directed scenario JSON assertion helper and foundation test** - `0a0847b` (test)
3. **Task 3: Add YAML integration JSON-path assertions and foundation workflow** - `12cbe3b` (test)

## Files Created/Modified

- `src/constants/frontmatter-fields.ts` - Adds `FM.ARCHIVED_AT`.
- `tests/unit/frontmatter-fields.test.ts` - Verifies the new constant and `FrontmatterFieldName` type coverage.
- `tests/unit/no-hardcoded-extensions.test.ts` - Adds managed frontmatter literal scanning with an explicit allowlist.
- `tests/scenarios/framework/fqc_client.py` - Adds `parse_mcp_json`, `get_json_path`, and JSON expectation helpers.
- `tests/scenarios/directed/testcases/test_foundation_json_response.py` - Runnable directed scenario for helper-backed JSON success and expected-error responses.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Adds Phase 121 foundation directed rows.
- `tests/scenarios/integration/run_integration.py` - Adds YAML `expect_json_*` assertion evaluation and expected-value variable substitution.
- `tests/scenarios/integration/tests/foundation_json_response.yml` - Runnable YAML workflow for JSON path assertions.
- `tests/scenarios/integration/README.md` and `INTEGRATION_COVERAGE.md` - Document and track the new JSON assertion workflow.

## Decisions Made

- Deferred `ORIGINAL_PATH`; adding it before a consumer exists would create premature API surface.
- Kept existing scenario text assertions intact because most legacy MCP tools have not migrated to JSON yet.
- Used `get_document` as the representative helper-backed tool because Plan 02 already migrated success and expected-error paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added variable substitution for YAML expected JSON values**
- **Found during:** Task 3 (YAML integration JSON-path assertions)
- **Issue:** The runner substituted `${name.field}` references in assert arguments but not in `expect_json_equals.value`, causing the foundation YAML workflow to compare against the literal string `${foundation_doc.path}`.
- **Fix:** Substituted the full assert spec before assertion evaluation.
- **Files modified:** `tests/scenarios/integration/run_integration.py`
- **Verification:** `python3 tests/scenarios/integration/run_integration.py --managed foundation` passed.
- **Committed in:** `12cbe3b`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** The fix was required for correct YAML assertion behavior and did not broaden the feature scope.

## Issues Encountered

- The shell does not provide a `python` executable, so scenario verification used `python3`. The plan-equivalent invocations passed with `python3`.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub-pattern scan found no placeholder, TODO, FIXME, or empty UI/data stubs in files created or modified by this plan.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema trust boundaries were introduced.

## Verification

- `npm test -- tests/unit/frontmatter-fields.test.ts tests/unit/no-hardcoded-extensions.test.ts` - passed, 5 tests
- `python3 tests/scenarios/directed/run_suite.py --managed foundation` - passed, 1 directed scenario
- `python3 tests/scenarios/integration/run_integration.py --managed foundation` - passed, 1 YAML integration workflow
- `npm run build` - passed

## Next Phase Readiness

Phase 122 and later migration phases can now rely on central frontmatter constants and scenario-level JSON path assertions when migrating tool outputs. The directed and YAML foundation workflows provide copyable patterns for success, expected-error, and batch/array response assertions.

## Self-Check: PASSED

- Verified created files exist on disk: `tests/scenarios/directed/testcases/test_foundation_json_response.py`, `tests/scenarios/integration/tests/foundation_json_response.yml`.
- Verified modified foundation files contain required markers: `FM.ARCHIVED_AT`, `parse_mcp_json`, `expect_json_path`, `D-foundation-json-1`, and `INT-foundation-json-1`.
- Verified task commits exist in git history: `94fd37b`, `0a0847b`, `12cbe3b`.

---
*Phase: 121-foundation-metadata-response-helpers-test-harness*
*Completed: 2026-05-11*
