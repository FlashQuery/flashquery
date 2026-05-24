---
phase: 148-mcp-lifecycle-and-shutdown
phase_number: 148
security_reviewed: 2026-05-24
asvs_level: 2
block_on: open threats
threats_total: 17
threats_closed: 17
threats_open: 0
status: secured
---

# Phase 148 Security Verification

## Scope

This audit verifies only the declared Phase 148 plan-time threat register from plans 01 through 04. Implementation files were treated as read-only; this report is the only file written.

`T-148-SC` appears in all four plan threat models with the same accepted package-install risk. It is counted once as a unique threat ID and documented once below.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-148-01-DOS | Denial of Service | mitigate | CLOSED | `trackHandler()` increments before invoking the handler and decrements in `finally` at `src/mcp/request-lifecycle.ts:46` through `src/mcp/request-lifecycle.ts:52`. T-U-019 covers success, `isError: true`, and thrown-handler paths at `tests/unit/mcp-request-drain.test.ts:19`, `tests/unit/mcp-request-drain.test.ts:36`, and `tests/unit/mcp-request-drain.test.ts:51`. |
| T-148-01-TAMPER | Tampering | mitigate | CLOSED | `waitForIdle()` returns `remaining` from the live `inFlightCount` at `src/mcp/request-lifecycle.ts:96` through `src/mcp/request-lifecycle.ts:100`; timeout handling removes only the waiter/timer, not active work, at `src/mcp/request-lifecycle.ts:87` through `src/mcp/request-lifecycle.ts:94`. T-U-020 asserts the hung request remains in flight at `tests/unit/mcp-request-drain.test.ts:74` through `tests/unit/mcp-request-drain.test.ts:81`. |
| T-148-01-REP | Repudiation | mitigate | CLOSED | `McpDrainResult` includes `elapsedMs`, `timedOut`, and `remaining` at `src/mcp/request-lifecycle.ts:1` through `src/mcp/request-lifecycle.ts:5`, and every `waitForIdle()` return path populates those fields at `src/mcp/request-lifecycle.ts:56` through `src/mcp/request-lifecycle.ts:101`. |
| T-148-02-SDK | Tampering | mitigate | CLOSED | `RegisterToolFunction` is typed as `McpServer['registerTool']` at `src/mcp/tool-catalog.ts:12`; `src/mcp/server.ts` uses that typed alias for wrapper composition at `src/mcp/server.ts:171` through `src/mcp/server.ts:175` and `src/mcp/server.ts:620` through `src/mcp/server.ts:638`. Final validation records the prohibited wrapper grep as passing at `148-final-validation.md:35`. |
| T-148-02-CAT | Elevation of Privilege | mitigate | CLOSED | `wrapServerWithToolCatalog()` pushes the native catalog entry before applying `hostEnabledToolNames` filtering at `src/mcp/tool-catalog.ts:71` through `src/mcp/tool-catalog.ts:80`. T-U-016 asserts catalog names and help schema injection at `tests/unit/native-tool-catalog.test.ts:75` through `tests/unit/native-tool-catalog.test.ts:119`. |
| T-148-02-REP | Repudiation | mitigate | CLOSED | Handler wrapping creates a fresh correlation ID and runs inside `initializeContext()` at `src/mcp/server.ts:136` through `src/mcp/server.ts:146`. T-U-017 asserts correlation IDs inside registered handlers at `tests/unit/mcp-server-correlation.test.ts:96` through `tests/unit/mcp-server-correlation.test.ts:121`. |
| T-148-02-DOS | Denial of Service | mitigate | CLOSED | Registered and native catalog handlers are wrapped through lifecycle tracking at `src/mcp/server.ts:136` through `src/mcp/server.ts:160`; `createMcpServer()` installs the lifecycle before tool registration at `src/mcp/server.ts:608` through `src/mcp/server.ts:619`. Lifecycle attachment is tested at `tests/unit/mcp-server-correlation.test.ts:138` through `tests/unit/mcp-server-correlation.test.ts:170`. |
| T-148-03-DOS | Denial of Service | mitigate | CLOSED | `MCP_REQUEST_DRAIN_TIMEOUT_MS` is `15_000` at `src/server/shutdown.ts:23` through `src/server/shutdown.ts:24`; shutdown drains with `waitForIdle(MCP_REQUEST_DRAIN_TIMEOUT_MS)` at `src/server/shutdown.ts:134` through `src/server/shutdown.ts:139`. T-I-011 advances that deadline and verifies completion at `tests/integration/server/shutdown-mcp-drain.test.ts:163` through `tests/integration/server/shutdown-mcp-drain.test.ts:185`. |
| T-148-03-TAMPER | Tampering | mitigate | CLOSED | Shutdown calls `drainMcpRequests()` before cost writes and resource cleanup at `src/server/shutdown.ts:71` through `src/server/shutdown.ts:89`. T-I-010 starts an active handler, verifies shutdown does not settle, then releases the handler before shutdown continues at `tests/integration/server/shutdown-mcp-drain.test.ts:131` through `tests/integration/server/shutdown-mcp-drain.test.ts:160`. |
| T-148-03-REP | Repudiation | mitigate | CLOSED | Timeout handling sums real remaining counts and warns with the aggregate count at `src/server/shutdown.ts:140` through `src/server/shutdown.ts:145`. T-I-011 asserts the warning contains `1 in-flight` at `tests/integration/server/shutdown-mcp-drain.test.ts:180` through `tests/integration/server/shutdown-mcp-drain.test.ts:185`. |
| T-148-03-INFO | Information Disclosure | accept | CLOSED | Accepted risk logged below. The implemented warning emits only the aggregate count in `MCP request drain timed out with ${remaining} in-flight request(s) remaining` at `src/server/shutdown.ts:140` through `src/server/shutdown.ts:145`; no request arguments or document contents are included. |
| T-148-04-SPOOF | Spoofing | accept | CLOSED | Accepted risk logged below. T-E-001 uses the existing local spawned stdio server fixture and no auth behavior changes were in scope; the concrete transport smoke is at `tests/e2e/protocol.test.ts:201` through `tests/e2e/protocol.test.ts:214`. |
| T-148-04-TAMPER | Tampering | mitigate | CLOSED | Final validation records that D-70 was added because integration/E2E evidence did not prove public shutdown-during-write safety at `148-final-validation.md:6` through `148-final-validation.md:15`. The D-70 scenario sends shutdown during an active public `write_document` and checks successful response, visible vault file, and server exit at `tests/scenarios/directed/testcases/test_shutdown_during_write_drain.py:172` through `tests/scenarios/directed/testcases/test_shutdown_during_write_drain.py:205`. |
| T-148-04-REP | Repudiation | mitigate | CLOSED | Final validation records command, exit code, and short result for T-E-001, D-70, typecheck, lint, knip, unit, integration, E2E, directed, and static wrapper gates at `148-final-validation.md:16` through `148-final-validation.md:35`. |
| T-148-04-SDK | Tampering | mitigate | CLOSED | Final validation records the static wrapper assertion as exit 0/no matches at `148-final-validation.md:35`. A live grep during this audit also found no `server.tool`, `(server as any).registerTool`, or `(server as any).tool` matches under `src/mcp`, `src/server`, or `src/llm`. |
| T-148-04-KNIP | Denial of Service | mitigate | CLOSED | `knip.ts` retains the production-source-only entry graph at `knip.ts:3` through `knip.ts:15` and adds a narrow Phase 148 type-only ignore for `src/mcp/request-lifecycle.ts` at `knip.ts:47` through `knip.ts:49`. Final validation records `npm run knip` exit 0 at `148-final-validation.md:30`. |
| T-148-SC | Tampering | accept | CLOSED | Accepted risk logged below. The phase plans and summaries record no package installs; Phase 148 summaries show `tech-stack.added: []` at `148-01-SUMMARY.md:14` through `148-01-SUMMARY.md:18`, `148-02-SUMMARY.md:14` through `148-02-SUMMARY.md:18`, `148-03-SUMMARY.md:14` through `148-03-SUMMARY.md:18`, and `148-04-SUMMARY.md:14` through `148-04-SUMMARY.md:18`. |

## Accepted Risks Log

| Threat ID | Risk | Acceptance Rationale | Evidence |
|-----------|------|----------------------|----------|
| T-148-03-INFO | Shutdown timeout warnings disclose the count of remaining in-flight MCP requests. | Accepted because aggregate request count is required to make timeout drain behavior auditable and does not reveal request arguments, document contents, paths, tokens, or other user data. | Count-only warning implementation at `src/server/shutdown.ts:140` through `src/server/shutdown.ts:145`; T-I-011 count assertion at `tests/integration/server/shutdown-mcp-drain.test.ts:180` through `tests/integration/server/shutdown-mcp-drain.test.ts:185`. |
| T-148-04-SPOOF | E2E fixture controls a local spawned server without adding auth assertions. | Accepted because Phase 148 does not change authentication; the fixture is scoped to local transport regression coverage for wrapper consolidation, and auth behavior remains owned by prior/future auth phases. | T-E-001 local stdio transport smoke at `tests/e2e/protocol.test.ts:201` through `tests/e2e/protocol.test.ts:214`; final validation scope at `148-final-validation.md:3` through `148-final-validation.md:4`. |
| T-148-SC | No package legitimacy gate was run because no npm package install was planned or performed for Phase 148. | Accepted because the implemented phase used existing dependencies only. The slopcheck/package-legitimacy gate would become mandatory only if execution added a package. | `tech-stack.added: []` in all four plan summaries: `148-01-SUMMARY.md:14` through `148-01-SUMMARY.md:18`, `148-02-SUMMARY.md:14` through `148-02-SUMMARY.md:18`, `148-03-SUMMARY.md:14` through `148-03-SUMMARY.md:18`, and `148-04-SUMMARY.md:14` through `148-04-SUMMARY.md:18`. |

## Unregistered Flags

None. `148-02-SUMMARY.md`, `148-03-SUMMARY.md`, and `148-04-SUMMARY.md` each record `Threat Flags: None`; `148-01-SUMMARY.md` has no new threat flags section.

## Result

All declared Phase 148 threat mitigations are present or explicitly accepted. `threats_open: 0`.
