---
phase: 141
slug: bm25-tool-search-help-pages-and-description-overrides
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-18
---

# Phase 141 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`, `tests/config/vitest.benchmark.config.ts` |
| Quick run command | `npm test -- --run tests/unit/tool-search/*.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts` |
| Full suite command | `npm test && npm run test:integration && npm run test:e2e` |
| Estimated runtime | focused unit: ~30s; full phase gate depends on integration/E2E environment |

## Sampling Rate

- After every task commit: run the focused unit test file for the touched module.
- After every plan wave: run `npm test` plus focused broker/tool-search integration tests.
- Before `$gsd-verify-work`: unit, integration, E2E, directed Phase C, YAML Phase C, and build gates must be green.
- Max feedback latency for ordinary implementation tasks: one focused test command before commit.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 141-01-01 | 01 | 1 | REQ-074..081 | T-141-01 | Indexer is deterministic, idempotent, zero-dependency, and live-count based. | unit | `npm test -- --run tests/unit/tool-search/indexer.test.ts` | no W0 | pending |
| 141-01-02 | 01 | 1 | REQ-088 | T-141-01 | POC corpora and query fixtures are available to regression tests. | source/integration | `test -f tests/fixtures/tool-search/queries.json` | no W0 | pending |
| 141-02-01 | 02 | 1 | REQ-090..091, REQ-094 | T-141-03 | FQ-native tool metadata loader validates shape without startup enforcement. | unit | `npm test -- --run tests/unit/tool-search/tool-meta.test.ts` | no W0 | pending |
| 141-03-01 | 03 | 2 | REQ-093 | T-141-05 | Native help is local and bypasses schema validation only after native visibility lookup. | unit | `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts` | exists extend | pending |
| 141-03-02 | 03 | 2 | REQ-096, REQ-098 | T-141-06 | Native errors get help footer; brokered errors/help remain pass-through. | unit | `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts` | exists extend | pending |
| 141-04-01 | 04 | 2 | REQ-089, REQ-091 | T-141-07 | Core native help pages validate and expose structured help bodies. | unit/source | `npm test -- --run tests/unit/tool-search/tool-meta.test.ts` | no W0 | pending |
| 141-09-01 | 09 | 2 | REQ-089, REQ-091 | T-141-08 | Records/plugin help pages validate and expose structured help bodies. | unit/source | `npm test -- --run tests/unit/tool-search/tool-meta.test.ts` | no W0 | pending |
| 141-10-01 | 10 | 2 | REQ-089, REQ-091, REQ-097 | T-141-09 | LLM/macro/vault/search_tools help pages validate; call_macro strings remain canonical. | unit/source | `npm test -- --run tests/unit/tool-search/tool-meta.test.ts` | no W0 | pending |
| 141-11-01 | 11 | 3 | REQ-089, REQ-092, REQ-095, REQ-099 | T-141-10 | Startup validation blocks missing/malformed metadata after page corpus exists. | unit | `npm test -- --run tests/unit/tool-search/tool-meta.test.ts tests/unit/native-tool-catalog.test.ts` | no W0 | pending |
| 141-05-01 | 05 | 4 | REQ-082..084, REQ-100 | T-141-11 | Search results expose only authorized tools with downstream descriptions and sanitized audit. | unit/integration | `npm test -- --run tests/unit/tool-search/search-tools-handler.test.ts` | no W0 | pending |
| 141-05-02 | 05 | 4 | REQ-011, REQ-085..086 | T-141-11 | Enabled purposes inject only `fq.search_tools`; disabled purposes remain flat. | unit/integration | `npm test -- --run tests/unit/llm-agent-loop.test.ts` | exists extend | pending |
| 141-06-01 | 06 | 5 | REQ-010, REQ-087 | T-141-12 | Host search index is built at startup for `host.tool_search: enabled` with FQ-native and host-visible brokered tools. | integration | `npm run test:integration -- --run tests/integration/tool-search/host-index.integration.test.ts` | no W0 | pending |
| 141-06-02 | 06 | 5 | REQ-087 | T-141-13 | Host-visible `list_changed` events update host index add/remove state within 1 second. | integration | `npm run test:integration -- --run tests/integration/tool-search/host-index.integration.test.ts` | no W0 | pending |
| 141-07-01 | 07 | 6 | REQ-080, REQ-088, REQ-093, REQ-096, REQ-098 | T-141-14 | Ranking, help, audit, metadata validation, and performance budgets hold against production paths. | integration/benchmark | `npm run test:integration -- --run tests/integration/tool-search/search-tools.integration.test.ts` | no W0 | pending |
| 141-07-02 | 07 | 6 | REQ-100..102 | T-141-14 | Override edits do not affect TOFU approval. | integration | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts` | exists extend | pending |
| 141-07-03 | 07 | 6 | T-E-C1 | T-141-14 | Full Phase C gate proves search-enabled purpose discovers and dispatches a brokered tool. | E2E | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` | exists extend | pending |
| 141-08-01 | 08 | 7 | T-S-021, T-S-022 | T-141-15 | Public directed workflows prove help and search round trips. | directed | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_c` | no W0 | pending |
| 141-08-02 | 08 | 7 | T-Y-008, T-Y-013 | T-141-15 | YAML workflows prove override substitution and search dispatch. | YAML scenario | `python3 tests/scenarios/integration/run_integration.py --managed description_override_substitution search_tools_workflow` | no W0 | pending |
| 141-08-03 | 08 | 7 | Phase C test audit | T-141-16 | Validation ledger maps every required Phase C ID including T-I-038..040. | full gate | `npm test -- --run tests/unit/tool-search/*.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts && npm run test:integration -- --run tests/integration/tool-search/search-tools.integration.test.ts tests/integration/tool-search/host-index.integration.test.ts tests/integration/mcp-broker/tofu-list-changed.test.ts && npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts && python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_c && python3 tests/scenarios/integration/run_integration.py --managed description_override_substitution search_tools_workflow && npm run build && npm run lint` | mixed | pending |

## Wave 0 Requirements

- [x] `tests/unit/tool-search/indexer.test.ts` - covers T-U-022..027 and REQ-074..081.
- [x] `tests/unit/tool-search/tool-meta.test.ts` - covers T-U-028..034 and T-U-044.
- [x] `tests/unit/tool-search/search-tools-handler.test.ts` - covers `SearchResult` envelope, empty states, and help discrimination.
- [x] `tests/integration/tool-search/search-tools.integration.test.ts` - covers T-I-033..049 and POC fixture regressions.
- [x] `tests/integration/tool-search/host-index.integration.test.ts` - covers T-I-038, T-I-039, and T-I-040 explicitly.
- [x] `tests/fixtures/tool-search/` - copy POC corpora and query JSON from the MCP Broker product folder.
- [x] `tests/scenarios/directed/testcases/test_mcp_broker_phase_c.py` - covers MCB-21 and MCB-22.
- [x] `tests/scenarios/integration/tests/description_override_substitution.yml` - covers INT-MCB-08.
- [x] `tests/scenarios/integration/tests/search_tools_workflow.yml` - covers INT-MCB-13.

## Executed Phase Gate Results

Run date: 2026-05-18.

| Gate | Command | Outcome | Evidence |
|------|---------|---------|----------|
| Focused unit | `npm test -- --run tests/unit/tool-search/*.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts` | PASS | 5 files passed, 85 tests passed, duration 1.36s. |
| Focused integration, host-index, TOFU | `npm run test:integration -- --run tests/integration/tool-search/search-tools.integration.test.ts tests/integration/tool-search/host-index.integration.test.ts tests/integration/mcp-broker/tofu-list-changed.test.ts` | PASS | 3 files passed, 31 tests passed, duration 31.95s. |
| E2E | `npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` | PASS | 1 file passed, 3 tests passed, duration 11.59s. |
| Directed Phase C | `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup test_mcp_broker_phase_c` | PASS | 1 testcase passed, 2/2 steps passed. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-18-150046.md`. Cleanup timed out at 30s but residue was 0. |
| YAML Phase C | `python3 tests/scenarios/integration/run_integration.py --managed description_override_substitution search_tools_workflow` | PASS | 2/2 workflows passed. Report: `tests/scenarios/integration/reports/integration-report-2026-05-18-150353.md`. |
| Build | `npm run build` | PASS | `tsup` ESM and DTS build succeeded; final explicit run completed successfully. |
| Lint | `npm run lint` | PASS | ESLint completed with zero warnings and zero errors. |

## Phase C Test ID Audit

| Test ID | Status | Evidence |
|---------|--------|----------|
| T-U-022 | PASS | Focused unit gate, `tests/unit/tool-search/indexer.test.ts`. |
| T-U-023 | PASS | Focused unit gate, `tests/unit/tool-search/indexer.test.ts`. |
| T-U-024 | PASS | Focused unit gate, `tests/unit/tool-search/indexer.test.ts`. |
| T-U-025 | PASS | Focused unit gate, `tests/unit/tool-search/indexer.test.ts`. |
| T-U-026 | PASS | Focused unit gate, `tests/unit/tool-search/indexer.test.ts`. |
| T-U-027 | PASS | Focused unit gate, `tests/unit/tool-search/indexer.test.ts`. |
| T-U-028 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-U-029 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-U-030 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-U-031 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-U-032 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-U-033 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-U-034 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-U-044 | PASS | Focused unit gate, `tests/unit/tool-search/tool-meta.test.ts`. |
| T-I-026 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-028 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-029 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-033 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-034 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-035 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-035a | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-036 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-037 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-038 | PASS | Focused integration gate, `tests/integration/tool-search/host-index.integration.test.ts`. |
| T-I-039 | PASS | Focused integration gate, `tests/integration/tool-search/host-index.integration.test.ts`. |
| T-I-040 | PASS | Focused integration gate, `tests/integration/tool-search/host-index.integration.test.ts`. |
| T-I-041 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-042 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-043 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-044 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-045 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-046 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-047 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-048 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-I-049 | PASS | Focused integration gate, `tests/integration/tool-search/search-tools.integration.test.ts`. |
| T-E-C1 | PASS | E2E gate, `tests/e2e/mcp-broker.e2e.test.ts`. |
| T-S-021 | PASS | Directed Phase C gate, `tests/scenarios/directed/testcases/test_mcp_broker_phase_c.py`, MCB-21. |
| T-S-022 | PASS | Directed Phase C gate, `tests/scenarios/directed/testcases/test_mcp_broker_phase_c.py`, MCB-22. |
| T-Y-008 | PASS | YAML Phase C gate, `tests/scenarios/integration/tests/description_override_substitution.yml`, INT-MCB-08. |
| T-Y-013 | PASS | YAML Phase C gate, `tests/scenarios/integration/tests/search_tools_workflow.yml`, INT-MCB-13. |

## Blocking Issues

None remaining. The temporary `purpose is not defined` scenario blocker was fixed in `src/mcp/tools/llm.ts` by preserving the purpose `toolSearch` setting outside the local lookup scope before entering the agent-loop dispatch block.

## Manual-Only Verifications

All phase behaviors should have automated verification. Manual review may still be useful for `.tool.md` prose quality, but it is not a blocker if the metadata, sentinel, and scenario tests pass.

## Validation Sign-Off

- [x] All planned task areas have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references from research.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true` set in frontmatter.
- [x] Wave 0 files created.
- [x] Phase C unit, integration, E2E, directed, YAML, build, and lint gates passed.

**Approval:** Phase C validation complete.
