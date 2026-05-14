# Phase 130: Foundation, Metadata, Broker Shim, Archive Lock - Research

**Researched:** 2026-05-14
**Domain:** FlashQuery MCP tool foundation, shared response envelopes, native tool metadata, broker shim, document write locks
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### D-01 Canonical Source Documents
- Downstream agents MUST read the external Macro Language requirements spec before planning or implementing Phase 130: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`.
- Downstream agents MUST read the external Macro Language test plan before planning or implementing Phase 130: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`.
- If local `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md` conflicts with those external docs for macro language behavior, treat the external requirements spec and test plan as the higher-fidelity source, then update local planning docs only through normal planning workflow.

### D-02 Response-Format Additions
- Implement only additive exports in `src/mcp/utils/response-formats.ts`.
- Preserve existing exports and helper behavior: `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `withWarnings`, `ErrorEnvelope`, `ToolResult`, `CANONICAL_ERROR_CODES`, and `WarningCode`.
- Add `MACRO_ERROR_CODES`, `MacroErrorCode`, `TraceStep`, `MacroExecutionResult`, `MacroDryRunResult`, `MacroSuccessPayload`, and `macroResult(payload)`.
- `TraceStep` is a flat record shape with no `children` support in v0: `kind`, optional `name`, `args`, `result`, `message`, required ISO `at`, and optional `elapsed_ms`.

### D-03 `call_macro` Metadata and Registrar Scaffold
- Add `D.callMacro` in `src/mcp/tool-metadata.ts` using the existing four-line description format: Summary, Use when, Do not use when, Example.
- Add a metadata entry equivalent to `current('call_macro', ['llm'], 'admin', D.callMacro, RECURSIVE_MODEL_REASON)` near `call_model`.
- Preserve existing legacy replacement behavior for `get_briefing` and `insert_doc_link`, which already point to `call_macro`.
- Add a new registrar, likely `src/mcp/tools/macro.ts`, with `registerMacroTools(server, config)`.
- Wire `registerMacroTools(server, config)` into `src/mcp/server.ts` after `registerLlmUsageTools(server, config)` and before schema validation.
- The Phase 130 handler is a safe scaffold only: it registers `call_macro` and returns a canonical not-implemented/unsupported response. Later phases replace the stub with full source validation and execution.

### D-04 Broker Shim
- Add `src/services/mcp-broker.ts`.
- Export `McpBroker` with at least `isConnected(serverId: string): Promise<boolean>` and `getToolHandler(serverId: string, toolName: string): ToolFn | null` or an equivalent callable type.
- Export `NullMcpBroker` where `isConnected(_)` always resolves `false` and `getToolHandler(_, _)` always returns `null`.
- Keep this shim independent from the future MCP Broker Support implementation; Phase 130 creates the seam, not the real broker.

### D-05 `archive_document` Lock Fix
- Update `src/mcp/tools/documents.ts` so `archive_document` mirrors the standard document write-lock pattern used by `remove_document`.
- When `config.locking.enabled` is true, acquire `acquireLock(supabaseManager.getClient(), config.instance.id, 'documents', { ttlSeconds: config.locking.ttlSeconds })` before mutation.
- If lock acquisition fails, return `jsonExpectedError({ error: 'conflict', message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.', details: { reason: 'lock_contention' } })`.
- Release the lock in `finally` using `releaseLock(supabaseManager.getClient(), config.instance.id, 'documents')`.
- Do not change archive semantics beyond lock acquisition/release.

### D-06 Test Obligations
- Add/extend unit tests for response-format macro exports and unchanged existing helpers.
- Add/extend unit tests for `call_macro` metadata, `RECURSIVE_MODEL_REASON`, delegated exclusion, and legacy replacements.
- Add unit tests for `NullMcpBroker`.
- Add unit tests for `archive_document` lock acquisition, release in `finally`, and lock-timeout conflict.
- Add integration coverage for `archive_document` lock behavior, including serialization with `remove_document` where feasible.
- If adding integration test files, update `tests/config/vitest.integration.config.ts` because integration tests use an explicit include list.

### the agent's Discretion
- Exact `ToolFn` type location for `McpBroker.getToolHandler`, as long as later macro dispatch can consume it without a rewrite.
- Whether the `call_macro` scaffold returns `unsupported` or `not_implemented`, provided it uses canonical expected-error semantics and does not pretend execution exists.
- Whether to create a dedicated `tests/unit/mcp-broker.test.ts` or group the shim tests with macro foundation tests, provided the test names map clearly to the test plan.

### Deferred Ideas (OUT OF SCOPE)
- Full request schema validation behavior beyond a safe scaffold lands in Phase 138.
- Parser, lexer, fence extraction, evaluator, builtins, shell verbs, dispatch permissions, task lifecycle, trace/progress modes, dry-run execution, budgets, source resolution, and scenario matrices land in Phases 131-138.
- Real MCP broker process/transport implementation is out of scope for v0 macro-support and remains a separate broker feature.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MACRO-RESP-01 | Real-run success returns the canonical `MacroExecutionResult` payload. | Add `MacroExecutionResult` and `MacroSuccessPayload` types now; execution populates them later. [CITED: FlashQuery Macro Language Requirements.md §6.8.1] |
| MACRO-RESP-02 | Dry-run returns `MacroDryRunResult` and never executes side-effecting tools. | Add `MacroDryRunResult` type now; dry-run implementation is deferred. [CITED: FlashQuery Macro Language Requirements.md §6.8.2] |
| MACRO-RESP-03 | Macro error codes are exported and stable. | Export `MACRO_ERROR_CODES` and derived `MacroErrorCode` from `response-formats.ts`. [CITED: FlashQuery Macro Language Requirements.md §6.8.3] |
| MACRO-RESP-04 | Macro response helpers are additive exports in `response-formats.ts`. | Add `macroResult(payload)` without modifying existing helpers. [VERIFIED: src/mcp/utils/response-formats.ts] |
| MACRO-OBS-01 | Trace steps are a flat ordered list with the specified kind/value shape. | Export flat `TraceStep`; do not include `children`. [CITED: FlashQuery Macro Language Requirements.md §6.7.1] |
| MACRO-INT-03 | `archive_document` acquires the standard document write lock. | Mirror `remove_document` lock acquisition and release pattern. [VERIFIED: src/mcp/tools/documents.ts, src/services/write-lock.ts] |
| MACRO-INT-05 | `call_macro` is registered in the MCP server and canonical tool metadata. | Add metadata entry and registrar wiring after `registerLlmUsageTools`. [VERIFIED: src/mcp/tool-metadata.ts, src/mcp/server.ts] |
| MACRO-INT-06 | A `NullMcpBroker` integration shim ships for v0 broker readiness. | Add `src/services/mcp-broker.ts` with interface and null implementation. [CITED: FlashQuery Macro Language Requirements.md §6.9.6] |
</phase_requirements>

## Summary

Phase 130 should be planned as a foundation-only slice: add shared macro types/helpers, expose `call_macro` as metadata plus a non-executing MCP scaffold, create a broker interface with a null implementation, and fix `archive_document` locking. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md] Do not plan parser, evaluator, source resolution, dry-run behavior, task lifecycle, progress, budgets, broker transport, or scenario matrices in this phase. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]

The exact implementation should follow existing FlashQuery patterns: ESM TypeScript, `server.registerTool`, Zod input schemas, JSON MCP response helpers, central tool metadata, and Vitest unit/integration tests. [VERIFIED: AGENTS.md] The current code already has direct precedents for each touch point: `response-formats.ts` has additive identification builders, `tool-metadata.ts` has the `current()` helper and `RECURSIVE_MODEL_REASON`, `server.ts` validates native schemas immediately after tool registration, and `remove_document` has the target write-lock pattern. [VERIFIED: src/mcp/utils/response-formats.ts, src/mcp/tool-metadata.ts, src/mcp/server.ts, src/mcp/tools/documents.ts]

**Primary recommendation:** Plan two focused work packets: one for macro response/metadata/scaffold/broker surfaces, and one for `archive_document` lock behavior plus integration include updates. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js `>=20`; `package.json` enforces this through the `engines` field. [VERIFIED: AGENTS.md, package.json]
- Code must remain TypeScript strict-mode ESM; do not introduce CommonJS `require`. [VERIFIED: AGENTS.md, package.json]
- Use `@modelcontextprotocol/sdk`; do not use `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- MCP handlers should use Zod for external input validation. [VERIFIED: AGENTS.md]
- MCP tool handlers should catch failures internally and return MCP `content` responses, with `isError: true` for runtime failures. [VERIFIED: AGENTS.md]
- Shared MCP tool responses use `{ content: [{ type: "text", text: "..." }] }`. [VERIFIED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; integration tests live under `tests/integration/*.test.ts`; E2E tests live under `tests/e2e/*.test.ts`. [VERIFIED: AGENTS.md]
- Integration/E2E tests require `.env.test`; this workspace has `.env.test` present. [VERIFIED: AGENTS.md, shell probe]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Macro response/type exports | API / Backend | MCP transport | Shared payload builders are server-side TypeScript helpers consumed by MCP handlers. [VERIFIED: src/mcp/utils/response-formats.ts] |
| `call_macro` metadata | API / Backend | LLM native tool registry | Metadata drives host exposure and delegated eligibility before tools reach provider-visible registries. [VERIFIED: src/mcp/tool-metadata.ts, src/llm/tool-registry.ts] |
| `call_macro` scaffold handler | API / Backend | MCP transport | The handler is registered on `McpServer` and should return a canonical expected-error scaffold. [VERIFIED: src/mcp/server.ts; CITED: Context7 /modelcontextprotocol/typescript-sdk] |
| Broker shim | API / Backend | External MCP service boundary | `McpBroker` abstracts future external MCP server connectivity; v0 ships `NullMcpBroker`. [CITED: FlashQuery Macro Language Requirements.md §6.9.6] |
| `archive_document` locking | API / Backend | Database / Storage | Tool-layer mutation must acquire the existing Supabase-backed `fqc_write_locks` lock before file/row writes. [VERIFIED: src/services/write-lock.ts, src/mcp/tools/documents.ts] |

## Standard Stack

### Core

| Library | Installed Version | Registry Current | Purpose | Why Standard |
|---------|-------------------|------------------|---------|--------------|
| Node.js | v24.7.0 local; project requires `>=20` | n/a | Runtime | Matches project engine constraint; no runtime change needed. [VERIFIED: shell probe, package.json] |
| TypeScript | `^6.0.2` | `6.0.3`, modified 2026-05-11 | Strict ESM source typing | Existing project compiler; do not upgrade inside Phase 130. [VERIFIED: package.json, npm registry] |
| `@modelcontextprotocol/sdk` | `^1.27.1` | `1.29.0`, modified 2026-03-30 | MCP server/tool registration | Existing dependency; `server.registerTool(name, config, handler)` is the current SDK pattern. [VERIFIED: package.json, npm registry; CITED: Context7 /modelcontextprotocol/typescript-sdk] |
| `zod` | `^4.3.6` | `4.4.3`, modified 2026-05-04 | Tool input schemas | Existing validation library and MCP SDK peer-compatible dependency. [VERIFIED: package.json, npm registry] |
| `@supabase/supabase-js` | `^2.100.0` | `2.105.4`, modified 2026-05-13 | Data operations and write-lock table access | Existing storage client used by write-lock service. [VERIFIED: package.json, npm registry, src/services/write-lock.ts] |
| Vitest | `^4.1.1` | `4.1.6`, modified 2026-05-11 | Unit/integration test runner | Existing project test framework. [VERIFIED: package.json, npm registry] |

### Supporting

| Library | Installed Version | Registry Current | Purpose | When to Use |
|---------|-------------------|------------------|---------|-------------|
| `tsup` | `^8.5.1` | `8.5.1`, modified 2025-11-12 | Production ESM build | Use `npm run build` as phase gate. [VERIFIED: package.json, npm registry] |
| `tsx` | `^4.21.0` | `4.21.0`, modified 2025-11-30 | Development TypeScript execution | No direct Phase 130 use beyond local dev parity. [VERIFIED: package.json, npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `NativeToolHandler`-compatible callable for broker handlers | New bespoke `ToolFn` type in `src/services/mcp-broker.ts` | Reusing or aliasing `NativeToolHandler` minimizes future dispatch adapter work; a bespoke type may drift from native tool catalog signatures. [VERIFIED: src/llm/tool-registry.ts; VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md] |
| `unsupported` error code for scaffold | `not_implemented` macro-specific code | `unsupported` is already canonical; `not_implemented` is not in current canonical or macro code lists, so using it would require expanding a locked code surface. [VERIFIED: src/mcp/utils/response-formats.ts; CITED: FlashQuery Macro Language Requirements.md §6.8.3] |
| Add integration test to existing `remove-document.integration.test.ts` | New `tests/integration/archive-document-lock.test.ts` | New file maps cleanly to Test Plan T-I-011 but requires updating the explicit include list. [VERIFIED: tests/config/vitest.integration.config.ts; CITED: FlashQuery Macro Language Test Plan.md §4.9.4] |

**Installation:**
```bash
# No package install is required for Phase 130.
```

**Version verification:** Versions above were verified with `npm view <package> version time.modified --json` on 2026-05-14. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
MCP client request
  |
  v
McpServer.registerTool("call_macro")
  |
  +--> Phase 130 scaffold handler
  |      |
  |      +--> jsonExpectedError({ error: "unsupported", ... })
  |
  v
Native tool catalog wrapper captures metadata and handler
  |
  v
validateAndCacheNativeToolSchemas(catalog)

archive_document request
  |
  v
shutdown guard
  |
  v
config.locking.enabled?
  |-- yes --> acquireLock(instance, "documents")
  |            |-- false --> jsonExpectedError(conflict / lock_contention)
  |            |-- true  --> continue
  |-- no  --> continue
  |
  v
existing archive mutation semantics
  |
  v
finally releaseLock(instance, "documents")
```

Every step above is server-side and additive to the existing MCP tool registration flow. [VERIFIED: src/mcp/server.ts, src/mcp/tools/documents.ts, src/services/write-lock.ts]

### Recommended Project Structure

```text
src/
├── mcp/
│   ├── tools/
│   │   └── macro.ts              # registerMacroTools scaffold
│   ├── tool-metadata.ts          # D.callMacro + TOOL_METADATA entry
│   └── utils/
│       └── response-formats.ts   # additive macro response exports
└── services/
    └── mcp-broker.ts             # McpBroker + NullMcpBroker

tests/
├── unit/
│   ├── response-formats.test.ts
│   ├── tool-metadata.test.ts
│   ├── mcp-broker.test.ts
│   └── archive-document.test.ts or documents-lock test
└── integration/
    └── archive-document-lock.test.ts
```

This layout follows existing file organization and phase context touch points. [VERIFIED: AGENTS.md; VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]

### Pattern 1: Additive Response Helper Exports

**What:** Add macro constants, types, and `macroResult(payload)` without changing existing helpers. [VERIFIED: src/mcp/utils/response-formats.ts]

**When to use:** This is required before later macro phases can type their execution/dry-run outputs. [CITED: FlashQuery Macro Language Requirements.md §6.8.1-§6.8.4]

**Example:**
```typescript
export const MACRO_ERROR_CODES = [
  'macro_aborted',
  'forbidden_tools',
  'unknown_server',
  'unknown_tool',
  'forbidden_path',
  'forbidden_shell_flag',
  'template_masquerade_tools_not_callable_from_macro',
  'budget_exceeded',
  'timeout',
  'tool_call_failed',
  'cancelled',
  'parse_error',
] as const;

export type MacroErrorCode = (typeof MACRO_ERROR_CODES)[number];

export interface TraceStep {
  kind: 'tool_call' | 'model_call' | 'log' | 'progress' | 'fail' | 'exit';
  name?: string;
  args?: unknown;
  result?: unknown;
  message?: string;
  at: string;
  elapsed_ms?: number;
}

export function macroResult(payload: MacroSuccessPayload): MacroSuccessPayload {
  return payload;
}
```

Source: canonical shape from Macro Requirements §7.1 and existing builder pattern from `maintenanceActionResult`. [CITED: FlashQuery Macro Language Requirements.md §7.1; VERIFIED: src/mcp/utils/response-formats.ts]

### Pattern 2: Tool Metadata Entry

**What:** Add `D.callMacro` and a `TOOL_METADATA` row near `call_model`. [VERIFIED: src/mcp/tool-metadata.ts]

**When to use:** Required for host exposure, delegated exclusion, registry schema validation, and description replacement. [VERIFIED: src/mcp/tool-catalog.ts, src/llm/tool-registry.ts]

**Example:**
```typescript
callMacro: description(
  'Run a FlashQuery macro as one structured orchestration request.',
  'Use when you need deterministic multi-step FlashQuery orchestration through call_macro.',
  'Do not use when you need direct model recursion or when the macro engine is not yet implemented.',
  'call_macro({ "source": "echo \\"hello\\"" })'
),

current('call_macro', ['llm'], 'admin', D.callMacro, RECURSIVE_MODEL_REASON),
```

The planner should keep `['llm']` because Phase 130 locked that category and the canonical spec lists the same equivalent. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md; CITED: FlashQuery Macro Language Requirements.md §6.9.5]

### Pattern 3: MCP Registrar Scaffold

**What:** Add `registerMacroTools(server, config)` under `src/mcp/tools/macro.ts` and wire it after `registerLlmUsageTools`. [VERIFIED: src/mcp/server.ts]

**When to use:** Phase 130 needs tool visibility and catalog capture, but not execution. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]

**Example:**
```typescript
export function registerMacroTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'call_macro',
    {
      description: 'Run a FlashQuery macro.',
      inputSchema: z.object({}).passthrough(),
    },
    async () => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }
      return jsonExpectedError({
        error: 'unsupported',
        message: 'call_macro is registered but macro execution is not implemented in this phase.',
        details: { reason: 'macro_engine_not_implemented' },
      });
    }
  );
}
```

The `registerTool` shape is current MCP SDK practice; the exact scaffold schema should remain minimal because full source validation is deferred by Phase 130 context. [CITED: Context7 /modelcontextprotocol/typescript-sdk; VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]

### Pattern 4: Archive Lock Fix

**What:** Copy the `remove_document` lock lifecycle into `archive_document`. [VERIFIED: src/mcp/tools/documents.ts]

**When to use:** Before any archive mutation when `config.locking.enabled` is true. [VERIFIED: src/mcp/tools/documents.ts]

**Example:**
```typescript
if (config.locking.enabled) {
  const locked = await acquireLock(
    supabaseManager.getClient(),
    config.instance.id,
    'documents',
    { ttlSeconds: config.locking.ttlSeconds }
  );
  if (!locked) {
    return jsonExpectedError({
      error: 'conflict',
      message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
      details: { reason: 'lock_contention' },
    });
  }
}

try {
  // existing archive_document behavior
} finally {
  if (config.locking.enabled) {
    await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
  }
}
```

Source: `remove_document` pattern and locked Phase 130 decision. [VERIFIED: src/mcp/tools/documents.ts; VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]

### Anti-Patterns to Avoid

- **Implementing macro execution early:** Parser, evaluator, dry-run, source resolution, task lifecycle, progress, budgets, and tool dispatch are deferred to later phases. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]
- **Changing existing response helper behavior:** Phase 130 is additive; existing exports must remain stable. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]
- **Using a non-canonical scaffold code:** `unsupported` is available; `not_implemented` is not currently canonical or macro-listed. [VERIFIED: src/mcp/utils/response-formats.ts; CITED: FlashQuery Macro Language Requirements.md §6.8.3]
- **Forgetting integration include list:** New integration tests will not run unless added to `tests/config/vitest.integration.config.ts`. [VERIFIED: tests/config/vitest.integration.config.ts]
- **Skipping lock release on thrown archive errors:** `releaseLock` must be in `finally`. [VERIFIED: src/mcp/tools/documents.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP tool registration | Custom MCP dispatch table | `server.registerTool` | Existing server/catalog wrappers depend on SDK registration interception. [VERIFIED: src/mcp/tool-catalog.ts; CITED: Context7 /modelcontextprotocol/typescript-sdk] |
| Response envelopes | Bespoke text or ad hoc JSON | `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `macroResult` | Existing tools rely on consistent MCP text JSON envelopes. [VERIFIED: src/mcp/utils/response-formats.ts] |
| Delegated exclusion policy | New hardcoded allowlist in macro handler | `TOOL_METADATA`, `RECURSIVE_MODEL_REASON`, `assembleNativeToolRegistry` | Current delegated tiers are metadata-derived and hard exclusions flow through the registry. [VERIFIED: src/mcp/tool-metadata.ts, src/llm/tool-registry.ts] |
| Write locking | New mutex/transaction layer | `acquireLock` / `releaseLock` | Existing distributed lock table already implements TTL, timeout, and release semantics. [VERIFIED: src/services/write-lock.ts] |
| Broker readiness | Real broker process management | `McpBroker` interface + `NullMcpBroker` | Real MCP Broker Support is out of scope; v0 needs only the seam. [CITED: FlashQuery Macro Language Requirements.md §3.2 and §6.9.6] |

**Key insight:** This phase is about compatibility surfaces, not macro language behavior; the planner should optimize for low blast radius and future phase unblockers. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Pulling Phase 138 Into Phase 130
**What goes wrong:** The `call_macro` scaffold grows full request/source validation because the canonical spec Phase 1 text mentions the production request schema. [CITED: FlashQuery Macro Language Requirements.md §8 Phase 1]
**Why it happens:** Local Phase 130 context intentionally narrows the slice and defers full request schema validation. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]
**How to avoid:** Plan only metadata and safe scaffold behavior; treat detailed schema/source tests as later phase work unless the user revises context. [VERIFIED: .planning/REQUIREMENTS.md]
**Warning signs:** Tasks mention `source_ref`, parser, dry-run execution, or `progressToken` implementation. [VERIFIED: .planning/REQUIREMENTS.md]

### Pitfall 2: Metadata Added But Not Catalog-Registered
**What goes wrong:** `call_macro` appears in `TOOL_METADATA` but no registrar adds it to the native catalog. [VERIFIED: src/mcp/server.ts, src/mcp/tool-catalog.ts]
**Why it happens:** Metadata and tool registration are separate systems. [VERIFIED: src/mcp/tool-metadata.ts, src/mcp/server.ts]
**How to avoid:** Add `registerMacroTools(server, config)` in `createMcpServer` after `registerLlmUsageTools` and before `validateAndCacheNativeToolSchemas`. [VERIFIED: src/mcp/server.ts; VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]
**Warning signs:** `assertRegisteredToolsHaveMetadata` passes but catalog tests do not include `call_macro`. [VERIFIED: tests/unit/mcp-server-tools.test.ts]

### Pitfall 3: Lock Release On Failed Acquisition
**What goes wrong:** `releaseLock` runs even when `acquireLock` returned false, potentially deleting another held lock for the same instance/resource. [VERIFIED: src/services/write-lock.ts]
**Why it happens:** A naive `finally` has no `lockAcquired` guard. [ASSUMED]
**How to avoid:** Either return before entering `try`, matching `remove_document`, or use a local `lockAcquired` boolean. [VERIFIED: src/mcp/tools/documents.ts]
**Warning signs:** `finally` cannot distinguish acquisition failure from later mutation failure. [ASSUMED]

### Pitfall 4: Type-Only Broker Shim That Cannot Dispatch Later
**What goes wrong:** `getToolHandler` returns a type incompatible with native tool handlers. [VERIFIED: src/llm/tool-registry.ts]
**Why it happens:** The context allows `ToolFn` discretion. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]
**How to avoid:** Export a callable type alias compatible with `NativeToolHandler` or reuse `NativeToolHandler` directly. [VERIFIED: src/llm/tool-registry.ts]
**Warning signs:** Later dispatch would need adapters for args/context/response shapes. [ASSUMED]

### Pitfall 5: Integration Test File Not Executed
**What goes wrong:** `tests/integration/archive-document-lock.test.ts` exists but is not in Vitest's explicit include list. [VERIFIED: tests/config/vitest.integration.config.ts]
**Why it happens:** Integration config does not glob all files. [VERIFIED: tests/config/vitest.integration.config.ts]
**How to avoid:** Add the new file path to `include`. [VERIFIED: tests/config/vitest.integration.config.ts]
**Warning signs:** `npm run test:integration -- archive-document-lock` finds zero tests or the full suite omits it. [ASSUMED]

## Code Examples

Verified patterns from current codebase:

### Capture Registered Tool Handlers In Unit Tests

```typescript
function createMockServer(): { server: McpServer; tools: Map<string, (params: unknown) => unknown> } {
  const tools = new Map<string, (params: unknown) => unknown>();
  const server = {
    registerTool: vi.fn((name: string, _schema: unknown, handler: (params: unknown) => unknown) => {
      tools.set(name, handler);
    }),
  } as unknown as McpServer;
  return { server, tools };
}
```

Use for `registerMacroTools` and `archive_document` unit coverage. [VERIFIED: tests/unit/advanced-document-tools.test.ts]

### Parse JSON MCP Text Responses

```typescript
function parseToolText(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '');
}
```

Use for macro result/helper tests. [VERIFIED: tests/unit/response-formats.test.ts]

### Broker Shim Shape

```typescript
import type { NativeToolHandler } from '../llm/tool-registry.js';

export type BrokerToolHandler = NativeToolHandler;

export interface McpBroker {
  isConnected(serverId: string): Promise<boolean>;
  getToolHandler(serverId: string, toolName: string): BrokerToolHandler | null;
}

export class NullMcpBroker implements McpBroker {
  async isConnected(_serverId: string): Promise<boolean> {
    return false;
  }

  getToolHandler(_serverId: string, _toolName: string): BrokerToolHandler | null {
    return null;
  }
}
```

This satisfies Phase 130 while preserving future dispatch compatibility. [VERIFIED: src/llm/tool-registry.ts; CITED: FlashQuery Macro Language Requirements.md §6.9.6]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Variadic `server.tool(...)` examples | `server.registerTool(name, { inputSchema }, handler)` | MCP TS SDK migration docs current in Context7 | New macro registrar should use `registerTool`. [CITED: Context7 /modelcontextprotocol/typescript-sdk] |
| Legacy key-value responses | JSON text payloads via response helpers | Phase 121 project pattern | Macro helpers must use JSON response conventions. [VERIFIED: src/mcp/utils/response-formats.ts] |
| Static delegated tiers | Metadata-derived delegated eligibility | Phase 129 project state | `call_macro` hard exclusion belongs in metadata, not a separate list. [VERIFIED: .planning/STATE.md, src/mcp/tool-metadata.ts] |
| Document mutations without consistent archive lock | `remove_document` uses `acquireLock`/`releaseLock` | Current code before Phase 130 | `archive_document` must be brought to the same pattern. [VERIFIED: src/mcp/tools/documents.ts] |

**Deprecated/outdated:**
- `@modelcontextprotocol/server`: forbidden by project instructions; use `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md]
- Full broker implementation in macro v0: explicitly out of scope; only null shim is planned. [CITED: FlashQuery Macro Language Requirements.md §3.2]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A naive `finally` without an acquisition guard can release a lock after failed acquisition. | Common Pitfalls | Planner may not require a test for lock-timeout no-release behavior. |
| A2 | Later dispatch would need adapters if broker handler types drift from `NativeToolHandler`. | Common Pitfalls | Broker shim might require rework in Phase 135. |
| A3 | Vitest may omit a new integration file unless included explicitly. | Common Pitfalls | Integration coverage could silently not run. |

## Open Questions (RESOLVED)

1. **RESOLVED: Scaffold input schema breadth**
   - What we know: Phase 130 context says full request schema validation is deferred to Phase 138. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]
   - What's unclear: The canonical requirements Phase 1 text proposes registering the canonical request schema in the foundation phase. [CITED: FlashQuery Macro Language Requirements.md §8 Phase 1]
   - Resolution: Phase 130 plans use a Zod-backed scaffold shape that accepts the future top-level fields but returns `unsupported` without source validation or execution. Full source validation remains Phase 138 scope. [RESOLVED: 130-01-PLAN.md]

2. **RESOLVED: Scaffold error code**
   - What we know: `unsupported` is canonical; `not_implemented` is not currently listed. [VERIFIED: src/mcp/utils/response-formats.ts; CITED: FlashQuery Macro Language Requirements.md §6.8.3]
   - What's unclear: The Phase 130 context allows unsupported or not-implemented semantics. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md]
   - Resolution: Phase 130 plans require `jsonExpectedError({ error: "unsupported", details: { reason: "phase_130_scaffold" } })`. [RESOLVED: 130-01-PLAN.md]

3. **RESOLVED: Integration serialization feasibility**
   - What we know: `.env.test` exists and integration config is sequential. [VERIFIED: shell probe, tests/config/vitest.integration.config.ts]
   - What's unclear: A deterministic concurrent `archive_document` + `remove_document` test may be hard without controlling lock timing. [ASSUMED]
   - Resolution: Phase 130 plans require deterministic lock serialization coverage through a held-lock proxy for the `archive_document` + `remove_document` threat; if direct timing is infeasible, the implementation summary must document the proxy rationale. [RESOLVED: 130-02-PLAN.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | yes | v24.7.0 | Project minimum is Node >=20. [VERIFIED: shell probe, package.json] |
| npm | Package scripts and `npm view` | yes | 11.5.1 | None needed. [VERIFIED: shell probe] |
| `.env.test` | Integration tests | yes | n/a | Tests skip gracefully when incomplete. [VERIFIED: shell probe, AGENTS.md] |
| Supabase credentials | Integration tests | not validated | n/a | Integration helpers can skip when env is incomplete. [VERIFIED: AGENTS.md] |
| Project graph | Graph context | no | n/a | Continue with source grep and docs. [VERIFIED: shell probe] |

**Missing dependencies with no fallback:**
- None found for research; implementation integration results still depend on valid `.env.test` values. [VERIFIED: shell probe, AGENTS.md]

**Missing dependencies with fallback:**
- Project graph absent; source/doc inspection was used instead. [VERIFIED: shell probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` installed; registry current `4.1.6`. [VERIFIED: package.json, npm registry] |
| Unit config file | `tests/config/vitest.unit.config.ts` by script. [VERIFIED: package.json] |
| Integration config file | `tests/config/vitest.integration.config.ts` with explicit include list. [VERIFIED: tests/config/vitest.integration.config.ts] |
| Quick run command | `npm test -- --run tests/unit/response-formats.test.ts tests/unit/tool-metadata.test.ts tests/unit/mcp-broker.test.ts tests/unit/archive-document.test.ts` [VERIFIED: package.json] |
| Full suite command | `npm test && npm run test:integration` [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MACRO-RESP-01 | `MacroExecutionResult` type/export shape | unit | `npm test -- --run tests/unit/response-formats.test.ts` | yes, extend existing. [VERIFIED: tests/unit/response-formats.test.ts] |
| MACRO-RESP-02 | `MacroDryRunResult` type/export shape | unit | `npm test -- --run tests/unit/response-formats.test.ts` | yes, extend existing. [VERIFIED: tests/unit/response-formats.test.ts] |
| MACRO-RESP-03 | `MACRO_ERROR_CODES` stable array and type | unit | `npm test -- --run tests/unit/response-formats.test.ts` | yes, extend existing. [VERIFIED: tests/unit/response-formats.test.ts] |
| MACRO-RESP-04 | Existing response helpers unchanged and `macroResult` additive | unit | `npm test -- --run tests/unit/response-formats.test.ts` | yes, extend existing. [VERIFIED: tests/unit/response-formats.test.ts] |
| MACRO-OBS-01 | `TraceStep` has flat shape and no `children` | unit/type | `npm test -- --run tests/unit/response-formats.test.ts` | yes, extend existing. [CITED: FlashQuery Macro Language Test Plan.md T-U-191/T-U-192] |
| MACRO-INT-03 | `archive_document` acquires/releases lock and returns conflict on timeout | unit + integration | `npm test -- --run tests/unit/archive-document.test.ts && npm run test:integration -- --run tests/integration/archive-document-lock.test.ts` | unit exists; integration new. [VERIFIED: tests/unit/archive-document.test.ts, tests/config/vitest.integration.config.ts] |
| MACRO-INT-05 | `call_macro` metadata and server registrar exist | unit | `npm test -- --run tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts` | yes, extend existing. [VERIFIED: tests/unit/tool-metadata.test.ts, tests/unit/mcp-server-tools.test.ts] |
| MACRO-INT-06 | `NullMcpBroker` returns disconnected/null handler | unit | `npm test -- --run tests/unit/mcp-broker.test.ts` | no, Wave 0. [CITED: FlashQuery Macro Language Test Plan.md T-U-231/T-U-232] |

### Sampling Rate

- **Per task commit:** `npm test -- --run <changed unit test files>` [VERIFIED: package.json]
- **Per wave merge:** `npm test && npm run test:integration -- --run tests/integration/archive-document-lock.test.ts` if the integration file is added. [VERIFIED: package.json, tests/config/vitest.integration.config.ts]
- **Phase gate:** `npm test && npm run test:integration && npm run build`. [VERIFIED: package.json]

### Wave 0 Gaps

- [ ] `tests/unit/mcp-broker.test.ts` - covers MACRO-INT-06. [CITED: FlashQuery Macro Language Test Plan.md T-U-231/T-U-232]
- [ ] `tests/unit/macro-tools.test.ts` or extend `tests/unit/mcp-server-tools.test.ts` - covers `registerMacroTools` scaffold and server wiring. [CITED: FlashQuery Macro Language Test Plan.md T-U-230]
- [ ] `tests/integration/archive-document-lock.test.ts` - covers MACRO-INT-03 integration. [CITED: FlashQuery Macro Language Test Plan.md T-I-011]
- [ ] `tests/config/vitest.integration.config.ts` include entry if a new integration test file lands. [VERIFIED: tests/config/vitest.integration.config.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no new auth | Existing MCP auth remains unchanged. [VERIFIED: src/mcp/server.ts] |
| V3 Session Management | no new session state | Phase 130 scaffold must not add server-side macro session state. [VERIFIED: AGENTS.md; VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md] |
| V4 Access Control | yes | Keep `call_macro` admin-tier and hard-excluded from delegated native access via `RECURSIVE_MODEL_REASON`. [VERIFIED: src/mcp/tool-metadata.ts] |
| V5 Input Validation | yes | Use Zod schema in `server.registerTool`; keep scaffold permissive only because execution is unsupported. [VERIFIED: AGENTS.md; CITED: Context7 /modelcontextprotocol/typescript-sdk] |
| V6 Cryptography | no | No cryptographic changes in this phase. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized delegated recursion into `call_macro` | Elevation of privilege | `current('call_macro', ['llm'], 'admin', D.callMacro, RECURSIVE_MODEL_REASON)` keeps it out of delegated tiers. [VERIFIED: src/mcp/tool-metadata.ts, src/llm/tool-registry.ts] |
| Race between archive and remove mutations | Tampering | Acquire `(instance, 'documents')` write lock before archive mutation and release in `finally`. [VERIFIED: src/services/write-lock.ts, src/mcp/tools/documents.ts] |
| Stub handler pretending execution succeeded | Spoofing | Return canonical expected-error scaffold; do not return `MacroExecutionResult` until execution exists. [VERIFIED: .planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md] |
| Future broker handler type mismatch | Tampering / reliability | Define broker handler callable compatible with native tool handler signatures. [VERIFIED: src/llm/tool-registry.ts] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/130-foundation-metadata-broker-shim-archive-lock/130-CONTEXT.md` - locked Phase 130 decisions and scope. [VERIFIED]
- `.planning/REQUIREMENTS.md` - phase requirement IDs and phase mapping. [VERIFIED]
- `.planning/ROADMAP.md` - Phase 130 goal and success criteria. [VERIFIED]
- `.planning/STATE.md` - prior metadata/delegated tier decisions. [VERIFIED]
- `AGENTS.md` - project conventions and constraints. [VERIFIED]
- `src/mcp/utils/response-formats.ts` - existing response helper patterns. [VERIFIED]
- `src/mcp/tool-metadata.ts` - metadata, descriptions, delegated exclusion, legacy replacement behavior. [VERIFIED]
- `src/mcp/server.ts` - registrar ordering and schema validation point. [VERIFIED]
- `src/mcp/tools/documents.ts` - `archive_document` and `remove_document` lock comparison. [VERIFIED]
- `src/services/write-lock.ts` - lock helper semantics. [VERIFIED]
- `src/llm/tool-registry.ts` and `src/mcp/tool-catalog.ts` - native handler and registry patterns. [VERIFIED]
- `tests/config/vitest.integration.config.ts` - explicit integration include list. [VERIFIED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md` - canonical macro requirements. [CITED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md` - canonical macro test obligations. [CITED]
- Context7 `/modelcontextprotocol/typescript-sdk` - current `registerTool` pattern. [CITED]
- npm registry - current versions and modified timestamps for core packages. [VERIFIED]

### Secondary (MEDIUM confidence)

- None. [VERIFIED: source hierarchy used primary docs/code/registry only]

### Tertiary (LOW confidence)

- Assumptions A1-A3 listed above require planner attention. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions and registry current versions were verified. [VERIFIED: package.json, npm registry]
- Architecture: HIGH - all phase touch points are existing code or locked context. [VERIFIED: source files and 130-CONTEXT.md]
- Pitfalls: MEDIUM - main risks are source-scope interpretation and concurrency test brittleness; both are documented with assumptions where not directly verified. [ASSUMED]

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 for codebase-specific patterns; package current-version claims should be refreshed after 7 days. [ASSUMED]
