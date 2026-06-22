---
phase: 170
reviewed: 2026-06-22T19:23:55Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/llm/client.ts
  - src/llm/json-repair.ts
  - src/macro/coerce.ts
  - src/macro/evaluator.ts
  - src/mcp/host-template-tools.ts
  - src/mcp/tools/macro.ts
  - tests/config/vitest.integration.config.ts
  - tests/e2e/call-model-template-tools.e2e.test.ts
  - tests/integration/host-template-json-repair.test.ts
  - tests/integration/macro-json-repair.test.ts
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
  - tests/scenarios/directed/testcases/test_host_template_json_repair.py
  - tests/scenarios/directed/testcases/test_macro_json_repair.py
  - tests/scenarios/integration/INTEGRATION_COVERAGE.md
  - tests/scenarios/integration/tests/macro_call_model_json_repair.yml
  - tests/unit/host-template-tools.test.ts
  - tests/unit/llm-client.test.ts
  - tests/unit/llm-json-repair.test.ts
  - tests/unit/macro-coerce.test.ts
  - tests/unit/macro-evaluator.test.ts
  - tests/unit/macro-registry.test.ts
  - tests/unit/macro-task-result.test.ts
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 170: Code Review Report

**Reviewed:** 2026-06-22T19:23:55Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Reviewed the Phase 170 JSON validation and repair paths across the LLM client, macro coercion/evaluator, host-template tool surface, task-result transition logic, and the associated unit/integration/E2E/scenario coverage. The JSON repair utility itself keeps syntax/schema failures bounded at public call sites, but two correctness risks remain in the integration points.

## Critical Issues

### CR-01: Expected Macro Error Envelopes Are Marked Completed Unless They Are `macro_aborted`

**File:** `src/mcp/tools/macro.ts:762`

**Issue:** `transitionTaskFromResult()` only fails a task when `result.isError === true` or `isExpectedFailurePayload()` returns true, but `isExpectedFailurePayload()` only recognizes `error: "macro_aborted"` at lines 799-801. FlashQuery expected-error envelopes intentionally do not set `isError: true` (`jsonExpectedError` contract), and many macro failures return top-level `error` values such as `invalid_input`, `forbidden_tools`, `unknown_server`, `unknown_tool`, `budget_exceeded`, and `timeout`. Those results are currently transitioned through `taskRegistry.complete()` at line 766, so task listeners observe `completed` for failed macro executions. The Phase 170 task-result tests cover success, cancellation, `macro_aborted`, and malformed JSON, but not a repaired/valid expected-error envelope like `{error: "invalid_input", ...}`.

**Fix:**
```ts
function isExpectedFailurePayload(payload: unknown): boolean {
  return isRecord(payload) && typeof payload['error'] === 'string';
}
```

Keep the existing cancellation branch before this check, and add a unit test that `toolResult('{error: "invalid_input", message: "Bad", details: {reason: "x",},}')` transitions to `failed`.

## Warnings

### WR-01: Non-String Non-Object Tool Arguments Are Silently Replaced With `{}`

**File:** `src/llm/client.ts:178`

**Issue:** `normalizeToolCallArguments()` correctly rejects repaired string payloads that parse to arrays, but provider-native values that are arrays, numbers, booleans, or null fall through to `return {}` at line 182. That means a malformed OpenAI-compatible response such as `function.arguments: ["identifier"]` or `function.arguments: true` is silently dispatched as an empty object instead of being rejected. For tools with optional/defaulted parameters, this can execute the wrong operation; for required-argument tools it degrades the error from "provider returned invalid arguments" to a tool-level missing-argument failure.

**Fix:**
```ts
if (args === undefined || args === null) {
  return {};
}

if (typeof args === 'string') {
  const parsed = parseLlmJson(args, TOOL_CALL_ARGUMENTS_SCHEMA);
  if (parsed.ok) return parsed.data;
  throw invalidArgumentsError();
}

if (args && typeof args === 'object' && !Array.isArray(args)) {
  return args as Record<string, unknown>;
}

throw invalidArgumentsError();
```

Add unit coverage for provider-native arrays/primitives so they match the already-tested repaired-string array rejection.

---

_Reviewed: 2026-06-22T19:23:55Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
