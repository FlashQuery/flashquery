---
phase: 159-lock-timeout-canonical-key-derivation
status: passed
verified: 2026-05-27T00:30:39Z
requirements: [REQ-003, REQ-006]
---

# Phase 159 Verification

Phase 159 achieved its goal: contended document writes now have bounded lock acquisition with `lock_timeout` conflict envelopes, and document lock keys derive from canonical file or directory identities instead of raw vault-relative strings.

## Goal-Backward Verdict

| Requirement | Status | Evidence |
|-------------|--------|----------|
| REQ-003 | Passed | `src/services/document-lock.ts` canonicalizes lock entries through vault-root resolution, `realpath` for existing paths, `realpath(parent)+basename` for missing destinations, case-insensitive vault folding, and `file:` / `dir:` namespaces. `tests/unit/lock-key-derivation.test.ts` covers symlink, relative-path, destination, case-fold, and namespace behavior. |
| REQ-006 | Passed | `lock_timeout_seconds` is parsed into config with a 10s default, Tier 1 and Tier 2 acquisition use bounded deadlines, Tier 2 polls `pg_try_advisory_lock`, and document tools surface expected `details.reason: "lock_timeout"` conflicts. |

## Must-Haves

| Truth | Status | Evidence |
|-------|--------|----------|
| Existing-path aliases share one lock identity | Passed | Unit coverage derives equal keys for realpath-equivalent and symlinked paths. |
| Missing destination paths key by canonical parent plus basename | Passed | Unit coverage derives destination keys without requiring the file to exist. |
| Case-insensitive vaults fold path case before hashing | Passed | Unit coverage uses the testing cache hook to force case-insensitive behavior and verify equal keys. |
| File and directory resources are separated | Passed | Unit coverage verifies `file:` and `dir:` namespaces are distinct. |
| Lock acquisition is bounded | Passed | Unit coverage verifies default and configured timeout behavior, Tier 2 uses `pg_try_advisory_lock`, and Tier 1 timeout handles are cleared/unref'd. |
| Public document tools return `lock_timeout` envelopes | Passed | Unit coverage spans write/copy/move/archive/remove/compound call sites and batch item envelopes. |
| Update-mode writes never write a freshly re-resolved path under the stale path lock | Passed | Code review finding CR-01 was fixed by retrying when the locked candidate path and fresh resolved path differ; source-shape regression coverage asserts the guard. |
| Directed case-variant scenario is covered where the environment supports it | Passed | `test_case_variant_path_locking` passed under the managed directed runner using `.env.test`; residue check reported 0. |

## Verification Commands

- `npm test -- tests/unit/document-tool-lock-call-sites.test.ts tests/unit/with-document-lock.test.ts tests/unit/document-lock-tier2.test.ts tests/unit/lock-timeout.test.ts tests/unit/write-document.test.ts` — passed: 5 files, 20 tests.
- `npm test -- tests/unit/document-tool-lock-call-sites.test.ts` — passed: 1 file, 5 tests.
- `npm test` — passed: 167 files, 2086 tests.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `npm run test:integration -- tests/integration/lock-timeout.integration.test.ts --testNamePattern "lock-timeout"` — exited 0; 1 file / 2 tests skipped because the `.env.test` database URL is the Supabase transaction pooler on port 6543, which is not session-capable for advisory-lock assertions.
- `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_case_variant_path_locking` — passed: 1 test, 1 pass, 0 failures, 0 residue. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-26-212943.md`.

## Notes

- A broad `npm run test:e2e` attempt earlier hit a suite-level readiness timeout in `tests/e2e/authorize-flow.e2e.test.ts`; rerunning that file directly passed 8/8. The timeout was treated as transient and not counted as Phase 159 evidence.
- The Phase 159 code review initially found two issues; both are resolved in `159-REVIEW.md` with fresh unit/type/build evidence.

## Result

No gaps found. Phase 159 is ready to be marked complete.
