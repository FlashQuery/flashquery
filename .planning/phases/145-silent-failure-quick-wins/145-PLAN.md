---
phase: 145-silent-failure-quick-wins
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/mcp/tools/memory.ts
  - src/mcp/tool-help/write_memory.tool.md
  - src/mcp/tool-metadata.ts
  - src/services/scanner.ts
  - src/services/maintenance.ts
  - tests/unit/write-memory.test.ts
  - tests/unit/scanner-embed-drain-status.test.ts
  - tests/unit/maintain-vault.test.ts
  - tests/integration/mcp/tools/memory-plugin-scope.test.ts
  - tests/integration/services/scanner-embed-drain.test.ts
  - tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
autonomous: true
requirements:
  - REQ-001
  - REQ-002
must_haves:
  truths:
    - "write_memory create-mode returns a structured expected JSON error for plugin-scope lookup failures."
    - "Failed plugin-scope lookup never inserts a global-scoped memory."
    - "Scanner EMBED-DRAIN query failures continue the scan but return embeddingStatus drain_query_failed."
    - "Maintenance output handles the new scanner status without silently assuming complete."
    - "Required unit and integration coverage exists; D-68 is added only if public MCP behavior is otherwise unproven."
  artifacts:
    - path: "src/mcp/tools/memory.ts"
      provides: "typed plugin-scope lookup result and pre-insert lookup_failed branch"
      contains: "jsonExpectedError"
    - path: "src/services/scanner.ts"
      provides: "ScanResult.embeddingStatus drain_query_failed variant"
      contains: "drain_query_failed"
    - path: "tests/unit/write-memory.test.ts"
      provides: "T-U-001 through T-U-003"
    - path: "tests/unit/scanner-embed-drain-status.test.ts"
      provides: "T-U-004"
    - path: "tests/unit/maintain-vault.test.ts"
      provides: "T-U-005"
    - path: "tests/integration/mcp/tools/memory-plugin-scope.test.ts"
      provides: "T-I-001 with .env.test skip behavior"
    - path: "tests/integration/services/scanner-embed-drain.test.ts"
      provides: "T-I-002 with .env.test skip behavior"
  key_links:
    - from: "src/mcp/tools/memory.ts"
      to: "src/mcp/utils/response-formats.ts"
      via: "jsonExpectedError for lookup_failed"
      pattern: "jsonExpectedError"
    - from: "src/services/scanner.ts"
      to: "src/services/maintenance.ts"
      via: "ScanResult.embeddingStatus"
      pattern: "drain_query_failed"
    - from: "tests/integration/mcp/tools/memory-plugin-scope.test.ts"
      to: "tests/helpers/test-env.ts"
      via: "HAS_SUPABASE skip gate"
      pattern: "describe.skipIf"
---

<objective>
Make the two confirmed silent-degradation paths return explicit failure state for Phase 145 only.

Purpose: REQ-001 prevents failed plugin-scope lookups from silently creating global memories. REQ-002 prevents scanner drain query failures from being reported as complete.

Output: Production changes, focused unit tests T-U-001..T-U-005, integration tests T-I-001..T-I-002 with `.env.test` skip behavior, and conditional directed scenario D-68 only if implementation-time coverage review finds public MCP lookup failure behavior is not proven.
</objective>

<execution_context>
@/Users/matt/.codex/get-shit-done/workflows/execute-plan.md
@/Users/matt/.codex/get-shit-done/templates/summary.md
</execution_context>

<context>
Downstream implementation, review, and verification agents MUST read these two external remediation docs first, before reading source files or running tests:

1. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md`
2. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md`

Then read:

@.planning/phases/145-silent-failure-quick-wins/145-CONTEXT.md
@.planning/phases/145-silent-failure-quick-wins/145-RESEARCH.md
@.planning/phases/145-silent-failure-quick-wins/145-PATTERNS.md
@.planning/ROADMAP.md
@AGENTS.md

Phase 145 locked decisions:

- REQ-001: `lookup_failed` is an anticipated lookup failure and MUST be returned through `jsonExpectedError`, not `jsonRuntimeError`; the returned tool result should not use runtime `isError: true`.
- REQ-001: The expected JSON error MUST include `details.reason = "lookup_failed"` and MUST be returned before constructing or inserting the memory row.
- REQ-001: `plugin_scope` omitted or exactly `global` continues to write `plugin_scope: "global"`. A successful `find_plugin_scope` RPC match continues to write the matched plugin scope.
- REQ-001: RPC error objects, thrown RPC failures, and unexpected RPC result shapes must not fall back to global. Remove the `as unknown as Promise<...>` double assertion at the lookup site.
- REQ-002: Add `drain_query_failed` as an explicit `ScanResult.embeddingStatus` variant.
- REQ-002: Both thrown unembedded-document query failures and Supabase error-object query failures map to `drain_query_failed`.
- REQ-002: Query failure logging uses `logger.error` and a stable grep-friendly event string containing `EMBED-DRAIN` and `drain_query_failed`.
- REQ-002: Maintenance output may continue to hide scanner internals, but tests must prove the new status is handled and not silently broken.
- Scope fence: Do not implement durable embedding retry state, background embedding helper consolidation, record pg pooling, dependency hygiene, MCP lifecycle changes, cycle breaks, config metadata typing, or unrelated audit findings.

<interfaces>
Existing contracts and insertion points:

- `src/mcp/tools/memory.ts` imports `jsonExpectedError`, `jsonRuntimeError`, and `jsonToolResult` from `src/mcp/utils/response-formats.ts`.
- Current `resolvePluginScope(config, pluginScope)` returns `Promise<string>` and falls back to `global` on RPC error/throw; replace it with an explicit typed result or runtime-narrowed result shape.
- Create mode currently calls `resolvePluginScope` before creating `memoryId` and `insertRow`; the lookup_failed branch must occur before `memoryId`, `insertRow`, and `.from('fqc_memory').insert(...)`.
- `src/services/scanner.ts` currently defines `ScanResult.embeddingStatus` as `'complete' | 'partial' | 'timed_out' | 'skipped'`; extend this union with `'drain_query_failed'`.
- `src/services/maintenance.ts` consumes `ScanResult` in `executeActions` and `scanCounts`; handle `drain_query_failed` explicitly while preserving the public decision to hide raw `embedding_status` and `embeds_awaited` fields.
- Integration tests should import `HAS_SUPABASE` and related values from `tests/helpers/test-env.ts` and use `describe.skipIf(!HAS_SUPABASE)`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Hard-fail write_memory plugin-scope lookup failures before insert</name>
  <files>src/mcp/tools/memory.ts, src/mcp/tool-help/write_memory.tool.md, src/mcp/tool-metadata.ts, tests/unit/write-memory.test.ts, tests/integration/mcp/tools/memory-plugin-scope.test.ts</files>
  <behavior>
    - T-U-001: omitted `plugin_scope` and exact `global` create a memory with `plugin_scope: "global"`, and a successful `find_plugin_scope` RPC match writes the matched scope.
    - T-U-002: RPC error object and thrown RPC failure return a parsed JSON envelope with `error: "lookup_failed"` and `details.reason: "lookup_failed"` through `jsonExpectedError`; `result.isError` is false or absent, and `.from('fqc_memory').insert(...)` is not called.
    - T-U-003: unexpected RPC payload shape is rejected as `lookup_failed` without falling back to `global` and without retaining the `as unknown as Promise<...>` double assertion.
    - T-I-001: with `.env.test` present, the public `write_memory` handler refuses a controlled lookup failure and no global-scoped memory row is inserted for the test instance; without `.env.test`, the suite skips via `describe.skipIf(!HAS_SUPABASE)`.
  </behavior>
  <action>Implement REQ-001 exactly as locked in the phase context and user decisions. Follow the mapped analogs in `145-PATTERNS.md`: use the existing handler-capture and Supabase-chain style from `tests/unit/write-memory.test.ts`, the response-helper pattern from `src/mcp/utils/response-formats.ts`, and the integration skip pattern from existing integration tests that import `tests/helpers/test-env.ts`. First add failing unit coverage to `tests/unit/write-memory.test.ts` for T-U-001 through T-U-003. Then replace `resolvePluginScope` in `src/mcp/tools/memory.ts` with a discriminated typed result or explicit local response interface plus runtime narrowing. Preserve omitted/global and successful match behavior. For RPC error objects, thrown lookup failures, and invalid RPC result shape, return `{ ok: false, reason: "lookup_failed", message }` or equivalent. In create mode, branch on that failed result before `randomUUID`, before `insertRow`, and before any insert; return `jsonExpectedError({ error: "lookup_failed", message, details: { reason: "lookup_failed" } })`. Do not use `jsonRuntimeError` for lookup_failed. Keep the branch inside the existing try/finally so write locks still release. Update `src/mcp/tool-help/write_memory.tool.md` to document visible `plugin_scope` lookup failure behavior; touch `src/mcp/tool-metadata.ts` only if implementation finds plugin-scope behavior documented there. Add T-I-001 in `tests/integration/mcp/tools/memory-plugin-scope.test.ts` using `HAS_SUPABASE` skip behavior; after `initSupabase`, use a controlled wrapper or spy around the initialized Supabase client so the handler sees a deterministic `find_plugin_scope` failure while DB reads for absence checks still hit the real test database. Clean up by `instance_id`.</action>
  <verify>
    <automated>npm test -- tests/unit/write-memory.test.ts</automated>
    <automated>npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts</automated>
    <automated>! rg -n "as unknown as Promise|defaulting to 'global'|jsonRuntimeError\\(\\{[^\\n]*lookup_failed" src/mcp/tools/memory.ts</automated>
    <automated>rg -n "lookup_failed|jsonExpectedError" src/mcp/tools/memory.ts src/mcp/tool-help/write_memory.tool.md tests/unit/write-memory.test.ts tests/integration/mcp/tools/memory-plugin-scope.test.ts</automated>
  </verify>
  <acceptance_criteria>REQ-001 is complete when failed plugin-scope lookup returns structured expected JSON with `details.reason: "lookup_failed"`, does not set runtime `isError: true`, does not insert a memory, preserves global/matched success behavior, removes the double assertion, and has unit plus integration coverage or a documented `.env.test` skip.</acceptance_criteria>
  <done>REQ-001 behavior, docs, unit coverage T-U-001..T-U-003, and integration coverage T-I-001 are implemented or skipped only through the documented `.env.test` integration gate.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add drain_query_failed scanner status and explicit maintenance handling</name>
  <files>src/services/scanner.ts, src/services/maintenance.ts, tests/unit/scanner-embed-drain-status.test.ts, tests/unit/maintain-vault.test.ts, tests/integration/services/scanner-embed-drain.test.ts</files>
  <behavior>
    - T-U-004: Supabase error-object response from the EMBED-DRAIN unembedded-document query returns `embeddingStatus: "drain_query_failed"`, scan still resolves, and `logger.error` includes `EMBED-DRAIN` and `drain_query_failed`.
    - T-U-004: thrown EMBED-DRAIN unembedded-document query failure maps to the same status and log behavior.
    - T-U-004: if embed promises time out, `timed_out` keeps precedence over `drain_query_failed`; otherwise drain query failure must not be overwritten by the no-embeds complete branch.
    - T-U-005: `maintain_vault` handles `embeddingStatus: "drain_query_failed"` explicitly and does not leak raw `embedding_status` or `embeds_awaited` internals.
    - T-I-002: with `.env.test` present, a controlled scanner drain query failure returns explicit partial-success status; without `.env.test`, the suite skips via `describe.skipIf(!HAS_SUPABASE)`.
  </behavior>
  <action>Implement REQ-002 exactly as locked. Follow the mapped analogs in `145-PATTERNS.md`: isolate EMBED-DRAIN coverage in a focused scanner unit file rather than expanding the broad `tests/unit/scanner.test.ts`, mirror the `tests/unit/maintain-vault.test.ts` mocked `runScanOnce` pattern for consumer coverage, and use integration-test skip conventions from `tests/helpers/test-env.ts`. First add a focused unit file `tests/unit/scanner-embed-drain-status.test.ts` for the drain failure cases instead of growing the broad scanner unit file. Extend `ScanResult.embeddingStatus` in `src/services/scanner.ts` with `"drain_query_failed"`. Track a local failure flag around the Phase 2 unembedded-doc query. Set it for both `{ error }` query results and thrown query failures. Replace warning-only query failure logs with `logger.error` and a stable event string such as `[EMBED-DRAIN] drain_query_failed`. Preserve scan continuation. Compute final `embeddingStatus` so `timed_out` remains highest precedence, then `drain_query_failed`, then existing complete/skipped behavior. Update `src/services/maintenance.ts` to handle the new variant explicitly; maintenance output may continue hiding scanner internals, but add a stable public warning such as `embedding_drain_query_failed` if that is the local pattern chosen. Add T-U-005 in `tests/unit/maintain-vault.test.ts` with mocked `runScanOnce` returning `embeddingStatus: "drain_query_failed"`. Add T-I-002 in `tests/integration/services/scanner-embed-drain.test.ts` using `HAS_SUPABASE` skip behavior; after real Supabase initialization, wrap or spy the client so only the unembedded-doc drain query fails deterministically while the rest of `runScanOnce` exercises real temp-vault and DB paths. Clean up temp vault and rows by test instance.</action>
  <verify>
    <automated>npm test -- tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts</automated>
    <automated>npm run test:integration -- tests/integration/services/scanner-embed-drain.test.ts</automated>
    <automated>rg -n "drain_query_failed|\\[EMBED-DRAIN\\].*drain_query_failed|embedding_drain_query_failed" src/services/scanner.ts src/services/maintenance.ts tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts tests/integration/services/scanner-embed-drain.test.ts</automated>
  </verify>
  <acceptance_criteria>REQ-002 is complete when scanner query error objects and thrown query failures return `embeddingStatus: "drain_query_failed"`, log error-level stable EMBED-DRAIN text, continue scanning, preserve timeout precedence, and maintenance has explicit unit coverage for the new status without exposing raw scanner internals.</acceptance_criteria>
  <done>REQ-002 behavior, scanner status typing, maintenance handling, unit coverage T-U-004..T-U-005, and integration coverage T-I-002 are implemented or skipped only through the documented `.env.test` integration gate.</done>
</task>

<task type="auto">
  <name>Task 3: Run final gates and add D-68 only if public MCP behavior remains unproven</name>
  <files>tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py, tests/scenarios/directed/DIRECTED_COVERAGE.md, .planning/phases/145-silent-failure-quick-wins/145-SUMMARY.md</files>
  <action>After Tasks 1 and 2 pass, assess whether the unit and integration tests prove public MCP `write_memory` lookup failure behavior: handler-level public response, parseable `lookup_failed`, expected-error `isError` behavior, and no global fallback write. If that behavior is proven by T-U-002/T-U-003 plus T-I-001, do not add D-68; document the non-add decision in the phase summary with the exact tests that prove the public behavior. If not proven, add directed scenario D-68 as `tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py` following `tests/scenarios/directed/testcases/test_memory_plugin_scope.py`, and update `tests/scenarios/directed/DIRECTED_COVERAGE.md`. The scenario must assert the public MCP call returns JSON with `lookup_failed` and does not create a global fallback memory. Do not add any directed scanner scenario in Phase 145. Write `.planning/phases/145-silent-failure-quick-wins/145-SUMMARY.md` summarizing files changed, test results, integration skips caused by missing `.env.test`, and whether D-68 was added or intentionally not added.</action>
  <verify>
    <automated>npm test -- tests/unit/write-memory.test.ts tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts</automated>
    <automated>npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts tests/integration/services/scanner-embed-drain.test.ts</automated>
    <automated>npm run typecheck</automated>
    <automated>npm run lint</automated>
    <automated>if test -f tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py; then python3 tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py --managed; else test "$(rg -v '^#' .planning/phases/145-silent-failure-quick-wins/145-SUMMARY.md | rg -c 'D-68 not added|D-68 intentionally not added')" -ge 1; fi</automated>
  </verify>
  <acceptance_criteria>Final gate is complete when focused unit tests, integration tests or their `.env.test` skips, typecheck, and lint are recorded; D-68 is either present and runnable or explicitly not added with evidence that T-I-001 proves public MCP lookup failure behavior.</acceptance_criteria>
  <done>Final verification results and the D-68 add-or-not-add decision are recorded in `.planning/phases/145-silent-failure-quick-wins/145-SUMMARY.md`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP caller to write_memory | Untrusted tool params cross into memory persistence and plugin-scope lookup. |
| FlashQuery to Supabase RPC/query | External service responses and failures shape persistence and scanner status. |
| Scanner to maintain_vault output | Internal scanner statuses cross into public maintenance action output. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-145-01 | Elevation of privilege / Information disclosure | `src/mcp/tools/memory.ts` plugin-scope lookup | mitigate | Fail closed with `jsonExpectedError` `lookup_failed` before insert; never write global fallback on lookup infrastructure failure. |
| T-145-02 | Tampering | `find_plugin_scope` RPC payload | mitigate | Use explicit local response shape plus runtime narrowing; reject unexpected shapes as `lookup_failed`. |
| T-145-03 | Repudiation | `src/services/scanner.ts` EMBED-DRAIN query | mitigate | Return `drain_query_failed` and log `logger.error` with stable `[EMBED-DRAIN] drain_query_failed` text. |
| T-145-04 | Information disclosure | `src/services/maintenance.ts` public output | mitigate | Handle new scanner status explicitly while preserving current hiding of raw `embedding_status` and `embeds_awaited` internals. |
| T-145-SC | Tampering | npm installs | accept | No new packages or package-manager install tasks are planned for Phase 145. |
</threat_model>

<source_audit>
## Multi-Source Coverage Audit

| Source | Item | Coverage |
|--------|------|----------|
| GOAL | Make two silent-degradation paths return explicit failure state | Covered by Tasks 1 and 2. |
| REQ | REQ-001 plugin scope lookup failures hard-fail and are typed | Covered by Task 1. |
| REQ | REQ-002 scanner embed drain reports query failure as partial success | Covered by Task 2. |
| RESEARCH | Use discriminated result/runtime narrowing; remove double assertion | Covered by Task 1. |
| RESEARCH | Add `drain_query_failed`, stable error log, timeout precedence | Covered by Task 2. |
| CONTEXT | Mandatory external remediation docs must be read first | Encoded in `<context>` and final summary expectations. |
| CONTEXT | `lookup_failed` via `jsonExpectedError`, not runtime `isError` | Covered by Task 1. |
| CONTEXT | Maintenance may hide scanner internals but must have consumer coverage | Covered by Task 2. |
| CONTEXT | T-I-001 and T-I-002 with `.env.test` skip behavior | Covered by Tasks 1 and 2. |
| CONTEXT | D-68 conditional only if public behavior is unproven | Covered by Task 3. |
| DEFERRED | Durable embedding retry, background helper, pg pooling, MCP lifecycle, cycles, config metadata typing | Excluded by scope fence. |
</source_audit>

<verification>
Overall phase checks:

1. `npm test -- tests/unit/write-memory.test.ts tests/unit/scanner-embed-drain-status.test.ts tests/unit/maintain-vault.test.ts`
2. `npm run test:integration -- tests/integration/mcp/tools/memory-plugin-scope.test.ts tests/integration/services/scanner-embed-drain.test.ts`
3. `npm run typecheck`
4. `npm run lint`
5. If D-68 is added: `python3 tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py --managed`
6. Static grep checks:
   - `rg -n "as unknown as Promise<" src/mcp/tools/memory.ts` returns no matches.
   - `rg -n "defaulting to 'global'" src/mcp/tools/memory.ts` returns no lookup-failure fallback matches.
   - `rg -n "drain_query_failed" src/services/scanner.ts src/services/maintenance.ts tests` returns production and test coverage.
</verification>

<success_criteria>
Phase 145 succeeds when:

1. Failed `write_memory` plugin-scope lookup returns a `jsonExpectedError` JSON envelope with `details.reason: "lookup_failed"` and no runtime `isError: true`.
2. Failed lookup is returned before insert, and no global-scoped fallback memory is created.
3. `ScanResult.embeddingStatus` includes and returns `drain_query_failed` for thrown and error-object EMBED-DRAIN query failures.
4. EMBED-DRAIN query failures log through `logger.error` with stable grep-friendly text containing `EMBED-DRAIN` and `drain_query_failed`.
5. Maintenance handles the new status explicitly while preserving the decision to hide scanner internals unless a stable public warning is intentionally added.
6. Unit tests T-U-001 through T-U-005 exist and pass.
7. Integration tests T-I-001 and T-I-002 exist and either run or skip through `.env.test` conventions.
8. D-68 is added only if unit plus integration coverage does not prove public MCP lookup failure behavior; the summary documents the decision either way.
9. `npm run typecheck` and `npm run lint` pass.
</success_criteria>

<output>
Create `.planning/phases/145-silent-failure-quick-wins/145-SUMMARY.md` when done.
</output>
