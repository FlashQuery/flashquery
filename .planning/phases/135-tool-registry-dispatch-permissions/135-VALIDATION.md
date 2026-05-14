---
phase: 135
slug: tool-registry-dispatch-permissions
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 135 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts` |
| **Quick run command** | `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` |
| **Full suite command** | `npm run test:integration -- --reporter=verbose macro-tool-dispatch` |
| **Estimated runtime** | ~60-180 seconds, depending on integration Supabase availability |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher`
- **After every plan wave:** Run `npm run test:integration -- --reporter=verbose macro-tool-dispatch`
- **Before `$gsd-verify-work`:** Required unit and integration commands must be green or explicitly skipped only by the existing `.env.test` helper logic.
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 135-01-01 | 01 | 1 | MACRO-DISP-01, MACRO-DISP-03 | T-135-01 / T-135-03 | Registry and dispatcher tests exist before implementation; forbidden backstop blocks handler calls | unit | `npm test -- --reporter=verbose macro-registry macro-dispatcher` | ❌ W0 | ⬜ pending |
| 135-01-02 | 01 | 1 | MACRO-DISP-02 through MACRO-DISP-07 | T-135-02 / T-135-04 / T-135-05 / T-135-06 | Pre-scan, hard exclusions, and caller identity tests encode the security contract | unit | `npm test -- --reporter=verbose macro-permission-prescan macro-hard-exclusions macro-caller-identity` | ❌ W0 | ⬜ pending |
| 135-01-03 | 01 | 1 | MACRO-DISP-01 | T-135-07 | Integration dispatch coverage is registered in the explicit Vitest include list | integration | `npm run test:integration -- --reporter=verbose macro-tool-dispatch` | ❌ W0 | ⬜ pending |
| 135-02-01 | 02 | 2 | MACRO-DISP-01, MACRO-DISP-03, MACRO-DISP-04 | T-135-01 / T-135-03 / T-135-06 | `buildToolRegistry` uses host/delegated allowlist sources, validates native args, and omits `call_macro` | unit | `npm test -- --reporter=verbose macro-registry` | ❌ W0 | ⬜ pending |
| 135-02-02 | 02 | 2 | MACRO-DISP-01, MACRO-DISP-03 | T-135-03 | `dispatchMacroTool` returns lookup/backstop envelopes before handler invocation | unit | `npm test -- --reporter=verbose macro-dispatcher` | ❌ W0 | ⬜ pending |
| 135-03-01 | 03 | 3 | MACRO-DISP-02 through MACRO-DISP-06 | T-135-02 / T-135-04 / T-135-05 | AST pre-scan runs before execution and reports all forbidden/unknown/hard-excluded refs | unit | `npm test -- --reporter=verbose macro-permission-prescan macro-hard-exclusions` | ❌ W0 | ⬜ pending |
| 135-03-02 | 03 | 3 | MACRO-DISP-02, MACRO-DISP-03 | T-135-02 / T-135-03 | Evaluator invokes pre-scan and dispatcher with zero side effects on rejection | unit | `npm test -- --reporter=verbose macro-permission-prescan macro-dispatcher` | ❌ W0 | ⬜ pending |
| 135-04-01 | 04 | 4 | MACRO-DISP-01, MACRO-DISP-07 | T-135-06 | Public `call_macro` constructs host caller context and native dispatch context internally | unit | `npm test -- --reporter=verbose macro-caller-identity macro-registry macro-dispatcher` | ❌ W0 | ⬜ pending |
| 135-04-02 | 04 | 4 | MACRO-DISP-01 through MACRO-DISP-07 | T-I-003 / T-I-004 | Real `fq.write_document` and `fq.search` macro dispatch works through registered native handlers | integration | `npm run test:integration -- --reporter=verbose macro-tool-dispatch` | ❌ W0 | ⬜ pending |
| 135-04-03 | 04 | 4 | MACRO-DISP-04, MACRO-DISP-05 | ML-11 / ML-12 | Public directed scenario coverage verifies nested `fq.call_macro` and template-masquerade hard exclusions. | directed scenario | `python3 tests/scenarios/directed/testcases/test_macro_dispatch_permissions.py --managed` | ✅ | ⬜ pending |
| 135-04-04 | 04 | 4 | MACRO-DISP-01 | IS-11 | YAML integration scenario composes multiple native handlers through one macro. | YAML integration | `python3 tests/scenarios/integration/run_integration.py --managed macro_dispatch_get_then_write` | ✅ | ⬜ pending |
| 135-04-05 | 04 | 4 | MACRO-DISP-02, MACRO-DISP-03 | ML-13 / ML-14 | Public directed scenario coverage verifies permission pre-scan forbidden lists, nested forbidden aggregation, and no nested execution result. | directed scenario | `python3 tests/scenarios/directed/testcases/test_macro_permission_prescan.py --managed` | ✅ | ⬜ pending |
| 135-04-06 | 04 | 4 | MACRO-DISP-06 | ML-15 / ML-16 | Directed helper drives `runMacroSource` for delegated and host caller identities, proving delegated `fq.call_model` hard exclusion and host reachability. | directed scenario | `python3 tests/scenarios/directed/testcases/test_macro_delegated_hard_exclusions.py --managed` | ✅ | ⬜ pending |
| 135-04-07 | 04 | 4 | MACRO-DISP-07 | ML-17 | Public directed scenario coverage verifies no public `callerKind` schema, ignored caller identity input, and no echo. | directed scenario | `python3 tests/scenarios/directed/testcases/test_macro_caller_identity.py --managed` | ✅ | ⬜ pending |
| 135-04-08 | 04 | 4 | MACRO-DISP-02, MACRO-DISP-03 | IS-12 | YAML integration scenario verifies forbidden macro writes fail before dispatch and the blocked target remains absent. | YAML integration | `python3 tests/scenarios/integration/run_integration.py --managed macro_permission_failure_zero_side_effects` | ✅ | ⬜ pending |
| 135-04-09 | 04 | 4 | MACRO-DISP-01 through MACRO-DISP-07 | Phase gate | Required unit, integration, directed, YAML, build, and source-grep verification gates pass | unit + integration + scenarios + build | `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher macro-hard-exclusions mcp-server-tools && npm run test:integration -- --reporter=verbose macro-tool-dispatch && python3 tests/scenarios/directed/testcases/test_macro_dispatch_permissions.py --managed && python3 tests/scenarios/directed/testcases/test_macro_permission_prescan.py --managed && python3 tests/scenarios/directed/testcases/test_macro_delegated_hard_exclusions.py --managed && python3 tests/scenarios/directed/testcases/test_macro_caller_identity.py --managed && python3 tests/scenarios/integration/run_integration.py --managed macro_dispatch_get_then_write && python3 tests/scenarios/integration/run_integration.py --managed macro_permission_failure_zero_side_effects && npm run build` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/macro-dispatcher.test.ts` — stubs and red tests for T-U-156 through T-U-159.
- [ ] `tests/unit/macro-permission-prescan.test.ts` — stubs and red tests for T-U-160 through T-U-164.
- [ ] `tests/unit/macro-hard-exclusions.test.ts` — stubs and red tests for T-U-165 through T-U-168.
- [ ] `tests/unit/macro-caller-identity.test.ts` — stubs and red tests for T-U-169 through T-U-171.
- [ ] `tests/integration/macro-tool-dispatch.test.ts` — integration tests for T-I-003 and T-I-004.
- [ ] `tests/config/vitest.integration.config.ts` — include `tests/integration/macro-tool-dispatch.test.ts` in the explicit integration include list.
- [ ] `tests/scenarios/directed/testcases/test_macro_dispatch_permissions.py` — directed hard-exclusion coverage for ML-11 and ML-12.
- [ ] `tests/scenarios/directed/testcases/test_macro_permission_prescan.py` — directed permission pre-scan coverage for ML-13 and ML-14.
- [ ] `tests/scenarios/directed/testcases/test_macro_delegated_hard_exclusions.py` — directed delegated/host hard-exclusion coverage for ML-15 and ML-16.
- [ ] `tests/scenarios/directed/testcases/test_macro_caller_identity.py` — directed public caller identity boundary coverage for ML-17.
- [ ] `tests/scenarios/integration/tests/macro_dispatch_get_then_write.yml` — YAML multi-native-handler macro workflow coverage for IS-11.
- [ ] `tests/scenarios/integration/tests/macro_permission_failure_zero_side_effects.yml` — YAML permission failure zero-side-effect coverage for IS-12.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Manual review is limited to confirming each downstream implementation agent read:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-14

## Execution Results

### 135-04 Final Verification

| Command | Exit | Outcome |
|---------|------|---------|
| `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` | 0 | Passed: 3 files, 15 tests. Registry, permission pre-scan, and dispatcher gates are green. |
| `npm run test:integration -- --reporter=verbose macro-tool-dispatch` | 0 | Passed: 1 file, 2 tests. Real `fq.write_document` and `fq.search` dispatch through public `call_macro` using `.env.test` credentials. |
| `python3 tests/scenarios/directed/testcases/test_macro_permission_prescan.py --managed` | 0 | Passed: 2/2 steps. Public `call_macro` rejects known host-disallowed tools as `forbidden_tools` before nested execution. |
| `python3 tests/scenarios/directed/testcases/test_macro_delegated_hard_exclusions.py --managed` | 0 | Passed: 2/2 steps. Delegated `runMacroSource` rejects `fq.call_model`; host `runMacroSource` reaches the fake native handler. |
| `python3 tests/scenarios/directed/testcases/test_macro_caller_identity.py --managed` | 0 | Passed: 2/2 steps. Public `call_macro` schema omits `callerKind`; supplied caller identity input is ignored and not echoed. |
| `python3 tests/scenarios/integration/run_integration.py --managed macro_permission_failure_zero_side_effects` | 0 | Passed: 1/1 tests, 2/2 steps. Forbidden macro write is rejected and the target remains absent. |
| `npm run build` | 0 | Passed: production ESM and DTS build completed successfully. |

Notes:
- Integration setup logged an idempotent `fqc_documents.description` drop warning because the column was already absent; the suite completed successfully.
