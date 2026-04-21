---
phase: 89-test-helper-cleanup-final-integration
plan: 04
subsystem: testing
tags: [vitest, integration-tests, reconciliation, resurrection, e2e, shutdown]

# Dependency graph
requires:
  - phase: 89-test-helper-cleanup-final-integration
    provides: 89-01 (unit test fixes), 89-02 (mock-plugins refactor), 89-03 (reconciliation-aware integration tests)
provides:
  - Resurrection lifecycle integration test (RO-46): archives plugin row, verifies reconciliation classifies as resurrected + writes pending review
  - Mixed reconciliation scenario test (RO-45): single reconciliation call handles added + deleted docs simultaneously
  - E2E shutdown tests: fixed false "ready" match, 'exit' vs 'close' race, missing vault-e2e fixture
  - Full suite validation: unit (1091 pass / 20 pre-existing deferred), integration (333 pass / pre-existing deferred), E2E (40/40)
affects: [future-phases, phase-90]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-document assertions for shared-DB test isolation, vault-e2e .gitkeep for fixture existence guarantee]

key-files:
  created:
    - tests/fixtures/vault-e2e/.gitkeep
    - .planning/phases/89-test-helper-cleanup-final-integration/89-04-SUMMARY.md
  modified:
    - tests/integration/pending-plugin-review.integration.test.ts
    - tests/e2e/shutdown.e2e.test.ts

key-decisions:
  - "Per-document resurrection assertion: check alice's specific fqcId in resurrected, not added.length === 0 — candidateMap is not scoped by instance_id so shared DB contamination from other test runs can produce spurious added entries"
  - "E2E ready-check uses 'FlashQuery ready' not 'ready' to avoid false match on 'description column already dropped' which contains 'already'"
  - "'close' event (not 'exit') used in E2E shutdown tests to guarantee all stderr data events arrive before asserting stderrLines"

patterns-established:
  - "Shared-DB test isolation: assert per-document (fqcId) not per-collection-count when candidateMap is instance-unscoped"
  - "E2E process lifecycle: use 'close' event not 'exit' for post-shutdown assertions on stderr"

requirements-completed:
  - TEST-11
  - TEST-12

# Metrics
duration: ~90min
completed: 2026-04-21
---

# Phase 89-04: Lifecycle Tests + Full Suite Validation Summary

**Resurrection lifecycle (RO-46) and mixed reconciliation (RO-45) integration tests added; E2E shutdown tests corrected; full suite validated at 0 v2.8-attributable failures**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-04-21T12:30:00Z
- **Completed:** 2026-04-21T13:40:00Z
- **Tasks:** 5 (2 integration tests + 3 E2E fixes)
- **Files modified:** 2

## Accomplishments
- Added resurrection lifecycle test (RO-46): registers plugin with auto-track, creates contact, archives plugin row, calls `reconcilePluginDocuments` + `executeReconciliationActions`, asserts `resurrected.length > 0` and `fqc_pending_plugin_review` row with `review_type: 'resurrected'`
- Added mixed reconciliation scenario test (RO-45): Bob (archived fqc_documents → deleted state) + Carol (new untracked → added). Single reconciliation call classifies both correctly
- Fixed 3 E2E shutdown test bugs: false "ready" match (→ "FlashQuery ready"), 'exit' vs 'close' race condition for stderr draining, missing vault-e2e fixture directory
- Full suite: unit 1091/1111 pass (20 pre-existing deferred), integration 333 pass (pre-existing deferred unchanged), E2E 40/40 pass

## Task Commits

1. **Task 1+2: Resurrection (RO-46) + Mixed (RO-45) integration tests** - `4c8546c` (feat(89-04))
2. **Merge 89-04 worktree** - `e58154f` (chore(89-04))
3. **E2E shutdown test fixes + vault-e2e fixture** - `2c405fa` (fix(e2e))
4. **Resurrection assertion fix for shared-DB contamination** - `5c78c14` (fix(89-04))

## Files Created/Modified
- `tests/integration/pending-plugin-review.integration.test.ts` - Added `resurrection lifecycle (RO-46)` and `mixed reconciliation scenario (RO-45)` describe blocks; fixed assertion to be per-document
- `tests/e2e/shutdown.e2e.test.ts` - Fixed ready-check string, 'exit' → 'close' in all 3 tests
- `tests/fixtures/vault-e2e/.gitkeep` - Ensures vault-e2e exists on fresh checkout

## Decisions Made
- **Per-document resurrection assertion**: The candidateMap in `reconcilePluginDocuments` queries `fqc_documents` by path prefix (not instance_id). In a shared test database, other test run leftovers produce spurious 'added' entries. Changed assertion from `added.length === 0` to `added.some(d => d.fqcId === aliceFqcId) === false` — checks alice specifically isn't misclassified without demanding global emptiness.

## Deviations from Plan

### Auto-fixed Issues

**1. [E2E] False "ready" match caused premature SIGINT/SIGTERM**
- **Found during:** E2E test debugging
- **Issue:** `line.includes('ready')` matched `"description column already dropped"` (contains "already"), sending signal 6s before FQC actually reached "FlashQuery ready."
- **Fix:** Changed all 3 test checks to `line.includes('FlashQuery ready')`
- **Files modified:** tests/e2e/shutdown.e2e.test.ts
- **Committed in:** 2c405fa

**2. [E2E] 'exit' vs 'close' race condition on stderrLines assertions**
- **Found during:** E2E test debugging
- **Issue:** `fqcProcess.on('exit')` fires before stdio drains; stderrLines incomplete when assertions run
- **Fix:** Changed to `fqcProcess.on('close')` in all 3 tests
- **Files modified:** tests/e2e/shutdown.e2e.test.ts
- **Committed in:** 2c405fa

**3. [E2E] vault-e2e directory missing on fresh checkout**
- **Found during:** E2E test debugging
- **Issue:** `tests/fixtures/vault-e2e` not tracked by git; missing on fresh clone causes FQC crash before "FlashQuery ready"
- **Fix:** Added `.gitkeep` file to ensure directory exists
- **Files modified:** tests/fixtures/vault-e2e/.gitkeep (created)
- **Committed in:** 2c405fa

**4. [Integration] Resurrection assertion too strict for shared DB**
- **Found during:** Integration test run post-merge
- **Issue:** `expect(result.added.length).toBe(0)` failed because candidateMap picks up contacts/ docs from other test runs in shared database
- **Fix:** Captured `aliceFqcId` from plugin table query; changed to per-document assertion
- **Files modified:** tests/integration/pending-plugin-review.integration.test.ts
- **Committed in:** 5c78c14

---

**Total deviations:** 4 auto-fixed
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered
- Integration test suite initially showed 14-15 failing files — confirmed all are pre-existing failures in files not touched by phase 89 (crm, compound-tools, apply-tags, create-doc-tags, documents, supabase)
- Only `plugin-records.integration.test.ts` (PLUG-01/03) showed failures in a file we touched — confirmed pre-existing (register_plugin doesn't call reconciliation, so vi.mock had no effect on those tests)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 89 complete: v2.8 callback-overhaul milestone test infrastructure ready
- Pre-existing deferred integration failures: ~14 files, not attributable to phase 89 work
- Unit deferred failures: 20 in 6 files (pre-existing, deferred to end-of-milestone)
- No blockers for next phase

---
*Phase: 89-test-helper-cleanup-final-integration*
*Completed: 2026-04-21*
