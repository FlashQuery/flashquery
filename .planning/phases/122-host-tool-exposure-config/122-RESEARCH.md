# Phase 122: Host Tool Exposure Config - Research

**Researched:** 2026-05-11  
**Domain:** TypeScript MCP server configuration, tool metadata selection, delegated native tool registry  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Canonical Source Documents
- Downstream planning, implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- If roadmap details and product docs appear to conflict, treat `.planning/ROADMAP.md` as the phase boundary and the product docs as the detailed contract inside that boundary.

### Host Tool Exposure
- Add `host_mcp_tools` as a top-level YAML config section with `tools` and `excluded_tools` arrays.
- The host selector grammar is identical to delegated purpose selector grammar: `tier:read-only`, `tier:read-write`, `category:<category>`, explicit tool names, and `excluded_tools` as the final deny layer.
- Defaults must preserve today's host MCP behavior: all currently host-eligible tools are exposed when `host_mcp_tools` is omitted.
- Host-disabled tools are skipped at registration time. They are not registered with the MCP server, do not appear in `listTools`, and do not enter the tool catalog as host-exposed entries.
- Host filtering is for context-window/token savings, not a security boundary. Do not model it as an authorization layer.

### Shared Selector And Metadata Semantics
- Consume Phase 121's central metadata registry and selector helpers rather than duplicating tool-name arrays.
- `doc-write` selection automatically includes `doc-read`; `doc-read` alone remains valid.
- `tier:read-only` and `tier:read-write` expansion must come from canonical metadata.
- Host eligibility filters after selector expansion. Unknown selectors or non-host-eligible explicit selections should fail config validation with actionable messages.
- Transitional legacy tools remain host-enabled by default until their removal gates. Their delegated eligibility follows behavior: `get_briefing` is read-only tier and `insert_doc_link` is read-write tier.

### Delegated Tool Exposure
- Delegated native tool assembly starts from the host-enabled set.
- Delegated purpose `tools` and `excluded_tools` then apply the same selector grammar, followed by purpose/model eligibility and delegated hard exclusions.
- A delegated purpose cannot regain a tool excluded from the host MCP surface.
- Delegated hard exclusions win over explicit delegated tool names.
- Existing purpose configs using current selector names should remain behavior-compatible unless they reference removed legacy tool names.

### Legacy Removed Tool Names
- Purpose config references to legacy removed tool names must hard-fail at startup/config validation.
- Failure messages must include helpful old-name to new-name suggestions from the metadata registry or a static legacy map.
- Do not silently rewrite aliases and do not leave backward-compatible aliases in place.

### Suspicious Category Combination Warnings
- Add startup warnings for suspicious but allowed category combinations, such as:
  - `system` disabled entirely.
  - `doc-read` disabled while `llm` is enabled with document reference workflows.
  - all data categories (`doc-read`, `memory`, `plugin`) disabled while `llm` is enabled.
  - everything disabled except `system`.
- These warnings must not block startup.

### Traceability And Tests
- The first implementation task must instantiate a phase-local traceability table mapping CFG-01..CFG-06 to unit, integration, E2E, directed scenario, and integration scenario coverage.
- Tests must be bundled with implementation, not deferred.
- Required coverage includes config unit tests, selector expansion tests, delegated intersection tests, server registration/listTools integration tests, E2E protocol host-filter config runs, and scenario coverage rows for host/delegated filtering.

### the agent's Discretion
- Exact module boundaries may follow existing repo patterns. Likely anchors are `src/config/loader.ts`, `src/mcp/server.ts`, `src/mcp/tool-catalog.ts`, `src/mcp/tool-metadata.ts`, `src/llm/tool-registry.ts`, and config-focused tests.
- The implementation may introduce a small resolved tool exposure type or helper module if that prevents config/server/LLM layers from drifting.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Broad per-tool JSON migrations remain Phases 123-127.
- Final removed-tool absence audit remains Phase 128.
- Runtime hot reload of host tool config is out of scope; restart-required behavior is accepted.
- Treat category filtering as surface/tool-list control only; do not disable underlying document, memory, plugin, scanner, or reference-resolution services.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | User can configure `host_mcp_tools.tools` and `host_mcp_tools.excluded_tools` with the same selector grammar used by delegated LLM purpose tools. | Add `HostMcpToolsSchema`, `hostMcpTools` config type, and shared selector validation/resolution over `TOOL_METADATA`. [VERIFIED: .planning/REQUIREMENTS.md; src/config/loader.ts; src/mcp/tool-metadata.ts] |
| CFG-02 | User can select tools by `tier:read-only`, `tier:read-write`, `category:<category>`, or explicit tool name, with `excluded_tools` as the final deny layer. | Reuse or extend `expandToolSelectors`; add strict validation because current unknown explicit selectors expand to `[]` silently. [VERIFIED: src/mcp/tool-metadata.ts] |
| CFG-03 | `doc-write` selection automatically includes the `doc-read` tool set, while `doc-read` remains valid as standalone read-only deployment. | Existing `expandToolSelectors(['category:doc-write'])` already expands both `doc-read` and `doc-write`; tests should add host-specific coverage. [VERIFIED: src/mcp/tool-metadata.ts; tests/unit/tool-metadata.test.ts] |
| CFG-04 | MCP `listTools` exposes only selected host-eligible tools, and delegated tool belts can only start from tools enabled on the host surface. | Gate before `server.registerTool`; pass or derive host-enabled catalog names into `assembleNativeToolRegistry`. [VERIFIED: src/mcp/server.ts; src/mcp/tool-catalog.ts; src/llm/tool-registry.ts; Context7 MCP SDK docs] |
| CFG-05 | Purpose config that references legacy removed tool names fails startup with helpful old-name to new-name suggestion. | Existing `getLegacyToolSuggestion` provides replacement messages, but `validateLlmConfig` currently accepts many transitional names through `TOOL_TIERS`; Phase 122 must hard-fail removed/merged names in purpose `tools`/`excluded_tools`. [VERIFIED: src/mcp/tool-metadata.ts; src/config/loader.ts] |
| CFG-06 | Suspicious category combinations produce startup warnings without refusing to start. | Add warning calculation after host exposure resolution and append to `_deprecationWarnings` or log via existing logger path. [VERIFIED: src/config/loader.ts; product requirements §3.10.4] |
</phase_requirements>

## Summary

Phase 122 should implement one resolved host exposure contract and make both registration and delegated tool assembly consume it. The current code already has the right foundation from Phase 121: `src/mcp/tool-metadata.ts` owns metadata, selector expansion, additive `doc-write` category behavior, hard-exclusion reasons, and legacy suggestions. [VERIFIED: src/mcp/tool-metadata.ts; .planning/phases/121-foundation-metadata-response-helpers-test-harness/121-01-SUMMARY.md]

The main planning risk is drift between three surfaces: YAML validation, MCP registration/catalog capture, and delegated native tool registry assembly. The clean path is to produce a single resolved exposure object from config plus metadata, then gate `registerTool` before the SDK sees filtered tools and intersect delegated assembly with the resulting host-enabled catalog. [VERIFIED: src/config/loader.ts; src/mcp/server.ts; src/mcp/tool-catalog.ts; src/llm/tool-registry.ts]

**Primary recommendation:** Add `src/mcp/tool-exposure.ts` with pure resolution/validation helpers, wire it through `loadConfig`, `createMcpServer`, and `assembleNativeToolRegistry`, and cover CFG-01..CFG-06 across unit, integration, E2E, directed, and YAML scenario layers. [VERIFIED: .planning/ROADMAP.md; product test plan §3.1 and §8.2]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| YAML parsing for `host_mcp_tools` | API / Backend | — | FlashQuery config is parsed at process startup before MCP registration. [VERIFIED: src/config/loader.ts] |
| Selector expansion and validation | API / Backend | — | Tool metadata and selection are server-side policy over registered MCP tool names. [VERIFIED: src/mcp/tool-metadata.ts] |
| Host MCP tool exposure | API / Backend | MCP SDK boundary | Tools are exposed by calling or skipping `server.registerTool`. [VERIFIED: src/mcp/server.ts; Context7 `/modelcontextprotocol/typescript-sdk`] |
| Delegated model native tool exposure | API / Backend | LLM provider adapter | `assembleNativeToolRegistry` builds provider-visible tool definitions from the native catalog and purpose config. [VERIFIED: src/llm/tool-registry.ts] |
| Warning diagnostics | API / Backend | CLI/logging | Config warnings are attached to loaded config and/or logged during startup. [VERIFIED: src/config/loader.ts] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; the local environment has Node v24.7.0. [VERIFIED: AGENTS.md; `node --version`]
- Use TypeScript strict mode and ESM; do not use CommonJS `require`. [VERIFIED: AGENTS.md; package.json]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md; package.json; npm registry]
- Use Zod for external input validation, including config and MCP params. [VERIFIED: AGENTS.md; src/config/loader.ts]
- MCP tool responses use `{ content: [{ type: "text", text: "..." }] }`; Phase 122 mostly changes tool listing/config, not broad response formats. [VERIFIED: AGENTS.md]
- MCP is stateless; do not implement server-side session state for this config feature. [VERIFIED: AGENTS.md]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Tests are Vitest for unit/integration/E2E, plus Python/YAML scenario suites. [VERIFIED: AGENTS.md; package.json; tests/scenarios]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | local v24.7.0, project requires >=20 | Runtime for FlashQuery CLI/MCP server | Existing project runtime and package engine. [VERIFIED: package.json; `node --version`] |
| TypeScript | package range `^6.0.2` | Strict typed implementation | Existing language and build stack. [VERIFIED: package.json] |
| `@modelcontextprotocol/sdk` | package range `^1.27.1`; npm latest `1.29.0` published 2026-03-30 | MCP server, transports, client E2E listTools/callTool | Existing SDK; `registerTool` is the SDK API for tool exposure. [VERIFIED: package.json; npm registry; Context7 `/modelcontextprotocol/typescript-sdk`] |
| Zod | package range `^4.3.6`; npm latest `4.4.3` published 2026-05-04 | YAML schema validation and MCP input schema conversion | Existing validation library; project already uses Zod in config and tool schemas. [VERIFIED: package.json; npm registry; src/config/loader.ts] |
| Vitest | package range `^4.1.1`; npm latest `4.1.6` published 2026-05-11 | Unit/integration/E2E tests | Existing test runner and scripts. [VERIFIED: package.json; npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `js-yaml` | package range `^4.1.1`; npm latest `4.1.1` published 2025-11-12 | Parse `flashquery.yml` before Zod validation | Keep existing loader flow; no new YAML parser. [VERIFIED: package.json; npm registry; src/config/loader.ts] |
| Python 3 | local 3.12.3 | Directed/YAML scenario runners | Scenario harnesses are Python-based. [VERIFIED: tests/scenarios; `python3 --version`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `src/mcp/tool-exposure.ts` helper | Put all logic in `src/config/loader.ts` | Loader-only implementation increases drift risk because server and delegated registry need the same resolved set. [VERIFIED: src/config/loader.ts; src/mcp/server.ts; src/llm/tool-registry.ts] |
| Skip-before-registration | Register then filter `listTools` | Product contract explicitly chose skip-before-registration to keep registered, catalog, and exposed sets aligned. [CITED: product requirements §3.10.1.1 and DAQ-1] |
| Metadata-derived selectors | Local arrays per consumer | Product contract and Phase 121 forbid duplicate tool-name arrays as source of truth. [VERIFIED: 122-CONTEXT.md; 121-01-SUMMARY.md] |

**Installation:** No new dependency is required. [VERIFIED: package.json; phase scope]

```bash
npm install
```

**Version verification:** `npm view @modelcontextprotocol/sdk version time --json`, `npm view zod version time --json`, `npm view vitest version time --json`, and `npm view js-yaml version time --json` were run on 2026-05-11. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
flashquery.yml
  |
  v
loadConfig() parses YAML + validates schemas
  |
  v
resolveHostToolExposure(config.hostMcpTools, TOOL_METADATA)
  |                         |
  |                         +--> validation errors: unknown selector, host-ineligible explicit tool, legacy removed name
  |                         +--> warnings: suspicious category combinations
  |
  +--> FlashQueryConfig.hostMcpTools / resolved exposure
  |
  v
createMcpServer()
  |
  v
wrapServerWithToolCatalog(server, hostEnabledToolNames)
  |
  +--> allowed tool: call SDK server.registerTool() and catalog.push()
  |
  +--> filtered tool: skip registration and skip catalog
  |
  v
MCP client listTools sees only registered host-enabled tools
  |
  v
call_model delegated assembly
  |
  v
assembleNativeToolRegistry(config, purpose, host-filtered catalog)
  |
  +--> expand purpose selectors
  +--> apply purpose excluded_tools
  +--> apply delegated eligibility and hard exclusions
  +--> emit provider-visible native tools
```

### Recommended Project Structure

```text
src/
├── config/
│   └── loader.ts              # host_mcp_tools schema, config typing, startup validation/warnings
├── mcp/
│   ├── tool-metadata.ts       # canonical metadata and primitive selector expansion
│   ├── tool-exposure.ts       # recommended new pure resolver/validator for host/delegated exposure
│   ├── tool-catalog.ts        # registration capture wrapper with optional host allow-list gate
│   └── server.ts              # creates resolved exposure and registers filtered tools
└── llm/
    └── tool-registry.ts       # delegated native assembly intersects with host-filtered catalog
```

### Pattern 1: Resolved Exposure Object

**What:** Resolve config once into `{ hostEnabledToolNames, warnings }`, store it on config or pass it to server assembly. [VERIFIED: 122-CONTEXT.md; src/config/loader.ts]

**When to use:** Use for both omitted default config and explicit `host_mcp_tools` config. [VERIFIED: product requirements §3.10.1.1]

**Example:**

```typescript
// Source: derived from src/mcp/tool-metadata.ts and product §3.10.1.1
export interface ResolvedToolExposure {
  hostEnabledToolNames: string[];
  warnings: string[];
}

export function resolveHostToolExposure(input: HostMcpToolsConfig | undefined): ResolvedToolExposure {
  const selected = input?.tools
    ? expandValidatedSelectors(input.tools, { hostEligible: true })
    : listToolMetadata({ hostEligible: true }).map((entry) => entry.name);
  const excluded = new Set(expandValidatedSelectors(input?.excludedTools ?? [], { hostEligible: true }));
  return {
    hostEnabledToolNames: selected.filter((name) => !excluded.has(name)),
    warnings: buildSuspiciousCategoryWarnings(selected, excluded),
  };
}
```

### Pattern 2: Gate Before SDK Registration

**What:** Skip filtered tools before `server.registerTool()` is called, so the SDK list and native catalog agree. [CITED: product requirements §3.10.1.1; Context7 `/modelcontextprotocol/typescript-sdk`]

**When to use:** Apply to all module registration functions because tools are currently registered in grouped modules from `createMcpServer`. [VERIFIED: src/mcp/server.ts]

**Example:**

```typescript
// Source: derived from src/mcp/tool-catalog.ts and Context7 MCP SDK registerTool docs
export function wrapServerWithToolCatalog(
  server: McpServer,
  options?: { hostEnabledToolNames?: ReadonlySet<string> }
): McpServer {
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = ((name, config, cb) => {
    if (options?.hostEnabledToolNames && !options.hostEnabledToolNames.has(name)) {
      return undefined as never;
    }
    getNativeToolCatalog(server).push({ name, description: config.description ?? '', inputSchema: config.inputSchema ?? {}, handler: cb as NativeToolHandler });
    return originalRegisterTool(name, config, cb as never);
  }) as McpServer['registerTool'];
  return server;
}
```

### Pattern 3: Delegated Assembly Starts From Host-Filtered Catalog

**What:** Keep delegated assembly catalog-driven so host-disabled tools cannot reappear in provider tools. [VERIFIED: src/llm/tool-registry.ts; product requirements §3.10.1.1]

**When to use:** Continue passing `getNativeToolCatalog(server)` into `assembleNativeToolRegistry`; after registration gating, that catalog is already host-filtered. [VERIFIED: src/mcp/server.ts; src/mcp/tool-catalog.ts]

**Example:**

```typescript
// Source: src/llm/tool-registry.ts pattern
const catalogNames = new Set(catalog.map((tool) => tool.name));
// Purpose tier/explicit expansion may name a host-disabled tool, but catalogNames excludes it,
// so diagnostics.unknown can report that the delegated purpose could not regain it.
```

### Anti-Patterns to Avoid

- **Register then hide:** Creates divergent registered/catalog/listTools surfaces. Use skip-before-registration. [CITED: product DAQ-1]
- **Duplicating tier/category arrays in config validation:** Phase 121 already made metadata the source of truth. Use `TOOL_METADATA` and selector helpers. [VERIFIED: 121-01-SUMMARY.md]
- **Treating host filtering as auth:** Product says this is token/context-window control, not a security boundary. [CITED: product requirements §3.10.1.1]
- **Silently expanding unknown selectors to empty:** Current `expandToolSelectors` returns `[]` for unknown explicit names; config validation must hard-fail actionable errors. [VERIFIED: src/mcp/tool-metadata.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom parser | Existing `js-yaml` + Zod loader | Loader already handles env expansion, legacy field rejection, and snake-to-camel conversion. [VERIFIED: src/config/loader.ts] |
| Tool schema/listing protocol | Custom MCP listTools response | `@modelcontextprotocol/sdk` `registerTool` and client `listTools` | SDK exposes registered tools to clients; filtered tools should never be registered. [CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Tool selector registry | Separate arrays per config/server/LLM | `TOOL_METADATA` and pure helper module | Prevents host/delegated drift and satisfies FND-01/FND-02 foundation. [VERIFIED: src/mcp/tool-metadata.ts; .planning/REQUIREMENTS.md] |
| JSON/path scenario assertions | New scenario parser | Phase 121 `parse_mcp_json`, `get_json_path`, `expect_json_*` | Scenario JSON assertion support already exists. [VERIFIED: 121-03-SUMMARY.md] |

**Key insight:** The hard part is not selector syntax; it is preserving one canonical enabled set across startup validation, registration, `listTools`, and delegated provider tools. [VERIFIED: product requirements §3.10.1.1; src/mcp/server.ts; src/llm/tool-registry.ts]

## Common Pitfalls

### Pitfall 1: Tier Helpers Are Currently Delegated-Shaped

**What goes wrong:** `getToolNamesByTier` currently returns the existing delegated tier order, not a general host tier expansion. [VERIFIED: src/mcp/tool-metadata.ts]  
**Why it happens:** Phase 121 preserved behavior compatibility for delegated tools and deferred full host selector rollout. [VERIFIED: 121-01-SUMMARY.md]  
**How to avoid:** Add host-aware tier expansion or refactor `expandToolSelectors` options so `tier:*` can expand against host eligibility and metadata tier without relying on `CURRENT_DELEGATED_TIER_ORDER`. [VERIFIED: src/mcp/tool-metadata.ts]  
**Warning signs:** `category:doc-read` and `tier:read-only` produce inconsistent host sets for host config. [VERIFIED: src/mcp/tool-metadata.ts]

### Pitfall 2: Legacy Names Are Still Accepted Today

**What goes wrong:** Existing purpose configs can reference names such as `create_document` or `search_documents` because current tier/native validation includes them. [VERIFIED: src/config/loader.ts; src/mcp/tool-metadata.ts]  
**Why it happens:** Transitional names are still real registered tools before later consolidation phases. [VERIFIED: product requirements §3; src/mcp/tool-metadata.ts]  
**How to avoid:** Phase 122 should distinguish "currently registered transitional tools allowed for host default" from "removed/merged legacy names invalid in purpose config after hard-cutover rules apply." [CITED: product DAQ-2; 122-CONTEXT.md]  
**Warning signs:** Config validation warns only for hard-excluded tools but does not throw for legacy replacement suggestions. [VERIFIED: src/config/loader.ts]

### Pitfall 3: Registration Gate Return Value

**What goes wrong:** Returning the wrong value from a skipped `registerTool` wrapper could break registration module expectations. [VERIFIED: src/mcp/tool-catalog.ts]  
**Why it happens:** The MCP SDK wrapper currently preserves `registerTool` exactly and returns `originalRegisterTool(...)`. [VERIFIED: src/mcp/tool-catalog.ts]  
**How to avoid:** Prefer a server wrapper gate that returns a harmless typed value and add unit/integration tests proving grouped registration functions do not throw when tools are skipped. [VERIFIED: src/mcp/server.ts; tests/unit/mcp-server-tools.test.ts]

### Pitfall 4: Warnings May Corrupt Stdio If Logged To Stdout

**What goes wrong:** Startup warnings written to stdout can corrupt stdio MCP JSON-RPC. [VERIFIED: src/config/loader.ts comments; src/mcp/server.ts]  
**Why it happens:** Stdio transport reserves stdout for protocol; existing code forces logger output to stderr unless file logging is configured. [VERIFIED: src/mcp/server.ts]  
**How to avoid:** Attach config warnings to `_deprecationWarnings` and let existing startup logging path emit via logger/stderr, or log after `initLogger` is configured. [VERIFIED: src/config/loader.ts; src/mcp/server.ts]

## Code Examples

### Host Config Schema Shape

```typescript
// Source: src/config/loader.ts conventions
const HostMcpToolsSchema = z.object({
  tools: z.array(z.string()).optional(),
  excluded_tools: z.array(z.string()).optional(),
}).strict().optional();
```

### Selector Validation Strategy

```typescript
// Source: src/mcp/tool-metadata.ts primitives
for (const selector of selectors) {
  const expanded = expandToolSelectors([selector], { hostEligible: true });
  if (expanded.length === 0) {
    const suggestion = getLegacyToolSuggestion(selector);
    throw new Error(suggestion?.message ?? `Unknown or unavailable host MCP tool selector '${selector}'.`);
  }
}
```

### E2E Host-Filtered listTools Pattern

```typescript
// Source: tests/e2e/protocol.test.ts + Context7 client listTools docs
const { tools } = await client.listTools();
const toolNames = tools.map((tool) => tool.name);
expect(toolNames).toContain('call_model');
expect(toolNames).not.toContain('save_memory');
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Delegated native tiers stored as hardcoded arrays in `src/llm/tool-registry.ts` | Metadata-derived tier constants from `src/mcp/tool-metadata.ts` | Phase 121 on 2026-05-11 | Phase 122 should not reintroduce parallel arrays. [VERIFIED: 121-01-SUMMARY.md; src/llm/tool-registry.ts] |
| All MCP tools registered unconditionally | Phase 122 must skip host-disabled tools at registration | Required by Phase 122 | `listTools` and native catalog must shrink together. [VERIFIED: src/mcp/server.ts; 122-CONTEXT.md] |
| No top-level `host_mcp_tools` config | Add top-level `host_mcp_tools.tools` and `host_mcp_tools.excluded_tools` | Phase 122 | Config defaults preserve all host-eligible tools. [VERIFIED: src/config/loader.ts; 122-CONTEXT.md] |
| Scenario assertions mostly text/substrings | JSON path assertions available in directed and YAML scenario harnesses | Phase 121 | Host/delegated filtering scenarios can assert parsed MCP JSON where relevant. [VERIFIED: 121-03-SUMMARY.md] |

**Deprecated/outdated:**
- Register-then-filter `listTools`: rejected by DAQ-1. [CITED: product requirements DAQ-1]
- Backward-compatible aliases for removed tool names: explicitly out of scope. [VERIFIED: .planning/REQUIREMENTS.md; 122-CONTEXT.md]
- Multi-server split: replaced by `host_mcp_tools` in one server. [VERIFIED: .planning/REQUIREMENTS.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|

All claims in this research were verified or cited in this session — no user confirmation needed.

## Open Questions (RESOLVED)

1. **Should warning storage use `_deprecationWarnings` or a new `_startupWarnings` key?**
   - What we know: `getDeprecationWarnings` reads `_deprecationWarnings` and loader already uses that mechanism for `.yaml` extension warnings. [VERIFIED: src/config/loader.ts]
   - What's unclear: Product names these as suspicious category warnings, not deprecation warnings. [CITED: product requirements §3.10.4]
   - Resolution: Plan 01 directs the executor to attach resolved exposure warnings without raw stdout writes and allows either appending to `_deprecationWarnings` or exporting a semantic startup-warning accessor. This is sufficient for execution because CFG-06 requires warning behavior, not a specific private storage key.
   - Planner decision: Prefer `getStartupWarnings(config)` or `getToolExposureWarnings(config)` if the change is small; otherwise append to `_deprecationWarnings` while preserving existing extension warnings.

2. **How strict should Phase 122 be about future final tool names not implemented yet?**
   - What we know: metadata contains future final tools with `hostEligible: false` and `delegatedEligible: false`. [VERIFIED: src/mcp/tool-metadata.ts]
   - What's unclear: A user selecting `write_document` before Phase 124 should get an actionable unavailable-tool error, not silent omission. [VERIFIED: 122-CONTEXT.md]
   - Resolution: Plan 01 requires validation errors for unknown selectors, future host-ineligible tools such as `write_document`, and dead tools such as `list_projects`. Current registered tools whose metadata status is `removed` but `hostEligible: true` remain valid host selectors until their later removal phases, because Phase 122 must preserve today's default all-tools-enabled host surface.
   - Planner decision: Explicit future/unavailable host selections must fail config validation with actionable "not available in this build" style messaging and replacement guidance where present. Explicit current host-eligible removed-status selectors such as `create_document` may be used in `host_mcp_tools` while they remain registered, but should still hard-fail in delegated purpose config per CFG-05. They must not silently expand to an empty set.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, tests, MCP server | yes | v24.7.0 | None needed; project requires >=20. [VERIFIED: `node --version`; package.json] |
| npm | Dependency/test scripts, npm version checks | yes | 11.5.1 | None needed. [VERIFIED: `npm --version`] |
| Python 3 | Scenario runners | yes | 3.12.3 | Use `python3`, not `python`. [VERIFIED: `python3 --version`; 121-03-SUMMARY.md] |
| Supabase credentials | Integration/E2E tests that hit DB | conditional | `.env.test` required | Existing helpers skip when missing/incomplete. [VERIFIED: AGENTS.md; tests/helpers/test-env.ts referenced by tests] |
| Context7 docs | MCP SDK API confirmation | yes | MCP library docs available | Use official SDK docs/web if needed. [VERIFIED: Context7 query] |

**Missing dependencies with no fallback:** None identified for planning. [VERIFIED: local command probes]

**Missing dependencies with fallback:** Supabase may be absent in local env; existing test helpers skip integration/E2E cases when `.env.test` is incomplete. [VERIFIED: AGENTS.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest package range `^4.1.1`, npm latest `4.1.6`; Python 3.12.3 scenario runners. [VERIFIED: package.json; npm registry; `python3 --version`] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: package.json] |
| Quick run command | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/config.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/mcp-server-tools.test.ts` [VERIFIED: package.json; test files] |
| Full suite command | `npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/run_suite.py --managed foundation && python3 tests/scenarios/integration/run_integration.py --managed foundation && npm run build` [VERIFIED: package.json; 121-03-SUMMARY.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CFG-01 | Parse and validate `host_mcp_tools.tools` / `excluded_tools` with shared grammar | unit | `npm test -- tests/unit/config.test.ts tests/unit/tool-metadata.test.ts` | yes, extend files [VERIFIED: tests/unit/config.test.ts; tests/unit/tool-metadata.test.ts] |
| CFG-02 | Tier/category/name selection and final exclusions | unit | `npm test -- tests/unit/tool-metadata.test.ts` | yes, extend file [VERIFIED: tests/unit/tool-metadata.test.ts] |
| CFG-03 | `doc-write` implies `doc-read`; `doc-read` alone valid | unit/integration | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts` | yes, extend files [VERIFIED: tests/unit/mcp-server-tools.test.ts] |
| CFG-04 | Host `listTools` filtered; delegated tool belt starts from host set | unit/e2e | `npm test -- tests/unit/llm-tool-registry.test.ts tests/unit/mcp-server-tools.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes, extend files [VERIFIED: tests/e2e/protocol.test.ts] |
| CFG-05 | Legacy removed purpose tool names hard-fail with suggestions | unit/integration | `npm test -- tests/unit/llm-config.test.ts tests/unit/config.test.ts && npm run test:integration -- tests/integration/llm-config-sync.test.ts` | yes, extend files [VERIFIED: tests/unit/llm-config.test.ts; tests/integration/llm-config-sync.test.ts] |
| CFG-06 | Suspicious category combos warn without blocking startup | unit/e2e or integration | `npm test -- tests/unit/config.test.ts` | yes, extend file [VERIFIED: tests/unit/config.test.ts] |

### Sampling Rate

- **Per task commit:** Run the focused unit test file(s) touched by the task. [VERIFIED: package.json]
- **Per wave merge:** Run config, metadata, MCP registration, delegated registry, and protocol tests listed above. [VERIFIED: product test plan §3.1]
- **Phase gate:** Run focused unit/integration/E2E/scenario checks plus `npm run build`; run broader `npm test` if time permits. [VERIFIED: .planning/ROADMAP.md; package.json]

### Wave 0 Gaps

- [ ] Add phase traceability table before coding, likely in first PLAN/task artifact. [VERIFIED: 122-CONTEXT.md; product test plan §3.1]
- [ ] Add or extend `tests/unit/tool-exposure.test.ts` if new `src/mcp/tool-exposure.ts` is created. [VERIFIED: recommended structure]
- [ ] Add host-filtered config fixture for E2E protocol run, likely under `tests/fixtures/`. [VERIFIED: tests/e2e/protocol.test.ts; tests/helpers/mcp-server-fixture.js should be inspected by planner]
- [ ] Add directed coverage rows `D-foundation-tools-*` and YAML integration rows `INT-foundation-tools-*` before scenario files. [VERIFIED: product test plan §3.1; tests/scenarios coverage ledgers]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 122 must not change MCP auth/token flow. [VERIFIED: src/mcp/server.ts; 122-CONTEXT.md] |
| V3 Session Management | no | MCP remains stateless for this feature. [VERIFIED: AGENTS.md] |
| V4 Access Control | no as authorization; yes as exposure control | Treat host filtering as non-security tool-list reduction only. [CITED: product requirements §3.10.1.1] |
| V5 Input Validation | yes | Zod schemas plus strict selector validation against metadata. [VERIFIED: src/config/loader.ts; src/mcp/tool-metadata.ts] |
| V6 Cryptography | no | No crypto changes in scope. [VERIFIED: 122-CONTEXT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Config confusion hides a tool but delegated model still receives it | Elevation of privilege / policy bypass | Use host-filtered catalog as delegated assembly input and test host `excluded_tools` wins over delegated `tools`. [CITED: product test plan §8.2] |
| Treating exposure filtering as authorization | Spoofing / authorization design error | Document and test it as context-window control only; do not add auth semantics. [CITED: product requirements §3.10.1.1] |
| Stdio protocol corruption from startup warnings | Denial of service | Emit warnings through logger/stderr or config warning accessors, not raw stdout. [VERIFIED: src/mcp/server.ts; src/config/loader.ts] |
| Unknown selectors silently ignored | Tampering / misconfiguration | Hard-fail config validation with actionable messages and suggestions. [VERIFIED: 122-CONTEXT.md; src/mcp/tool-metadata.ts] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/122-host-tool-exposure-config/122-CONTEXT.md` - locked decisions, phase scope, required coverage. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - CFG-01..CFG-06 text and milestone traceability. [VERIFIED: file read]
- `.planning/ROADMAP.md` - phase boundary, dependency on Phase 121, coverage obligations. [VERIFIED: file read]
- `.planning/STATE.md` - Phase 121 decisions and v3.3 constraints. [VERIFIED: file read]
- Phase 121 handoffs: `121-CONTEXT.md`, `121-PATTERNS.md`, `121-01-SUMMARY.md`, `121-02-SUMMARY.md`, `121-03-SUMMARY.md`. [VERIFIED: file read]
- Product requirements doc - XC-6, §3.10.1.1, §3.10.2, §3.10.4, DAQ-1..DAQ-3. [VERIFIED: file read]
- Product test plan - §3.1 traceability, §8.2 host filtering/delegated filtering requirements. [VERIFIED: file read]
- Source files: `src/mcp/tool-metadata.ts`, `src/config/loader.ts`, `src/mcp/server.ts`, `src/mcp/tool-catalog.ts`, `src/llm/tool-registry.ts`. [VERIFIED: file read]
- Test files: `tests/unit/tool-metadata.test.ts`, `tests/unit/llm-tool-registry.test.ts`, `tests/unit/mcp-server-tools.test.ts`, `tests/unit/config.test.ts`, `tests/unit/llm-config.test.ts`, `tests/e2e/protocol.test.ts`, scenario coverage ledgers. [VERIFIED: file read]
- Context7 `/modelcontextprotocol/typescript-sdk` - `server.registerTool` and `client.listTools` docs/examples. [CITED: Context7]
- npm registry version checks for `@modelcontextprotocol/sdk`, `zod`, `vitest`, and `js-yaml`. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- None. [VERIFIED: research process]

### Tertiary (LOW confidence)

- None. [VERIFIED: research process]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against package.json, npm registry, local runtime probes, and Context7 docs. [VERIFIED: package.json; npm registry; Context7]
- Architecture: HIGH - verified against current source and locked product decisions. [VERIFIED: source files; 122-CONTEXT.md]
- Pitfalls: HIGH - derived from current implementation details and explicit Phase 122 deferred work. [VERIFIED: src/mcp/tool-metadata.ts; src/config/loader.ts; Phase 121 summaries]

**Research date:** 2026-05-11  
**Valid until:** 2026-06-10 for project-local architecture; re-check npm/SDK docs if dependency versions change before implementation.
