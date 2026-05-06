---
phase: 116
slug: model-visible-tool-registry
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-06
---

# Phase 116 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + directed scenario harness |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/scenarios/directed/testcases/` |
| **Quick run command** | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts` |
| **Full suite command** | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed && npm run build` |
| **Estimated runtime** | ~2-3 minutes |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command from its PLAN.md.
- **After every plan wave:** Run all focused unit commands for plans completed in that wave; after Wave 3 also run `python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed && npm run build`.
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 3 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 116-01-01 | 01 | 1 | TOOL-01, TOOL-02, TOOL-03 | T-116-01 / T-116-02 / T-116-03 / T-116-04 | Exact tier/name/exclusion/hard-exclusion behavior is locked before implementation, including `get_memory` in both tiers | unit RED | `npm test -- tests/unit/llm-tool-registry.test.ts` | created by task | complete |
| 116-01-02 | 01 | 1 | TOOL-01, TOOL-02, TOOL-03 | T-116-01 / T-116-02 / T-116-03 / T-116-04 | Pure registry assembly exposes only policy-approved names and reports hard exclusions | unit | `npm test -- tests/unit/llm-tool-registry.test.ts` | created by task | complete |
| 116-02-01 | 02 | 2 | TOOL-04, VAL-116 | T-116-05 / T-116-06 / T-116-07 / T-116-08 | Provider schema translation contract is locked before implementation | unit RED | `npm test -- tests/unit/llm-tool-registry.test.ts` | extends existing | complete |
| 116-02-02 | 02 | 2 | TOOL-04, VAL-116 | T-116-05 / T-116-06 / T-116-07 / T-116-08 | MCP registration metadata is captured and translated without handler dispatch | unit | `npm test -- tests/unit/llm-tool-registry.test.ts` | creates catalog | complete |
| 116-03-01 | 03 | 2 | TOOL-01, TOOL-02, TOOL-03, VAL-116 | T-116-09 / T-116-10 / T-116-11 / T-116-12 | Config validation contract rejects malformed native tool declarations | unit RED | `npm test -- tests/unit/llm-config.test.ts` | extends existing | complete |
| 116-03-02 | 03 | 2 | TOOL-01, TOOL-02, TOOL-03, VAL-116 | T-116-09 / T-116-10 / T-116-11 / T-116-12 | Loader rejects unknown tiers/tools and preserves hard-excluded names for diagnostics | unit | `npm test -- tests/unit/llm-config.test.ts tests/unit/llm-tool-registry.test.ts` | extends existing | complete |
| 116-04-01 | 04 | 3 | TOOL-01, TOOL-02, TOOL-03, TOOL-04, VAL-116 | T-116-13 / T-116-14 / T-116-15 / T-116-16 / T-116-17 | call_model provider-parameter behavior and public diagnostics are locked before implementation | unit RED | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool-registry.test.ts` | extends existing | complete |
| 116-04-02 | 04 | 3 | TOOL-01, TOOL-02, TOOL-03, TOOL-04, VAL-116 | T-116-13 / T-116-14 / T-116-15 / T-116-16 / T-116-17 | Purpose calls pass non-empty provider tools, omit empty tools, and expose snake_case diagnostics | unit | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool-registry.test.ts` | extends existing | complete |
| 116-04-03 | 04 | 3 | VAL-116 | T-116-13 / T-116-14 / T-116-15 / T-116-16 / T-116-17 | Public scenario and build prove final model-visible registry behavior | unit + directed + build | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed && npm run build` | creates scenario | complete |

---

## Wave 0 Requirements

- [x] Plan 01 Task 1 creates `tests/unit/llm-tool-registry.test.ts` before implementation.
- [x] Plan 04 Task 3 creates `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py` before running it.
- [x] Existing Vitest infrastructure covers unit test execution; no new framework install required.
- [x] Directed scenarios run by direct Python testcase command because `package.json` has no npm script for directed scenarios.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All 9 plan tasks have `<automated>` verify commands.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 creation paths are task-local and no task `read_first` includes files created later in the same task.
- [x] No watch-mode flags.
- [x] Feedback latency target is under 3 minutes for the full focused gate.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** complete - Plan 116-04 verified `test_call_model_native_tool_registry.py --managed` and the full focused gate on 2026-05-06.
