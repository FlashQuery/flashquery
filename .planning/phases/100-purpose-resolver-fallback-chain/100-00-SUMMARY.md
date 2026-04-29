---
phase: 100
plan: "00"
subsystem: llm
tags: [tdd, red-tests, llm, fallback-chain, purpose-resolver, error-classification]
dependency_graph:
  requires: [99-llm-completions-client]
  provides: [100-01-PLAN, 100-02-PLAN]
  affects: [tests/unit/llm-client.test.ts, tests/unit/llm-resolver.test.ts]
tech_stack:
  added: []
  patterns: [vitest-fake-timers, ts-expect-error-directive, red-green-refactor]
key_files:
  created:
    - tests/unit/llm-resolver.test.ts
  modified:
    - tests/unit/llm-client.test.ts
decisions:
  - "Used spec.headers ?? {} in _makeRequester closure and _nextResponse.headers ?? {} in 4 ad-hoc spy requesters — both patterns correct for their scope"
  - "Used @ts-expect-error directives on LlmHttpError/LlmNetworkError imports in llm-client.test.ts and on PurposeResolver/LlmFallbackError import in llm-resolver.test.ts — Plan 100-01 and 100-02 must remove these after implementing the classes"
  - "U-37 RED failure is an unhandled rejection (LlmNetworkError is undefined so toBeInstanceOf throws) — this is acceptable RED state for Wave 0"
metrics:
  duration: "8 minutes"
  completed_date: "2026-04-29T02:22:34Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 100 Plan 00: RED-state TDD Scaffolds for Purpose Resolver and Fallback Chain

## One-Liner

Wave 0 RED tests for LlmHttpError/LlmNetworkError class identity (U-29..U-38 in llm-client.test.ts) and PurposeResolver/LlmFallbackError behavior (U-39..U-62 in llm-resolver.test.ts — all failing with module-not-found).

## What Was Built

Two test files extended/created to lock the Phase 100 contract before any implementation exists:

**Task 1:** Extended `tests/unit/llm-client.test.ts` with 10 RED tests (U-29..U-38):
- Import block: Added `LlmHttpError` and `LlmNetworkError` with `// @ts-expect-error` directives
- Extended `MockResponseSpec` interface with `headers?: Record<string, string>` field
- Updated 5 requester sites to propagate headers from spec/`_nextResponse`
- Added `describe('LlmHttpError', ...)` with U-29 (class identity + name/status/retryAfterMs), U-30 (retryAfterMs=5000), U-31 (arbitrary status code)
- Added `describe('LlmNetworkError', ...)` with U-32 (class identity + name), U-33 (cause field preservation)
- Added U-34..U-38 inside existing `describe('OpenAICompatibleLlmClient.complete', ...)`: typed throws on 401/429+Retry-After/500, timeout path, ECONNREFUSED path

**Task 2:** Created new `tests/unit/llm-resolver.test.ts` with 24 RED tests (U-39..U-62):
- `describe('LlmFallbackError', ...)` — U-39..U-41: class identity, message format, attempts ordering, error type preservation
- `describe('PurposeResolver.completeByPurpose', ...)` — U-42..U-57: first-model success, transient fallback (5xx/network), permanent halt (400/401/403), 429 delay timing with fake timers (U-48/49/50), all-models exhaustion, param merge precedence (LLM-03), edge cases
- `describe('PurposeResolver.getModelForPurpose', ...)` — U-58..U-62: first-model lookup, null on empty/unknown/broken model reference

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 3dbdd45 | test(100-00): RED tests U-29..U-38 for LlmHttpError/LlmNetworkError |
| Task 2 | 3f3fd7e | test(100-00): RED test scaffolds U-39..U-62 for PurposeResolver and LlmFallbackError |

## MockResponseSpec Extension Details

`tests/unit/llm-client.test.ts` headers propagation locations:
- Line 88 (in `_makeRequester()` closure): `headers: spec.headers ?? {} as Record<string, string>` — reads from `spec` variable in scope
- Lines 244, 360, 390, 423 (ad-hoc spy requesters in U-16, U-24, U-24-https, U-25): `headers: _nextResponse.headers ?? {} as Record<string, string>` — reads from module-level `_nextResponse`

## TypeScript Directives for Plan 100-01 and 100-02 to Remove

In `tests/unit/llm-client.test.ts` (lines 3-6):
```typescript
// @ts-expect-error -- Plan 100-01 will export LlmHttpError from client.ts
LlmHttpError,
// @ts-expect-error -- Plan 100-01 will export LlmNetworkError from client.ts
LlmNetworkError,
```

In `tests/unit/llm-resolver.test.ts` (line 2):
```typescript
// @ts-expect-error -- src/llm/resolver.ts will be created in Plan 100-02
import { PurposeResolver, LlmFallbackError } from '../../src/llm/resolver.js';
```

## RED Failure Messages Observed

### llm-client.test.ts (U-29..U-38)
- U-29, U-30, U-31: `TypeError: LlmHttpError is not a constructor`
- U-32, U-33: `TypeError: LlmNetworkError is not a constructor`
- U-34: `AssertionError: The instanceof assertion needs a constructor but undefined was given`
- U-35: `AssertionError: expected Error: LLM error: openai rate limit excee... to match object { status: 429, retryAfterMs: 7000 }`
- U-36: `AssertionError: expected Error: LLM error: openai API returned 500... to match object { status: 500 }`
- U-37: Unhandled Rejection — `AssertionError: The instanceof assertion needs a constructor but undefined was given` (LlmNetworkError is undefined)
- U-38: `AssertionError: The instanceof assertion needs a constructor but undefined was given`

### llm-resolver.test.ts (U-39..U-62)
- All 24 tests: `Error: Cannot find module '/src/llm/resolver.js'` — module import fails at file level, preventing any test from running

When Plan 100-01 exports `LlmHttpError` and `LlmNetworkError`, U-29..U-38 client tests should turn GREEN. When Plan 100-02 creates `src/llm/resolver.ts`, the resolver tests should turn GREEN.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this is a test-only plan. No implementation stubs.

## Self-Check

### Files Exist
- `tests/unit/llm-client.test.ts` — modified (pre-existing)
- `tests/unit/llm-resolver.test.ts` — created

### Commits Exist
- 3dbdd45 — verified (git log)
- 3f3fd7e — verified (git log)

## Self-Check: PASSED
