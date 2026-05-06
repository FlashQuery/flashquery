# Phase 118: Template Discovery & Masquerade Dispatch - Research

**Researched:** 2026-05-06 [VERIFIED: system date]
**Domain:** FlashQuery `call_model` Mode 2 template-tool discovery, registry assembly, reverse-map dispatch, and validation [CITED: .planning/phases/118-template-discovery-masquerade-dispatch/118-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: codebase + product source docs + npm registry + Context7]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### D-01 Source Docs Are Mandatory
- Downstream research, planning, implementation, review, and verification agents MUST read the three source documents listed in `<canonical_refs>` before making Phase 118 decisions. If source docs and local planning artifacts disagree, the source docs win unless ROADMAP.md or REQUIREMENTS.md explicitly narrows Phase 118 scope.

### D-02 Fresh Template Discovery
- Template tools are discovered from current vault document frontmatter on each `call_model` tool-list assembly. Do not rely on stale cached template descriptions or parameters. `fq_desc` and `fq_params` changes on disk must be visible to the next assembly path used by `call_model` / purpose listing tests.

### D-03 Template Frontmatter Contract
- A template is any vault document with `fq_template: true`. `fq_namespace` defaults to `"template"` if absent and must match `[a-z][a-z0-9_]*`; dots, uppercase, and leading digits are invalid. `fq_expose_as_tool: true` is required for model-visible masquerade tools. `fq_desc` is required for masqueraded tools. `fq_params` defines model-supplied arguments and supports at least the existing `string` and `document` parameter behavior.

### D-04 Name Generation Contract
- Generated masquerade tool names MUST use `flashquery.<fq_namespace>.<slug>`. Slug generation is centralized and deterministic: filename stem, lowercase, non-alphanumeric runs replaced with `_`, trim leading/trailing `_`, reject empty. Empty slugs and invalid namespaces are discovery-time warnings that prevent masquerade exposure but preserve direct reference/template access.

### D-05 Collision Policy
- Collision checks happen per purpose over the complete model-visible registry assembled for the invocation, including native tools and generated template tools. If two entries produce the same final name, assembly fails hard for `call_model`; do not suffix, choose scan-order winners, or silently drop a colliding tool. Diagnostics must list the generated name and every source, including canonical `template_path` values for templates.

### D-06 Reverse Map Dispatch
- Tool-list assembly MUST maintain an explicit per-call reverse map from generated tool name to canonical template path. Dispatch MUST resolve model calls through this map and MUST NOT reconstruct identity by parsing namespace/slug and searching templates. A generated name absent from the current invocation map returns `tool_not_in_registry`.

### D-07 Template Tool Dispatch
- When the delegated model calls a template tool, FlashQuery validates arguments against `fq_params`, applies defaults, resolves `document` parameters through the standard document identifier ladder, hydrates the template body with existing template substitution behavior, and returns a JSON-stringified tool result message keyed by `tool_call_id`.

### D-08 Recoverable Tool Errors
- Model-initiated template-tool failures are recoverable tool dispatch failures, not host reference-resolution failures. Missing required params, invalid params, unsupported schemas, unresolvable document parameters, and reverse-map misses should return typed tool error payloads to the model and let the loop continue unless loop guardrails stop it.

### D-09 Native And Template Tool Composition
- Purpose registries may expose native tools, template tools, or both. Template-only registries must still route through Mode 2 because Phase 117's selector keys off final provider-visible tool definitions. Mixed native/template calls in one loop must preserve calls-log entries for both kinds of tool calls.

### D-10 Test Coverage Is Phase Scope
- Phase 118 must ship runnable unit, integration, E2E, and directed scenario tests for fresh discovery, generated names, collision diagnostics, reverse-map dispatch, template invocation/hydration, recoverable template-tool errors, document parameters, and mixed native/template loops.

### D-11 Phase 117 Dependency
- Use Phase 117's validated Mode 2 loop, native dispatcher envelope, tool result message shape, calls-log metadata, aggregate usage path, and `hasModelVisibleTools()` routing behavior. Phase 117 review/gap closure was committed before this planning run; downstream agents may inspect Phase 117 commits and summaries for final implementation shape.

### the agent's Discretion
- Exact module boundaries are discretionary, but plans should prefer small additions near existing `src/llm/purpose-template-bindings.ts`, `src/llm/tool-registry.ts`, `src/llm/tool-dispatcher.ts`, `src/llm/agent-loop.ts`, `src/llm/reference-resolver.ts`, and `src/mcp/tools/llm.ts`.
- The implementation may introduce a dedicated `template-tools` helper module if it keeps discovery, slugging, schema generation, reverse-map construction, and dispatch behavior cohesive.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Broad Phase 119 discovery/help resolver work remains deferred unless needed to expose Phase 118 collision diagnostics and testable template-tool metadata.
- MCP Broker external tool routing, Mode 3 cooperative caller-owned tool calls, model-initiated response references, audit document writes, path-scoped delegated writes, and advanced context-overflow summarization remain out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TMPL-06 | Template discovery reads frontmatter fresh and validates `fq_namespace`, `fq_desc`, `fq_expose_as_tool`, and `fq_params`. [CITED: .planning/REQUIREMENTS.md] | Use fresh vault reads during registry assembly and expose discovery diagnostics for invalid namespace, missing description, unsupported params, empty slug, dangling paths, and non-exposed templates. [CITED: Document Reference System.md §6.2, §11.1, §12.4] |
| TMPL-07 | Masqueraded template tools use `flashquery.<fq_namespace>.<slug>` and maintain explicit reverse map to canonical paths. [CITED: .planning/REQUIREMENTS.md] | Centralize slug/name generation and return a per-call `Map<generated_name, template_path>` from registry assembly. [CITED: Document Reference System.md §11.1-§11.2] |
| TMPL-08 | Template-tool dispatch validates model arguments, hydrates output, and returns JSON-stringified tool results or typed errors. [CITED: .planning/REQUIREMENTS.md] | Reuse `reference-resolver.ts` template validation/hydration primitives but wrap failures as recoverable tool payloads, not host `reference_resolution_failed` MCP errors. [VERIFIED: src/llm/reference-resolver.ts; CITED: Document Reference System.md §11.4] |
| VAL-118 | Phase 118 ships unit, integration, E2E, and directed scenario tests. [CITED: .planning/REQUIREMENTS.md] | Implement ATL-U-15, ATL-I-03, ATL-E2E-04, ATL-E2E-05, ATL-DS-07, ATL-DS-08, ATL-DS-10, and ATL-DS-11 coverage. [CITED: ATL Test Plan.md] |
</phase_requirements>

## Summary

Phase 118 should be planned as a registry-and-dispatch extension on top of Phase 117, not as a new loop executor. [VERIFIED: src/mcp/tools/llm.ts; VERIFIED: src/llm/agent-loop.ts; CITED: 117-VERIFICATION.md] Phase 117 already routes purpose calls into Mode 2 whenever the final provider-visible tool list is non-empty via `hasModelVisibleTools()`, and its loop already appends assistant tool-call messages, dispatches tools, appends JSON-stringified `tool` messages, and records `metadata.tools.calls_log`. [VERIFIED: src/mcp/tools/llm.ts; VERIFIED: src/llm/agent-loop.ts]

The planner should add a cohesive `src/llm/template-tools.ts` helper and then thread its output through existing registry assembly, `call_model`, and dispatcher surfaces. [VERIFIED: codebase module boundaries; CITED: 118-CONTEXT.md D-11] The helper should own fresh frontmatter discovery, namespace/slug validation, `fq_params` schema translation, collision diagnostics, reverse-map construction, and template-tool dispatch. [CITED: Document Reference System.md §11.1-§11.4]

**Primary recommendation:** Build template-tool assembly as a per-purpose, per-invocation object `{ providerTools, diagnostics, reverseMap }`, merge it with native registry assembly before Mode 2 selection, and dispatch template calls through the explicit reverse map before native dispatch fallback. [CITED: 118-CONTEXT.md D-02 through D-09; VERIFIED: src/llm/tool-registry.ts; VERIFIED: src/llm/tool-dispatcher.ts]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS, TypeScript strict mode, ESM modules, and no CommonJS `require`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- MCP tool handlers must catch errors internally and return `{ content: [{ type: "text", text: "..." }], isError: true }` on failure. [VERIFIED: AGENTS.md; VERIFIED: src/mcp/tools/llm.ts]
- Use Zod for external input validation, including config and MCP params. [VERIFIED: AGENTS.md; VERIFIED: src/mcp/tools/llm.ts]
- All MCP tools return text content blocks, and error responses add `isError: true`. [VERIFIED: AGENTS.md]
- Tests are organized as unit under `tests/unit`, integration under `tests/integration`, E2E under `tests/e2e`, and directed scenarios under `tests/scenarios/directed`. [VERIFIED: AGENTS.md; VERIFIED: tests/config/*.ts]
- Run focused unit tests with `npm test`, integration with `npm run test:integration`, E2E with `npm run test:e2e`, and build with `npm run build`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- Integration and E2E tests read `.env.test`; this checkout has `.env.test` present. [VERIFIED: AGENTS.md; VERIFIED: filesystem]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Fresh template frontmatter discovery | API / Backend | Database / Storage | `call_model` assembles tools server-side and must read vault documents/storage state fresh per invocation. [CITED: 118-CONTEXT.md D-02; VERIFIED: src/mcp/tools/llm.ts] |
| Template-tool schema/name generation | API / Backend | — | Provider-visible tool definitions are built in the LLM backend registry path. [VERIFIED: src/llm/tool-registry.ts; CITED: Document Reference System.md §11.1] |
| Per-purpose collision checks | API / Backend | — | Collisions are against the final model-visible registry assembled for one purpose invocation. [CITED: 118-CONTEXT.md D-05] |
| Reverse-map dispatch | API / Backend | — | The delegated model sends only generated tool names; FlashQuery must map them to canonical template paths inside the loop. [CITED: 118-CONTEXT.md D-06] |
| Template argument validation and hydration | API / Backend | Database / Storage | `fq_params` validation uses backend rules, and `document` params resolve via vault/database document lookup. [VERIFIED: src/llm/reference-resolver.ts; VERIFIED: src/mcp/utils/resolve-document.ts] |
| Calls-log metadata | API / Backend | — | Phase 117 stores per-iteration tool-call detail in response metadata, not database rows. [VERIFIED: src/llm/agent-loop.ts; CITED: 117-VERIFICATION.md] |

## Standard Stack

### Core

| Library | Verified Version | Purpose | Why Standard |
|---------|------------------|---------|--------------|
| Node.js | repo requires `>=20`; local `v24.7.0` [VERIFIED: package.json; VERIFIED: `node --version`] | Runtime for CLI/MCP server and tests. | Project standard and enforced through `package.json` engines. [VERIFIED: AGENTS.md; VERIFIED: package.json] |
| TypeScript | `^6.0.2` in repo [VERIFIED: package.json] | Strict ESM source language. | Existing codebase is TypeScript ESM. [VERIFIED: package.json; VERIFIED: AGENTS.md] |
| `@modelcontextprotocol/sdk` | repo `^1.27.1`; latest `1.29.0`, modified 2026-03-30 [VERIFIED: package.json; VERIFIED: npm registry] | MCP server/client tool registration and stdio E2E boundary. | Existing FlashQuery MCP surface uses SDK `McpServer.registerTool`, and Context7 docs confirm `registerTool(name, config, handler)` with Zod schemas and `content` responses. [VERIFIED: src/mcp/tools/llm.ts; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Zod | repo `^4.3.6`; latest `4.4.3`, modified 2026-05-04 [VERIFIED: package.json; VERIFIED: npm registry] | Input validation and JSON Schema conversion. | Existing native tool translation uses `z.toJSONSchema`; Context7 confirms Zod 4 provides first-party `z.toJSONSchema()` and preserves metadata from `.describe()`/`.meta()`. [VERIFIED: src/llm/tool-registry.ts; CITED: Context7 `/websites/zod_dev_v4`] |
| Vitest | repo `^4.1.1`; latest `4.1.5`, modified 2026-05-05; local `4.1.1` [VERIFIED: package.json; VERIFIED: npm registry; VERIFIED: local command] | Unit, integration, and E2E test runner. | Existing project test configs and scripts use Vitest. [VERIFIED: tests/config/*.ts; VERIFIED: package.json] |
| `gray-matter` | repo/latest `4.0.3`, modified 2023-07-12 [VERIFIED: package.json; VERIFIED: npm registry] | Markdown frontmatter parsing. | Existing vault/scanner paths parse frontmatter with `gray-matter`. [VERIFIED: src/storage/vault.ts; VERIFIED: src/services/scanner.ts] |

### Supporting

| Library | Verified Version | Purpose | When to Use |
|---------|------------------|---------|-------------|
| `tsx` | repo/latest `4.21.0`; local `4.21.0` [VERIFIED: package.json; VERIFIED: npm registry; VERIFIED: local command] | Run TypeScript CLI in development and E2E subprocesses. | Existing E2E starts `src/index.ts` through `npx tsx`. [VERIFIED: tests/e2e/call-model-agent-loop.e2e.test.ts] |
| `tsup` | repo/latest `8.5.1`, modified 2025-11-12 [VERIFIED: package.json; VERIFIED: npm registry] | Production ESM/DTS build. | Use for phase build validation. [VERIFIED: package.json] |
| Supabase JS / `pg` | repo `@supabase/supabase-js ^2.100.0`, `pg ^8.20.0` [VERIFIED: package.json] | Document table, usage rows, purpose-template binding table, and integration setup. | Required for integration tests and persisted binding discovery. [VERIFIED: src/llm/purpose-template-bindings.ts; VERIFIED: tests/helpers/test-env.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `reference-resolver.ts` template functions | New independent renderer | Do not duplicate: Phase 114 already validates `string`/`document` params, defaults, warnings, and single-pass substitution. [VERIFIED: src/llm/reference-resolver.ts; VERIFIED: tests/unit/reference-resolver.test.ts] |
| Existing `tool-dispatcher.ts` error envelope | A separate template error envelope | Do not fork envelope shape: Phase 117 established `{ ok:false, error:{ code, message, recoverable:true } }` JSON-stringified tool payloads. [VERIFIED: src/llm/tool-dispatcher.ts; CITED: 117-02-SUMMARY.md] |
| Per-call reverse map | Slug parsing/search at dispatch | Forbidden by locked decision and unsafe under collisions/renames. [CITED: 118-CONTEXT.md D-06] |

**Installation:**
```bash
npm install
```

**Version verification commands used:**
```bash
npm view @modelcontextprotocol/sdk version time.modified --json
npm view zod version time.modified --json
npm view vitest version time.modified --json
npm view tsx version time.modified --json
npm view tsup version time.modified --json
npm view gray-matter version time.modified --json
```

## Architecture Patterns

### System Architecture Diagram

```text
call_model(resolver=purpose)
  |
  v
host reference hydration for initial system/user messages
  |
  v
native registry assembly ----\
                              +--> combined model-visible registry
fresh template discovery -----/        |
  |                                    |
  |                              collision check
  |                                    |
  |                              provider tools + reverseMap
  |                                    |
  v                                    v
list_purposes diagnostics        executeAgentLoop()
                                       |
                                       v
delegated model returns tool_calls
                                       |
                         +-------------+-------------+
                         |                           |
                  generated name in reverseMap?      native name in snapshot?
                         |                           |
                         v                           v
             template param validation + hydration   existing native dispatcher
                         |                           |
                         +-------------+-------------+
                                       |
                                       v
                  JSON-stringified tool result/error message
                                       |
                                       v
                           next model iteration or final response
```

### Recommended Project Structure

```text
src/llm/
├── template-tools.ts              # fresh discovery, slug/name/schema generation, diagnostics, reverse map, dispatch
├── tool-registry.ts               # extend assembly types or add combined registry adapter
├── tool-dispatcher.ts             # route batches across template/native dispatch while preserving Phase 117 envelope
├── agent-loop.ts                  # accept combined dispatcher inputs; avoid new loop logic
├── reference-resolver.ts          # reuse/export template render primitives for model-initiated dispatch
└── purpose-template-bindings.ts   # reuse path normalization/binding lookup; add discovery lookup helpers if needed
```

### Pattern 1: Extend Registry Assembly Additively

**What:** Return a combined registry that preserves current native fields and adds `templateToolNames`, `templateReverseMap`, `templateTools`, and diagnostics. [VERIFIED: src/llm/tool-registry.ts; CITED: 118-CONTEXT.md D-05-D-07]

**When to use:** Use this during `call_model` purpose handling before `hasModelVisibleTools()`. [VERIFIED: src/mcp/tools/llm.ts]

**Example:**
```typescript
// Source: existing src/llm/tool-registry.ts and Phase 118 product contract
const native = assembleNativeToolRegistry(config, purposeName, nativeToolCatalog, { strictTools });
const templates = await assembleTemplateToolRegistry(config, purposeName, { strictTools });
const registry = mergeModelVisibleRegistries(native, templates);
if (registry.collisions.length > 0) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'tool_registry_collision', collisions: registry.collisions }) }] };
}
```

### Pattern 2: Dispatch Through Reverse Map Before Native Snapshot

**What:** For each tool call, first check the per-invocation template reverse map, then check native snapshot; a generated name not in reverse map returns `tool_not_in_registry`. [CITED: 118-CONTEXT.md D-06; VERIFIED: src/llm/tool-dispatcher.ts]

**When to use:** Use inside the Phase 117 batch dispatcher path so mixed same-turn native/template calls still use `Promise.allSettled`. [VERIFIED: src/llm/tool-dispatcher.ts; VERIFIED: src/llm/agent-loop.ts]

**Example:**
```typescript
// Source: existing src/llm/tool-dispatcher.ts error envelope
if (templateReverseMap.has(toolName)) {
  return dispatchTemplateToolCall({ toolCall, templatePath: templateReverseMap.get(toolName)!, context });
}
return dispatchNativeToolCall({ toolCall, catalog, nativeToolNames, dispatchContext: context });
```

### Pattern 3: Reuse Template Hydration Rules Without Host Fail-Fast

**What:** Use the same `fq_params` validation and document parameter resolution that host `template_params` already uses, but translate failures into recoverable tool error payloads. [VERIFIED: src/llm/reference-resolver.ts; CITED: Document Reference System.md §11.4]

**When to use:** Use when a delegated model calls a generated template tool. [CITED: Document Reference System.md §7.2, §11.4]

**Example:**
```typescript
// Source: existing src/llm/reference-resolver.ts behavior and Phase 117 tool payload shape
const payload = error
  ? { ok: false, error: { code: error.reason, message: error.message, recoverable: true } }
  : { ok: true, result: { content: [{ type: 'text', text: rendered.content }] } };
return { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(payload) };
```

### Anti-Patterns to Avoid

- **Parsing generated names to find templates:** Dispatch must use the explicit reverse map because slug/name parsing loses canonical identity and breaks collision safety. [CITED: 118-CONTEXT.md D-06]
- **Caching `fq_desc`/`fq_params` from scanner state for registry assembly:** Fresh frontmatter changes on disk must be visible to the next assembly. [CITED: 118-CONTEXT.md D-02; CITED: ATL Test Plan.md ATL-I-03]
- **Dropping colliding templates silently:** Collision assembly must fail hard for `call_model` and include every source. [CITED: 118-CONTEXT.md D-05]
- **Throwing template-tool validation failures out of the loop:** Model-initiated template failures must return recoverable `tool` messages. [CITED: 118-CONTEXT.md D-08; VERIFIED: src/llm/tool-dispatcher.ts]
- **Changing Phase 117 aggregate usage semantics:** Mode 2 writes one aggregate usage row; tool iteration detail remains in `metadata.tools.calls_log`. [VERIFIED: src/llm/agent-loop.ts; CITED: 117-VERIFICATION.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template body/frontmatter parsing | Custom YAML/frontmatter parser | `gray-matter` and existing vault/document utilities | Existing vault code already uses `gray-matter` for markdown frontmatter. [VERIFIED: src/storage/vault.ts; VERIFIED: src/services/scanner.ts] |
| Document identifier resolution | Manual path/filename/UUID lookup | `resolveAndBuildDocument()` / `resolveDocumentIdentifier()` | Existing resolver handles UUID, path, filename ambiguity, path safety, and moved-file reconciliation. [VERIFIED: src/mcp/utils/document-output.ts; VERIFIED: src/mcp/utils/resolve-document.ts] |
| Template param validation/rendering | New template engine | Existing `reference-resolver.ts` template helpers | Existing code covers required/defaults, document params, warnings, alias/list behavior, and single-pass substitution. [VERIFIED: src/llm/reference-resolver.ts; VERIFIED: tests/unit/reference-resolver.test.ts] |
| OpenAI tool schema conversion | Ad hoc schema strings | Zod and existing `normalizeToolJsonSchema()` / `z.toJSONSchema()` pattern | Existing native registry already normalizes strict/non-strict JSON Schema. [VERIFIED: src/llm/tool-registry.ts; CITED: Context7 `/websites/zod_dev_v4`] |
| Tool loop execution | New agent loop | Phase 117 `executeAgentLoop()` | Loop control, usage aggregation, messages, and calls-log behavior are already validated. [VERIFIED: src/llm/agent-loop.ts; CITED: 117-VERIFICATION.md] |

**Key insight:** Phase 118's complexity is identity and composition, not LLM looping; custom dispatch/search shortcuts are where collision, freshness, and recoverability bugs will enter. [CITED: 118-CONTEXT.md; VERIFIED: src/llm/agent-loop.ts]

## Common Pitfalls

### Pitfall 1: Freshness Lost By DB-Only Discovery
**What goes wrong:** `fq_desc` or `fq_params` edits on disk do not appear in the next `call_model` or `list_purposes` registry assembly. [CITED: 118-CONTEXT.md D-02]
**Why it happens:** Planner routes discovery through stale scanner/DB metadata instead of reading current frontmatter from vault files. [CITED: ATL Test Plan.md ATL-I-03]
**How to avoid:** Read template frontmatter fresh from canonical template paths during each assembly; use DB rows only to identify bindings and active/dangling status. [CITED: Document Reference System.md §11.1, §12.4]
**Warning signs:** Tests need a scan to observe `fq_desc` changes; ATL-I-03 says this must be tested without a scan. [CITED: ATL Test Plan.md ATL-I-03]

### Pitfall 2: Registry Types Stay Native-Only
**What goes wrong:** Template-only purposes still run Mode 1 because assembly only happens when `purpose.tools !== undefined`. [VERIFIED: src/mcp/tools/llm.ts]
**Why it happens:** Existing code assembles native tools only inside a `purpose?.tools !== undefined` branch. [VERIFIED: src/mcp/tools/llm.ts]
**How to avoid:** Assemble template tools for purpose calls independently of native `tools`; `hasModelVisibleTools()` should see merged provider tools. [CITED: 118-CONTEXT.md D-09; VERIFIED: src/mcp/tools/llm.ts]
**Warning signs:** A purpose with `tools: []` plus bound templates returns no `metadata.tools`. [CITED: ATL Test Plan.md gap item 7]

### Pitfall 3: Collision Diagnostics Are Incomplete
**What goes wrong:** Assembly reports only the first collision or only template paths, not native/template source details. [CITED: 118-CONTEXT.md D-05]
**Why it happens:** Collision detection is applied to template names before merging native/provider tools. [CITED: Document Reference System.md §11.2]
**How to avoid:** Build a map keyed by final provider-visible name across native and template tools, then fail if any bucket has more than one source. [CITED: 118-CONTEXT.md D-05]
**Warning signs:** Diagnostics cannot explain a native/template collision or omit canonical `template_path`. [CITED: Document Reference System.md §12.4]

### Pitfall 4: Template Errors Abort The Host Call
**What goes wrong:** Missing model-supplied template args produce top-level `reference_resolution_failed` or MCP `isError`. [CITED: 118-CONTEXT.md D-08]
**Why it happens:** The implementation directly reuses host reference failure handling. [VERIFIED: src/mcp/tools/llm.ts]
**How to avoid:** Catch `TemplateReferenceError`-equivalent failures inside template dispatch and serialize them as recoverable tool messages. [VERIFIED: src/llm/tool-dispatcher.ts; CITED: Document Reference System.md §11.4]
**Warning signs:** Provider does not get a second iteration after a missing template argument. [CITED: ATL Test Plan.md ATL-E2E-04]

### Pitfall 5: Calls Log Cannot Distinguish Mixed Tool Kinds
**What goes wrong:** Mixed native/template loops log tool names but lose whether the dispatch was native or template, reducing diagnosability. [CITED: 118-CONTEXT.md D-09]
**Why it happens:** Current `NativeToolCallLogEntry` type is native-specific and has no `kind` field. [VERIFIED: src/llm/tool-dispatcher.ts]
**How to avoid:** Add a discriminant such as `kind: "native" | "template"` or include template-specific fields additively while preserving existing `tool_call_id`, `tool_name`, `arguments`, `status`, and `result_summary`. [VERIFIED: src/llm/tool-dispatcher.ts; CITED: ATL Test Plan.md ATL-E2E-05]
**Warning signs:** ATL-DS-11 cannot assert both native and template calls in one loop without brittle result-summary parsing. [CITED: ATL Test Plan.md ATL-DS-11]

## Code Examples

### Generated Name Helper
```typescript
// Source: Document Reference System.md §11.2
export function slugTemplateFilename(filenameStem: string): string | null {
  const slug = filenameStem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : null;
}

export function templateToolName(namespace: string, slug: string): string {
  return `flashquery.${namespace}.${slug}`;
}
```

### Recoverable Template Tool Error
```typescript
// Source: src/llm/tool-dispatcher.ts payload shape
function templateToolError(toolCallId: string, code: string, message: string, details?: unknown) {
  return {
    role: 'tool' as const,
    tool_call_id: toolCallId,
    content: JSON.stringify({
      ok: false,
      error: { code, message, recoverable: true, ...(details === undefined ? {} : { details }) },
    }),
  };
}
```

### Purpose Diagnostics Shape
```json
{
  "template_tools": [
    {
      "name": "flashquery.skill.research_skill",
      "template_path": "Templates/Research-Skill.md",
      "description": "Structured methodology for autonomous web research.",
      "parameters": { "type": "object", "properties": { "topic": { "type": "string" } }, "required": ["topic"] }
    }
  ],
  "template_tool_conflicts": [
    { "name": "flashquery.skill.research_skill", "template_paths": ["Templates/Research-Skill.md", "Other/Research Skill.md"] }
  ],
  "dangling_template_paths": []
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Text-only `complete()` wrappers | Lower-level `chat()` supports assistant tool calls, usage, finish reason, and messages. | Phase 112 completed 2026-05-05 [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: 112-VERIFICATION.md] | Phase 118 can rely on normalized tool-call messages. [VERIFIED: src/llm/client.ts] |
| Host-only `{{ref:...}}` references | Templates with `fq_template: true` support `string` and `document` params via `template_params`. | Phase 114 completed 2026-05-06 [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: tests/unit/reference-resolver.test.ts] | Template dispatch should reuse the same renderer. [VERIFIED: src/llm/reference-resolver.ts] |
| Native-only provider-visible registry | Native tool registry translates MCP/Zod schemas to OpenAI-compatible definitions. | Phase 116 completed 2026-05-06 [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: src/llm/tool-registry.ts] | Template tool definitions should compose into this path. [CITED: 118-CONTEXT.md D-09] |
| One-shot purpose calls | Mode 2 loop dispatches tool calls and aggregates usage. | Phase 117 completed 2026-05-06 [VERIFIED: 117-VERIFICATION.md] | Phase 118 must extend dispatch, not fork loop execution. [VERIFIED: src/llm/agent-loop.ts] |

**Deprecated/outdated:**
- `{{id:...}}` active reference support is removed in the ATL release; use `{{ref:...}}`. [CITED: Document Reference System.md §4.1; VERIFIED: .planning/STATE.md]
- `@modelcontextprotocol/server` is forbidden by project instructions; use `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- Broad Phase 119 help/discovery polish is out of scope except diagnostics needed to validate Phase 118. [CITED: 118-CONTEXT.md]

## Assumptions Log

All claims in this research were verified from local code, project planning artifacts, npm registry, Context7, or canonical source docs. [VERIFIED: research tool outputs]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | No `[ASSUMED]` claims. | — | — |

## Open Questions

1. **Should `templates.default_access` already be implemented in Phase 118?** [CITED: Document Reference System.md §12.1]
   - What we know: The source docs define permissive default access, but current config code already supports purpose-level `templates` and not a top-level template config block in the inspected paths. [VERIFIED: src/llm/purpose-template-bindings.ts; CITED: Document Reference System.md §12.1]
   - What's unclear: Whether Phase 118 must add the top-level config schema or limit to explicit purpose bindings plus required diagnostics. [CITED: 118-CONTEXT.md]
   - Recommendation: Plan a small config/read helper if absent, because ATL-U-15 and ATL-I-03 explicitly require permissive/restrictive coverage. [CITED: ATL Test Plan.md ATL-U-15, ATL-I-03]

2. **Should template-tool calls log `kind: "template"` publicly?** [VERIFIED: src/llm/types.ts; VERIFIED: src/llm/tool-dispatcher.ts]
   - What we know: Current calls-log entries record tool name, args, status, summary, and error code. [VERIFIED: src/llm/tool-dispatcher.ts]
   - What's unclear: The product docs require mixed native/template metadata, but do not name a required `kind` field. [CITED: 118-CONTEXT.md D-09]
   - Recommendation: Add `kind` additively for planner/test clarity while preserving existing fields. [VERIFIED: src/llm/types.ts]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, unit, integration, E2E, CLI | yes [VERIFIED: local command] | `v24.7.0` [VERIFIED: local command] | Node >=20 is required; no fallback below 20. [VERIFIED: package.json] |
| npm | Package scripts and registry verification | yes [VERIFIED: local command] | `11.5.1` [VERIFIED: local command] | — |
| `tsx` | E2E subprocess and dev server | yes [VERIFIED: local command] | `4.21.0` [VERIFIED: local command] | Use built `node dist/index.js` after `npm run build`. [VERIFIED: AGENTS.md] |
| Vitest | Unit/integration/E2E tests | yes [VERIFIED: local command] | `4.1.1` [VERIFIED: local command] | — |
| `.env.test` | Supabase-backed integration/E2E | yes [VERIFIED: filesystem] | — | Tests skip gracefully when incomplete. [VERIFIED: tests/helpers/test-env.ts] |
| Supabase/Postgres credentials | Integration/E2E document and binding tests | configured via `.env.test` [VERIFIED: filesystem] | — | For unit-only waves, mock storage/vault. [VERIFIED: tests/helpers/test-env.ts] |

**Missing dependencies with no fallback:** None detected for planning; actual integration pass still depends on valid `.env.test` values. [VERIFIED: filesystem; VERIFIED: tests/helpers/test-env.ts]

**Missing dependencies with fallback:** None detected. [VERIFIED: local command]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.1` local, repo `^4.1.1` [VERIFIED: local command; VERIFIED: package.json] |
| Config files | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts` [VERIFIED: filesystem] |
| Quick run command | `npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool.test.ts` [VERIFIED: package.json] |
| Full suite command | `npm test && npm run test:integration && npm run test:e2e && npm run build` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TMPL-06 | Fresh frontmatter discovery and validation. [CITED: .planning/REQUIREMENTS.md] | unit + integration + directed | `npm test -- tests/unit/llm-template-tools.test.ts`; `npm run test:integration -- tests/integration/template-tools.integration.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed` | no, Wave 0 [VERIFIED: filesystem] |
| TMPL-07 | Generated names, collision diagnostics, reverse map. [CITED: .planning/REQUIREMENTS.md] | unit + E2E + directed | `npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-dispatcher.test.ts`; `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py --managed` | no, Wave 0 [VERIFIED: filesystem] |
| TMPL-08 | Template-tool dispatch validates args, hydrates content, returns recoverable payloads. [CITED: .planning/REQUIREMENTS.md] | unit + E2E + directed | `npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-dispatcher.test.ts`; `npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py --managed` | no, Wave 0 [VERIFIED: filesystem] |
| VAL-118 | Unit, integration, E2E, and directed coverage for Phase 118. [CITED: .planning/REQUIREMENTS.md] | full gate | `npm run lint && npm test -- tests/unit/llm-template-tools.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool.test.ts && npm run test:integration -- tests/integration/template-tools.integration.test.ts && npm run test:e2e -- tests/e2e/call-model-template-tools.e2e.test.ts && python3 tests/scenarios/directed/testcases/test_call_model_template_discovery.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py --managed && python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py --managed && npm run build` | no, Wave 0 [VERIFIED: filesystem] |

### Sampling Rate

- **Per task commit:** Focused unit command for touched module. [VERIFIED: package.json]
- **Per wave merge:** Focused unit + relevant integration/E2E scenario. [CITED: ATL Test Plan.md]
- **Phase gate:** Full Phase 118 gate above plus `npm run build`. [CITED: VAL-118; VERIFIED: package.json]

### Wave 0 Gaps

- [ ] `tests/unit/llm-template-tools.test.ts` - covers ATL-U-15 / TMPL-06 / TMPL-07 / TMPL-08. [CITED: ATL Test Plan.md ATL-U-15]
- [ ] `tests/integration/template-tools.integration.test.ts` or extension of `reference-resolver.integration.test.ts` - covers ATL-I-03 fresh frontmatter, default access, dangling paths. [CITED: ATL Test Plan.md ATL-I-03]
- [ ] `tests/e2e/call-model-template-tools.e2e.test.ts` - covers ATL-E2E-04 and ATL-E2E-05. [CITED: ATL Test Plan.md ATL-E2E-04, ATL-E2E-05]
- [ ] `tests/scenarios/directed/testcases/test_call_model_template_discovery.py` - covers ATL-DS-07. [CITED: ATL Test Plan.md ATL-DS-07]
- [ ] `tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py` - covers ATL-DS-08. [CITED: ATL Test Plan.md ATL-DS-08]
- [ ] `tests/scenarios/directed/testcases/test_call_model_agent_loop_template_tool.py` - covers ATL-DS-10. [CITED: ATL Test Plan.md ATL-DS-10]
- [ ] `tests/scenarios/directed/testcases/test_call_model_agent_loop_mixed_tools.py` - covers ATL-DS-11. [CITED: ATL Test Plan.md ATL-DS-11]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 118 adds no new user/session authentication surface. [VERIFIED: phase scope; CITED: 118-CONTEXT.md] |
| V3 Session Management | no | MCP remains stateless per project instruction. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Purpose-scoped template binding/default-access controls decide which templates are model-visible; dispatch rejects names absent from per-call registry. [CITED: 118-CONTEXT.md D-05-D-09] |
| V5 Input Validation | yes | Validate frontmatter (`fq_namespace`, `fq_desc`, `fq_params`), generated arguments, and document identifiers with Zod/existing resolver rules. [VERIFIED: src/llm/reference-resolver.ts; CITED: Document Reference System.md §6.2, §11.3] |
| V6 Cryptography | no | No new cryptographic primitive is introduced. [VERIFIED: phase scope; CITED: 118-CONTEXT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt/tool injection through tool result containing `{{ref:...}}` | Tampering / Information Disclosure | Do not rescan assistant/tool messages or tool-call args for host references; existing boundary only scans host system/user input. [VERIFIED: src/mcp/tools/llm.ts; CITED: Document Reference System.md §4.5] |
| Unauthorized template invocation by guessed generated name | Elevation of Privilege | Dispatch only through per-call reverse map; absent names return `tool_not_in_registry`. [CITED: 118-CONTEXT.md D-06] |
| Collision-based privilege confusion | Tampering / Elevation of Privilege | Fail registry assembly on any final model-visible name collision across native/template registries. [CITED: 118-CONTEXT.md D-05] |
| Path traversal in document parameters | Information Disclosure | Use existing `resolveDocumentIdentifier()` path safety and identifier ladder. [VERIFIED: src/mcp/utils/resolve-document.ts] |
| Overexposure via permissive templates | Information Disclosure | Implement and test default-access semantics, purpose bindings, and diagnostics; consider restrictive configs for curated purposes. [CITED: Document Reference System.md §12.1; CITED: ATL Test Plan.md ATL-I-03] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/118-template-discovery-masquerade-dispatch/118-CONTEXT.md` - locked Phase 118 decisions and mandatory source docs. [VERIFIED: filesystem]
- `.planning/REQUIREMENTS.md` - TMPL-06, TMPL-07, TMPL-08, VAL-118 requirement text. [VERIFIED: filesystem]
- `.planning/ROADMAP.md` - Phase 118 goal, dependency, and success criteria. [VERIFIED: filesystem]
- `.planning/STATE.md` - project state and Phase 117/118 accumulated decisions. [VERIFIED: filesystem]
- `.planning/phases/117-agent-loop-executor/117-VERIFICATION.md` and `117-*-SUMMARY.md` - final Phase 117 loop behavior and validation. [VERIFIED: filesystem]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md` - agent-loop and masquerade source contract. [VERIFIED: filesystem]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md` - authoritative template/reference/masquerade contract. [VERIFIED: filesystem]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md` - required unit/integration/E2E/directed coverage. [VERIFIED: filesystem]
- `src/llm/tool-registry.ts`, `src/llm/tool-dispatcher.ts`, `src/llm/agent-loop.ts`, `src/llm/reference-resolver.ts`, `src/llm/purpose-template-bindings.ts`, `src/mcp/tools/llm.ts` - current implementation surfaces. [VERIFIED: codebase]
- Context7 `/websites/zod_dev_v4` - Zod 4 JSON Schema conversion docs. [CITED: Context7]
- Context7 `/modelcontextprotocol/typescript-sdk` - MCP `registerTool` docs. [CITED: Context7]

### Secondary (MEDIUM confidence)
- npm registry version/time metadata for `@modelcontextprotocol/sdk`, `zod`, `vitest`, `tsx`, `tsup`, and `gray-matter`. [VERIFIED: npm registry]

### Tertiary (LOW confidence)
- None. [VERIFIED: source hierarchy]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified with `package.json`, local commands, npm registry, and Context7 docs. [VERIFIED: package.json; VERIFIED: npm registry; CITED: Context7]
- Architecture: HIGH - product docs and current code agree that Phase 118 composes into existing Mode 2 registry/dispatch paths. [CITED: Document Reference System.md; VERIFIED: src/mcp/tools/llm.ts; VERIFIED: src/llm/agent-loop.ts]
- Pitfalls: HIGH - derived from locked decisions, explicit test plan coverage, and observed native-only code boundaries. [CITED: 118-CONTEXT.md; VERIFIED: src/llm/tool-registry.ts; VERIFIED: src/mcp/tools/llm.ts]

**Research date:** 2026-05-06 [VERIFIED: system date]
**Valid until:** 2026-06-05 for codebase/planning facts; re-check npm package versions before dependency updates. [VERIFIED: npm registry]
