# Phase 117: Agent Loop Executor - Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 16
**Analogs found:** 16 / 16

## Mandatory Product Docs

Downstream implementation agents MUST read these three canonical product docs before editing any Phase 117 source or test file:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md`

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/llm/agent-loop.ts` | service | request-response / event-driven loop | `src/llm/resolver.ts` + `src/mcp/tools/llm.ts` + `src/llm/cost-tracker.ts` | role-match |
| `src/llm/tool-dispatcher.ts` | service/utility | request-response / transform | `src/mcp/tool-catalog.ts` + `src/mcp/tools/memory.ts` + `src/llm/tool-registry.ts` | role-match |
| `src/llm/client.ts` | provider transport | request-response | `src/llm/client.ts` | exact |
| `src/llm/resolver.ts` | service | request-response fallback | `src/llm/resolver.ts` | exact |
| `src/llm/types.ts` | model/types | transform | `src/llm/types.ts` | exact |
| `src/llm/tool-registry.ts` | service/utility | transform | `src/llm/tool-registry.ts` | exact |
| `src/mcp/tool-catalog.ts` | service/utility | transform / request-response callback capture | `src/mcp/tool-catalog.ts` | exact |
| `src/mcp/tools/llm.ts` | controller | request-response | `src/mcp/tools/llm.ts` | exact |
| `src/constants/llm.ts` | config/constants | transform | `src/constants/llm.ts` | exact |
| `tests/unit/llm-agent-loop.test.ts` | test | request-response / event-driven loop | `tests/unit/llm-resolver.test.ts` + `tests/unit/llm-cost-tracker.test.ts` | role-match |
| `tests/unit/llm-tool-dispatcher.test.ts` | test | request-response / transform | `tests/unit/llm-tool-registry.test.ts` + `tests/unit/llm-tool.test.ts` | role-match |
| `tests/unit/llm-client.test.ts` | test | request-response provider | `tests/unit/llm-client.test.ts` | exact |
| `tests/unit/llm-tool.test.ts` | test | request-response controller | `tests/unit/llm-tool.test.ts` | exact |
| `tests/e2e/call-model-agent-loop.e2e.test.ts` | test | request-response E2E | `tests/e2e/protocol.test.ts` + `tests/helpers/mcp-server-fixture.ts` | role-match |
| `tests/scenarios/directed/testcases/test_call_model_agent_loop_*.py` | test | request-response directed scenario | `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py` | role-match |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | test docs | transform | `tests/scenarios/directed/DIRECTED_COVERAGE.md` | exact |

## Pattern Assignments

### `src/llm/agent-loop.ts` (service, request-response / event-driven loop)

**Analogs:** `src/llm/resolver.ts`, `src/llm/cost-tracker.ts`, `src/mcp/tools/llm.ts`

**Imports/type pattern** (`src/llm/resolver.ts` lines 1-9):
```typescript
import type { FlashQueryConfig } from '../config/loader.js';
import {
  mergeParameters,
  LlmHttpError,
  LlmNetworkError,
  type ChatMessage,
  type LlmCompletionResult,
} from './client.js';
import type { LlmChatMessage, LlmChatResult } from './types.js';
```

Use type-only imports for config/result shapes and regular imports only for runtime helpers.

**Fallback orchestration pattern** (`src/llm/resolver.ts` lines 80-107):
```typescript
private async resolveByPurpose<T>(
  purposeName: string,
  messages: LlmChatMessage[],
  parameters: Record<string, unknown> | undefined,
  fn: (modelName: string, messages: LlmChatMessage[], parameters?: Record<string, unknown>) => Promise<T>
): Promise<T & { purposeName: string; fallbackPosition: number }> {
  const normalizedName = purposeName.toLowerCase();
  const purpose = this.config.purposes.find((p) => p.name === normalizedName);
  if (!purpose) {
    throw new Error(`LLM error: Purpose '${normalizedName}' not found in configuration.`);
  }
  for (let i = 0; i < purpose.models.length; i++) {
    const modelName = purpose.models[i];
    const mergedParams = mergeParameters(parameters ?? {}, purpose.defaults ?? {});
    try {
      const result = await fn(modelName, messages, mergedParams);
      return { ...result, purposeName: normalizedName, fallbackPosition: i + 1 };
    } catch (err: unknown) {
```

Executor should reuse this fallback behavior through a non-recording purpose chat function. Do not call public `client.chatByPurpose()` for loop iterations because it records usage.

**Aggregate usage write pattern** (`src/llm/cost-tracker.ts` lines 67-93):
```typescript
export function recordLlmUsage(record: LlmUsageRecord): void {
  const p = (async () => {
    const supabase = supabaseManager.getClient();
    const { error } = await supabase.from('fqc_llm_usage').insert({
      instance_id: record.instanceId,
      purpose_name: record.purposeName,
      model_name: record.modelName,
      provider_name: record.providerName,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      cost_usd: record.costUsd,
      latency_ms: record.latencyMs,
      fallback_position: record.fallbackPosition,
      trace_id: record.traceId,
    });
    if (error) throw new Error((error as { message?: string }).message ?? String(error));
  })().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Cost tracking failed: ${message}`);
  });
  _pendingWrites.add(p);
  void p.finally(() => {
    _pendingWrites.delete(p);
  });
}
```

Mode 2 writes exactly one aggregate row through this function after completed iterations are aggregated.

**Envelope metadata pattern** (`src/mcp/tools/llm.ts` lines 669-679, 701-715):
```typescript
const metadata: CallModelMetadata = {
  resolver: resolvedResolver,
  name: resolvedName,
  resolved_model_name: result.modelName,
  provider_name: result.providerName,
  fallback_position: fallbackPosition,
  tokens: { input: result.inputTokens, output: result.outputTokens },
  cost_usd: costUsd,
  latency_ms: result.latencyMs,
};

if (injectionMetadata) {
  metadata.injected_references = injectionMetadata.injectedReferences;
  metadata.prompt_chars = injectionMetadata.promptChars;
}

if (toolRegistry) {
  const publicDiagnostics = toPublicToolDiagnostics(toolRegistry.diagnostics);
  metadata.tools = {
    native_tool_names: toolRegistry.nativeToolNames,
    diagnostics: publicDiagnostics,
  };
}
```

Extend `metadata.tools` in types and executor with `stop_reason`, `calls_log`, `iterations`, aggregate usage/cost details, and registry diagnostics. Preserve conditional field style: absent for Mode 1, present for Mode 2.

---

### `src/llm/tool-dispatcher.ts` (service/utility, request-response / transform)

**Analogs:** `src/mcp/tool-catalog.ts`, `src/mcp/tools/memory.ts`, `src/llm/tool-registry.ts`

**Catalog wrapper pattern** (`src/mcp/tool-catalog.ts` lines 26-40):
```typescript
export function wrapServerWithToolCatalog(server: McpServer): McpServer {
  if (wrappedServers.has(server)) return server;

  const catalog = getNativeToolCatalog(server);
  const originalRegisterTool = server.registerTool.bind(server);

  server.registerTool = ((name: string, config: ToolRegistrationConfig, cb: unknown) => {
    catalog.push({
      name,
      description: config.description ?? '',
      inputSchema: config.inputSchema ?? {},
    });
    return originalRegisterTool(name, config, cb as never);
  }) as RegisterToolFunction;
```

Extend catalog entries to include the handler callback needed for internal dispatch while preserving SDK behavior.

**Handler response/error pattern** (`src/mcp/tools/memory.ts` lines 64-90):
```typescript
server.registerTool(
  'save_memory',
  {
    description: 'Store a persistent fact, preference, or observation...',
    inputSchema: {
      content: z.string().describe('The memory text to store'),
      tags: z.array(z.string()).optional().describe('Tags for categorization (replaces project scoping)'),
      plugin_scope: z.string().optional().describe('Plugin scope for this memory...'),
    },
  },
  async ({ content, tags, plugin_scope }) => {
    if (getIsShuttingDown()) {
      return {
        content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
        isError: true,
      };
    }

    try {
```

Dispatcher should call captured handlers and convert `isError: true`, thrown errors, unknown tool names, and validation failures into tool result payloads, not thrown loop failures.

**Registry allowlist pattern** (`src/llm/tool-registry.ts` lines 175-244):
```typescript
export function assembleNativeToolRegistry(
  config: FlashQueryConfig,
  purposeName: string,
  catalog: NativeToolDefinition[],
  options?: ToolRegistryAssemblyOptions
): ToolRegistryAssembly {
  const catalogNames = new Set(catalog.map((tool) => tool.name));
  const catalogByName = new Map(catalog.map((tool) => [tool.name, tool]));
  const hardExcludedNames = new Set<string>(HARD_EXCLUDED_NATIVE_TOOLS);
  const purpose = config.llm?.purposes.find((candidate) => candidate.name.toLowerCase() === purposeName.toLowerCase());
  const requestedTools = purpose?.tools ?? [];
  const requestedExclusions = purpose?.excludedTools ?? [];
  // expand, exclude, hard-exclude, then emit providerTools
  return {
    nativeToolNames,
    ...(providerTools.length > 0 ? { providerTools } : {}),
    diagnostics,
  };
}
```

Dispatch must use the immutable `nativeToolNames` snapshot assembled for the call, not a fresh lookup of current config.

---

### `src/llm/client.ts` and `src/llm/resolver.ts` (provider transport and fallback, request-response)

**Analog:** `src/llm/client.ts`

**Transport-only chat pattern** (`src/llm/client.ts` lines 296-336):
```typescript
private async chatHttpOnly(
  modelName: string,
  messages: LlmChatMessage[],
  parameters?: Record<string, unknown>
): Promise<LlmChatResult> {
  const normalizedName = modelName.toLowerCase();
  const model = this.config.models.find((m) => m.name === normalizedName);
  const provider = this.config.providers.find((p) => p.name === model.providerName);
  const mergedParams = parameters ? normalizeProviderParameters(mergeParameters(parameters, {})) : {};
  const timeoutMs = (provider as { timeoutMs?: number }).timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = performance.now();
  try {
    response = await nodeFetch(`${provider.endpoint.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...mergedParams, model: model.model, messages }),
      signal: controller.signal,
    });
```

Expose a non-recording purpose chat path over this primitive for `AgentLoopExecutor`. Keep provider timeout separate from loop `timeout_ms`.

**Tool-call normalization pattern** (`src/llm/client.ts` lines 255-272, 424-437):
```typescript
private normalizeToolCalls(providerName: string, rawToolCalls: unknown): LlmChatToolCall[] | undefined {
  if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return undefined;

  return rawToolCalls.map((toolCall) => {
    const raw = toolCall as { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } };
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

if (typeof data.usage?.prompt_tokens !== 'number' || typeof data.usage?.completion_tokens !== 'number') {
  const message = hasToolCalls
    ? `LLM error: ${provider.name} returned a tool-call response without usage; check model capabilities. Raw: ${JSON.stringify(data).slice(0, 200)}`
    : `LLM error: ${provider.name} returned a 200 response with no usage field. Raw: ${JSON.stringify(data).slice(0, 200)}`;
  throw new Error(message);
}
```

Executor should consume normalized `LlmChatResult` only. Do not duplicate provider shape parsing in `agent-loop.ts`.

**Recording boundary to avoid** (`src/llm/client.ts` lines 532-555):
```typescript
async chatByPurpose(
  purposeName: string,
  messages: LlmChatMessage[],
  parameters?: Record<string, unknown>,
  traceId?: string | null
): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }> {
  const result = await this.resolver.chatByPurpose(purposeName, messages, parameters);
  const model = this.config.models.find((m) => m.name === result.modelName);
  const costUsd = model ? computeCost(result.inputTokens, result.outputTokens, model.costPerMillion) : 0;
  recordLlmUsage({
    instanceId: this.instanceId,
    purposeName,
    modelName: result.modelName,
    providerName: result.providerName,
```

Do not use this inside Mode 2 loops. Add a separate non-recording method or inject `PurposeResolver`.

---

### `src/llm/types.ts` (model/types, transform)

**Analog:** `src/llm/types.ts`

**Message type pattern** (lines 4-45):
```typescript
export interface LlmChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LlmAssistantMessage {
  role: 'assistant';
  content?: string | null;
  name?: string;
  tool_call_id?: never;
  tool_calls?: LlmChatToolCall[];
}

export interface LlmToolMessage {
  role: 'tool';
  content?: string;
  name?: never;
  tool_call_id: string;
  tool_calls?: never;
}
```

Keep OpenAI-compatible assistant/tool message shapes here. Add loop metadata types here rather than ad hoc object literals in executor tests.

**Current metadata tools seam** (lines 66-83):
```typescript
export interface CallModelMetadata {
  resolver: 'model' | 'purpose';
  name: string;
  resolved_model_name: string;
  provider_name: string;
  fallback_position: number | null;
  tokens: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
  tools?: {
    native_tool_names: string[];
    diagnostics: Record<string, unknown>;
  };
}
```

Expand `tools` to the Phase 117 Mode 2 contract. Preserve snake_case public fields.

---

### `src/mcp/tools/llm.ts` (controller, request-response)

**Analog:** `src/mcp/tools/llm.ts`

**Discovery short-circuit and body guard pattern** (lines 227-241, 344-360):
```typescript
if (
  params.resolver === 'list_models' ||
  params.resolver === 'list_purposes' ||
  params.resolver === 'search'
) {
  const llmConf = config.llm;
  const cfgModels = llmConf?.models ?? [];
  const cfgPurposes = llmConf?.purposes ?? [];
  // discovery returns here before reference hydration
}

if (params.resolver === 'model' || params.resolver === 'purpose') {
  if (typeof params.name !== 'string' || params.name.length === 0) {
    return { content: [{ type: 'text' as const, text: "name is required for resolver='model' or resolver='purpose'" }], isError: true };
  }
  if (!params.messages || params.messages.length === 0) {
    return { content: [{ type: 'text' as const, text: "messages is required (non-empty array) for resolver='model' or resolver='purpose'" }], isError: true };
  }
}
```

Discovery resolvers remain outside Mode 2 and must not run reference hydration or the loop executor.

**Host-only reference hydration boundary** (lines 384-449):
```typescript
const hostReferenceTargets = messagesForRefs
  .map((message, originalIndex) => ({ message, originalIndex }))
  .filter(({ message }) =>
    (message.role === 'system' || message.role === 'user') &&
    typeof message.content === 'string'
  );
const parsed = parseReferences(hostReferenceTargets.map(({ message }) => ({
  role: message.role,
  content: message.content as string,
})));
// resolve, hydrate, and build injected reference metadata before dispatch
```

Do not run this resolver on model-produced assistant messages, tool args, or tool results.

**Mode selection seam** (lines 452-490, 524-555):
```typescript
let toolRegistry: ToolRegistryAssembly | undefined;
let purposeProviderParameters = params.parameters;

if (resolvedResolver === 'purpose') {
  const normalizedPurposeName = resolvedName.toLowerCase();
  const purpose = config.llm?.purposes.find((p) => p.name === normalizedPurposeName);
  if (purpose?.tools !== undefined) {
    toolRegistry = assembleNativeToolRegistry(config, normalizedPurposeName, nativeToolCatalog, { strictTools: capabilities.strict_tools === true });
    const baseParameters = params.parameters ?? {};
    purposeProviderParameters = toolRegistry.providerTools && toolRegistry.providerTools.length > 0
      ? mergeProviderTools(baseParameters, toolRegistry.providerTools)
      : baseParameters;
  }
}

if (resolvedResolver === 'model') {
  result = await client.complete(resolvedName, hydratedMessages, params.parameters, params.trace_id ?? null);
} else if (hasProviderToolArray(purposeProviderParameters)) {
  const purposeResult = await client.chatByPurpose(resolvedName, hydratedMessages, purposeProviderParameters, params.trace_id ?? null);
  result = purposeResult;
} else {
  const purposeResult = await client.completeByPurpose(resolvedName, hydratedMessages, purposeProviderParameters, params.trace_id ?? null);
  result = purposeResult;
}
```

Replace the `hasProviderToolArray(...) -> client.chatByPurpose(...)` path with `AgentLoopExecutor` when the final registry is non-empty. Empty registry stays Mode 1.

---

### `src/constants/llm.ts` (config/constants, transform)

**Analog:** `src/constants/llm.ts`

**Centralized enum pattern** (lines 1-10):
```typescript
export const FINISH_REASONS = ['stop', 'tool_calls', 'length', 'content_filter', 'unknown'] as const;
export type FinishReason = typeof FINISH_REASONS[number];

export const LLM_PARTICIPANT_NAMES = {
  host: 'host',
} as const;

export function isFinishReason(value: string): value is FinishReason {
  return FINISH_REASONS.includes(value as FinishReason);
}
```

Add `LOOP_STOP_REASONS`, default token estimate constants, and dispatch error constants here. Import them in executor/tests instead of scattering literals.

---

## Test Pattern Assignments

### `tests/unit/llm-agent-loop.test.ts` (test, request-response / event-driven loop)

**Analogs:** `tests/unit/llm-resolver.test.ts`, `tests/unit/llm-cost-tracker.test.ts`

**Vitest fixture pattern** (`tests/unit/llm-resolver.test.ts` lines 1-13, 19-65):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PurposeResolver, LlmFallbackError } from '../../src/llm/resolver.js';
import { LlmHttpError, LlmNetworkError, type ChatMessage, type LlmCompletionResult } from '../../src/llm/client.js';
import type { LlmChatResult } from '../../src/llm/types.js';

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SAMPLE_CHAT_RESULT: LlmChatResult = {
  message: { role: 'assistant', content: 'response text' },
  modelName: 'primary',
  providerName: 'openai',
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 100,
  finishReason: 'stop',
};
```

Use scripted `vi.fn()` chat functions for loop rounds. Include `tool_calls` responses, final text, missing usage errors, fallback, and guardrail stops.

**Timer guardrail test pattern** (`tests/unit/llm-resolver.test.ts` lines 397-413):
```typescript
it('chat fallback applies 429 backoff before trying the next model', async () => {
  vi.useFakeTimers();
  mockComplete
    .mockRejectedValueOnce(new LlmHttpError('rate limit', 429, 5000))
    .mockResolvedValueOnce({ ...SAMPLE_CHAT_RESULT, modelName: 'fallback', providerName: 'openrouter' });

  const resolver = new PurposeResolver(TEST_LLM_CONFIG, mockComplete);
  const promise = resolver.chatByPurpose('chat', SAMPLE_MESSAGES);

  await vi.advanceTimersByTimeAsync(4999);
  expect(mockComplete).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2);
  const result = await promise;
  expect(result.fallbackPosition).toBe(2);
});
```

Use fake timers for `timeout_ms` and `max_iterations` stops where possible.

**Usage write assertion pattern** (`tests/unit/llm-cost-tracker.test.ts` lines 52-69):
```typescript
it('inserts correct snake_case fields into fqc_llm_usage including trace_id and fallback_position', async () => {
  recordLlmUsage(buildRecord());
  await drainCostWrites(1000);
  expect(fromMock).toHaveBeenCalledWith('fqc_llm_usage');
  expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
    instance_id: 'test-instance',
    purpose_name: 'general',
    model_name: 'fast',
    provider_name: 'openai',
    input_tokens: 10,
    output_tokens: 20,
    cost_usd: 0.00000150,
    latency_ms: 150,
    fallback_position: 1,
    trace_id: 'trace-abc',
  }));
});
```

Assert exactly one aggregate usage call for Mode 2 and token arithmetic invariants from `calls_log`.

---

### `tests/unit/llm-tool-dispatcher.test.ts` (test, request-response / transform)

**Analogs:** `tests/unit/llm-tool-registry.test.ts`, `tests/unit/llm-tool.test.ts`

**Pure registry test pattern** (`tests/unit/llm-tool-registry.test.ts` lines 122-134):
```typescript
it('expands tier:read-only to read-safe native tools', () => {
  const result = assembleNativeToolRegistry(makeConfig(['tier:read-only']), 'research', CATALOG);

  expect(result.nativeToolNames).toEqual(READ_ONLY_TOOLS);
  expect(result.providerTools?.map((tool) => tool.function.name)).toEqual(READ_ONLY_TOOLS);
  expect(result.diagnostics).toEqual({
    expandedTiers: [{ tier: 'tier:read-only', tools: READ_ONLY_TOOLS }],
    explicitTools: [],
    excluded: [],
    hardExcluded: [],
    unknown: [],
  });
});
```

Dispatcher tests should be pure and deterministic: unknown tool, disallowed tool, invalid args, handler `isError`, thrown handler, and success -> `role: "tool"` JSON content.

**Call model handler capture pattern** (`tests/unit/llm-tool.test.ts` lines 270-299):
```typescript
function captureCallModelRegistration(config: typeof TEST_CONFIG): { spec: unknown; handler: HandlerFn; server: CapturedServer } {
  let capturedSpec: unknown;
  let capturedHandler: HandlerFn | undefined;
  const fakeServer = {
    registerTool: vi.fn((name: string, spec: unknown, handler: HandlerFn) => {
      if (name === 'call_model') {
        capturedSpec = spec;
        capturedHandler = handler;
      }
    }),
  };
  registerLlmTools(fakeServer as any, config);
  if (!capturedHandler) throw new Error('call_model handler not registered');
  return { spec: capturedSpec, handler: capturedHandler, server: fakeServer };
}
```

Use the same fake-server pattern to seed captured catalog handlers for dispatcher tests.

---

### `tests/e2e/call-model-agent-loop.e2e.test.ts` (test, request-response E2E)

**Analogs:** `tests/e2e/protocol.test.ts`, `tests/helpers/mcp-server-fixture.ts`

**MCP subprocess fixture pattern** (`tests/helpers/mcp-server-fixture.ts` lines 28-48):
```typescript
export async function startMcpServerFixture(): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const configPath = resolve(__dirname, '../fixtures/flashquery.e2e.yaml');
  const entryPoint = resolve(__dirname, '../../src/index.ts');
  const projectRoot = resolve(__dirname, '../../');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', entryPoint, 'start', '--config', configPath],
    stderr: 'pipe',
    env: process.env as Record<string, string>,
    cwd: projectRoot,
  });

  const client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}
```

For Phase 117, create a fixture variant that can point config at a deterministic mock provider.

**Tool call assertion pattern** (`tests/e2e/protocol.test.ts` lines 111-136):
```typescript
const saveResult = await client.callTool({
  name: 'save_memory',
  arguments: {
    content: 'The capital of France is Paris',
    tags: ['geography', 'e2e-france'],
  },
}) as { content: Array<{ type: string; text: string }>; isError?: boolean };

expect(saveResult.isError).toBeFalsy();
const saveText = getText(saveResult);
expect(saveText).toMatch(/Memory saved/i);
```

Keep E2E assertions at the public MCP boundary: envelope response, `metadata.tools`, returned messages, and mock provider captured request bodies.

---

### `tests/scenarios/directed/testcases/test_call_model_agent_loop_*.py` (test, request-response directed scenario)

**Analog:** `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py`

**Mock provider pattern** (lines 46-115):
```python
class MockOpenAIProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self._server = ThreadingHTTPServer(("127.0.0.1", _free_port()), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self._server.server_port}"

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = self._read_request_body()
                request_body = json.loads(body)
                parent.requests.append(request_body)
                response = {
                    "choices": [{"message": {"role": "assistant", "content": "registry ok"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 9, "completion_tokens": 3},
                }
```

Extend this to scripted response sequences for `tool_calls -> tool result messages -> final text`, parallel calls, guardrail stops, and usage aggregation.

**Managed server + envelope assertion pattern** (lines 188-231):
```python
with MockOpenAIProvider() as provider:
    with FQCServer(fqc_dir=args.fqc_dir, extra_config=_llm_config(provider.url)) as server:
        client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)

        result = _call_model(client, "registry")
        first_request = _request_for_prompt(provider.requests, "Run registry")
        envelope = _parse_envelope(result.text)
        metadata_tools = envelope.get("metadata", {}).get("tools", {})
        provider_tools = first_request.get("tools", [])
        passed_registry = (
            result.ok
            and metadata_tools.get("native_tool_names") == ["get_document"]
            and "get_document" in provider_tool_names
        )
        run.step(label="VAL-116: public metadata exposes get_document...", passed=passed_registry, ...)
```

Create three Phase 117 scenarios:

- `test_call_model_agent_loop_native.py` for ATL-DS-09.
- `test_call_model_agent_loop_budgets.py` for ATL-DS-12.
- `test_call_model_agent_loop_usage.py` for ATL-DS-13 and VAL-117.

---

## Shared Patterns

### Source-Doc Gate

**Apply to:** All Phase 117 implementation and test plans.

Downstream agents must read the three product docs listed in `## Mandatory Product Docs` before editing. Treat them as behavior source of truth over inferred code patterns.

### MCP Tool Response Shape

**Source:** `AGENTS.md`; `src/mcp/tools/memory.ts` lines 76-87

All internal handler results are `{ content: [{ type: 'text', text: '...' }] }`; errors add `isError: true`. Dispatcher must serialize these into JSON tool-message payloads for the model instead of throwing sibling-batch failures.

### No Reference Rehydration After Start

**Source:** `src/mcp/tools/llm.ts` lines 384-449; `Document Reference System.md` section 4.5

Only host-authored initial system/user messages are scanned and hydrated. Model-produced tool args, assistant messages, and tool results containing `{{ref:...}}` are data.

### Provider Transport Boundary

**Source:** `src/llm/client.ts` lines 296-457

Provider-specific response parsing, tool-call argument normalization, finish reason normalization, HTTP errors, and missing usage checks stay in `client.ts`. `agent-loop.ts` consumes normalized `LlmChatResult`.

### Usage Accounting Boundary

**Source:** `src/llm/client.ts` lines 532-555; `src/llm/cost-tracker.ts` lines 67-93

`client.chatByPurpose()` records usage and is unsafe for loop iterations. Mode 2 must use a non-recording chat path and call `recordLlmUsage()` once with aggregate totals.

### Immutable Registry Snapshot

**Source:** `src/llm/tool-registry.ts` lines 175-244

Mode 2 dispatch allowlist comes from final assembled `nativeToolNames` and provider tool schemas sent to the model for this invocation. Do not refresh the catalog/config between a model tool call and dispatch.

## No Analog Found

None. Every planned file has at least a role-match analog in current FlashQuery source or tests.

## Metadata

**Analog search scope:** `src/llm`, `src/mcp`, `src/constants`, `tests/unit`, `tests/e2e`, `tests/scenarios/directed`
**Files scanned:** 190+
**Pattern extraction date:** 2026-05-06
