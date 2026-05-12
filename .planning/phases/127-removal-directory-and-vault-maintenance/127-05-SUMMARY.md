---
phase: 127-removal-directory-and-vault-maintenance
plan: 05
subsystem: testing
tags: [mcp-protocol, directed-scenarios, yaml-integration, remove-document, manage-directory, maintain-vault]

requires:
  - phase: 127-removal-directory-and-vault-maintenance
    provides: final remove_document, manage_directory, maintain_vault implementations and prior Phase 127 traceability
provides:
  - MCP protocol round trips for final Phase 127 removal, directory, and maintenance tools
  - Directed scenario coverage for removal/directory/maintenance public workflows
  - YAML integration scenario coverage using final tool names and maintain_vault helper support
  - Local host exposure guard excluding Phase 127 replaced tool names from public listTools
affects: [phase-127, protocol-tests, directed-scenarios, integration-scenarios, host-tool-exposure]

tech-stack:
  added: []
  patterns:
    - Final MCP tool coverage parses JSON responses from content[0].text
    - New Phase 127 scenarios use remove_document, manage_directory, and maintain_vault only
    - YAML integration actions can bind direct write_document responses for destructive setup without cleanup residue

key-files:
  created:
    - tests/scenarios/directed/testcases/test_removal_directory_maintenance.py
    - tests/scenarios/integration/tests/removal_directory_maintenance.yml
    - .planning/phases/127-removal-directory-and-vault-maintenance/127-05-SUMMARY.md
  modified:
    - src/mcp/tool-exposure.ts
    - tests/e2e/protocol.test.ts
    - tests/scenarios/directed/DIRECTED_COVERAGE.md
    - tests/scenarios/integration/INTEGRATION_COVERAGE.md
    - tests/scenarios/integration/README.md
    - tests/scenarios/integration/run_integration.py
    - tests/scenarios/framework/fqc_test_utils.py
    - .planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md

key-decisions:
  - "Phase 127 local host exposure hides create_directory, remove_directory, force_file_scan, and reconcile_documents while broader global legacy cleanup remains deferred to Phase 128."
  - "The YAML removal scenario creates the intentionally removed document through direct write_document so cleanup does not try to archive a physically removed file."

patterns-established:
  - "Scenario coverage ledgers should be updated with final tool IDs before adding runnable Phase 127 cases."
  - "Expected per-item MCP errors remain JSON payload assertions with outer runtime success when the tool contract says isError:false."

requirements-completed: [DOC-09, SYS-01, SYS-02, SYS-03]

duration: 30min
completed: 2026-05-12
---

# Phase 127 Plan 05: Protocol And Scenario Coverage Summary

**Final Phase 127 removal, directory, and vault maintenance tools now have MCP protocol, directed scenario, and YAML integration coverage using public final tool names.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-05-12T20:27:49Z
- **Completed:** 2026-05-12T20:58:05Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added MCP protocol coverage proving `remove_document`, `manage_directory`, and `maintain_vault` round-trip JSON contracts and local legacy absence from host `listTools`.
- Added directed coverage rows and a managed scenario for remove, directory, and maintenance high-risk behavior using final tool names only.
- Added YAML integration coverage, runner/helper support, and documentation for final `maintain_vault` workflows.
- Updated Phase 127 traceability for DOC-09, SYS-01, SYS-02, and SYS-03.

## Task Commits

1. **Task 1 RED: Add failing protocol coverage** - `78223a0` (test)
2. **Task 1 GREEN: Close protocol coverage** - `cf26eeb` (fix)
3. **Task 2: Add directed scenario coverage and testcase** - `9426e8b` (test)
4. **Task 3: Add YAML integration scenario and maintain_vault helper** - `ebce2fb` (test)

## Files Created/Modified

- `src/mcp/tool-exposure.ts` - Excludes Phase 127 locally replaced tool names from host-selectable exposure.
- `tests/e2e/protocol.test.ts` - Adds MCP round trips and listTools assertions for final Phase 127 tools.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Adds D-rdoc, D-mdir, and D-mvault coverage rows.
- `tests/scenarios/directed/testcases/test_removal_directory_maintenance.py` - Adds managed directed scenario for final public workflows.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Adds INT-rdoc, INT-mdir, and INT-mvault coverage rows.
- `tests/scenarios/integration/README.md` - Documents final `maintain_vault` YAML action usage.
- `tests/scenarios/integration/run_integration.py` - Adds direct `maintain_vault` action mapping and `write_document` variable extraction.
- `tests/scenarios/framework/fqc_test_utils.py` - Adds `TestContext.maintain_vault` helper.
- `tests/scenarios/integration/tests/removal_directory_maintenance.yml` - Adds final YAML workflow for removal, directory lifecycle, and maintenance.
- `.planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md` - Links E2E, directed, and integration scenario evidence.

## Decisions Made

- Local host exposure now hides `create_directory`, `remove_directory`, `force_file_scan`, and `reconcile_documents` for Phase 127 final protocol coverage, while global removal remains Phase 128 work.
- The YAML integration scenario uses direct `write_document` for the document that `remove_document` physically deletes, avoiding cleanup attempts against an intentionally removed file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added host exposure exclusion for replaced local tools**
- **Found during:** Task 1 (Add MCP protocol coverage)
- **Issue:** The plan required local `listTools` absence for `create_directory`, `remove_directory`, `force_file_scan`, and `reconcile_documents`, but the host exposure layer still selected those names.
- **Fix:** Added a Phase 127 replaced-tool exclusion set in `src/mcp/tool-exposure.ts`.
- **Files modified:** `src/mcp/tool-exposure.ts`, `tests/e2e/protocol.test.ts`
- **Verification:** `npm run test:e2e -- tests/e2e/protocol.test.ts` passed with 25 tests.
- **Committed in:** `cf26eeb`

**2. [Rule 3 - Blocking] Added YAML direct write_document extraction**
- **Found during:** Task 3 (Add YAML integration scenario and maintain_vault action helper)
- **Issue:** The YAML scenario needed to create a document for physical removal without registering it for cleanup, but direct `write_document` responses were not bindable for later `${remove_doc.fq_id}` references.
- **Fix:** Added `write_document` extraction fields in `tests/scenarios/integration/run_integration.py` and used direct `write_document` for the removal fixture.
- **Files modified:** `tests/scenarios/integration/run_integration.py`, `tests/scenarios/integration/tests/removal_directory_maintenance.yml`
- **Verification:** `python3 tests/scenarios/integration/run_integration.py --managed removal_directory_maintenance` passed with 17/17 steps.
- **Committed in:** `ebce2fb`

---

**Total deviations:** 2 auto-fixed (Rule 2: 1, Rule 3: 1).
**Impact on plan:** Both fixes were required to satisfy planned acceptance criteria and keep scenario cleanup deterministic; no architectural changes were introduced.

## TDD Gate Compliance

- Task 1 has explicit RED commit `78223a0` followed by GREEN commit `cf26eeb`.
- Tasks 2 and 3 added scenario coverage in task-scoped test commits after inspecting the existing runner/framework contracts.
- Refactor phase not needed.

## Known Stubs

None. Stub scan found only existing assertion literals, empty-string initialization, and historical coverage prose; no placeholder behavior blocks this plan.

## Threat Flags

None. The host tool exposure change is covered by planned threat `T-127-05-02`.

## Issues Encountered

- The first YAML integration run failed because `list_vault` structured directory entries do not include trailing slashes, and the removed fixture had been auto-registered for cleanup. The scenario now asserts structured paths and avoids cleanup tracking for intentionally deleted files.

## User Setup Required

None - existing `.env.test` credentials were sufficient.

## Verification

- `npm run test:e2e -- tests/e2e/protocol.test.ts` - passed, 25 tests.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup removal_directory_maintenance` - passed, 37/37 steps, 0 residue.
- `python3 tests/scenarios/integration/run_integration.py --managed removal_directory_maintenance` - passed, 17/17 steps.

## Next Phase Readiness

Phase 127 final tools now have protocol and scenario evidence. Phase 128 can handle broader delegated/global legacy cleanup without needing additional Phase 127 workflow coverage.

## Self-Check: PASSED

- Verified created files exist: `tests/scenarios/directed/testcases/test_removal_directory_maintenance.py`, `tests/scenarios/integration/tests/removal_directory_maintenance.yml`, and this summary.
- Verified task commits exist in git history: `78223a0`, `cf26eeb`, `9426e8b`, and `ebce2fb`.
- Verified final focused E2E, directed, and YAML integration commands passed.

---
*Phase: 127-removal-directory-and-vault-maintenance*
*Completed: 2026-05-12*
