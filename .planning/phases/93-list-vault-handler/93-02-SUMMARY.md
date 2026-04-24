---
phase: 93-list-vault-handler
plan: "02"
subsystem: directed-scenario-tests
tags:
  - list_vault
  - directed-tests
  - python
  - filesystem
  - test-coverage
dependency_graph:
  requires:
    - 93-01 (list_vault handler implementation — files.ts + unit tests)
    - 92-01 (create_directory handler + test_create_directory_special.py with F-51 stub)
  provides:
    - 7 directed scenario test files covering F-08..F-11 and F-53..F-97
    - F-51 un-skipped in test_create_directory_special.py (live list_vault call)
  affects:
    - tests/scenarios/directed/testcases/test_create_directory_special.py (F-51 activated)
    - tests/scenarios/directed/testcases/test_list_vault.py (new)
    - tests/scenarios/directed/testcases/test_list_vault_directories.py (new)
    - tests/scenarios/directed/testcases/test_list_vault_all.py (new)
    - tests/scenarios/directed/testcases/test_list_vault_format.py (new)
    - tests/scenarios/directed/testcases/test_list_vault_format_detailed.py (new)
    - tests/scenarios/directed/testcases/test_list_vault_param_validation.py (new)
    - tests/scenarios/directed/testcases/test_list_vault_fs_resilience.py (new)
tech_stack:
  added: []
  patterns:
    - Canonical directed test pattern (TestContext, TestRun, run.step)
    - Root guard (os.getuid() == 0) for permission-dependent tests
    - try/finally chmod restore for T-93-09 mitigation
    - ctx.cleanup.track_dir/track_file/track_mcp_document for artifact cleanup
key_files:
  created:
    - tests/scenarios/directed/testcases/test_list_vault.py
    - tests/scenarios/directed/testcases/test_list_vault_directories.py
    - tests/scenarios/directed/testcases/test_list_vault_all.py
    - tests/scenarios/directed/testcases/test_list_vault_format.py
    - tests/scenarios/directed/testcases/test_list_vault_format_detailed.py
    - tests/scenarios/directed/testcases/test_list_vault_param_validation.py
    - tests/scenarios/directed/testcases/test_list_vault_fs_resilience.py
  modified:
    - tests/scenarios/directed/testcases/test_create_directory_special.py
decisions:
  - "F-77 (untracked file in detailed block) uses an untracked .md file written directly via ctx.vault for deterministic testing — no force_file_scan needed since list_vault reads filesystem directly"
  - "F-73 (file size column) verifies notes.md presence rather than asserting exact byte count — avoids fragility from frontmatter expansion by create_document"
  - "F-11 date filter uses after=365d for recent range (relative) and before=2000-01-01 for ancient range — matches list_vault parameter API (not date_from/date_to as in old list_files)"
metrics:
  duration: "5 minutes"
  completed: "2026-04-24T21:31:57Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 8
---

# Phase 93 Plan 02: list_vault Directed Scenario Tests Summary

**One-liner:** 7 Python directed scenario test files covering F-08 to F-97 for list_vault, plus F-51 activated in test_create_directory_special.py (dotfile invisibility integration test).

## What Was Built

**Task 1:** Replaced the F-51 skip stub in `test_create_directory_special.py` with a real test step that calls `list_vault(show="directories", path=base_dir)` and asserts `.plugin-staging/` is absent from results. Updated docstring to reflect F-51 is live.

**Task 2:** Created 7 directed scenario test files, each following the canonical pattern (TestContext, TestRun, run.step, main() CLI block):

| File | Coverage | Test Steps |
|------|----------|------------|
| test_list_vault.py | F-08..F-11, F-53, F-54, F-65..F-69, F-84..F-91 | 17 F-IDs + setup step |
| test_list_vault_directories.py | F-55..F-58, F-62..F-64, F-67 | 8 F-IDs |
| test_list_vault_all.py | F-59..F-61 | 3 F-IDs |
| test_list_vault_format.py | F-69..F-75, F-80..F-82 | 10 F-IDs |
| test_list_vault_format_detailed.py | F-76..F-79, F-83 | 5 F-IDs + setup step |
| test_list_vault_param_validation.py | F-92..F-95 | 4 F-IDs |
| test_list_vault_fs_resilience.py | F-96..F-97 | 2 F-IDs (with root guard) |

## Key Behavioral Assertions

- **F-84** (behavior change): non-existent path returns `isError: true` — validated with `not result.ok` check
- **F-86/F-88**: zero-parameter call returns vault root listing with `"in /."` summary
- **F-96/F-97**: `chmod 000` on subdirectory or file does not cause `isError` — graceful degradation validated; `try/finally` restores permissions for cleanup
- **F-58**: dot-prefixed directories not visible (`".hidden"` absent from listing)
- **F-51**: `.plugin-staging/` created by F-50 is not visible in `show="directories"` listing

## Threat Model Coverage

| T-ID | Mitigation | Status |
|------|------------|--------|
| T-93-09 | chmod restore in try/finally in F-96/F-97 steps | Implemented |
| T-93-10 | os.getuid() == 0 root guard at top of run_test() | Implemented |
| T-93-11 | ctx.cleanup.track_dir(base_dir) in all 8 files | Implemented |

## Deviations from Plan

None — plan executed exactly as written. All 7 files created with correct COVERAGE lists, canonical structure, and F-ID step labels.

## Test Results (unit — no regressions)

```
Test Files  62 passed (62)
     Tests  1198 passed (1198)  [baseline maintained]
  Duration  ~6.5s
```

Directed scenario tests require a live FQC server and cannot be run in this CI context. Syntax verified via `python3 -m py_compile` on all 8 modified/created files.

## Known Stubs

None — all test assertions use real `result.ok`, `result.text` checks against live server responses. No placeholder data or hardcoded expected values beyond well-defined behavior guarantees (e.g., `"Showing"` in summary line, `"| Name |"` in table header).

## Threat Flags

No new threat surface — these are test files only with no production code changes.

## Self-Check: PASSED

| Item | Result |
|------|--------|
| test_list_vault.py exists | FOUND |
| test_list_vault_directories.py exists | FOUND |
| test_list_vault_all.py exists | FOUND |
| test_list_vault_format.py exists | FOUND |
| test_list_vault_format_detailed.py exists | FOUND |
| test_list_vault_param_validation.py exists | FOUND |
| test_list_vault_fs_resilience.py exists | FOUND |
| test_create_directory_special.py F-51 activated | FOUND |
| Commit 14bc63e (Task 1: F-51 un-skip) | FOUND |
| Commit 2eaab9a (Task 2: 7 test files) | FOUND |
| All 8 files compile without errors | PASSED |
| Unit tests still passing (1198/1198) | PASSED |
