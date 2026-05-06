---
phase: 118
slug: template-discovery-masquerade-dispatch
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-06
---

# Phase 118 - Validation Strategy

> Per-phase validation contract for template discovery and masquerade dispatch.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 plus directed Python scenario runner |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool.test.ts` |
| **Full suite command** | `npm run lint && npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool.test.ts && npm run test:integration -- tests/integration/template-tools.integration.test.ts && npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py --managed && npm run build` |
| **Estimated runtime** | ~180-360 seconds depending on managed scenario startup |

---

## Sampling Rate

- **After every task commit:** Run the focused unit command for touched modules.
- **After every plan wave:** Run the relevant focused unit, integration, E2E, or directed scenario command named in that wave.
- **Before `$gsd-verify-work`:** The full Phase 118 suite command must be green.
- **Max feedback latency:** Keep unit feedback below 60 seconds; directed/E2E feedback may run at wave boundaries.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 118-W0-01 | 01 | 0 | VAL-118 | N/A | RED contracts exist before implementation | unit/e2e/directed | `npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-dispatcher.test.ts && npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` | yes | green |
| 118-01 | 02 | 1 | TMPL-06 | T-118-01 | Invalid or non-exposed templates do not become model-visible tools | unit/integration | `npm test -- tests/unit/llm-template-tools.test.ts && npm run test:integration -- tests/integration/template-tools.integration.test.ts` | yes | green |
| 118-02 | 03 | 1 | TMPL-07 | T-118-02 | Collisions fail before delegated model dispatch and list all sources | unit/directed | `npm test -- tests/unit/llm-template-tools.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py --managed` | yes | green |
| 118-03 | 04 | 2 | TMPL-08 | T-118-03 | Unknown generated names and invalid args return recoverable tool errors | unit/e2e | `npm test -- tests/unit/llm-tool-dispatcher.test.ts && npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts` | yes | green |
| 118-04 | 05 | 3 | TMPL-08, VAL-118 | T-118-04 | Document params resolve through the standard identifier ladder without rescanning tool result content | e2e/directed | `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py --managed` | yes | green |
| 118-05 | 05 | 3 | TMPL-06, TMPL-07, TMPL-08, VAL-118 | T-118-05 | Mixed native/template registries preserve purpose-scoped authorization and calls-log diagnostics | e2e/directed/build | `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py --managed && npm run build` | yes | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/llm-template-tools.test.ts` - contracts for fresh discovery, frontmatter validation, generated names, collisions, reverse map, and template-tool dispatch.
- [x] `tests/integration/template-tools.integration.test.ts` - contracts for fresh frontmatter reads without scan, default access, purpose bindings, dangling paths, and discovery diagnostics.
- [x] `tests/e2e/call-model-template-tools.e2e.test.ts` - ATL-E2E-04 and ATL-E2E-05.
- [x] `tests/scenarios/directed/testcases/test_call_model_template_discovery.py` - directed ATL-DS-07.
- [x] `tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py` - directed ATL-DS-08.
- [x] `tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py` - directed ATL-DS-10.
- [x] `tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py` - directed ATL-DS-11.

---

## Phase 118 Gate Evidence

**Status:** green / passed

**Completed:** 2026-05-06

**Command:**

```bash
npm run lint && npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool.test.ts && npm run test:integration -- tests/integration/template-tools.integration.test.ts && npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py --managed && npm run build
```

**Result:** passed. Evidence included lint success, 135 focused unit tests passing, 3 integration tests passing, 2 E2E tests passing, ATL-DS-07 passing 1/1, ATL-DS-08 passing 2/2, ATL-DS-10 passing 2/2 including `template_missing_required_param`, ATL-DS-11 passing 1/1, and final `npm run build` success.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing test references.
- [x] No watch-mode flags.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-06 for planning
