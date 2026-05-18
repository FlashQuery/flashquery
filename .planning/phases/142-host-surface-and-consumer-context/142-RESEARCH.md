# Phase 142: Host Surface And ConsumerContext - Research

**Researched:** 2026-05-18  
**Domain:** MCP broker host surface, consumer-aware tool visibility, trace/cost accounting, and host/delegated broker state sharing  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Source-of-Truth Documents
- Downstream planning, execution, review, and test agents MUST read the MCP Broker requirements and MCP Broker test plan before making implementation decisions.
- Treat the source requirements document as authoritative for requirement semantics and implementation contracts.
- Treat the source test plan as authoritative for validation IDs, scenario names, and acceptance coverage.

### Host Config And Surface
- `host:` is a new top-level broker config section, peer to `purposes:`, distinct from existing `host_mcp_tools`.
- Absence of `host:` means the host exposes only FQ-native tools selected by existing `host_mcp_tools`.
- Empty `host: {}` is valid and equivalent to absence: no brokered host tools, `tool_search` disabled, no host BM25 index.
- `host.mcp_servers` is a string array of server IDs that must exist in top-level `mcp_servers:`.
- `host.tool_search` defaults to `disabled`; when `enabled`, a host index is built at startup from FQ-native plus host-visible brokered tools.
- Existing `host_mcp_tools` and new `host.mcp_servers` are additive and govern different surfaces.

### Consumer Context And Filtering
- Use one shared broker registry with per-consumer filtered views, not separate registries.
- `ConsumerContext` must distinguish host from delegated purpose callers and carry the trace scope.
- `Broker.listToolsForConsumer(ctx)` returns only tools visible to that consumer.
- Dispatch must reject brokered registry keys that are not visible to the current consumer.
- `ConsumerContext` is established once at the outermost macro/call frame and inherited across nested macro frames.

### Shared Broker State
- Host and delegated consumers share server instances; a server listed for both host and a purpose must spawn once.
- TOFU pins are shared across consumers because they belong to the FlashQuery process/server/tool pair, not to one consumer view.
- Lazy spawn behavior must be unified across host and delegated callers.

### Trace And Observability
- Per-`call_model` trace records gain a `tool_calls` array.
- Host-initiated brokered calls also produce `tool_calls` entries under the host chat/session trace.
- Host-invoked macros inherit host trace scope rather than creating a fresh `call_model` trace.
- Tool call trace entries must carry enough metadata to prove resolved cost accounting and consumer scope.

### Test Coverage
- Plans must include tests mapped to the Phase D test IDs in the MCP Broker test plan, especially `T-U-036`, `T-U-037`, `T-I-030`, `T-I-031`, `T-I-032`, `T-I-038`, `T-I-039`, `T-E-D1`, `T-S-012..016`, and `T-Y-002`, `T-Y-003`, `T-Y-006`, `T-Y-009`, `T-Y-010`, `T-Y-011`.
- Scenario coverage ledgers must be updated with the relevant `MCB-*` and `INT-MCB-*` IDs when scenario tests are added.

### the agent's Discretion
- Exact plan boundaries, wave ordering, and test file placement are planner discretion, as long as every Phase 142 requirement and referenced test ID is covered.
- Executors may choose local helper names and small internal abstractions that match existing broker/config/trace patterns.

### the agent's Discretion
- Exact plan boundaries, wave ordering, and test file placement are planner discretion, as long as every Phase 142 requirement and referenced test ID is covered.
- Executors may choose local helper names and small internal abstractions that match existing broker/config/trace patterns.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Per-tool subsetting in `host.mcp_servers` or `purposes.<name>.mcp_servers` remains out of scope for v1.
- Persistent TOFU across FlashQuery restarts remains out of scope.
- Streamable HTTP transport, OAuth/DCR, MCP resources/prompts/sampling/elicitation forwarding, and semantic vector tool routing remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-005..010 | Host config, defaults, host brokered visibility, and host index lifecycle. | Config schema already has `host`, validation, and host index seams; planner should focus remaining host MCP registration and end-to-end host behavior. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.1, §7.16] |
| REQ-031 | Single registry with per-consumer filtered views. | `ToolRegistry.listToolsForConsumer(ctx)` filters a shared map by host/purpose server sets. [VERIFIED: codebase grep] |
| REQ-035 | Dispatch rejects invisible brokered registry keys. | Purpose dispatch checks `broker.listToolsForConsumer(ctx)` before `Broker.callTool`; host registration/call path still needs the equivalent host MCP surface behavior. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.3] |
| REQ-065..067 | Brokered `tool_calls` trace entries for `call_model`, host calls, and host-invoked macro trace inheritance. | In-memory trace aggregation exists and `call_model` metadata reads it by `trace_id`; host direct tool calls need a host trace scope and registration wrapper to record entries. [VERIFIED: codebase grep] |
| REQ-113..118 | Host section design, `ConsumerContext`, nested macro inheritance, filtered listing, shared lazy spawn, shared TOFU pins. | `ConsumerContext` and shared broker already exist; current macro host path builds a host context from session ID, but nested inheritance should be tested and tightened. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 142 is an integration/closure phase, not a new broker foundation phase. `host:` config, `ConsumerContext`, registry filtering, broker trace maps, TOFU sharing, and host tool-search index seams already exist in the current codebase. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §5.6, §7.16]

The main remaining architectural responsibility is exposing host-visible brokered tools through the host MCP `tools/list`/`tools/call` surface using registry-key names, while preserving the existing native host filter from `host_mcp_tools`. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §5.6] The planner should also close direct host call tracing, nested macro consumer-context inheritance, Phase D directed/YAML coverage rows, and an E2E gate proving shared spawn and shared TOFU across host and delegated callers. [CITED: MCP Broker Test Plan §2, §3]

**Primary recommendation:** Add a host brokered-tool registration layer in `src/mcp/server.ts` after native tool registration/catalog capture, backed by `Broker.listToolsForConsumer({kind:'host', traceId, interactive:true})`, and validate it with the exact Phase D test IDs from the product test plan. [VERIFIED: codebase grep] [CITED: MCP Broker Test Plan Phase D]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `host:` config parsing/validation | API / Backend | CLI startup | Config is loaded before server construction and must fail before MCP startup on unknown server IDs. [VERIFIED: codebase grep] |
| Host brokered tool exposure | API / Backend | MCP host surface | FlashQuery owns the MCP server that answers host `tools/list` and routes host `tools/call`. [CITED: MCP spec tools/list, tools/call] |
| Consumer-aware filtering | API / Backend | LLM agent loop, macro engine | Visibility is a broker registry decision; callers should pass `ConsumerContext`, not reimplement filtering. [VERIFIED: codebase grep] |
| Lazy spawn unification | API / Backend | Child process transport | One `McpBroker` instance owns `BrokerClient` instances and their promise locks. [VERIFIED: codebase grep] |
| TOFU pin sharing | API / Backend | In-memory process state | Pins live in one broker process map, not per host/purpose view. [VERIFIED: codebase grep] |
| Host and purpose tool search | API / Backend | Tool-search service | BM25 indexes consume filtered broker views and native catalog snapshots. [VERIFIED: codebase grep] |
| Trace/cost accounting | API / Backend | Supabase usage metadata for `call_model` | Brokered calls record by `traceId`; `call_model` exposes snapshots in metadata. Host direct calls need the same trace scope. [VERIFIED: codebase grep] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20; current local Node is `v24.7.0`, satisfying the project prerequisite. [VERIFIED: command output] [CITED: AGENTS.md]
- Keep TypeScript strict-mode ESM; do not add CommonJS `require`. [CITED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`; do not use the non-existent `@modelcontextprotocol/server` package. [CITED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI. [CITED: AGENTS.md]
- MCP is stateless; do not implement server-side session state. [CITED: AGENTS.md]
- MCP tool handlers return `{ content: [{ type: "text", text: "..." }] }` and use `isError: true` on failure. [CITED: AGENTS.md]
- Use Zod for external input validation. [CITED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; integration tests under `tests/integration/*.test.ts`; E2E under `tests/e2e/*.test.ts`; directed and YAML scenario suites have their own coverage ledgers. [CITED: AGENTS.md]
- Never use `npm link` for local development. [CITED: AGENTS.md]

## Standard Stack

### Core

| Library / Module | Version | Purpose | Why Standard |
|------------------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | Installed `1.27.1`; latest npm registry `1.29.0` as of 2026-05-18. | MCP server/client primitives, `McpServer.registerTool`, `Client.callTool`, `StdioClientTransport`, tool notifications. | Existing project dependency and official MCP TypeScript SDK. [VERIFIED: package.json/npm ls] [CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| `zod` | Installed `4.3.6`; latest npm registry `4.4.3` as of 2026-05-18. | Config and tool input validation. | Existing project standard for external input. [VERIFIED: package.json/npm ls] [CITED: AGENTS.md] |
| `src/services/mcp-broker/*` | Internal | Broker lifecycle, registry, TOFU, trace, errors. | Existing Phase 139/140 foundation; use it rather than creating a host-only broker. [VERIFIED: codebase grep] |
| `src/services/tool-search/*` | Internal | Host and purpose BM25 indexes plus `search_tools` handler. | Existing Phase 141 implementation; use the existing index sink. [VERIFIED: codebase grep] |
| Vitest | Installed `4.1.1`; latest npm registry `4.1.6` as of 2026-05-18. | Unit/integration/E2E test runner. | Existing repo test framework. [VERIFIED: package.json/npm ls] |

### Supporting

| Library / Module | Version | Purpose | When to Use |
|------------------|---------|---------|-------------|
| `tsx` | Installed `4.21.0`; latest npm registry `4.22.2` as of 2026-05-18. | Run TypeScript fixture MCP servers in tests. | Reuse `tests/fixtures/mcp-servers/*.ts` through `process.execPath --import tsx`. [VERIFIED: package.json/npm ls] [VERIFIED: codebase grep] |
| Directed scenario runner | Internal Python | Public end-to-end MCP behavior coverage. | Add Phase D rows/tests for MCB-12..16; avoid reusing older macro `T-S-*` rows. [VERIFIED: codebase grep] |
| YAML integration runner | Internal Python | Managed config/workflow scenarios. | Add INT-MCB-02/03/06/09/10/11 workflows. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Host registration via `server.registerTool` | A synthetic `call_model`-only host path | Wrong tier: host `tools/list` must contain brokered tools for the host LLM. [CITED: MCP Broker Requirements §5.6] |
| Shared `McpBroker` | Separate broker per consumer | Breaks shared spawn and shared TOFU requirements. [CITED: MCP Broker Requirements REQ-117, REQ-118] |
| Existing `ToolSearchService` host sink | New host-only indexer | Duplicates Phase 141 state and risks list_changed drift. [VERIFIED: codebase grep] |

**Installation:** No new packages should be installed for Phase 142. [VERIFIED: package.json/npm ls]

## Package Legitimacy Audit

Phase 142 should not install external packages; it uses existing dependencies already present in `package.json` and `package-lock.json`. [VERIFIED: package.json/npm ls] Because no package install is recommended, the Package Legitimacy Gate is not applicable. [VERIFIED: codebase grep]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | No new package installs recommended. [VERIFIED: package.json/npm ls] |

**Packages removed due to slopcheck [SLOP] verdict:** none.  
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
flashquery.yml
  -> config loader validates mcp_servers + host.mcp_servers + purposes.*.mcp_servers
  -> createMcpServer(config, { broker })
     -> register FQ-native tools through wrapServerWithToolCatalog(host_mcp_tools filter)
     -> list host-visible brokered tools through Broker.listToolsForConsumer(host ctx)
     -> register each brokered tool as serverId__toolName on host MCP surface
        -> host tools/call
           -> parse registry key
           -> reject if not visible to host
           -> Broker.callTool(ref,args,host ctx)
              -> shared BrokerClient lazy-spawns server if needed
              -> shared TOFU map validates tool schema
              -> upstream Client.callTool
              -> recordBrokeredToolCall(traceId, server, tool, cost)
              -> return CallToolResult content/isError to host

call_model purpose
  -> executeAgentLoop
     -> ConsumerContext(kind: purpose, purposeId, traceId)
     -> same Broker.listToolsForConsumer / Broker.callTool / trace map

host call_macro
  -> session traceId
  -> ConsumerContext(kind: host, traceId)
  -> nested macro frames inherit context
  -> same Broker.callTool path and shared TOFU pins
```

### Recommended Project Structure

```text
src/
├── mcp/
│   ├── server.ts                 # host MCP registration; add host brokered registration wrapper here
│   └── tool-catalog.ts           # keep native catalog capture native-only unless deliberately extended
├── services/
│   ├── mcp-broker/               # shared broker, registry, trace, TOFU
│   └── tool-search/              # host/purpose index lifecycle
├── llm/
│   ├── agent-loop.ts             # purpose ConsumerContext already flows here
│   └── tool-dispatcher.ts        # brokered dispatch visibility check pattern
└── macro/
    └── registry.ts               # brokered macro wrapper and ConsumerContext inheritance
```

### Pattern 1: Register Host Brokered Tools After Native Catalog Capture

**What:** Use `Broker.listToolsForConsumer({ kind:'host', traceId, interactive:true })` to discover host-visible brokered tools, then register each with the SDK `McpServer.registerTool` using `registryKey` as the tool name and `description` after override substitution. [VERIFIED: codebase grep] [CITED: Context7 `/modelcontextprotocol/typescript-sdk`]

**When to use:** During `createMcpServer` startup, after native tools are registered and before host clients call `tools/list`. [VERIFIED: codebase grep]

**Example:**

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk + existing src/mcp/server.ts pattern
for (const tool of await broker.listToolsForConsumer(hostCtx)) {
  server.registerTool(
    tool.registryKey,
    {
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    },
    async (args, extra) => {
      const ctx = { kind: 'host' as const, traceId: resolveSessionId(extra) ?? hostCtx.traceId, interactive: true };
      const visible = await broker.listToolsForConsumer(ctx);
      if (!visible.some((candidate) => candidate.registryKey === tool.registryKey)) {
        return { content: [{ type: 'text' as const, text: `Tool '${tool.registryKey}' not found.` }], isError: true };
      }
      const result = await broker.callTool({ serverId: tool.serverId, toolName: tool.toolName }, args, ctx);
      recordBrokeredToolCall({ traceId: ctx.traceId, serverId: tool.serverId, toolName: tool.toolName, costPerCall: tool.costPerCall });
      return result;
    }
  );
}
```

### Pattern 2: Keep Consumer Filtering in Broker APIs

**What:** All host, purpose, and macro code asks the broker for filtered tools using `ConsumerContext`; callers do not inspect config arrays directly except for setup/index-sink construction. [VERIFIED: codebase grep]

**When to use:** Any time a tool list is exposed, indexed, pre-scanned, or dispatched. [CITED: MCP Broker Requirements REQ-031, REQ-116]

### Pattern 3: Trace Scope Is Caller-Owned

**What:** Host direct tools should derive trace scope from host session/request context; delegated calls use `params.trace_id`; host-invoked macros use the host session ID and nested broker calls reuse it. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements REQ-065..067]

**When to use:** At every `recordBrokeredToolCall(...)` call site and every `ConsumerContext` constructor. [VERIFIED: codebase grep]

### Anti-Patterns to Avoid

- **Creating a host-only broker:** Violates shared lazy spawn and shared TOFU. [CITED: MCP Broker Requirements REQ-117, REQ-118]
- **Registering brokered tools as native catalog entries without intent:** The native catalog feeds native metadata validation and FQ-native help behavior; brokered tools have no `.tool.md` or tier classification. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §5.6]
- **Bypassing `Broker.listToolsForConsumer` in dispatch:** A guessed registry key must be rejected if hidden from the current consumer. [CITED: MCP Broker Requirements REQ-035]
- **Using a constant host trace ID for user-visible host calls:** Current host search uses a fixed startup trace for index build; direct host calls need session/request trace scope for REQ-066/067 evidence. [VERIFIED: codebase grep]
- **Adding broker-side tier metadata:** Brokered tools are visible by configured server membership only. [CITED: MCP Broker Requirements §2.2, REQ-111]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP server/client protocol | JSON-RPC framing or stdio process protocol | `@modelcontextprotocol/sdk` `McpServer`, `Client`, `StdioClientTransport` | SDK already owns protocol behavior. [CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Consumer visibility | Per-call ad hoc config filtering | `Broker.listToolsForConsumer(ctx)` | Centralizes host/purpose visibility and TOFU blocking. [VERIFIED: codebase grep] |
| Tool search/index updates | Second host indexer/list_changed path | `ToolSearchService` and `ToolIndexSink` | Existing sync sink preserves Phase 140/141 behavior. [VERIFIED: codebase grep] |
| Cost trace aggregation | New trace tables or local arrays | `recordBrokeredToolCall` / `getBrokeredToolCallTraceSnapshot` | Existing trace map already feeds `call_model` metadata. [VERIFIED: codebase grep] |
| Error normalization | Custom host brokered error taxonomy | `formatToolError` for thrown/protocol errors; pass upstream `CallToolResult.isError` without FQ-native help footer | Matches Phase 139/141 brokered error contract. [VERIFIED: codebase grep] |

**Key insight:** Phase 142 should compose the existing broker registry, trace, TOFU, and search services; custom host-only copies are the main regression risk. [VERIFIED: codebase grep]

## Common Pitfalls

### Pitfall 1: Host `tools/list` Still Native-Only
**What goes wrong:** `host.mcp_servers` is parsed and indexed, but brokered tools never appear in the host MCP surface. [VERIFIED: codebase grep]  
**Why it happens:** `wrapServerWithToolCatalog` only intercepts native `registerTool` calls; no current code registers brokered tools on the host server. [VERIFIED: codebase grep]  
**How to avoid:** Add explicit host brokered registration in `createMcpServer`. [CITED: MCP Broker Requirements §5.6]  
**Warning signs:** `T-Y-010` fails or host `tools/list` lacks `basic__echo`. [CITED: MCP Broker Test Plan §2.3]

### Pitfall 2: Search Index Exists But Host Dispatch Is Missing
**What goes wrong:** `host.tool_search: enabled` can find brokered tools, but the host cannot call the registry-key tool. [VERIFIED: codebase grep]  
**Why it happens:** Phase 141 implemented host index lifecycle earlier than full Phase D host registration. [VERIFIED: codebase grep]  
**How to avoid:** Plan host dispatch and host search tests together (`T-Y-003`, `T-Y-010`). [CITED: MCP Broker Test Plan Phase D]

### Pitfall 3: Directed Test ID Collision
**What goes wrong:** Phase D `T-S-012..016` names collide with older macro-language crosswalk rows in the live directed coverage matrix. [VERIFIED: codebase grep]  
**Why it happens:** Product test plan IDs are layer-local, while live directed coverage uses `MCB-*` behavior IDs for broker scenarios. [VERIFIED: codebase grep]  
**How to avoid:** Add or update rows `MCB-12..MCB-16` and name tests descriptively, e.g. `test_macro_broker_consumer_context`. [CITED: MCP Broker Test Plan §6]

### Pitfall 4: Recording Cost for Failed Broker Transport Calls
**What goes wrong:** Timeouts/connect failures inflate `tool_calls` cost. [VERIFIED: prior phase context]  
**Why it happens:** Recording before `Broker.callTool(...)` resolves. [VERIFIED: codebase grep]  
**How to avoid:** Record after a returned `CallToolResult`, including upstream `isError`, but not after thrown broker failures. [VERIFIED: prior phase context]

### Pitfall 5: Re-evaluating Consumer Context in Nested Macros
**What goes wrong:** A host-invoked macro calls a nested macro and accidentally switches to purpose visibility or loses trace scope. [CITED: MCP Broker Requirements REQ-114, REQ-115]  
**Why it happens:** `ConsumerContext` is reconstructed in wrappers rather than inherited from the outermost frame. [VERIFIED: codebase grep]  
**How to avoid:** Thread the same context through macro invocation state or prove current construction preserves the same host/purpose identity and trace ID. [CITED: MCP Broker Test Plan T-S-013/T-S-014]

## Code Examples

### Existing Consumer Filter

```typescript
// Source: src/services/mcp-broker/registry.ts
listToolsForConsumer(ctx: ConsumerContext): BrokeredTool[] {
  const visibleServerIds = this.#visibleServerIds(ctx);
  return [...this.#tools.values()]
    .filter((tool) => visibleServerIds.has(tool.serverId))
    .map(cloneTool);
}
```

### Existing Purpose Dispatch Visibility Check

```typescript
// Source: src/llm/tool-dispatcher.ts
const visibleTools = await options.broker.listToolsForConsumer(options.consumerContext);
const visibleTool = visibleTools.find((tool) => tool.registryKey === toolCall.function.name);
if (visibleTool === undefined) {
  return dispatchError(toolCall, args, 'tool_not_in_registry', `Tool '${toolCall.function.name}' is not available...`);
}
```

### MCP SDK Tool Registration Shape

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk
server.registerTool(
  'greet',
  {
    description: 'Greet someone by name',
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}!` }],
  }),
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Placeholder `McpBroker.getToolHandler` | `Broker.callTool(ref,args,ctx)` with raw `CallToolResult` | Phase 139 | Host code must call broker directly rather than wrapping as a native handler. [VERIFIED: prior phase summary] |
| Purpose-only broker dispatch | Shared `ConsumerContext` for host and purpose | Phase 139/140 groundwork; Phase 142 closure | Planner must validate both surfaces share state. [VERIFIED: codebase grep] |
| Flat purpose tool list only | `tool_search: enabled` can inject `fq.search_tools` and index visible tools | Phase 141 | Host search already has a service/sink; do not rebuild it. [VERIFIED: prior phase summary] |
| Native-only host metadata | Additive native host filter + brokered `host.mcp_servers` | Phase 142 target | Existing `host_mcp_tools` must remain separate. [CITED: MCP Broker Requirements §6.6] |

**Deprecated/outdated:**
- `@modelcontextprotocol/server` is forbidden by AGENTS.md; use `@modelcontextprotocol/sdk`. [CITED: AGENTS.md]
- Per-tool subsetting inside `host.mcp_servers` is out of scope. [CITED: MCP Broker Requirements §2.2]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Host direct brokered calls can use a request/session-derived trace ID from MCP `RequestHandlerExtra` or the existing `resolveSessionId(extra)` helper. [ASSUMED] | Architecture Patterns | If no stable host session trace exists for direct brokered tools, planner must add a minimal trace-id derivation strategy consistent with existing `call_macro`. |
| A2 | Phase 142 implementation can add dynamic async brokered registration during server construction without violating the current synchronous `createMcpServer` call contract. [ASSUMED] | Open Questions | If async registration cannot fit, planner may need a pre-connect initialization step or a host registration cache initialized before returning the server. |

## Open Questions

1. **How should direct host `tools/call` derive the chat/session trace ID?**
   - What we know: `call_macro` uses `sessionIdProvider(extra)`, `resolveSessionId(extra)`, or registration session ID. [VERIFIED: codebase grep]
   - What's unclear: Direct brokered host callbacks need equivalent request-scoped trace identity. [ASSUMED]
   - Recommendation: Reuse `resolveSessionId(extra)` if accessible; otherwise introduce a narrow helper shared by host brokered callbacks and `call_macro`.

2. **Should host brokered tools be captured in the native catalog?**
   - What we know: Native catalog validation expects `.tool.md` metadata for native tools. [VERIFIED: codebase grep]
   - What's unclear: Extending `wrapServerWithToolCatalog` to brokered tools may accidentally require `.tool.md` metadata for brokered tools. [VERIFIED: codebase grep]
   - Recommendation: Keep brokered host registration separate from native catalog capture unless tests prove catalog inclusion is required.

3. **Does `createMcpServer` need to become async?**
   - What we know: `broker.listToolsForConsumer(hostCtx)` is async and lazily connects/spawns servers. [VERIFIED: codebase grep]
   - What's unclear: Existing server construction is synchronous across tests/startup. [VERIFIED: codebase grep]
   - Recommendation: Prefer a synchronous registration shim only if host-visible brokered tools are already cached; otherwise add an explicit async initializer before transport connection and update tests accordingly.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/tests/fixture MCP servers | yes | v24.7.0 | Node >=20 required; no fallback. [VERIFIED: command output] |
| npm | Scripts/package queries | yes | 11.5.1 | none. [VERIFIED: command output] |
| Python 3 | Directed/YAML scenario runners | yes | 3.12.3 | none needed. [VERIFIED: command output] |
| `.env.test` | Integration/E2E tests | yes | file present | Some tests skip if incomplete, but file exists. [VERIFIED: command output] |
| `gsd-sdk` | GSD init/commit flow | yes | command found | none. [VERIFIED: command output] |
| `slopcheck` | Package legitimacy gate | no | — | Not required because no new packages are recommended. [VERIFIED: command output] |

**Missing dependencies with no fallback:** none identified for planning.  
**Missing dependencies with fallback:** `slopcheck` unavailable; no package install is planned.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.1` installed; directed/YAML scenario runners are Python. [VERIFIED: npm ls] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- --run tests/unit/mcp-broker-registry.test.ts tests/unit/llm-tool-dispatcher.test.ts` |
| Full suite command | `npm run build && npm test && npm run test:integration -- --run tests/integration/mcp-broker tests/integration/tool-search && npm run test:e2e -- --run tests/e2e/mcp-broker.e2e.test.ts` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-005..009, REQ-113 | Host config defaults/strictness | unit + YAML | `npm test -- --run tests/unit/config.test.ts`; add/run `host_empty_section.yml` | partial; Wave 0 add YAML INT-MCB-06 |
| REQ-010 | Host index startup/list_changed | integration + YAML | `npm run test:integration -- --run tests/integration/tool-search/host-index.integration.test.ts`; add/run `host_tool_search_with_brokered.yml` | partial; integration exists, YAML missing |
| REQ-031, REQ-116 | Filtered host/purpose views | unit | `npm test -- --run tests/unit/mcp-broker-registry.test.ts` | partial; tests exist but labels should align with T-U-036/T-U-037 |
| REQ-035 | Reject invisible dispatch | integration/YAML | add/run `tests/integration/mcp-broker/host-surface.test.ts` and INT-MCB-11 | missing focused host coverage |
| REQ-065..067 | `tool_calls` trace for purpose, host, host macro | directed/YAML/E2E | add/run MCB-15/16 and `brokered_host_dispatch.yml` | partial for purpose; host missing |
| REQ-114..115 | Nested macro context inheritance | directed/E2E | add/run MCB-13/14 and T-E-D1 | missing |
| REQ-117..118 | Shared spawn and TOFU across consumers | integration/E2E | add/run T-I-031/T-I-032 and T-E-D1 | missing focused Phase D closure |

### Sampling Rate

- **Per task commit:** focused unit/integration file for the touched seam. [VERIFIED: project conventions]
- **Per wave merge:** Phase D focused gate including config, registry, host surface, macro context, and scenario tests. [CITED: MCP Broker Test Plan Phase D]
- **Phase gate:** Run full Phase D test set plus `npm run build`. [CITED: MCP Broker Test Plan Phase D]

### Wave 0 Gaps

- [ ] Add/rename unit labels for `T-U-036` and `T-U-037` in `tests/unit/mcp-broker-registry.test.ts`; current filter behavior is present but unlabeled. [VERIFIED: codebase grep]
- [ ] Add focused host MCP surface integration tests for `T-I-030`, `T-I-031`, and `T-I-032`. [CITED: MCP Broker Test Plan §2.2]
- [ ] Add Phase D E2E gate `T-E-D1` in `tests/e2e/mcp-broker.e2e.test.ts`. [CITED: MCP Broker Test Plan §2.5]
- [ ] Add directed rows/tests `MCB-12..MCB-16`; do not rely on old macro `T-S-012..016` rows. [VERIFIED: codebase grep]
- [ ] Add YAML scenarios `brokered_host_dispatch.yml`, `host_tool_search_with_brokered.yml`, `host_empty_section.yml`, `host_mcp_tools_with_brokered.yml`, `brokered_host_registration.yml`, and a no-tier brokered visibility scenario. [CITED: MCP Broker Test Plan §2.4]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no new auth | Existing MCP auth remains outside Phase 142 scope. [VERIFIED: codebase grep] |
| V3 Session Management | yes, trace/session scope only | Use stateless per-call `ConsumerContext`; do not add server-side sessions. [CITED: AGENTS.md] |
| V4 Access Control | yes | Broker visibility filter via `host.mcp_servers` / `purposes.*.mcp_servers`; reject hidden registry keys. [CITED: MCP Broker Requirements REQ-031, REQ-035] |
| V5 Input Validation | yes | Zod config/tool schemas; upstream brokered `inputSchema` is passed to MCP SDK registration. [CITED: AGENTS.md] [CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| V6 Cryptography | no new crypto | TOFU hashing already implemented in prior phase; do not change hash inputs. [VERIFIED: prior phase summary] |
| V10 SSRF / External Process Safety | yes | Stdio-only configured commands; no HTTP transport/OAuth in scope. [CITED: MCP Broker Requirements §2.2] |

### Known Threat Patterns for MCP Broker Host Surface

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hidden tool invocation by guessed `serverId__toolName` | Elevation of privilege | Re-check `Broker.listToolsForConsumer(ctx)` at dispatch time. [CITED: MCP Broker Requirements REQ-035] |
| Schema rug-pull across consumers | Tampering | Shared TOFU map blocks changed tools regardless of consumer. [CITED: MCP Broker Requirements REQ-118] |
| Trace/cost spoofing by missing trace scope | Repudiation | Host callbacks derive trace ID and record `tool_calls` after returned brokered results. [CITED: MCP Broker Requirements REQ-066] |
| Sensitive raw error leakage | Information disclosure | Use existing `formatToolError`/raw stripping for thrown broker errors; do not serialize `raw`. [VERIFIED: codebase grep] |
| Accidental brokered FQ-native help wrapping | Information/behavior confusion | Brokered errors remain unwrapped and `help:true` passes upstream. [CITED: MCP Broker Requirements DELTA-2] |

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` - Phase D requirements, contracts, and implementation guidance.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md` - Phase D validation IDs and scenario names.
- `.planning/phases/142-host-surface-and-consumer-context/142-CONTEXT.md` - Locked user decisions and canonical refs.
- `AGENTS.md` - Project stack, conventions, and hard constraints.
- Current codebase grep/read of `src/config/loader.ts`, `src/mcp/server.ts`, `src/mcp/tool-catalog.ts`, `src/services/mcp-broker/*`, `src/services/tool-search/*`, `src/llm/tool-dispatcher.ts`, `src/mcp/tools/llm.ts`, and `src/mcp/tools/macro.ts`.
- Context7 `/modelcontextprotocol/typescript-sdk` - SDK `registerTool`, `Client.callTool`, `StdioClientTransport` usage.
- Context7 `/modelcontextprotocol/modelcontextprotocol` - MCP tools/list, tools/call, and listChanged capability docs.

### Secondary (MEDIUM confidence)

- Prior phase summaries and validation docs for Phases 139, 140, and 141.
- `npm view` and `npm ls` version checks on 2026-05-18.

### Tertiary (LOW confidence)

- None used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing repo dependencies verified with `package.json`, `npm ls`, and Context7 for MCP SDK.
- Architecture: HIGH - direct source reads show current seams and remaining host registration gap.
- Pitfalls: HIGH - derived from source docs plus current code and prior phase summaries.

**Research date:** 2026-05-18  
**Valid until:** 2026-06-17 for internal architecture; 2026-05-25 for npm package latest-version facts.
