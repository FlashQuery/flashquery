---
phase: 115
slug: purpose-config-bindings-capabilities
status: draft
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
| 115-01-01 | TBD | 1 | BIND-01, BIND-02 | T-115-01 | Purpose config rejects unknown top-level keys and validates loop guardrails before startup proceeds. | unit | `npm test -- tests/unit/llm-config.test.ts` | ✅ | ⬜ pending |
| 115-02-01 | TBD | 1 | BIND-03 | T-115-02 | Schema verification requires `fqc_purpose_templates` with unique identity and source tracking. | unit + integration | `npm test -- tests/unit/schema-verify.test.ts && npm run test:integration -- tests/integration/supabase-schema-verify.test.ts` | ⚠️ extend/create | ⬜ pending |
| 115-03-01 | TBD | 2 | BIND-04, BIND-05 | T-115-03 | YAML sync cannot overwrite API-owned purpose-template bindings and normalizes template paths. | unit + integration | `npm test -- tests/unit/llm-config-sync.test.ts && npm run test:integration -- tests/integration/llm-config-sync.test.ts` | ⚠️ extend | ⬜ pending |
| 115-04-01 | TBD | 2 | CAP-01, CAP-02, CAP-03 | T-115-04 | Mode 2 exposure is denied unless every fallback model declares required structured capabilities. | unit | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool.test.ts` | ✅ | ⬜ pending |
| 115-05-01 | TBD | 3 | CAP-04, CAP-05, VAL-115 | T-115-05 | Runtime/API template binding and public calls use the same admission diagnostics as YAML config. | unit + directed scenario + YAML integration scenario | `npm test -- tests/unit/llm-config-sync.test.ts tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/run_suite.py --managed test_call_model_agent_loop_capabilities && (cd tests/scenarios/integration && python3 run_integration.py --managed llm_discovery_list)` | ❌ create scenario | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ needs extension*

---

## Wave 0 Requirements

- [ ] `tests/unit/llm-config.test.ts` — add/adjust tests for strict purpose fields, loop guardrails, structured capabilities, unknown-vs-false diagnostics, and old free-form capability migration/removal.
- [ ] `tests/unit/schema-verify.test.ts` — add checks for `fqc_purpose_templates` table/columns/constraints if no focused coverage exists.
- [ ] `tests/integration/llm-config-sync.test.ts` — extend for purpose-template YAML/API precedence, dangling warnings, and reappearance-on-restart behavior.
- [ ] `tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py` — create public startup/config scenario coverage for admission diagnostics if no equivalent exists.
- [ ] `tests/scenarios/integration/tests/llm_discovery_list.yml` — update and run with `cd tests/scenarios/integration && python3 run_integration.py --managed llm_discovery_list` to prove the final `tags` plus structured `capabilities` discovery shape.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | N/A | All Phase 115 behaviors must have automated validation. | N/A |

## Docs-Impact Review

- [ ] At Phase 115 close, record whether user-facing docs need updates for `tools`, `excluded_tools`, `templates`, loop guardrail defaults, `tags`, and structured model `capabilities`; if no docs update is required in this phase, record the no-docs-impact rationale here before sign-off.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 240s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
