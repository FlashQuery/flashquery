---
phase: 89-test-helper-cleanup-final-integration
plan: "01"
subsystem: tests/unit
tags: [test-fix, v2.8, unit-tests, record-tools, pending-review]
dependency_graph:
  requires: [88-05]
  provides: [clean-unit-test-baseline-v2.8]
  affects: [tests/unit/record-tools.test.ts, tests/unit/pending-plugin-review.test.ts]
tech_stack:
  added: []
  patterns: [mock-call-signature-matching, uuid-validation-awareness]
key_files:
  created: []
  modified:
    - tests/unit/record-tools.test.ts
    - tests/unit/pending-plugin-review.test.ts
decisions:
  - "Use expect.any(String) for databaseUrl 3rd arg in reconcilePluginDocuments mock — avoids coupling test to specific URL value from makeConfig()"
  - "Replace 'some-uuid-1'/'some-uuid-2' with aaaaaaaa-0000-... format to pass UUID_RE guard in pending-review.ts"
  - "Pass { instance: { id: 'test-instance' } } so fqcInstanceId resolves to a defined string instead of undefined"
metrics:
  duration: "4 minutes"
  completed_date: "2026-04-21"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 2
---

# Phase 89 Plan 01: Unit Test Regression Fixes Summary

Fix two v2.8-attributable unit test regressions so the unit test baseline is clean for subsequent waves.

## Tasks Completed

| # | Task | Commit | Result |
|---|------|--------|--------|
| 0 | Delete discovery-coordinator.test.ts if present | (no-op) | File already absent — D-08 satisfied |
| 1 | Fix record-tools.test.ts — 3-arg reconcilePluginDocuments expectation | e3128c4 | PASS |
| 2 | Fix pending-plugin-review.test.ts — config.instance.id + valid UUIDs | 8c2bb33 | PASS |

## What Was Done

**Task 0 (D-08 check):** `tests/unit/discovery-coordinator.test.ts` was already absent. No action needed.

**Task 1 (record-tools.test.ts):** `src/mcp/tools/records.ts` was updated in Phase 86 (WR-02 fix) to call `reconcilePluginDocuments(plugin_id, instanceName, config.supabase.databaseUrl)` with a third argument. The existing test asserted a 2-arg call, causing a mismatch. Changed `toHaveBeenCalledWith('crm', 'default')` to `toHaveBeenCalledWith('crm', 'default', expect.any(String))`.

**Task 2 (pending-plugin-review.test.ts):** Two root causes:
1. `setupTool()` passed `{} as FlashQueryConfig` — `config.instance?.id` evaluated to `undefined`, so the `.eq('instance_id', undefined)` filter was applied but the UUID validation at lines 43-47 of `pending-review.ts` rejected `'some-uuid-1'` format IDs before reaching the delete branch.
2. Test fqc_ids `'some-uuid-1'`/`'some-uuid-2'` failed the `UUID_RE` guard (`/^[0-9a-f]{8}-[0-9a-f]{4}-...$/i`), returning an early error response instead of calling `delete()`.

Fixes applied: passed `{ instance: { id: 'test-instance' } }` to `registerPendingReviewTools`, replaced test UUIDs with `aaaaaaaa-0000-0000-0000-000000000001` / `aaaaaaaa-0000-0000-0000-000000000002`, and updated the `chain.in` assertion to match.

## Test Results

```
Test Files  2 passed (2)
      Tests  47 passed (47)
   Duration  569ms
```

Both files pass with 0 failures. The 20 pre-existing deferred failures in other test files are unaffected.

## Deviations from Plan

**1. [Rule 1 - Bug] Also updated chain.in assertion in clear mode test**
- **Found during:** Task 2
- **Issue:** After changing fqc_ids values from `'some-uuid-1'` to proper UUID format, the `expect(chain.in).toHaveBeenCalledWith('fqc_id', ['some-uuid-1', 'some-uuid-2'])` assertion would fail with a mismatch
- **Fix:** Updated assertion to use the new UUID values `['aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002']`
- **Files modified:** tests/unit/pending-plugin-review.test.ts
- **Commit:** 8c2bb33 (included in Task 2 commit)

## Known Stubs

None.

## Threat Flags

None — test-only changes; no production code modified; no new security surface.

## Self-Check: PASSED

- tests/unit/record-tools.test.ts: modified and committed ✓
- tests/unit/pending-plugin-review.test.ts: modified and committed ✓
- Commit e3128c4 exists ✓
- Commit 8c2bb33 exists ✓
- grep criteria both match ✓
- 47/47 tests pass ✓
