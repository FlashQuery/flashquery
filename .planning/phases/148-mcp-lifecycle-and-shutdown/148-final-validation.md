# Phase 148 Final Validation

**Date:** 2026-05-24
**Scope:** REQ-008 typed MCP registration wrapping and REQ-009 MCP shutdown drain.

## D-70 Decision

**Decision:** D-70 was added.

**Reason:** T-I-010 proves shutdown waits for an already-running tracked handler, and T-E-001 proves a native tool remains callable over stdio after wrapper consolidation. Together they did not prove public shutdown-during-write safety because T-I-010 exercises an integration-level catalog handler directly and T-E-001 does not involve shutdown or a write.

**Added scenario:** `tests/scenarios/directed/testcases/test_shutdown_during_write_drain.py`

**Coverage row:** `D-70` in `tests/scenarios/directed/DIRECTED_COVERAGE.md`

## Evidence Recorded During Task 2

| Gate | Command | Exit | Result |
|------|---------|------|--------|
| T-E-001 focused E2E | `npm run test:e2e -- tests/e2e/protocol.test.ts` | 0 | PASS: 1 file, 31 tests. Existing native `list_vault` call is labeled T-E-001 and asserts the normal MCP text response contract. |
| D-70 standalone directed scenario | `python3 tests/scenarios/directed/testcases/test_shutdown_during_write_drain.py --managed` | 0 | PASS: public `write_document` completed while SIGTERM-triggered shutdown drained the active request; vault file remained visible; managed server exited. |
| D-70 suite-runner focused directed scenario | `python3 tests/scenarios/directed/run_suite.py --managed test_shutdown_during_write_drain` | 0 | PASS: 1/1 directed scenario. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-24-162604.md`. |

## Final Gates

| Gate | Command | Exit | Result |
|------|---------|------|--------|
| Typecheck | `npm run typecheck` | 0 | PASS after final wrapper lint fix. |
| Lint | `npm run lint` | 0 | PASS after removing two no-op type assertions in `src/mcp/server.ts`. |
| Knip | `npm run knip` | 0 | PASS after adding a narrow `knip.ts` `ignoreIssues` entry for `src/mcp/request-lifecycle.ts` exported types. |
| T-U-016..020 focused unit | `npm test -- tests/unit/native-tool-catalog.test.ts tests/unit/mcp-server-correlation.test.ts tests/unit/mcp-request-drain.test.ts` | 0 | PASS: 3 files, 11 tests. |
| T-I-009..011 focused integration | `npm run test:integration -- tests/integration/server/shutdown-mcp-drain.test.ts` | 0 | PASS: 1 file, 3 tests. |
| T-E-001 focused E2E | `npm run test:e2e -- tests/e2e/protocol.test.ts` | 0 | PASS: 1 file, 31 tests. |
| D-70 focused directed scenario | `python3 tests/scenarios/directed/run_suite.py --managed test_shutdown_during_write_drain` | 0 | PASS: 1/1 directed scenario. Report: `tests/scenarios/directed/reports/scenario-report-2026-05-24-163124.md`. |
| Static wrapper assertion | `rg -n "server\\.tool|\\(server as any\\)\\.registerTool|\\(server as any\\)\\.tool" src/mcp src/server src/llm; test $? -eq 1` | 0 | PASS: no dead `server.tool` wrapper or broad `(server as any).registerTool` production wrapper matches. |

## Knip Exception

`src/mcp/request-lifecycle.ts` exports `McpDrainResult` for the lifecycle helper test and shutdown-drain contract. Production code consumes the returned object structurally through `waitForIdle`, so Phase 147's production-source-only Knip graph cannot see the exported type name. `knip.ts` now contains a narrow `ignoreIssues` entry for that file's `types` class only.

## Deviations

**Rule 3 - Blocking final lint gate:** `npm run lint` initially failed on two no-op type assertions in `src/mcp/server.ts` introduced by the Phase 148 wrapper work. The assertions were removed without behavior change in commit `b099734`, and `npm run typecheck` plus `npm run lint` passed afterward.
