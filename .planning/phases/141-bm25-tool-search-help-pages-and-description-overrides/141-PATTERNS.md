# Phase 141: BM25 Tool Search, Help Pages, And Description Overrides - Pattern Map

**Mapped:** 2026-05-18  
**Files analyzed:** 38 new/modified file groups  
**Analogs found:** 34 / 38

## Canonical Read-First Requirement

Every downstream implementation or test agent MUST read these two docs before changing code or tests:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md`

If this pattern map, generated plans, or research conflict with those docs, treat the two MCP Broker docs as authoritative and call out the conflict.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/services/tool-search/indexer.ts` | service/utility | transform | MCP Broker BM25 POC `pure.ts` | exact external |
| `src/services/tool-search/stopwords.ts` | utility | transform | MCP Broker BM25 POC `pure.ts` lines 12-35 | exact external |
| `src/services/tool-search/tool-search-service.ts` | service | event-driven/request-response | `src/services/mcp-broker/index.ts` | role-match |
| `src/services/tool-search/search-tools-handler.ts` | service/tool handler | request-response | `src/mcp/tools/scan.ts`, `src/mcp/tools/llm.ts` | role-match |
| `src/services/tool-search/tool-meta.ts` | service/utility | file-I/O/transform | `src/mcp/tool-metadata.ts`, `src/config/loader.ts` | role-match |
| `src/services/tool-search/audit.ts` or `src/services/mcp-broker/trace.ts` extension | utility | event-driven | `src/services/mcp-broker/trace.ts` | exact |
| `src/mcp/tools/search_tools.tool.md` | config/documentation | file-I/O | no `.tool.md` analog yet | no analog |
| `src/mcp/tools/<native_tool>.tool.md` | config/documentation | file-I/O | `src/mcp/tool-metadata.ts` descriptions | partial |
| `src/mcp/tool-catalog.ts` | provider/catalog | event-driven | existing same file lines 30-57 | exact |
| `src/mcp/server.ts` | provider/startup | request-response/startup | existing same file lines 469-489 | exact |
| `src/llm/tool-registry.ts` | utility/provider | transform | existing same file lines 236-309 | exact |
| `src/llm/agent-loop.ts` | service | request-response | existing same file lines 323-341, 404-488 | exact |
| `src/llm/tool-dispatcher.ts` | service | request-response | existing same file lines 185-243, 282-350 | exact |
| `src/config/loader.ts` | config | transform | existing same file lines 180-290, 620-650 | exact |
| `tests/fixtures/tool-search/*` | test fixture | file-I/O | MCP Broker BM25 POC corpus/query files | exact external |
| `tests/unit/tool-search/indexer.test.ts` | test | transform | POC `incremental-test.ts`, `tests/unit/mcp-broker-tofu.test.ts` | exact external |
| `tests/unit/tool-search/tool-meta.test.ts` | test | file-I/O/validation | `tests/unit/tool-metadata.test.ts`, `tests/unit/config.test.ts` | role-match |
| `tests/unit/tool-search/search-tools-handler.test.ts` | test | request-response | `tests/unit/llm-tool-dispatcher.test.ts` | role-match |
| `tests/integration/tool-search/search-tools.integration.test.ts` | test | request-response/event-driven | `tests/integration/mcp-broker/tofu-list-changed.test.ts` | role-match |
| `tests/scenarios/directed/testcases/test_mcp_broker_phase_c.py` | test | request-response | `tests/scenarios/directed/testcases/test_mcp_broker_phase_a.py` | exact |
| `tests/scenarios/integration/tests/description_override_substitution.yml` | test | request-response | `tests/scenarios/integration/tests/brokered_purpose_dispatch.yml` | role-match |
| `tests/scenarios/integration/tests/search_tools_workflow.yml` | test | request-response | `tests/scenarios/integration/tests/brokered_purpose_dispatch.yml` | role-match |

## Pattern Assignments

### `src/services/tool-search/indexer.ts` (service/utility, transform)

**Analog:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/src/libraries/pure.ts`

**Imports and zero-dependency pattern** (lines 1-10):
```typescript
// Hand-rolled BM25 implementation - zero-dep, the production candidate.
import type { Indexer, IndexStats, SearchResult, Tool, ToolKey, BM25Params, PreprocOpts } from '../types.js';
```

**Pinned tokenizer/stopword pattern** (lines 12-35, 74-89):
```typescript
const STOPWORDS = new Set([/* 153 words, inline */]);

function tokenize(text: string, opts: PreprocOpts): string[] {
  if (!text) return [];
  const raw = text.toLowerCase().split(/[^A-Za-z0-9_\-.]+/).filter(Boolean);
  let filtered = out.filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  if (opts.stopwords) filtered = filtered.filter((t) => !STOPWORDS.has(t));
  if (opts.stemming) filtered = filtered.map(lightStem);
  return filtered;
}
```

**Core indexer pattern** (lines 93-132, 135-172):
```typescript
export class PureBM25Indexer implements Indexer {
  name = 'pure';
  private delta = 0.25;
  private keyIndex: Map<string, number> = new Map();
  private deletedDocs: Set<number> = new Set();

  async build(tools: Tool[]): Promise<void> {
    for (const t of tools) this.indexDoc(t);
    this.recomputeIdf();
  }

  async addTools(tools: Tool[]): Promise<void> {
    const existing = this.keyIndex.get(k);
    if (existing !== undefined && !this.deletedDocs.has(existing)) continue;
  }

  async removeTools(keys: ToolKey[]): Promise<void> {
    const id = this.keyIndex.get(`${k.server}:${k.tool}`);
    if (id === undefined || this.deletedDocs.has(id)) continue;
  }
}
```

**Production delta:** POC `build()` appends. Production must clear/swap internal state before indexing to satisfy REQ-076.

**Search/stats pattern** (lines 217-260, 263-278):
```typescript
search(query: string, k: number): SearchResult[] {
  const qTokens = tokenize(query, this.preproc);
  const scores = new Float64Array(this.docLengths.length);
  heap.sort((a, b) => b.score - a.score);
  return heap.slice(0, k).map((h) => ({
    server: this.docKeys[h.docId].server,
    tool: this.docKeys[h.docId].tool,
    score: h.score,
    normalizedScore: qMaxScore > 0 ? Math.min(1, h.score / qMaxScore) : 0,
  }));
}
```

### `src/services/tool-search/tool-search-service.ts` (service, event-driven/request-response)

**Analog:** `src/services/mcp-broker/index.ts`

**Index sink seam** (types lines 103-106):
```typescript
export interface ToolIndexSink {
  addTools(tools: BrokeredTool[]): void;
  removeTools(keys: RegistryKey[]): void;
}
```

**Synchronous add/remove fanout** (`index.ts` lines 92-145):
```typescript
const previousTools = this.#registry.listAll().filter((tool) => tool.serverId === serverId);
const diff = diffToolSnapshots(previousTools, refreshedTools);
const removedKeys = this.#removeTools([...diff.removed, ...diff.changed]);
if (removedKeys.length > 0) {
  this.#indexSink.removeTools(removedKeys);
}

if (toolsToAdd.length > 0) {
  this.#indexSink.addTools(toolsToAdd);
}
```

**Consumer visibility pattern** (`index.ts` lines 203-210, `registry.ts` lines 167-180):
```typescript
async listToolsForConsumer(ctx: ConsumerContext): Promise<BrokeredTool[]> {
  await Promise.all(this.#registry.listVisibleServerIds(ctx).map((serverId) =>
    this.ensureConnected(serverId, snapshotOptionsFromConsumerContext(ctx))
  ));
  return this.#registry.listToolsForConsumer(ctx);
}
```

Use this pattern for per-purpose and host indexes. Convert registered `BrokeredTool.description` into index docs, never `upstreamDescription`.

### `src/services/tool-search/search-tools-handler.ts` (tool handler, request-response)

**Analogs:** `src/mcp/tools/scan.ts`, `src/mcp/tools/llm.ts`, `src/services/mcp-broker/trace.ts`

**MCP tool response shape** (`scan.ts` lines 10-47):
```typescript
server.registerTool(
  'maintain_vault',
  { description: '...', inputSchema: { action: z.union([...]) } },
  async ({ action, dry_run, background, job_id }) => {
    const result = await maintainVault(config, input);
    if (result.ok) return jsonToolResult(result.payload);
    if (result.error.error === 'runtime_error') return jsonRuntimeError(result.error);
    return jsonExpectedError(result.error);
  }
);
```

**Discovery/no-LLM branch pattern** (`llm.ts` lines 342-357):
```typescript
if (params.resolver === 'help') {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(buildCallModelHelpContent({ configured: !!client })) }],
  };
}
```

**Audit trace pattern** (`trace.ts` lines 17-27, 52-58):
```typescript
const _brokerAuditEvents: BrokerAuditEvent[] = [];

export function recordBrokerAuditEvent(event: BrokerAuditEventInput): BrokerAuditEvent {
  const timestamped: BrokerAuditEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
  _brokerAuditEvents.push(structuredClone(timestamped));
  return timestamped;
}
```

`fq.search_tools` should return JSON text in `{ content: [{ type: 'text', text }] }`, include empty arrays for empty query/corpus, and record `{ consumer, query, result_count, latency_us, trace_id }`.

### `src/services/tool-search/tool-meta.ts` (utility/service, file-I/O/transform)

**Analogs:** `src/mcp/tool-metadata.ts`, `src/config/loader.ts`, `src/mcp/tool-catalog.ts`

**Existing metadata shape** (`tool-metadata.ts` lines 9-21):
```typescript
export interface ToolMetadata {
  name: string;
  status: ToolStatus;
  categories: ToolCategory[];
  tier: ToolTier;
  hostEligible: boolean;
  delegatedEligible: boolean;
  description: string;
}
```

**Metadata lookup and registered-tool assertion** (`tool-metadata.ts` lines 278-355):
```typescript
const TOOL_METADATA_BY_NAME = new Map<string, ToolMetadata>(TOOL_METADATA.map((entry) => [entry.name, entry]));

export function getToolMetadata(name: string): ToolMetadata | undefined {
  return TOOL_METADATA_BY_NAME.get(name);
}

export function assertRegisteredToolsHaveMetadata(catalog: Array<{ name: string }>): void {
  const missing = catalog.map((tool) => tool.name).filter((name) => getToolMetadata(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing MCP tool metadata for registered tools: ${missing.sort().join(', ')}`);
  }
}
```

**Zod strict validation style** (`config/loader.ts` lines 235-260, 272-290):
```typescript
const BrokerToolOverrideSchema = z.object({
  cost_per_call: z.number().min(0).default(0),
  description_override: z.string().optional(),
}).strict();

const ConfigSchema = z.object({ mcp_servers: z.record(z.string(), BrokerServerSchema).default({}) }).strict();
```

Use `gray-matter` for frontmatter. Validate `name`, `description`, `help_hint`, `tier`, `args`, filename/name match, duplicates, and suffix. Return warnings for short descriptions; throw clear startup/build errors for invalid metadata.

### `src/mcp/tool-catalog.ts` (catalog/provider, event-driven)

**Analog:** existing same file.

**Description substitution + catalog capture** (lines 30-57):
```typescript
server.registerTool = ((name: string, config: ToolRegistrationConfig, cb: unknown) => {
  const metadataDescription = getToolMetadata(name)?.description;
  const registeredConfig = metadataDescription === undefined
    ? config
    : { ...config, description: metadataDescription };
  catalog.push({
    name,
    description: registeredConfig.description ?? '',
    inputSchema: registeredConfig.inputSchema ?? {},
    handler,
  });
  if (options.hostEnabledToolNames && !options.hostEnabledToolNames.has(name)) {
    return undefined;
  }
  return originalRegisterTool(name, registeredConfig, cb as never);
}) as RegisterToolFunction;
```

Phase 141 should redirect native descriptions to `TOOL_META.description` while preserving catalog capture and host exposure filtering.

### `src/mcp/server.ts` (startup/provider, request-response)

**Analog:** existing same file.

**Startup registration/validation order** (lines 469-489):
```typescript
export function createMcpServer(config: FlashQueryConfig, version: string, options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'flashquery', version });
  const broker = options.broker ?? createBroker(config);
  wrapServerWithCorrelationIds(server);
  wrapServerWithToolCatalog(server, { hostEnabledToolNames });
  registerMemoryTools(server, config);
  // ...
  registerLlmTools(server, config, { broker });
  registerMacroTools(server, config, { broker });
  validateAndCacheNativeToolSchemas(getNativeToolCatalog(server));
  return server;
}
```

Add `TOOL_META` loading/validation before final schema validation and before native descriptions are frozen for MCP registration.

### `src/llm/tool-registry.ts` (provider utility, transform)

**Analog:** existing same file.

**Native/brokered provider conversion** (lines 178-205):
```typescript
export function toOpenAiToolDefinition(tool: NativeToolDefinition, options: OpenAiToolDefinitionOptions): OpenAiToolDefinition {
  const zodSchema = toZodObjectSchema(tool.inputSchema);
  const parameters = normalizeToolJsonSchema(z.toJSONSchema(zodSchema), options);
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters } };
}

export function toOpenAiBrokeredToolDefinition(tool: BrokeredTool): OpenAiToolDefinition {
  const parameters = isRecord(tool.inputSchema) ? tool.inputSchema : {};
  return { type: 'function', function: { name: tool.registryKey, description: tool.description ?? '', parameters } };
}
```

**Delegated native assembly** (lines 236-309):
```typescript
const purpose = config.llm?.purposes.find((candidate) => candidate.name.toLowerCase() === purposeName.toLowerCase());
const requestedTools = purpose?.tools ?? [];
// expand tiers, apply exclusions, hard exclusions
const providerTools = nativeToolNames.map((toolName) => getCachedOpenAiToolDefinition(tool, { strict: options?.strictTools === true }));
return { nativeToolNames, ...(providerTools.length > 0 ? { providerTools } : {}), diagnostics };
```

For `tool_search: enabled`, build eligible native names normally for index contents, but expose only `fq.search_tools` in `providerTools` up front.

### `src/llm/agent-loop.ts` (service, request-response)

**Analog:** existing same file.

**Current flat-list behavior to preserve for disabled purposes** (lines 333-341):
```typescript
const nativeToolNames = getNativeToolNames(options);
const consumerContext = makePurposeConsumerContext(options);
const brokeredTools = options.broker === undefined
  ? []
  : await options.broker.listToolsForConsumer(consumerContext);
const providerTools = [
  ...getProviderTools(options),
  ...brokeredTools.map(toOpenAiBrokeredToolDefinition),
];
```

**Provider tool injection point** (lines 404-410):
```typescript
result = await chatByPurpose(options.purposeName, messages, {
  ...parameters,
  ...(providerTools.length > 0 ? { tools: providerTools } : {}),
  signal: abortController.signal,
});
```

**Dispatcher context** (lines 473-488):
```typescript
const dispatchResult = await dispatcher({
  toolCalls,
  catalog: options.nativeToolCatalog ?? [],
  nativeToolNames,
  broker: options.broker,
  consumerContext,
});
```

Search-enabled purposes should still keep `nativeToolNames` broad enough that discovered FQ-native tools can dispatch, while initial `providerTools` contains only the search tool and allowed always-present tools.

### `src/llm/tool-dispatcher.ts` (service, request-response)

**Analog:** existing same file.

**Brokered pass-through and unwrapped errors** (lines 185-243):
```typescript
ref = parseRegistryKey(toolCall.function.name);
const visibleTools = await options.broker.listToolsForConsumer(options.consumerContext);
const visibleTool = visibleTools.find((tool) => tool.registryKey === toolCall.function.name);
const result = await options.broker.callTool(ref, args, options.consumerContext);
recordBrokeredToolCall({ traceId: options.consumerContext.traceId, serverId: ref.serverId, toolName: ref.toolName });
if (result.isError === true) {
  const normalized = formatToolError(result, ref);
  return dispatchError(toolCall, args, normalized.kind, normalized.message, undefined, 'brokered');
}
```

**Native validation/error point to modify for `help: true`** (lines 282-350):
```typescript
const tool = catalogByName.get(toolName);
let parsedArgs: Record<string, unknown>;
try {
  parsedArgs = toZodObjectSchema(tool.inputSchema).parse(args);
} catch (error: unknown) {
  return dispatchError(options.toolCall, args, 'invalid_tool_arguments', `Arguments for native tool '${toolName}' failed validation.`, ...);
}

const result = await tool.handler(parsedArgs, dispatchContext);
if (result.isError === true) {
  return dispatchError(options.toolCall, parsedArgs, 'handler_error', `Native tool '${toolName}' returned an error response.`, result);
}
```

Insert `args.help === true` before Zod parse for FQ-native tools. Append help footer only on native failures. Leave brokered `help:true` and brokered errors unchanged.

### `src/config/loader.ts` (config, transform)

**Analog:** existing same file.

**Existing Phase 139/140 broker config schema** (lines 180-190, 235-260):
```typescript
const PurposeSchema = z.object({
  mcp_servers: z.array(z.string()).optional(),
  tool_search: z.enum(['enabled', 'disabled']).default('disabled'),
}).strict();

const HostSchema = z.object({
  mcp_servers: z.array(z.string()).default([]),
  tool_search: z.enum(['enabled', 'disabled']).default('disabled'),
}).strict().prefault({});
```

**CamelCase exported config shape** (lines 312-324, 347-357):
```typescript
mcpServers: Record<string, { toolOverrides: Record<string, { descriptionOverride?: string }> }>;
host: { mcpServers: string[]; toolSearch: 'enabled' | 'disabled' };
llm?: { purposes: Array<{ mcpServers?: string[]; toolSearch: 'enabled' | 'disabled' }> };
```

Use the existing camelCase conversion; do not add snake_case fields to runtime types.

## Test Pattern Assignments

### `tests/unit/tool-search/indexer.test.ts`

**Analogs:** POC `incremental-test.ts`, `tests/unit/mcp-broker-tofu.test.ts`

**Vitest style** (`mcp-broker-tofu.test.ts` lines 1-23):
```typescript
import { describe, expect, it } from 'vitest';

describe('mcp broker TOFU helpers', () => {
  it('canonicalJson serializes nested object keys in stable sorted order', () => {
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});
```

**Four-invariant source** (POC `incremental-test.ts` lines 50-149):
```typescript
await a.build(aSlice);
await b.build(bInit);
await b.addTools(bAdd);
expect(Math.abs(mrrA - mrrB)).toBeLessThan(EPSILON);

await dirty.addTools(tools.slice(0, 50));
await dirty.removeTools([]);
await dirty.removeTools([{ server: 'nonexistent-server', tool: 'nonexistent-tool' }]);
```

Add direct assertions for pinned constants and `build()` called twice.

### `tests/unit/tool-search/tool-meta.test.ts`

**Analogs:** `tests/unit/native-tool-catalog.test.ts`, `src/mcp/tool-metadata.ts`

**Real registered catalog pattern** (`native-tool-catalog.test.ts` lines 60-82):
```typescript
const server = createMcpServer(config, 'test');
const catalog = getNativeToolCatalog(server);
const registry = assembleNativeToolRegistry(config, 'delegated-tier-edit', catalog);

expect(catalog.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_vault', 'copy_document']));
```

Use this to assert every registered FQ-native tool has a `.tool.md` entry plus `search_tools`.

### `tests/unit/tool-search/search-tools-handler.test.ts`

**Analog:** `tests/unit/llm-tool-dispatcher.test.ts`

**Mock broker/tool helper style** (lines 68-89):
```typescript
function brokeredTool(overrides: Partial<BrokeredTool> = {}): BrokeredTool {
  return { serverId: 'basic', toolName: 'echo', registryKey: 'basic__echo', description: 'Echo through broker', ...overrides };
}

function makeBroker(tools: BrokeredTool[], callTool = vi.fn()): Broker {
  return { listToolsForConsumer: vi.fn(async (_ctx: ConsumerContext) => tools), callTool, ... };
}
```

Assert result envelope fields, empty states, override descriptions, native-only `has_help`, and audit records.

### `tests/integration/tool-search/search-tools.integration.test.ts`

**Analog:** `tests/integration/mcp-broker/tofu-list-changed.test.ts`

**Tracked index sink pattern** (lines 68-90):
```typescript
const sinkEvents: SinkEvent[] = [];
const broker = createBroker({
  mcpServers: { quirky: brokerConfig(...) },
  host: { mcpServers: ['quirky'] },
  indexSink: {
    addTools: (tools) => sinkEvents.push({ type: 'add', keys: tools.map((tool) => tool.registryKey) }),
    removeTools: (keys) => sinkEvents.push({ type: 'remove', keys }),
  },
});
```

**Async wait pattern** (lines 113-120):
```typescript
async function waitForCondition(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition.');
}
```

Use this for list_changed -> index update timing, POC ranking fixtures, performance budgets, and override propagation.

### `tests/scenarios/directed/testcases/test_mcp_broker_phase_c.py`

**Analog:** `tests/scenarios/directed/testcases/test_mcp_broker_phase_a.py`

**Managed broker config pattern** (lines 30-56):
```python
def _broker_config(args: argparse.Namespace) -> dict:
    root = _project_root(args)
    node = shutil.which("node") or "node"
    fixture_dir = root / "tests" / "fixtures" / "mcp-servers"
    return {
        "host_mcp_tools": {"tools": ["call_macro"]},
        "mcp_servers": {"basic": {"transport": "stdio", "command": node, "args": ["--import", "tsx", str(fixture_dir / "server-basic.ts")]}},
        "host": {"mcp_servers": ["basic"], "tool_search": "disabled"},
    }
```

**TestContext and step pattern** (lines 80-113):
```python
with TestContext(fqc_dir=args.fqc_dir, managed=True, port_range=port_range, extra_config=_broker_config(args)) as ctx:
    success = client.call_tool("call_macro", source='...')
    run.step(
        label="MCB-01 / T-S-001 ...",
        passed=success.ok and ...,
        detail=json.dumps(success_payload, sort_keys=True)[:1000],
        timing_ms=success.timing_ms,
        tool_result=success,
    )
```

Phase C should cover MCB-21 and MCB-22 in one file.

### `tests/scenarios/integration/tests/*.yml`

**Analog:** `tests/scenarios/integration/tests/brokered_purpose_dispatch.yml`

**Managed mock OpenAI + broker config pattern** (lines 1-72):
```yaml
name: brokered_purpose_dispatch
coverage: [INT-MCB-01]
server_modes: [managed]

mock_openai:
  responses:
    - choices:
        - message:
            role: assistant
            tool_calls:
              - function:
                  name: basic__echo
                  arguments: { value: { marker: "purpose-dispatch-${run.id}" } }

extra_config:
  mcp_servers:
    basic:
      transport: stdio
      command: node
      args: ["--import", "tsx", "tests/fixtures/mcp-servers/server-basic.ts"]
  llm:
    purposes:
      - name: broker_researcher
        mcp_servers: [basic]
```

**Assertion pattern** (lines 73-91):
```yaml
steps:
  - label: "INT-MCB-01: purpose call_model dispatches basic__echo through broker"
    assert:
      op: call_model
      args:
        resolver: purpose
        name: broker_researcher
        return_messages: true
      expect_contains: "complete"
      expect_json_path:
        - metadata.tools.calls_log[0].tool_calls[0].tool_name
```

Use one YAML file for `description_override` substitution and one for `search_tools` workflow.

## Shared Patterns

### MCP Tool Responses

**Source:** `src/mcp/tools/scan.ts` lines 36-47  
**Apply to:** `fq.search_tools`, native help responses, errors

Return `{ content: [{ type: 'text', text }] }`; add `isError: true` only for failures.

### Description Override Split

**Source:** `src/services/mcp-broker/registry.ts` lines 102-125  
**Apply to:** brokered index docs, search results, provider tools, host tools

```typescript
const upstreamDescription = input.description;
const tool: BrokeredTool = {
  ...(override?.descriptionOverride === undefined
    ? { description: input.description }
    : { description: override.descriptionOverride, upstreamDescription }),
};
```

TOFU must keep hashing `upstreamDescription`; search/index/host/model surfaces must use `description`.

### Brokered vs Native Error Boundary

**Source:** `src/llm/tool-dispatcher.ts` lines 221-242, 326-348  
**Apply to:** help footer and `help:true` behavior

Brokered errors stay unwrapped. Native errors get the FlashQuery help footer after Phase 141. `help:true` interception belongs only in native dispatch before Zod validation.

### Tool Exposure and Tier Eligibility

**Source:** `src/mcp/tool-metadata.ts` lines 303-329; `src/llm/tool-registry.ts` lines 236-309  
**Apply to:** native index contents and search-enabled purpose eligibility

Use existing tier/category/delegated eligibility functions. Do not invent a new eligibility model for FQ-native tools.

### Startup Validation

**Source:** `src/mcp/server.ts` lines 469-489  
**Apply to:** `.tool.md` metadata validation

Load and validate `TOOL_META` during server creation so missing or malformed help pages fail before tool exposure.

### Trace/Audit

**Source:** `src/services/mcp-broker/trace.ts` lines 17-67  
**Apply to:** `search_tools` audit

Use in-memory trace helpers with explicit clear/snapshot test functions. Do not log raw args, result payloads, or help bodies.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/mcp/tools/*.tool.md` | config/documentation | file-I/O | No existing `.tool.md` convention in FlashQuery. Use MCP Broker Requirements section 7.13 as source. |
| `src/mcp/tools/search_tools.tool.md` | config/documentation | file-I/O | New native help-page format. Must include `help: true` suffix and useful body sections. |
| `tests/fixtures/tool-search/*` | fixture | file-I/O | No existing tool-search fixtures. Copy POC corpus/query fixtures from canonical product folder. |
| `src/services/tool-search/stopwords.ts` if split | utility | transform | No existing stopword utility. Copy inline POC list exactly if split from indexer. |

## Metadata

**Analog search scope:** `src/services`, `src/mcp`, `src/llm`, `src/config`, `tests/unit`, `tests/integration`, `tests/scenarios`, MCP Broker POC files.  
**Files scanned:** repository `src`/`tests` file list plus canonical docs and POC BM25 source.  
**Pattern extraction date:** 2026-05-18.
