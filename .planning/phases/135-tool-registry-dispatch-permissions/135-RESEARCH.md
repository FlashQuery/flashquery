# Phase 135: Tool Registry, Dispatch, Permissions - Research

**Researched:** 2026-05-14  
**Domain:** FlashQuery macro tool dispatch, native tool registry reuse, permission pre-scan, hard exclusions  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Source Of Truth
- Downstream research, planning, implementation, and verification agents MUST read the two macro-language source documents listed in `<canonical_refs>` before making assumptions about this phase.
- If the product requirements/test plan and local code differ, the requirements/test plan define the intended behavior unless the local code has an explicit newer phase decision in `.planning/STATE.md` or prior phase summaries.
- The frozen macro POC is an authoritative behavior reference only where it agrees with the requirements document; documented divergences in Requirements §5.4 override the POC.

### Dispatch Model
- Implement the flat `ToolRegistry = Record<string, ServerEntry>` shape, where `ServerEntry = { label: string, tools: Record<string, ToolFn> }` and `ToolFn = (arg: Record<string, Value>, ctx: CallContext) => Value | Promise<Value>`.
- Native FlashQuery tools live under the `fq` server entry and must dispatch through the same native tool catalog/handler path used by the agentic tool loop.
- Brokered tools and native tools must share one dispatcher code path; the engine should not special-case native dispatch after registry construction.
- Unknown servers must return `unknown_server`; unknown tools on a known server must return `unknown_tool` with an `available` list.

### Permission Enforcement
- Permission enforcement has three layers: registry construction from `assembleNativeToolRegistry`, static AST pre-scan, and dispatch-time backstop.
- Static pre-scan must walk the entire parsed macro AST before any statement executes, including nested branches, loops, expression-position calls, and statement-position calls.
- Permission failures must report the complete forbidden/unknown set at once and must produce zero side effects.
- Dispatch-time backstop must re-check the same allowlist immediately before handler invocation, even though normal execution should already have passed pre-scan.

### Hard Exclusions
- `fq.call_macro` must not appear in the in-macro registry and must surface as `unknown_tool` when referenced inside a macro.
- Template-masqueraded tools must be rejected with `template_masquerade_tools_not_callable_from_macro`, not collapsed into a generic `unknown_tool`.
- Host-emitted macros may call `fq.call_model` if allowed by the host allowlist.
- Delegated-emitted macros must not call `fq.call_model`; rejection must use `forbidden_tools` with reason `recursive_model_excluded_from_delegated_macros`.

### Caller Identity
- Do not add a user-controlled `callerKind` request field.
- Inbound MCP calls use the host allowlist.
- Agentic-loop-originated macro calls use the active purpose's allowlist.
- Reuse the existing FlashQuery call context and `assembleNativeToolRegistry` filtering rather than inventing a new identity mechanism.

### Testing Contract
- Unit coverage must include `macro-dispatcher`, `macro-permission-prescan`, `macro-hard-exclusions`, and `macro-caller-identity` behavior from Test Plan §4.6.
- Integration coverage must include real `fq.write_document` and `fq.search` dispatch through `tests/integration/macro-tool-dispatch.test.ts`.
- The implementation plan should preserve the exact verification commands from Requirements §8.8:
  - `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher`
  - `npm run test:integration -- --reporter=verbose macro-tool-dispatch`

### the agent's Discretion
- The exact file and function boundaries may follow the existing `src/macro/` implementation, but the requirements document recommends `src/macro/registry.ts`, `src/macro/permission-prescan.ts`, and `src/macro/dispatcher.ts`.
- The exact template-masquerade detection mechanism is implementation discretion as long as user-visible behavior matches Requirements §6.4.5.

### Deferred Ideas (OUT OF SCOPE)
- Real MCP broker transport/process management is not part of Phase 135.
- Direct macro-to-macro nesting remains out of scope.
- External MCP Tasks protocol behavior remains out of scope.
- Broader trace/progress/budget enforcement remains Phase 137 unless required only as a dependency stub.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-DISP-01 | Namespaced macro tool calls dispatch through a `(server, tool)` registry. | Use `ToolRegistry = Record<string, ServerEntry>` and the evaluator's existing `dispatchTool` seam, but build it from `getNativeToolCatalog` plus broker entries. [CITED: Macro Requirements §6.4.1, §7.2] [VERIFIED: src/macro/evaluator.ts] |
| MACRO-DISP-02 | Static permission pre-scan rejects denied or unknown tool references before side effects. | Add an AST walker matching existing preflight recursion and run it before `execBlock`; failures must aggregate references. [CITED: Macro Requirements §6.4.2] [VERIFIED: src/macro/evaluator.ts] |
| MACRO-DISP-03 | Dispatch-time permission backstop rejects references that bypass pre-scan. | Put the allowlist check in `dispatcher.ts` immediately before invoking `ToolFn`. [CITED: Macro Requirements §6.4.3] |
| MACRO-DISP-04 | `fq.call_macro` is universally unavailable from inside macros. | `call_macro` is already hard-excluded in metadata; the macro registry must omit it and report `unknown_tool`. [CITED: Macro Requirements §6.4.4] [VERIFIED: src/mcp/tool-metadata.ts] |
| MACRO-DISP-05 | Template-masqueraded tools are universally unavailable from inside macros. | Detect `templateReverseMap`/generated template tool names and return the specific macro error code. [CITED: Macro Requirements §6.4.5] [VERIFIED: src/llm/template-tools.ts] |
| MACRO-DISP-06 | Delegated-emitted macros cannot call `fq.call_model`. | Reuse `assembleNativeToolRegistry` hard-exclusion diagnostics and `RECURSIVE_MODEL_REASON`; do not duplicate a separate policy table. [CITED: Macro Requirements §6.4.6] [VERIFIED: src/llm/tool-registry.ts] |
| MACRO-DISP-07 | Caller identity is derived from existing FlashQuery call context. | The public request schema must not add `callerKind`; planner must define host vs purpose invocation through internal options/context only. [CITED: Macro Requirements §6.4.7] [VERIFIED: src/mcp/tools/macro.ts] |
</phase_requirements>

## Summary

Phase 135 is an internal wiring phase, not a new parser or broker feature. The locked design is to construct an in-macro `(server, tool)` registry from FlashQuery's native tool catalog plus broker entries, pre-scan the already-parsed macro AST for every namespaced tool call, and dispatch through a single `ToolFn` path with an allowlist backstop. [CITED: Macro Requirements §6.4, §7.2, §7.3] [VERIFIED: src/macro/types.ts, src/macro/evaluator.ts]

The existing codebase already has the main seams: macro AST nodes distinguish `ToolCall` and `ToolExistsCall`; `evaluateProgram` runs pre-execution scans before statements; `MacroInvocationContext` already has a `dispatchTool` hook; native tools are captured in a catalog by `wrapServerWithToolCatalog`; and the agent loop already uses `assembleNativeToolRegistry` plus `dispatchNativeToolCall`. [VERIFIED: src/macro/types.ts, src/macro/evaluator.ts, src/mcp/tool-catalog.ts, src/llm/tool-registry.ts, src/llm/tool-dispatcher.ts]

**Primary recommendation:** Plan three narrow modules, `src/macro/registry.ts`, `src/macro/permission-prescan.ts`, and `src/macro/dispatcher.ts`, then wire them into `evaluateProgram` as the next preflight stage and dispatch implementation while preserving the canonical requirements/test-plan-first instruction for every downstream agent. [CITED: Macro Requirements §8.8] [VERIFIED: .planning/phases/135-tool-registry-dispatch-permissions/135-CONTEXT.md]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20, TypeScript strict mode, ESM, `@modelcontextprotocol/sdk`, Supabase clients, Vitest, and existing helpers. [VERIFIED: AGENTS.md] [VERIFIED: package.json]
- Do not use CommonJS `require`; all source remains ESM. [VERIFIED: AGENTS.md] [VERIFIED: package.json]
- Do not use `@modelcontextprotocol/server`; the project uses `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md] [VERIFIED: package.json]
- Do not build a web UI; FlashQuery is CLI + MCP only. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP is stateless and project context is per-call. [VERIFIED: AGENTS.md]
- MCP tool handlers catch failures internally and return `{ content: [{ type: "text", text: "..." }] }`; error responses add `isError: true`. [VERIFIED: AGENTS.md] [VERIFIED: src/mcp/tools/macro.ts]
- External input validation uses Zod. [VERIFIED: AGENTS.md] [VERIFIED: src/mcp/tools/macro.ts]
- Integration and E2E tests require `.env.test`; the current workspace has `.env.test` present. [VERIFIED: AGENTS.md] [VERIFIED: shell test -f .env.test]
- Never use `npm link` for local development; use `npm run dev` or built `node dist/index.js`. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Macro AST permission pre-scan | API / Backend | — | Macro execution is in-process inside the MCP server, and the pre-scan must run before tool handler side effects. [CITED: Macro Requirements §6.4.2] |
| Native `fq.*` tool registry construction | API / Backend | MCP server registration layer | The native catalog is populated while registering MCP tools on `McpServer`, then consumed by backend macro execution. [VERIFIED: src/mcp/tool-catalog.ts, src/mcp/server.ts] |
| Brokered tool registry entries | API / Backend | External MCP broker boundary | The v0 `NullMcpBroker` exposes the broker seam; real broker transport is out of scope. [CITED: Macro Requirements §3.2] [VERIFIED: src/services/mcp-broker.ts] |
| Caller identity and purpose allowlist | API / Backend | Agent loop | Host calls and delegated/purpose-originated calls must derive identity from existing call context and `assembleNativeToolRegistry`, not from user request fields. [CITED: Macro Requirements §6.4.7] [VERIFIED: src/llm/tool-registry.ts] |
| Public `call_macro` schema | API / Backend | MCP transport | The request schema is registered as an MCP tool and must not accept `callerKind`. [CITED: Macro Requirements §6.4.7] [VERIFIED: src/mcp/tools/macro.ts] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | installed 6.0.2; npm latest 6.0.3 published 2026-04-16 | Macro implementation language | Project source is strict TypeScript ESM. [VERIFIED: npm list] [VERIFIED: npm registry] [VERIFIED: AGENTS.md] |
| @modelcontextprotocol/sdk | installed 1.27.1; npm latest 1.29.0 published 2026-03-30 | MCP server registration and transport types | Existing `McpServer` registration and tool catalog wrapping depend on this SDK. [VERIFIED: npm list] [VERIFIED: npm registry] [VERIFIED: src/mcp/tool-catalog.ts] |
| Chevrotain | installed/latest 12.0.0 published 2026-03-13 | Existing macro parser stack | Macro parser phases already use Chevrotain; Phase 135 consumes the typed AST rather than changing parser tech. [VERIFIED: npm list] [VERIFIED: npm registry] [CITED: Macro Requirements §3.1] |
| Zod | installed 4.3.6 | Tool schema validation | Native tool dispatcher validates handler args via Zod object schemas, and MCP request schemas use Zod. [VERIFIED: npm list] [VERIFIED: src/llm/tool-dispatcher.ts] [VERIFIED: src/mcp/tools/macro.ts] |
| Vitest | installed 4.1.1; npm latest 4.1.6 published 2026-05-11 | Unit and integration tests | Existing unit/integration configs and Test Plan §4.6 require Vitest suites. [VERIFIED: npm list] [VERIFIED: npm registry] [VERIFIED: tests/config/vitest.unit.config.ts, tests/config/vitest.integration.config.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @supabase/supabase-js / pg | package versions pinned in `package.json` | Integration tests for `fq.write_document` and `fq.search` side effects | Use only in integration coverage through real handlers; unit dispatcher tests should mock handlers. [VERIFIED: package.json] [CITED: Macro Test Plan §4.6.1] |
| shelljs / fast-glob | package versions pinned in `package.json` | Prior shell-verb phase support | Phase 135 should not alter shell execution except preserving pre-scan ordering. [VERIFIED: package.json] [VERIFIED: src/macro/shell-verbs.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing native catalog and `assembleNativeToolRegistry` | Direct imports of MCP tool modules | Direct imports violate INV-02 and would create a second dispatch path. [CITED: Macro Requirements INV-02] |
| Static AST pre-scan | Runtime-only permission checks | Runtime-only checks permit partial side effects before a later forbidden reference is reached. [CITED: Macro Requirements INV-07, §6.4.2] |
| Specific template-masquerade error | Generic `unknown_tool` | Requirements mandate the specific `template_masquerade_tools_not_callable_from_macro` code. [CITED: Macro Requirements §6.4.5] |

**Installation:** No dependency installation is recommended for this phase; use the repo-installed stack. [VERIFIED: package.json]

## Architecture Patterns

### System Architecture Diagram

```text
call_macro request / agent-loop macro emission
        |
        v
existing call context determines host or purpose identity
        |
        v
parse result: Program AST
        |
        v
buildToolRegistry(config, callerPurpose, broker, nativeCatalog)
        |                         |
        |                         +--> fq server entry from native catalog handlers
        |                         +--> broker server entries from broker when available
        v
preScanToolReferences(AST, registry, allowlist)
        |
        +--> unknown server/tool? -> expected error, no execution
        +--> forbidden/hard excluded? -> expected error, no execution
        |
        v
evaluate statements
        |
        v
dispatcher.dispatch(server, tool, arg, ctx)
        |
        +--> backstop allowlist check fails -> forbidden_tools, no handler call
        +--> registry lookup fails -> unknown_server / unknown_tool
        +--> handler throws / returns fatal isError -> tool_call_failed
        |
        v
native or broker ToolFn result -> macro value -> trace/result envelope
```

### Recommended Project Structure

```text
src/macro/
├── registry.ts              # build in-macro ToolRegistry and allowlist from native catalog + broker
├── permission-prescan.ts    # AST walker that gathers all ToolCall refs before execution
├── dispatcher.ts            # single dispatch path with lookup errors and allowlist backstop
├── evaluator.ts             # wire pre-scan before execBlock and call dispatcher from evalToolCall
└── types.ts                 # add shared ToolFn/ServerEntry/ToolRegistry types if not kept in registry.ts

tests/unit/
├── macro-dispatcher.test.ts
├── macro-permission-prescan.test.ts
├── macro-hard-exclusions.test.ts
└── macro-caller-identity.test.ts

tests/integration/
└── macro-tool-dispatch.test.ts
```

### Pattern 1: Native Catalog Reuse

**What:** Build the `fq` registry entry from `getNativeToolCatalog(server)` or an injected `NativeToolDefinition[]`, then wrap each `NativeToolDefinition.handler` as a macro `ToolFn`. [VERIFIED: src/mcp/tool-catalog.ts] [VERIFIED: src/llm/tool-registry.ts]

**When to use:** Use in production `call_macro` wiring and integration tests where real registered MCP handlers are available. [CITED: Macro Requirements §6.4.1]

**Example:**

```typescript
// Source: src/mcp/tool-catalog.ts + Macro Requirements §7.2
type ToolFn = (arg: Record<string, MacroValue>, ctx: MacroInvocationContext) => Promise<MacroValue> | MacroValue;

const fqTools = Object.fromEntries(
  nativeCatalog
    .filter((tool) => allowlist.has(tool.name))
    .map((tool) => [tool.name, async (arg, ctx) => {
      const result = await tool.handler(arg, ctx.nativeDispatchContext);
      return parseToolResultPayload(result);
    }])
);
```

### Pattern 2: AST Pre-Scan Mirrors Existing Preflight

**What:** Traverse `Program.statements` recursively and inspect every `ToolCall`, including `ToolCall` values nested in expressions, branch bodies, loops, and assignment RHS. [VERIFIED: src/macro/evaluator.ts] [CITED: Macro Requirements §6.4.2]

**When to use:** Run after parse and before `execBlock`, alongside `preScanForbiddenShellFlags`, `preflightProgram`, and input-var validation. [VERIFIED: src/macro/evaluator.ts]

**Example:**

```typescript
// Source: src/macro/evaluator.ts preflight recursion
function collectToolReferences(expr: Expr, refs: ToolReference[]): void {
  if (expr.kind === 'ToolCall') {
    refs.push({ server: expr.server, tool: expr.tool, line: expr.line });
    if (expr.arg) collectToolReferences(expr.arg, refs);
  }
  // Continue recursion through ObjectLit, ListLit, FieldAccess, BinaryExpr,
  // UnaryExpr, Pipeline, and Call args.
}
```

### Pattern 3: One Dispatcher, No Native Special Case

**What:** `dispatcher.ts` takes `(registry, allowlist, server, tool, arg, ctx)` and does server lookup, tool lookup, allowlist backstop, then invokes the resolved `ToolFn`. [CITED: Macro Requirements §6.4.1, §6.4.3]

**When to use:** Use for native `fq` and brokered servers; registry construction decides where handlers came from. [CITED: Macro Requirements §7.2]

**Example:**

```typescript
// Source: Macro Requirements §6.4.1-§6.4.3
if (!registry[server]) return unknownServer(server);
if (!registry[server].tools[tool]) return unknownTool(server, tool, Object.keys(registry[server].tools));
if (!allowlist.has(`${server}.${tool}`)) return forbiddenTools([`${server}.${tool}`], [...allowlist]);
return await registry[server].tools[tool](arg, ctx);
```

### Anti-Patterns to Avoid

- **Importing `src/mcp/tools/*` handlers directly into `src/macro`:** This contradicts INV-02 and bypasses the catalog/registry path used by agentic dispatch. [CITED: Macro Requirements INV-02] [VERIFIED: src/mcp/tool-catalog.ts]
- **Checking permissions only when `evalToolCall` executes:** This permits earlier mutation before a later denied call in another branch or loop body. [CITED: Macro Requirements §6.4.2]
- **Treating template-masqueraded tools as missing native tools:** Requirements mandate a distinct error code. [CITED: Macro Requirements §6.4.5]
- **Adding `callerKind` to the MCP schema:** Caller identity must come from existing context, not user input. [CITED: Macro Requirements §6.4.7] [VERIFIED: src/mcp/tools/macro.ts]
- **Letting `_exists()` route through dispatcher handlers:** Existing introspection tests prove `_exists()` is engine-resolved and does not call handlers. [VERIFIED: tests/unit/macro-introspection.test.ts] [VERIFIED: src/macro/introspection.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native tool allowlist | A new macro-specific permission table | `assembleNativeToolRegistry` | It already expands tiers, exclusions, host catalog filtering, and hard-excluded native tools. [VERIFIED: src/llm/tool-registry.ts] |
| Native handler discovery | Direct source imports or SDK internals | `wrapServerWithToolCatalog` / `getNativeToolCatalog` | The project already records handlers during MCP registration. [VERIFIED: src/mcp/tool-catalog.ts, src/mcp/server.ts] |
| Native argument validation | Custom JSON shape checks | Existing `NativeToolDefinition.inputSchema` and Zod parse path | The agentic dispatcher already validates raw Zod-shape args before handler invocation. [VERIFIED: src/llm/tool-dispatcher.ts] |
| Template masquerade detection | Filename heuristics alone | Existing `templateReverseMap` / generated template tool metadata | Template tools are already assembled into a reverse map for dispatch. [VERIFIED: src/llm/template-tools.ts, src/llm/tool-dispatcher.ts] |
| Broker availability | Real broker process management | `McpBroker` interface and `NullMcpBroker` | Real broker transport is deferred; v0 shim returns disconnected/null handlers. [CITED: Macro Requirements §3.2] [VERIFIED: src/services/mcp-broker.ts] |

**Key insight:** The hard part is preserving a single source of truth for tool visibility. Custom macro-only registries or permission maps will drift from host/delegated behavior and fail the caller-identity requirements. [CITED: Macro Requirements §7.3] [VERIFIED: src/llm/tool-registry.ts]

## Common Pitfalls

### Pitfall 1: Purpose-Only API Shape Does Not Model Host Calls Yet

**What goes wrong:** `assembleNativeToolRegistry` currently requires a `purposeName: string`; Requirements §6.4.7 says inbound MCP calls use a host/default allowlist. [VERIFIED: src/llm/tool-registry.ts] [CITED: Macro Requirements §6.4.7]

**Why it happens:** The existing function was built for delegated model-visible tools, not a host macro invocation. [VERIFIED: src/llm/tool-registry.ts] [VERIFIED: src/mcp/server.ts]

**How to avoid:** Plan an explicit host allowlist helper or host-caller branch that still uses the same metadata/catalog machinery and does not add request fields. [CITED: Macro Requirements §6.4.7]

**Warning signs:** Tests need to pass `callerKind`, or host tests construct a fake purpose just to get basic tools. [CITED: Macro Test Plan §4.6.4]

### Pitfall 2: Hard-Excluded `call_model` Conflicts With Host Macro Acceptance

**What goes wrong:** `call_model` has `delegatedHardExcludedReason`, so a naive call to `assembleNativeToolRegistry` will remove it even when Requirements say host-emitted macros may call it if allowed. [VERIFIED: src/mcp/tool-metadata.ts] [VERIFIED: src/llm/tool-registry.ts] [CITED: Macro Requirements §6.4.6]

**Why it happens:** Existing hard exclusions were designed for delegated model-visible native access. [VERIFIED: .planning/STATE.md]

**How to avoid:** Plan separate host vs delegated assembly semantics while reusing the same metadata source; delegated must retain `RECURSIVE_MODEL_REASON`, while host can include `call_model` when its host allowlist permits it. [CITED: Macro Requirements §6.4.6, §6.4.7]

**Warning signs:** T-U-167 cannot be written without weakening T-U-168. [CITED: Macro Test Plan §4.6.3]

### Pitfall 3: Returning Only the First Pre-Scan Failure

**What goes wrong:** The pre-scan reports one unknown or forbidden call and misses later references. [CITED: Macro Requirements §6.4.2]

**Why it happens:** It is tempting to throw during AST traversal. [ASSUMED]

**How to avoid:** Collect all references and classify them after traversal; then build a single envelope. [CITED: Macro Requirements §6.4.2]

**Warning signs:** T-U-161 or zero-side-effect tests fail. [CITED: Macro Test Plan §4.6.2]

### Pitfall 4: Treating Expression-Position Calls Differently

**What goes wrong:** Assignment RHS or condition-position `ToolCall` nodes bypass the pre-scan. [CITED: Macro Requirements §6.4.2]

**Why it happens:** `ToolCall` exists as both `Statement` and `Expr` in the AST. [VERIFIED: src/macro/types.ts]

**How to avoid:** Reuse recursive `preflightExpr`/`preflightStatement` structure and explicitly handle both forms. [VERIFIED: src/macro/evaluator.ts]

**Warning signs:** A macro like `x = fq.archive_document({...})` behaves differently from statement-position `fq.archive_document({...})`. [CITED: Macro Test Plan §4.6.2]

### Pitfall 5: Integration File Not Added To Explicit Include List

**What goes wrong:** `tests/integration/macro-tool-dispatch.test.ts` exists but never runs. [VERIFIED: tests/config/vitest.integration.config.ts]

**Why it happens:** The integration config uses an explicit `include` array, not a glob. [VERIFIED: tests/config/vitest.integration.config.ts]

**How to avoid:** Add the new integration file to `tests/config/vitest.integration.config.ts`. [VERIFIED: tests/config/vitest.integration.config.ts]

**Warning signs:** `npm run test:integration -- --reporter=verbose macro-tool-dispatch` finds no tests. [CITED: Macro Requirements §8.8]

## Code Examples

### Dispatch-Time Backstop Shape

```typescript
// Source: Macro Requirements §6.4.3
export async function dispatchMacroTool(input: {
  registry: ToolRegistry;
  allowlist: ReadonlySet<string>;
  server: string;
  tool: string;
  arg: Record<string, MacroValue>;
  context: MacroInvocationContext;
}): Promise<ToolResult> {
  const entry = input.registry[input.server];
  if (!entry) return unknownServer(input.server);
  const handler = entry.tools[input.tool];
  if (!handler) return unknownTool(input.server, input.tool, Object.keys(entry.tools));
  const fqName = `${input.server}.${input.tool}`;
  if (!input.allowlist.has(fqName)) return forbiddenTools([fqName], [...input.allowlist]);
  const value = await handler(input.arg, input.context);
  return macroResult(value);
}
```

### Native ToolFn Wrapper

```typescript
// Source: src/llm/tool-dispatcher.ts and src/mcp/tool-catalog.ts
function wrapNativeTool(tool: NativeToolDefinition, nativeContext: NativeToolDispatchContext): ToolFn {
  return async (arg) => {
    return await tool.handler(arg, nativeContext);
  };
}
```

### Pre-Scan Reference Collection

```typescript
// Source: src/macro/types.ts and src/macro/evaluator.ts
type ToolReference = { server: string; tool: string; line: number };

function collectFromStatement(statement: Statement, refs: ToolReference[]): void {
  if (statement.kind === 'ToolCall') refs.push(statement);
  if (statement.kind === 'Binding') collectFromExpr(statement.value, refs);
  if (statement.kind === 'ForLoop') {
    collectFromExpr(statement.iterable, refs);
    statement.body.forEach((child) => collectFromStatement(child, refs));
  }
  if (statement.kind === 'IfStmt') {
    collectFromExpr(statement.condition, refs);
    statement.thenBody.forEach((child) => collectFromStatement(child, refs));
    statement.elseBody?.forEach((child) => collectFromStatement(child, refs));
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy ad hoc native tool lists | Central metadata plus `assembleNativeToolRegistry` | Phases 116 and 129 per `.planning/STATE.md` | Macro permissions should reuse metadata-derived visibility. [VERIFIED: .planning/STATE.md] [VERIFIED: src/llm/tool-registry.ts] |
| Template tools mixed into provider-visible dispatch | Template tools tracked through `templateReverseMap` and dispatched separately in agent loop | Phase 118 per `.planning/STATE.md` | Macro must reject masqueraded template tool names instead of invoking them. [VERIFIED: .planning/STATE.md] [VERIFIED: src/llm/template-tools.ts] |
| Macro POC accepted all tool calls | Production spec requires static pre-scan plus dispatch backstop | Requirements finalized 2026-05-14 | Planner must add new production-only permission modules. [CITED: Macro Requirements §5.4, §6.4.2, §6.4.3] |

**Deprecated/outdated:**
- POC behavior where template-masqueraded tools are not specially rejected is outdated; production must emit `template_masquerade_tools_not_callable_from_macro`. [CITED: Macro Requirements §5.4, §6.4.5]
- Direct macro-to-macro nesting is out of scope and `fq.call_macro` must remain unavailable in macros. [CITED: Macro Requirements §3.2, §6.4.4]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Throwing during AST traversal is a likely implementation temptation. | Common Pitfalls | Low; only affects explanatory rationale, not the required behavior. |

## Open Questions

1. **How exactly should host allowlist assembly be represented in code?**
   - What we know: Requirements say inbound MCP calls use host allowlist and no `callerKind` request field. [CITED: Macro Requirements §6.4.7]
   - What's unclear: Existing `assembleNativeToolRegistry` currently accepts a required `purposeName: string`, so a host path may need a new helper or optional-purpose overload. [VERIFIED: src/llm/tool-registry.ts]
   - Recommendation: Planner should create an early task to define `MacroCallerContext` or equivalent internal options and extend/reuse registry assembly without changing the public schema. [CITED: Macro Requirements §6.4.7]

2. **Where will production `NativeToolDispatchContext` come from for macro native dispatch?**
   - What we know: `dispatchNativeToolCall` requires signal, instanceId, and optional logging context. [VERIFIED: src/llm/tool-dispatcher.ts]
   - What's unclear: `evaluateProgram` currently has no native dispatch context field. [VERIFIED: src/macro/evaluator.ts]
   - Recommendation: Planner should add a typed native dispatch context to macro execution options, with tests using deterministic mock contexts. [VERIFIED: src/llm/tool-dispatcher.ts]

3. **Should macro dispatcher call `dispatchNativeToolCall` or wrap `NativeToolDefinition.handler` directly?**
   - What we know: Requirements say route to the same handlers made available to the agent loop, and the existing dispatcher validates args with Zod before handler invocation. [CITED: Macro Requirements §6.4.1] [VERIFIED: src/llm/tool-dispatcher.ts]
   - What's unclear: `dispatchNativeToolCall` returns an agent-loop tool message/log shape, not a macro `ToolResult`/`Value` shape. [VERIFIED: src/llm/tool-dispatcher.ts]
   - Recommendation: Use the same catalog and handler path; reuse or extract argument validation if needed, but do not force macro results through LLM tool-message envelopes. [CITED: Macro Requirements §7.4]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | v24.7.0 | Node >=20 is required; current version satisfies this. [VERIFIED: shell node --version] [VERIFIED: AGENTS.md] |
| npm | Test commands and package scripts | yes | 11.5.1 | none needed. [VERIFIED: shell npm --version] |
| Vitest | Unit/integration tests | yes | 4.1.1 installed | Use npm scripts. [VERIFIED: npm list] |
| TypeScript | Build/typecheck via tsup/tsc | yes | 6.0.2 installed | Use repo scripts. [VERIFIED: npm list] |
| `.env.test` | Integration `macro-tool-dispatch` tests | yes | present | Integration tests skip or fail depending on missing credentials; file exists here. [VERIFIED: shell test -f .env.test] |
| Supabase CLI / psql | Manual DB inspection | not found in PATH | — | Integration tests use configured Supabase env; planner should not require CLI-only setup for Phase 135. [VERIFIED: shell command -v] |

**Missing dependencies with no fallback:**
- None identified for planning; actual integration pass still depends on valid `.env.test` credentials and reachable Supabase. [VERIFIED: AGENTS.md] [VERIFIED: shell test -f .env.test]

**Missing dependencies with fallback:**
- Supabase CLI / `psql` are absent, but Phase 135 integration tests can run through existing npm/Vitest harness without CLI-specific tasks. [VERIFIED: shell command -v] [VERIFIED: tests/config/vitest.integration.config.ts]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 installed. [VERIFIED: npm list] |
| Config file | Unit: `tests/config/vitest.unit.config.ts`; integration: `tests/config/vitest.integration.config.ts`. [VERIFIED: tests/config/vitest.unit.config.ts, tests/config/vitest.integration.config.ts] |
| Quick run command | `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` [CITED: Macro Requirements §8.8] |
| Full suite command | `npm run test:integration -- --reporter=verbose macro-tool-dispatch` plus relevant unit command. [CITED: Macro Requirements §8.8] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MACRO-DISP-01 | Dispatch `fq.search`, unknown server/tool, broker mock dispatch | unit + integration | `npm test -- --reporter=verbose macro-dispatcher` and `npm run test:integration -- --reporter=verbose macro-tool-dispatch` | no; Wave 0 [CITED: Macro Test Plan §4.6.1] |
| MACRO-DISP-02 | Static pre-scan rejects forbidden/unknown refs and lists multiples before side effects | unit | `npm test -- --reporter=verbose macro-permission-prescan` | no; Wave 0 [CITED: Macro Test Plan §4.6.2] |
| MACRO-DISP-03 | Dispatch backstop refuses injected forbidden ref | unit | `npm test -- --reporter=verbose macro-permission-prescan` | no; Wave 0 [CITED: Macro Test Plan §4.6.2] |
| MACRO-DISP-04 | `fq.call_macro` returns `unknown_tool` | unit | `npm test -- --reporter=verbose macro-hard-exclusions` | no; Wave 0 [CITED: Macro Test Plan §4.6.3] |
| MACRO-DISP-05 | Template-masquerade ref returns specific macro error code | unit | `npm test -- --reporter=verbose macro-hard-exclusions` | no; Wave 0 [CITED: Macro Test Plan §4.6.3] |
| MACRO-DISP-06 | Host can call `fq.call_model`; delegated cannot | unit | `npm test -- --reporter=verbose macro-hard-exclusions` | no; Wave 0 [CITED: Macro Test Plan §4.6.3] |
| MACRO-DISP-07 | Host vs agentic-loop caller identity; no `callerKind` schema | unit | `npm test -- --reporter=verbose macro-caller-identity` | no; Wave 0 [CITED: Macro Test Plan §4.6.4] |

### Sampling Rate

- **Per task commit:** `npm test -- --reporter=verbose macro-registry macro-permission-prescan macro-dispatcher` [CITED: Macro Requirements §8.8]
- **Per wave merge:** `npm run test:integration -- --reporter=verbose macro-tool-dispatch` [CITED: Macro Requirements §8.8]
- **Phase gate:** Both required commands green before `$gsd-verify-work`; add new integration file to explicit include list before relying on the command. [CITED: Macro Requirements §8.8] [VERIFIED: tests/config/vitest.integration.config.ts]

### Wave 0 Gaps

- [ ] `tests/unit/macro-dispatcher.test.ts` — covers T-U-156 through T-U-159. [CITED: Macro Test Plan §4.6.1]
- [ ] `tests/unit/macro-permission-prescan.test.ts` — covers T-U-160 through T-U-164. [CITED: Macro Test Plan §4.6.2]
- [ ] `tests/unit/macro-hard-exclusions.test.ts` — covers T-U-165 through T-U-168. [CITED: Macro Test Plan §4.6.3]
- [ ] `tests/unit/macro-caller-identity.test.ts` — covers T-U-169 through T-U-171. [CITED: Macro Test Plan §4.6.4]
- [ ] `tests/integration/macro-tool-dispatch.test.ts` — covers T-I-003 and T-I-004. [CITED: Macro Test Plan §4.6.1]
- [ ] `tests/config/vitest.integration.config.ts` — add the new integration test to the explicit include array. [VERIFIED: tests/config/vitest.integration.config.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase 135 does not change MCP authentication; it runs inside existing handler context. [VERIFIED: src/mcp/tools/macro.ts] |
| V3 Session Management | partial | Do not add server-side session state; caller identity is internal context only. [VERIFIED: AGENTS.md] [CITED: Macro Requirements §6.4.7] |
| V4 Access Control | yes | `assembleNativeToolRegistry` allowlist, static pre-scan, and dispatch backstop. [CITED: Macro Requirements §7.3] [VERIFIED: src/llm/tool-registry.ts] |
| V5 Input Validation | yes | Zod schemas for MCP/native tool args; macro pre-scan before side effects. [VERIFIED: src/mcp/tools/macro.ts, src/llm/tool-dispatcher.ts] [CITED: Macro Requirements §6.4.2] |
| V6 Cryptography | no | Phase 135 does not introduce cryptography. [CITED: Macro Requirements §8.8] |

### Known Threat Patterns for Macro Dispatch

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User-controlled caller identity escalation | Elevation of Privilege | Do not expose `callerKind`; derive identity from existing context. [CITED: Macro Requirements §6.4.7] |
| Forbidden write after earlier side effects | Tampering | Full AST pre-scan before any statement execution. [CITED: Macro Requirements INV-07, §6.4.2] |
| Bypassing pre-scan through direct dispatcher call | Elevation of Privilege | Dispatch-time allowlist backstop before handler invocation. [CITED: Macro Requirements §6.4.3] |
| Template masquerade invoked as call-and-return macro tool | Tampering / Confused Deputy | Reject with `template_masquerade_tools_not_callable_from_macro`. [CITED: Macro Requirements §6.4.5] |
| Delegated model recursion through `fq.call_model` | Elevation of Privilege / Denial of Service | Reuse `RECURSIVE_MODEL_REASON` hard exclusion for delegated emitters. [CITED: Macro Requirements §6.4.6] [VERIFIED: src/mcp/tool-metadata.ts] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/135-tool-registry-dispatch-permissions/135-CONTEXT.md` - locked phase decisions and canonical refs. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - REQ-027 through REQ-033, §7.2, §7.3, §8.8. [CITED: local requirements file]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - Test Plan §4.6 T-U-156 through T-U-171 and T-I-003/T-I-004. [CITED: local test plan]
- `AGENTS.md` - project stack, conventions, constraints. [VERIFIED: file read]
- `src/macro/evaluator.ts`, `src/macro/types.ts`, `src/macro/introspection.ts` - current macro evaluator/tool-call seams. [VERIFIED: codebase grep/read]
- `src/mcp/tool-catalog.ts`, `src/llm/tool-registry.ts`, `src/llm/tool-dispatcher.ts`, `src/mcp/tool-metadata.ts`, `src/llm/template-tools.ts` - native registry, dispatch, hard-exclusion, and template-masquerade patterns. [VERIFIED: codebase grep/read]
- POC files `macro-prototype/src/types.ts`, `src/mockfq.ts`, `src/mockbrokers.ts`, `src/evaluator.ts` - dispatch shape reference where not superseded by requirements. [CITED: local POC files]
- npm registry lookups for package current versions. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` - milestone history and phase mapping. [VERIFIED: file read]
- Project skills under `.agents/skills/` - scenario/integration testing conventions for downstream agents. [VERIFIED: file read]

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - local installed package versions and npm registry versions were checked. [VERIFIED: npm list] [VERIFIED: npm registry]
- Architecture: HIGH - locked requirements align with existing macro and agentic registry seams. [CITED: Macro Requirements §6.4] [VERIFIED: src/macro/evaluator.ts, src/llm/tool-registry.ts]
- Pitfalls: HIGH for code-backed pitfalls; LOW only for the one implementation-temptation assumption logged as A1. [VERIFIED: codebase grep/read] [ASSUMED]

**Research date:** 2026-05-14  
**Valid until:** 2026-05-21 for package currency; codebase findings remain valid until the macro/LLM registry files change.
