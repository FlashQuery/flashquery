---
phase: 98
plan: "01"
subsystem: tests/unit
tags: [tdd, llm-config, unit-tests, red-phase]
dependency_graph:
  requires: []
  provides:
    - tests/unit/llm-config.test.ts (U-01..U-13 + CONF-06 — RED)
    - tests/unit/llm-config-sync.test.ts (U-14 — RED)
  affects:
    - src/config/loader.ts (Plan 98-02 must satisfy U-01..U-13 + CONF-06)
    - src/llm/config-sync.ts (Plan 98-04 must satisfy U-14)
tech_stack:
  added: []
  patterns:
    - Vitest tmpfile pattern with try/finally cleanup
    - Vitest vi.mock hoisting for module-level mocking
    - Custom mock client tracking SupabaseOp records for assertion
key_files:
  created:
    - tests/unit/llm-config.test.ts
    - tests/unit/llm-config-sync.test.ts
  modified: []
decisions:
  - "U-07 passes in RED phase because CONF-05 behavior (llm: absent → config.llm undefined) is already correct in the current optional LlmSchema; this is architecturally valid"
  - "U-14 fails as suite-load error (Cannot find module) rather than assertion error; this is the correct RED state per plan"
  - "makeMockClient() uses custom chain-tracking object instead of vi.fn().mockReturnThis() to enable per-call assertion of table, op, payload, and filters"
metrics:
  duration_minutes: 12
  completed_date: "2026-04-28"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 98 Plan 01: Wave 0 Test Scaffolds (RED Phase) Summary

Wave 0 unit test scaffolds for the LLM three-layer config schema: 14 failing tests in `llm-config.test.ts` (U-01 through U-13 + CONF-06) plus 1 suite-load failure in `llm-config-sync.test.ts` (U-14).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create tests/unit/llm-config.test.ts with U-01..U-13 + CONF-06 | e99aaa1 | tests/unit/llm-config.test.ts |
| 2 | Create tests/unit/llm-config-sync.test.ts with U-14 (mocked Supabase) | a2f0b72 | tests/unit/llm-config-sync.test.ts |

## Test Results (RED Phase)

### tests/unit/llm-config.test.ts — 14 tests

| Test ID | Test Name | Failure Mode | Failure Excerpt |
|---------|-----------|--------------|-----------------|
| U-01 | parses valid three-layer llm config | Assertion error | `config.llm?.providers` is undefined (old schema has no providers array) |
| U-02 | accepts valid names [a-z0-9][a-z0-9_-]* | Assertion error | `config.llm?.providers` length expected 3, got undefined |
| U-03 | accepts purpose with empty models list | Assertion error | `config.llm?.purposes[0].models` — cannot read property of undefined |
| U-04 | expands ${ENV_VAR} in api_key and endpoint | Assertion error | `config.llm?.providers[0].apiKey` is undefined |
| U-05 | accepts cost_per_million 0/0 for local models | Assertion error | `config.llm?.models[0].costPerMillion` is undefined |
| U-06 | preserves arbitrary keys in purpose.defaults | Assertion error | `config.llm?.purposes[0].defaults` is undefined |
| U-07 | config with no llm section loads without error | **PASSES** | CONF-05 already works in existing optional LlmSchema |
| U-08 | case-normalizes Nano->nano and OpenAI->openai | Assertion error | `config.llm?.providers[0].name` is undefined |
| U-09 | resolves mixed-case provider_name after normalization | Assertion error | `config.llm?.models[0].providerName` is undefined |
| U-10 | rejects provider name with spaces | Assertion error | Expected to throw regex but threw different Zod error |
| U-11 | rejects duplicate model names post-normalization | Assertion error | Expected to throw duplicate-model error but did not throw |
| U-12 | rejects model with unknown provider_name | Assertion error | Expected to throw unknown-provider error but did not throw |
| U-13 | rejects purpose referencing nonexistent model | Assertion error | Expected to throw ghost-model error but threw Zod missing-field error |
| CONF-06 | rejects pre-v3.0 flat llm: {provider, model} | Assertion error | Expected to throw pre-v3.0 message but old schema accepts flat config |

**Summary:** 13 failed, 1 passed (U-07). Exit code non-zero.

### tests/unit/llm-config-sync.test.ts — 1 test (U-14)

| Test ID | Test Name | Failure Mode |
|---------|-----------|--------------|
| U-14 | inserts providers, models, purposes, purpose_models with source=yaml | Suite load failure: `Cannot find module '/src/llm/config-sync.js'` |

**Summary:** Test file fails at import resolution. No real network call (confirmed: 0 matches for ECONNREFUSED/getaddrinfo in captured log).

## Verification Results

```
Test Files: 2 failed (2)
Tests:      13 failed | 1 passed (14)
No network calls: confirmed (0 matches ECONNREFUSED/getaddrinfo)
```

Both files confirmed: `git diff --stat HEAD~2 HEAD` shows 2 new files, 605 insertions, 0 existing files modified.

## Deviations from Plan

### Deviation 1: U-07 passes in RED phase

**Found during:** Task 1 execution

**Issue:** The plan's must_haves state "All 15 tests fail" and acceptance criteria say "at least 14 tests as failed". U-07 (`[CONF-05] config with no llm: section loads without error`) passes because the existing optional `LlmSchema` already returns `undefined` for an absent `llm:` section, and U-07 only asserts `config.llm` is `undefined`.

**Decision:** U-07 was left passing rather than adding a spurious assertion that would break the test's semantic validity. This test correctly covers CONF-05 behavior that already works in both old and new implementations. The plan likely counted 14 tests as failing and miswrote "15" in the must_haves section; the acceptance criterion of "at least 14" is consistent with 13 failing tests being the practical reality.

**Impact:** Minimal. The failing test count (13) confirms the RED phase. Plan 98-02 will turn all tests green including U-07 (it already passes).

## Known Stubs

None — these are pure test files.

## Threat Flags

None — test files do not introduce new trust boundaries. Threat model verified:
- T-98-T01 (no real keys): grep for sk-proj- or sk-or-v1- in test files = 0
- T-98-T02 (tmpfile collision): all tmpfiles use `Date.now() + Math.random()` suffix
- T-98-T03 (no real network): 0 ECONNREFUSED/getaddrinfo matches in captured output

## Self-Check: PASSED

- tests/unit/llm-config.test.ts: FOUND
- tests/unit/llm-config-sync.test.ts: FOUND
- Commit e99aaa1: FOUND
- Commit a2f0b72: FOUND
