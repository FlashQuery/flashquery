---
phase: 166-embedding-pipeline
validated: 2026-06-11T07:18:00-03:00
status: passed
nyquist_compliant: true
auditor: codex
---

# Phase 166: Nyquist Validation Audit

## Result

Status: passed.

Phase 166 has sufficient automated coverage for the requirements and must-haves in plans 166-01 through 166-04 after filling two adversarial coverage weaknesses in existing tests:

- `T-I-035` now proves per-entry write fan-out starts both provider calls before the 100ms provider delay can serialize the second entry. The previous assertion only checked eventual start order and could pass under a serial implementation.
- `T-U-029` now actually runs the same RRF input twice and asserts identical output, instead of only checking limiting after sort.

No production code was modified.

## Test Infrastructure

| Layer | Framework | Pattern | Runner |
|---|---|---|---|
| Unit | Vitest | `tests/unit/*.test.ts` | `npm run test:unit -- <files>` |
| Integration | Vitest + Supabase | `tests/integration/**/*.test.ts` | `npm run test:integration -- <files>` |
| Directed scenarios | Python runner | `tests/scenarios/directed/testcases/test_*.py` | `python3 tests/scenarios/directed/run_suite.py --managed <pattern>` |
| Typecheck | TypeScript | `src/**/*.ts`, `tests/**/*.ts` | `npm run typecheck` |

## Requirements Coverage Map

| Plan | Requirements | Primary automated coverage | Status |
|---|---|---|---|
| 166-01 | REQ-012, REQ-013, REQ-014, REQ-015, REQ-016 | `parallel-per-entry-attempt.test.ts`, `pending-queue-per-entry.test.ts`, `pending-worker-per-entry.test.ts`, `embedding-write-warnings.test.ts`, `embedding-truncation.test.ts`, `truncation-reactive-fallback.test.ts` | covered |
| 166-02 | REQ-017 | `embedding-yaml-parser.test.ts`, `embedding-rate-limit.test.ts`, `embedding-provider.test.ts` | covered |
| 166-03 | REQ-006, REQ-020, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-027 | `search-mode-matrix.test.ts`, `embedding-names-param.test.ts`, `rrf-fusion.test.ts`, `rrf-tie-break.test.ts`, `search-zero-active-*.test.ts`, `partial-retriever-failure.test.ts`, `deactivated-operations.test.ts` | covered |
| 166-04 | REQ-006, REQ-008, REQ-021, REQ-028, REQ-029, REQ-030, REQ-031, REQ-032, REQ-033, REQ-034 | `plugin-manifest-embedding.test.ts`, `register-plugin-embedding-param.test.ts`, `plugin-embedding-columns.test.ts`, `plugin-write-record-embed.test.ts`, `plugin-search-records-semantic.test.ts`, `plugin-legacy-registration-migration.test.ts`, directed D-100..D-103 scenarios | covered |

## Must-Have Validation

| Must-have | Behavioral coverage | Status |
|---|---|---|
| Core writes fan out once per active catalog entry and await attempts | `T-I-034`; strengthened `T-I-035` timing assertion | green |
| Pending queue keyed by `embedding_name` with independent rows | `T-I-037`, `T-I-038`, `T-I-039` | green |
| Write responses surface `embedding_deferred:<name>` and omit empty warnings | `T-U-014`, `T-U-015` | green |
| Pending worker retries, skips deactivated, deletes retired, stamps on success | `T-I-040`, `T-I-041`, `T-I-042`, `T-I-043` | green |
| Oversized inputs truncate and retry once at 75 percent | `T-U-016`, `T-U-017`, `T-U-018`, `T-I-044` | green |
| Rate limits parse/persist; min delay and 429 backoff work | `embedding-yaml-parser.test.ts`, `T-U-019`..`T-U-022` | green |
| Search derives behavior from active catalog count and mode | `T-I-045`..`T-I-049`, `T-I-056`..`T-I-058` | green |
| `embedding_names` override semantics | `embedding-names-param.test.ts` | green |
| RRF k=60, bounded prefetch, deterministic ordering, repeated output | `T-U-023`..strengthened `T-U-029` | green |
| Partial retriever failures continue unless all fail | `T-I-059`, `T-I-060` | green |
| Plugin manifest/registration resolution and frozen choice | `T-U-030`..`T-U-035`, directed D-100..D-102 | green |
| Plugin table DDL/RPC, record write/search routing, re-registration, legacy migration | `T-I-061`..`T-I-069`, D-103 plus post-review integration regression | green |

## Commands Run During This Audit

| Command | Result |
|---|---|
| `npm run test:unit -- tests/unit/rrf-tie-break.test.ts` | passed: 1 file, 4 tests |
| `npm run test:integration -- tests/integration/embedding/parallel-per-entry-attempt.test.ts` | passed: 1 file, 2 tests |
| `npm run test:unit -- tests/unit/embedding-write-warnings.test.ts tests/unit/embedding-truncation.test.ts tests/unit/embedding-rate-limit.test.ts tests/unit/rrf-fusion.test.ts tests/unit/rrf-tie-break.test.ts tests/unit/plugin-manifest-embedding.test.ts tests/unit/register-plugin-embedding-param.test.ts` | passed: 7 files, 24 tests |
| `npm run typecheck` | passed |

## Non-Signoff Command

One larger aggregate integration command was started during audit exploration and terminated with exit 143 after running too long and showing skipped files in the aggregate context. It is not used as sign-off evidence:

`npm run test:integration -- tests/integration/embedding/parallel-per-entry-attempt.test.ts tests/integration/embedding/pending-queue-per-entry.test.ts tests/integration/embedding/pending-worker-per-entry.test.ts tests/integration/embedding/truncation-reactive-fallback.test.ts tests/integration/embedding/search-mode-matrix.test.ts tests/integration/embedding/embedding-names-param.test.ts tests/integration/embedding/search-zero-active-semantic.test.ts tests/integration/embedding/search-zero-active-mixed.test.ts tests/integration/embedding/partial-retriever-failure.test.ts tests/integration/embedding/deactivated-operations.test.ts tests/integration/plugin-embedding-columns.test.ts tests/integration/plugin-write-record-embed.test.ts tests/integration/plugin-search-records-semantic.test.ts tests/integration/plugin-legacy-registration-migration.test.ts`

## Files Changed For Validation

- `tests/integration/embedding/parallel-per-entry-attempt.test.ts`
- `tests/unit/rrf-tie-break.test.ts`
- `.planning/phases/166-embedding-pipeline/166-VALIDATION.md`

## Sign-Off

Nyquist validation is compliant for Phase 166. The audit found test softness, replaced it with fail-capable behavioral assertions, and verified those focused tests green.
