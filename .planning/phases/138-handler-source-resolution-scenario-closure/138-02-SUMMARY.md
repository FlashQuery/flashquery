---
phase: 138-handler-source-resolution-scenario-closure
plan: 02
subsystem: macro
tags: [macro, call_macro, source_ref, document-resolver, integration]
requires:
  - phase: 138-handler-source-resolution-scenario-closure
    provides: Plan 01 handler schema and invalid source selector validation
provides:
  - Production call_macro source_ref document resolution
  - Archived macro-library docs collapsed to canonical not_found
  - Shared inline/source_ref runMacroSource execution path
  - T-I-005 through T-I-008 source_ref integration coverage
affects: [macro-handler, source-ref-resolution, phase-138-plan-03, phase-138-plan-04]
tech-stack:
  added: []
  patterns:
    - source_ref materializes through resolveDocumentIdentifier before macro parsing/evaluation
    - fqm fence extraction and named-block selection happen before runMacroSource
    - inline and source_ref calls share runMacroSource for dry-run, trace, progress, budget, and task behavior
key-files:
  created:
    - tests/integration/macro-source-ref.integration.test.ts
    - .planning/phases/138-handler-source-resolution-scenario-closure/138-02-SUMMARY.md
  modified:
    - src/mcp/tools/macro.ts
    - src/macro/errors.ts
    - tests/unit/macro-handler.test.ts
    - tests/config/vitest.integration.config.ts
key-decisions:
  - "Resolved source_ref through resolveDocumentIdentifier and only touched supabaseManager lazily for valid source_ref requests so inline handler tests remain independent of Supabase initialization."
  - "Added sourceIdentifier to runMacroSource so resolved source_ref blocks use the same execution path while preserving source_ref identity for parse errors and task previews."
  - "Skipped T-I-006 with an explicit note because the inherited local resolver currently has no per-caller read ACL that can produce permission_denied."
patterns-established:
  - "Handler source resolution returns either concrete source plus identifier or a canonical ToolResult error before parse/evaluation."
  - "Integration source_ref tests use the public MCP handler with InMemoryTransport and the real document resolver."
requirements-completed: [MACRO-SRC-01, MACRO-SRC-02, MACRO-SRC-03, MACRO-SRC-04]
duration: 8min
completed: 2026-05-15
---

# Phase 138 Plan 02: Source Ref Resolution Summary

**call_macro source_ref document resolution with archived-doc hiding and named fqm block execution through the shared macro engine**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-15T03:50:08Z
- **Completed:** 2026-05-15T03:58:16Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Replaced the temporary valid `source_ref` unsupported branch with `resolveMacroSourceForRequest`.
- Routed `source_ref` through `resolveDocumentIdentifier`, `gray-matter`, `extractMacroFences`, and `selectMacroSourceBlock`.
- Preserved inline/source_ref parity by passing resolved source into `runMacroSource` with existing dry-run, trace, progress, budget, task, registry, catalog, broker, and template metadata options.
- Added source_ref integration coverage for non-existent docs, archived docs, named-block execution, and invalid multi-block selector errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add a shared source resolver in the macro handler** - `49aabcc` (feat)
2. **Task 2: Route source_ref through the existing execution path** - `97caeb6` (test)
3. **Task 3: Add source_ref integration coverage** - `e558744` (test)

**Plan metadata:** pending final docs commit.

## Files Created/Modified

- `src/mcp/tools/macro.ts` - Adds source_ref materialization, archived-doc handling, resolver error mapping, and sourceIdentifier threading into `runMacroSource`.
- `src/macro/errors.ts` - Adds `ambiguous_source_ref` to the macro invalid-input reason union.
- `tests/unit/macro-handler.test.ts` - Adds T-U-224 coverage proving resolved source_ref uses the same dry-run/task path as inline source.
- `tests/integration/macro-source-ref.integration.test.ts` - Adds T-I-005 through T-I-008 public handler coverage.
- `tests/config/vitest.integration.config.ts` - Registers the new source_ref integration suite.

## Decisions Made

- Source references resolve through FlashQuery's standard document resolver; the macro handler does not manually join untrusted paths.
- Archived source_ref documents return `not_found` based on either `status: archived` or `fq_status: archived`.
- The permission-denied integration row stays skipped until the inherited resolver has a local ACL path that can produce `permission_denied`.

## Verification

- `npm test -- --reporter=verbose macro-handler macro-source-ref macro-fence-extractor` - passed, 33 tests.
- `npm test -- --reporter=verbose macro-handler macro-envelopes macro-budget macro-progress` - passed, 36 tests.
- `npm run test:integration -- --reporter=verbose macro-source-ref` - initially failed on a new success-result assertion, then passed with 4 passed / 1 skipped.
- `npm test -- --reporter=verbose macro-handler macro-source-ref macro-fence-extractor macro-envelopes macro-budget macro-progress` - passed, 58 tests.
- `npm run test:integration -- --reporter=verbose macro-source-ref` - passed, 4 passed / 1 skipped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Avoided Supabase initialization for preflight-only handler paths**
- **Found during:** Task 1 (Add a shared source resolver in the macro handler)
- **Issue:** The first handler refactor fetched `supabaseManager.getClient()` before validation completed, which broke inline and invalid source_ref unit tests when Supabase was not initialized.
- **Fix:** Made Supabase client acquisition lazy inside `resolveMacroSourceForRequest` and only required it after source/source_ref exclusivity and source_ref selector validation pass.
- **Files modified:** `src/mcp/tools/macro.ts`
- **Verification:** `npm test -- --reporter=verbose macro-handler macro-source-ref macro-fence-extractor`
- **Committed in:** `49aabcc`

---

**Total deviations:** 1 auto-fixed (Rule 1).
**Impact on plan:** Narrow correctness fix required to preserve existing inline handler behavior; no scope expansion.

## Issues Encountered

- Task 3's first integration run failed because the new test asserted `isError === false` on a successful ToolResult. Successful responses omit `isError`; the assertion was corrected to `toBeFalsy()`.
- Integration setup still logs the pre-existing harmless schema migration message about dropping a missing `fqc_documents.description` column; the focused tests pass.

## TDD Gate Compliance

Task 3 was marked `tdd="true"`. The new integration tests produced a RED run first, but the failure was an assertion bug in the new test rather than missing production behavior because Task 1 had already implemented the source_ref resolver. The final Task 3 commit is test-only; no separate GREEN implementation commit was needed for this task.

## Known Stubs

None. `T-I-006` is an intentional skipped test documenting an inherited resolver limitation, not a product stub.

## User Setup Required

None - no new external service configuration required. Integration coverage uses the existing `.env.test` Supabase setup and skips the entire suite through existing `HAS_SUPABASE` behavior when unavailable.

## Next Phase Readiness

Plan 03 can build write-lock inheritance and E2E transport coverage on top of a real public `source_ref` handler path.

## Self-Check: PASSED

- Key files exist: `src/mcp/tools/macro.ts`, `src/macro/errors.ts`, `tests/unit/macro-handler.test.ts`, `tests/integration/macro-source-ref.integration.test.ts`, `tests/config/vitest.integration.config.ts`.
- Task commits exist: `49aabcc`, `97caeb6`, and `e558744`.
- No accidental tracked file deletions were found after task commits.

---
*Phase: 138-handler-source-resolution-scenario-closure*
*Completed: 2026-05-15*
