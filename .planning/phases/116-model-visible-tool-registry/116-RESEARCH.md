# Phase 116: Model-Visible Tool Registry - Research

**Researched:** 2026-05-06 [VERIFIED: system date]
**Domain:** FlashQuery native tool exposure, MCP/Zod schema capture, OpenAI-compatible tool definitions [VERIFIED: .planning/ROADMAP.md]
**Confidence:** HIGH [VERIFIED: codebase inspection + Context7 + official OpenAI docs]

<user_constraints>
## User Constraints

No Phase 116 `116-CONTEXT.md` exists in `.planning/phases/116-model-visible-tool-registry`, so there are no phase-specific locked decisions to copy verbatim. [VERIFIED: gsd-sdk init.phase-op 116]

Dependency constraints from Phase 115 apply: purpose config already accepts `tools`, `excluded_tools`, and `templates`; model capabilities are structured booleans; Mode 2 admission requires tool/usage capabilities; runtime template binding uses the same admission service. [VERIFIED: .planning/phases/115-purpose-config-bindings-capabilities/115-01-SUMMARY.md] [VERIFIED: .planning/phases/115-purpose-config-bindings-capabilities/115-04-SUMMARY.md]
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TOOL-01 | Purpose-level `tools` expands safe tool tiers and named tools into a final model-visible native tool allowlist. | ATL defines `tier:read-only`, `tier:read-write`, additive union, duplicate ignore, and explicit-name behavior. [CITED: Agentic-LLM-Tool-Loop.md §5.3] |
| TOOL-02 | Purpose-level `excluded_tools` removes tools from the final set and is invalid without `tools`. | ATL defines exclusions after expansion and rejects `excluded_tools` without `tools`. [CITED: Agentic-LLM-Tool-Loop.md §5.3] |
| TOOL-03 | Hard-excluded tools, including `call_model` and admin/plugin management tools, are removed from exposure with warnings. | ATL hard-excludes `call_model`, `register_plugin`, `unregister_plugin`, and `get_plugin_info`; OQ-18 says warn/remove rather than fail config. [CITED: Agentic-LLM-Tool-Loop.md §5.3] [CITED: Agentic-LLM-Tool-Loop.md OQ-18] |
| TOOL-04 | Internal tool registry translates MCP/Zod schemas into OpenAI-compatible tool definitions with strict-mode support where available. | MCP SDK `registerTool` uses Zod schemas; Zod 4 has `z.toJSONSchema()`; OpenAI strict tools require `additionalProperties: false` and all properties in `required`. [CITED: /modelcontextprotocol/typescript-sdk] [CITED: /websites/zod_dev_v4] [CITED: platform.openai.com/docs/guides/function-calling] |
| VAL-116 | Runnable unit tests and at least one public-surface scenario validate exposure, exclusions, hard exclusions, schema translation, and empty-tool omission. | Existing focused tests cover `llm-config`, `llm-client`, `llm-tool`, plus managed directed Python and YAML integration surfaces. [VERIFIED: tests/unit/llm-config.test.ts] [VERIFIED: tests/unit/llm-client.test.ts:700] [VERIFIED: tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py:1] |
</phase_requirements>

## Summary

Phase 116 should create the native model-visible registry, not the loop dispatcher. The repo already has Phase 115 config fields, DB storage columns, and capability gates, but no module that expands purpose `tools`, applies hard exclusions, captures native MCP tool metadata, or builds provider `tools` definitions. [VERIFIED: src/config/loader.ts:163] [VERIFIED: src/storage/supabase.ts:485] [VERIFIED: src/llm/capabilities.ts:61] [VERIFIED: rg model-visible registry]

The safest architecture is a new pure `src/llm/tool-registry.ts` module with static tier definitions, hard-exclusion constants, schema translation, and diagnostics. It should consume a captured catalog of native MCP tool definitions produced from the same registration metadata used by `server.registerTool`, but it should not call tool handlers yet; internal dispatch is Phase 117. [VERIFIED: src/mcp/server.ts:448] [VERIFIED: .planning/REQUIREMENTS.md]

**Primary recommendation:** implement `assembleNativeToolRegistry(config, purposeName, modelName)` that returns `{ nativeToolNames, providerTools, diagnostics }`, and wire it only far enough into `call_model`/`chatByPurpose` to send non-empty provider tools and omit empty `tools`. [VERIFIED: src/llm/client.ts:199] [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Purpose tool expansion | API / Backend | CLI config validation | Purpose objects are parsed at startup, but final allowlists are assembled for an active purpose/model request. [VERIFIED: src/config/loader.ts:163] |
| Native tool catalog | API / Backend | MCP API / Backend | Tool definitions originate in MCP registration modules but must be reusable for delegated-provider definitions. [VERIFIED: src/mcp/server.ts:448] |
| OpenAI tool schema translation | API / Backend | Provider transport | Translation happens before `chat()` sends provider params; `client.ts` already forwards provider params into the JSON body. [VERIFIED: src/llm/client.ts:315] |
| Empty-tool omission | Provider transport | API / Backend | `normalizeProviderParameters()` already removes `tools: []`, and Phase 116 should preserve that contract. [VERIFIED: src/llm/client.ts:199] |
| Warnings/diagnostics | API / Backend | MCP API / Backend | Hard exclusions should be visible to callers/scenarios without requiring private state inspection. [CITED: Agentic-LLM-Tool-Loop.md OQ-18] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20, TypeScript strict mode, ESM, `@modelcontextprotocol/sdk`, Supabase clients, `pg`, `tsup`, `tsx`, and Vitest. [VERIFIED: AGENTS.md]
- Use `async/await`; MCP handlers catch internally and return text content with `isError: true` on failure. [VERIFIED: AGENTS.md]
- Use Zod for external input validation. [VERIFIED: AGENTS.md]
- Do not use CommonJS or `@modelcontextprotocol/server`; use `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless. [VERIFIED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; integration tests under `tests/integration/*.test.ts`; directed scenarios under `tests/scenarios/directed/testcases`. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Installed | Latest Verified | Purpose | Why Standard |
|---------|-----------|-----------------|---------|--------------|
| TypeScript | `^6.0.2` | `6.0.2` installed | Registry types and provider tool contracts | Existing project language and build target. [VERIFIED: package.json] [VERIFIED: npx tsc --version] |
| Zod | `^4.3.6` | `4.4.3`, modified 2026-05-04 | MCP schema definitions and JSON Schema conversion | Existing MCP/config schema library; Zod 4 exposes first-party `toJSONSchema()`. [VERIFIED: package.json] [VERIFIED: npm registry] [CITED: /websites/zod_dev_v4] |
| `@modelcontextprotocol/sdk` | `^1.27.1` | `1.29.0`, modified 2026-03-30 | MCP `registerTool` definitions | Existing server stack and official SDK API. [VERIFIED: package.json] [VERIFIED: npm registry] [CITED: /modelcontextprotocol/typescript-sdk] |
| Vitest | `^4.1.1` | `4.1.1` installed | Unit/integration validation | Existing focused test runner. [VERIFIED: package.json] [VERIFIED: npx vitest --version] |

### Supporting

| Library | Installed | Latest Verified | Purpose | When to Use |
|---------|-----------|-----------------|---------|-------------|
| `tsx` | `^4.21.0` | `4.21.0` installed | Directed scenario server and dev execution | Use existing scenario harness and `npm run dev`. [VERIFIED: package.json] [VERIFIED: npx tsx --version] |
| `zod-to-json-schema` | transitive `3.25.1` | `3.25.2`, modified 2026-03-27 | Legacy fallback only | Do not add unless Zod 4 conversion cannot represent an existing schema. [VERIFIED: package-lock.json] [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod 4 `z.toJSONSchema()` | Add `zod-to-json-schema` | Prefer built-in Zod 4 because it is already installed and verified to emit object schemas with `additionalProperties: false` for `z.object()`. [VERIFIED: local node z.toJSONSchema probe] |
| Static tool metadata registry | Scrape `McpServer` internals after registration | Avoid private SDK internals; MCP SDK docs expose `registerTool`, not a stable public introspection API. [CITED: /modelcontextprotocol/typescript-sdk] |
| Per-request schema conversion | Startup/catalog conversion | ATL says deterministic schema translation is startup-time, not per-request. [CITED: Agentic-LLM-Tool-Loop.md §5.2] |

**Installation:**
```bash
npm install
```

No new runtime dependency is recommended for Phase 116. [VERIFIED: package.json] [VERIFIED: local z.toJSONSchema probe]

## Architecture Patterns

### System Architecture Diagram

```text
flashquery.yml purpose.tools / excluded_tools
  |
  v
Config validation
  |-- reject excluded_tools without tools
  |-- reject unknown tier/tool names
  v
Native Tool Catalog
  |-- registered tool name
  |-- description
  |-- Zod input schema
  |-- safety tier metadata
  |-- hard-exclusion metadata
  v
Purpose Tool Registry Assembly
  |-- expand tier:read-only / tier:read-write
  |-- union named tools
  |-- subtract excluded_tools
  |-- remove hard-excluded tools and emit diagnostics
  |-- translate schemas to OpenAI-compatible function tools
  |-- strict=true only when selected model supports strict_tools
  v
call_model resolver=purpose
  |-- no remaining tools -> omit provider tools
  |-- non-empty tools -> pass provider tools to chatByPurpose/chat()
  v
OpenAI-compatible provider request body
```

### Recommended Project Structure

```text
src/
├── llm/
│   ├── tool-registry.ts          # tier expansion, diagnostics, OpenAI tool translation
│   ├── capabilities.ts           # reuse strict_tools capability lookup/defaulting
│   └── client.ts                 # preserve tools: [] omission and forward non-empty tools
├── mcp/
│   ├── tool-catalog.ts           # optional static registration helper/catalog metadata
│   ├── server.ts                 # register tools via catalog-aware wrapper if needed
│   └── tools/*.ts                # source descriptions/input schemas remain close to handlers
└── config/
    └── loader.ts                 # add validation for invalid tier/tool names and excluded_tools rule
```

This layout keeps provider-facing registry logic under `src/llm`, while the MCP layer remains the owner of native tool definitions and handlers. [VERIFIED: AGENTS.md] [VERIFIED: src/mcp/server.ts:448]

### Pattern 1: Catalog Capture Without Handler Dispatch

**What:** Capture `{ name, description, inputSchema }` at tool-registration time or from a static metadata table, but do not invoke handlers in Phase 116. [VERIFIED: src/mcp/tools/memory.ts:56] [VERIFIED: .planning/REQUIREMENTS.md]

**When to use:** Use for schema translation and provider request assembly; defer handler lookup/call execution to Phase 117. [VERIFIED: .planning/ROADMAP.md Phase 117]

**Example:**
```ts
// Source: MCP SDK registerTool docs + existing registerTool call shape.
export type NativeToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape> | z.ZodTypeAny;
  tier: 'read-only' | 'read-write' | 'hard-excluded';
};
```

### Pattern 2: Strict Tool Schema Normalization

**What:** Convert Zod to JSON Schema, remove root `$schema`, ensure `type: "object"`, ensure `properties`, and when strict is enabled recursively set object `additionalProperties: false` and mark all property names required. [CITED: /websites/zod_dev_v4] [CITED: platform.openai.com/docs/guides/function-calling]

**When to use:** Use only when the selected model capability resolves `strict_tools: true`; otherwise emit non-strict function definitions and still validate arguments at dispatch time later. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

**Example:**
```ts
// Source: OpenAI function-calling strict requirements.
function toOpenAiFunctionTool(def: NativeToolDefinition, strict: boolean) {
  const parameters = normalizeJsonSchema(z.toJSONSchema(def.inputSchema), { strict });
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters,
      ...(strict ? { strict: true } : {}),
    },
  };
}
```

### Pattern 3: Pure Expansion Result With Diagnostics

**What:** Return a structured result instead of mutating config or logging as the only observable output. [VERIFIED: src/llm/capabilities.ts:11]

**When to use:** Use from config validation, `call_model`, and future discovery diagnostics. [VERIFIED: .planning/ROADMAP.md Phase 119]

**Example:**
```ts
type ToolRegistryAssembly = {
  nativeToolNames: string[];
  providerTools?: OpenAiToolDefinition[];
  diagnostics: {
    hardExcluded: Array<{ tool: string; reason: string }>;
    excluded: string[];
    unknown: string[];
  };
};
```

### Anti-Patterns to Avoid

- **Exposing `call_model` recursively:** Hard-exclude it even if a purpose names it or includes a tier that would otherwise include it. [CITED: Agentic-LLM-Tool-Loop.md §5.3]
- **Letting admin/plugin tools through:** Hard-exclude `register_plugin`, `unregister_plugin`, and `get_plugin_info`. [CITED: Agentic-LLM-Tool-Loop.md §5.3]
- **Silently dropping hard-excluded tools without diagnostics:** OQ-18 requires warn/remove, not silent omission. [CITED: Agentic-LLM-Tool-Loop.md OQ-18]
- **Treating `tools: []` as Mode 2:** Empty/absent native tools means no native provider tools; provider request must omit `tools` entirely if no template tools are also present. [CITED: Agentic-LLM-Tool-Loop.md OQ-27] [VERIFIED: src/llm/client.ts:199]
- **Trusting provider strict mode as validation:** FlashQuery must still validate model-supplied arguments against schemas at dispatch time in Phase 117. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zod to JSON Schema conversion | Custom Zod AST walker | `z.toJSONSchema()` plus small OpenAI normalizer | Zod 4 has first-party JSON Schema output and preserves descriptions. [CITED: /websites/zod_dev_v4] |
| Provider tool object format | Custom protocol | OpenAI Chat Completions `tools: [{ type: "function", function: ... }]` | Current client posts to `/v1/chat/completions`; OpenAI-compatible providers expect that shape. [VERIFIED: src/llm/client.ts:328] [CITED: platform.openai.com/docs/api-reference/chat/create] |
| Purpose config parsing | Ad hoc YAML checks | Existing Zod config loader + post-parse validation | Phase 115 already introduced strict purpose fields and capability admission there. [VERIFIED: src/config/loader.ts:163] [VERIFIED: src/config/loader.ts:802] |
| Empty tools omission | Request-body special case in `call_model` | Existing `normalizeProviderParameters()` | Existing unit coverage already locks `tools: []` omission. [VERIFIED: src/llm/client.ts:199] [VERIFIED: tests/unit/llm-client.test.ts:700] |
| Tool safety tiers | Runtime grep over files | Static constants with tests against captured catalog | Tiers are product/security policy, not incidental file layout. [CITED: Agentic-LLM-Tool-Loop.md §5.3] |

**Key insight:** the registry is a policy boundary; if it is inferred loosely from available MCP tools, Phase 117 dispatch can accidentally expose tools that Phase 116 never made safe. [CITED: Agentic-LLM-Tool-Loop.md §5.3]

## Common Pitfalls

### Pitfall 1: Current Tool Count And Safety Drift
**What goes wrong:** The actual server registers 37 tools, including `call_model`, plugin admin tools, scan tools, pending-review tools, file tools, and usage tools. [VERIFIED: local tsx registration capture]
**Why it happens:** `createMcpServer()` registers every MCP tool group unconditionally, while tiers are a separate delegated-model safety concept. [VERIFIED: src/mcp/server.ts:448]
**How to avoid:** Define allowlisted tiers explicitly and test exact tier contents. [CITED: Agentic-LLM-Tool-Loop.md §5.3]
**Warning signs:** A unit test that simply checks "all registered tools can translate" without checking tier membership. [ASSUMED]

### Pitfall 2: SDK `registerTool` Shape Versus Existing Raw Shape
**What goes wrong:** MCP SDK docs show `inputSchema: z.object({ ... })`, while current FlashQuery tools mostly pass raw shape objects under `inputSchema`. [CITED: /modelcontextprotocol/typescript-sdk] [VERIFIED: src/mcp/tools/llm.ts:122]
**Why it happens:** Existing SDK version accepts the current project pattern, but Zod JSON Schema conversion wants a Zod schema value. [VERIFIED: tests/e2e/protocol.test.ts:84] [CITED: /websites/zod_dev_v4]
**How to avoid:** Add a helper that wraps raw shapes with `z.object(shape)` before conversion, and test both `{ inputSchema: { query: z.string() } }` and `z.object(...)`. [VERIFIED: src/mcp/tools/memory.ts:65]
**Warning signs:** `z.toJSONSchema()` receives a plain object and throws or emits no schema. [VERIFIED: local z.toJSONSchema probe]

### Pitfall 3: Strict OpenAI Schemas Make Optional Fields Tricky
**What goes wrong:** OpenAI strict mode requires all properties in `required`, so normal JSON Schema optional fields are not strict-compatible unless represented with nullable unions. [CITED: platform.openai.com/docs/guides/function-calling]
**Why it happens:** Zod emits optional fields by omitting them from `required`, while OpenAI strict mode has stricter structured-output constraints. [VERIFIED: local z.toJSONSchema probe] [CITED: platform.openai.com/docs/guides/function-calling]
**How to avoid:** Either normalize optional properties into required nullable schemas for strict tools or disable `strict` for schemas that cannot be safely normalized. [ASSUMED]
**Warning signs:** Provider returns a 400 mentioning strict schema requirements. [CITED: platform.openai.com/docs/guides/function-calling]

### Pitfall 4: `excluded_tools` Must Fail Without `tools`
**What goes wrong:** Config accepts a purpose with only `excluded_tools`, resulting in no clear base set. [CITED: Agentic-LLM-Tool-Loop.md §5.3]
**Why it happens:** Phase 115 schema accepts `excluded_tools` structurally but did not implement Phase 116 semantic validation. [VERIFIED: src/config/loader.ts:169]
**How to avoid:** Add loader validation after name normalization and before capability admission. [VERIFIED: src/config/loader.ts:732]
**Warning signs:** A unit test can load `excluded_tools: [search_memory]` with absent `tools`. [VERIFIED: src/config/loader.ts:163]

## Code Examples

### Expand Purpose Tools
```ts
// Source: ATL §5.3 algorithm.
const TOOL_TIERS = {
  'tier:read-only': ['search_documents', 'get_document', 'search_memory', 'get_memory', 'list_memories', 'search_records', 'get_record', 'search_all', 'get_briefing'],
  'tier:read-write': ['search_documents', 'get_document', 'search_memory', 'get_memory', 'list_memories', 'search_records', 'get_record', 'search_all', 'get_briefing', 'create_document', 'update_document', 'append_to_doc', 'move_document', 'save_memory', 'update_memory', 'create_record', 'update_record', 'apply_tags', 'archive_document', 'archive_memory', 'archive_record', 'create_directory', 'remove_directory'],
} as const;

const HARD_EXCLUDED = new Set(['call_model', 'register_plugin', 'unregister_plugin', 'get_plugin_info']);
```

### Convert To OpenAI Tool Definition
```ts
// Source: Zod 4 JSON Schema + OpenAI function tool docs.
import { z } from 'zod';

const schema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().optional().describe('Maximum results'),
});

const parameters = z.toJSONSchema(schema);
delete (parameters as Record<string, unknown>)['$schema'];

const tool = {
  type: 'function',
  function: {
    name: 'search_documents',
    description: 'Search vault documents by semantic similarity or metadata.',
    parameters,
    strict: true,
  },
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OpenAI `function_call` | `tool_calls` and `tools` | OpenAI docs now mark `function_call` deprecated in Chat Completions. [CITED: platform.openai.com/docs/api-reference/chat/create] | Normalize legacy `function_call` finish reasons but emit modern tool definitions. [VERIFIED: src/llm/client.ts:441] |
| Free-form model `capabilities: string[]` | Structured capability booleans plus `tags` | Phase 115 completed 2026-05-06. [VERIFIED: 115-01-SUMMARY.md] | Registry must use `capabilities.strict_tools`, not tags, to choose strict tool schemas. [VERIFIED: src/llm/capabilities.ts:3] |
| `get_doc_outline` in tiers | `get_document` with include/headings | Phase 107 removed `get_doc_outline`. [VERIFIED: tests/e2e/protocol.test.ts:101] | ATL tier list is stale for this one tool; Phase 116 should map read-only outline behavior to `get_document`, not resurrect `get_doc_outline`. [VERIFIED: tests/e2e/protocol.test.ts:101] |

**Deprecated/outdated:**
- `get_doc_outline` in ATL tier examples is outdated relative to the current codebase; do not expose a removed tool. [VERIFIED: tests/e2e/protocol.test.ts:101] [CITED: Agentic-LLM-Tool-Loop.md §5.3]
- OpenAI `function_call` is deprecated and replaced by `tool_calls`; keep normalization only for provider compatibility. [CITED: platform.openai.com/docs/api-reference/chat/create] [VERIFIED: src/llm/client.ts:441]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Optional Zod properties may need nullable conversion or strict-mode fallback rather than always forcing all fields required. | Common Pitfalls | Provider strict-mode requests could reject common optional schemas or make optional args semantically required. |
| A2 | Warning signs about broad "all registered tools translate" tests are inferred planning guidance, not a verified existing failure. | Common Pitfalls | Planner may over-weight a hypothetical test smell. |

## Open Questions

1. **Where should delegated-tool diagnostics be surfaced before Phase 119?**
   - What we know: Phase 119 owns full discovery diagnostics, but Phase 116 success criteria require hard-exclusion warnings and a public-surface tool-list scenario. [VERIFIED: .planning/ROADMAP.md]
   - What's unclear: Whether to extend `list_purposes` now with minimal `native_tools` diagnostics or expose diagnostics only through a Phase 116 scenario response path. [ASSUMED]
   - Recommendation: Add minimal `list_purposes` fields for native tool diagnostics only if the planner accepts this as Phase 116's public scenario surface; defer template diagnostics/help to Phase 119. [VERIFIED: .planning/ROADMAP.md]

2. **Should `force_file_scan`, `list_vault`, and `clear_pending_reviews` be tiered?**
   - What we know: ATL tiers do not list those later-added tools, while the current server registers them. [CITED: Agentic-LLM-Tool-Loop.md §5.3] [VERIFIED: local tsx registration capture]
   - What's unclear: Whether these are intentionally omitted from delegated exposure or just absent because the spec predates them. [ASSUMED]
   - Recommendation: Keep tiers exactly to ATL plus current replacement for `get_doc_outline`; require explicit user decision before adding newer operational tools to delegated exposure. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | `v24.7.0` | Node >=20 required. [VERIFIED: node --version] |
| npm | Package scripts/version checks | yes | `11.5.1` | none needed. [VERIFIED: npm --version] |
| tsx | Scenario/dev execution | yes | `4.21.0` | Build then `node dist/index.js`. [VERIFIED: npx tsx --version] |
| Vitest | Unit/integration tests | yes | `4.1.1` | none. [VERIFIED: npx vitest --version] |
| Supabase/.env.test | Integration/E2E requiring DB | unknown | not probed | Existing tests skip when incomplete. [VERIFIED: AGENTS.md] |

**Missing dependencies with no fallback:** None found for unit-level Phase 116 planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:** Supabase credentials may be absent; use unit and managed directed tests for Phase 116 core behavior, and only add Supabase integration if implementation touches DB state. [VERIFIED: tests/helpers/test-env.ts]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.1`; directed Python scenario harness. [VERIFIED: npx vitest --version] [VERIFIED: tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py:1] |
| Config file | `tests/config/vitest.unit.config.ts`; `tests/config/vitest.integration.config.ts`. [VERIFIED: tests/config/vitest.unit.config.ts] |
| Quick run command | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts` [VERIFIED: package.json] |
| Full suite command | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/llm-config.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts && npm run build` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TOOL-01 | tier expansion and named-tool union | unit | `npm test -- tests/unit/llm-tool-registry.test.ts -t TOOL-01` | no, Wave 0 |
| TOOL-02 | exclusions subtract and `excluded_tools` without `tools` fails | unit | `npm test -- tests/unit/llm-config.test.ts -t TOOL-02` | partial, extend |
| TOOL-03 | hard-excluded tools warn/remove | unit + directed | `npm test -- tests/unit/llm-tool-registry.test.ts -t TOOL-03` | no, Wave 0 |
| TOOL-04 | Zod/MCP schemas translate to OpenAI function tools with strict gating | unit | `npm test -- tests/unit/llm-tool-registry.test.ts -t TOOL-04` | no, Wave 0 |
| VAL-116 | public-surface scenario validates final visible tool list/empty omission | directed + unit | `python3 tests/scenarios/directed/run_suite.py --managed --test test_call_model_native_tool_registry` | no, Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/llm-tool-registry.test.ts` [VERIFIED: package.json]
- **Per wave merge:** focused unit tests plus `npm run build`. [VERIFIED: package.json]
- **Phase gate:** focused unit tests, managed directed scenario, and build. [VERIFIED: .planning/REQUIREMENTS.md VAL-116]

### Wave 0 Gaps

- [ ] `tests/unit/llm-tool-registry.test.ts` - covers TOOL-01, TOOL-03, TOOL-04. [VERIFIED: rg llm-tool-registry]
- [ ] Extend `tests/unit/llm-config.test.ts` - covers TOOL-02 semantic config rejection and invalid tier/tool names. [VERIFIED: tests/unit/llm-config.test.ts]
- [ ] `tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py` - public-surface scenario for tool-list scenario and hard-exclusion warnings. [VERIFIED: tests/scenarios/directed/testcases]
- [ ] Add coverage rows in `tests/scenarios/directed/DIRECTED_COVERAGE.md` and `tests/scenarios/integration/INTEGRATION_COVERAGE.md` for VAL-116. [VERIFIED: Phase 115 summary]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth changes; MCP auth remains existing server concern. [VERIFIED: src/mcp/auth.ts] |
| V3 Session Management | no | MCP remains stateless and no server-side sessions are introduced. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Purpose-level allowlists, exclusions, and hard exclusions are access-control policy for delegated models. [CITED: Agentic-LLM-Tool-Loop.md §5.3] |
| V5 Input Validation | yes | Zod schemas remain source of tool argument validation and JSON Schema translation. [VERIFIED: AGENTS.md] |
| V6 Cryptography | no | No cryptographic primitive changes. [VERIFIED: phase scope] |

### Known Threat Patterns for FlashQuery Tool Exposure

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Recursive delegated calls through `call_model` | Denial of Service | Hard-exclude `call_model` from all delegated registries. [CITED: Agentic-LLM-Tool-Loop.md §5.3] |
| Delegated model mutates FlashQuery/plugin administration | Elevation of Privilege | Hard-exclude plugin/admin tools. [CITED: Agentic-LLM-Tool-Loop.md §5.3] |
| Over-broad tier exposes unexpected new tools | Elevation of Privilege | Static tier constants plus exact membership tests. [ASSUMED] |
| Strict schema mismatch causes provider rejection | Denial of Service | Normalize schemas per OpenAI strict requirements or disable strict when not representable. [CITED: platform.openai.com/docs/guides/function-calling] |

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` - project stack, conventions, testing, and MCP response rules. [VERIFIED: AGENTS.md]
- `.planning/REQUIREMENTS.md` - TOOL-01 through TOOL-04 and VAL-116. [VERIFIED: .planning/REQUIREMENTS.md]
- `.planning/ROADMAP.md` - Phase 116 and Phase 117 boundaries. [VERIFIED: .planning/ROADMAP.md]
- Phase 115 summaries/research/patterns - dependency implementation state. [VERIFIED: .planning/phases/115-purpose-config-bindings-capabilities/*-SUMMARY.md]
- `Agentic-LLM-Tool-Loop.md` - tool tiers, hard exclusions, schema translation, capability contract. [CITED: Agentic-LLM-Tool-Loop.md]
- `Document Reference System.md` - future template registry collision/reverse-map constraints. [CITED: Document Reference System.md §11]
- Context7 `/modelcontextprotocol/typescript-sdk` - `registerTool` and Zod inputSchema API. [CITED: /modelcontextprotocol/typescript-sdk]
- Context7 `/websites/zod_dev_v4` - `z.toJSONSchema()` and metadata conversion. [CITED: /websites/zod_dev_v4]
- OpenAI official docs - Chat Completions tool definitions and strict function schema requirements. [CITED: platform.openai.com/docs/api-reference/chat/create] [CITED: platform.openai.com/docs/guides/function-calling]

### Secondary (MEDIUM confidence)

- npm registry version checks for `@modelcontextprotocol/sdk`, `zod`, `openai`, `zod-to-json-schema`. [VERIFIED: npm registry]
- Local `node` probe of `z.toJSONSchema()` output for optional fields/additionalProperties. [VERIFIED: local node z.toJSONSchema probe]

### Tertiary (LOW confidence)

- Assumptions about optional-field strict normalization strategy and newer operational tool tier posture. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions and docs verified. [VERIFIED: package.json] [VERIFIED: npm registry]
- Architecture: HIGH - exact existing seams found in `config/loader.ts`, `llm/client.ts`, `mcp/server.ts`, and `mcp/tools/llm.ts`. [VERIFIED: codebase grep]
- Pitfalls: MEDIUM - key risks are verified, but optional strict-schema normalization policy needs implementation spike or user decision. [VERIFIED: OpenAI docs] [ASSUMED]

**Research date:** 2026-05-06 [VERIFIED: system date]
**Valid until:** 2026-06-05 for codebase-local findings; 2026-05-13 for provider/tool-schema docs because OpenAI-compatible APIs change quickly. [ASSUMED]
