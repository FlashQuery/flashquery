---
phase: 122
slug: host-tool-exposure-config
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-11
---

# Phase 122 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest plus Python directed/YAML scenario runners |
| **Config file** | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` |
| **Quick run command** | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/config.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/mcp-server-tools.test.ts` |
| **Full suite command** | `npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/run_suite.py --managed foundation && python3 tests/scenarios/integration/run_integration.py --managed foundation && npm run build` |
| **Estimated runtime** | ~900 seconds for full suite; focused task commands should stay under ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused unit test file(s) touched by the task.
- **After every plan wave:** Run the quick command plus any added integration/E2E/scenario test for that wave.
- **Before `$gsd-verify-work`:** Run focused unit/integration/E2E/scenario checks plus `npm run build`; run the full suite when local services and `.env.test` are available.
- **Max feedback latency:** 120 seconds for task-level feedback; 900 seconds for phase-gate feedback.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 122-01-01 | 01 | 1 | CFG-01 | T-122-01 | Strict YAML parsing and selector validation rejects malformed config without corrupting startup state | unit | `npm test -- tests/unit/config.test.ts tests/unit/tool-metadata.test.ts` | ✅ | ✅ green |
| 122-01-02 | 01 | 1 | CFG-02 | T-122-02 | Final deny layer prevents selected tools from being exposed | unit | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts` | ✅ | ✅ green |
| 122-01-03 | 01 | 1 | CFG-03 | T-122-03 | `doc-write` implies `doc-read`; `doc-read` alone remains read-only | unit/integration | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts` | ✅ | ✅ green |
| 122-02-01 | 02 | 2 | CFG-04 | T-122-04 | Host-disabled tools are skipped before MCP SDK registration and absent from `listTools` | integration/e2e | `npm test -- tests/unit/mcp-server-tools.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | ✅ | ✅ green |
| 122-02-02 | 02 | 2 | CFG-04 | T-122-05 | Delegated native tool assembly cannot regain host-disabled tools | unit/e2e | `npm test -- tests/unit/llm-tool-registry.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | ✅ | ✅ green |
| 122-03-01 | 03 | 2 | CFG-05 | T-122-06 | Legacy removed purpose tool names hard-fail with replacement suggestions and no alias rewrite | unit/integration | `npm test -- tests/unit/llm-config.test.ts tests/unit/config.test.ts && npm run test:integration -- tests/integration/llm-config-sync.test.ts` | ✅ | ✅ green |
| 122-03-02 | 03 | 2 | CFG-06 | T-122-07 | Suspicious category combinations warn without blocking startup and without writing raw stdout | unit | `npm test -- tests/unit/config.test.ts tests/unit/tool-exposure.test.ts` | ✅ | ✅ green |
| 122-04-01 | 04 | 3 | CFG-01..CFG-06 | T-122-08 | Scenario ledgers and runnable scenarios prove user-visible host/delegated filtering behavior | directed/integration scenario | `python3 tests/scenarios/directed/run_suite.py --managed foundation && python3 tests/scenarios/integration/run_integration.py --managed foundation` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Phase-local traceability table exists and maps CFG-01..CFG-06 to unit, integration, E2E, directed scenario, and integration scenario coverage.
- [x] `tests/unit/tool-exposure.test.ts` exists for `src/mcp/tool-exposure.ts`.
- [x] Host-filtered config fixture exists for E2E protocol runs: `tests/fixtures/flashquery.e2e.host-filtered.yaml`.
- [x] Directed coverage rows `D-foundation-tools-*` are added before runnable directed cases.
- [x] Integration coverage rows `INT-foundation-tools-*` are added before runnable YAML workflows.

## Executed Validation Evidence

| Command | Result | Notes |
|---------|--------|-------|
| `npm test -- tests/unit/tool-metadata.test.ts tests/unit/config.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/mcp-server-tools.test.ts` | ✅ passed | 4 files, 67 tests |
| `npm test -- tests/unit/tool-exposure.test.ts tests/unit/llm-config.test.ts` | ✅ passed | 2 files, 45 tests |
| `npm run test:integration -- tests/integration/llm-config-sync.test.ts` | ✅ passed | 1 file, 4 tests, used `.env.test` Supabase credentials |
| `npm run test:e2e -- tests/e2e/protocol.test.ts` | ✅ passed | 1 file, 14 tests, includes `tests/fixtures/flashquery.e2e.host-filtered.yaml` |
| `python3 tests/scenarios/directed/run_suite.py --managed foundation` | ✅ passed | 2 managed directed tests including `test_foundation_host_tool_exposure` |
| `python3 tests/scenarios/integration/run_integration.py --managed foundation` | ✅ passed | 2 managed YAML workflows including `foundation_host_tool_exposure` with 5 host exposure steps |
| `npm run build` | ✅ passed | tsup ESM and DTS build |

---

## Manual-Only Verifications

All phase behaviors have automated verification. Manual review should only confirm that warning wording is actionable and does not imply `host_mcp_tools` is a security boundary.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 900s for phase gate and < 120s for task feedback
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** automated evidence complete
