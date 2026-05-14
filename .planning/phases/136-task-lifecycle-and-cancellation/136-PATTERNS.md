# Phase 136: Task Lifecycle And Cancellation - Pattern Map

**Mapped:** 2026-05-14  
**Files analyzed:** 14  
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/macro/task-registry.ts` | service/model | event-driven | `src/services/maintenance.ts`; POC `macro-prototype/src/taskregistry.ts` | role-match |
| `src/macro/evaluator.ts` | service | request-response / event-driven | `src/macro/evaluator.ts` current safe-point seams | exact |
| `src/macro/builtins.ts` | utility/service | request-response / async chunks | `src/macro/builtins.ts` current task/sleep builtins | exact |
| `src/mcp/tools/macro.ts` | controller/route | request-response | `src/mcp/tools/macro.ts` current `runMacroSource`/`registerMacroTools` | exact |
| `src/macro/errors.ts` | utility | transform | `src/macro/errors.ts`; `src/macro/evaluator.ts` runtime error classes | exact |
| `tests/unit/macro-task-registry.test.ts` | test | event-driven | `tests/unit/macro-registry.test.ts`; `tests/unit/macro-builtins.test.ts` | role-match |
| `tests/unit/macro-cancellation.test.ts` | test | event-driven / request-response | `tests/unit/macro-isolation.test.ts`; `tests/unit/macro-termination.test.ts` | exact |
| `tests/unit/macro-session-scope.test.ts` | test | request-response | `tests/unit/macro-builtins.test.ts`; `tests/unit/macro-isolation.test.ts` | exact |
| `tests/unit/macro-builtins.test.ts` | test | request-response | current `tests/unit/macro-builtins.test.ts` task builtin block | exact |
| `tests/integration/macro-concurrency.test.ts` | test | request-response / concurrent | `tests/integration/macro-tool-dispatch.test.ts` | role-match |
| `tests/config/vitest.integration.config.ts` | config | batch | current explicit integration include list | exact |
| `tests/scenarios/directed/testcases/test_macro_cancellation.py` | test | request-response | `test_macro_forbidden_shell_flag.py`; `test_macro_vault_jail_escape.py` | role-match |
| `tests/scenarios/directed/testcases/test_macro_no_partial_side_effects_after_cancel.py` | test | request-response / file-I/O | `test_macro_vault_jail_escape.py`; directed scenario guide | role-match |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | config/test matrix | batch | current memory lifecycle rows and test mapping section | exact |

## Pattern Assignments

### `src/macro/task-registry.ts` (service/model, event-driven)

**Analog:** `src/services/maintenance.ts` for in-process `Map` job state; POC `macro-prototype/src/taskregistry.ts` for state vocabulary only.

**Imports pattern** (`src/services/maintenance.ts` lines 1-6):
```typescript
import { randomUUID } from 'node:crypto';
import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';
import type { ErrorEnvelope, MaintenanceActionResult } from '../mcp/utils/response-formats.js';
import { maintenanceActionResult } from '../mcp/utils/response-formats.js';
import { getIsShuttingDown } from '../server/shutdown-state.js';
```

**In-memory record pattern** (`src/services/maintenance.ts` lines 15-18, 47-58):
```typescript
export type MaintenanceAction = 'sync' | 'repair' | 'status';
export type MaintenanceRequestedAction = MaintenanceAction | Array<'sync' | 'repair'>;
export type MaintenanceJobStatus = 'running' | 'completed' | 'failed' | 'aborted';

interface MaintenanceJobRecord extends MaintenanceStatusPayload {
  requestedActions: Array<'sync' | 'repair'>;
  dryRun: boolean;
}

let maintenanceInProgress = false;
const jobs = new Map<string, MaintenanceJobRecord>();

export function resetMaintenanceStateForTests(): void {
  maintenanceInProgress = false;
  jobs.clear();
}
```

**POC state vocabulary, adapt not copy** (`macro-prototype/src/taskregistry.ts` lines 27-35):
```typescript
export type TaskStatus = "working" | "completed" | "failed" | "cancelled";

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);
```

**POC create/list shape, adapt to instance-scoped class and snake_case output** (`macro-prototype/src/taskregistry.ts` lines 76-99, 170-176):
```typescript
create(opts: {
  macroSource: string;
  caller?: string;
}): string {
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const preview = opts.macroSource
    .split(/\r?\n/)
    .slice(0, 3)
    .join(" / ")
    .slice(0, 120);
  const record: TaskRecord = {
    taskId,
    status: "working",
    createdAt: now,
    lastUpdatedAt: now,
    caller: opts.caller ?? "standalone-runner",
    macro_source_preview: preview,
    progress: { progress: null, total: null, message: null },
    trace: [],
  };
  this.tasks.set(taskId, record);
  this.currentTaskId = taskId;
  return taskId;
}

get(taskId: string): TaskRecord | undefined {
  return this.tasks.get(taskId);
}

list(): TaskRecord[] {
  return Array.from(this.tasks.values());
}
```

**Required divergence:** do not export a singleton like POC line 218. Production must expose `MacroTaskRegistry` instances, remove terminal records immediately, and session-filter `list`/`cancel`.

---

### `src/macro/evaluator.ts` (service, request-response / event-driven)

**Analog:** current `src/macro/evaluator.ts`.

**Imports pattern** (lines 1-30):
```typescript
import { randomUUID } from 'node:crypto';
import type {
  Arg,
  Call,
  Expr,
  FieldAccess,
  ObjectLit,
  Pipeline,
  Program,
  Statement,
  ToolCall,
  ToolRegistry,
  MacroCallerContext,
} from './types.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  macroResult,
  type ToolResult,
  type TraceStep,
} from '../mcp/utils/response-formats.js';
```

**Context seam pattern** (lines 74-108, 111-134):
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
  builtins: Record<string, MacroBuiltin>;
  // ...
  listTasks?: (context: MacroInvocationContext) => MacroValue[] | Promise<MacroValue[]>;
  checkCancelled(where: string): void | Promise<void>;
}

export interface EvaluateProgramOptions {
  taskId?: string;
  sessionId?: string;
  cancelled?: boolean | MacroCancellationState;
  listTasks?: MacroInvocationContext['listTasks'];
  checkCancelled?: (where: string) => void | Promise<void>;
}
```

**Current cancellation behavior to replace** (lines 257-265):
```typescript
checkCancelled: async (where: string) => {
  if (cancelled.value) {
    throw new MacroRuntimeError(`Macro cancelled at ${where}`, undefined, {
      reason: 'cancelled',
      where,
    });
  }
  await options.checkCancelled?.(where);
},
```

Replace with a dedicated `MacroCancellationError` carrying `taskId` and `atSafePoint`, and have registry-backed checks observe `taskRegistry.get(taskId)` after `cancel`.

**Error mapping pattern** (lines 298-334):
```typescript
} catch (error) {
  if (error instanceof MacroExitError) {
    pushTrace(context, { kind: 'exit', result: error.value });
    return macroResult(buildSuccessPayload(context, error.value));
  }
  if (error instanceof MacroFailError) {
    pushTrace(context, { kind: 'fail', message: error.message });
    return jsonExpectedError({
      error: 'macro_aborted',
      message: error.message,
      details: { line: error.line },
    });
  }
  if (error instanceof MacroExpectedError) {
    return jsonExpectedError({
      error: error.error,
      message: error.message,
      details: error.details,
    });
  }
  if (error instanceof MacroRuntimeError) {
    return jsonRuntimeError({
      error: 'tool_call_failed',
      message: error.message,
      details: {
        ...(error.details ?? {}),
        ...(error.line === undefined ? {} : { line: error.line }),
      },
    });
  }
}
```

Insert `MacroCancellationError` before `MacroRuntimeError` and return `jsonExpectedError({ error: 'cancelled', message: 'Macro cancelled', details: { task_id, at_safe_point } })` with no `isError: true`.

**Safe-point pattern** (lines 445-452, 483-487, 560-567):
```typescript
for (const stmt of statements) {
  await context.checkCancelled('between statements');
  await execStatement(stmt, env, context);
}

for (const itemValue of iterable) {
  await context.checkCancelled('for-loop iteration');
  const child = new Env(env);
  child.setLocal(stmt.varName, itemValue);
  await execBlock(stmt.body, child, context);
}

for (let index = 0; index < pipeline.stages.length; index += 1) {
  if (index > 0) {
    await context.checkCancelled('between pipeline stages');
  }
  const previousStdin = context.stdin;
  context.stdin = index === 0 ? previousStdin : value;
```

Add a check before each statement if planner wants separate labels, but preserve the current between-statement and loop/pipeline placement.

**Tool safe-point pattern to move** (lines 748-768):
```typescript
async function evalToolCall(
  call: ToolCall,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue> {
  await context.checkCancelled(`before tool call ${call.server}.${call.tool}`);
  if (!context.toolRegistry && !context.dispatchTool) {
    throw new MacroRuntimeError(
      `No tool dispatcher configured for ${call.server}.${call.tool}.`,
      call.line,
      {
        reason: 'tool_dispatcher_missing',
        server: call.server,
        tool: call.tool,
        line: call.line,
      }
    );
  }

  const arg = await evalToolArg(call, env, context);
```

Spec requires arg evaluation first. Move the check to immediately after `const arg = await evalToolArg(...)` and before `dispatchMacroTool` / `dispatchTool`.

---

### `src/macro/builtins.ts` (utility/service, request-response / async chunks)

**Analog:** current `src/macro/builtins.ts`.

**Imports pattern** (lines 1-8):
```typescript
import {
  MacroExitError,
  MacroExpectedError,
  MacroFailError,
  MacroRuntimeError,
  type MacroBuiltin,
  type MacroValue,
} from './evaluator.js';
```

**`task_id` / `list_tasks` pattern** (lines 188-207):
```typescript
task_id: (positional, named, context) => {
  requireNamedArgs('task_id', named, []);
  requireArgCount('task_id', positional, 0, 0, 'task_id_argument_count');
  return context.taskId;
},
list_tasks: async (positional, named, context) => {
  requireNamedArgs('list_tasks', named, []);
  requireArgCount('list_tasks', positional, 0, 0, 'list_tasks_argument_count');
  if (context.listTasks) {
    const tasks = await context.listTasks(context);
    return filterSessionTasks(tasks, context.sessionId);
  }
  return [
    {
      task_id: context.taskId,
      status: 'working',
      progress: context.progress[context.progress.length - 1] ?? null,
    },
  ];
},
```

Wire `context.listTasks` to `MacroTaskRegistry.list(sessionId)` and keep defensive filtering.

**Async chunk pattern** (lines 208-226, 341-351):
```typescript
sleep: async (positional, named, context) => {
  requireNamedArgs('sleep', named, []);
  requireArgCount('sleep', positional, 1, 1, 'sleep_argument_count');
  const duration = requireDuration(positional[0] ?? 0, 'sleep');
  await sleepWithCancellation(duration, (where) => context.checkCancelled(where));
  return null;
},
slow_op: async (positional, named, context) => {
  requireNamedArgs('slow_op', named, []);
  requireArgCount('slow_op', positional, 1, 2, 'slow_op_argument_count');
  const duration = requireDuration(positional[0] ?? 1000, 'slow_op');
  const label = positional[1] ?? 'slow_op';
  // ...
  await sleepWithCancellation(duration, (where) => context.checkCancelled(where));
  return { ok: true, label, elapsed_ms: duration };
},

async function sleepWithCancellation(
  durationMs: number,
  checkCancelled: (where: string) => void | Promise<void>
): Promise<void> {
  let remaining = durationMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, CHUNK_MS);
    await new Promise<void>((resolve) => setTimeout(resolve, chunk));
    remaining -= chunk;
    await checkCancelled('inside sleep');
  }
}
```

Keep `CHUNK_MS = 100`; update label if tests assert `at_safe_point`.

---

### `src/mcp/tools/macro.ts` (controller/route, request-response)

**Analog:** current `src/mcp/tools/macro.ts`.

**Phase 135 gap-fix preservation rule:** current `runMacroSource` accepts and forwards `templateReverseMap`, `templateToolNames`, and registry-derived `hardExcludedReasons`. Phase 136 edits must add `taskRegistry`/`sessionId` without removing this metadata flow, because Phase 135 verification now relies on template-masquerade and delegated `fq.call_model` hard-exclusion behavior.

**Imports pattern** (lines 1-13):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { evaluateProgram, type MacroValue } from '../../macro/evaluator.js';
import { parseMacroSource } from '../../macro/parser.js';
import { buildToolRegistry, type BrokerToolServerConfig, type BuildToolRegistryResult } from '../../macro/registry.js';
import type { MacroCallerContext } from '../../macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../llm/tool-registry.js';
import { getNativeToolCatalog } from '../tool-catalog.js';
import type { McpBroker } from '../../services/mcp-broker.js';
import { NullMcpBroker } from '../../services/mcp-broker.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError } from '../utils/response-formats.js';
```

Add `MacroTaskRegistry` import from `../../macro/task-registry.js`.

**`runMacroSource` lifecycle wiring seam** (lines 52-84):
```typescript
export async function runMacroSource(options: RunMacroSourceOptions): Promise<RunMacroSourceResult> {
  const callerContext = options.callerContext ?? { origin: 'host' as const };
  const toolRegistry = buildToolRegistry({
    config: options.config,
    callerContext,
    broker: options.broker,
    catalog: options.catalog,
    nativeDispatchContext: options.nativeDispatchContext,
    brokerTools: options.brokerTools,
    templateReverseMap: options.templateReverseMap,
    templateToolNames: options.templateToolNames,
  });
  const parseResult = parseMacroSource(options.source, 'inline');
  if (!parseResult.ok) {
    return {
      result: jsonExpectedError(parseResult.error),
      registryBuild: {
        callerContext,
        allowlistSource: callerContext.origin === 'host' ? 'resolveHostToolExposure' : 'assembleNativeToolRegistry',
        allowedToolNames: toolRegistry.allowedToolNames,
        toolRegistry,
      },
    };
  }

  const result = await evaluateProgram(parseResult.program, {
    inputVars: options.inputVars ?? options.input_vars,
    vaultRoot: options.config.instance.vault.path,
    broker: options.broker,
    toolRegistry: toolRegistry.registry,
    allowedToolNames: toolRegistry.allowedToolNames,
    templateToolNames: toolRegistry.templateToolNames,
    hardExcludedReasons: toolRegistry.hardExcludedReasons,
```

Create the registry record after successful parse/preflight decision for real runs, pass `taskId`, `sessionId`, `listTasks`, and `checkCancelled` into `evaluateProgram`, then transition `complete`/`fail`/`cancel` in `try/catch/finally`.

**Registration pattern** (lines 105-153):
```typescript
export function registerMacroTools(
  server: McpServer,
  config: FlashQueryConfig,
  options: RegisterMacroToolsOptions = {}
): void {
  const broker = options.broker ?? new NullMcpBroker();

  server.registerTool(
    'call_macro',
    {
      description:
        'Run a FlashQuery macro as one structured orchestration request. Supports inline macro source execution through the production parser and evaluator.',
      inputSchema: callMacroInputSchema.shape,
    },
    async (params) => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed.');
      }
      // ...
      if (hasSource) {
        const { result } = await runMacroSource({
          source: params.source as string,
          input_vars: params.input_vars as Record<string, MacroValue> | undefined,
          config,
          catalog: getNativeToolCatalog(server),
          broker,
          nativeDispatchContext: createNativeDispatchContext(config),
          brokerTools: options.brokerTools,
        });
        return result;
      }
    }
  );
}
```

Instantiate `const taskRegistry = options.taskRegistry ?? new MacroTaskRegistry()` next to `broker`, not inside every handler call, so concurrent calls share visibility within the registered tool set while tests can inject an instance.

---

### `src/macro/errors.ts` (utility, transform)

**Analog:** `src/macro/errors.ts` plus evaluator error class style.

**Envelope helper pattern** (lines 42-71):
```typescript
export function macroParseError(
  details: MacroParseErrorDetails,
  message = 'Macro source could not be parsed.',
  identifier?: string
): MacroParseErrorEnvelope {
  return {
    error: 'parse_error',
    message,
    ...(identifier === undefined ? {} : { identifier }),
    details: {
      reason: details.reason,
      at_line: details.at_line,
      ...(details.near_token === undefined ? {} : { near_token: details.near_token }),
    },
  };
}

export function macroInvalidInput(
  reason: MacroInvalidInputReason,
  details: Record<string, unknown> = {},
  message = 'Macro input is invalid.',
  identifier?: string
): MacroInvalidInputEnvelope {
  return {
    error: 'invalid_input',
    message,
    ...(identifier === undefined ? {} : { identifier }),
    details: { reason, ...details },
  };
}
```

**Error class style** (`src/macro/evaluator.ts` lines 137-176):
```typescript
export class MacroRuntimeError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MacroRuntimeError';
  }
}

export class MacroExpectedError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MacroExpectedError';
  }
}
```

Add `MacroCancellationError` here or in `evaluator.ts` using this constructor style; expose a `macroCancelled(taskId, atSafePoint)` helper if the planner wants envelope construction centralized.

---

### `tests/unit/macro-task-registry.test.ts` (test, event-driven)

**Analog:** `tests/unit/macro-registry.test.ts`; `tests/unit/macro-builtins.test.ts`.

**Imports and fixtures pattern** (`tests/unit/macro-registry.test.ts` lines 1-14):
```typescript
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { buildToolRegistry } from '../../src/macro/registry.js';
import type {
  MacroCallerContext,
  ServerEntry,
  ToolFn,
  ToolRegistry,
} from '../../src/macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../src/llm/tool-registry.js';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';
```

**Assertion style for task builtins** (`tests/unit/macro-builtins.test.ts` lines 248-281):
```typescript
it('T-U-124 task_id returns the invocation task id exactly', async () => {
  const { payload } = await run('exit task_id', { taskId: 'task-123' });
  expect(resultOf(payload)).toBe('task-123');
});

it('T-U-125b list_tasks filters provider records to the current session', async () => {
  const { payload } = await run('exit list_tasks', {
    taskId: 'task-current',
    sessionId: 'session-a',
    listTasks: async () => [
      { task_id: 'task-current', status: 'working', session_id: 'session-a' },
      { task_id: 'task-other', status: 'working', session_id: 'session-b' },
    ],
  });

  expect(resultOf(payload)).toEqual([
    { task_id: 'task-current', status: 'working' },
  ]);
});
```

For `MacroTaskRegistry`, assert `create`, `complete`, `fail`, `cancel`, `get`, `list`, state vocabulary, and immediate deletion. Do not mock Supabase; absence of imports is the in-memory proof.

---

### `tests/unit/macro-cancellation.test.ts` (test, event-driven / request-response)

**Analog:** `tests/unit/macro-isolation.test.ts`; `tests/unit/macro-termination.test.ts`.

**Safe-point capture pattern** (`tests/unit/macro-isolation.test.ts` lines 53-83):
```typescript
it('places cancellation hooks at statement, call, loop, tool, and multi-stage pipeline boundaries', async () => {
  const seen: string[] = [];
  await evaluateProgram(
    parseProgram(`
      i = 0
      for item in [1,2] do
        i = add $i 1
      done
      while $i < 3 do
        i = add $i 1
      done
      echo "a" | echo "b"
      fq.ping({})
      exit $i
    `),
    {
      builtins: basicBuiltins(),
      dispatchTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
      checkCancelled: (where) => {
        seen.push(where);
      },
    }
  );

  expect(seen).toContain('between statements');
  expect(seen).toContain('before call add');
  expect(seen).toContain('before tool call fq.ping');
  expect(seen).toContain('for-loop iteration');
  expect(seen).toContain('while-loop iteration');
  expect(seen).toContain('between pipeline stages');
});
```

**Envelope assertion pattern** (`tests/unit/macro-termination.test.ts` lines 28-38, 80-106):
```typescript
const result = await evaluateProgram(parseProgram('fail "msg"\nexit "after"'), {
  builtins: basicBuiltins(),
});
expect(result.isError).toBe(false);
expect(parseToolPayload(result)).toMatchObject({
  error: 'macro_aborted',
  message: 'msg',
  details: { line: 1 },
});

const thrown = await evaluateProgram(parseProgram('fq.boom({})'), {
  builtins: basicBuiltins(),
  dispatchTool: async () => {
    throw new Error('boom');
  },
});
expect(thrown.isError).toBe(true);
expect(parseToolPayload(thrown)).toMatchObject({
  error: 'tool_call_failed',
  details: { server: 'fq', tool: 'boom' },
});
```

Use `parseToolPayload` and assert cancellation has `result.isError` absent/false, `error: 'cancelled'`, `message: 'Macro cancelled'`, and `details.task_id` / `details.at_safe_point`.

---

### `tests/unit/macro-session-scope.test.ts` (test, request-response)

**Analog:** `tests/unit/macro-builtins.test.ts`; `tests/unit/macro-isolation.test.ts`.

**Per-invocation isolation pattern** (`tests/unit/macro-isolation.test.ts` lines 37-51, 85-123):
```typescript
const inputVars = { nested: { value: 1 } };
const first = createInvocationContext({ inputVars, builtins: basicBuiltins() });
const second = createInvocationContext({ input_vars: inputVars, builtins: basicBuiltins() });

inputVars.nested.value = 2;

expect(first.inputVars).toEqual({ nested: { value: 1 } });
expect(first.inputVars).not.toBe(inputVars);
expect(first.trace).not.toBe(second.trace);
expect(first.budget).not.toBe(second.budget);
expect(first.progress).not.toBe(second.progress);
expect(first.cancelled).not.toBe(second.cancelled);
expect(first.taskId).not.toBe(second.taskId);
```

Create two registry sessions, assert `list(session-a)` hides `session-b`, and `cancel(taskB, session-a)` refuses without mutating task B.

---

### `tests/integration/macro-concurrency.test.ts` (test, request-response / concurrent)

**Analog:** `tests/integration/macro-tool-dispatch.test.ts`.

**Integration imports and setup pattern** (lines 1-14, 48-65):
```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

describe.skipIf(!HAS_SUPABASE)('macro native tool dispatch integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let client: Client;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fq-macro-tool-dispatch-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    const server = createMcpServer(config, '0.1.0');
    client = new Client({ name: 'macro-tool-dispatch-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 30000);
```

**Call and payload assertion pattern** (lines 81-103, 135-160):
```typescript
const result = await client.callTool({
  name: 'call_macro',
  arguments: {
    source: `
      fq.write_document({
        mode: "create",
        path: "macro-dispatch/write-document.md",
        title: "Macro Dispatch Write Document",
        content: "Created by fq.write_document inside call_macro.",
        tags: ["macro-tool-dispatch"]
      })
    `,
  },
});

expect(result.isError).toBeFalsy();
const payload = parseToolText(result);
expect(payload).toMatchObject({
  task_id: expect.any(String),
  result: null,
});
```

For `T-I-002`, run two linked clients or two calls with injected session IDs if exposed only through `runMacroSource`; assert variables, trace, task IDs, task visibility, and budget counters differ.

---

### `tests/config/vitest.integration.config.ts` (config, batch)

**Analog:** current explicit include list.

**Include pattern** (lines 7-17):
```typescript
include: [
  'tests/integration/documents.integration.test.ts',
  'tests/integration/save-memory-tags.test.ts',
  'tests/integration/compound-tools.integration.test.ts',
  'tests/integration/llm-config-sync.test.ts',
  'tests/integration/tool-registry.test.ts',
  'tests/integration/archive-document-lock.test.ts',
  'tests/integration/macro-parse-error.test.ts',
  'tests/integration/macro-shell-verbs.integration.test.ts',
  'tests/integration/macro-tool-dispatch.test.ts',
],
```

Add `'tests/integration/macro-concurrency.test.ts'` or the suite will not run.

---

### Directed Scenario Files (test, request-response / file-I/O)

**Targets:** `tests/scenarios/directed/testcases/test_macro_cancellation.py`, `tests/scenarios/directed/testcases/test_macro_no_partial_side_effects_after_cancel.py`

**Analog:** `tests/scenarios/directed/testcases/test_macro_forbidden_shell_flag.py`; `test_macro_vault_jail_escape.py`.

**Header and coverage pattern** (`test_macro_forbidden_shell_flag.py` lines 1-24):
```python
#!/usr/bin/env python3
"""
Test: Macro shell forbidden mutation flags are rejected before execution.

Scenario:
    1. Invoke call_macro with sed -i.
    2. Assert the public MCP envelope is forbidden_shell_flag with isError=false.

Coverage points: ML-10
"""
from __future__ import annotations

COVERAGE = ["ML-10"]

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_macro_forbidden_shell_flag"
```

**Tool call and JSON assertion pattern** (`test_macro_vault_jail_escape.py` lines 31-55):
```python
with TestContext(
    fqc_dir=args.fqc_dir,
    url=args.url,
    secret=args.secret,
    vault_path=getattr(args, "vault_path", None),
    managed=args.managed,
    port_range=port_range,
) as ctx:
    log_mark = ctx.server.log_position if ctx.server else 0
    result = ctx.client.call_tool("call_macro", source='exit cat "../etc/passwd"')
    step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

    result.expect_json_equals("error", "forbidden_path")
    result.expect_json_equals("message", "macro shell verbs cannot reach outside the vault root")
    result.expect_json_equals("details.reason", "resolves_outside_vault")

    run.step(
        label="call_macro returns forbidden_path for a vault-jail escape",
        passed=(result.ok and result.status == "pass"),
        detail=expectation_detail(result) or result.error or "",
        timing_ms=result.timing_ms,
        tool_result=result,
        server_logs=step_logs,
    )
```

The current public surface has no external MCP cancel method. Planner must either create an in-process harness exposed only for tests or defer directed cancellation until a safe public trigger exists; do not add external `tasks/cancel`.

---

### `tests/scenarios/directed/DIRECTED_COVERAGE.md` (config/test matrix, batch)

**Analog:** current memory lifecycle rows and test mapping section.

**Collision source** (lines 252-259):
```markdown
## 6. Memory Lifecycle

Core CRUD operations on memories.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| M-01 | Save memory with content and tags (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-05-07 |
| M-02 | Search memory by query returns saved memory (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-05-07 |
```

**Summary update pattern** (lines 833-846):
```markdown
## Coverage Summary

| Category | Total | Covered | Uncovered |
|----------|-------|---------|-----------|
| Document Lifecycle | 26 | 26 | 0 |
| Document Content Operations | 20 | 20 | 0 |
| Document Outline | 6 | 6 | 0 |
| Search — Documents | 9 | 9 | 0 |
| Search — Cross-type | 5 | 5 | 0 |
| Memory Lifecycle | 15 | 15 | 0 |
```

**Test mapping pattern** (lines 1291-1298):
```markdown
### test_create_read_update
Covers: D-01, D-02, D-03, D-04, D-05, D-08, X-01, X-06, X-07, X-08

### test_document_archive_and_search
Covers: D-12, D-13, S-04, S-05, X-09

### test_memory_lifecycle
Covers: M-01, M-02, M-06, M-07, M-08, M-10, M-12, M-13, M-14
```

Do not reuse Test Plan `M-01`/`M-02`; those IDs are occupied. Planner should include an ID reconciliation step before scenario edits.

## Shared Patterns

### Cancellation Envelope
**Source:** Requirements lines 941-951 and evaluator error mapping lines 298-334  
**Apply to:** `src/macro/evaluator.ts`, `src/macro/errors.ts`, cancellation tests
```typescript
return jsonExpectedError({
  error: 'cancelled',
  message: 'Macro cancelled',
  details: { task_id: error.taskId, at_safe_point: error.atSafePoint },
});
```

### Registry Lifecycle
**Source:** Requirements lines 924-936; POC lines 27-35, 76-99, 154-159  
**Apply to:** `src/macro/task-registry.ts`, `src/mcp/tools/macro.ts`
```typescript
export type MacroTaskStatus = 'working' | 'completed' | 'failed' | 'cancelled';

const TERMINAL_STATUSES = new Set<MacroTaskStatus>(['completed', 'failed', 'cancelled']);
```

Terminal transitions remove records immediately. Cancellation request must remain observable by the running invocation until the safe point handles it; implement this without retaining terminal records after observed cancellation.

### Session Scoping
**Source:** `src/macro/builtins.ts` lines 314-328; Requirements lines 956-964  
**Apply to:** registry `list`/`cancel`, `list_tasks` builtin, session tests
```typescript
function filterSessionTasks(tasks: MacroValue[], sessionId: string | undefined): MacroValue[] {
  if (!sessionId) return tasks;
  return tasks
    .filter((task) => {
      if (!isRecord(task)) return true;
      const marker = task['session_id'] ?? task['sessionId'];
      return marker === undefined || marker === sessionId;
    })
    .map((task) => {
      if (!isRecord(task)) return task;
      const visibleTask = { ...task };
      delete visibleTask['session_id'];
      delete visibleTask['sessionId'];
      return visibleTask;
    });
}
```

### Test Helpers
**Source:** `tests/unit/macro-test-helpers.ts` lines 7-18, 21-44  
**Apply to:** new unit tests
```typescript
export function parseProgram(source: string): Program {
  const result = parseMacroSource(source.trim());
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.program;
}

export function parseToolPayload(result: ToolResult): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}
```

### Integration Harness
**Source:** `tests/integration/macro-tool-dispatch.test.ts` lines 48-65, 67-79  
**Apply to:** `tests/integration/macro-concurrency.test.ts`
```typescript
describe.skipIf(!HAS_SUPABASE)('macro native tool dispatch integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let client: Client;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fq-macro-tool-dispatch-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);

    const server = createMcpServer(config, '0.1.0');
    client = new Client({ name: 'macro-tool-dispatch-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 30000);
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/macro/task-registry.ts` | service/model | event-driven | No exact production registry exists; use `maintenance.ts` for in-memory job map and POC only for state vocabulary. |

## Metadata

**Analog search scope:** `src/macro`, `src/mcp/tools`, `src/services`, `tests/unit`, `tests/integration`, `tests/scenarios/directed`  
**Files scanned:** 30+ via `rg --files`, targeted reads for 16 files  
**Pattern extraction date:** 2026-05-14
