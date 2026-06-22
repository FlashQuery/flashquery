# Phase 170: JSON Validation and Repair Infrastructure - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 21
**Analogs found:** 21 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` | config | dependency-management | `package.json` dependencies block | exact |
| `package-lock.json` | config | dependency-management | existing npm lockfile | exact |
| `src/llm/json-repair.ts` | utility | transform | `src/llm/cost-tracker.ts`; `src/llm/errors.ts`; `src/macro/registry.ts` Zod helpers | role-match |
| `src/macro/evaluator.ts` | service | request-response | existing `parseToolResultPayload()` / `extractTokenUsage()` in same file | exact |
| `src/mcp/host-template-tools.ts` | route | request-response | existing `parseTemplateToolPayload()` / `callResultFromTemplateText()` in same file | exact |
| `src/mcp/tools/macro.ts` | route | request-response | existing `transitionTaskFromResult()` / `parseResultPayload()` in same file | exact |
| `src/llm/client.ts` | service | request-response | existing `normalizeToolCallArguments()` in same file | exact |
| `src/macro/coerce.ts` | utility | transform | existing `coerceCallToolResult()` in same file | exact |
| `src/macro/registry.ts` | service | request-response | existing `parseNativeToolResponse()` in same file | exact unchanged-regression |
| `tests/unit/llm-json-repair.test.ts` | test | transform | `tests/unit/config-loader.test.ts`; `tests/unit/response-formats.test.ts`; `tests/unit/llm-client.test.ts` | role-match |
| `tests/unit/macro-evaluator.test.ts` | test | request-response | existing `tests/unit/macro-evaluator.test.ts`; `tests/unit/macro-test-helpers.ts` | exact |
| `tests/unit/host-template-tools.test.ts` | test | request-response | `tests/unit/mcp-server-tools.test.ts`; `tests/e2e/call-model-template-tools.e2e.test.ts` | role-match |
| `tests/unit/macro-task-result.test.ts` | test | request-response | `tests/integration/macro-parse-error.test.ts`; `tests/unit/macro-registry.test.ts` | role-match |
| `tests/unit/llm-client.test.ts` | test | request-response | existing provider tool-call tests in same file | exact |
| `tests/unit/macro-coerce.test.ts` | test | transform | existing `tests/unit/macro-coerce.test.ts` | exact |
| `tests/unit/macro-registry.test.ts` | test | request-response | existing native/broker registry tests in same file | exact unchanged-regression |
| `tests/integration/macro-json-repair.test.ts` | test | request-response | `tests/integration/macro-parse-error.test.ts` | exact |
| `tests/integration/host-template-json-repair.test.ts` | test | request-response | `tests/e2e/call-model-template-tools.e2e.test.ts`; `tests/integration/template-tools.integration.test.ts` | role-match |
| `tests/e2e/call-model-template-tools.e2e.test.ts` | test | request-response | existing host template E2E tests in same file | exact |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | test | batch | existing ML/L template rows in same matrix | exact |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | test | batch | existing Macro Language Phase 138 rows in same matrix | exact |

## Pattern Assignments

### `src/llm/json-repair.ts` (utility, transform)

**Analogs:** `src/llm/cost-tracker.ts`, `src/llm/errors.ts`, `src/macro/registry.ts`

**Imports and LLM utility boundary pattern** (`src/llm/cost-tracker.ts` lines 17-18):
```typescript
import { logger } from '../logging/logger.js';
import { supabaseManager } from '../storage/supabase.js';
```

For `json-repair.ts`, keep imports even narrower: `jsonrepair`, `zod`, and local TypeScript types/helpers only. Do not import `src/macro/*` or `src/mcp/*`.

**Typed exported contract pattern** (`src/llm/cost-tracker.ts` lines 24-35):
```typescript
export interface LlmUsageRecord {
  instanceId: string;
  purposeName: string;
  modelName: string;
  providerName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  fallbackPosition: number | null;
  traceId: string | null;
}
```

Apply this style to exported discriminated result types:
```typescript
export type LlmJsonParseResult<T> =
  | { ok: true; data: T; raw: string; repaired: boolean }
  | {
      ok: false;
      raw: string;
      repaired: boolean;
      failure: 'syntax' | 'schema';
      issues?: Array<{ path: Array<string | number>; message: string }>;
      summary: string;
    };
```

**Zod validation and error formatting pattern** (`src/macro/registry.ts` lines 57-68, 120-130):
```typescript
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toZodObjectSchema(inputSchema: unknown): z.ZodObject<z.ZodRawShape> {
  if (inputSchema instanceof z.ZodObject) return inputSchema;
  if (inputSchema instanceof z.ZodType) {
    throw new Error('Tool inputSchema must be a Zod object schema.');
  }
  if (isRecord(inputSchema)) return z.object(inputSchema as z.ZodRawShape);
  throw new Error('Tool inputSchema must be a raw Zod shape object or Zod object schema.');
}

try {
  parsedArgs = schema.parse(arg);
} catch (error: unknown) {
  throw new MacroExpectedError(
    'invalid_tool_arguments',
    `Arguments for native tool '${tool.name}' failed validation.`,
    {
      tool: tool.name,
      validation: error instanceof z.ZodError ? z.treeifyError(error) : String(error),
    }
  );
}
```

Use `schema.safeParse()` instead of `parse()` in the new utility, but copy the `unknown` boundary and `z.ZodError` issue summarization style.

**Non-throwing internal failure pattern** (`src/llm/cost-tracker.ts` lines 105-113):
```typescript
})().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn(`Cost tracking failed: ${message}`);
});
_pendingWrites.add(p);
void p.finally(() => {
  _pendingWrites.delete(p);
});
```

The parser should similarly catch ordinary `jsonrepair()` / `JSON.parse()` / schema failures, but return typed failure results rather than logging or throwing.

### `src/macro/evaluator.ts` (service, request-response)

**Analog:** existing parser and token-accounting helpers in `src/macro/evaluator.ts`

**Imports pattern** (lines 14-24):
```typescript
import {
  jsonExpectedError,
  jsonRuntimeError,
  macroResult,
  withWarnings,
  type ErrorEnvelope,
  type ToolResult,
  type TraceStep,
  type WarningCode,
  type MacroSuccessPayload,
} from '../mcp/utils/response-formats.js';
```

Add the utility import from `../llm/json-repair.js`; preserve the response helper imports.

**Core tool-result parse pattern to retrofit** (lines 798-819):
```typescript
const parsed = parseToolResultPayload(result);
if (result.isError === true) {
  throw new MacroRuntimeError(`Tool call failed: ${call.server}.${call.tool}`, call.line, {
    server: call.server,
    tool: call.tool,
    line: call.line,
    underlying_error: parsed,
  });
}

if (isModelCall) {
  context.budgetTracker.afterModelCall(extractTokenUsage(parsed));
  await context.progressEmitter.emitModelCallFinish(toolName);
}
context.budgetTracker.checkTimeout();
pushTrace(context, {
  kind: isModelCall ? 'model_call' : 'tool_call',
  name: toolName,
  args: arg,
  result: parsed,
});
return coerceMacroValue(parsed);
```

Repair must happen inside `parseToolResultPayload()` so trace, value binding, and `extractTokenUsage(parsed)` continue to use the same parsed value.

**Current parse fallback to replace** (lines 962-969):
```typescript
function parseToolResultPayload(result: ToolResult): unknown {
  const text = result.content[0]?.text ?? 'null';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

Replace `JSON.parse(text)` with `parseLlmJson(text, z.unknown())` or equivalent. If parser fails, preserve raw-string fallback for non-error value paths per REQ-004.

**Token extraction regression anchor** (lines 979-992):
```typescript
function extractTokenUsage(value: unknown): number {
  if (!isRecord(value)) return 0;
  const metadata = value['metadata'];
  if (!isRecord(metadata)) return 0;
  const tokens = metadata['tokens'];
  if (isRecord(tokens)) {
    return toNumber(tokens['input']) + toNumber(tokens['output']);
  }
  const cumulative = metadata['trace_cumulative'];
  if (isRecord(cumulative) && isRecord(cumulative['total_tokens'])) {
    const total = cumulative['total_tokens'];
    return toNumber(total['input']) + toNumber(total['output']);
  }
  return 0;
}
```

T-U-014 must cover both metadata shapes after repair.

**Expected-error envelope pattern** (lines 999-1012):
```typescript
function throwExpectedToolResult(result: ToolResult): never {
  const parsed = parseToolResultPayload(result);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const envelope = parsed as Record<string, unknown>;
    throw new MacroExpectedError(
      typeof envelope.error === 'string' ? envelope.error : 'invalid_input',
      typeof envelope.message === 'string' ? envelope.message : 'Macro preflight failed.',
      isRecord(envelope.details) ? envelope.details : undefined
    );
  }
  throw new MacroExpectedError('invalid_input', 'Macro preflight failed.', {
    response: parsed,
  });
}
```

Repairable expected-error JSON must arrive here as an object, not as raw text.

### `src/mcp/host-template-tools.ts` (route, request-response)

**Analog:** existing host-template parser/result builder in same file

**Imports pattern** (lines 1-16):
```typescript
import { createHash } from 'node:crypto';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { FlashQueryConfig } from '../config/loader.js';
import {
  assembleTemplateToolRegistry,
  dispatchTemplateToolCall,
  type TemplateToolDefinition,
} from '../llm/template-tools.js';
import type { NativeToolDefinition } from '../llm/tool-registry.js';
import { logger } from '../logging/logger.js';
import type { ToolSearchService } from '../services/tool-search/tool-search-service.js';
import type { HostTemplateRefreshSummary } from './utils/response-formats.js';
```

Add `parseLlmJson` from `../llm/json-repair.js` and `jsonExpectedError`/`jsonRuntimeError` only if error envelopes are built here.

**Current parser to retrofit** (lines 74-82):
```typescript
function parseTemplateToolPayload(text: string): { payload: Record<string, unknown> | undefined; isError: boolean } {
  try {
    const payload = JSON.parse(text) as unknown;
    if (!isRecord(payload)) return { payload: undefined, isError: false };
    return { payload, isError: payload['ok'] === false };
  } catch {
    return { payload: undefined, isError: false };
  }
}
```

Use a minimal object schema with `ok?: boolean`, repair before parse, and distinguish ordinary prose from JSON-like structured intent.

**MCP result shape to preserve** (lines 84-90):
```typescript
function callResultFromTemplateText(text: string): CallToolResult {
  const { payload, isError } = parseTemplateToolPayload(text);
  return {
    content: [{ type: 'text', text }],
    ...(payload === undefined ? {} : { structuredContent: payload }),
    ...(isError ? { isError: true } : {}),
  };
}
```

Keep the text content exactly text-first. For irreparable JSON-like payloads, set `isError: true` and make `content[0].text` a bounded JSON error envelope.

**Dispatch boundary** (lines 147-160):
```typescript
async (args: unknown) => {
  const result = await dispatchTemplateToolCall({
    config,
    toolCall: {
      id: `host_template_${tool.name}`,
      type: 'function',
      function: {
        name: tool.name,
        arguments: isRecord(args) ? args : {},
      },
    },
    templateReverseMap: new Map([[tool.name, tool.templatePath]]),
  });
  return callResultFromTemplateText(result.message.content ?? '');
}
```

The retrofit belongs in `callResultFromTemplateText()` / `parseTemplateToolPayload()`, not in template dispatch.

### `src/mcp/tools/macro.ts` (route, request-response)

**Analog:** existing task transition and parse helpers in same file

**Imports pattern** (lines 1-29):
```typescript
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { FM } from '../../constants/frontmatter-fields.js';
import {
  evaluateProgram,
  MacroCancellationError,
  MacroExpectedError,
  type MacroValue,
} from '../../macro/evaluator.js';
import { jsonExpectedError, jsonRuntimeError, type ToolResult } from '../utils/response-formats.js';
```

Add `parseLlmJson` from `../../llm/json-repair.js`. Use existing response helpers for user-visible malformed envelope errors.

**Task transition behavior to protect** (lines 454-461):
```typescript
try {
  transitionTaskFromResult(taskRegistry, task, result, options.onTaskTransition);
} catch (error) {
  taskRegistry.fail(task.task_id);
  throw error;
}
return { result, registryBuild };
```

If unreadable result envelopes are treated as failure by throwing or by a sentinel, this catch already fails the task.

**Current transition/parser to retrofit** (lines 740-765):
```typescript
function transitionTaskFromResult(
  taskRegistry: MacroTaskRegistry,
  task: MacroTaskRecord,
  result: Awaited<ReturnType<typeof evaluateProgram>>,
  onTransition: MacroTaskTransitionListener | undefined
): void {
  const payload = parseResultPayload(result);
  if (isCancelledPayload(payload)) {
    taskRegistry.cancel(task.task_id, task.session_id, onTransition);
    taskRegistry.clearCancellationRequest(task.task_id);
    return;
  }
  if (result.isError === true || isExpectedFailurePayload(payload)) {
    taskRegistry.fail(task.task_id, onTransition);
    return;
  }
  taskRegistry.complete(task.task_id, onTransition);
}

function parseResultPayload(result: Awaited<ReturnType<typeof evaluateProgram>>): unknown {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
```

Do not leave `undefined` as a successful completion path for malformed JSON-like task envelopes. Repair success/cancel/failure envelopes; fail irreparable structured envelopes.

**Error helper pattern in same file** (lines 722-737):
```typescript
function expectedMacroErrorResult(error: unknown): ToolResult {
  if (error instanceof MacroExpectedError) {
    return jsonExpectedError({
      error: error.error,
      message: error.message,
      details: error.details,
    });
  }
  if (error && typeof error === 'object' && 'error' in error && 'message' in error) {
    const envelope = error as { error: string; message: string; details?: Record<string, unknown> };
    return jsonExpectedError(envelope);
  }
  return jsonRuntimeError({
    error: 'tool_call_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}
```

Copy this helper style for bounded `invalid_json_payload` envelopes if needed.

### `src/llm/client.ts` (service, request-response)

**Analog:** existing provider tool-call normalization in same file

**Current fail-loud path to preserve** (lines 159-180):
```typescript
private normalizeToolCallArguments(
  providerName: string,
  args: unknown
): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new Error(`LLM error: ${providerName} returned invalid tool call arguments JSON.`);
    }
    throw new Error(`LLM error: ${providerName} returned invalid tool call arguments JSON.`);
  }

  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }

  return {};
}
```

Attempt repair for string args before throwing this exact error. Still reject arrays and non-object parsed values.

**Provider mapping call site** (lines 182-199):
```typescript
private normalizeToolCalls(providerName: string, rawToolCalls: unknown): LlmChatToolCall[] | undefined {
  if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return undefined;

  return rawToolCalls.map((toolCall) => {
    const raw = toolCall as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      type: 'function',
      function: {
        name: typeof raw.function?.name === 'string' ? raw.function.name : '',
        arguments: this.normalizeToolCallArguments(providerName, raw.function?.arguments),
      },
    };
  });
}
```

### `src/macro/coerce.ts` (utility, transform)

**Analog:** existing coercion helper in same file

**Current precedence/fallback to preserve** (lines 8-27):
```typescript
export function coerceCallToolResult(result: CallToolResult): MacroValue {
  if (isCallToolErrorResult(result)) {
    throw new Error('Cannot coerce brokered error result; check isError before value binding.');
  }

  if (result.structuredContent !== undefined) {
    return toMacroValue(result.structuredContent);
  }

  const firstContent = result.content[0];
  if (isTextContent(firstContent)) {
    try {
      return toMacroValue(JSON.parse(firstContent.text) as unknown);
    } catch {
      return firstContent.text;
    }
  }

  return toMacroValue(result);
}
```

Keep `isError` fail-fast first, `structuredContent` second, repaired text parse third, prose fallback fourth.

**MacroValue conversion pattern** (lines 42-64):
```typescript
function toMacroValue(value: unknown): MacroValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toMacroValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, toMacroValue(entry)])
    );
  }
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? '';
  if (typeof value === 'function') return value.name === '' ? '[function]' : value.name;
  return null;
}
```

**Logger pattern for JSON-like fallback warning** (`src/logging/logger.ts` lines 74-76):
```typescript
warn(msg: string): void {
  this._emit('warn', msg);
}
```

Use `logger.warn('...')` exactly once per JSON-like fallback. Do not warn for plain prose.

### `src/macro/registry.ts` (service, request-response)

**Analog:** `parseNativeToolResponse()` in same file

**Unchanged regression target** (lines 70-82):
```typescript
function parseNativeToolResponse(response: NativeToolResponse | MacroValue): MacroValue {
  if (!isNativeToolResponse(response)) {
    return toMacroValue(response);
  }

  const text = response.content[0]?.text ?? '';
  try {
    const parsed = JSON.parse(text) as unknown;
    return toMacroValue(parsed);
  } catch {
    return text;
  }
}
```

REQ-009 says do not retrofit this function. Add regression tests for valid JSON and raw-text fallback only.

### `package.json` / `package-lock.json` (config, dependency-management)

**Analog:** existing runtime dependency block (`package.json` lines 51-70):
```json
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.29.0",
  "@supabase/supabase-js": "^2.106.2",
  "async-mutex": "^0.5.0",
  "chevrotain": "^12.0.0",
  "commander": "^14.0.3",
  "dotenv": "^17.3.1",
  "express": "^5.2.1",
  "fast-glob": "^3.3.3",
  "gray-matter": "^4.0.3",
  "js-yaml": "^4.1.1",
  "mdast-util-from-markdown": "^2.0.3",
  "mdast-util-gfm": "^3.1.0",
  "micromark-extension-gfm": "^3.0.0",
  "pg": "^8.21.0",
  "shelljs": "^0.10.0",
  "simple-git": "^3.33.0",
  "uuid": "^13.0.0",
  "zod": "^4.4.3"
}
```

Add `jsonrepair` under `dependencies`, not `devDependencies`. Use `npm install jsonrepair` so `package-lock.json` is generated normally.

## Test Pattern Assignments

### `tests/unit/llm-json-repair.test.ts` (test, transform)

**Analogs:** `tests/unit/config-loader.test.ts`, `tests/unit/response-formats.test.ts`

**Vitest import/test style** (`tests/unit/config-loader.test.ts` lines 1-15):
```typescript
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDeprecationWarnings, loadConfig } from '../../src/config/loader.js';

const tempDirs: string[] = [];

function writeConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'fqc-config-loader-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'flashquery.yml');
  writeFileSync(configPath, contents);
  return configPath;
}
```

**JSON helper assertion style** (`tests/unit/response-formats.test.ts` lines 33-44):
```typescript
function parseToolText(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '');
}

describe('JSON MCP response helpers', () => {
  it('T-U-208 keeps jsonToolResult parseable text content for success payloads', () => {
    const result = jsonToolResult({ ok: true });

    expect(result.content[0]?.type).toBe('text');
    expect(parseToolText(result)).toEqual({ ok: true });
  });
});
```

Use this concise helper/assertion style for T-U-001 through T-U-010.

### `tests/unit/macro-evaluator.test.ts` (test, request-response)

**Analog:** existing macro evaluator tests and helpers

**Imports/helper pattern** (`tests/unit/macro-evaluator.test.ts` lines 1-5):
```typescript
import { describe, expect, it } from 'vitest';
import { evaluateProgram, isTruthy, MacroRuntimeError } from '../../src/macro/evaluator.js';
import type { Program } from '../../src/macro/types.js';
import { basicBuiltins, parseProgram, parseToolPayload, resultOf } from './macro-test-helpers.js';
```

**Macro payload helper pattern** (`tests/unit/macro-test-helpers.ts` lines 16-19):
```typescript
export function parseToolPayload(result: ToolResult): Record<string, unknown> {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
}
```

**Behavior assertion style** (`tests/unit/macro-evaluator.test.ts` lines 72-92):
```typescript
it('evaluates boolean literals and equality without coercion', async () => {
  const result = await evaluateProgram(
    parseProgram(`
      exit {
        a: true,
        b: false,
        c: true == true,
        d: true == false,
        e: true == 1
      }
    `),
    { builtins: basicBuiltins() }
  );

  expect(resultOf(parseToolPayload(result))).toEqual({
    a: true,
    b: false,
    c: true,
    d: false,
    e: false,
  });
});
```

### `tests/unit/macro-coerce.test.ts` (test, transform)

**Analog:** existing file

**Current coverage to extend** (lines 10-44):
```typescript
describe('brokered CallToolResult macro coercion', () => {
  it('T-U-016 treats isError as fail-fast before value binding', () => {
    const result: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'oops' }],
    };

    expect(isCallToolErrorResult(result)).toBe(true);
    expect(() => coerceCallToolResult(result)).toThrow(/Cannot coerce brokered error result/);
  });

  it('T-U-017 binds structuredContent before text content', () => {
    const result: CallToolResult = {
      structuredContent: { answer: 42, nested: { ok: true } },
      content: [{ type: 'text', text: '{"answer":"wrong"}' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ answer: 42, nested: { ok: true } });
  });

  it('T-U-018 parses JSON text content when structuredContent is absent', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: '{"count":2,"items":["a",null,true]}' }],
    };

    expect(coerceCallToolResult(result)).toEqual({ count: 2, items: ['a', null, true] });
  });

  it('T-U-019 binds non-JSON text content as a raw string', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'plain answer' }],
    };

    expect(coerceCallToolResult(result)).toBe('plain answer');
  });
});
```

Add `vi.mock('../../src/logging/logger.js', ...)` only for T-U-031 warning assertions, following the logger mock style in `tests/unit/llm-client.test.ts` lines 26-33.

### `tests/unit/llm-client.test.ts` (test, request-response)

**Analog:** existing provider tool-call tests

**Logger/module mock style** (lines 26-33):
```typescript
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
```

**Tool-call fixture** (lines 169-207):
```typescript
function makeOpenAIToolCallBody(options?: {
  finishReason?: string;
  content?: string | null;
  args?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}) {
  return {
    id: 'chatcmpl-tool-test',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: options?.content ?? null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search_documents',
                arguments: options?.args ?? '{"query":"alpha"}',
              },
            },
          ],
        },
        finish_reason: options?.finishReason ?? 'tool_calls',
      },
    ],
  };
}
```

**Existing success/failure tests to extend** (lines 868-892):
```typescript
it('chat() maps function_call and non-empty tool_calls to finishReason tool_calls', async () => {
  __setNextResponse({
    status: 200,
    body: makeOpenAIToolCallBody({ finishReason: 'function_call', args: '{"query":"alpha"}' }),
  });
  const functionCallResult = await client.chat('gpt-4o', SAMPLE_MESSAGES);
  expect(functionCallResult.finishReason).toBe('tool_calls');
  expect(functionCallResult.message.tool_calls?.[0].function.arguments).toEqual({ query: 'alpha' });

  __setNextResponse({
    status: 200,
    body: makeOpenAIToolCallBody({ finishReason: 'stop', args: { query: 'beta' } }),
  });
  const stopWithToolsResult = await client.chat('gpt-4o', SAMPLE_MESSAGES);
  expect(stopWithToolsResult.finishReason).toBe('tool_calls');
  expect(stopWithToolsResult.message.tool_calls?.[0].function.arguments).toEqual({ query: 'beta' });
});

it('chat() rejects invalid tool call arguments JSON', async () => {
  __setNextResponse({
    status: 200,
    body: makeOpenAIToolCallBody({ args: '{"query":' }),
  });
  await expect(client.chat('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow('invalid tool call arguments JSON');
});
```

Add T-U-024 through T-U-027 near these tests.

### `tests/unit/macro-registry.test.ts` (test, request-response)

**Analog:** existing native/broker registry tests

**Native tool fixture** (lines 67-78):
```typescript
function nativeTool(
  name: string,
  handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ ok: true, name }) }] }),
  inputSchema: NativeToolDefinition['inputSchema'] = z.object({})
): NativeToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    inputSchema,
    handler,
  };
}
```

Use this fixture for T-U-033/T-U-034 to prove native response parsing still accepts valid JSON and still falls back to raw text.

### `tests/integration/macro-json-repair.test.ts` (test, request-response)

**Analog:** `tests/integration/macro-parse-error.test.ts`

**In-memory MCP harness** (lines 26-53):
```typescript
describe('call_macro parse-error integration', () => {
  it('T-I-001 returns canonical parse_error for invalid inline source with isError false', async () => {
    const server = createMcpServer(mockConfig, '0.1.0');
    const client = new Client({ name: 'macro-parse-error-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('call_macro');

      const result = await client.callTool({ name: 'call_macro', arguments: { source: 'for = 5' } });
      const payload = parseToolText(result);

      expect(result.isError).toBe(false);
      expect(payload).toMatchObject({
        error: 'parse_error',
        details: {
          reason: 'reserved_keyword_assignment',
          at_line: 1,
          near_token: 'for',
        },
      });
    } finally {
      await client.close();
    }
  });
});
```

Copy this harness for T-I-001/T-I-002, swapping the macro source/provider fixtures to trigger repairable and irreparable task envelopes.

### `tests/e2e/call-model-template-tools.e2e.test.ts` (test, request-response)

**Analog:** existing host template E2E tests in same file

**Managed subprocess/provider harness** (lines 120-218):
```typescript
async function withManagedMcp<T>(
  provider: ScriptedOpenAiProvider,
  fn: (client: Client, vaultPath: string) => Promise<T>,
  options: ManagedMcpOptions = {}
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'fqc-template-tools-e2e-'));
  const configPath = join(tempDir, 'flashquery.yml');
  const vaultPath = join(tempDir, 'vault');
  const entryPoint = resolve('src/index.ts');
  const projectRoot = resolve('.');
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', entryPoint, 'start', '--config', configPath],
    stderr: 'ignore',
    env: process.env as Record<string, string>,
    cwd: projectRoot,
  });
  const client = new Client({ name: 'template-tools-e2e', version: '1.0.0' });
  try {
    await withE2EHeartbeat('call-model-template-tools client.connect', () => client.connect(transport));
    return await fn(client, vaultPath);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true });
  }
}
```

**Host template call assertion pattern** (lines 572-604):
```typescript
const first = await client.callTool({
  name: 'flashquery_skill_research_skill',
  arguments: { topic: 'first' },
}) as { content: Array<{ text: string }>; isError?: boolean };
expect(first.isError).toBeFalsy();
expect(JSON.parse(first.content[0].text)).toMatchObject({
  ok: true,
  result: { content: expect.stringContaining('Research skill says first.') },
});
```

Add T-E-001 through T-E-004 in this file, using malformed/fenced template output fixtures.

### Scenario Coverage Matrix Files (test, batch)

**Directed matrix analog:** `tests/scenarios/directed/DIRECTED_COVERAGE.md` lines 85-98:
```markdown
| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| ML-25 | MACRO-SRC-01 / MACRO-RESP-01 / T-S-003: inline `call_macro` creates a document, applies tags, and returns the document ID/path through the canonical success envelope. | test_macro_inline_create_doc | 2026-05-15 | 2026-06-17 |
| ML-32 | MACRO-EVAL-07 / T-S-015: running the same macro source twice through public `call_macro` gets isolated scope and distinct task IDs. | test_macro_repeated_invocation_isolation | 2026-05-15 | 2026-06-17 |
```

If directed scenarios are added, add rows `ML-33` and/or `ML-34` in this Macro Language section with `Covered By` set to `test_macro_json_repair` and/or `test_host_template_json_repair`.

**Directed scenario analog:** `tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py` lines 19-25, 128-156:
```python
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient  # noqa: E402
from fqc_test_utils import FQCServer, TestRun  # noqa: E402

TEST_NAME = "test_call_model_agent_loop_template_tool"
COVERAGE = ["ATL-DS-10", "VAL-118"]

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    with MockProvider() as provider:
        with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url), ready_timeout=120) as server:
            client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
            client.call_tool("maintain_vault", action="sync", background=False)
            result = client.call_tool("call_model", resolver="purpose", name="template_agent", messages=[{"role": "user", "content": "ATL-DS-10 template loop"}], return_messages=True)
            envelope = json.loads(result.text or "{}") if result.ok else {}
            run.step("ATL-DS-10 validates string and document params through public call_model template tool loop", passed, json.dumps({"result": result.text[:1500], "requests": provider.requests}, sort_keys=True)[:4000], tool_result=result)
```

**Integration matrix analog:** `tests/scenarios/integration/INTEGRATION_COVERAGE.md` lines 86-96:
```markdown
| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| IS-13 | MACRO-DISP-01 / MACRO-INT-03 / T-Y-001: `call_macro` composes search results with archive_document so a matched document is archived and absent from active search. | macro_search_archive_workflow | 2026-06-18   | 2026-06-18   |
| IS-10 | MACRO-DISP-01 / T-Y-002: `call_macro` can invoke `fq.call_model` with response_format, branch on the structured verdict, and mutate a document. | macro_call_model_branch_mutate | 2026-06-17   | 2026-06-17   |
```

If YAML scenario coverage is added, add `IL-45` or the next non-conflicting row per the live matrix and Test Plan. Do not add scenario rows for pure parser behavior.

**YAML scenario analog:** `tests/scenarios/integration/tests/macro_call_model_branch_mutate.yml` lines 1-8, 28-58:
```yaml
name: macro_call_model_branch_mutate
description: >
  T-Y-002: call_macro calls fq.call_model with response_format, branches on
  the returned model response, and mutates a document when a response exists.
coverage:
  - IS-10
deps: [llm]
server_modes: [managed]

steps:
  - label: "call_macro uses response_format verdict to branch and mutate"
    assert:
      op: call_macro
      args:
        source: |
          verdict = fq.call_model({
            resolver: "model",
            name: "fast",
            messages: [
              {
                role: "user",
                content: "Return JSON only: {\"ready\":\"yes\",\"reason\":\"phase-138\"}."
              }
            ],
            parameters: {
              response_format: { type: "json_object" }
            }
          })
      expect_json_equals:
        path: result.mutated
        value: "yes"
```

## Shared Patterns

### Text-First MCP JSON Responses

**Source:** `src/mcp/utils/response-formats.ts` lines 247-292
**Apply to:** `src/mcp/host-template-tools.ts`, `src/mcp/tools/macro.ts`, tests asserting public envelopes

```typescript
export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}

export function jsonRuntimeError(
  messageOrError: string | RuntimeErrorInput,
  details?: object
): ToolResult {
  if (typeof messageOrError === 'string') {
    return jsonRuntimeErrorFromEnvelope({ error: 'runtime_error', message: messageOrError, details });
  }

  return jsonRuntimeErrorFromEnvelope({
    error: messageOrError.error ?? 'runtime_error',
    message: messageOrError.message,
    ...(messageOrError.identifier === undefined ? {} : { identifier: messageOrError.identifier }),
    ...(messageOrError.details === undefined ? {} : { details: messageOrError.details }),
  });
}

function jsonRuntimeErrorFromEnvelope(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: true };
}
```

### Error Envelope With Trace/Warnings

**Source:** `src/macro/evaluator.ts` lines 944-955
**Apply to:** macro parse failures surfaced through evaluator/macro tools

```typescript
function attachContextToError(
  context: MacroInvocationContext,
  envelope: { [key: string]: unknown; error: string; message: string }
): ErrorEnvelope {
  const out: ErrorEnvelope = { ...envelope, error: envelope.error, message: envelope.message };
  if (context.traceMode !== 'none' && context.trace.length > 0) {
    out.trace = context.trace;
  }
  if (context.warnings.length > 0) {
    out.warnings = [...context.warnings];
  }
  return out;
}
```

### JSON-Like Heuristic

**Source:** Canonical Requirements §7.4, no existing helper found.
**Apply to:** `src/mcp/host-template-tools.ts`, `src/macro/coerce.ts`

No exact code analog exists. Implement a conservative local or shared helper, e.g. trimmed text starts with `{`, `[`, or a fenced JSON block. Do not warn or error on ordinary prose.

### Logger Warning

**Source:** `src/logging/logger.ts` lines 60-76
**Apply to:** `src/macro/coerce.ts`

```typescript
private _emit(level: LogLevel, msg: string): void {
  if (LEVEL_RANK[level] < this.minLevel) return;
  const cid = getCurrentCorrelationId() ?? '----';
  this._write(`[${this._timestamp()} REQ:${cid}] ${LEVEL_LABEL[level]}  ${msg}`);
}

warn(msg: string): void {
  this._emit('warn', msg);
}
```

### Unit Test Module Mocking

**Source:** `tests/unit/llm-client.test.ts` lines 26-33
**Apply to:** `tests/unit/macro-coerce.test.ts` warning assertions

```typescript
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/llm/json-repair.ts` | utility | transform | No existing LLM JSON repair utility exists. Use local `src/llm` ESM/export style plus Zod patterns from `src/macro/registry.ts`; behavior contract comes from canonical Requirements §7.1-§7.2. |
| JSON-like text helper, if extracted | utility | transform | No existing conservative JSON-like predicate found. Keep small and covered by prose/JSON-like negative tests. |

## Metadata

**Analog search scope:** `src/llm`, `src/macro`, `src/mcp`, `tests/unit`, `tests/integration`, `tests/e2e`, `tests/scenarios/directed`, `tests/scenarios/integration`
**Files scanned:** `rg --files` over relevant source/test directories plus targeted `rg` for named functions and helper patterns
**Pattern extraction date:** 2026-06-22
**Canonical docs read:** `170-CONTEXT.md`, `170-RESEARCH.md`, JSON Validation Requirements, JSON Validation Test Plan, `AGENTS.md`
**Project-local skills indexed:** `flashquery-codebase-audit`, `flashquery-directed-covgen`, `flashquery-directed-run`, `flashquery-directed-testgen`, `flashquery-integration-covgen`, `flashquery-integration-run`, `flashquery-integration-testgen`, `fq-devplan`, `pre-push`, `pre-release`
