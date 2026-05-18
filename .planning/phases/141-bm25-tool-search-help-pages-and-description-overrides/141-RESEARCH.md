# Phase 141: BM25 Tool Search, Help Pages, And Description Overrides - Research

**Researched:** 2026-05-18  
**Domain:** MCP broker tool search, pure TypeScript BM25 indexing, FlashQuery-native tool help metadata, delegated tool-surface shaping  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Canonical Source Priority
- Downstream agents MUST read the two MCP Broker docs listed in `<canonical_refs>` before making implementation, testing, or ambiguity-resolution decisions.
- If this `CONTEXT.md`, ROADMAP.md, generated research, or generated plan text conflicts with the MCP Broker Requirements or MCP Broker Test Plan, downstream agents must treat the two MCP Broker docs as the higher-priority source and call out the conflict in the plan or summary.
- The MCP Broker Requirements doc is the source of truth for behavior and acceptance requirements.
- The MCP Broker Test Plan doc is the source of truth for test IDs, layers, and per-phase test coverage.
- Every Phase 141 `PLAN.md` task that touches implementation or tests must include both MCP Broker docs in `<read_first>`.

### Phase Scope
- Implement requirements `REQ-074..102`, plus `REQ-011` where per-purpose index lifecycle and `tool_search: enabled` injection behavior are required.
- Treat `REQ-085..087` as the consumer-surface contract for delegated purpose and host search behavior.
- Keep semantic vector routing, `.tool.md` hot reload, persistent TOFU, HTTP transport, OAuth/DCR, MCP resources/prompts/sampling forwarding, and synthesized-skill features out of scope.
- Do not reimplement Phase 139 broker foundation or Phase 140 TOFU/list-changed state except where Phase 141 must attach to their existing seams.

### BM25 Indexer And Search Tool
- Implement a zero-dependency pure TypeScript indexer with pinned parameters: `k1=2.0`, `b=0.5`, BM25+ `delta=0.25`, name boost `3x`, stopwords enabled, stemming disabled.
- Preserve the fixed indexer API from the MCP Broker Requirements: `build`, `addTools`, `removeTools`, `search`, `getStats`.
- `build(tools)` and duplicate `addTools(tools)` must be idempotent.
- `removeTools(keys)` must tolerate nonexistent keys as a no-op.
- `search(query, k)` must return up to `k` ranked results, with an empty query or empty corpus returning an empty array rather than an error.
- `getStats()` reports live counts, not tombstones.
- Port the BM25 POC corpora and query fixtures into production tests per `REQ-088`.

### `fq.search_tools`
- Add an MCP tool named `fq.search_tools` with signature `query: string, limit?: number = 8`.
- Return `SearchResult` envelopes containing `server`, `tool`, `registry_key`, `description`, `arg_summary`, `score`, `normalizedScore`, and optional `has_help` / `help_hint`.
- Populate `has_help` and `help_hint` only for FlashQuery-native results; omit them or set `has_help: false` for brokered results.
- `description` in search results must reflect `description_override` when configured.
- Audit each `search_tools` invocation with consumer identity, query, result count, latency, and trace ID.

### Tool Search Consumer Behavior
- For a delegated purpose with `tool_search: enabled`, build a per-invocation BM25 index at `call_model` engine initialization time.
- For a `tool_search: enabled` purpose with at least one eligible tool, inject only `fq.search_tools` up front, plus any already-always-present tools; discover all other eligible FQ-native and brokered tools through search.
- For `tool_search: disabled`, preserve existing flat-list behavior.
- Host search behavior must index FQ-native tools plus brokered tools visible through `host.mcp_servers` when `host.tool_search: enabled`.
- Phase 140 list-changed handling must be able to call into the indexer synchronously through the existing or planned index-update seam.

### Help Convention
- Add one `.tool.md` file per FlashQuery-native tool at `src/mcp/tools/<tool_name>.tool.md`.
- Each `.tool.md` file must include frontmatter with `name`, `description`, `help_hint`, `tier`, and `args`, and the `description` must end with a sentence containing both "help" and "true" or `{help: true}`.
- Build or startup validation must fail clearly on missing `name`, name/filename mismatch, missing required fields, invalid description suffix, duplicate names, or YAML/frontmatter parse failure.
- Short descriptions under 40 chars warn but do not fail.
- Build a `TOOL_META` registry from `.tool.md` files and use it for MCP registration descriptions, `search_tools` help hints, and `help: true` dispatch.
- `help: true` on an FQ-native tool bypasses normal schema validation and returns the raw `.tool.md` body as text.
- `help: true` on a brokered tool is forwarded upstream unchanged; FlashQuery must not synthesize brokered help.
- FQ-native tool errors append the canonical help-pointer footer. Brokered tool errors remain unwrapped.
- `call_macro.tool.md` frontmatter `description` and `help_hint` must use the verbatim strings from the MCP Broker Requirements and BM25 POC; retuning requires rerunning the call-macro placement validation.

### `description_override`
- Substitute `description_override` before every downstream consumer sees a brokered tool description, including agent-loop tool lists, host MCP `tools/list`, BM25 indexing, and `fq.search_tools` results.
- TOFU hashing must continue using the upstream original description, not the override.
- Changing or removing `description_override` must not trigger TOFU re-approval.

### Test Contract
- The implementation plan must include the Phase C test set from the MCP Broker Test Plan:
  - Unit: `T-U-022..034` and `T-U-044`.
  - Integration: `T-I-026`, `T-I-028`, `T-I-029`, `T-I-033..035`, `T-I-035a`, `T-I-036`, `T-I-037`, `T-I-040..049`.
  - E2E: `T-E-C1`.
  - Directed scenarios: `T-S-021`, `T-S-022`.
  - YAML integration scenarios: `T-Y-008`, `T-Y-013`.
- Plans should include targeted regressions for `REQ-101` and `REQ-102` if existing Phase 140 tests do not already protect them after `description_override` wiring changes.

### the agent's Discretion
- Exact module decomposition is left to the planner and executor, but it should align with `src/services/tool-search/` from the MCP Broker Requirements and with existing Phase 139/140 broker modules.
- Exact text of individual `.tool.md` help bodies is discretionary, but each page must be useful to an AI caller and must include purpose, params, returns, examples, gotchas, and related tools.
- Exact benchmark harness shape is discretionary as long as the POC fixture expectations and performance budgets are asserted.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Semantic vector tool routing.
- Hot-reload of `.tool.md` files.
- Persistent TOFU storage across FlashQuery restarts.
- Streamable HTTP transport and OAuth/DCR.
- MCP resources, prompts, sampling, and elicitation forwarding.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-011 | `purposes.<name>.tool_search: enabled` builds a per-invocation index at `call_model` engine-init time. | Attach BM25 lifecycle to `registerLlmTools` before `executeAgentLoop`; existing purpose config already parses `tool_search` to `toolSearch`. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-074 | Fixed indexer interface and pinned algorithm parameters. | Port POC `PureBM25Indexer` into `src/services/tool-search/indexer.ts`; expose constants so T-U-026 can pin them. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-075 | Pure TypeScript with zero external dependency. | Use POC inline 153-word stopword list and no BM25/search package install. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-076 | `build(tools)` idempotent. | Production `build` should reset/rebuild or otherwise produce identical state on repeat. POC currently appends on `build`, so planner must guard this delta. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-077 | `addTools(tools)` idempotent. | Duplicate live `(server, tool)` keys must be skipped or replaced without double-indexing. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-078 | `removeTools(keys)` tolerates nonexistent keys. | POC already no-ops missing keys; preserve behavior. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-079 | `search(query,k)` returns ranked results; empty query/corpus returns empty array. | POC returns empty naturally for empty query/corpus; add explicit unit/integration assertions. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-080 | `getStats()` reports live counts and budgets. | POC stats use live postings after compaction; production must assert p95/build/size budgets in T-I-043/T-I-044. [VERIFIED: codebase grep] [CITED: MCP Broker Test Plan §2.3] |
| REQ-081 | Four correctness invariants ported. | Port `incremental-test.ts` as unit tests T-U-022..025. [VERIFIED: codebase grep] [CITED: MCP Broker Test Plan §2.1] |
| REQ-082 | `fq.search_tools` MCP tool surface. | Register as an FQ-native tool and return text JSON in existing MCP response convention. [CITED: AGENTS.md] [CITED: MCP Broker Requirements §7.12] |
| REQ-083 | `has_help`/`help_hint` only for FQ-native results. | Read FQ-native help hints from `TOOL_META`; brokered results omit the fields or use `has_help:false`. [CITED: MCP Broker Requirements §7.12] |
| REQ-084 | Search result description reflects overrides. | Registry already carries `description` and `upstreamDescription`; index/search should consume `description`. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14] |
| REQ-085 | Enabled purposes inject only `fq.search_tools`. | Modify agent-loop provider tool assembly for enabled purposes; leave any future always-present tools intact. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-086 | Disabled purposes keep flat behavior. | Existing `executeAgentLoop` currently merges native provider tools plus brokered tools; preserve as default. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-087 | Host index covers FQ-native + host-visible brokered tools. | Phase 142 owns host surface, but Phase 141 should implement the index manager API so host index can be created when host search is enabled. [CITED: ROADMAP.md] [CITED: MCP Broker Requirements §7.12] |
| REQ-088 | POC fixtures graduate. | Copy corpora, query JSON, incremental invariants, and call-macro validation under `tests/fixtures/tool-search/` and production tests. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| REQ-089 | One `.tool.md` per FQ-native tool. | Actual current registered native catalog contains 29 tool names; planner should require one `.tool.md` for each plus `search_tools` once added. [VERIFIED: command output] [CITED: MCP Broker Requirements §7.13] |
| REQ-090 | `.tool.md` frontmatter enforced. | Use `gray-matter` data/content parsing plus Zod validation. [VERIFIED: Context7] [CITED: MCP Broker Requirements §7.13] |
| REQ-091 | Help body structure and length guideline. | Validation should warn for soft length/body issues but not fail. [CITED: MCP Broker Requirements §7.13] |
| REQ-092 | `TOOL_META` built at startup. | Build before tool registration so `wrapServerWithToolCatalog` can substitute descriptions. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.13] |
| REQ-093 | `help: true` sentinel. | Add a native dispatch pre-validation branch because current `dispatchNativeToolCall` validates Zod args before handler execution. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.13] |
| REQ-094 | Canonical default `help_hint`. | Store the verbatim default in tool-meta module and assert T-U-033. [CITED: MCP Broker Requirements §7.13] |
| REQ-095 | Blocking build/startup validation. | Call validation during server startup/build path and test malformed fixture directory separately. [VERIFIED: codebase grep] [CITED: MCP Broker Test Plan §2.4] |
| REQ-096 | FQ-native error footer only. | Current native dispatcher wraps handler `isError` as generic handler_error; update native path to append footer while leaving brokered path unchanged. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.13] |
| REQ-097 | `call_macro` description/help hint verbatim. | Use the POC `corpus-flashquery.md` `call_macro` description; help_hint must come from the canonical broker docs/POC strings. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.13] |
| REQ-098 | Brokered `help:true` forwarded unchanged. | Current brokered dispatcher passes arguments through to `Broker.callTool`; keep it before native help interception. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.13] |
| REQ-099 | No `.tool.md` hot reload. | Build `TOOL_META` once at startup; do not watch filesystem. [CITED: MCP Broker Requirements §7.13] |
| REQ-100 | Override before downstream consumers. | Current `ToolRegistry.registerTool` substitutes overrides in registered `description`; verify all new index/search paths use registered tools. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14] |
| REQ-101 | TOFU hashes upstream description. | Current `BrokerClient.#toBrokeredTool` hashes upstream SDK tool description before registry override; preserve and regression-test. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14] |
| REQ-102 | Override edits do not trigger re-approval. | Existing Phase 140 integration tests T-I-027/T-I-032a cover this; rerun after Phase 141 override/index wiring. [VERIFIED: codebase grep] [CITED: MCP Broker Test Plan §2.2] |
</phase_requirements>

## Summary

Phase 141 should be planned as a surface-composition phase: add a pure local index, wire it into the already-existing broker registry/list-changed seam, and reshape delegated model tool injection when `tool_search` is enabled. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] The canonical rule is critical: downstream implementation and test agents must read the MCP Broker Requirements and MCP Broker Test Plan before touching code or tests, and every implementation/test PLAN task must include both docs in `<read_first>`. [CITED: 141-CONTEXT.md]

The current codebase already has the Phase 140 handoff needed by this phase: `ToolIndexSink` exists, `McpBroker.applyToolListSnapshot` calls `removeTools` for removed/changed tools and `addTools` for trusted tools synchronously, `BrokerClient` handles `ToolListChangedNotificationSchema`, and `ToolRegistry` stores overridden downstream `description` separately from `upstreamDescription`. [VERIFIED: codebase grep] The planner should not rebuild that foundation; it should provide a real search index manager behind the sink and ensure every search/index consumer uses registered downstream descriptions while TOFU keeps upstream hash inputs. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14]

Phase 140 gap-fix commit `9020acc` tightened several contracts that Phase 141 must preserve: `ConsumerContext.interactive` controls prompt-vs-`blocked_on_user` TOFU behavior, `Broker.ensureConnected` accepts `ToolListSnapshotOptions`, audit emission uses `BrokerAuditEventInput` and returns timestamped `BrokerAuditEvent` records, and `hashToolSchema` canonicalizes `undefined` as `null`. Phase 141 should integrate with these contracts directly rather than reintroducing pre-gap assumptions. [VERIFIED: git show 9020acc]

**Primary recommendation:** implement `src/services/tool-search/` with a ported/fixed POC BM25 indexer, a per-consumer index manager, a `TOOL_META` loader/validator, and `fq.search_tools`; then update `call_model`/agent-loop native tool assembly so enabled purposes receive only `fq.search_tools` while disabled purposes keep the existing flat list. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §10 Phase C]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| BM25 indexing | API / Backend | LLM agent loop | FlashQuery process owns registry state and per-purpose tool assembly. [CITED: MCP Broker Requirements §7.12] |
| `fq.search_tools` MCP tool | API / Backend | Browser / Client: none | MCP server exposes a tool; no web UI is involved. [CITED: AGENTS.md] |
| `.tool.md` metadata loading | API / Backend | Filesystem | Startup reads local `src/mcp/tools/*.tool.md`; hot reload is out of scope. [CITED: MCP Broker Requirements §7.13] |
| Help sentinel | API / Backend | Tool dispatcher | Native dispatch must bypass validation before handlers; brokered dispatch must forward args upstream. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.13] |
| Description override propagation | API / Backend | External MCP servers | Registry substitutes downstream descriptions after upstream discovery; upstream description remains TOFU input. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14] |
| Search audit trace | API / Backend | Logging/trace store | `search_tools` audit is an in-process trace event like existing broker audit/tool-call trace. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.10] |
| Directed/YAML validation | Test harness | API / Backend | Scenario tests observe public MCP/call_model behavior rather than private index fields. [CITED: MCP Broker Test Plan §2.5-2.6] |

## Project Constraints (from AGENTS.md)

- Use Node.js >=20 LTS; local Node is `v24.7.0`. [VERIFIED: command output] [CITED: AGENTS.md]
- Keep TypeScript strict and ESM; do not introduce CommonJS `require`. [CITED: AGENTS.md]
- Use `@modelcontextprotocol/sdk` with `zod`; do not use `@modelcontextprotocol/server`. [CITED: AGENTS.md]
- Use `async/await`; module-boundary failures should return typed errors where applicable. [CITED: AGENTS.md]
- MCP tool handlers must catch internally and return `isError: true` on failure. [CITED: AGENTS.md]
- Use Zod for external input validation. [CITED: AGENTS.md]
- Do not build a web UI. [CITED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and context is per call. [CITED: AGENTS.md]
- Run unit tests with `npm test`, integration with `npm run test:integration`, E2E with `npm run test:e2e`. [CITED: AGENTS.md]
- Do not use `npm link` for local development. [CITED: AGENTS.md]

## Project Skills Context

- Project `.agents/skills` exists and includes FlashQuery directed/integration coverage, test-generation, and run skills. [VERIFIED: command output]
- Directed scenario changes should follow `tests/scenarios/directed/DIRECTED_COVERAGE.md` behavior-row conventions. [VERIFIED: codebase grep]
- YAML integration scenario changes should follow `tests/scenarios/integration/INTEGRATION_COVERAGE.md` conventions and existing managed-run patterns. [VERIFIED: codebase grep]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | local `v24.7.0`; project requires `>=20` | Runtime and built-in `node:fs`, `node:path`, timers/perf APIs | Existing project engine and runtime. [VERIFIED: command output] [CITED: package.json] |
| TypeScript | installed `6.0.2`; npm latest `6.0.3`, modified 2026-04-16 | Strict ESM implementation | Existing project language and build target. [VERIFIED: npm registry] [CITED: package.json] |
| `@modelcontextprotocol/sdk` | installed `1.27.1`; npm latest `1.29.0`, modified 2026-03-30 | MCP server/client `registerTool`, `listTools`, `callTool`, tool-list notifications | Existing dependency; official SDK docs support list/call tools and notification handlers. [VERIFIED: Context7] [VERIFIED: npm registry] |
| Zod | installed `4.3.6` | Tool input schema and metadata validation | Existing validation library and project convention. [VERIFIED: npm ls] [CITED: AGENTS.md] |
| Vitest | installed `4.1.1`; npm latest `4.1.6`, modified 2026-05-11 | Unit/integration/E2E tests | Existing test runner with separate unit/integration/e2e configs. [VERIFIED: npm registry] [VERIFIED: codebase grep] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `gray-matter` | installed/latest `4.0.3`, modified 2023-07-12 | Parse `.tool.md` YAML frontmatter and raw content | Use for `TOOL_META` loader; official docs return `data` and `content`. [VERIFIED: Context7] [VERIFIED: npm registry] |
| `fast-glob` | installed/latest `3.3.3`, modified 2025-01-05 | Find `src/mcp/tools/*.tool.md` | Existing dependency suitable for globbing metadata files. [VERIFIED: npm registry] [CITED: package.json] |
| `node:perf_hooks` | Node built-in | Benchmark p95/build latency | Use in T-I-043/T-I-044 or benchmark tests; no package needed. [ASSUMED] |
| `tsx` | installed `4.21.0` | Test/fixture TypeScript execution | Existing tests and scripts use TypeScript directly where needed. [VERIFIED: npm ls] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure POC BM25 | `lunr`, `wink`, `okapibm25` | Rejected by zero-dependency requirement and pinned POC contract. [CITED: MCP Broker Requirements §7.12] |
| Raw frontmatter splitting | `gray-matter` | Existing dependency handles YAML/frontmatter parse errors and returns body separately. [VERIFIED: Context7] |
| New trace store | Existing `src/services/mcp-broker/trace.ts` pattern | Existing in-memory trace helpers already record broker audit/tool-call events; extend for search audit. [VERIFIED: codebase grep] |
| Hand-coded provider tool JSON | Existing `toOpenAiToolDefinition`/native catalog paths | Reuse cached native definitions and registry patterns to avoid drift. [VERIFIED: codebase grep] |

**Installation:** no new package install is recommended. [VERIFIED: package.json]  
**Version verification:** `npm ls`, `npm view`, `node --version`, and `npm --version` were run on 2026-05-18. [VERIFIED: command output]

## Package Legitimacy Audit

No external package install is recommended for Phase 141, so the Package Legitimacy Gate does not block planning. [VERIFIED: package.json] Existing packages were checked with `npm ls`/`npm view`; `slopcheck` was unavailable, but no new package is being introduced. [VERIFIED: command output]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | - | - | - | - | not run | No new install |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: research scope]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: research scope]

## Architecture Patterns

### System Architecture Diagram

```text
Startup / createMcpServer
  -> build TOOL_META from src/mcp/tools/*.tool.md
  -> validate all registered FQ-native tools have metadata
  -> create ToolSearchService / host index manager
  -> createBroker({ indexSink: toolSearchService.brokerSink })
  -> register native tools, including search_tools
      |
      v
Delegated call_model purpose
  -> resolve purpose + native catalog + brokered visible tools
  -> if tool_search disabled:
       inject flat native provider tools + brokered provider tools
     if tool_search enabled:
       build per-invocation BM25 index from eligible native + brokered tools
       inject fq.search_tools only (plus any always-present tools)
      |
      v
Model calls fq.search_tools(query, limit)
  -> search active per-consumer index
  -> hydrate SearchResult envelope from tool metadata/registry
  -> audit query/result_count/latency/trace
      |
      v
Model directly invokes returned native or brokered tool
  -> native: help:true bypass OR Zod validate -> handler -> FQ error footer
  -> brokered: pass args through unchanged, including help:true

External MCP notifications/tools/list_changed
  -> BrokerClient refresh tools/list
  -> McpBroker TOFU + registry update
  -> ToolIndexSink.addTools/removeTools synchronously
  -> active indexes update for visible consumers
```

### Recommended Project Structure

```text
src/services/tool-search/
├── indexer.ts               # pure POC-derived BM25 implementation and types
├── tokenization.ts          # identifier-aware tokenizer + inline stopwords, if split from indexer
├── tool-search-service.ts   # per-consumer indexes, registry-to-index conversion, broker index sink
├── search-tools-handler.ts  # fq.search_tools implementation and SearchResult envelope
├── tool-meta.ts             # .tool.md loader, validator, TOOL_META cache
└── audit.ts                 # search_tools trace helpers, or fold into mcp-broker/trace.ts

src/mcp/tools/
├── search_tools.tool.md     # if handler is in a shared module, still provide metadata
├── <native_tool>.tool.md    # one per registered FQ-native tool
└── ...

tests/fixtures/tool-search/
├── corpus.md
├── corpus-flashquery.md
├── queries.json
└── queries-call-macro.json

tests/unit/tool-search/
├── indexer.test.ts
├── tool-meta.test.ts
└── search-tools-handler.test.ts

tests/integration/tool-search/
└── search-tools.integration.test.ts
```

### Pattern 1: Registry-Backed Index Updates

**What:** implement `ToolIndexSink` as the bridge from Phase 140 broker snapshots into search indexes. [VERIFIED: codebase grep]  
**When to use:** brokered tools are added/removed/changed through `McpBroker.applyToolListSnapshot`, including `notifications/tools/list_changed`. [VERIFIED: codebase grep]

```typescript
// Source: src/services/mcp-broker/types.ts and index.ts
export interface ToolIndexSink {
  addTools(tools: BrokeredTool[]): void;
  removeTools(keys: RegistryKey[]): void;
}
```

### Pattern 2: Search Documents Are Presentation Documents

**What:** index only tool name, downstream description, and optional arg names/summaries; do not index help body prose. [CITED: MCP Broker Requirements §7.12]  
**When to use:** building `Tool` documents for BM25 from FQ-native catalog or brokered registry entries. [CITED: MCP Broker Requirements §7.12]

```typescript
// Source: tool-search-bm25-poc/src/libraries/pure.ts
const nameTokens = tokenize(t.name, this.preproc);
const descParts = [t.description];
if (this.includeArgs && t.argNames.length) descParts.push(t.argNames.join(' '));
```

### Pattern 3: Help Sentinel Before Validation

**What:** branch on `args.help === true` before Zod validation for native tools. [CITED: MCP Broker Requirements §7.13]  
**When to use:** in `dispatchNativeToolCall`, before `toZodObjectSchema(tool.inputSchema).parse(args)`. [VERIFIED: codebase grep]

```typescript
// Source: MCP Broker Requirements §7.13
if (args.help === true) {
  return { content: [{ type: 'text', text: meta.helpPageBody }] };
}
```

### Pattern 4: Tool Metadata Owns Native Descriptions

**What:** `wrapServerWithToolCatalog` already substitutes descriptions from `getToolMetadata`; Phase 141 should redirect `getToolMetadata` or registration metadata to `TOOL_META.description`. [VERIFIED: codebase grep]  
**When to use:** startup registration and native catalog capture so MCP host descriptions, delegated native provider tools, and search use the same source. [CITED: MCP Broker Requirements §7.13]

### Anti-Patterns to Avoid

- **Rebuilding broker TOFU/list-changed logic:** Phase 140 already owns drift classification and synchronous `ToolIndexSink`; Phase 141 should consume it. [VERIFIED: codebase grep]
- **Indexing `upstreamDescription` for brokered tools:** search must use downstream `description`, while TOFU uses upstream. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14]
- **Putting help body text into BM25 corpus:** full help pages are large and would distort concise search rankings; index descriptions and args. [ASSUMED]
- **Adding `help` to every Zod schema manually:** the sentinel is dispatcher-level and must bypass normal schema validation. [CITED: MCP Broker Requirements §7.13]
- **Wrapping brokered errors with FQ help footer:** brokered errors remain upstream semantics. [CITED: MCP Broker Requirements §7.13]
- **Changing `call_macro` wording casually:** the POC validates a no-penalty stance; retuning requires rerunning call-macro placement tests. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.13]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BM25 algorithm from scratch | A new search/ranking design | Port POC `PureBM25Indexer` and fix production idempotent `build` semantics | POC is the pinned source and fixture baseline. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12] |
| Frontmatter parser | Regex/YAML splitting | `gray-matter` | Existing dependency returns `data` and `content` and handles frontmatter parsing. [VERIFIED: Context7] |
| MCP tool discovery/call plumbing | Raw JSON-RPC | SDK `Client.listTools`, `Client.callTool`, `setNotificationHandler` | Official SDK supports tool list/call and notification handlers. [VERIFIED: Context7] |
| Broker list-changed fanout | A second notification path | Existing `BrokerClient.#bindToolListChanged` -> `McpBroker.applyToolListSnapshot` | Already verified by Phase 140 code/tests. [VERIFIED: codebase grep] |
| Native provider schema conversion | Manual JSON schema conversion | Existing `toOpenAiToolDefinition`/cached catalog | Current project uses Zod 4 JSON schema normalization. [VERIFIED: codebase grep] |
| Directed/YAML scenario frameworks | New runner | Existing `tests/scenarios/directed` and `tests/scenarios/integration` harnesses | Project skills and test plan require these layers. [VERIFIED: codebase grep] [CITED: MCP Broker Test Plan §2.5-2.6] |

**Key insight:** the ranking code is small; the risk is inconsistent tool surfaces where flat provider lists, search results, host listings, and TOFU each see different descriptions or eligibility. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14]

## Common Pitfalls

### Pitfall 1: POC `build()` Is Not Production-Idempotent As Written
**What goes wrong:** calling `build(tools)` twice appends duplicate docs because the POC loops through `indexDoc` without clearing state. [VERIFIED: codebase grep]  
**Why it happens:** the POC exercised incremental invariants but production REQ-076 explicitly requires idempotent build. [CITED: MCP Broker Requirements §7.12]  
**How to avoid:** production `build` should clear all maps/arrays before indexing or create a fresh internal state and swap it atomically. [ASSUMED]  
**Warning signs:** T-U-022 passes but no direct "build twice" assertion exists. [CITED: MCP Broker Test Plan §2.1]

### Pitfall 2: Search-Enabled Purpose Still Sends Flat Native Tools
**What goes wrong:** model sees both `fq.search_tools` and every eligible tool up front, defeating the purpose of search. [CITED: MCP Broker Requirements §7.12]  
**Why it happens:** current `executeAgentLoop` always merges `toolRegistry.providerTools` with brokered provider tools. [VERIFIED: codebase grep]  
**How to avoid:** gate provider tool assembly by `purpose.toolSearch`; enabled purposes build the index and provide only the search tool. [VERIFIED: codebase grep]  
**Warning signs:** provider request contains `get_document` or `basic__echo` for a `tool_search: enabled` purpose. [CITED: MCP Broker Test Plan T-S-022]

### Pitfall 3: Help Sentinel Runs Too Late
**What goes wrong:** `{help:true}` plus missing required params fails Zod validation instead of returning help. [CITED: MCP Broker Requirements §7.13]  
**Why it happens:** current native dispatcher validates args before calling the handler. [VERIFIED: codebase grep]  
**How to avoid:** add a dispatcher-level branch before schema parse; ignore other args when `help:true`. [CITED: MCP Broker Requirements §7.13]  
**Warning signs:** T-I-047 or T-S-021 receives `invalid_tool_arguments`. [CITED: MCP Broker Test Plan §2.4]

### Pitfall 4: `description_override` Touches TOFU Hash Input
**What goes wrong:** changing a user-authored override triggers re-approval or masks upstream drift. [CITED: MCP Broker Requirements §7.14]  
**Why it happens:** code may hash the registered `description` after override substitution. [VERIFIED: codebase grep]  
**How to avoid:** keep hash in `BrokerClient.#toBrokeredTool` over upstream SDK tool data and use registry `description` only for downstream surfaces. [VERIFIED: codebase grep]  
**Warning signs:** T-I-027/T-I-032a fail after search wiring. [VERIFIED: codebase grep]

### Pitfall 5: Treating FQ-Native Server ID Inconsistently
**What goes wrong:** search results use `fq`, `flashquery`, or bare tool names inconsistently. [ASSUMED]  
**Why it happens:** broker registry forbids `fq__` keys, while requirements say `server === 'flashquery'` for help fields. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.12]  
**How to avoid:** define one internal FQ-native search document convention and map output to `server: "flashquery"` exactly. [CITED: MCP Broker Requirements §7.12]  
**Warning signs:** `has_help` omitted for native tools because server is `fq` instead of `flashquery`. [CITED: MCP Broker Test Plan T-I-035]

## Code Examples

### Pinned BM25 Constants

```typescript
// Source: tool-search-bm25-poc/src/incremental-test.ts and pure.ts
const PARAMS = { k1: 2, b: 0.5 };
const PREPROC = { stemming: false, stopwords: true };
const INCLUDE_ARGS = false;
const NAME_BOOST = 3;
const DELTA = 0.25;
```

### Existing Description Override Split

```typescript
// Source: src/services/mcp-broker/registry.ts
const upstreamDescription = input.description;
const tool: BrokeredTool = {
  ...(override?.descriptionOverride === undefined
    ? { description: input.description }
    : { description: override.descriptionOverride, upstreamDescription }),
};
```

### Existing Broker List-Changed Index Seam

```typescript
// Source: src/services/mcp-broker/index.ts
const removedKeys = this.#removeTools([...diff.removed, ...diff.changed]);
if (removedKeys.length > 0) this.#indexSink.removeTools(removedKeys);
if (toolsToAdd.length > 0) this.#indexSink.addTools(toolsToAdd);
```

### Gap-Fixed Consumer Snapshot Options

```typescript
// Source: src/services/mcp-broker/index.ts after 9020acc
function snapshotOptionsFromConsumerContext(ctx: ConsumerContext): ToolListSnapshotOptions {
  return {
    ...(ctx.interactive === undefined ? {} : { interactive: ctx.interactive }),
    traceId: ctx.traceId,
    ...(ctx.kind === 'purpose' ? { purposeId: ctx.purposeId } : {}),
  };
}
```

Phase 141 index creation should call `Broker.listToolsForConsumer(ctx)` with a complete host or purpose `ConsumerContext`; it should not manually call `ensureConnected(serverId)` without snapshot options. [VERIFIED: git show 9020acc]

### Timestamped Broker Audit Events

```typescript
// Source: src/services/mcp-broker/trace.ts after 9020acc
export function recordBrokerAuditEvent(event: BrokerAuditEventInput): BrokerAuditEvent {
  const timestamped = { ...event, ts: event.ts ?? new Date().toISOString() };
  _brokerAuditEvents.push(structuredClone(timestamped));
  return timestamped;
}
```

Any Phase 141 search audit extension in the broker trace module should follow the same input-vs-timestamped return convention and assert `ts` in tests. [VERIFIED: git show 9020acc]

### Gray Matter Loader Shape

```typescript
// Source: Context7 /jonschlinkert/gray-matter
const file = matter(markdown);
const frontmatter = file.data;
const helpPageBody = file.content;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat delegated tool injection only | `tool_search: enabled` injects only `fq.search_tools` and indexes eligible tools | Phase 141 requirement, 2026-05-18 planning | Planner must alter `call_model`/agent-loop provider tool assembly. [CITED: MCP Broker Requirements §7.12] |
| Native descriptions in `src/mcp/tool-metadata.ts` | `.tool.md` becomes source for description/help hint/help page | Phase 141 requirement, 2026-05-18 planning | Planner must migrate current metadata descriptions without losing tier/category policy. [CITED: MCP Broker Requirements §7.13] |
| No-op broker index sink | Real per-consumer BM25 sink/index manager | Phase 140 handoff to Phase 141 | List-changed can update search synchronously. [VERIFIED: codebase grep] |
| Search package shootout | Zero-dependency pure TypeScript BM25+ implementation | BM25 POC dated 2026-05-15 | Planner should port POC rather than pick a package. [VERIFIED: codebase grep] |

**Deprecated/outdated:**
- External BM25/search libraries are out of scope for this phase because REQ-075 requires zero external dependency. [CITED: MCP Broker Requirements §7.12]
- `.tool.md` hot reload is out of scope; restart-required metadata is the v1 contract. [CITED: MCP Broker Requirements §7.13]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Tool help body prose should not be indexed by BM25. | Anti-Patterns | Ranking fixtures may need adjustment if product expects help-body search. |
| A2 | `node:perf_hooks` is acceptable for benchmark timing. | Standard Stack | Planner may choose Vitest benchmark helpers instead. |
| A3 | Production `build` should clear/swap internal state to satisfy idempotence. | Common Pitfalls | Alternative implementation can still pass if it deduplicates all existing keys correctly. |
| A4 | Native output server should be mapped to `flashquery` exactly. | Common Pitfalls | If canonical docs later choose another value, tests/envelopes must change. |

## Open Questions (RESOLVED)

1. **Should Phase 141 implement host index lifecycle now or only expose the API for Phase 142?**
   - What we know: REQ-087 is listed in Phase 141, while ROADMAP Phase 142 also includes host surface work. [CITED: ROADMAP.md] [CITED: MCP Broker Requirements §7.12]
   - What's unclear: whether host `fq.search_tools` should be externally callable before Phase 142 brokered host registration lands. [ASSUMED]
   - RESOLVED: Phase 141 plans now implement concrete host index lifecycle for REQ-087. Plan 141-06 builds a host index when `host.tool_search: enabled`, includes FQ-native plus host-visible brokered tools, and tests host-visible `list_changed` updates through T-I-038, T-I-039, and T-I-040. Phase 142 can still own broader host brokered registration work, but host search indexing is not deferred.

2. **Should `.tool.md` cover removed-status legacy metadata entries?**
   - What we know: actual registered native catalog has 29 tools and excludes removed legacy names; metadata file still lists removed names for migration evidence. [VERIFIED: command output] [VERIFIED: codebase grep]
   - What's unclear: REQ-089 says every FQ-native tool, which should mean registered tools rather than historical removed metadata. [CITED: MCP Broker Requirements §7.13]
   - RESOLVED: Phase 141 requires `.tool.md` pages for every registered FQ-native tool plus `search_tools`. Removed-status legacy metadata entries that are not registered native tools are excluded.

3. **When should startup enforcement run relative to help-page creation?**
   - RESOLVED: Plan 141-02 is loader/validator-only. Plans 141-04, 141-09, and 141-10 author the help-page corpus in focused batches. Plan 141-11 runs startup/catalog enforcement only after those page batches complete, preventing premature `createMcpServer` failures.

4. **How should canonical MCP Broker docs be prioritized during execution?**
   - RESOLVED: Every implementation/test plan task includes both MCP Broker canonical docs in `<read_first>`. Executors must treat those docs as higher priority than generated plan text and mention conflicts in SUMMARY.md.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime/build/tests | yes | v24.7.0 | Project minimum is >=20. [VERIFIED: command output] |
| npm | Package/test scripts | yes | 11.5.1 | none needed. [VERIFIED: command output] |
| Python 3 | Directed/YAML scenario harness | yes | 3.12.3 | none needed. [VERIFIED: command output] |
| `gsd-sdk` | GSD phase init/commit | yes | 1.42.3 | Manual file write/commit if unavailable. [VERIFIED: command output] |
| `rg` | Code search | yes | path found | `grep` fallback. [VERIFIED: command output] |
| `ctx7` CLI | Documentation fallback | no | - | Context7 MCP tools are available and were used. [VERIFIED: command output] [VERIFIED: Context7] |
| Supabase/.env.test | Integration/E2E tests | partial | `.env.test` exists | Tests skip gracefully when incomplete per AGENTS.md. [VERIFIED: command output] [CITED: AGENTS.md] |

**Missing dependencies with no fallback:** none identified for planning. [VERIFIED: command output]  
**Missing dependencies with fallback:** `ctx7` CLI is absent; Context7 MCP tools were available. [VERIFIED: Context7]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.1` installed; latest `4.1.6`. [VERIFIED: npm registry] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`, `tests/config/vitest.benchmark.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- --run tests/unit/tool-search/*.test.ts tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts` [VERIFIED: package.json] |
| Full suite command | `npm test && npm run test:integration && npm run test:e2e` [CITED: AGENTS.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-074..081 | BM25 parameters and invariants | unit | `npm test -- --run tests/unit/tool-search/indexer.test.ts` | no - Wave 0 |
| REQ-088 | POC ranking fixtures | integration | `npm run test:integration -- --run tests/integration/tool-search/search-tools.integration.test.ts` | no - Wave 0 |
| REQ-082..084 | `fq.search_tools` envelope | unit/integration | `npm test -- --run tests/unit/tool-search/search-tools-handler.test.ts` | no - Wave 0 |
| REQ-085..086 | enabled vs disabled purpose tool injection | unit/integration | `npm test -- --run tests/unit/llm-agent-loop.test.ts` | yes - extend |
| REQ-089..095 | `.tool.md` validation and `TOOL_META` | unit | `npm test -- --run tests/unit/tool-search/tool-meta.test.ts` | no - Wave 0 |
| REQ-093, REQ-096, REQ-098 | help sentinel and error footer | unit/integration | `npm test -- --run tests/unit/llm-tool-dispatcher.test.ts` | yes - extend |
| REQ-100..102 | override propagation and TOFU non-interaction | integration | `npm run test:integration -- --run tests/integration/mcp-broker/tofu-list-changed.test.ts tests/integration/tool-search/search-tools.integration.test.ts` | partial - extend |
| T-S-021..022 | public directed scenarios | directed | `python3 tests/scenarios/directed/testcases/test_mcp_broker_phase_c.py --managed` | no - Wave 0 |
| T-Y-008, T-Y-013 | YAML broker/search workflows | YAML scenario | `python3 tests/scenarios/integration/run_integration.py --managed tests/scenarios/integration/tests/search_tools_workflow.yml` | no - Wave 0 |

### Sampling Rate

- **Per task commit:** focused unit file for touched module plus `npm test -- --run tests/unit/mcp-broker-tofu.test.ts` when override/TOFU paths move. [ASSUMED]
- **Per wave merge:** `npm test` and focused integration for `mcp-broker` + `tool-search`. [ASSUMED]
- **Phase gate:** full unit, integration, E2E, directed Phase C, YAML Phase C, build, and `npm run lint`. [CITED: AGENTS.md] [CITED: MCP Broker Test Plan §2.7]

### Wave 0 Gaps

- [ ] `tests/unit/tool-search/indexer.test.ts` - covers T-U-022..027 and REQ-074..081. [CITED: MCP Broker Test Plan §2.1]
- [ ] `tests/unit/tool-search/tool-meta.test.ts` - covers T-U-028..034 and T-U-044. [CITED: MCP Broker Test Plan §2.1]
- [ ] `tests/unit/tool-search/search-tools-handler.test.ts` - covers result envelope and empty states. [CITED: MCP Broker Test Plan §2.3]
- [ ] `tests/integration/tool-search/search-tools.integration.test.ts` - covers T-I-033..049 and POC fixtures. [CITED: MCP Broker Test Plan §2.3-2.4]
- [ ] `tests/fixtures/tool-search/` - copy POC corpora and query JSON. [CITED: MCP Broker Requirements §7.12]
- [ ] `tests/scenarios/directed/testcases/test_mcp_broker_phase_c.py` - covers MCB-21/MCB-22. [CITED: MCP Broker Test Plan §2.5]
- [ ] `tests/scenarios/integration/tests/description_override_substitution.yml` and `search_tools_workflow.yml` - covers INT-MCB-08/13. [CITED: MCP Broker Test Plan §2.6]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no new auth | Existing MCP auth remains unchanged. [CITED: AGENTS.md] |
| V3 Session Management | yes, process state | Do not add server-side session state beyond per-call/per-invocation index objects. [CITED: AGENTS.md] [CITED: MCP Broker Requirements §7.12] |
| V4 Access Control | yes | Preserve purpose tier/native eligibility and broker consumer visibility filters before indexing/searching. [VERIFIED: codebase grep] |
| V5 Input Validation | yes | Zod for `fq.search_tools` args and `.tool.md` frontmatter validation. [CITED: AGENTS.md] |
| V6 Cryptography | yes, regression only | Preserve TOFU SHA-256 upstream hashing; do not alter hash inputs. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14] |
| V8 Data Protection | yes | Do not log raw tool args or full help pages in search audit; audit only query/result_count/latency/trace. [CITED: MCP Broker Requirements §7.10] |
| V12 File/Resource Handling | yes | `.tool.md` loader should read only `src/mcp/tools/*.tool.md`; no user-provided paths. [CITED: MCP Broker Requirements §7.13] |

### Known Threat Patterns for MCP Tool Search

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hidden brokered tool exposed through search despite consumer config | Elevation of Privilege | Build indexes from `listToolsForConsumer(ctx)` and native registry eligibility only. [VERIFIED: codebase grep] |
| Upstream prompt-description drift masked by override | Tampering | Hash upstream description in TOFU, use override only downstream. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §7.14] |
| Help footer appended to brokered upstream errors | Spoofing/Tampering | Branch footer only on native dispatch; brokered dispatch remains pass-through. [CITED: MCP Broker Requirements §7.13] |
| Search audit leaks sensitive tool arguments | Information Disclosure | Audit query, result count, latency, consumer, trace only. [CITED: MCP Broker Requirements §7.10] |
| `.tool.md` parse loads arbitrary files | Tampering | Static glob under source tree and startup validation. [CITED: MCP Broker Requirements §7.13] |

## Sources

### Primary (HIGH confidence)

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` - REQ-011, REQ-074..102, Phase C implementation guidance. [CITED: local canonical doc]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md` - Phase C test IDs and acceptance details. [CITED: local canonical doc]
- `.planning/phases/141-bm25-tool-search-help-pages-and-description-overrides/141-CONTEXT.md` - locked decisions and downstream read-first rule. [CITED: local phase context]
- `.planning/ROADMAP.md` - Phase 141 and adjacent phase boundaries. [CITED: local planning doc]
- `.planning/REQUIREMENTS.md` - REQ index and current status. [CITED: local planning doc]
- `.planning/phases/139-broker-foundation-registry-and-dispatch/139-VERIFICATION.md` - Phase 139 foundation verification. [CITED: local verification doc]
- `.planning/phases/140-tofu-schema-pinning-and-tool-list-change-handling/140-RESEARCH.md` - Phase 140 index-update seam handoff. [CITED: local research doc]
- `tool-search-bm25-poc/src/libraries/pure.ts`, `src/incremental-test.ts`, corpora and query fixtures - pinned POC implementation and tests. [VERIFIED: codebase grep]
- Context7 `/modelcontextprotocol/typescript-sdk` - Client `listTools`, `callTool`, and notification handler docs. [VERIFIED: Context7]
- Context7 `/jonschlinkert/gray-matter` - frontmatter `data`/`content` parser API. [VERIFIED: Context7]

### Secondary (MEDIUM confidence)

- npm registry `npm view` for package latest versions and modified timestamps. [VERIFIED: npm registry]
- Local command probes for Node/npm/Python/gsd-sdk availability. [VERIFIED: command output]

### Tertiary (LOW confidence)

- Assumptions in the Assumptions Log only; no LOW-confidence claim is used as a locked recommendation. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing dependencies and registry versions verified; no new package recommended. [VERIFIED: npm registry]
- Architecture: HIGH - based on current Phase 139/140 code seams and canonical Phase C docs. [VERIFIED: codebase grep] [CITED: MCP Broker Requirements §10]
- Pitfalls: HIGH for code-seam pitfalls, MEDIUM for assumed design choices around help-body indexing/host timing. [VERIFIED: codebase grep]

**Research date:** 2026-05-18  
**Valid until:** 2026-06-17 for codebase-local planning; re-check npm/SDK docs if dependencies change before implementation. [ASSUMED]
