# Phase 119: Discovery Diagnostics & Help Resolver - Research

**Researched:** 2026-05-06  
**Domain:** FlashQuery `call_model` MCP discovery/help resolver diagnostics  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Scope Lock
- Implement requirements `DISC-01`, `DISC-02`, `DISC-03`, `DISC-04`, and `VAL-119`.
- Preserve discovery resolvers outside `CallModelEnvelope`; discovery calls return raw discovery/help JSON and ignore `return_messages`, `name`, and `messages`.
- Do not build UI, web surfaces, Mode 3 cooperative loops, MCP Broker support, audit document writes, or Phase 120 cross-phase validation.
- Do not change Phase 112-118 behavior except where needed to expose diagnostics already produced by those systems.

### list_purposes Diagnostics
- `list_purposes` must expose native tool and template-tool diagnostics for each purpose.
- Include usable native tools, template tools, template collisions, dangling template paths, and public diagnostics in stable machine-readable fields.
- Empty diagnostic arrays must be present as empty arrays where the contract says they exist, not omitted.
- Discovery output must help a caller understand why a purpose can or cannot run Mode 2 before making a `resolver: "purpose"` call.

### list_models Diagnostics
- `list_models` must expose structured model capability diagnostics.
- Unknown capabilities and explicitly false capabilities must produce distinct explanations: unknown means undeclared and should tell users what to configure; false means declared unsupported.
- Preserve existing model discovery fields and add capability diagnostics additively.

### Discovery Search
- `resolver: "search"` must remain usable without `messages`.
- Search must include relevant model and purpose discovery metadata, including capability/tool/template/help-related terms.
- Search should return empty arrays for non-matching categories rather than failing or requiring LLM input.

### Help Resolver
- Add a v1 `help` discovery resolver.
- Help must describe Mode 1, Mode 2, references, templates, tools, guardrails, errors, and discovery usage in a machine-readable shape.
- The accepted stable top-level key order is: `summary`, `reference_syntax`, `template_bindings`, `modes`, `envelope`, `errors`, `discovery`, `examples`.
- Help must not call an LLM, write usage rows, or produce a `CallModelEnvelope`.

### Test Strategy
- Ship runnable unit and directed scenario tests in this phase.
- Unit tests should cover discovery/help response builders and drift-sensitive contracts.
- Directed scenarios should validate public MCP behavior through `call_model` discovery resolvers.
- Phase 120 remains for cross-phase ATL validation and final coverage matrix closure, not for deferring Phase 119 tests.

### the agent's Discretion
- Downstream implementation agents may choose helper extraction boundaries, exact TypeScript type names, and how much existing `src/mcp/tools/llm.ts` code to factor out, provided the public contract and focused tests stay clear.
- Agents may add integration coverage if it is cheaper than mocking a diagnostic path, but this phase must at minimum include unit and directed scenario validation.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Cross-phase ATL happy-path and coverage-matrix closure remains Phase 120.
- Documentation outside the discovery/help resolver can be updated later unless a small README note is required by the implementation plan.
- Audit document writes, MCP Broker, Mode 3, model-initiated response references, and path-scoped delegated writes remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | `list_purposes` exposes native tool and template-tool diagnostics, including usable tools and template collision details. | Use existing `assembleNativeToolRegistry`, `assembleTemplateToolRegistry`, and `mergeModelVisibleToolRegistries` diagnostics in discovery response builders. [VERIFIED: src/llm/tool-registry.ts, src/llm/template-tools.ts, src/mcp/tools/llm.ts] |
| DISC-02 | `list_models` exposes structured capability diagnostics with clear unknown-vs-false explanations. | Reuse `modelCapabilitiesWithDefaults` semantics and surface per-capability diagnostics additively in `list_models`. [VERIFIED: src/llm/capabilities.ts] |
| DISC-03 | `search` continues to provide discovery over model and purpose metadata without requiring messages. | Existing discovery short-circuit already accepts `search` without `messages`; extend its searchable text to include capability/tool/template/help terms. [VERIFIED: src/mcp/tools/llm.ts] |
| DISC-04 | A v1 `help` resolver describes supported `call_model` modes, references, templates, tools, loop controls, and discovery usage. | Add `help` to the resolver enum and discovery branch, returning stable ordered raw JSON from a helper module. [CITED: Agentic-LLM-Tool-Loop.md CG-9] |
| VAL-119 | Phase 119 ships runnable unit and directed scenario tests validating discovery diagnostics, structured capability reporting, discovery search behavior, and the `help` resolver. | Implement ATL-U-16 plus public directed scenario coverage for help/discovery behavior. [CITED: ATL Test Plan §5 ATL-U-16, §6 ATL-DS-15] |
</phase_requirements>

## Summary

Phase 119 should be planned as an additive discovery-contract phase, not an agent-loop rewrite. The current `call_model` handler already short-circuits `list_models`, `list_purposes`, and `search` before reference hydration, LLM calls, trace snapshots, and usage writes; `help` should join that same branch and return raw JSON. [VERIFIED: src/mcp/tools/llm.ts]

The highest-risk planning point is response drift: Phase 118 already assembled template diagnostics, native registry diagnostics, collision detection, and capability admission logic, but discovery responses do not yet expose all of that in stable machine-readable fields. [VERIFIED: src/llm/template-tools.ts, src/llm/tool-registry.ts, src/llm/capabilities.ts] The planner should allocate a small helper extraction so `src/mcp/tools/llm.ts` does not accumulate more inline shape-building logic. [VERIFIED: .planning/phases/119-discovery-diagnostics-help-resolver/119-CONTEXT.md]

**Primary recommendation:** Implement `src/llm/discovery-content.ts` plus `src/llm/help-content.ts`, keep resolver dispatch in `src/mcp/tools/llm.ts`, and test raw JSON contracts through `tests/unit/llm-tool.test.ts` plus a new directed `test_call_model_help_resolver.py`. [VERIFIED: src/mcp/tools/llm.ts, tests/unit/llm-tool.test.ts, tests/scenarios/directed/testcases/test_discovery_resolvers.py]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, ESM modules, `@modelcontextprotocol/sdk`, Supabase clients, `tsup`, `tsx`, and Vitest. [VERIFIED: AGENTS.md, package.json]
- FlashQuery is CLI + MCP only; do not plan a web UI. [VERIFIED: AGENTS.md]
- Use `async/await`; module boundaries should return typed errors rather than thrown exceptions where applicable. [VERIFIED: AGENTS.md]
- MCP tool handlers must catch failures internally and return `{ content: [{ type: "text", text: "..." }], isError: true }` on failure. [VERIFIED: AGENTS.md]
- Use Zod for external input validation, including MCP params. [VERIFIED: AGENTS.md]
- Do not use CommonJS `require`; do not use `@modelcontextprotocol/server`; use `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md, package.json]
- Discovery/help responses must keep the existing MCP text-content response convention. [VERIFIED: AGENTS.md, src/mcp/tools/llm.ts]
- Unit tests live in `tests/unit/*.test.ts`; directed scenarios live in `tests/scenarios/directed/testcases/*.py`; unit command is `npm test`; directed scenarios run with `python3 ... --managed`. [VERIFIED: AGENTS.md, package.json, tests/scenarios/directed/testcases/test_discovery_resolvers.py]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| MCP resolver schema and dispatch | API / Backend | CLI process | `call_model` is an MCP tool registered in the server process and validated with Zod. [VERIFIED: src/mcp/tools/llm.ts] |
| Model capability diagnostics | API / Backend | Config loader | Capabilities are parsed from config, defaulted by provider profile, and interpreted by backend admission helpers. [VERIFIED: src/config/loader.ts, src/llm/capabilities.ts] |
| Purpose native/tool/template diagnostics | API / Backend | Vault storage | Native diagnostics come from registered MCP tool catalog; template diagnostics also read vault markdown/frontmatter. [VERIFIED: src/llm/tool-registry.ts, src/llm/template-tools.ts] |
| Discovery search | API / Backend | Config/vault metadata | Search is a backend projection over configured models/purposes and template diagnostics, not an LLM request. [VERIFIED: src/mcp/tools/llm.ts] |
| Help resolver | API / Backend | — | Help is static protocol documentation plus minimal configured/unconfigured summary and must not call LLM/storage writes. [CITED: Agentic-LLM-Tool-Loop.md CG-9] |
| Unit and directed validation | Test harness | CLI/MCP server | Unit tests capture handlers directly; directed scenarios call public MCP behavior via managed server. [VERIFIED: tests/unit/llm-tool.test.ts, tests/scenarios/directed/testcases/test_discovery_resolvers.py] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | Installed `v24.7.0`; project requires `>=20` | Runtime for CLI/MCP server | Matches project engine requirement and current local environment. [VERIFIED: node --version, package.json] |
| TypeScript | package `^6.0.2`; registry latest `6.0.3`, modified 2026-04-16 | Strict typed implementation | Existing repo is TypeScript ESM strict mode. [VERIFIED: package.json, npm registry] |
| `@modelcontextprotocol/sdk` | package `^1.27.1`; registry latest `1.29.0`, modified 2026-03-30 | MCP server/tool registration | Official SDK docs show `server.registerTool` with Zod `inputSchema` and `content`/`isError` result shape. [CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Zod | package `^4.3.6`; registry latest `4.4.3`, modified 2026-05-04 | MCP/config validation | Existing schemas use Zod for resolver enum and model/purpose config. [VERIFIED: src/mcp/tools/llm.ts, src/config/loader.ts, npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | package `^4.1.1`; registry latest `4.1.5`, modified 2026-05-05 | Unit/integration/E2E test runner | Use for `tests/unit/llm-tool.test.ts` and helper module tests. [VERIFIED: package.json, tests/config/vitest.unit.config.ts, npm registry] |
| `tsx` | package/latest `4.21.0`, modified 2025-11-30 | Dev server/runtime TypeScript execution | Existing `npm run dev` and test server lifecycle use it. [VERIFIED: package.json, npm registry] |
| `tsup` | package/latest `8.5.1`, modified 2025-11-12 | Production ESM build | Use `npm run build` as phase gate. [VERIFIED: package.json, npm registry] |
| Python 3 | Installed `3.12.3` | Directed scenario tests | Existing directed tests are Python scripts run with `--managed`. [VERIFIED: python3 --version, tests/scenarios/directed/testcases/test_discovery_resolvers.py] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Helper modules under `src/llm/` | Keep all shape building inline in `src/mcp/tools/llm.ts` | Inline is faster initially but makes drift tests and response reuse harder; CONTEXT explicitly allows helper extraction. [VERIFIED: 119-CONTEXT.md, src/mcp/tools/llm.ts] |
| Text-only `help` response | Raw structured JSON response | Text-only would match human reading but fails the stable key-order machine-readable contract. [VERIFIED: 119-CONTEXT.md] |
| `structuredContent` MCP output | Existing text JSON payload | SDK supports `structuredContent`, but FlashQuery AGENTS and current tools standardize on text content; changing this would widen public behavior unnecessarily. [CITED: Context7 `/modelcontextprotocol/typescript-sdk`; VERIFIED: AGENTS.md] |

**Installation:** No new packages are required. [VERIFIED: package.json, source inspection]

```bash
npm install
```

## Architecture Patterns

### System Architecture Diagram

```text
MCP client
  |
  v
call_model tool params
  |
  v
Zod resolver enum validation
  |
  +--> resolver = help
  |      -> buildHelpResponse(config/client state)
  |      -> raw JSON text, no LLM, no usage row
  |
  +--> resolver = list_models
  |      -> modelToResponse + capability diagnostics
  |      -> raw JSON text
  |
  +--> resolver = list_purposes
  |      -> native registry diagnostics
  |      -> template registry diagnostics
  |      -> raw JSON text
  |
  +--> resolver = search
  |      -> indexed model/purpose/help metadata
  |      -> matching arrays, empty arrays on no match
  |
  +--> resolver = model/purpose
         -> message/name validation
         -> reference hydration
         -> Mode 1 or Mode 2 execution
         -> CallModelEnvelope
```

This flow matches the existing short-circuit structure for discovery resolvers and keeps model/purpose execution unchanged except for shared helper reuse. [VERIFIED: src/mcp/tools/llm.ts]

### Recommended Project Structure

```text
src/
├── llm/
│   ├── discovery-content.ts  # list_models/list_purposes/search response helpers
│   ├── help-content.ts       # stable protocol help response builder
│   └── capabilities.ts       # existing capability defaults/diagnostics source
├── mcp/tools/
│   └── llm.ts                # resolver enum and branch dispatch only
tests/
├── unit/
│   └── llm-tool.test.ts      # handler contract and builder drift tests
└── scenarios/directed/testcases/
    └── test_call_model_help_resolver.py
```

This keeps helpers near the LLM domain while preserving the MCP response convention in `llm.ts`. [VERIFIED: project structure, 119-CONTEXT.md]

### Pattern 1: Discovery Short-Circuit Before Model Path

**What:** Dispatch `help`, `list_models`, `list_purposes`, and `search` before `name`/`messages` enforcement, reference parsing, trace pre-snapshot, client calls, and usage recording. [VERIFIED: src/mcp/tools/llm.ts]

**When to use:** Every discovery/help resolver. [VERIFIED: 119-CONTEXT.md]

**Example:**

```typescript
// Source: src/mcp/tools/llm.ts existing pattern, plus Phase 119 resolver addition.
if (isDiscoveryResolver(params.resolver)) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(buildDiscoveryResponse(params, config)) }],
  };
}
```

### Pattern 2: Stable Builder Functions With Drift Tests

**What:** Put help and discovery response shapes behind pure or mostly-pure functions so unit tests can assert key order, empty arrays, resolver lists, and diagnostic text without running a full server. [VERIFIED: tests/unit/llm-tool.test.ts patterns; CITED: ATL Test Plan ATL-U-16]

**When to use:** `help` top-level key order, `list_models.capability_diagnostics`, `list_purposes.usage.resolvers`, and search metadata indexing. [VERIFIED: 119-CONTEXT.md]

**Example:**

```typescript
// Source: ATL Test Plan ATL-U-16 contract.
expect(Object.keys(buildHelpResponse(config))).toEqual([
  'summary',
  'reference_syntax',
  'template_bindings',
  'modes',
  'envelope',
  'errors',
  'discovery',
  'examples',
]);
```

### Pattern 3: Additive Public Diagnostics

**What:** Preserve existing fields and add nested diagnostics rather than renaming existing discovery keys. [VERIFIED: 119-CONTEXT.md, src/mcp/tools/llm.ts]

**When to use:** `list_models` and `list_purposes`, because directed coverage already exists for prior discovery fields and Phase 118 template fields. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]

**Example:**

```typescript
// Source: src/llm/capabilities.ts unknown-vs-false semantics.
{
  capabilities: { tool_calling: false },
  capability_diagnostics: [
    {
      capability: 'tool_calling',
      state: 'declared_unsupported',
      message: "declared unsupported: model 'x' lacks tool_calling"
    }
  ]
}
```

### Anti-Patterns to Avoid

- **Wrapping discovery in `CallModelEnvelope`:** Discovery/help must remain raw JSON and ignore `return_messages`. [VERIFIED: 119-CONTEXT.md]
- **Dropping empty arrays:** Empty diagnostic arrays are part of the contract and must appear where specified. [VERIFIED: 119-CONTEXT.md]
- **Inferring capabilities from legacy tags:** Old free-form capability arrays are migrated to tags and must not imply behavior. [VERIFIED: src/config/loader.ts, Agentic-LLM-Tool-Loop.md OQ-27]
- **Calling LLM or writing usage for help/search/list:** Discovery must stay side-effect-light and no-LLM. [VERIFIED: src/mcp/tools/llm.ts; CITED: Agentic-LLM-Tool-Loop.md CG-9]
- **Duplicating template discovery logic:** Reuse `assembleTemplateToolRegistry`; it already reads frontmatter, validates exposure, emits warnings, conflicts, and dangling paths. [VERIFIED: src/llm/template-tools.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP tool registration/validation | Custom JSON schema parser or handler wrapper | `McpServer.registerTool` with Zod `inputSchema` | SDK and repo already use this pattern. [CITED: Context7 `/modelcontextprotocol/typescript-sdk`; VERIFIED: src/mcp/tools/llm.ts] |
| Capability defaulting/diagnostic semantics | New capability rules in discovery code | `modelCapabilitiesWithDefaults` plus a small exported diagnostic helper | Existing helper encodes OpenAI defaults and unknown-vs-false behavior. [VERIFIED: src/llm/capabilities.ts] |
| Native tool allowlist diagnostics | Manual tool-name expansion in `list_purposes` | `assembleNativeToolRegistry` | Existing registry handles tiers, exclusions, hard exclusions, unknown names, and provider schema generation. [VERIFIED: src/llm/tool-registry.ts] |
| Template-tool diagnostics | Fresh vault scanner in `llm.ts` | `assembleTemplateToolRegistry` | Existing registry handles fresh reads, generated names, params, conflicts, and dangling paths. [VERIFIED: src/llm/template-tools.ts] |
| Directed scenario framework | Bespoke HTTP runner | Existing `FQCServer`, `FQCClient`, `TestRun` helpers | Current directed tests use these helpers and `--managed` mode. [VERIFIED: tests/scenarios/directed/testcases/test_discovery_resolvers.py] |

**Key insight:** Phase 119 should expose existing internals as stable diagnostics; rebuilding registry/capability/search logic creates drift risk without adding capability. [VERIFIED: Phase 118 summary, source inspection]

## Common Pitfalls

### Pitfall 1: Help Blocked By NullLlmClient Guard

**What goes wrong:** Existing `llm.ts` returns an unconfigured error before discovery dispatch when `llmClient` is `NullLlmClient`. [VERIFIED: src/mcp/tools/llm.ts]

**Why it happens:** The unconfigured guard predates the required help behavior. [VERIFIED: src/mcp/tools/llm.ts]

**How to avoid:** Let `resolver: "help"` run even when `llmClient` is absent/null, with a summary beginning "FlashQuery LLM is not configured" and all protocol sections populated. [CITED: ATL Test Plan ATL-U-16]

**Warning signs:** `resolver=help` returns `isError: true`, or all discovery resolvers are unintentionally allowed on null client without a deliberate contract update. [VERIFIED: ATL Test Plan ATL-U-16, src/mcp/tools/llm.ts]

### Pitfall 2: Search Only Matches Name/Description

**What goes wrong:** Current search only checks model/purpose name and description, so capability or template diagnostic queries can miss relevant results. [VERIFIED: src/mcp/tools/llm.ts]

**Why it happens:** Existing search predates structured capabilities and template-tool diagnostics. [VERIFIED: requirements history]

**How to avoid:** Build a searchable metadata string from model capabilities/tags and purpose native/template diagnostics, including `tool_calling`, `usage_on_tool_calls`, `template_tools`, `template_tool_conflicts`, `dangling_template_paths`, and `help`. [VERIFIED: 119-CONTEXT.md]

**Warning signs:** `resolver=search` for `template_tools` or `tool_calling` returns empty results despite configured matching metadata. [VERIFIED: 119-CONTEXT.md]

### Pitfall 3: Capability Diagnostics Collapse Unknown And False

**What goes wrong:** Discovery says only "unsupported" and loses whether the user omitted config or explicitly declared false. [VERIFIED: 119-CONTEXT.md]

**Why it happens:** Both states fail Mode 2 admission, but they need different remediation. [CITED: Agentic-LLM-Tool-Loop.md OQ-27]

**How to avoid:** Emit machine-readable `state` values such as `supported`, `unknown_declaration`, and `declared_unsupported`, plus remediation only for unknown. [VERIFIED: src/llm/capabilities.ts semantics]

**Warning signs:** Help/list_models text never includes `capabilities.<key>: true|false` for omitted keys, or says to configure a key that was explicitly false. [VERIFIED: src/llm/capabilities.ts]

### Pitfall 4: Native Diagnostics Omitted From `list_purposes`

**What goes wrong:** Template diagnostics appear but native usable/hard-excluded/unknown/excluded information stays hidden. [VERIFIED: current `purposeToResponse` only exposes template diagnostics in src/mcp/tools/llm.ts]

**Why it happens:** Native tool assembly currently happens on purpose invocation, not purpose listing. [VERIFIED: src/mcp/tools/llm.ts]

**How to avoid:** Call `assembleNativeToolRegistry` during purpose response building with the captured native tool catalog and strict-mode setting, then expose stable public native fields. [VERIFIED: src/llm/tool-registry.ts, src/mcp/tools/llm.ts]

**Warning signs:** A purpose configured with `tools: ["tier:read-only"]` cannot be inspected for actual usable tool names before invocation. [VERIFIED: requirements DISC-01]

### Pitfall 5: Help Text Drifts From Runtime Constants

**What goes wrong:** `help.errors` or resolver lists document values that runtime no longer accepts. [CITED: Agentic-LLM-Tool-Loop.md CG-9]

**Why it happens:** Static help content often duplicates enums. [ASSUMED]

**How to avoid:** Export resolver lists/error-code lists from one module or test `help.discovery.resolvers` against the resolver enum list and `help.errors` against runtime error/reason constants. [CITED: ATL Test Plan ATL-U-16]

**Warning signs:** Adding `help` to the enum but forgetting `list_purposes.usage.resolvers`, or changing a reference failure reason without a help test failure. [CITED: ATL Test Plan ATL-U-16]

## Code Examples

### MCP Tool Response Shape

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk; matches FlashQuery AGENTS.md.
return {
  content: [{ type: 'text', text: JSON.stringify(output) }],
};
```

### Capability Diagnostic Builder

```typescript
// Source: src/llm/capabilities.ts semantics.
const state = value === false ? 'declared_unsupported' : 'unknown_declaration';
const remediation = value === undefined
  ? `declare capabilities.${capability}: true|false on this model`
  : undefined;
```

### Purpose Discovery Composition

```typescript
// Source: src/mcp/tools/llm.ts + src/llm/template-tools.ts + src/llm/tool-registry.ts.
const native = assembleNativeToolRegistry(config, purpose.name, nativeToolCatalog, { strictTools });
const template = await assembleTemplateToolRegistry({ config, purposeName: purpose.name, runtimeBindings, strictTools });
const merged = mergeModelVisibleToolRegistries({ native, template });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Discovery only listed basic model/purpose metadata | Discovery must expose model capability diagnostics plus native/template tool diagnostics | v3.2 Phase 119, after Phase 118 completion on 2026-05-06 | Planners should add diagnostics without changing invocation behavior. [VERIFIED: 119-CONTEXT.md, 118-05-SUMMARY.md] |
| Free-form `capabilities: string[]` | Structured boolean capabilities plus `tags` for old metadata | v3.2 Phase 115/116/117 work | Discovery must not infer behavior from tags. [VERIFIED: src/config/loader.ts, src/llm/capabilities.ts] |
| Template descriptions unavailable to purpose discovery | `template_tools` expose generated name, `template_path`, description, and parameters | v3.2 Phase 118 | Phase 119 should stabilize and broaden diagnostics, not reimplement discovery. [VERIFIED: src/llm/template-tools.ts, DIRECTED_COVERAGE.md L-91] |
| MCP tool description as protocol help | First-class `resolver: "help"` raw JSON | Required in Phase 119 | Tool description stays minimal; help carries protocol detail. [CITED: Agentic-LLM-Tool-Loop.md CG-9] |

**Deprecated/outdated:**
- Treating discovery resolvers as envelope calls is outdated; discovery remains raw JSON outside `CallModelEnvelope`. [VERIFIED: 119-CONTEXT.md]
- `{{id:...}}` active legacy support was removed in ATL; help should describe accepted `{{ref:...}}` syntax from the Document Reference System, not stale legacy examples. [VERIFIED: REQUIREMENTS.md REF-05; CITED: Document Reference System §4]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Static help content often duplicates enums and can drift. | Common Pitfalls | Low; mitigation is still valid because drift tests are explicitly required. |

## Open Questions (RESOLVED)

1. **Exact public field names for native diagnostics**
   - What we know: `list_purposes` must include usable native tools and public diagnostics. [VERIFIED: 119-CONTEXT.md]
   - Resolution: Use additive public fields named `native_tools` and `native_tool_diagnostics` on every purpose. Keep template diagnostics in the already specified `template_tools`, `template_tool_warnings`, `template_tool_conflicts`, and `dangling_template_paths` fields. Do not mirror internal camelCase names directly in the public JSON shape. [VERIFIED: 119-CONTEXT.md; CITED: ATL Test Plan ATL-U-16]
   - Planner action: Wave 0 must pin those exact field names before implementation. [VERIFIED: ATL Test Plan ATL-U-16]

2. **Whether `list_models` should include defaults-expanded capabilities or declared-only plus diagnostics**
   - What we know: Existing `modelToResponse` emits declared `capabilities` only when present; `modelCapabilitiesWithDefaults` derives OpenAI defaults. [VERIFIED: src/mcp/tools/llm.ts, src/llm/capabilities.ts]
   - Resolution: Preserve existing `capabilities` output as the declared config surface for compatibility, and add `capability_diagnostics` as the required Phase 119 public diagnostic surface. `capability_diagnostics` must make defaults and undeclared values understandable through `state` and `message` without requiring callers to infer from legacy tags. Adding `effective_capabilities` is permitted if it falls out naturally from the helper implementation, but it is not mandatory for Phase 119 acceptance. [VERIFIED: src/mcp/tools/llm.ts, src/llm/capabilities.ts; CITED: Agentic-LLM-Tool-Loop.md OQ-27]
   - Planner action: Tests must pin `capability_diagnostics` with `unknown_declaration` and `declared_unsupported` states; they should not require `effective_capabilities` unless the implementation explicitly adds it. [VERIFIED: 119-VALIDATION.md]

3. **Usage-row no-op verification for directed help**
   - What we know: Help must not write usage rows. [VERIFIED: 119-CONTEXT.md]
   - Resolution: Unit tests are the authoritative low-cost guard for no LLM invocation and no envelope/usage path: `resolver: "help"` must execute before LLM client calls, trace snapshots, reference hydration, and usage recording. Directed scenarios should assert the public raw shape, absence of envelope-only keys, and no requirement for `name`/`messages`; they do not need private database row counting unless an existing public usage helper makes that cheap during execution. [VERIFIED: src/mcp/tools/llm.ts; VERIFIED: scenario inspection]
   - Planner action: Keep the no-usage requirement in Plan 02 unit tests and public shape requirement in Plan 03 directed tests. Do not block the plan on private DB inspection. [VERIFIED: 119-VALIDATION.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/unit tests/dev server | Yes | `v24.7.0` | Node >=20 is required. [VERIFIED: node --version, package.json] |
| npm | Package scripts/version checks | Yes | `11.5.1` | None needed. [VERIFIED: npm --version] |
| Python 3 | Directed scenario tests | Yes | `3.12.3` | None needed for directed tests. [VERIFIED: python3 --version] |
| `gsd-sdk` | Phase init/commit | Yes | executable present | Manual file management if unavailable. [VERIFIED: command -v gsd-sdk] |
| Supabase/.env.test | Integration/E2E tests if added | Not verified | — | Unit + directed managed scenarios are minimum required; Supabase-dependent tests skip when env incomplete per AGENTS. [VERIFIED: AGENTS.md] |

**Missing dependencies with no fallback:** None for required unit/directed research path. [VERIFIED: local probes]

**Missing dependencies with fallback:** Supabase credentials were not verified; avoid making integration tests the only VAL-119 evidence. [VERIFIED: AGENTS.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` in package, latest `4.1.5`; Python directed scenario harness. [VERIFIED: package.json, npm registry, tests/scenarios/directed] |
| Config file | `tests/config/vitest.unit.config.ts`; directed tests use script-level `--managed`. [VERIFIED: tests/config/vitest.unit.config.ts, test_discovery_resolvers.py] |
| Quick run command | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts` [VERIFIED: package.json, existing test files] |
| Full suite command | `npm run lint && npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts && python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed && npm run build` [VERIFIED: package.json, directed test patterns] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DISC-01 | `list_purposes` exposes native/template diagnostics, empty arrays, conflicts, dangling paths | unit + directed | `npm test -- tests/unit/llm-tool.test.ts tests/unit/llm-template-tools.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed` | Existing partial; Wave 0 extend. [VERIFIED: existing files] |
| DISC-02 | `list_models` structured capability diagnostics distinguish unknown vs false | unit + directed | `npm test -- tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py --managed` | Existing partial; Wave 0 extend. [VERIFIED: existing files] |
| DISC-03 | `search` works without messages and matches capability/tool/template/help metadata | unit + directed | `npm test -- tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/testcases/test_discovery_resolvers.py --managed` | Existing partial; Wave 0 extend. [VERIFIED: existing files] |
| DISC-04 | `help` returns stable ordered raw JSON and no LLM/usage side effects | unit + directed | `npm test -- tests/unit/llm-tool.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_help_resolver.py --managed` | No; Wave 0 create. [VERIFIED: file list] |
| VAL-119 | Phase-local runnable validation exists and passes | phase gate | Full suite command above | No validation doc yet. [VERIFIED: phase init] |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/llm-tool.test.ts` plus the most relevant focused unit file. [VERIFIED: package.json]
- **Per wave merge:** Add affected directed scenario with `--managed`. [VERIFIED: FlashQuery directed skill]
- **Phase gate:** Lint, focused units, help/discovery directed scenarios, and build green before `$gsd-verify-work`. [VERIFIED: Phase 118 validation precedent]

### Wave 0 Gaps

- [ ] `src/llm/discovery-content.ts` - extracted response/search helper for stable tests. [VERIFIED: source inspection]
- [ ] `src/llm/help-content.ts` - help response builder and resolver/key constants. [CITED: Agentic-LLM-Tool-Loop.md CG-9]
- [ ] `tests/scenarios/directed/testcases/test_call_model_help_resolver.py` - ATL-DS-15 public help coverage. [CITED: ATL Test Plan ATL-DS-15]
- [ ] `tests/unit/llm-tool.test.ts` extensions - ATL-U-16 key order, no envelope, return_messages ignored, empty diagnostic arrays, resolver-list drift. [CITED: ATL Test Plan ATL-U-16]
- [ ] `tests/scenarios/directed/DIRECTED_COVERAGE.md` rows for Phase 119 help/search/list diagnostics. [VERIFIED: current coverage lacks ATL-DS-15 row]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No direct change | Existing MCP auth remains unchanged. [VERIFIED: phase scope, src/mcp/auth.ts existence via AGENTS] |
| V3 Session Management | No | MCP is stateless and phase does not add sessions. [VERIFIED: AGENTS.md] |
| V4 Access Control | Yes | Discovery must expose metadata only and must not broaden delegated tool access; reuse existing purpose tool/template registries. [VERIFIED: src/llm/tool-registry.ts, src/llm/template-tools.ts] |
| V5 Input Validation | Yes | Zod resolver enum and `parameters.query` validation. [VERIFIED: src/mcp/tools/llm.ts] |
| V6 Cryptography | No | No new crypto/secrets behavior. [VERIFIED: phase scope] |

### Known Threat Patterns for FlashQuery MCP Discovery

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Accidental model invocation from discovery/help | Information disclosure / cost abuse | Keep discovery branch before LLM calls and trace/usage writes; unit-test client call count. [VERIFIED: src/mcp/tools/llm.ts; 119-CONTEXT.md] |
| Overexposing admin/hard-excluded tools in purpose diagnostics as usable | Elevation of privilege | Use `assembleNativeToolRegistry` hard exclusions and label exclusions as diagnostics, not usable tools. [VERIFIED: src/llm/tool-registry.ts] |
| Help documenting stale or unsafe syntax | Tampering / misuse | Drift tests against resolver/error/reference constants and parser tests. [CITED: ATL Test Plan ATL-U-16] |
| Search leaking document/template contents | Information disclosure | Search only discovery metadata; do not include template bodies or document contents. [VERIFIED: current search and template diagnostics only expose metadata] |

## Sources

### Primary (HIGH confidence)

- `AGENTS.md` - project constraints, stack, testing, MCP response convention. [VERIFIED: AGENTS.md]
- `.planning/phases/119-discovery-diagnostics-help-resolver/119-CONTEXT.md` - locked Phase 119 decisions and scope. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - DISC-01 through DISC-04 and VAL-119. [VERIFIED: file read]
- `.planning/ROADMAP.md` - Phase 119 success criteria. [VERIFIED: file read]
- `.planning/STATE.md` and `118-05-SUMMARY.md` - Phase 118 completion and milestone decisions. [VERIFIED: file read]
- `Agentic-LLM-Tool-Loop.md` - discovery/help/capability semantics and CG-9. [CITED: local product doc]
- `Document Reference System.md` - template/purpose discovery diagnostics contract. [CITED: local product doc]
- `ATL Test Plan.md` - ATL-U-16, ATL-DS-07, ATL-DS-15, and validation expectations. [CITED: local product doc]
- `src/mcp/tools/llm.ts`, `src/llm/capabilities.ts`, `src/llm/template-tools.ts`, `src/llm/tool-registry.ts`, `src/config/loader.ts` - implementation surfaces. [VERIFIED: codebase grep/read]
- Context7 `/modelcontextprotocol/typescript-sdk` - official SDK tool registration and response shape docs. [CITED: Context7]
- npm registry via `npm view` - current package versions and modified times. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- None used. [VERIFIED: research process]

### Tertiary (LOW confidence)

- A1 assumption about static help drift risk. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions verified through `package.json`, local commands, npm registry, and Context7 docs. [VERIFIED: package.json, npm registry, Context7]
- Architecture: HIGH - phase is constrained by existing `call_model` discovery branch and canonical local product docs. [VERIFIED: src/mcp/tools/llm.ts; CITED: product docs]
- Pitfalls: HIGH for code-derived pitfalls, LOW only for the generic static-help drift claim. [VERIFIED: source inspection; ASSUMED]

**Research date:** 2026-05-06  
**Valid until:** 2026-05-13 for package versions; phase/product-doc conclusions remain valid until Phase 119 scope changes. [ASSUMED]
