---
phase: 98
plan: 02
subsystem: config
tags: [llm-config, zod-schema, config-loader, validation, three-layer]
dependency_graph:
  requires: [98-01]
  provides: [FlashQueryConfig.llm three-layer interface, LlmSchema, normalizeLlmNames, validateLlmConfig, CONF-06]
  affects: [src/config/loader.ts, tests/unit/llm-config.test.ts, tests/fixtures/flashquery.test.yml]
tech_stack:
  added: []
  patterns: [Zod three-layer schema composition, post-Zod name normalization, corrective-pass defaults preservation]
key_files:
  created:
    - tests/unit/llm-config.test.ts
  modified:
    - src/config/loader.ts
    - tests/fixtures/flashquery.test.yml
decisions:
  - "normalizeLlmNames runs on raw snake_case Zod output before snakeToCamel — TypeScript would surface errors if reversed"
  - "purpose.defaults restored verbatim after snakeToCamel to preserve LLM provider param names (max_tokens, etc.)"
  - "z.string().url() on ProviderSchema.endpoint satisfies T-98-02 — URL validated at parse time"
  - "U-08 (case normalization) required normalizeLlmNames in Task 2 despite plan's acceptance criteria implying no Task 2 dependency — treated as plan inconsistency; U-08 verified GREEN after Task 2"
  - "Removed old flat llm: section from tests/fixtures/flashquery.test.yml — it correctly triggered CONF-06 migration error"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-28"
  tasks: 2
  files: 3
---

# Phase 98 Plan 02: Three-Layer LLM Config Schema Summary

Three-layer LLM config schema (ProviderSchema / ModelSchema / PurposeSchema) added to loader.ts with case normalization, cross-reference validation, and legacy format detection — all 14 unit tests (U-01..U-13 + CONF-06) GREEN; 1213 total unit tests passing with no regressions.

## What Was Built

### LlmSchema (Final State)

Five sub-schemas replacing the 9-line flat stub:

| Schema | Key Fields |
|--------|------------|
| `ProviderSchema` | name: string, type: enum(openai-compatible\|ollama), endpoint: z.string().url(), api_key?: string |
| `ModelCostSchema` | input: z.number().min(0), output: z.number().min(0) |
| `ModelSchema` | name, provider_name, model, type: enum(7 values), cost_per_million: ModelCostSchema |
| `PurposeDefaultsSchema` | z.record(z.string(), z.unknown()) — permissive, LLM provider params |
| `PurposeSchema` | name, description, models: string[], defaults?: PurposeDefaultsSchema |
| `LlmSchema` | providers[], models[], purposes[] — .strip().optional() |

### FlashQueryConfig.llm Interface (New)

```typescript
llm?: {
  providers: Array<{ name: string; type: 'openai-compatible' | 'ollama'; endpoint: string; apiKey?: string }>;
  models: Array<{ name: string; providerName: string; model: string; type: '...'; costPerMillion: { input: number; output: number } }>;
  purposes: Array<{ name: string; description: string; models: string[]; defaults?: Record<string, unknown> }>;
};
```

### Helper Functions

- **`normalizeLlmNames(llm: RawLlm): void`** — lowercases all names and cross-references in-place; runs BEFORE validateLlmConfig and BEFORE snakeToCamel
- **`validateLlmConfig(llm: RawLlm): LlmValidationError[]`** — implements CONF-01 (name format /^[a-z0-9][a-z0-9_-]*$/), CONF-02 (uniqueness), CONF-03 (model→provider ref), CONF-04 (purpose→model ref)
- **`rejectLegacyFields` extended** — CONF-06: detects `llm.provider` or `llm.model` keys and throws migration error

## Exact Error Messages for Negative Tests

| Test | Thrown Error |
|------|-------------|
| U-10 (invalid name) | `Config error: [provider] Provider name 'my provider' must match [a-z0-9][a-z0-9_-]*` |
| U-11 (duplicate model) | `Config error: [model] Duplicate model name 'fast' appears 2 times (case-insensitive)` |
| U-12 (unknown provider ref) | `Config error: [cross-ref] model 'gpt-4o' references unknown provider 'nonexistent' — defined providers: [openai]` |
| U-13 (unknown model ref) | `Config error: [cross-ref] purpose 'default' references unknown model 'ghost-model' — defined models: [gpt-4o]` |
| CONF-06 (legacy format) | `Config error: The 'llm:' section uses the pre-v3.0 flat format (provider/model keys). Migrate to the three-layer format with providers:, models:, and purposes: arrays. See flashquery.example.yml for the new format.` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixture file contained old flat llm: section**
- **Found during:** Task 2 full unit test suite run
- **Issue:** `tests/fixtures/flashquery.test.yml` had `llm: { provider, model, api_key }` which correctly triggered the new CONF-06 migration error, failing 2 existing tests in config.test.ts
- **Fix:** Removed the `llm:` section from the fixture (config.test.ts doesn't test LLM functionality)
- **Files modified:** `tests/fixtures/flashquery.test.yml`
- **Commit:** b637213

**2. [Plan inconsistency - Note] U-08 requires normalizeLlmNames (Task 2 function)**
- **Found during:** Task 1 verification
- **Issue:** Plan's Task 1 acceptance criteria listed U-08 as passing with "no Task 2 dependency", but U-08 tests case normalization which requires `normalizeLlmNames()`. U-08 was correctly RED after Task 1 and GREEN after Task 2.
- **Resolution:** Treated as a plan typo. Proceeded normally; U-08 went GREEN in Task 2 as intended by the plan's task 2 `<behavior>` section.
- **No deviation from implementation — plan was internally inconsistent in acceptance criteria only.**

### Note on test file creation

The test file `tests/unit/llm-config.test.ts` was created as part of this plan's TDD RED phase. Plan 98-01 (which was supposed to create it in Wave 0) had not yet run in this parallel execution wave. The test file content follows the exact specification from Plan 98-01.

## Pre-existing Tests — Side Effects

- **Before:** 1,199 passing unit tests + 20 pre-existing deferred failures (documented in STATE.md)
- **After:** 1,213 passing unit tests (added 14 new LLM config tests)
- **Regressions:** 0 (2 config.test.ts tests broken by fixture issue → fixed by removing old flat llm section)
- **The 20 pre-existing deferred failures remain unchanged**

## Commits

| Hash | Message |
|------|---------|
| b28d7d9 | test(98-02): add failing tests for three-layer LLM config schema [U-01..U-13 + CONF-06] |
| 65989c0 | feat(98-02): replace LlmSchema stub with three-layer Zod schema |
| b637213 | feat(98-02): add normalizeLlmNames, validateLlmConfig, and CONF-06 legacy detection |

## Self-Check: PASSED

- [x] `tests/unit/llm-config.test.ts` exists
- [x] `src/config/loader.ts` modified (ProviderSchema, ModelCostSchema, ModelSchema, PurposeDefaultsSchema, PurposeSchema, LlmSchema, normalizeLlmNames, validateLlmConfig, CONF-06)
- [x] Commits b28d7d9, 65989c0, b637213 all exist in git log
- [x] All 14 unit tests pass: `npx vitest run tests/unit/llm-config.test.ts` = 14 passed
- [x] Full unit suite: 1213 passed, 0 new failures
- [x] `grep -nE "^const (Provider|Model|Purpose|Llm|ModelCost)Schema|^function (normalizeLlmNames|validateLlmConfig)" src/config/loader.ts` returns exactly 7 entries
