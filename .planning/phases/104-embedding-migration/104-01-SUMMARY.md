---
phase: 104
plan: "01"
subsystem: embedding
tags: [embedding, llm, purpose-routing, refactor, wave-1, tdd-green]
dependency_graph:
  requires:
    - tests/unit/embedding-migration.test.ts (U-44, U-44b, U-45, U-45b RED-state — from 104-00)
  provides:
    - src/embedding/provider.ts (initEmbedding with llmClient parameter and purpose-path branch)
    - src/config/loader.ts (D-07 deprecation warning for dual-config)
    - src/index.ts (startup order: initLlm before initEmbedding; llmClient passed explicitly)
    - tests/scenarios/directed/testcases/test_embedding_migration.py (L-23 full implementation)
  affects:
    - All callers of initEmbedding — signature now accepts optional second parameter
tech_stack:
  added: []
  patterns:
    - Purpose-path branch with guard before getModelForPurpose (NullLlmClient safety)
    - Graceful degradation: WARN + NullEmbeddingProvider on misconfiguration
    - Optional parameter backward-compat: llmClient? preserves existing test signatures
    - Spread-append for _deprecationWarnings (never overwrite)
key_files:
  created: []
  modified:
    - src/embedding/provider.ts
    - src/config/loader.ts
    - src/index.ts
    - tests/scenarios/directed/testcases/test_embedding_migration.py
decisions:
  - "Used import type for LlmClient in provider.ts (type-only) to avoid circular runtime imports"
  - "llmClient parameter is optional (?) so existing tests calling initEmbedding(config) compile and pass without modification"
  - "Scan command path passes undefined explicitly to document intent (not relying on optional parameter default)"
  - "dimensions hoisted to top of initEmbedding body so both purpose-path and legacy-path share the same variable"
  - "providerEntry.apiKey ?? '' pattern matches existing OpenAICompatibleProvider invocation style"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-29"
  tasks_completed: 4
  files_changed: 4
---

# Phase 104 Plan 01: Embedding Migration Implementation Summary

Implement the embedding-migration refactor (D-01 through D-08): route `initEmbedding()` through the `embedding` purpose when one is configured in `llm:`, with full backward compatibility for the no-purpose path. Four Wave 0 RED tests turned GREEN; 23 existing U-43 baseline tests continue passing.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Modify src/embedding/provider.ts — purpose-path branch | 58188bb | src/embedding/provider.ts |
| 2 | Modify src/config/loader.ts — D-07 deprecation warning | 9defc2b | src/config/loader.ts |
| 3 | Modify src/index.ts — startup order + llmClient import | 373e235 | src/index.ts |
| 4 | Implement L-23 directed scenario (replace Wave 0 stub) | f26ef13 | tests/scenarios/directed/testcases/test_embedding_migration.py |

## Production Source Changes

### src/embedding/provider.ts

- Added `import type { LlmClient } from '../llm/client.js';` (type-only, no circular runtime import)
- Changed `initEmbedding(config: FlashQueryConfig)` to `initEmbedding(config: FlashQueryConfig, llmClient?: LlmClient)`
- Hoisted `const dimensions = config.embedding.dimensions` to top of function body (shared by both paths)
- Inserted purpose-path branch at top (runs first when `hasEmbeddingPurpose && llmClient` is truthy):
  - `getModelForPurpose('embedding')` null → WARN "no models in its fallback chain" + NullEmbeddingProvider (U-45b)
  - model.type !== 'embedding' → WARN with "type='...'" + NullEmbeddingProvider (U-44b, U-45)
  - provider not found → WARN + NullEmbeddingProvider
  - success → OpenAICompatibleProvider or OllamaProvider; INFO log "routing through purpose 'embedding' → ..."
- Legacy path preserved character-for-character (only `dimensions` now references the hoisted variable)

### src/config/loader.ts

- Added `embeddingPurposeDeprecationWarning` computation in `loadConfig()` step 10
- Condition: `config.embedding && config.llm?.purposes?.some(p => p.name === 'embedding')`
- Spread-appended to `_deprecationWarnings` after the existing `extensionWarning` (never overwrites)
- No new exports; uses existing `getDeprecationWarnings()` accessor

### src/index.ts (two call-site changes)

- Added `llmClient` to import from `'./llm/client.js'` (module singleton)
- Main start command: flipped from `initEmbedding(config); await initLlm(config)` to `await initLlm(config); initEmbedding(config, llmClient!)` — initLlm FIRST per D-02
- Scan command: `initEmbedding(config)` → `initEmbedding(config, undefined)` — explicit, self-documenting
- `embeddingStatus` banner at lines ~292-294 unchanged (D-08 defers banner to Phase 105)

## Test Outcomes

### Wave 0 RED tests — all GREEN

```
npm test -- tests/unit/embedding-migration.test.ts tests/unit/embedding.test.ts

Test Files  2 passed (2)
      Tests  27 passed (27)
   Duration  430ms
```

- U-44: constructs OpenAICompatibleProvider from purpose model config when embedding purpose configured — PASS
- U-44b: NullEmbeddingProvider on purpose-path error uses config.embedding.dimensions (768) — PASS
- U-45: logs WARN with "semantic search DISABLED" and "type='language'" — PASS
- U-45b: logs WARN with "no models in its fallback chain" — PASS

### U-43 baseline — all 23 tests still GREEN (no modifications to embedding.test.ts)

### Full unit suite

```
npm test

Test Files  70 passed (70)
      Tests  1293 passed (1293)
   Duration  7.01s
```

Zero new failures introduced.

### TypeScript compile

```
npx tsc --noEmit
```

No new errors in modified files. Pre-existing errors in documents.ts, files.ts, memory.ts, plugins.ts, frontmatter-sanitizer.ts are pre-existing and out of scope for this plan.

### Build

```
npm run build
ESM ⚡️ Build success in 154ms
DTS ⚡️ Build success in 3563ms
```

### L-23 directed scenario

File compiles cleanly (`python3 -m py_compile` exits 0). Full save_memory + search_memory round-trip implementation replaces Wave 0 stub. Execution against live OpenAI API requires `.env.test` with valid `OPENAI_API_KEY`.

## TDD Gate Compliance

This plan is Wave 1 of a TDD cycle where Wave 0 (Plan 104-00) created the RED tests:

1. RED gate: commits 6140c40, ac29890, 4ad1c33 (Wave 0) — tests/unit/embedding-migration.test.ts existed and was failing
2. GREEN gate: commits 58188bb, 9defc2b, 373e235, f26ef13 (this plan) — all 4 tests now pass

## Deviations from Plan

None — plan executed exactly as written. All D-01 through D-08 constraints satisfied.

## Known Stubs

None. The L-23 stub has been fully implemented.

## Threat Flags

None. The purpose-path provider construction follows the identical API-key handling pattern as the existing legacy path (T-104-03 accepted). No new network endpoints or auth paths introduced.

## Self-Check: PASSED

- [x] src/embedding/provider.ts exists with LlmClient import, optional llmClient param, purpose-path branch
- [x] src/config/loader.ts contains embeddingPurposeDeprecationWarning spread-appended to _deprecationWarnings
- [x] src/index.ts: llmClient in import, initLlm before initEmbedding(config, llmClient!), scan passes undefined
- [x] tests/scenarios/directed/testcases/test_embedding_migration.py: L-23 full implementation, no NotImplementedError
- [x] Commits 58188bb, 9defc2b, 373e235, f26ef13 all exist in git log
- [x] npm test: 1293 passed (70 test files) — 0 failures
- [x] npm run build: ESM and DTS success
