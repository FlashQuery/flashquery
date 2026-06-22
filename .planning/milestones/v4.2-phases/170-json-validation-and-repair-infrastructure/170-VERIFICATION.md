---
phase: 170-json-validation-and-repair-infrastructure
verified: 2026-06-22T19:34:31Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 170: JSON Validation and Repair Infrastructure Verification Report

**Phase Goal:** Implement the full JSON Validation milestone in one cohesive pass while preserving FlashQuery's public response envelope conventions and existing compatibility fallbacks.
**Verified:** 2026-06-22T19:34:31Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `jsonrepair` is installed as a runtime dependency and production build/typecheck accepts ESM imports. | VERIFIED | `package.json` dependencies include `jsonrepair`; `src/llm/json-repair.ts:1` imports `jsonrepair` through ESM; fresh `npm run typecheck` and `npm run build` passed. |
| 2 | `parseLlmJson<T>()` returns typed, non-throwing success/failure results with raw text, repair metadata, syntax/schema discriminator, Zod issues, and concise summaries. | VERIFIED | `src/llm/json-repair.ts:26-77` implements `jsonrepair -> JSON.parse -> schema.safeParse`; `tests/unit/llm-json-repair.test.ts:7-206` covers valid, repairable, syntax, schema, metadata, and envelope-field constraints. |
| 3 | Macro evaluator tool-result parsing repairs JSON before fallback and preserves token, warning, trace, and budget behavior. | VERIFIED | `src/macro/evaluator.ts:964-968` parses tool text with `parseLlmJson`; `src/macro/evaluator.ts:978-991` still extracts token metadata; `tests/unit/macro-evaluator.test.ts` contains T-U-011 through T-U-014. |
| 4 | Host-template tool parsing repairs structured payloads, populates `structuredContent`, sets `isError` for `{ ok: false }` or irreparable JSON-like payloads, and keeps ordinary prose text-only. | VERIFIED | `src/mcp/host-template-tools.ts:75-109` repairs payloads, maps structured content, preserves prose fallback, and emits `invalid_json_payload`; unit/integration/E2E tests assert success and error behavior. |
| 5 | Macro task result parsing fails unreadable envelopes instead of marking tasks complete, while valid/repairable success, cancellation, and expected-failure envelopes keep current transitions. | VERIFIED | `src/mcp/tools/macro.ts:746-790` calls `parseResultPayload`, fails unreadable envelopes before completion, handles cancellation before expected failures, and returns `invalid_json_payload`; tests cover success, cancellation, expected error, and malformed envelope failure. |
| 6 | Provider tool-call argument normalization repairs before parsing but still rejects irreparable strings and non-object values through the existing invalid-argument path. | VERIFIED | `src/llm/client.ts:163-187` repairs string args through `parseLlmJson` with record schema and rejects irreparable/non-object/native arrays/scalars with the same invalid JSON error; `tests/unit/llm-client.test.ts` contains T-U-024 through native non-object rejection coverage. |
| 7 | Brokered tool text coercion keeps `structuredContent` precedence, preserves plain prose fallback without warning, repairs JSON-like text, warns once on JSON-like fallback, and keeps `isError: true` fail-fast behavior. | VERIFIED | `src/macro/coerce.ts:11-32` checks `isError`, then `structuredContent`, then repaired text, then JSON-like warning/raw fallback; `tests/unit/macro-coerce.test.ts` covers T-U-028 through T-U-032. |
| 8 | Public or near-public tests prove at least one repaired macro/host-template flow and one irreparable structured-channel failure, and all 11 requirements map to green automated evidence. | VERIFIED | `tests/integration/macro-json-repair.test.ts:85-140`, `tests/integration/host-template-json-repair.test.ts:9-52`, E2E tests at `tests/e2e/call-model-template-tools.e2e.test.ts:613-672`, directed scenarios ML-33/ML-34, and YAML scenario IL-45 cover public workflows. Fresh scenario runs passed. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` / `package-lock.json` | Runtime `jsonrepair` dependency | VERIFIED | `jsonrepair` appears in dependencies and lockfile. |
| `src/llm/json-repair.ts` | Pure parser utility | VERIFIED | Exports `parseLlmJson`; no macro/MCP imports; uses ESM `jsonrepair` and Zod `safeParse`. |
| `src/macro/evaluator.ts` | Repaired macro tool-result parsing | VERIFIED | `parseToolResultPayload` calls `parseLlmJson` before raw fallback. |
| `src/mcp/host-template-tools.ts` | Host-template structured repair/error mapping | VERIFIED | `callResultFromTemplateText` populates `structuredContent` or bounded `invalid_json_payload`. |
| `src/mcp/tools/macro.ts` | Macro task result repair/failure transition | VERIFIED | `transitionTaskFromResult` fails unreadable envelopes and keeps valid transition semantics. |
| `src/llm/client.ts` | Provider tool-call argument repair | VERIFIED | `normalizeToolCallArguments` repairs strings and rejects invalid/non-record values. |
| `src/macro/coerce.ts` | Brokered tool text repair/coercion | VERIFIED | `coerceCallToolResult` preserves ordering and warns once on JSON-like fallback. |
| Unit test files | Focused parser and retrofit coverage | VERIFIED | Fresh unit run passed 7 files, 144 tests. |
| Integration/E2E/scenario files | Public workflow evidence | VERIFIED | Integration, E2E, directed, and YAML scenario tests exist and cover the required public flows. |
| Coverage matrices | ML-33, ML-34, IL-45 rows | VERIFIED | Rows present with `Last Passing` 2026-06-22. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/llm/json-repair.ts` | `jsonrepair` | ESM import | VERIFIED | Manual check: `import { jsonrepair } from 'jsonrepair';` at line 1. SDK key-link regex false-negative due escaping. |
| `src/llm/json-repair.ts` | `zod` | `schema.safeParse()` | VERIFIED | Manual check: `schema.safeParse(parsed)` at line 52. SDK key-link regex false-negative due escaping. |
| `src/macro/evaluator.ts` | `src/llm/json-repair.ts` | `parseLlmJson` import/use | VERIFIED | Import at line 26; call at line 966. |
| `src/mcp/host-template-tools.ts` | response helpers | `jsonRuntimeError` invalid payload | VERIFIED | Import at line 15; bounded `invalid_json_payload` at lines 90-98. |
| `src/llm/client.ts` | `src/llm/json-repair.ts` | provider arg normalization | VERIFIED | Import at line 11; call at line 175. |
| `src/macro/coerce.ts` | logger | JSON-like fallback warning | VERIFIED | Import at line 4; `logger.warn` at line 27. SDK key-link regex false-negative due escaping. |
| `tests/integration/macro-json-repair.test.ts` | MCP server public surface | `InMemoryTransport` | VERIFIED | Test lists `call_macro` through an in-memory MCP client/server pair. |
| `tests/e2e/call-model-template-tools.e2e.test.ts` | host-template MCP tools | registered `flashquery_skill_*` calls | VERIFIED | E2E calls generated host-template tools and checks client-visible `structuredContent`/`isError`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/llm/json-repair.ts` | `validated.data` | `jsonrepair(raw)`, `JSON.parse`, caller Zod schema | Yes | VERIFIED |
| `src/macro/evaluator.ts` | parsed tool payload | `ToolResult.content[0].text` from broker/native dispatch | Yes; repaired data flows into macro field access and expected-error extraction | VERIFIED |
| `src/mcp/host-template-tools.ts` | `structuredContent` | host-template generated text parsed by `parseTemplateToolPayload` | Yes; parsed records become MCP result `structuredContent` | VERIFIED |
| `src/mcp/tools/macro.ts` | task envelope payload | macro execution result text parsed by `parseResultPayload` | Yes; parsed payload drives complete/cancel/fail transitions | VERIFIED |
| `src/llm/client.ts` | normalized tool arguments | provider `function.arguments` string/object | Yes; repaired record is dispatched as tool args, invalid data rejected | VERIFIED |
| `src/macro/coerce.ts` | brokered macro value | brokered `CallToolResult` structuredContent/text | Yes; structured content or repaired text JSON converts to `MacroValue` | VERIFIED |
| `tests/scenarios/integration/tests/macro_call_model_json_repair.yml` | `calls_log` tool arguments | mock OpenAI tool-call arguments string | Yes; scenario branches on repaired `identifiers`/`include` fields | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Focused unit evidence for parser and retrofits | `npm run test:unit -- tests/unit/llm-json-repair.test.ts tests/unit/macro-evaluator.test.ts tests/unit/host-template-tools.test.ts tests/unit/macro-task-result.test.ts tests/unit/llm-client.test.ts tests/unit/macro-coerce.test.ts tests/unit/macro-registry.test.ts` | 7 files passed, 144 tests passed | PASS |
| TypeScript strict typecheck | `npm run typecheck` | exited 0 | PASS |
| Production ESM/DTS build | `npm run build` | exited 0; ESM and DTS build success | PASS |
| YAML public call_model repair scenario | `python3 tests/scenarios/integration/run_integration.py --managed macro_call_model_json_repair` | 1/1 passed; 2/2 steps | PASS |
| Directed public JSON repair scenarios | `python3 tests/scenarios/directed/run_suite.py --managed json_repair` | 2/2 tests passed | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| Conventional probes | `find scripts -path '*/tests/probe-*.sh' -type f` | No probe files found | SKIPPED |
| Phase-declared probes | grep phase plans/summaries for probe paths | No probe declarations found | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REQ-001 | 170-01 | `jsonrepair` runtime dependency and ESM build behavior | SATISFIED | Dependency present; typecheck/build passed. |
| REQ-002 | 170-01 | Stateless `parseLlmJson<T>()` repairs, parses, validates, and returns typed non-throwing results | SATISFIED | Parser implementation and T-U-001 through T-U-006 coverage. |
| REQ-003 | 170-01 | Retry-capable callers can distinguish syntax/schema failures and access issues/summaries without parser LLM calls | SATISFIED | `failure: 'syntax' | 'schema'`, `issues`, and bounded summaries in parser result. |
| REQ-004 | 170-02, 170-04 | Macro evaluator repairs tool-result payloads before fallback | SATISFIED | `parseToolResultPayload` uses parser; unit, integration, and directed macro tests pass. |
| REQ-005 | 170-02, 170-04 | Host-template tool payload parsing repairs JSON, populates structured content, and fails irreparable JSON-like payloads | SATISFIED | Host-template production mapping plus unit/integration/E2E/directed evidence. |
| REQ-006 | 170-02, 170-04 | Macro task result parsing fails unreadable envelopes and preserves valid transitions | SATISFIED | `transitionTaskFromResult` and `parseResultPayload` implementation; unit/integration tests. |
| REQ-007 | 170-03 | Provider tool-call argument normalization repairs string arguments and preserves fail-loud invalid path | SATISFIED | `normalizeToolCallArguments` implementation and unit coverage, plus IL-45 public scenario. |
| REQ-008 | 170-03 | Brokered external tool text coercion precedence/fallback/repair/warning/fail-fast behavior | SATISFIED | `coerceCallToolResult` implementation and T-U-028 through T-U-032 tests. |
| REQ-009 | 170-03 | Native FlashQuery tool response parsing unchanged | SATISFIED | `src/macro/registry.ts` production behavior unchanged for this phase; T-U-033/T-U-034 regression tests pass. |
| REQ-010 | 170-02, 170-04 | User-visible parse failures use stable bounded JSON envelopes | SATISFIED | Host-template and macro task failures emit `invalid_json_payload` via response helpers with bounded details; tests assert parseable envelopes. |
| REQ-011 | 170-01, 170-04 | Repair metadata internally testable while public success envelopes avoid broad new top-level fields | SATISFIED | Parser exposes `repaired`; public macro/host-template tests assert no public `repaired` top-level field. |

No orphaned Phase 170 requirements found: `.planning/REQUIREMENTS.md` maps REQ-001 through REQ-011 to Phase 170, and all are claimed by plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| Scoped phase files | n/a | `TBD`, `FIXME`, `XXX` | None | No blocker debt markers found in scoped Phase 170 files. |
| Scoped phase files | n/a | Empty/stub returns and hardcoded empties | Info | Grep matches were existing initial state, test helpers, deliberate fallback code, or unrelated macro-framework wording; none flow as Phase 170 user-visible stubs. |

### Human Verification Required

None. The phase goal is fully covered by automated unit, integration, E2E, directed scenario, YAML scenario, typecheck, and build evidence. No visual, real-time, or external manual-only behavior is part of this phase goal.

### Gaps Summary

No blocking gaps found. The phase goal is achieved in the codebase: shared JSON repair/schema validation exists, all current parse-site retrofits are wired to it, compatibility fallbacks are preserved, irreparable structured failures surface visibly, and public/near-public workflow tests prove the behavior.

Notes:
- `gsd-sdk verify.key-links` produced false negatives for three regex patterns because of escaping, but manual source checks verified the links.
- The working tree contains broad unrelated local macro-framework changes, including a pre-existing modification to `src/macro/evaluator.ts`; this verification did not modify or revert them.
- No later phases exist in the current milestone, so no failed items were deferred.

---

_Verified: 2026-06-22T19:34:31Z_
_Verifier: the agent (gsd-verifier)_
