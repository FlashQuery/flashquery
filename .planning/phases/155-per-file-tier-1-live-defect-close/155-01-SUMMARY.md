---
phase: 155-per-file-tier-1-live-defect-close
plan: 01
subsystem: services
tags: [document-lock, async-mutex, scanner, write-lock]
requires: []
provides:
  - Phase-155 document lock facade with bounded same-process stripes
  - Scanner frontmatter repair writes routed through the facade
  - Unit/static coverage for helper behavior and facade export surface
affects: [document-tools, compound-tools, scanner]
tech-stack:
  added: []
  patterns:
    - Bounded Tier 1 async-mutex stripes plus temporary legacy Tier 2 pass-through
key-files:
  created:
    - src/services/document-lock.ts
    - tests/unit/document-lock-registry.test.ts
    - tests/unit/with-document-lock.test.ts
    - tests/unit/lock-helper-only.test.ts
  modified:
    - src/services/scanner.ts
key-decisions:
  - "Phase 155 accepts already validated absolute paths as basic lock keys; full realpath/case-folding remains Phase 159."
  - "Legacy fqc_write_locks use remains a temporary Tier 2 pass-through inside src/services/document-lock.ts for document writes."
patterns-established:
  - "Use withDocumentLock(config, absolutePath, fn) for one document write."
  - "Use withDocumentLocks(config, absolutePaths, fn) for multi-document write sections; acquisition sorts by basic key."
requirements-completed: [REQ-001, REQ-009]
duration: 20 min
completed: 2026-05-26
---

# Phase 155 Plan 01: Document Lock Facade Summary

**Bounded per-file document lock facade with scanner frontmatter repair routed through the same coordination point**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-26T15:23:00Z
- **Completed:** 2026-05-26T15:43:29Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `withDocumentLock` and `withDocumentLocks` as the Phase-155 public document write lock facade.
- Implemented a bounded 1024-stripe Tier 1 registry using `async-mutex`.
- Kept legacy `acquireLock` / `releaseLock` isolated inside the new facade for temporary document Tier 2 pass-through.
- Routed scanner `repairFrontmatter` read/write/hash-update repair work through `withDocumentLock`.

## Task Commits

1. **Task 155-01-01: Add document-lock facade unit coverage** - `cd8fdba`, `deb9899` (test)
2. **Task 155-01-02: Implement document-lock facade** - `d6077bd` (feat)
3. **Task 155-01-03: Route scanner frontmatter repair through the facade** - `cf2c9d3` (feat)

## Files Created/Modified

- `src/services/document-lock.ts` - Phase-155 facade with bounded stripes, sorted multi-lock acquisition, and legacy table pass-through.
- `src/services/scanner.ts` - Wraps frontmatter repair writes with `withDocumentLock`.
- `tests/unit/document-lock-registry.test.ts` - T-U-001/T-U-002 coverage plus Phase-155 key scaffolding assertion.
- `tests/unit/with-document-lock.test.ts` - T-U-016/T-U-017/T-U-018 helper behavior coverage.
- `tests/unit/lock-helper-only.test.ts` - T-U-019 facade export-surface guard.

## Decisions Made

- Phase 155 rejects relative helper inputs instead of trying to canonicalize raw caller strings; callers must pass already validated absolute paths.
- The 1024-stripe registry intentionally bounds memory while accepting rare false sharing until the later canonical key phase.
- `LockTimeoutError` is exported as the only public error type needed by callers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Narrowed T-U-019 to the Phase-155 facade export contract**
- **Found during:** Task 155-01-01
- **Issue:** The initial static test flagged unrelated records, memory, plugin, and files lock usage that Phase 155 does not migrate.
- **Fix:** Changed the test to verify `document-lock.ts` exports only `LockTimeoutError`, `withDocumentLock`, and `withDocumentLocks`, with no exported low-level acquire/release primitives.
- **Files modified:** `tests/unit/lock-helper-only.test.ts`
- **Verification:** `npm test -- tests/unit/document-lock-registry.test.ts tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts tests/unit/scanner.test.ts`
- **Committed in:** `deb9899`

---

**Total deviations:** 1 auto-fixed (scope correction).
**Impact on plan:** No behavior scope change; static coverage now matches the Phase 155 boundary and leaves document/compound call-site migration to Plan 155-02.

## Issues Encountered

The plan's sample `npm test -- --grep ...` command is not supported by this Vitest CLI. Targeted verification used explicit test file paths instead.

## Verification

- `npm test -- tests/unit/document-lock-registry.test.ts tests/unit/with-document-lock.test.ts` — passed.
- `npm test -- tests/unit/document-lock-registry.test.ts tests/unit/with-document-lock.test.ts tests/unit/scanner.test.ts` — passed.
- `npm test -- tests/unit/document-lock-registry.test.ts tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts tests/unit/scanner.test.ts` — passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 155-02. Document and compound tools can now replace coarse `'documents'` locking with the new facade.

---
*Phase: 155-per-file-tier-1-live-defect-close*
*Completed: 2026-05-26*
