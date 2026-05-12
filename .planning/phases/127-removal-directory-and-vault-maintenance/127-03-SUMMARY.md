---
phase: 127-removal-directory-and-vault-maintenance
plan: 03
subsystem: mcp
tags: [vault-maintenance, scanner, mcp-tools, background-jobs, json-contracts, tdd]

requires:
  - phase: 127-removal-directory-and-vault-maintenance
    provides: Phase 127 shared response helpers, metadata, and traceability foundation
provides:
  - Final `maintain_vault(action)` MCP handler
  - Process-local maintenance service with sync, repair, status, background job, conflict, and shutdown behavior
  - Dry-run frontmatter repair counts without mutation
  - Unit and integration coverage for SYS-03
affects: [maintain-vault, scanner, force-file-scan, reconcile-documents, phase-127]

tech-stack:
  added: []
  patterns:
    - Process-local service state for administrative background jobs
    - JSON expected-error mapping for maintenance validation, not_found, and conflict cases
    - Status-boundary tests that reject scanner-internal fields

key-files:
  created:
    - src/services/maintenance.ts
    - tests/unit/maintain-vault.test.ts
    - tests/integration/maintain-vault.integration.test.ts
    - .planning/phases/127-removal-directory-and-vault-maintenance/127-03-SUMMARY.md
  modified:
    - src/services/scanner.ts
    - src/mcp/tools/scan.ts
    - tests/unit/scanner.test.ts
    - .planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md

key-decisions:
  - "Implemented `maintain_vault` background status as process-local service state, matching the v1 durability contract."
  - "Mapped sync counts from scanner outcomes while intentionally omitting embedding and hash internals from public payloads."
  - "Kept shutdown starts as runtime errors while invalid modes, unknown jobs, and conflicts use JSON expected-error semantics."

patterns-established:
  - "Maintenance conflicts return canonical `conflict` with `details.reason: maintenance_in_progress`."
  - "Background maintenance exposes only `accepted`, `job_id`, `started_at`, then job-level status."

requirements-completed: [SYS-03]

duration: 9m26s
completed: 2026-05-12
---

# Phase 127 Plan 03: Maintain Vault Summary

**Final `maintain_vault` admin surface with sync, repair, dry-run, background status, conflict, and shutdown semantics.**

## Performance

- **Duration:** 9m26s
- **Started:** 2026-05-12T19:59:37Z
- **Completed:** 2026-05-12T20:09:03Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added `src/services/maintenance.ts` as the process-local action/job service for `maintain_vault`.
- Replaced active `force_file_scan` registration in `src/mcp/tools/scan.ts` with final `maintain_vault`.
- Extended `repairFrontmatter` to return structured counts and support `dryRun`.
- Added unit and integration coverage for sync, repair, combined ordering, dry-run validation, background status, unknown jobs, conflict, shutdown rejection, and forbidden scanner fields.
- Updated Phase 127 traceability for SYS-03 evidence.

## Task Commits

1. **Task 1 RED: Add failing maintain_vault service tests** - `6dc5905` (test)
2. **Task 1 GREEN: Implement maintain_vault service contract** - `0ce4d56` (feat)
3. **Task 2 RED: Add failing maintain_vault handler tests** - `b375159` (test)
4. **Task 2 GREEN: Register maintain_vault handler** - `c5666c1` (feat)
5. **Task 3: Add maintain_vault integration coverage and traceability** - `e899b70` (test)

## Files Created/Modified

- `src/services/maintenance.ts` - Process-local maintenance action normalization, execution, background job status, conflict, and shutdown handling.
- `src/services/scanner.ts` - Adds `FrontmatterRepairResult`, `FrontmatterRepairOptions`, and dry-run count behavior for repair.
- `src/mcp/tools/scan.ts` - Registers `maintain_vault` and maps service responses to JSON MCP results.
- `tests/unit/maintain-vault.test.ts` - Covers service and handler contracts.
- `tests/unit/scanner.test.ts` - Ports MCP scan tool assertions to `maintain_vault`.
- `tests/integration/maintain-vault.integration.test.ts` - Real handler/vault/Supabase coverage for SYS-03.
- `.planning/phases/127-removal-directory-and-vault-maintenance/TRACEABILITY.md` - Marks SYS-03 implemented evidence.

## Decisions Made

- Used an in-memory job map for background sync status; unknown IDs return canonical `not_found`.
- Counted sync `updated` as hash mismatches plus moved files and `archived` as deleted/missing tracking, while excluding `embeddingStatus`, `embedsAwaited`, hashes, and queue state.
- Kept `force_file_scan` absent from active scan registration in this plan; broader legacy-surface absence audits remain Phase 128.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended maintain_vault integration hook timeout**
- **Found during:** Task 3
- **Issue:** Supabase/vault initialization exceeded Vitest's default 10s hook timeout before assertions ran.
- **Fix:** Set the integration suite `beforeAll` timeout to 30s.
- **Files modified:** `tests/integration/maintain-vault.integration.test.ts`
- **Verification:** `npm run test:integration -- tests/integration/maintain-vault.integration.test.ts tests/integration/shutdown.integration.test.ts` passed.
- **Committed in:** `e899b70`

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** No scope expansion; the timeout matches the existing integration setup cost.

## TDD Gate Compliance

- RED commit present for Task 1: `6dc5905`.
- GREEN commit present for Task 1: `0ce4d56`.
- RED commit present for Task 2: `b375159`.
- GREEN commit present for Task 2: `c5666c1`.
- Task 3 added integration and traceability coverage in one test commit: `e899b70`.
- Refactor phase not needed.

## Known Stubs

None. Stub scan found only normal empty-array/object initialization plus pre-existing TODO comments in lower-level scanner tests unrelated to this plan.

## Issues Encountered

- Integration runs emit pre-existing DDL log noise about dropping a missing `description` column on `fqc_documents`; the focused integration suite passed.

## User Setup Required

None - existing `.env.test` credentials were sufficient.

## Verification

- `npm test -- tests/unit/maintain-vault.test.ts tests/unit/scanner.test.ts tests/unit/shutdown.test.ts` - passed, 79 tests.
- `npm run test:integration -- tests/integration/maintain-vault.integration.test.ts tests/integration/shutdown.integration.test.ts` - passed, 11 tests.
- `npm run build` - passed.

## Next Phase Readiness

Plan 127-04 can implement `remove_document` against the established Phase 127 helper and maintenance patterns. E2E and scenario coverage for `maintain_vault` remain named for later Phase 127 plans.

## Self-Check: PASSED

- Verified created/modified key files exist.
- Verified task commits exist in git history.
- Verified focused unit, integration, and build commands passed.

---
*Phase: 127-removal-directory-and-vault-maintenance*
*Completed: 2026-05-12*
