---
phase: 115
slug: purpose-config-bindings-capabilities
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-06
---

# Phase 115 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + FlashQuery directed scenario runner |
| **Config file** | `vitest.config.ts`, `vitest.integration.config.ts`, `tests/scenarios/directed/run_suite.py` |
| **Quick run command** | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts` |
| **Full suite command** | `npm run build && npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts && npm run test:integration -- tests/integration/llm-config-sync.test.ts tests/integration/supabase-schema-verify.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities && (cd tests/scenarios/integration && python3 run_integration.py --managed llm_discovery_list)` |
| **Estimated runtime** | ~120-240 seconds, depending on Supabase availability and managed scenario startup |

---

## Sampling Rate

- **After every task commit:** Run the focused unit command relevant to the touched module.
- **After every plan wave:** Run `npm run build` plus all focused unit tests for completed slices.
- **Before `$gsd-verify-work`:** Full suite above must be green, with integration tests skipping only when `.env.test` is incomplete.
- **Max feedback latency:** 240 seconds for the focused Phase 115 gate.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 115-01-01 | 115-01 | 1 | BIND-01, BIND-02 | T-115-01 | Purpose config rejects unknown top-level keys and validates loop guardrails before startup proceeds. | unit | `npm test -- tests/unit/llm-config.test.ts` | ✅ | ✅ green |
| 115-02-01 | 115-02 | 1 | BIND-03 | T-115-02 | Schema verification requires `fqc_purpose_templates` with unique identity and source tracking. | unit + integration | `npm test -- tests/unit/schema-verify.test.ts && npm run test:integration -- tests/integration/supabase-schema-verify.test.ts` | ✅ | ✅ green |
| 115-03-01 | 115-03 | 3 | BIND-04, BIND-05 | T-115-03 | YAML sync cannot overwrite API-owned purpose-template bindings and normalizes template paths. | unit + integration | `npm test -- tests/unit/llm-config-sync.test.ts && npm run test:integration -- tests/integration/llm-config-sync.test.ts` | ✅ | ✅ green |
| 115-04-01 | 115-04 | 2 | CAP-01, CAP-02, CAP-03 | T-115-04 | Mode 2 exposure is denied unless every fallback model declares required structured capabilities. | unit | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool.test.ts` | ✅ | ✅ green |
| 115-05-01 | 115-05 | 4 | CAP-04, CAP-05, VAL-115 | T-115-05 | Runtime/API template binding and public calls use the same admission diagnostics as YAML config. | unit + directed scenario + YAML integration scenario | `npm test -- tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities && (cd tests/scenarios/integration && python3 run_integration.py --managed llm_discovery_list)` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ needs extension*

---

## Wave 0 Requirements

- [x] `tests/unit/llm-config.test.ts` — strict purpose fields, loop guardrails, structured capabilities, unknown-vs-false diagnostics, and legacy free-form capability migration to tags.
- [x] `tests/unit/schema-verify.test.ts` — `fqc_purpose_templates` table/columns/constraints plus Phase 115 model/purpose storage columns.
- [x] `tests/integration/llm-config-sync.test.ts` — purpose-template YAML/API precedence, dangling warnings, and reappearance-on-restart behavior.
- [x] `tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py` — public startup/config scenario coverage for admission diagnostics.
- [x] `tests/scenarios/integration/tests/llm_discovery_list.yml` — final `tags` plus structured `capabilities` discovery shape.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | N/A | All Phase 115 behaviors must have automated validation. | N/A |

## Docs-Impact Review

- [x] Phase 115 did not update user-facing docs because the phase deliberately closes config/schema/sync/test contracts that later ATL phases will make fully usable through tool registry, loop execution, and discovery/help. Release-facing docs should be updated before ATL v1 release to describe purpose `tools`, `excluded_tools`, `templates`, known loop guardrail defaults, model `tags`, and structured model `capabilities`.

## Executed Validation

- **2026-05-06:** `npm run build && npm test -- tests/unit/llm-config.test.ts tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts tests/unit/schema-verify.test.ts && npm run test:integration -- tests/integration/llm-config-sync.test.ts tests/integration/supabase-schema-verify.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities && (cd tests/scenarios/integration && python3 run_integration.py --managed llm_discovery_list)` — passed.
- Unit result: 4 files passed, 93 tests passed.
- TypeScript integration result: 2 files passed, 11 tests passed.
- Directed scenario result: `test_call_model_agent_loop_capabilities` passed 5/5 steps.
- YAML integration result: `llm_discovery_list` passed 19/19 steps.
- Coverage traceability: BIND-01 through BIND-05, CAP-01 through CAP-05, and VAL-115 are mapped in `.planning/REQUIREMENTS.md`, `tests/scenarios/directed/DIRECTED_COVERAGE.md`, and `tests/scenarios/integration/INTEGRATION_COVERAGE.md`.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 240s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
