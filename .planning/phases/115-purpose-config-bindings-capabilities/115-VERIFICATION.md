---
phase: 115-purpose-config-bindings-capabilities
verified: 2026-05-06T04:25:18Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 115: Purpose Config, Bindings & Capabilities Verification Report

**Phase Goal:** Startup config and DB sync know which purposes may expose tools/templates, and model capability declarations gate Mode 2 admission before unsafe calls can run.
**Verified:** 2026-05-06T04:25:18Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Purpose config accepts `tools`, `excluded_tools`, and `templates`, rejects unknown top-level purpose fields, and type-validates known loop guardrails in defaults. | VERIFIED | `src/config/loader.ts:108-173` defines structured capabilities, numeric loop guardrail validation, and strict purpose keys. `tests/unit/llm-config.test.ts:463-580` covers accepted fields, `tols`/`audit_document` rejection, and non-number guardrail errors. |
| 2 | `fqc_purpose_templates` exists with canonical `template_path` identity, unique rows, source tracking, and YAML/API precedence behavior. | VERIFIED | DDL in `src/storage/supabase.ts:529-542`; required by verifier in `src/storage/schema-verify.ts:50-63`; precedence and source behavior covered in `tests/integration/llm-config-sync.test.ts:112-158`. |
| 3 | Generic config sync handles the purpose-template binding flow without duplicating YAML scrub/insert logic. | VERIFIED | `ConfigSyncAdapter` and `syncConfigAdapter()` in `src/llm/config-sync.ts:7-72`; purpose-template adapter wired through `syncPurposeTemplateBindings()` and called by startup sync at `src/llm/config-sync.ts:261`. |
| 4 | Structured model capabilities replace the old free-form behavior surface for tool execution decisions. | VERIFIED | Loader migrates legacy string `capabilities` to `tags` at `src/config/loader.ts:118-139`, preserves structured capability keys at `src/config/loader.ts:755-768`, and discovery emits `tags` separately from structured `capabilities` at `src/mcp/tools/llm.ts:205-218`. Stale capability-array grep found no active contract except one obsolete explanatory comment. |
| 5 | Any purpose that exposes model-visible tools fails config validation unless every fallback model declares required support. | VERIFIED | Startup admission is called at `src/config/loader.ts:793-795`; admission requires `tool_calling` and `usage_on_tool_calls` across fallback models at `src/llm/capabilities.ts:54-83`. Unit coverage includes unknown and declared-unsupported diagnostics in `tests/unit/llm-config.test.ts:898-951`. |
| 6 | Phase-specific runnable tests exist and pass for config parse/admission, DDL/schema verification, config sync precedence, binding resolution, runtime capability validation, and public startup/config scenarios for user-visible admission errors. | VERIFIED | Local spot-check passed: `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts` -> 4 files, 99 tests. `115-VALIDATION.md:73-78` records full build, unit, integration, directed, and YAML scenario gate passed. |
| 7 | OpenAI defaults, non-OpenAI unknown declarations, and response_format/tool pre-dispatch guard are implemented. | VERIFIED | `src/llm/capabilities.ts:29-38` defaults only provider `openai` + `openai-compatible`; `src/llm/capabilities.ts:92-120` blocks incompatible `response_format`; `src/mcp/tools/llm.ts:400-416` runs the guard before provider dispatch. |
| 8 | Runtime/API template binding uses the same capability admission as YAML config. | VERIFIED | `bindPurposeTemplateRuntime()` normalizes the pending binding then calls `validatePurposeMode2Admission()` before inserting API rows at `src/llm/purpose-template-bindings.ts:99-137`. |
| 9 | Public scenarios expose actionable capability admission errors. | VERIFIED | `tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py:110-181` covers `tool_calling`, `usage_on_tool_calls`, and `structured_outputs_with_tools` diagnostics with `declared unsupported` and `unknown declaration`. Directed coverage row exists at `DIRECTED_COVERAGE.md:683`. |
| 10 | All Phase 115 requirement IDs are traceable to completed validation evidence. | VERIFIED | `.planning/REQUIREMENTS.md:42-54` and `:87` mark BIND-01 through BIND-05, CAP-01 through CAP-05, and VAL-115 complete; `.planning/REQUIREMENTS.md:146-155` and `:179` map each to Phase 115. Integration coverage rows `IL-31` through `IL-36` map the runnable evidence. |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/loader.ts` | Purpose schema, model capability schema, startup admission hook | VERIFIED | Exists, substantive, wired to `src/llm/capabilities.ts`. SDK pattern expected `validateMode2`, but actual call is `validateAllPurposeMode2Admissions()` at lines 793-795. |
| `src/storage/supabase.ts` | DDL for purpose-template bindings and capability/tag columns | VERIFIED | `fqc_purpose_templates` table, source column, unique identity, and lookup index present. |
| `src/storage/schema-verify.ts` | Required table verification | VERIFIED | Requires `fqc_purpose_templates`. |
| `src/llm/config-sync.ts` | Generic YAML/API sync flow | VERIFIED | Generic adapter handles YAML scrub, runtime-owned lookup, skip warning, and insert. |
| `src/llm/purpose-template-bindings.ts` | Binding normalization and runtime helpers | VERIFIED | Normalizes vault-relative paths, warns on dangling YAML bindings, and gates runtime insertion through capability admission. |
| `src/llm/capabilities.ts` | Capability defaults, diagnostics, and admission checks | VERIFIED | Pure service with OpenAI defaulting, unknown-vs-unsupported diagnostics, startup admission, and response_format guard. |
| `src/mcp/tools/llm.ts` | Discovery projection and pre-dispatch guard | VERIFIED | Projects tags/capabilities and blocks incompatible response_format before provider dispatch. SDK literal pattern missed because the key string lives inside the capability service. |
| Tests and scenarios | Unit, integration, directed, YAML integration coverage | VERIFIED | Unit files, TypeScript integration files, directed scenario, YAML integration scenario, and coverage ledgers are present and substantive. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/config/loader.ts` | `src/llm/capabilities.ts` | post-parse admission hook | WIRED | Imports and calls `validateAllPurposeMode2Admissions()`. |
| `src/llm/config-sync.ts` | `src/llm/purpose-template-bindings.ts` | startup sync binding adapter | WIRED | `syncLlmConfigToDb()` calls `syncPurposeTemplateBindings()`. |
| `src/llm/purpose-template-bindings.ts` | `src/llm/capabilities.ts` | runtime binding admission call | WIRED | `bindPurposeTemplateRuntime()` calls `validatePurposeMode2Admission()` before insert. |
| `src/mcp/tools/llm.ts` | `src/llm/capabilities.ts` | pre-dispatch response_format guard | WIRED | `assertResponseFormatAllowedWithTools()` runs before provider dispatch for purpose calls. |
| `src/llm/client.ts` | `src/llm/config-sync.ts` | startup LLM initialization | WIRED | `initLlm()` calls `syncLlmConfigToDb(config)`; existing unit tests assert the call. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/config/loader.ts` | `config.llm.purposes[].tools/templates` and `models[].capabilities` | YAML -> Zod parse -> normalized `FlashQueryConfig` | Yes | FLOWING |
| `src/llm/config-sync.ts` | purpose-template rows | `config.llm.purposes[].templates` -> `createPurposeTemplateSyncAdapter()` -> Supabase insert | Yes | FLOWING |
| `src/llm/purpose-template-bindings.ts` | runtime binding rows | runtime helper args -> normalized `template_path` -> capability admission -> Supabase insert/delete | Yes | FLOWING |
| `src/mcp/tools/llm.ts` | model discovery and runtime guard inputs | loaded config and call parameters | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Focused unit gate for Phase 115 code paths | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts` | 4 files passed, 99 tests passed, duration 1.12s | PASS |
| YAML discovery scenario remains parseable | `python3 -c "import yaml; yaml.safe_load(open('tests/scenarios/integration/tests/llm_discovery_list.yml')); print('yaml ok')"` | `yaml ok` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BIND-01 | 115-01, 115-05 | Purpose config fields and unknown key rejection | SATISFIED | Loader schema and `ATL-U-08` tests. |
| BIND-02 | 115-01, 115-05 | Provider defaults pass-through plus loop guardrail numeric validation | SATISFIED | `PurposeDefaultsSchema` targeted validation and tests. |
| BIND-03 | 115-02, 115-05 | `fqc_purpose_templates` schema, unique identity, source tracking | SATISFIED | DDL, schema verifier, unit/integration schema tests. |
| BIND-04 | 115-03, 115-05 | Generic sync and YAML/API precedence | SATISFIED | `ConfigSyncAdapter`, `syncConfigAdapter()`, integration precedence tests. |
| BIND-05 | 115-03, 115-05 | Template path normalization and dangling warnings | SATISFIED | `normalizeTemplatePath()` and retained dangling warning behavior in tests. |
| CAP-01 | 115-01, 115-02, 115-04, 115-05 | Structured capability booleans | SATISFIED | Config schema, storage columns, discovery projection, tests. |
| CAP-02 | 115-01, 115-02, 115-05 | Legacy string capabilities migrated/replaced | SATISFIED | Loader migration to `tags`; no active stale string-array discovery contract. |
| CAP-03 | 115-04, 115-05 | Mode 2 startup admission requires tool and usage capability declarations | SATISFIED | `validatePurposeMode2Admission()` and startup hook. |
| CAP-04 | 115-03, 115-05 | Runtime/API binding uses same admission | SATISFIED | `bindPurposeTemplateRuntime()` calls shared admission service. |
| CAP-05 | 115-04, 115-05 | `response_format` with model-visible tools blocked when unsupported | SATISFIED | Runtime guard in `llm.ts`, capability service, unit and directed scenario coverage. |
| VAL-115 | 115-05 | Runnable unit, integration, directed, and public startup/config validation | SATISFIED | `115-VALIDATION.md:73-78`, coverage ledgers, local unit spot-check. |

### Review Gate

`115-REVIEW.md` status is **clean**: 0 critical, 0 warning, 0 info findings. The review specifically rechecked the remaining CR-03 mixed-case `response_format` fallback-chain issue and records `npm test -- tests/unit/llm-tool.test.ts` passing with 50 tests.

### Validation Evidence

`115-VALIDATION.md` status is **complete** and `nyquist_compliant: true`. It records the full gate as passed on 2026-05-06:

`npm run build && npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts && npm run test:integration -- tests/integration/llm-config-sync.test.ts tests/integration/supabase-schema-verify.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities && (cd tests/scenarios/integration && python3 run_integration.py --managed llm_discovery_list)`

Recorded results: 4 unit files / 93 tests passed, 2 TypeScript integration files / 11 tests passed, directed scenario 5/5 steps passed, and YAML integration scenario 19/19 steps passed.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.planning/ROADMAP.md` | 99 | Phase 115 top-level milestone checklist remains unchecked while phase section plans are marked complete | Info | Metadata inconsistency only; requirements, implementation, validation, and phase plan status support goal achievement. |
| `src/mcp/tools/llm.ts` | 196 | Comment references `capabilities: []` preservation | Info | Obsolete wording from prior discovery surface; code emits structured capabilities only when present and tests assert final shape. Not behavioral. |

### Human Verification Required

None. Phase 115 validation is automated and `115-VALIDATION.md` explicitly lists no manual-only verifications.

### Gaps Summary

No blocking gaps found. The phase goal is achieved in the codebase: startup config knows purpose tool/template exposure, DB sync persists purpose-template bindings with YAML/API precedence, and structured model capability declarations gate both startup admission and the runtime `response_format` risk path before unsafe provider dispatch.

---

_Verified: 2026-05-06T04:25:18Z_
_Verifier: the agent (gsd-verifier)_
