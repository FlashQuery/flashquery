---
phase: 137-trace-progress-dry-run-budgets
reviewed: 2026-05-15T02:46:37Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/config/loader.ts
  - src/macro/budget.ts
  - src/macro/builtins.ts
  - src/macro/dry-run.ts
  - src/macro/evaluator.ts
  - src/macro/progress-emitter.ts
  - src/macro/trace-builder.ts
  - src/mcp/tools/macro.ts
  - src/mcp/utils/response-formats.ts
  - tests/scenarios/directed/DIRECTED_COVERAGE.md
  - tests/scenarios/directed/testcases/test_macro_budget_timeout.py
  - tests/scenarios/directed/testcases/test_macro_progress_milestones.py
  - tests/scenarios/directed/testcases/test_macro_trace_full_summary_none.py
  - tests/scenarios/framework/fqc_client.py
  - tests/unit/config.test.ts
  - tests/unit/macro-budget.test.ts
  - tests/unit/macro-envelopes.test.ts
  - tests/unit/macro-handler.test.ts
  - tests/unit/macro-progress.test.ts
  - tests/unit/macro-trace.test.ts
  - tests/unit/macro-warnings.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 137: Code Review Report

## Resolved Findings

### CR-01: BLOCKER - Successful macro executions no longer expose budget counters

**File:** `src/macro/evaluator.ts:965`

**Issue:** `buildSuccessPayload()` removed `token_total`, `model_calls`, and `external_tool_calls` from real execution responses, even though the runtime still maintains those counters and `MacroExecutionResult` declares them as part of the macro response shape in `src/mcp/utils/response-formats.ts:147`. This is a behavioral regression for budget/usage observability: callers can set budgets and see budget-exceeded details, but successful runs provide no consumed budget data. The current tests only construct a manual `MacroExecutionResult` in `tests/unit/macro-envelopes.test.ts:35`; they do not assert that `evaluateProgram()` or `call_macro` actually returns the counters.

**Fix:**
```ts
function buildSuccessPayload(context: MacroInvocationContext, result: MacroValue) {
  const payload = {
    task_id: context.taskId,
    result,
    ...(context.traceMode === 'none' || context.trace.length === 0 ? {} : { trace: context.trace }),
    ...(context.log.length === 0 ? {} : { log: context.log }),
    ...(context.progress.length === 0 ? {} : { progress: context.progress }),
    token_total: context.budget.token_total,
    model_calls: context.budget.model_calls,
    external_tool_calls: context.budget.external_tool_calls,
  };
  return withWarnings(payload, context.warnings);
}
```

Add a unit test that runs `fq.call_model({})` through `evaluateProgram()` with a mocked token payload and asserts the returned JSON includes `model_calls: 1` and the expected `token_total`.

**Resolution:** Fixed in `src/macro/evaluator.ts`; successful payloads now include `token_total`, `model_calls`, and `external_tool_calls`. Added `T-U-199b` in `tests/unit/macro-envelopes.test.ts`.

### WR-01: WARNING - New directed scenarios ignore runner-provided external server settings

**Files:** `tests/scenarios/directed/testcases/test_macro_trace_full_summary_none.py:30`, `tests/scenarios/directed/testcases/test_macro_progress_milestones.py:25`, `tests/scenarios/directed/testcases/test_macro_budget_timeout.py:23`

**Issue:** These tests declare `--url`, `--secret`, and `--managed` CLI options, but `run_test()` always starts `FQCServer(fqc_dir=args.fqc_dir)` directly. That bypasses the directed runner's external-server mode and its standard `TestContext` wiring. As a result, `run_suite.py --url ... --secret ... test_macro_trace_full_summary_none` will silently test a new local server instead of the requested target, and managed runner options such as port ranges/vault path cannot be honored. Adjacent macro scenario tests use `TestContext(..., url=args.url, secret=args.secret, vault_path=getattr(args, "vault_path", None), managed=args.managed, ...)` for this reason.

**Fix:** Convert the three tests to use `TestContext` and thread the runner arguments:
```py
with TestContext(
    fqc_dir=args.fqc_dir,
    url=args.url,
    secret=args.secret,
    vault_path=getattr(args, "vault_path", None),
    managed=args.managed,
    port_range=tuple(args.port_range) if getattr(args, "port_range", None) else None,
) as ctx:
    client = ctx.client
    ...
```

Also add the standard `--port-range`, `--json`, `--keep`, and `--vault-path` arguments if these tests are expected to run under the full directed suite interface.

**Resolution:** Converted all three Phase 137 directed scenarios to use `TestContext`, including runner-provided `url`, `secret`, `managed`, `port_range`, `vault_path`, and JSON output handling.

## Residual Risks / Tests

Focused unit tests passed:

```bash
npm test -- tests/unit/macro-budget.test.ts tests/unit/macro-progress.test.ts tests/unit/macro-trace.test.ts tests/unit/macro-envelopes.test.ts tests/unit/macro-handler.test.ts
npm test -- tests/unit/config.test.ts
```

Post-fix verification:

```bash
npm test -- --reporter=verbose macro-envelopes macro-budget macro-progress macro-trace macro-handler
python3 -m py_compile tests/scenarios/directed/testcases/test_macro_trace_full_summary_none.py tests/scenarios/directed/testcases/test_macro_progress_milestones.py tests/scenarios/directed/testcases/test_macro_budget_timeout.py tests/scenarios/framework/fqc_client.py
python3 tests/scenarios/directed/run_suite.py --managed test_macro_trace_full_summary_none test_macro_progress_milestones test_macro_budget_timeout
```

All passed. Directed runner still emitted shared DB cleanup timeout warnings, but all three scenarios passed.

---

_Reviewed: 2026-05-15T02:46:37Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
