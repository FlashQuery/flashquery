---
phase: 155
slug: per-file-tier-1-live-defect-close
status: passed
verified_at: 2026-05-26T16:08:00Z
---

# Phase 155 Verification

## Requirements Covered

- REQ-001: document write call sites no longer use the coarse `documents` lock; document and compound mutations route through per-file helpers.
- REQ-009: new document lock facade provides bounded same-process Tier 1 striping plus temporary legacy Tier 2 pass-through.
- REQ-010: concurrent document mutation evidence is covered by static call-site guards and directed scenarios.
- REQ-025: macro execution remains macro-lock-free and relies on per-step document tool locking.

## Fresh Command Evidence

- `npm test -- tests/unit/document-lock-registry.test.ts tests/unit/with-document-lock.test.ts tests/unit/lock-helper-only.test.ts tests/unit/document-tool-lock-call-sites.test.ts tests/unit/macro-no-lock-imports.test.ts tests/unit/scanner.test.ts tests/unit/write-document.test.ts tests/unit/archive-document.test.ts tests/unit/remove-document.test.ts tests/unit/copy-document.test.ts tests/unit/move-document.test.ts tests/unit/advanced-document-tools.test.ts tests/unit/apply-tags.test.ts`
  - Passed: 13 files, 121 tests.
- `npm test`
  - Passed: 155 files, 2052 tests.
- `npm run typecheck`
  - Passed.
- `npm run build`
  - Passed: ESM and DTS builds completed.
- `python3 -m py_compile tests/scenarios/directed/testcases/test_per_file_lock_parallel.py tests/scenarios/directed/testcases/test_apply_tags_no_lost_update.py tests/scenarios/directed/testcases/test_parallel_macros_per_file_lock.py`
  - Passed.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_per_file_lock_parallel.py test_apply_tags_no_lost_update.py test_parallel_macros_per_file_lock.py`
  - Passed: 3 tests, 0 failures, 0 residue, 1m 11.5s.
  - Report: `tests/scenarios/directed/reports/scenario-report-2026-05-26-131113.md`.

## Notes

- `.env.test` credentials were available and used by the managed directed scenario suite.
- The broad Vitest integration selector attempted earlier in plan 155-02 was inconclusive due repeated unrelated rebuild behavior and is not counted as passing evidence. The directed scenarios provide the public Supabase-backed UAT evidence for this phase.
