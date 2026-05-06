# Phase 118: Template Discovery & Masquerade Dispatch - Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 18
**Analogs found:** 18 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/llm/template-tools.ts` | service/utility | request-response + file-I/O + transform | `src/llm/reference-resolver.ts` + `src/llm/tool-registry.ts` | role-match |
| `src/llm/tool-registry.ts` | service/utility | request-response + transform | `src/llm/tool-registry.ts` | exact |
| `src/llm/tool-dispatcher.ts` | service | request-response + event-driven | `src/llm/tool-dispatcher.ts` | exact |
| `src/llm/agent-loop.ts` | service | event-driven request-response | `src/llm/agent-loop.ts` | exact |
| `src/llm/reference-resolver.ts` | service/utility | file-I/O + transform | `src/llm/reference-resolver.ts` | exact |
| `src/llm/purpose-template-bindings.ts` | service | CRUD + request-response | `src/llm/purpose-template-bindings.ts` | exact |
| `src/mcp/tools/llm.ts` | controller | request-response | `src/mcp/tools/llm.ts` | exact |
| `tests/unit/llm-template-tools.test.ts` | test | transform + request-response | `tests/unit/reference-resolver.test.ts` + `tests/unit/llm-tool-registry.test.ts` | role-match |
| `tests/unit/llm-tool-registry.test.ts` | test | transform | `tests/unit/llm-tool-registry.test.ts` | exact |
| `tests/unit/llm-tool-dispatcher.test.ts` | test | request-response | `tests/unit/llm-tool-dispatcher.test.ts` | exact |
| `tests/unit/llm-agent-loop.test.ts` | test | event-driven request-response | `tests/unit/llm-agent-loop.test.ts` | exact |
| `tests/unit/llm-tool.test.ts` | test | request-response | `tests/unit/llm-tool.test.ts` | exact |
| `tests/integration/template-tools.integration.test.ts` | test | CRUD + file-I/O + request-response | `tests/integration/llm-config-sync.test.ts` | role-match |
| `tests/e2e/call-model-template-tools.e2e.test.ts` | test | request-response + event-driven | `tests/e2e/call-model-agent-loop.e2e.test.ts` | role-match |
| `tests/scenarios/directed/testcases/test_call_model_template_discovery.py` | test | request-response + file-I/O | `tests/scenarios/directed/testcases/test_call_model_template_parameterization.py` | role-match |
| `tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py` | test | request-response + transform | `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py` + `test_call_model_agent_loop_native.py` | role-match |
| `tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py` | test | event-driven request-response | `tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py` | role-match |
| `tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py` | test | event-driven request-response | `tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py` | role-match |

## Pattern Assignments

### `src/llm/template-tools.ts` (service/utility, request-response + file-I/O + transform)

**Analog:** `src/llm/reference-resolver.ts` and `src/llm/tool-registry.ts`

**Imports pattern** (`src/llm/reference-resolver.ts` lines 12-26):
```typescript
import type { FlashQueryConfig } from '../config/loader.js';
import { resolveAndBuildDocument, DocumentRequestError } from '../mcp/utils/document-output.js';
import type { logger } from '../logging/logger.js';
import type { supabaseManager } from '../storage/supabase.js';
import type { embeddingProvider } from '../embedding/provider.js';
```

**Template frontmatter detection** (`src/llm/reference-resolver.ts` lines 425-430):
```typescript
export function isTemplateDocument(result: Record<string, unknown>): boolean {
  const frontmatter = result.frontmatter;
  return typeof frontmatter === 'object' &&
    frontmatter !== null &&
    (frontmatter as Record<string, unknown>).fq_template === true;
}
```

**Template params normalization** (`src/llm/reference-resolver.ts` lines 446-465):
```typescript
export function normalizeTemplateParamDeclarations(
  raw: unknown
): Record<string, TemplateParamDeclaration> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const declarations: Record<string, TemplateParamDeclaration> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (record.type !== 'string' && record.type !== 'document') continue;
    const declaration: TemplateParamDeclaration = { type: record.type };
```

**Provider schema generation** (`src/llm/tool-registry.ts` lines 180-194):
```typescript
export function toOpenAiToolDefinition(
  tool: NativeToolDefinition,
  options: OpenAiToolDefinitionOptions
): OpenAiToolDefinition {
  const zodSchema = toZodObjectSchema(tool.inputSchema);
  const parameters = normalizeToolJsonSchema(z.toJSONSchema(zodSchema), options);
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
      ...(options.strict ? { strict: true as const } : {}),
    },
  };
}
```

**Core discovery/assembly shape to copy:** fresh reads should resolve bound template paths through `resolveAndBuildDocument(... effectiveInclude: ['body', 'frontmatter'])`, then build `{ providerTools, templateTools, templateReverseMap, diagnostics }`. Use `normalizeToolJsonSchema()` for `fq_params` translation. Slug/name helpers should be centralized here.

**Template dispatch pattern** (`src/llm/reference-resolver.ts` lines 879-963):
```typescript
async function renderTemplateReference(
  body: string,
  result: Record<string, unknown>,
  rawParams: Record<string, unknown>,
  config: FlashQueryConfig,
  sm: typeof supabaseManager,
  ep: typeof embeddingProvider,
  log: typeof logger
): Promise<{ content: string; paramsUsed: Record<string, TemplateParamUsage>; warnings: TemplateWarning[] }> {
  const frontmatter = result.frontmatter as Record<string, unknown> | undefined;
  const declarations = normalizeTemplateParamDeclarations(frontmatter?.fq_params);
```

### `src/llm/tool-registry.ts` (service/utility, request-response + transform)

**Analog:** `src/llm/tool-registry.ts`

**Assembly diagnostics shape** (lines 42-54):
```typescript
export interface ToolRegistryDiagnostics {
  expandedTiers: Array<{ tier: ToolTierName; tools: string[] }>;
  explicitTools: string[];
  excluded: string[];
  hardExcluded: Array<{ tool: string; reason: string }>;
  unknown: string[];
}

export interface ToolRegistryAssembly {
  nativeToolNames: string[];
  providerTools?: OpenAiToolDefinition[];
  diagnostics: ToolRegistryDiagnostics;
}
```

**Core assembly pattern** (lines 220-289):
```typescript
export function assembleNativeToolRegistry(
  config: FlashQueryConfig,
  purposeName: string,
  catalog: NativeToolDefinition[],
  options?: ToolRegistryAssemblyOptions
): ToolRegistryAssembly {
  const catalogNames = new Set(catalog.map((tool) => tool.name));
  const catalogByName = new Map(catalog.map((tool) => [tool.name, tool]));
  // ...
  return {
    nativeToolNames,
    ...(providerTools.length > 0 ? { providerTools } : {}),
    diagnostics,
  };
}
```

**Apply to Phase 118:** extend this assembly additively, or add a merge helper, so final `providerTools` contains native and template definitions and diagnostics contain template warnings/conflicts. Do collision checks after native/template merge, keyed by final provider-visible name.

### `src/llm/tool-dispatcher.ts` (service, request-response + event-driven)

**Analog:** `src/llm/tool-dispatcher.ts`

**Recoverable error envelope** (lines 49-57, 127-151):
```typescript
interface ToolErrorPayload {
  ok: false;
  error: { code: string; message: string; recoverable: true; details?: unknown };
}

function errorPayload(code: string, message: string, details?: unknown): ToolErrorPayload {
  return { ok: false, error: { code, message, recoverable: true, ...(details === undefined ? {} : { details }) } };
}
```

**Tool result message shape** (lines 98-103):
```typescript
function makeToolMessage(toolCall: LlmChatToolCall, content: string): LlmToolMessage {
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content,
  };
}
```

**Dispatch and validation pattern** (lines 162-229):
```typescript
export async function dispatchNativeToolCall(options: DispatchNativeToolCallOptions): Promise<NativeToolDispatchResult> {
  const dispatchContext = resolveContext(options);
  const toolName = options.toolCall.function.name;
  const args = options.toolCall.function.arguments;
  // registry check, zod parse, handler invoke, JSON success/error payload
}
```

**Parallel dispatch pattern** (lines 232-257):
```typescript
export async function dispatchToolCalls(options: DispatchToolCallsOptions): Promise<DispatchToolCallsResult> {
  const settled = await Promise.allSettled(
    options.toolCalls.map((toolCall) =>
      dispatchNativeToolCall({ toolCall, catalog: options.catalog, nativeToolNames: options.nativeToolNames, dispatchContext: resolveContext(options) })
    )
  );
  // map rejections to recoverable tool errors
}
```

**Apply to Phase 118:** route each call by `templateReverseMap.has(toolName)` before native fallback. Unknown generated names absent from the current reverse map must use the same `tool_not_in_registry` recoverable payload. Add `kind: 'native' | 'template'` to log entries without removing existing fields.

### `src/llm/agent-loop.ts` (service, event-driven request-response)

**Analog:** `src/llm/agent-loop.ts`

**Options pattern** (lines 42-72):
```typescript
export interface ExecuteAgentLoopOptions {
  instanceId?: string;
  purposeName: string;
  initialMessages: LlmChatMessage[];
  providerParameters?: Record<string, unknown>;
  purposeDefaults?: Record<string, unknown>;
  toolRegistry?: ToolRegistryAssembly;
  nativeToolCatalog?: NativeToolDefinition[] | Map<string, NativeToolDefinition>;
  toolDispatcher?: ToolDispatcher;
  traceId?: string | null;
}
```

**Provider tool injection** (lines 373-379):
```typescript
result = await chatByPurpose(options.purposeName, messages, {
  ...parameters,
  ...(providerTools.length > 0 ? { tools: providerTools } : {}),
  signal: abortController.signal,
});
```

**Dispatch append pattern** (lines 442-460):
```typescript
const dispatchResult = await dispatcher({
  toolCalls,
  catalog: options.nativeToolCatalog ?? [],
  nativeToolNames,
  dispatchContext: { signal: abortController.signal, traceId: options.traceId ?? null, instanceId: options.instanceId ?? '', logger: options.logger },
  dispatchPolicy: 'Promise.allSettled',
});
messages.push(...dispatchResult.messages.map((message) => (
  message.role === 'tool' ? { ...message, name: undefined } : message
)));
callsLog[callsLog.length - 1].tool_calls = summarizedEntries;
```

**Apply to Phase 118:** do not create a second loop. Thread combined registry/reverse map into the existing dispatcher options and preserve aggregate usage/calls-log behavior.

### `src/mcp/tools/llm.ts` (controller, request-response)

**Analog:** `src/mcp/tools/llm.ts`

**Input schema / MCP handler pattern** (lines 260-303):
```typescript
export function registerLlmTools(server: McpServer, config: FlashQueryConfig): void {
  const nativeToolCatalog = getNativeToolCatalog(server);

  server.registerTool(
    'call_model',
    {
      description: "...",
      inputSchema: {
        resolver: z.enum(['model', 'purpose', 'list_models', 'list_purposes', 'search']),
        name: z.string().optional(),
        messages: z.array(callModelMessageSchema).optional(),
        template_params: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      },
    },
    async (params) => {
```

**Discovery resolver shape** (lines 405-408):
```typescript
if (params.resolver === 'list_purposes') {
  const purposes = cfgPurposes.map(purposeToResponse);
  return { content: [{ type: 'text' as const, text: JSON.stringify({ purposes }) }] };
}
```

**Reference fail-fast boundary** (lines 532-553):
```typescript
const resolved = await resolveReferences(parsedWithOriginalIndexes, config, supabaseManager, embeddingProvider, logger, params.template_params);
const failures = resolved.filter((r): r is FailedRef => r.kind === 'failed');
if (failures.length > 0) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'reference_resolution_failed', failed_references: failures.map(...) }) }],
    isError: true,
  };
}
```

**Mode 2 routing pattern** (lines 637-665):
```typescript
if (resolvedResolver === 'purpose' && hasModelVisibleTools(toolRegistry)) {
  const loopEnvelope = await executeAgentLoop({
    instanceId: config.instance.id,
    purposeName: resolvedName,
    initialMessages: hydratedMessages,
    providerParameters: purposeProviderParameters,
    purposeDefaults,
    nativeToolCatalog,
    toolRegistry,
    traceId: params.trace_id ?? null,
    chatByPurpose: client.chatByPurposeUnrecorded.bind(client),
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(envelope) }] };
}
```

**Apply to Phase 118:** assemble template tools for `resolver='purpose'` even when `purpose.tools` is absent. `list_purposes` should include `template_tools` and `template_tool_conflicts` diagnostics. Collision failures in `call_model` should return top-level `isError: true` before provider dispatch.

### `src/llm/purpose-template-bindings.ts` (service, CRUD + request-response)

**Analog:** `src/llm/purpose-template-bindings.ts`

**Path normalization pattern** (lines 14-28):
```typescript
function normalizeTemplatePath(templateIdentifier: string): string {
  const raw = templateIdentifier.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  const normalized = pathPosix.normalize(raw);
  if (normalized === '.' || normalized === '' || normalized.startsWith('/') || normalized.startsWith('../') || normalized === '..' || normalized.endsWith('/')) {
    throw new Error(`Invalid template binding path '${templateIdentifier}': path must be vault-relative`);
  }
  return normalized;
}
```

**Runtime DB lookup/insert pattern** (lines 111-142):
```typescript
const client = supabaseManager.getClient();
for (const source of ['webapp', 'api'] as const) {
  const { data: existing, error: lookupErr } = await client
    .from('fqc_purpose_templates')
    .select('id')
    .eq('instance_id', config.instance.id)
    .eq('purpose_name', purposeName)
    .eq('template_path', templatePath)
    .eq('source', source)
    .maybeSingle();
  // throw on lookup errors; reject webapp ownership; idempotent api ownership
}
```

**Apply to Phase 118:** discovery should reuse stored `template_path` identity. It may query `fqc_purpose_templates` for runtime/API bindings, but frontmatter must still be read fresh from vault files for tool metadata.

## Test Pattern Assignments

### `tests/unit/llm-template-tools.test.ts`

**Analogs:** `tests/unit/reference-resolver.test.ts`, `tests/unit/llm-tool-registry.test.ts`, `tests/unit/llm-tool-dispatcher.test.ts`

**Mocked resolver fixture pattern** (`tests/unit/reference-resolver.test.ts` lines 827-870):
```typescript
const resolveWithTemplateParams = resolveReferences as unknown as (...) => Promise<Array<ResolvedRef | FailedRef>>;

function templateResult(path: string, body: string, fqParams: Record<string, unknown>) {
  return {
    path,
    body,
    frontmatter: { fq_template: true, fq_params: fqParams },
  } as unknown as Record<string, unknown>;
}
```

**Template behavior assertions** (`tests/unit/reference-resolver.test.ts` lines 886-909, 960-979, 1019-1069):
```typescript
expect(resolved.content).toBe('Hello Ada');
expect(metadata[0].template_params_used).toEqual({ name: { type: 'string', chars: 3 } });
expect(failed.reason).toBe('template_missing_required_param');
expect(failed.reason).toBe('template_param_doc_not_found');
```

**Registry schema assertions** (`tests/unit/llm-tool-registry.test.ts` lines 339-389, 463-480):
```typescript
expect(result.providerTools?.[0]).toMatchObject({
  type: 'function',
  function: { name: 'get_document', strict: true },
});
expect(tool.function.strict).toBe(true);
expect(tool.function.parameters).toMatchObject({ type: 'object', additionalProperties: false });
```

### Existing unit test modifications

**`tests/unit/llm-tool-registry.test.ts`:** copy the deterministic assembly assertions from lines 226-319; add template/name collision cases and final merged registry order.

**`tests/unit/llm-tool-dispatcher.test.ts`:** copy recoverable payload assertions from lines 84-119 and sibling failure preservation from lines 172-202. Add template reverse-map dispatch, reverse-map miss `tool_not_in_registry`, missing required param, invalid document param, and mixed native/template parallel calls.

**`tests/unit/llm-agent-loop.test.ts`:** copy Mode 2 selection and dispatcher assertions from lines 78-173. Add template-only provider-tools case and assert dispatcher receives template reverse map/context.

**`tests/unit/llm-tool.test.ts`:** copy `hasModelVisibleTools` cases from lines 1467-1494 and Mode 2 envelope mapping from lines 1497-1592. Add `list_purposes` diagnostics shape and template-only purpose Mode 2 routing.

### `tests/integration/template-tools.integration.test.ts`

**Analog:** `tests/integration/llm-config-sync.test.ts`

**Supabase availability and cleanup pattern** (lines 73-104):
```typescript
describe('LLM config sync purpose-template bindings (Integration)', () => {
  let available = false;

  beforeAll(async () => {
    if (!HAS_SUPABASE) {
      console.log('Skipping ...: Supabase not available');
      return;
    }
    const config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    available = true;
  }, 30000);

  beforeEach(async () => {
    if (!available) return;
    await cleanup();
    vi.restoreAllMocks();
  });
});
```

**Binding assertions** (lines 112-159):
```typescript
await syncLlmConfigToDb(config);
const { data: yamlRows } = await client
  .from('fqc_purpose_templates')
  .select('purpose_name, template_path, source')
  .eq('instance_id', instanceId)
  .eq('template_path', 'Templates/research-skill.md');
expect(yamlRows).toEqual([{ purpose_name: 'researcher', template_path: 'Templates/research-skill.md', source: 'yaml' }]);
```

**Apply to Phase 118:** add temp vault files and mutate their frontmatter between assemblies to prove fresh `fq_desc`/`fq_params` reads without requiring a scan.

### `tests/e2e/call-model-template-tools.e2e.test.ts`

**Analog:** `tests/e2e/call-model-agent-loop.e2e.test.ts`

**Scripted provider** (lines 14-50, 64-86):
```typescript
class ScriptedOpenAiProvider {
  readonly requests: Record<string, unknown>[] = [];
  private script: MockResponse[];
  async start(): Promise<void> { /* local HTTP server records request bodies */ }
}

function toolCallResponse(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>): MockResponse {
  return { body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls.map(...) }, finish_reason: 'tool_calls' }] } };
}
```

**Managed MCP subprocess** (lines 88-175):
```typescript
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', entryPoint, 'start', '--config', configPath],
  stderr: 'pipe',
  env: process.env as Record<string, string>,
  cwd: projectRoot,
});
const client = new Client({ name: 'agent-loop-e2e', version: '1.0.0' });
```

**Assertions to copy** (lines 187-224, 226-258):
```typescript
expect(envelope).toMatchObject({
  response: 'native loop complete',
  messages: expect.arrayContaining([
    expect.objectContaining({ role: 'assistant', name: 'agentic', tool_calls: expect.any(Array) }),
    expect.objectContaining({ role: 'tool', tool_call_id: 'call_search_1' }),
  ]),
  metadata: { tools: { stop_reason: 'final_response', calls_log: expect.any(Array) } },
});
expect(provider.requests[1]).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ role: 'tool' })]) });
```

### Directed scenario files

**Analog:** `tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py`

**Mock provider pattern** (lines 35-62, 85-92):
```python
class MockProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.responses = [
            {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [...]}, "finish_reason": "tool_calls"}]},
            {"choices": [{"message": {"role": "assistant", "content": "ATL-DS-09 final"}, "finish_reason": "stop"}]},
        ]

    def do_POST(self) -> None:
        parent.requests.append(json.loads(self._read_request_body()))
        payload = json.dumps(parent.responses.pop(0)).encode("utf-8")
```

**Managed server + public tool call pattern** (lines 126-157):
```python
with MockProvider() as provider:
    with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url)) as server:
        client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
        result = client.call_tool(
            "call_model",
            resolver="purpose",
            name="agentic_native",
            messages=[{"role": "user", "content": "ATL-DS-09 native loop"}],
            return_messages=True,
            trace_id="atl-ds-09",
        )
        envelope = json.loads(result.text) if result.ok else {}
```

**Vault template fixture pattern** (`test_call_model_template_parameterization.py` lines 106-112, 156-181):
```python
def _write_doc(vault: Path, rel_path: str, body: str, **frontmatter: object) -> str:
    fqc_id = str(uuid.uuid4())
    path = vault / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    fm_lines = [f"fq_id: {fqc_id}", "fq_status: active", *[f"{k}: {json.dumps(v)}" for k, v in frontmatter.items()]]
    path.write_text("---\n" + "\n".join(fm_lines) + "\n---\n\n" + body)
```

**Apply to Phase 118:** use `_write_doc()` to create exposed/non-exposed/colliding templates, `force_file_scan` only where tests intentionally bind/discover stored rows, and assert solely through public `call_model` plus provider request captures.

## Shared Patterns

### Authentication / Controller Guard
**Source:** `src/mcp/tools/llm.ts` lines 303-325  
**Apply to:** `src/mcp/tools/llm.ts` changes
```typescript
if (getIsShuttingDown()) {
  return { content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed.' }], isError: true };
}
const client = llmClient;
if (!client || client instanceof NullLlmClient) {
  return { content: [{ type: 'text' as const, text: 'LLM is not configured. Add an llm: section to flashquery.yml to use this tool.' }], isError: true };
}
```

### Error Handling
**Source:** `src/llm/tool-dispatcher.ts` lines 127-151  
**Apply to:** all model-initiated template-tool failures
```typescript
function dispatchError(toolCall: LlmChatToolCall, args: Record<string, unknown>, code: string, message: string, details?: unknown): NativeToolDispatchResult {
  const payload = errorPayload(code, message, details);
  const content = JSON.stringify(payload);
  return { message: makeToolMessage(toolCall, content), logEntry: makeLogEntry(toolCall, args, payload, content) };
}
```

### Validation
**Source:** `src/llm/reference-resolver.ts` lines 905-958  
**Apply to:** template dispatch argument validation
```typescript
if (!hasSupplied && !hasDefault && declaration.required === true) {
  throw new TemplateReferenceError('template_missing_required_param', `Required template parameter '${name}' is missing`);
}
if (declaration.type === 'document') {
  const doc = await resolvePlainDocumentContent(rawValue, config, sm, ep, log);
  values[name] = doc.content;
}
```

### Non-Recursive Hydration
**Source:** `src/llm/reference-resolver.ts` lines 1107-1174  
**Apply to:** template-tool rendering
```typescript
export function hydrateMessages<T extends { role: string; content?: string | null }>(
  messages: T[],
  resolved: ResolvedRef[]
): T[] {
  const byMsgIdx = new Map<number, ResolvedRef[]>();
  // apply replacements right-to-left against original content
}
```

### Public Discovery Shape
**Source:** `src/mcp/tools/llm.ts` lines 384-408 and `tests/unit/llm-tool.test.ts` lines 1886-1954  
**Apply to:** `list_purposes` template diagnostics
```typescript
const purposeToResponse = (p: typeof cfgPurposes[number]): Record<string, unknown> => {
  const entry: Record<string, unknown> = { name: p.name, description: p.description, models: p.models };
  if (p.defaults !== undefined) entry['defaults'] = p.defaults;
  return entry;
};
```

Add `template_tools` and `template_tool_conflicts` beside existing purpose fields without changing discovery envelope `{ purposes: [...] }`.

## No Analog Found

None. `src/llm/template-tools.ts` has no exact single-file analog, but its responsibilities are covered by strong role-match analogs in `reference-resolver.ts`, `tool-registry.ts`, and `tool-dispatcher.ts`.

## Metadata

**Canonical source docs read:** `Agentic-LLM-Tool-Loop.md`, `Document Reference System.md`, `ATL Test Plan.md`  
**Analog search scope:** `src/llm`, `src/mcp/tools`, `tests/unit`, `tests/integration`, `tests/e2e`, `tests/scenarios/directed/testcases`  
**Files scanned:** 230  
**Pattern extraction date:** 2026-05-06
