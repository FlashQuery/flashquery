---
phase: 143
slug: diagnostic-cli-and-remaining-macro-extensions
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-18
---

# Phase 143 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 plus FlashQuery directed and YAML scenario harnesses |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- --run tests/unit/list-tools-command.test.ts tests/unit/macro-self.test.ts tests/unit/macro-parser.test.ts tests/unit/macro-evaluator.test.ts tests/unit/macro-introspection.test.ts` |
| **Full suite command** | `npm run build && npm test && npm run test:integration && npm run test:e2e` plus Phase E directed/YAML scenario commands |
| **Estimated runtime** | ~15-30 minutes for full gate depending on Supabase and scenario availability |

---

## Sampling Rate

- **After every task commit:** Run the focused command for the touched unit or integration file.
- **After every plan wave:** Run `npm run build` plus all Phase E tests added in that wave.
- **Before `$gsd-verify-work`:** Full suite, Phase E directed scenarios, Phase E YAML scenarios, and required coverage ledger updates must be green.
- **Max feedback latency:** 10 minutes for focused gates; full gate may exceed this only at phase close.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 143-01-01 | 01 | 1 | REQ-071..073 | CLI-01 / CLI-02 | CLI uses validated config, keeps successful YAML stdout clean, and surfaces failure stderr only on failure | unit | `npm test -- --run tests/unit/list-tools-command.test.ts` | ❌ W0 | ⬜ pending |
| 143-01-02 | 01 | 1 | REQ-071..073 | CLI-01 / CLI-02 | Diagnostic command exits cleanly and emits parseable `tool_overrides` YAML | directed/YAML | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_e` and `python3 tests/scenarios/integration/run_integration.py --managed cli_list_tools_paste_back` | ❌ W0 | ⬜ pending |
| 143-02-01 | 02 | 1 | REQ-103 | SELF-01 | `_self` is source_ref-only, read-only, and snapshot-based | unit | `npm test -- --run tests/unit/macro-self.test.ts tests/unit/macro-source-ref.test.ts` | ❌ W0 | ⬜ pending |
| 143-02-02 | 02 | 1 | REQ-103 | SELF-01 | `_self.path` and `_self.frontmatter` are observable through public macro scenarios | directed/E2E | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_e` | ❌ W0 | ⬜ pending |
| 143-03-01 | 03 | 2 | REQ-104 | PARSE-01 | `continue` and `break` are parse-time invalid outside loops and runtime-valid inside loops | unit | `npm test -- --run tests/unit/macro-parser.test.ts tests/unit/macro-evaluator.test.ts` | ✅ | ⬜ pending |
| 143-03-02 | 03 | 2 | REQ-104 | PARSE-01 | Loop-control behavior composes with source_ref rundoc scenarios | directed/YAML | `python3 tests/scenarios/integration/run_integration.py --managed macro_extensions_compose_rundoc` | ❌ W0 | ⬜ pending |
| 143-04-01 | 04 | 3 | REQ-109 | HEALTH-01 | `_exists()` uses deep probe with 250 ms timeout and reports hung/unconfigured servers false | unit/integration | `npm test -- --run tests/unit/macro-introspection.test.ts && npm run test:integration -- --run tests/integration/mcp-broker/client-lifecycle.test.ts` | ✅ | ⬜ pending |
| 143-04-02 | 04 | 3 | REQ-110 | CONC-01 | Concurrent macros sharing a brokered server do not cross-contaminate responses or context | integration/E2E | `npm run test:integration -- --run tests/integration/macro-concurrency.test.ts` | ✅ | ⬜ pending |
| 143-05-01 | 05 | 4 | REQ-071..073, REQ-103..104, REQ-109..110 | PHASE-E | Phase E source test plan rows and coverage ledgers are closed or explicitly waived where optional | build/scenario/docs | `npm run build && npm test && npm run test:integration && npm run test:e2e` plus directed/YAML Phase E commands | mixed | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/list-tools-command.test.ts` — stubs and RED tests for REQ-071..073.
- [ ] `tests/unit/macro-self.test.ts` — stubs and RED tests for T-U-038/T-U-039.
- [ ] `tests/integration/macro-concurrency.test.ts` — T-I-050; add to `tests/config/vitest.integration.config.ts` explicit include list if created.
- [ ] `tests/scenarios/directed/testcases/test_mcp_broker_phase_e.py` — MCB-06..011 and MCB-19..020.
- [ ] `tests/scenarios/integration/tests/cli_list_tools_paste_back.yml` — INT-MCB-14.
- [ ] `tests/scenarios/integration/tests/macro_extensions_compose_rundoc.yml` — INT-MCB-15.
- [ ] Coverage ledger rows/updates for `MCB-06..011`, `MCB-19..020`, `INT-MCB-14`, and `INT-MCB-15`.

---

## Manual-Only Verifications

All phase behaviors have automated verification. Optional differential tests T-E-003 and T-E-004 may be documented as waived only if production tests already prove equivalent TOFU hash and error taxonomy contracts.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10m for focused gates
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
