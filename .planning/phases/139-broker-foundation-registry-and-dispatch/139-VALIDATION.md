---
phase: 139
slug: broker-foundation-registry-and-dispatch
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-17
completed: 2026-05-18T02:48:57Z
---

# Phase 139 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + FlashQuery directed/YAML scenario harnesses |
| **Config file** | `vitest.config.ts`; `tests/scenarios/directed/`; `tests/scenarios/integration/` |
| **Quick run command** | `npm test -- --run tests/unit/mcp-broker*.test.ts tests/unit/macro-coerce.test.ts` |
| **Full suite command** | `npm run build && npm test && npm run test:integration` |
| **Estimated runtime** | ~120-300 seconds depending on integration server startup |

---

## Sampling Rate

- **After every task commit:** Run the relevant unit or integration subset named in the task.
- **After every plan wave:** Run `npm run build` plus all tests added or modified in that wave.
- **Before `$gsd-verify-work`:** Phase A foundation tests from the MCP Broker Test Plan must pass or be explicitly skipped for missing external credentials.
- **Max feedback latency:** 300 seconds for normal phase feedback; longer E2E/scenario runs may be reserved for plan completion gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 139-01-config | 01 | 1 | REQ-001..012 | T-139-config / command injection | Config rejects unsupported transports and unknown server IDs | unit | `npm test -- --run tests/unit/config.test.ts tests/unit/mcp-broker-tofu.test.ts` | found | passed |
| 139-02-client | 02 | 1 | REQ-013..026, REQ-054..060 | T-139-process / untrusted child process | Stdio servers are isolated child processes with timeout, stderr, shutdown, and no reverse capabilities | integration | `npm run test:integration -- --run tests/integration/mcp-broker` | found | passed |
| 139-03-registry-errors | 03 | 1 | REQ-027..032, REQ-050..053 | T-139-registry / tool confusion | Namespaces prevent collisions and error serialization strips raw data | unit | `npm test -- --run tests/unit/mcp-broker-registry.test.ts tests/unit/mcp-broker-errors.test.ts` | found | passed |
| 139-04-dispatch | 04 | 2 | REQ-002..003, REQ-033..037, REQ-106..108 | T-139-dispatch / argument mutation and trace omission | Broker dispatch preserves visibility, raw CallToolResult semantics, bit-exact args, and resolved-cost `tool_calls` trace entries | unit/integration | `npm test -- --run tests/unit/macro-coerce.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro-registry.test.ts && npm run test:integration -- --run tests/integration/mcp-broker` | found | passed |
| 139-05-scenarios | 05 | 2 | Phase 139 success criteria | T-139-e2e / regression escape | Scenario and E2E coverage exercises host/delegated/macro foundation paths plus brokered cost trace assertions | directed/YAML/E2E | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` plus scenario runners | found | passed |
| 139-06-yaml-final | 06 | 2 | INT-MCB-01, INT-MCB-04, INT-MCB-05, INT-MCB-07 | T-139-dispatch / final regression gate | YAML scenarios exercise public `call_model` broker dispatch, fail-loud unknown server handling, and resolved cost trace metadata | YAML/build | `python3 tests/scenarios/integration/run_integration.py --managed brokered_purpose_dispatch host_unknown_server_fail_loud purpose_unknown_server_fail_loud cost_per_call_resolution && npm run build` | found | passed |

---

## Wave 0 Requirements

- [x] `tests/fixtures/mcp-servers/` - POC-derived basic/auth/quirky MCP test servers.
- [x] `tests/unit/mcp-broker-registry.test.ts` - registry-key and macro-ref utilities.
- [x] `tests/unit/mcp-broker-errors.test.ts` - `formatToolError` taxonomy and raw-stripping behavior.
- [x] `tests/unit/macro-coerce.test.ts` - `CallToolResult` coercion and `isError` carve-out.
- [x] `tests/integration/mcp-broker/` - lazy spawn, stderr, timeouts, restart, health, and capability posture.

---

## Final Gate Results

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| Unit foundation | `npm test -- --run tests/unit/config.test.ts tests/unit/mcp-broker-tofu.test.ts tests/unit/mcp-broker-registry.test.ts tests/unit/mcp-broker-errors.test.ts tests/unit/macro-coerce.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/macro-registry.test.ts` | passed | 7 files, 92 tests |
| Integration broker | `npm run test:integration -- --run tests/integration/mcp-broker` | passed | 2 files, 16 tests; setup build passed |
| E2E broker | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` | passed | 1 file, 1 test; setup build passed |
| Directed scenario | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_a` | passed | 1 test, 3/3 steps, residue 0 |
| YAML integration | `python3 tests/scenarios/integration/run_integration.py --managed brokered_purpose_dispatch host_unknown_server_fail_loud purpose_unknown_server_fail_loud cost_per_call_resolution` | passed | 4/4 tests; report `tests/scenarios/integration/reports/integration-report-2026-05-17-234857.md` |
| Production build | `npm run build` | passed | `tsup` ESM and DTS outputs completed |

## Warnings

- The directed scenario runner reported cleanup timeout warnings before and after `test_mcp_broker_phase_a`, but the suite completed successfully with `RESIDUE 0`. No validation skip or failure was recorded.
- No tests were skipped for missing credentials during the final gate.

---

## Manual-Only Verifications

All Phase 139 behaviors should have automated verification. Manual review is limited to confirming that every downstream plan references the two source docs:

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Plans instruct downstream agents to read the source requirements and test plan | User constraint | This is a planning artifact quality requirement | Inspect each `139-*-PLAN.md` for mandatory refs to both source docs |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing fixture/test scaffolding references.
- [x] No watch-mode flags in verification commands.
- [x] Feedback latency stays under 300 seconds for normal gates.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** passed
