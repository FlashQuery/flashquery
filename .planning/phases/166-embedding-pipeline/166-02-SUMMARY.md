---
phase: 166-embedding-pipeline
plan: 02
subsystem: embedding
tags: [embedding-pipeline, rate-limit, backoff, openai-compatible, ollama]
requires:
  - phase: 166-embedding-pipeline
    provides: Plan 01 write fan-out, per-entry pending retry, truncation, and provider metadata
provides:
  - Parsed and preserved per-endpoint rate_limit configuration
  - Per-endpoint in-process min_delay_ms throttling for OpenAI-compatible and Ollama providers
  - Same-endpoint HTTP 429 exponential backoff before fallback
  - Immediate fallback preservation for non-429 provider errors
affects: [166-embedding-pipeline, 167-lifecycle-operations-and-validation, catalog-search]
tech-stack:
  added: []
  patterns:
    - Leaf provider instances own endpoint-local throttling state
    - HTTP 429 retry is handled inside leaf providers before FallbackEmbeddingProvider sees failure
key-files:
  created:
    - tests/unit/embedding-rate-limit.test.ts
  modified:
    - src/config/types.ts
    - src/config/loader.ts
    - src/embedding/embedding-config-sync.ts
    - src/embedding/provider.ts
    - tests/unit/embedding-yaml-parser.test.ts
key-decisions:
  - "A rate_limit block enables 429 backoff; endpoints without rate_limit continue to treat HTTP errors as ordinary failures."
  - "Missing max_backoff_retries/backoff_base_ms use provider-layer defaults of 3 retries and 1000ms base delay."
  - "429 handling lives inside each leaf provider so fallback still only sees exhausted endpoint failures."
patterns-established:
  - "Rate-limit settings support both YAML/DB snake_case and runtime camelCase endpoint shapes."
  - "Exhausted 429 retries add rate_limit_events metadata before surfacing failure."
requirements-completed: [REQ-017]
duration: 9min
completed: 2026-06-11
---

# Phase 166 Plan 02: Rate Limiting + 429 Backoff Summary

**Endpoint-local throttling and 429 backoff for catalog embedding providers**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-11T07:37:00Z
- **Completed:** 2026-06-11T07:45:53Z
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments

- Extended endpoint `rate_limit` parsing and typing for `min_delay_ms`, `max_backoff_retries`, and `backoff_base_ms`.
- Added in-process per-provider-instance `min_delay_ms` throttling for OpenAI-compatible and Ollama embedding calls.
- Added same-endpoint HTTP 429 retry with exponential backoff before fallback, while preserving immediate fallback for non-429 errors.
- Added T-U-019 through T-U-022 unit coverage in `tests/unit/embedding-rate-limit.test.ts`.

## Task Commits

1. **Task 1 RED: Preserve endpoint retry config in parser tests** - `4fac6e5` (test)
2. **Task 1 GREEN: Preserve embedding endpoint rate limits** - `182c56b` (feat)
3. **Task 2 RED: Endpoint min-delay coverage** - `cafd36d` (test)
4. **Task 2 GREEN: Throttle embedding endpoints by min delay** - `302c02c` (feat)
5. **Task 3 RED: 429 backoff coverage** - `f11d101` (test)
6. **Task 3 GREEN: Retry embedding 429s before failover** - `7abc7d6` (feat)

**Plan metadata:** included in the final docs commit.

## Files Created/Modified

- `src/config/types.ts` - Adds typed rate-limit retry/backoff fields to embedding endpoint config.
- `src/config/loader.ts` - Parses optional `max_backoff_retries` and `backoff_base_ms` without requiring all rate-limit fields.
- `src/embedding/embedding-config-sync.ts` - Preserves all rate-limit fields in catalog endpoint JSON and audit change descriptions.
- `src/embedding/provider.ts` - Applies min-delay throttling and same-endpoint 429 retry/backoff in OpenAI-compatible and Ollama leaf providers.
- `tests/unit/embedding-yaml-parser.test.ts` - Verifies parser preservation for all rate-limit fields.
- `tests/unit/embedding-rate-limit.test.ts` - Adds T-U-019, T-U-020, T-U-021, and T-U-022 coverage.

## Decisions Made

- Kept throttling state on provider instances. This preserves independent endpoint chains and avoids cross-entry or cross-process coordination, which is out of scope.
- Applied 429 retry only when a `rate_limit` block exists. Endpoints without `rate_limit` preserve the spec-required behavior of treating errors as ordinary failures.
- Used provider-layer defaults for partial `rate_limit` blocks: 3 max backoff retries and 1000ms base delay.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Preserved rate-limit fields in catalog sync**
- **Found during:** Task 1
- **Issue:** The plan listed parser/types, but `embedding-config-sync.ts` reserialized endpoints into DB JSON and only preserved `min_delay_ms`. Without updating it, parsed retry/backoff settings would be lost during startup catalog sync.
- **Fix:** Extended catalog endpoint row serialization and change descriptions for `max_backoff_retries` and `backoff_base_ms`.
- **Files modified:** `src/embedding/embedding-config-sync.ts`
- **Verification:** `npm run test:unit -- tests/unit/embedding-yaml-parser.test.ts`, `npm run typecheck`, and plan-level verification passed.
- **Committed in:** `182c56b`

---

**Total deviations:** 1 auto-fixed (1 missing critical functionality).
**Impact on plan:** The deviation was necessary to satisfy the plan objective of preserving endpoint rate-limit config beyond initial parsing.

## Issues Encountered

- `gsd-sdk` was not available on PATH, so state, roadmap, and requirement tracking were updated manually.
- Task 3 typecheck initially caught a non-narrowing helper predicate; the helper was converted to a TypeScript type predicate before commit.

## Verification

- `npm run test:unit -- tests/unit/embedding-yaml-parser.test.ts` - PASSED
- `npm run test:unit -- tests/unit/embedding-rate-limit.test.ts` - PASSED
- `npm run test:unit -- tests/unit/embedding-provider.test.ts` - PASSED
- `npm run test:unit -- tests/unit/embedding-rate-limit.test.ts tests/unit/embedding-provider.test.ts` - PASSED
- `npm run typecheck` - PASSED

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

Plan 166-03 can rely on catalog endpoint chains enforcing local pacing and classifying 429s before search/RRF retriever failure handling. Exhausted 429s now surface failure after bounded retry and carry `rate_limit_events` metadata for later warning plumbing.

## Self-Check: PASSED

- Summary file created at `.planning/phases/166-embedding-pipeline/166-02-SUMMARY.md`.
- Task commits exist: `4fac6e5`, `182c56b`, `cafd36d`, `302c02c`, `f11d101`, `7abc7d6`.
- Created test file exists: `tests/unit/embedding-rate-limit.test.ts`.
- No unexpected tracked file deletions detected in task commits.

---
*Phase: 166-embedding-pipeline*
*Completed: 2026-06-11*
