# Phase 137: Trace, Progress, Dry-Run, Budgets - Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 16 new/modified files
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/macro/evaluator.ts` | service | request-response, event-driven, transform | `src/macro/evaluator.ts` | exact-existing |
| `src/macro/safe-points.ts` | utility | transform | `src/macro/evaluator.ts` cancellation probes | exact-existing |
| `src/mcp/tools/macro.ts` | controller/route | request-response | `src/mcp/tools/macro.ts` | exact-existing |
| `src/mcp/utils/response-formats.ts` | utility | transform | `src/mcp/utils/response-formats.ts` | exact-existing |
| `src/macro/task-registry.ts` | store/service | event-driven | `src/macro/task-registry.ts` | exact-existing |
| `src/macro/preflight.ts` | utility | transform | `src/macro/preflight.ts` | exact-existing |
| `src/macro/permission-prescan.ts` | utility | transform | `src/macro/permission-prescan.ts` | exact-existing |
| `src/macro/trace-builder.ts` | utility/service | transform | `src/macro/evaluator.ts`, `src/macro/builtins.ts` | role-match |
| `src/macro/progress-emitter.ts` | service | event-driven | `src/macro/builtins.ts`, `src/macro/evaluator.ts` | role-match |
| `src/macro/budget.ts` | service | request-response, transform | `src/macro/evaluator.ts`, `src/llm/agent-loop.ts` | role-match |
| `src/macro/dry-run.ts` | service/utility | transform | `src/macro/preflight.ts`, `src/macro/permission-prescan.ts` | role-match |
| `tests/unit/macro-trace.test.ts` | test | transform | `tests/unit/macro-trace.test.ts` | exact-existing |
| `tests/unit/macro-progress.test.ts` | test | event-driven | `tests/unit/macro-builtins.test.ts` | role-match |
| `tests/unit/macro-budget.test.ts` | test | request-response | `tests/unit/macro-cancellation.test.ts`, `tests/unit/llm-agent-loop.test.ts` | role-match |
| `tests/unit/macro-warnings.test.ts` | test | transform | `tests/unit/response-formats.test.ts` | role-match |
| `tests/unit/macro-handler.test.ts` | test | request-response | `tests/unit/macro-task-registry.test.ts`, `tests/unit/mcp-server-tools.test.ts` | role-match |
| `tests/scenarios/directed/testcases/test_macro_trace_full_summary_none.py`, `test_macro_progress_milestones.py`, `test_macro_budget_timeout.py` | test | request-response | `test_macro_cancellation.py`, `test_call_model_trace.py`, `test_call_model_agent_loop_budgets.py` | role-match |

## Pattern Assignments

### `src/macro/evaluator.ts` (service, request-response/event-driven)

**Analog:** `src/macro/evaluator.ts`

**Imports pattern** (lines 1-30):
```typescript
import { randomUUID } from 'node:crypto';
import type { Program, Statement, ToolCall, ToolRegistry, MacroCallerContext } from './types.js';
import { jsonExpectedError, jsonRuntimeError, macroResult, type ToolResult, type TraceStep } from '../mcp/utils/response-formats.js';
import type { McpBroker } from '../services/mcp-broker.js';
import { NullMcpBroker } from '../services/mcp-broker.js';
import { MacroPreflightError, collectInputVarContract, validateInputVars } from './preflight.js';
import { preScanForbiddenShellFlags } from './forbidden-flag-scan.js';
import { preScanToolReferences } from './permission-prescan.js';
```

**Invocation context pattern** (lines 74-109, 228-275):
```typescript
export interface MacroInvocationContext {
  inputVars: Record<string, MacroValue>;
  trace: TraceStep[];
  log: string[];
  budget: MacroBudget;
  taskId: string;
  sessionId?: string;
  progress: MacroProgressEntry[];
  cancelled: MacroCancellationState;
  progressSink?: (entry: MacroProgressEntry, context: MacroInvocationContext) => void | Promise<void>;
  checkCancelled(atSafePoint: string): void | Promise<void>;
}

export function createInvocationContext(options: EvaluateProgramOptions = {}): MacroInvocationContext {
  const budget = {
    token_total: options.budget?.token_total ?? 0,
    model_calls: options.budget?.model_calls ?? 0,
    external_tool_calls: options.budget?.external_tool_calls ?? 0,
  };
  const context: MacroInvocationContext = {
    trace: [...(options.trace ?? [])],
    budget,
    progress: [...(options.progress ?? [])],
    taskId: options.taskId ?? randomUUID(),
    checkCancelled: async (atSafePoint: string) => { /* throws MacroCancellationError */ },
  };
  return context;
}
```

**Preflight + error envelope pattern** (lines 285-330):
```typescript
preScanForbiddenShellFlags(program);
preflightProgram(program);
const inputVarContract = collectInputVarContract(program);
validateInputVars(inputVarContract, context.inputVars);
const permissionError = preScanToolReferences({ program, registry, allowlist });
if (permissionError) throwExpectedToolResult(permissionError);

await execBlock(program.statements, env, context);
return macroResult(buildSuccessPayload(context, null));
```

**Execution boundary pattern** (lines 467-505, 767-838):
```typescript
await context.checkCancelled(MACRO_SAFE_POINTS.betweenStatements);
await context.checkCancelled(MACRO_SAFE_POINTS.beforeStatement);

for (const itemValue of iterable) {
  await context.checkCancelled(MACRO_SAFE_POINTS.forLoopIteration);
  await execBlock(stmt.body, child, context);
}

const arg = await evalToolArg(call, env, context);
await context.checkCancelled(MACRO_SAFE_POINTS.beforeToolCall(call.server, call.tool));
const dispatched = await dispatchMacroTool({ registry, allowlist, server: call.server, tool: call.tool, arg, context });
context.budget.external_tool_calls += 1;
pushTrace(context, { kind: 'tool_call', name: `${call.server}.${call.tool}`, args: arg, result: dispatched });
```

**Apply to Phase 137:** Replace direct `context.trace.push`, direct `context.progress.push`, and raw `context.budget` mutation with per-invocation helper objects passed through `createInvocationContext`. Keep all state on the context, never module-level. Progress and budget integrations must preserve the Phase 136 `MACRO_SAFE_POINTS` constants in `src/macro/safe-points.ts`; add behavior adjacent to those probes, not by replacing them with ad hoc strings.

---

### `src/mcp/tools/macro.ts` (controller, request-response)

**Analog:** `src/mcp/tools/macro.ts`

**Imports and schema pattern** (lines 1-29):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { evaluateProgram, MacroCancellationError, type MacroValue } from '../../macro/evaluator.js';
import { parseMacroSource } from '../../macro/parser.js';
import { jsonExpectedError, jsonRuntimeError } from '../utils/response-formats.js';

export const callMacroInputSchema = z.object({
  source: z.string().optional(),
  source_ref: z.string().optional(),
  input_vars: z.record(z.string(), z.unknown()).optional(),
  budget: z.record(z.string(), z.unknown()).optional(),
  dry_run: z.boolean().optional(),
  trace: z.enum(['full', 'summary', 'none']).optional(),
  progress: z.enum(['full', 'milestones', 'silent']).optional(),
});
```

**Run source pattern** (lines 67-118):
```typescript
const parseResult = parseMacroSource(options.source, 'inline');
if (!parseResult.ok) {
  return { result: jsonExpectedError(parseResult.error), registryBuild: { /* metadata */ } };
}

const task = taskRegistry.create({ taskId: options.taskId, sessionId: options.sessionId, source: options.source });
const result = await evaluateProgram(parseResult.program, {
  inputVars: options.inputVars ?? options.input_vars,
  taskId: task.task_id,
  sessionId: options.sessionId,
  vaultRoot: options.config.instance.vault.path,
  listTasks: (context) => taskRegistry.list(context.sessionId),
  checkCancelled: (where) => {
    if (taskRegistry.isCancellationRequested(task.task_id)) {
      throw new MacroCancellationError(task.task_id, where);
    }
  },
});
transitionTaskFromResult(taskRegistry, task, result, options.onTaskTransition);
```

**MCP handler pattern** (lines 176-230):
```typescript
server.registerTool('call_macro', { description, inputSchema: callMacroInputSchema.shape }, async (params, extra) => {
  if (getIsShuttingDown()) return jsonRuntimeError('Server is shutting down; new requests cannot be processed.');

  const hasSource = typeof params.source === 'string' && params.source.length > 0;
  const hasSourceRef = typeof params.source_ref === 'string' && params.source_ref.trim().length > 0;
  if (hasSource === hasSourceRef) {
    return jsonExpectedError({ error: 'invalid_input', message: 'Exactly one of source or source_ref is required.', details: { reason: 'exactly_one_required' } });
  }

  const { result } = await runMacroSource({ source: params.source as string, input_vars: params.input_vars as Record<string, MacroValue> | undefined, sessionId: resolveSessionId(extra) });
  return result;
});

return { registrationSessionId };
```

**Apply to Phase 137:** Extend `RunMacroSourceOptions` and handler params with typed `budget`, `dry_run`, `trace`, `progress`, and `progressToken`. Extract `_meta.progressToken` from `extra` here, default modes here, and branch dry-run before `taskRegistry.create`. Preserve the Phase 136 gap-fix return contract: `registerMacroTools` returns `RegisterMacroToolsResult` with a generated per-registration UUID `registrationSessionId`; do not remove this return value while refactoring the handler.

---

### `src/mcp/utils/response-formats.ts` (utility, transform)

**Analog:** `src/mcp/utils/response-formats.ts`

**Additive export pattern** (lines 16-43, 127-164):
```typescript
export const MACRO_ERROR_CODES = [
  'macro_aborted',
  'forbidden_tools',
  'unknown_server',
  'unknown_tool',
  'forbidden_path',
  'forbidden_shell_flag',
  'template_masquerade_tools_not_callable_from_macro',
  'budget_exceeded',
  'timeout',
  'tool_call_failed',
  'cancelled',
  'parse_error',
] as const;

export interface TraceStep {
  kind: 'tool_call' | 'model_call' | 'log' | 'progress' | 'fail' | 'exit';
  name?: string;
  args?: unknown;
  result?: unknown;
  message?: string;
  at: string;
  elapsed_ms?: number;
}

export function macroResult(payload: MacroSuccessPayload): ToolResult {
  return jsonToolResult(payload);
}
```

**Warnings pattern** (lines 192-200):
```typescript
export function withWarnings<T extends Record<string, unknown>>(
  payload: T,
  warnings: WarningCode[]
): T & { warnings?: WarningCode[] } {
  if (warnings.length === 0) return payload;
  return { ...payload, warnings };
}
```

**Apply to Phase 137:** Do not reshape existing exports. Add warning codes only as `WarningCode` strings in macro payloads. Use `macroResult(withWarnings(payload, warnings))` or equivalent when warnings exist.

---

### `src/macro/task-registry.ts` (store/service, event-driven)

**Analog:** `src/macro/task-registry.ts`

**Lifecycle pattern** (lines 28-62, 84-115):
```typescript
export class MacroTaskRegistry {
  private readonly tasks = new Map<string, MacroTaskRecord>();
  private readonly cancellationRequests = new Set<string>();

  create(options: CreateMacroTaskOptions = {}): MacroTaskRecord {
    const record: MacroTaskRecord = { task_id: options.taskId ?? randomUUID(), status: 'working', /* ... */ };
    this.tasks.set(record.task_id, record);
    return { ...record };
  }

  cancel(taskId: string, sessionId?: string, onTransition?: MacroTaskTransitionListener): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    if (!isSameSession(record, sessionId)) return false;
    this.cancellationRequests.add(taskId);
    return this.transitionTerminal(taskId, 'cancelled', onTransition);
  }

  private transitionTerminal(taskId: string, status: Exclude<MacroTaskStatus, 'working'>, onTransition?: MacroTaskTransitionListener): boolean {
    const terminal: MacroTaskRecord = { ...current, status, updated_at: new Date().toISOString() };
    onTransition?.({ ...terminal });
    this.tasks.delete(taskId);
    return true;
  }
}
```

**Apply to Phase 137:** Dry-run must generate a `task_id` but must not call `taskRegistry.create`. Progress/budget state must remain per invocation; do not add registry-retained progress/budget history.

---

### `src/macro/preflight.ts` (utility, transform)

**Analog:** `src/macro/preflight.ts`

**Static analysis pattern** (lines 31-164):
```typescript
export function collectInputVarContract(program: Program): InputVarContract {
  const required = new Set<string>();
  const optional = new Map<string, InputVarDefault>();
  const visitStatement = (statement: Statement): void => { /* exhaustive AST traversal */ };
  const visitExpr = (expr: Expr): void => { /* exhaustive AST traversal */ };
  program.statements.forEach(visitStatement);
  return { required: [...required], optional: Object.fromEntries(optional) };
}
```

**Expected-error pattern** (lines 167-189):
```typescript
if (missingInputs.length > 0) {
  throw new MacroPreflightError(
    'invalid_input',
    `Macro is missing required input(s): ${missingInputs.join(', ')}.`,
    { required_inputs: requiredInputs, optional_inputs: optionalInputs, provided_inputs: providedInputs, missing_inputs: missingInputs }
  );
}
```

**Apply to Phase 137:** `src/macro/dry-run.ts` should reuse this preflight chain and transform `InputVarContract` into the canonical dry-run shape: `{ required: string[], optional: { key, default }[] }`.

---

### `src/macro/permission-prescan.ts` (utility, transform)

**Analog:** `src/macro/permission-prescan.ts`

**Traversal and error envelope pattern** (lines 27-108, 187-211):
```typescript
export function collectToolReferences(program: Program): ToolReference[] {
  const references: ToolReference[] = [];
  program.statements.forEach((statement) => collectStatementToolReferences(statement, references));
  return references;
}

export function preScanToolReferences(options: PreScanToolReferencesOptions): ToolResult | undefined {
  const references = collectToolReferences(options.program);
  const unknownServers = uniqueByReference(references.filter((reference) => options.registry[reference.server] === undefined));
  if (unknownServers.length > 0) {
    return jsonExpectedError({ error: 'unknown_server', message: `Unknown tool server '${first.server}'.`, details: { server: first.server, unknown: unknownServers.map(formatToolReference) } });
  }
  const forbidden = uniqueByReference(references.filter((reference) => !options.allowlist.has(formatToolReference(reference))));
  if (forbidden.length > 0) return forbiddenToolsResult(forbidden, options.allowlist);
}
```

**Apply to Phase 137:** `dry-run.ts` should use `collectToolReferences()` to build alphabetized `tool_references` and deduplicated `server_references` after the same pre-scan succeeds.

---

### `src/macro/trace-builder.ts` (new utility/service, transform)

**Analogs:** `src/macro/evaluator.ts` and `src/macro/builtins.ts`

**Current direct trace write pattern to replace**:
```typescript
// src/macro/evaluator.ts lines 916-918
function pushTrace(context: MacroInvocationContext, step: Omit<TraceStep, 'at'>): void {
  context.trace.push({ ...step, at: new Date().toISOString() });
}

// src/macro/builtins.ts lines 156-161
context.log.push(message);
context.trace.push({ kind: 'log', message, at: new Date().toISOString() });
```

**Required helper shape:** Keep the helper small and per-invocation:
```typescript
export type TraceMode = 'full' | 'summary' | 'none';

export class TraceBuilder {
  constructor(private readonly mode: TraceMode, private readonly warnings: Set<WarningCode>) {}
  add(step: Omit<TraceStep, 'at'>): void {
    if (this.mode === 'none') return;
    // summary omits args/result; full includes capped args/result.
  }
  steps(): TraceStep[] | undefined {
    return this.mode === 'none' ? undefined : this.trace;
  }
}
```

**Tests to copy:** Extend `tests/unit/macro-trace.test.ts` lines 1-35; add `T-U-187` through `T-U-190` and `T-U-193` there.

---

### `src/macro/progress-emitter.ts` (new service, event-driven)

**Analogs:** `src/macro/builtins.ts`, `tests/unit/macro-builtins.test.ts`

**Current explicit status pattern**:
```typescript
// src/macro/builtins.ts lines 163-186
const entry = { ...(message === undefined ? {} : { message }), ...(progress === undefined ? {} : { progress }), ...(total === undefined ? {} : { total }) };
context.progress.push(entry);
context.trace.push({ kind: 'progress', ...(message === undefined ? {} : { message }), result, at: new Date().toISOString() });
await context.progressSink?.(entry, context);
```

**Existing test expectations**:
```typescript
// tests/unit/macro-builtins.test.ts lines 205-221
const emitted: unknown[] = [];
const { payload } = await run('status --progress 5 --total 10 "msg"\nexit null', {
  progressSink: async (entry) => emitted.push(entry),
});
expect(payload['progress']).toEqual([{ message: 'msg', progress: 5, total: 10 }]);
expect(emitted).toEqual([{ message: 'msg', progress: 5, total: 10 }]);
```

**Required helper shape:** Add one mode-aware path for explicit and auto progress:
```typescript
export type ProgressMode = 'full' | 'milestones' | 'silent';

export class ProgressEmitter {
  constructor(private readonly options: { mode: ProgressMode; progressToken?: unknown; notify?: (message: unknown) => Promise<void>; warnings: Set<WarningCode> }) {}
  async explicit(entry: MacroProgressEntry): Promise<void> {}
  async auto(kind: 'for_iteration' | 'model_start' | 'model_finish' | 'tool_start', entry: MacroProgressEntry): Promise<void> {}
}
```

**Apply to Phase 137:** `status`, for-loop iteration starts, model-call start/finish, and tool-call starts all call this helper. If no token exists, live notification is a no-op, but response-local progress can still follow the spec's selected behavior.

---

### `src/macro/budget.ts` (new service, request-response/transform)

**Analogs:** `src/macro/evaluator.ts`, `tests/unit/macro-cancellation.test.ts`, `tests/unit/macro-isolation.test.ts`

**Current counter pattern**:
```typescript
// src/macro/evaluator.ts lines 799-805 and 831-838
context.budget.external_tool_calls += 1;
pushTrace(context, {
  kind: 'tool_call',
  name: `${call.server}.${call.tool}`,
  args: arg,
  result: dispatched,
});
```

**Safe-point/error pattern to copy**:
```typescript
// tests/unit/macro-cancellation.test.ts lines 193-208
expect(parseToolPayload(result)).toEqual({
  error: 'cancelled',
  message: 'Macro cancelled',
  details: {
    task_id: 'task-cancel-envelope',
    at_safe_point: 'between statements',
  },
});
```

**Isolation invariant to preserve**:
```typescript
// tests/unit/macro-isolation.test.ts lines 37-50
expect(first.budget).not.toBe(second.budget);
expect(first.progress).not.toBe(second.progress);
expect(first.cancelled).not.toBe(second.cancelled);
expect(first.taskId).not.toBe(second.taskId);
```

**Required helper shape:** Track `startedAt`, optional caps, counters, and produce `MacroExpectedError`/expected envelopes for `timeout` and `budget_exceeded`.

---

### `src/macro/dry-run.ts` (new service/utility, transform)

**Analogs:** `src/macro/preflight.ts`, `src/macro/permission-prescan.ts`, `tests/unit/macro-envelopes.test.ts`

**Dry-run payload shape**:
```typescript
// tests/unit/macro-envelopes.test.ts lines 39-57
const payload: MacroDryRunResult = {
  task_id: randomUUID(),
  parsed_ok: true,
  input_var_contract: {
    required: ['query'],
    optional: [{ key: 'limit', default: 5 }],
  },
  tool_references: ['fq.search'],
  server_references: ['fq'],
};
```

**Apply to Phase 137:** Branch after parse and registry build, before `taskRegistry.create`. Run `preScanForbiddenShellFlags`, `preflightProgram`, `collectInputVarContract`, `validateInputVars`, and `preScanToolReferences`; then return `macroResult(dryRunPayload)`.

---

### Unit Test Files

**Analog imports and helper pattern:** `tests/unit/macro-test-helpers.ts` lines 1-19
```typescript
import { expect } from 'vitest';
import { parseMacroSource } from '../../src/macro/parser.js';

export function parseProgram(source: string): Program {
  const result = parseMacroSource(source.trim());
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.program;
}

export function parseToolPayload(result: ToolResult): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}
```

**Response/warnings test pattern:** `tests/unit/response-formats.test.ts` lines 82-88, 113-168
```typescript
expect(withWarnings({ results: [] }, ['memory_disabled'])).toEqual({ results: [], warnings: ['memory_disabled'] });
expect(withWarnings({ results: [] }, [])).toEqual({ results: [] });

expect(MACRO_ERROR_CODES).toEqual([/* stable v0 codes */]);
expect(macroResult(payload)).toEqual({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
```

**Task/handler test pattern:** `tests/unit/macro-task-registry.test.ts` lines 48-67
```typescript
const registry = new MacroTaskRegistry();
const observed: string[] = [];
await runMacroSource({ source: 'exit "done"', sessionId: 'session-a', taskRegistry: registry, /* config/catalog/broker */ });
expect(observed).toEqual(['working', 'completed']);
expect(registry.list('session-a')).toEqual([]);
```

**Natural session fallback integration pattern:** `tests/integration/macro-call-macro-session.test.ts`
```typescript
const registration = registerMacroTools(server, testConfig(), {
  broker: new NullMcpBroker(),
  taskRegistry,
});
expect(registration.registrationSessionId).toMatch(UUID_V4_PATTERN);
```

Phase 137 handler tests may stub the notification callback, but production handler edits must preserve registration-scoped fallback sessions and the existing integration coverage.

## Shared Patterns

### Response Envelopes
**Source:** `src/mcp/utils/response-formats.ts` lines 158-167  
**Apply to:** `evaluator.ts`, `dry-run.ts`, `budget.ts`, `macro.ts`
```typescript
export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function macroResult(payload: MacroSuccessPayload): ToolResult {
  return jsonToolResult(payload);
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}
```

### Per-Invocation Isolation
**Source:** `src/macro/evaluator.ts` lines 228-275 and `tests/unit/macro-isolation.test.ts` lines 37-50  
**Apply to:** trace, progress, budget, dry-run, warnings

All mutable phase state must be allocated in `createInvocationContext` or local dry-run scope. Do not store mode, warning, throttle, or budget state in module-level variables.

### Registration-Scoped Session Fallback
**Source:** `src/mcp/tools/macro.ts` and `tests/integration/macro-call-macro-session.test.ts`  
**Apply to:** progress-token capture, dry-run handler branch, budget option parsing

The Phase 136 follow-up change made `registerMacroTools` return `{ registrationSessionId }` so tests and callers can observe the UUID fallback used when SDK `extra` has no session ID. Phase 137 work in `src/mcp/tools/macro.ts` must keep that return path intact and must not use `config.instance.id`, progress tokens, or request metadata as a replacement fallback session ID.

### Named Safe Points
**Source:** `src/macro/safe-points.ts` and `src/macro/evaluator.ts` cancellation probes  
**Apply to:** progress auto-emission and budget timeout checks

Phase 136 gap fixes introduced `MACRO_SAFE_POINTS` as the canonical vocabulary for macro safe points:

```typescript
MACRO_SAFE_POINTS.betweenStatements;
MACRO_SAFE_POINTS.beforeStatement;
MACRO_SAFE_POINTS.forLoopIteration;
MACRO_SAFE_POINTS.whileLoopIteration;
MACRO_SAFE_POINTS.betweenPipelineStages;
MACRO_SAFE_POINTS.beforeCall(name);
MACRO_SAFE_POINTS.beforeToolCall(server, tool);
MACRO_SAFE_POINTS.insideSleep;
MACRO_SAFE_POINTS.insideSlowOp;
```

Phase 137 progress and budget work must preserve those constants and hook behavior adjacent to them. Do not reintroduce literal strings such as `"between statements"` or `"before tool call fq.search"` as new cancellation/timeout boundary identifiers.

### Static Preflight Chain
**Source:** `src/macro/evaluator.ts` lines 285-303  
**Apply to:** real execution and dry-run

Order to preserve: forbidden shell flags, semantic preflight, input-var contract collection, input-var validation, permission pre-scan, then execution or dry-run payload.

### Progress/Status Channel
**Source:** `src/macro/builtins.ts` lines 163-186  
**Apply to:** `progress-emitter.ts`, `status` builtin, auto progress boundaries

Existing `status` tests expect progress entries, trace progress steps, and optional sink calls. The new emitter should centralize this behavior and make mode/token decisions there.

### Directed Scenario Shape
**Source:** `tests/scenarios/directed/WRITING_SCENARIOS.md` lines 19-105 and `test_macro_cancellation.py` lines 60-96  
**Apply to:** Phase 137 directed scenarios
```python
TEST_NAME = "test_macro_cancellation"
COVERAGE = ["MLC-01"]

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with TestContext(fqc_dir=args.fqc_dir, managed=True, port_range=port_range) as ctx:
        # call public tool or helper
        run.step(label="...", passed=passed, detail=json.dumps(payload, sort_keys=True))
    return run
```

For trace/progress/budget scenarios, copy the managed-server style from `test_call_model_trace.py` lines 93-176 and the local HTTP provider pattern from `test_call_model_agent_loop_budgets.py` lines 26-88 and 160-220 when deterministic model timing/token responses are needed.

## No Analog Found

All requested files have close analogs in the current codebase. No planner fallback to RESEARCH-only patterns is required.

## Metadata

**Analog search scope:** `src/macro/`, `src/mcp/tools/`, `src/mcp/utils/`, `tests/unit/`, `tests/scenarios/directed/`  
**Files scanned:** 200+ source/test/scenario files via `find`/`rg`; 16 files selected for concrete pattern extraction.  
**Pattern extraction date:** 2026-05-14
