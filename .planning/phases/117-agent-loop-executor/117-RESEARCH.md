# Phase 117: Agent Loop Executor - Research

**Researched:** 2026-05-06  
**Domain:** FlashQuery `call_model` Mode 2 agent loop execution  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Mandatory Source Documents

- Downstream research, planning, implementation, and verification agents MUST read the canonical references listed below before deciding behavior, file ownership, or test scope.
- `Agentic-LLM-Tool-Loop.md` is the authoritative requirements and architecture source for Mode 2 loop execution.
- `Document Reference System.md` is the authoritative contract for template-tool masquerade behavior and model-initiated template dispatch failures.
- `ATL Test Plan.md` is the authoritative coverage source for Phase 117 tests.

### Mode 2 Loop Contract

- Mode 2 is selected when the final assembled model-visible tool registry is non-empty.
- Discovery resolvers are outside the mode taxonomy and must not run the loop.
- Caller-provided tools / Mode 3 cooperative dispatch are deferred and must remain rejected or out of scope for v1.
- The loop executor appends assistant messages containing `tool_calls`, dispatches tool calls, appends `role: "tool"` messages keyed by `tool_call_id`, and continues until final assistant text or a stop condition.
- Multiple tool calls in one assistant turn dispatch with `Promise.allSettled` semantics. Individual failures are returned to the model as tool error payloads; successful calls still produce result messages.
- Native delegated tool calls dispatch through internal FlashQuery handlers, not through an exposed MCP server.
- Template-tool masquerade calls are model-initiated tool dispatch failures on invalid args/template resolution, not host reference-resolution failures; the model gets a tool error message and may recover.

### Guardrails And Usage

- Enforce `timeout_ms`, `max_iterations`, `max_tokens_budget`, and `max_cost_usd` before starting the next model call.
- `timeout_ms` is a wall-clock deadline around the whole loop and must be checked before LLM calls, before tool dispatch, and after tool dispatch.
- `max_iterations` is checked before starting the next model round.
- Token and cost budgets use cumulative actual usage plus an estimate for the prospective next call.
- Mode 2 writes exactly one aggregate `fqc_llm_usage` row per completed `call_model` invocation through the existing cost tracker/shutdown drain.
- Per-iteration detail lives only in `metadata.tools.calls_log`, not in per-iteration database rows.
- Token arithmetic invariants must hold: calls-log input/output token sums equal aggregate metadata input/output tokens, including fallback cases.

### Metadata And Messages

- Successful model/purpose envelopes keep `response` as the durable primary output.
- `messages` is `[]` unless `return_messages: true`; when true, it returns the post-hydration conversation the model saw plus the final assistant message.
- `metadata.tools` is present for Mode 2 only and includes stop reason, calls log, exposed tool diagnostics, aggregate usage/cost details, and enough metadata to validate loop execution.
- Tool result messages use OpenAI-compatible `role: "tool"` messages with `tool_call_id` and JSON-stringified content.

### Tests

- Phase 117 must ship runnable unit, E2E, and directed scenario tests with a deterministic mock provider.
- Required coverage includes native tool loops, parallel tool calls, guardrail stops, fallback, usage aggregation, and calls-log metadata invariants.
- Use the ATL Test Plan provisional rows as traceability, especially ATL-U-13, ATL-U-14, ATL-E2E-02, ATL-E2E-03, ATL-E2E-06, ATL-E2E-07, ATL-DS-09, ATL-DS-12, ATL-DS-13, and VAL-117.

### Out Of Scope

- Mode 3 cooperative loop.
- MCP Broker external server routing.
- Audit document writes.
- Provider streaming.
- Path-level scoped write access.
- Model-initiated response references.

### the agent's Discretion

## Specific Ideas

- Prefer an `AgentLoopExecutor` / loop-executor module outside `src/llm/client.ts`; the client remains provider transport and response normalization.
- Reuse `src/llm/tool-registry.ts` outputs from Phase 116 for the final registry and provider tool schemas.
- Dispatch should work from an immutable per-call registry snapshot.
- Use centralized LLM constants/types already created in previous phases rather than scattering string literals for stop reasons, finish reasons, message roles, or hard-excluded tools.
- Tests should include a deterministic mock provider able to script tool-call responses, multiple tool calls, fallback, missing usage, finish reason variants, and request capture.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- MCP Broker and external tool routing.
- Mode 3 caller-owned tool dispatch.
- Vault audit document persistence for loop traces.
- Streaming / incremental loop output.
- Scoped write access by vault path.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOOP-01 | `call_model` Mode 2 runs a FlashQuery-managed loop when a purpose exposes native tools, template tools, or both. | Mode selection must use the final non-empty model-visible registry, and Phase 117 should implement native-tool Mode 2 while leaving template-tool dispatch hooks for Phase 118. [VERIFIED: 117-CONTEXT.md; CITED: Agentic-LLM-Tool-Loop.md] |
| LOOP-02 | Loop executor appends assistant tool-call messages, dispatches returned calls, appends tool result messages, and continues until final response or stop. | The existing `LlmChatMessage` shape already supports assistant `tool_calls` and `role: "tool"` messages; the missing piece is the executor state machine. [VERIFIED: src/llm/types.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| LOOP-03 | Multiple tool calls in one assistant message use `Promise.allSettled` semantics and return individual errors to the model. | Planner should require a dispatcher that turns each settled result into one tool message, preserving successful calls when siblings fail. [CITED: Agentic-LLM-Tool-Loop.md; VERIFIED: 117-CONTEXT.md] |
| LOOP-04 | Guardrails enforce timeout, iteration, token, and cost budgets before the next model call. | Budget checks are pre-call stops using cumulative actual usage plus estimated next-call usage. [CITED: Agentic-LLM-Tool-Loop.md] |
| LOOP-05 | Existing purpose fallback works across chat iterations, preserving completed iteration history when fallback is selected. | `PurposeResolver.chatByPurpose()` already preserves fallback position per call, but currently records usage through `OpenAICompatibleLlmClient.chatByPurpose()`, so Phase 117 needs a non-recording per-round chat path. [VERIFIED: src/llm/resolver.ts; VERIFIED: src/llm/client.ts] |
| LOOP-06 | Mode 2 writes exactly one aggregate `fqc_llm_usage` row via the existing cost tracker drain. | `recordLlmUsage()` already writes one row asynchronously and participates in shutdown drain; the executor must call it once with aggregate totals and avoid `client.chatByPurpose()` per-iteration writes. [VERIFIED: src/llm/cost-tracker.ts; VERIFIED: src/llm/client.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| LOOP-07 | Mode 2 metadata includes calls log, aggregate tokens/cost, stop reason, diagnostics, and token arithmetic invariants. | Current `CallModelMetadata.tools` only has `native_tool_names` and diagnostics; it must be expanded for Mode 2 loop metadata. [VERIFIED: src/llm/types.ts; VERIFIED: src/mcp/tools/llm.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| TOOL-05 | Delegated native tool calls dispatch internally through FlashQuery handlers. | Current catalog captures name/description/input schema only; Phase 117 must capture or adapt handlers for internal dispatch without exposing an MCP server. [VERIFIED: src/mcp/tool-catalog.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| TOOL-06 | Tool result messages use OpenAI-compatible `tool` role messages keyed by `tool_call_id` with JSON-stringified raw results. | OpenAI-compatible chat completions use tool messages keyed by `tool_call_id`; product docs require JSON-stringified content. [CITED: https://platform.openai.com/docs/api-reference/chat/create-chat-completion; CITED: Agentic-LLM-Tool-Loop.md] |
| VAL-117 | Phase ships runnable unit, E2E, and directed scenario tests with deterministic mock provider. | Existing directed scenarios already embed deterministic OpenAI-compatible mock providers and can be extended for scripted multi-round responses. [VERIFIED: tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py; CITED: ATL Test Plan.md] |
</phase_requirements>

## Summary

Phase 117 should be planned as a loop-orchestration and internal-dispatch phase, not as provider protocol research. The provider-facing primitives already exist: `chat()` normalizes assistant messages, parsed tool-call arguments, usage, finish reasons, and missing-usage failures; Phase 116 already assembles provider tool schemas from the native MCP catalog. [VERIFIED: src/llm/client.ts; VERIFIED: src/llm/tool-registry.ts; VERIFIED: 116-VERIFICATION.md]

The highest-risk implementation fact is that `OpenAICompatibleLlmClient.chatByPurpose()` currently records an `fqc_llm_usage` row for each chat call. Mode 2 needs multiple chat round trips but exactly one aggregate usage row, so the planner must include a first-class non-recording purpose-chat path or inject `PurposeResolver`/HTTP-only chat into the executor. [VERIFIED: src/llm/client.ts; VERIFIED: src/llm/cost-tracker.ts; CITED: Agentic-LLM-Tool-Loop.md]

**Primary recommendation:** Build `src/llm/agent-loop.ts` around an immutable per-call registry snapshot, a registry-owned internal dispatcher, a non-recording purpose chat function, and a single aggregate `recordLlmUsage()` call at loop completion. [VERIFIED: 117-CONTEXT.md; VERIFIED: src/llm/tool-registry.ts; VERIFIED: src/llm/cost-tracker.ts]

## Project Constraints (from AGENTS.md)

- FlashQuery is CLI + MCP only; do not plan a web UI. [VERIFIED: AGENTS.md]
- Runtime is Node.js >= 20 and TypeScript ESM strict mode. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- MCP SDK package is `@modelcontextprotocol/sdk`; do not use `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md; VERIFIED: package.json]
- MCP tool handlers return `{ content: [{ type: "text", text: "..." }] }`; failures add `isError: true`. [VERIFIED: AGENTS.md; VERIFIED: src/mcp/tools/llm.ts]
- Use Zod for external input validation. [VERIFIED: AGENTS.md; VERIFIED: src/mcp/tools/llm.ts]
- Use async/await throughout. [VERIFIED: AGENTS.md]
- Avoid server-side session state; MCP is stateless and project context is per-call. [VERIFIED: AGENTS.md]
- Tests are Vitest unit/integration/E2E plus Python directed scenarios; integration/E2E read `.env.test`. [VERIFIED: AGENTS.md; VERIFIED: package.json; VERIFIED: tests/helpers/test-env.ts]
- Do not use `npm link` for local development. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Mode 2 loop state machine | API / Backend | Provider transport | The MCP tool handler receives the request, but loop state belongs in a backend `src/llm` executor while provider calls stay in `client.ts`. [VERIFIED: src/mcp/tools/llm.ts; VERIFIED: src/llm/client.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| Native tool dispatch | API / Backend | Database / Storage | Delegated tool calls must invoke FlashQuery handlers in-process and may read/write Supabase/vault through existing tools. [VERIFIED: src/mcp/tools/*.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| Provider tool-call protocol | Provider transport | API / Backend | `chat()` already normalizes provider messages; executor should consume normalized `LlmChatResult` only. [VERIFIED: src/llm/client.ts] |
| Usage aggregation | API / Backend | Database / Storage | Executor aggregates completed chat usage and writes one row via `recordLlmUsage()` into `fqc_llm_usage`. [VERIFIED: src/llm/cost-tracker.ts; VERIFIED: src/storage/supabase.ts] |
| Guardrail enforcement | API / Backend | Provider transport | Budget checks decide whether another provider call may start; HTTP timeout remains provider-level and loop timeout is wall-clock. [VERIFIED: src/llm/client.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| Response envelope | API / Backend | Browser / Client = — | FlashQuery returns an MCP text payload containing JSON; no frontend tier participates. [VERIFIED: src/mcp/tools/llm.ts; VERIFIED: AGENTS.md] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | >=20 in project, local v24.7.0 | Runtime for CLI/MCP server and test scripts. | Project engines enforce Node >=20; local environment satisfies it. [VERIFIED: package.json; VERIFIED: `node --version`] |
| TypeScript / ESM | package `typescript` ^6.0.2, `"type": "module"` | Strict typed implementation with ESM imports. | Existing codebase uses `.js` import specifiers and ESM output. [VERIFIED: package.json; VERIFIED: src/llm/client.ts] |
| `@modelcontextprotocol/sdk` | project ^1.27.1, registry latest 1.29.0 | MCP server and `registerTool()` surface. | Current SDK docs show `server.registerTool(name, config, handler)` with input schema and handler callback. [VERIFIED: package.json; VERIFIED: npm registry; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Zod | project ^4.3.6, registry latest 4.4.3 | MCP input validation and JSON Schema conversion. | Phase 116 uses `z.toJSONSchema()` for OpenAI-compatible tool definitions. [VERIFIED: package.json; VERIFIED: npm registry; VERIFIED: src/llm/tool-registry.ts] |
| Vitest | project ^4.1.1, registry latest 4.1.5, local 4.1.1 | Unit/integration/E2E test runner. | Existing `npm test`, `test:integration`, and `test:e2e` scripts are Vitest-based. [VERIFIED: package.json; VERIFIED: `npx vitest --version`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | ^2.100.0 | Existing cost-row storage and tool handlers. | Use through existing managers/handlers; do not raw-insert loop usage except via `recordLlmUsage()`. [VERIFIED: package.json; VERIFIED: src/llm/cost-tracker.ts] |
| `tsup` | project ^8.5.1, registry latest 8.5.1 | Production ESM build. | Phase gate should include `npm run build`. [VERIFIED: package.json; VERIFIED: npm registry] |
| `tsx` | project ^4.21.0, registry latest 4.21.0 | Development and CLI test startup. | Existing `npm run dev` and managed scenario server startup depend on TS execution. [VERIFIED: package.json; VERIFIED: npm registry] |
| Python 3 | local 3.12.3 | Directed scenario tests. | Use for `tests/scenarios/directed/testcases/*.py --managed`. [VERIFIED: `python3 --version`; VERIFIED: tests/scenarios/directed/README.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Internal dispatcher over captured handlers | Expose an MCP server to the delegated model | Explicitly out of scope; product contract requires in-process dispatch with no MCP server exposure. [CITED: Agentic-LLM-Tool-Loop.md; VERIFIED: 117-CONTEXT.md] |
| Existing `chatByPurpose()` per loop round | Direct provider chat function plus `PurposeResolver` fallback | Existing public `chatByPurpose()` writes usage every round, violating LOOP-06. [VERIFIED: src/llm/client.ts; CITED: Agentic-LLM-Tool-Loop.md] |
| Real OpenAI/OpenRouter/Ollama for tests | Deterministic OpenAI-compatible mock provider | Correctness tests must not depend on real provider behavior; existing scenarios already use local mock providers. [CITED: ATL Test Plan.md; VERIFIED: tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py] |

**Installation:**
```bash
# No new runtime dependency is recommended for Phase 117.
npm install
```

**Version verification:** `npm view` verified current registry versions on 2026-05-06: `@modelcontextprotocol/sdk` 1.29.0, `zod` 4.4.3, `vitest` 4.1.5, `tsx` 4.21.0, `tsup` 8.5.1. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
MCP client call_model resolver=purpose
  -> src/mcp/tools/llm.ts
     -> validate body, reject discovery/caller-owned tool paths, hydrate host refs once
     -> assemble final model-visible registry from Phase 116 snapshot
        -> if registry empty: existing Mode 1 completeByPurpose path
        -> if registry non-empty: AgentLoopExecutor
            -> pre-call guardrail check
            -> non-recording purpose chat round trip
            -> append assistant message
            -> if assistant has tool_calls:
                 -> internal dispatcher validates tool name + args against snapshot
                 -> Promise.allSettled over tool calls
                 -> append role=tool messages with JSON.stringify(payload)
                 -> repeat
               else:
                 -> final_response
            -> aggregate tokens/cost/latency + calls_log
            -> one recordLlmUsage() aggregate write
     -> return CallModelEnvelope JSON text
```

### Recommended Project Structure

```text
src/
├── llm/
│   ├── agent-loop.ts          # Mode 2 executor, guardrails, calls_log, aggregate usage
│   ├── tool-dispatcher.ts     # Snapshot-based native tool dispatch and result/error envelope
│   ├── tool-registry.ts       # Existing Phase 116 registry; extend only as needed
│   ├── client.ts              # Provider transport and response normalization only
│   └── types.ts               # Expand CallModelMetadata.tools for Mode 2
├── mcp/
│   ├── tool-catalog.ts        # Capture handler callbacks plus metadata for dispatch
│   └── tools/llm.ts           # Mode selection and envelope integration
└── constants/
    └── llm.ts                 # Add stop reasons / dispatch error constants
```

### Pattern 1: Keep Provider Transport Out Of The Loop Executor

**What:** `client.ts` should continue normalizing provider responses; `agent-loop.ts` should orchestrate rounds over a normalized chat function. [VERIFIED: src/llm/client.ts; CITED: Agentic-LLM-Tool-Loop.md]  
**When to use:** Every Mode 2 LLM round trip. [CITED: Agentic-LLM-Tool-Loop.md]  
**Example:**
```typescript
// Source: src/llm/client.ts + Agentic-LLM-Tool-Loop.md OQ-26
export type LoopChatFn = (
  purposeName: string,
  messages: LlmChatMessage[],
  parameters: Record<string, unknown>
) => Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }>;
```

### Pattern 2: Dispatch From An Immutable Registry Snapshot

**What:** Capture native tool metadata and handlers when the MCP server registers tools, then freeze the per-call allowlist from Phase 116 registry output. [VERIFIED: src/mcp/tool-catalog.ts; VERIFIED: src/llm/tool-registry.ts]  
**When to use:** Every delegated tool call, so runtime dispatch cannot reach tools outside the provider-visible registry. [VERIFIED: 117-CONTEXT.md]  
**Example:**
```typescript
// Source: Context7 MCP SDK docs + src/mcp/tool-catalog.ts
server.registerTool(name, config, async (args) => {
  return { content: [{ type: 'text', text: '...' }] };
});
```

### Pattern 3: Tool Errors Are Loop Data, Not Handler Exceptions

**What:** Convert handler `isError: true`, argument validation failures, unknown tool names, and thrown errors into JSON-stringified tool messages so the model can recover. [VERIFIED: AGENTS.md; CITED: Agentic-LLM-Tool-Loop.md]  
**When to use:** Any settled rejection or failed tool result in a tool-call batch. [VERIFIED: 117-CONTEXT.md]  
**Example:**
```typescript
// Source: Agentic-LLM-Tool-Loop.md + OpenAI Chat Completions docs
const toolMessage: LlmChatMessage = {
  role: 'tool',
  tool_call_id: toolCall.id,
  content: JSON.stringify(payload),
};
```

### Anti-Patterns to Avoid

- **Using `client.chatByPurpose()` inside the loop:** It writes one usage row per round today, violating the aggregate-only Mode 2 contract. [VERIFIED: src/llm/client.ts; CITED: Agentic-LLM-Tool-Loop.md]
- **Dispatching by searching current config after the model calls a tool:** Dispatch must use the immutable per-call registry snapshot that was sent to the provider. [VERIFIED: 117-CONTEXT.md]
- **Hydrating references in assistant/tool messages:** Reference hydration applies only to host-authored initial messages; later tool results and model arguments containing `{{ref:...}}` are data. [CITED: Document Reference System.md; VERIFIED: src/mcp/tools/llm.ts]
- **Putting loop orchestration inside `src/llm/client.ts`:** Product docs and context require client transport to remain provider normalization only. [VERIFIED: 117-CONTEXT.md; CITED: Agentic-LLM-Tool-Loop.md]
- **Sending `tools: []`:** Existing transport strips empty arrays; Mode 1 should omit tools entirely. [VERIFIED: src/llm/client.ts; VERIFIED: 116-VERIFICATION.md]

## Current Source Seams

| Area | Current State | Planning Implication |
|------|---------------|----------------------|
| `src/mcp/tools/llm.ts` | Performs discovery short-circuit, body validation, host reference hydration, registry assembly, provider dispatch, trace pre-snapshot, envelope construction. [VERIFIED: src/mcp/tools/llm.ts] | Keep this as the boundary/orchestration entry point, but move multi-round execution into `src/llm/agent-loop.ts`. |
| `src/llm/client.ts` | `chat()` is non-recording for direct model calls; `chatByPurpose()` records usage. [VERIFIED: src/llm/client.ts] | Add or expose a non-recording purpose chat path for the executor; do not call public `chatByPurpose()` for iterations. |
| `src/llm/resolver.ts` | Generic fallback resolver can return `LlmChatResult` with `fallbackPosition`. [VERIFIED: src/llm/resolver.ts] | Reuse resolver behavior for each iteration, preserving fallback attempts and completed conversation history. |
| `src/mcp/tool-catalog.ts` | Captures metadata but not callbacks. [VERIFIED: src/mcp/tool-catalog.ts] | Extend catalog to capture handler callbacks or create adapter registry for model-visible native tools. |
| `src/llm/tool-registry.ts` | Expands tiers/exclusions/hard exclusions and emits provider tool definitions. [VERIFIED: src/llm/tool-registry.ts; VERIFIED: 116-VERIFICATION.md] | Reuse as registry source; add dispatcher lookup keyed by `nativeToolNames`. |
| `src/llm/types.ts` | `LlmChatMessage` supports Mode 2 messages; `CallModelMetadata.tools` is Phase 116 diagnostic-only. [VERIFIED: src/llm/types.ts] | Expand metadata with `iterations`, `stop_reason`, `calls_log`, aggregate usage/cost details, and diagnostics. |
| `tests/scenarios/directed/test_call_model_native_tool_registry.py` | Provides local OpenAI-compatible mock provider and request capture. [VERIFIED: tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py] | Reuse pattern for ATL-DS-09/12/13 with scripted multi-round provider responses. |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider response normalization | Provider-specific logic in executor | Existing `chat()` normalization | It already normalizes tool calls, parsed arguments, finish reasons, and missing usage. [VERIFIED: src/llm/client.ts] |
| JSON Schema translation | Custom schema conversion in loop phase | Existing `toOpenAiToolDefinition()` / `assembleNativeToolRegistry()` | Phase 116 verified strict schema normalization and empty-tool omission. [VERIFIED: src/llm/tool-registry.ts; VERIFIED: 116-VERIFICATION.md] |
| Usage DB writes | Raw Supabase insert from executor | `recordLlmUsage()` | It tracks in-flight writes and drains on shutdown. [VERIFIED: src/llm/cost-tracker.ts] |
| Tool-call batching | Serial fail-fast loop | `Promise.allSettled` over same-turn calls | Product contract requires sibling successes to still produce tool messages. [VERIFIED: 117-CONTEXT.md; CITED: Agentic-LLM-Tool-Loop.md] |
| Token estimation dependency | New tokenizer package | `ceil(message_chars / 4)` and `DEFAULT_OUTPUT_TOKEN_ESTIMATE = 2048` | v1 explicitly avoids tokenizer dependencies. [CITED: Agentic-LLM-Tool-Loop.md] |

**Key insight:** The complex part is not talking to OpenAI-compatible providers; it is preserving FlashQuery's accounting and safety boundaries while repeatedly calling the existing provider primitive. [VERIFIED: src/llm/client.ts; CITED: Agentic-LLM-Tool-Loop.md]

## Common Pitfalls

### Pitfall 1: Accidental Per-Iteration Usage Rows
**What goes wrong:** Each loop round writes to `fqc_llm_usage`, then the executor writes an aggregate row, inflating cost history. [VERIFIED: src/llm/client.ts]  
**Why it happens:** Public `chatByPurpose()` records usage today. [VERIFIED: src/llm/client.ts]  
**How to avoid:** Plan a non-recording purpose chat API before implementing `AgentLoopExecutor`. [CITED: Agentic-LLM-Tool-Loop.md]  
**Warning signs:** `recordLlmUsage` called from both `client.chatByPurpose()` and executor tests. [VERIFIED: src/llm/client.ts]

### Pitfall 2: Returning Tool Calls As Final Responses
**What goes wrong:** Current `llm.ts` can return an assistant tool-call message in `messages` and empty `response` after one chat call. [VERIFIED: src/mcp/tools/llm.ts]  
**Why it happens:** Phase 116 used `chatByPurpose()` only to verify provider tool wiring, not to execute loops. [VERIFIED: 116-VERIFICATION.md]  
**How to avoid:** Mode 2 must route to executor when final registry is non-empty; only final assistant text should become durable `response`. [VERIFIED: 117-CONTEXT.md]

### Pitfall 3: Catalog Metadata Without Dispatch
**What goes wrong:** Provider receives valid tool definitions, but executor cannot call the backing handlers. [VERIFIED: src/mcp/tool-catalog.ts]  
**Why it happens:** Phase 116 intentionally captured only name/description/input schema. [VERIFIED: 116-VERIFICATION.md]  
**How to avoid:** Extend catalog/registry with callbacks and validation, or extract adapters for exposed native tools before writing loop logic. [CITED: Context7 `/modelcontextprotocol/typescript-sdk`]

### Pitfall 4: Re-Hydrating Model-Produced Reference Syntax
**What goes wrong:** A tool result or model argument containing `{{ref:Secret.md}}` could trigger unintended vault hydration. [CITED: Document Reference System.md]  
**Why it happens:** Reusing the initial reference resolver inside loop iterations would cross the trust boundary. [CITED: Document Reference System.md]  
**How to avoid:** Hydrate only host-authored initial system/user messages in `llm.ts` before executor starts. [VERIFIED: src/mcp/tools/llm.ts; CITED: Document Reference System.md]

### Pitfall 5: Weak Metadata Tests
**What goes wrong:** Loop appears to work but `metadata.tokens` no longer equals calls-log token sums. [CITED: Agentic-LLM-Tool-Loop.md]  
**Why it happens:** Fallback, guardrail stops, and tool errors create partial histories. [CITED: ATL Test Plan.md]  
**How to avoid:** Add unit tests for token arithmetic and directed scenarios for usage aggregation. [CITED: ATL Test Plan.md]

## Code Examples

### Non-Recording Loop Chat Shape
```typescript
// Source: src/llm/resolver.ts and src/llm/client.ts
const result = await purposeResolver.chatByPurpose(purposeName, messages, providerParameters);
// Executor aggregates result.inputTokens/result.outputTokens/result.latencyMs.
// It must not use OpenAICompatibleLlmClient.chatByPurpose() if that wrapper records usage.
```

### Tool Result Message
```typescript
// Source: OpenAI Chat Completions docs + Agentic-LLM-Tool-Loop.md
messages.push({
  role: 'tool',
  tool_call_id: toolCall.id,
  content: JSON.stringify(toolPayload),
});
```

### Aggregate Usage Write
```typescript
// Source: src/llm/cost-tracker.ts
recordLlmUsage({
  instanceId,
  purposeName,
  modelName: firstSuccessful.modelName,
  providerName: firstSuccessful.providerName,
  inputTokens: totalInputTokens,
  outputTokens: totalOutputTokens,
  costUsd: totalCostUsd,
  latencyMs: totalLatencyMs,
  fallbackPosition: firstSuccessful.fallbackPosition,
  traceId: traceId ?? null,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Text-only completions via `complete()` | Normalized `chat()` plus text wrappers that reject tool-call responses | Phase 112, verified before Phase 117 [VERIFIED: src/llm/client.ts; VERIFIED: .planning/STATE.md] | Executor can preserve assistant/tool messages instead of parsing text. |
| Provider tools assembled ad hoc | Phase 116 `assembleNativeToolRegistry()` and OpenAI schema translation | Phase 116, verified 2026-05-06 [VERIFIED: 116-VERIFICATION.md] | Planner should reuse registry and avoid reopening admission rules. |
| Per-call usage row for simple LLM calls | Mode 2 aggregate-only usage row with per-iteration detail in metadata | Required for Phase 117 [CITED: Agentic-LLM-Tool-Loop.md] | Executor owns aggregation and one final `recordLlmUsage()`. |
| Direct references only | Host references plus future model-initiated template masquerade | Phases 113-114 implemented host side; Phase 118 handles masquerade [VERIFIED: .planning/STATE.md; CITED: Document Reference System.md] | Phase 117 should leave template dispatch extension points but focus on native tools. |

**Deprecated/outdated:**
- Active `{{id:...}}` references are superseded by `{{ref:<fq_id>}}` and should not be reintroduced in loop logic. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md; CITED: Document Reference System.md]
- Mode 3 caller-provided tool dispatch is deferred; do not silently merge caller-owned tools into Mode 2. [VERIFIED: 117-CONTEXT.md; CITED: Agentic-LLM-Tool-Loop.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | None. | — | All implementation-relevant claims were verified from repository files, supplied canonical docs, Context7, npm registry, or official OpenAI docs. |

## Open Questions (RESOLVED)

1. **RESOLVED: Should the non-recording purpose chat path be public on `LlmClient` or private to `OpenAICompatibleLlmClient`/`AgentLoopExecutor`?**
   - What we know: Public `chatByPurpose()` records usage today, but the executor needs fallback per round without recording. [VERIFIED: src/llm/client.ts; VERIFIED: src/llm/resolver.ts]
   - Decision: Phase 117 plans add `chatByPurposeUnrecorded()` as the explicit non-recording path and require Mode 2 loop code to use that path rather than public recording `chatByPurpose()`. [VERIFIED: 117-03-PLAN.md]
   - Rationale: This preserves existing recording behavior for public chat calls while giving `executeAgentLoop()` a testable, grep-verifiable no-usage-write dependency. [VERIFIED: 117-03-PLAN.md]

2. **RESOLVED: What exact CG-4 tool payload shape should Phase 117 freeze?**
   - What we know: Product docs require JSON-stringified tool result/error payloads and stable dispatcher error codes. [CITED: Agentic-LLM-Tool-Loop.md]
   - Decision: Phase 117 plans freeze success payloads as `{ ok: true, result: rawHandlerResult }` and error payloads as `{ ok: false, error: { code, message, details? } }`, serialized into `LlmToolMessage.content` with `JSON.stringify(payload)`. [VERIFIED: 117-02-PLAN.md]
   - Rationale: This gives the model stable recovery data while preserving existing raw MCP handler result shape inside `result`. [VERIFIED: 117-02-PLAN.md]

3. **RESOLVED: How much of template masquerade should Phase 117 stub?**
   - What we know: Phase 118 owns template discovery and dispatch, but Mode 2 selection is defined by the final registry including future template tools. [VERIFIED: ROADMAP.md; CITED: Document Reference System.md]
   - Decision: Phase 117 plans keep dispatch implementation native-only but require Mode 2 selection to use final model-visible registry non-empty, such as `hasModelVisibleTools(toolRegistry)` / `providerTools.length > 0`, not `nativeToolNames.length > 0`. Tests must cover template-only/provider-tool-only selection cases without implementing Phase 118 template dispatch. [VERIFIED: 117-04-PLAN.md]
   - Rationale: This preserves the product contract and future template-tool path while keeping Phase 117 scoped to native loop execution. [VERIFIED: 117-04-PLAN.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build/test/runtime | ✓ | v24.7.0 | Project supports >=20. [VERIFIED: `node --version`; VERIFIED: package.json] |
| npm | Package scripts and registry checks | ✓ | 11.5.1 | — [VERIFIED: `npm --version`] |
| Vitest | Unit/integration/E2E tests | ✓ | 4.1.1 | — [VERIFIED: `npx vitest --version`] |
| Python 3 | Directed scenarios | ✓ | 3.12.3 | — [VERIFIED: `python3 --version`] |
| `.env.test` | Integration/E2E tests | ✓ | present | Supabase-backed tests may skip if credentials incomplete. [VERIFIED: shell check; VERIFIED: AGENTS.md] |
| Supabase service | Integration/E2E usage-row validation | unknown | — | Unit tests and managed mock-provider directed tests can cover logic; DB row assertions need configured Supabase. [VERIFIED: .env.test presence only; VERIFIED: AGENTS.md] |

**Missing dependencies with no fallback:** None identified for research and unit-level planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:** Supabase runtime availability was not proven during research; planner should keep DB-row validation in integration/E2E commands that already skip gracefully when `.env.test` is incomplete. [VERIFIED: AGENTS.md; VERIFIED: tests/helpers/test-env.ts]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 for TS tests; Python 3.12.3 for directed scenarios. [VERIFIED: package.json; VERIFIED: environment audit] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: package.json] |
| Quick run command | `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-tool.test.ts` [VERIFIED: package.json] |
| Full suite command | `npm test && npm run test:e2e && npm run build` plus directed scenario commands. [VERIFIED: package.json; VERIFIED: ATL Test Plan.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| LOOP-01 | Non-empty native registry triggers Mode 2 executor. | unit + directed | `npm test -- tests/unit/llm-tool.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py --managed` | ❌ Wave 0 |
| LOOP-02 | Assistant tool-call messages and tool messages append through loop. | unit + E2E | `npm test -- tests/unit/llm-agent-loop.test.ts`; `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` | ❌ Wave 0 |
| LOOP-03 | Parallel calls use all-settled semantics. | unit + E2E | `npm test -- tests/unit/llm-agent-loop.test.ts`; `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` | ❌ Wave 0 |
| LOOP-04 | Guardrail stop reasons before next call. | unit + directed | `npm test -- tests/unit/llm-agent-loop.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py --managed` | ❌ Wave 0 |
| LOOP-05 | Fallback can occur mid-loop while preserving history. | unit + E2E | `npm test -- tests/unit/llm-agent-loop.test.ts`; `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` | ❌ Wave 0 |
| LOOP-06 | Exactly one aggregate usage row is written. | unit + integration/directed | `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-cost-tracker.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py --managed` | ❌ Wave 0 |
| LOOP-07 | Metadata calls-log and token arithmetic invariants. | unit + directed | `npm test -- tests/unit/llm-agent-loop.test.ts`; `python3 tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py --managed` | ❌ Wave 0 |
| TOOL-05 | Native tool calls dispatch internally. | unit + E2E | `npm test -- tests/unit/llm-tool-dispatcher.test.ts`; `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` | ❌ Wave 0 |
| TOOL-06 | Tool result messages use `tool_call_id` and JSON content. | unit + E2E | `npm test -- tests/unit/llm-agent-loop.test.ts`; `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` | ❌ Wave 0 |
| VAL-117 | Required unit, E2E, directed coverage exists and passes. | validation gate | Commands above plus coverage matrix updates. | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Focused unit command for touched surface. [VERIFIED: package.json]
- **Per wave merge:** `npm test -- tests/unit/llm-agent-loop.test.ts tests/unit/llm-tool-dispatcher.test.ts tests/unit/llm-client.test.ts tests/unit/llm-tool.test.ts` plus relevant directed scenario. [VERIFIED: package.json; CITED: ATL Test Plan.md]
- **Phase gate:** `npm test`, `npm run test:e2e`, `npm run build`, and all Phase 117 directed scenarios with `--managed`. [VERIFIED: package.json; CITED: ATL Test Plan.md]

### Wave 0 Gaps

- [ ] `tests/unit/llm-agent-loop.test.ts` — covers ATL-U-13, ATL-U-14, LOOP-01..LOOP-07. [CITED: ATL Test Plan.md]
- [ ] `tests/unit/llm-tool-dispatcher.test.ts` — covers TOOL-05/TOOL-06 and dispatcher error payloads. [CITED: ATL Test Plan.md]
- [ ] `tests/e2e/call-model-agent-loop.e2e.test.ts` — covers ATL-E2E-02, ATL-E2E-03, ATL-E2E-06, ATL-E2E-07. [CITED: ATL Test Plan.md]
- [ ] `tests/scenarios/directed/testcases/test_call_model_agent_loop_native.py` — covers ATL-DS-09. [CITED: ATL Test Plan.md]
- [ ] `tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py` — covers ATL-DS-12. [CITED: ATL Test Plan.md]
- [ ] `tests/scenarios/directed/testcases/test_call_model_agent_loop_usage.py` — covers ATL-DS-13 and VAL-117. [CITED: ATL Test Plan.md]
- [ ] Coverage matrix updates in `tests/scenarios/directed/DIRECTED_COVERAGE.md` and `tests/scenarios/integration/INTEGRATION_COVERAGE.md`. [VERIFIED: existing coverage files]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No direct new auth surface | Existing MCP auth remains outside loop executor. [VERIFIED: src/mcp/server.ts] |
| V3 Session Management | No | Project forbids server-side session state for MCP; loop state is per invocation. [VERIFIED: AGENTS.md] |
| V4 Access Control | Yes | Purpose-scoped allowlist, hard exclusions, immutable registry snapshot, dispatch-time lookup. [VERIFIED: src/llm/tool-registry.ts; VERIFIED: 117-CONTEXT.md] |
| V5 Input Validation | Yes | Zod schema validation for MCP input and delegated tool-call args. [VERIFIED: src/mcp/tools/llm.ts; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| V6 Cryptography | No new cryptography | Do not add crypto; existing auth/secrets handling remains unchanged. [VERIFIED: AGENTS.md] |

### Known Threat Patterns for FlashQuery Mode 2

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Delegated model attempts recursive `call_model` | Elevation of Privilege / DoS | Hard-exclude `call_model` at registry assembly and dispatch lookup. [VERIFIED: src/llm/tool-registry.ts; VERIFIED: 116-VERIFICATION.md] |
| Delegated model calls unexposed native tool | Elevation of Privilege | Dispatch only against immutable per-call allowlist, not global catalog. [VERIFIED: 117-CONTEXT.md] |
| Tool argument injection with `{{ref:...}}` | Information Disclosure | Do not run reference resolver on tool-call args or tool results. [CITED: Document Reference System.md] |
| Retry spiral after tool errors | DoS / Cost Abuse | Enforce timeout, max iterations, token budget, and cost budget before each next model call. [CITED: Agentic-LLM-Tool-Loop.md] |
| Usage undercounting after partial loop failure | Repudiation | Aggregate completed iteration usage and write one row even when stop reason is budget/timeout/error after completed calls. [CITED: Agentic-LLM-Tool-Loop.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/117-agent-loop-executor/117-CONTEXT.md` - locked phase decisions and out-of-scope list. [VERIFIED: file read]
- `.planning/STATE.md` - Phase 116 decisions and milestone status. [VERIFIED: file read]
- `.planning/ROADMAP.md` - Phase 117 goal, success criteria, dependency chain. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - LOOP-01..LOOP-07, TOOL-05, TOOL-06, VAL-117. [VERIFIED: file read]
- `.planning/phases/116-model-visible-tool-registry/116-PATTERNS.md` and `116-VERIFICATION.md` - Phase 116 source seams and verified outcomes. [VERIFIED: file read]
- `Agentic-LLM-Tool-Loop.md` - authoritative Mode 2 loop, guardrail, usage, provider, fallback, and handoff contract. [CITED: local canonical product doc]
- `Document Reference System.md` - authoritative reference/template/masquerade contract. [CITED: local canonical product doc]
- `ATL Test Plan.md` - authoritative Phase 117 validation matrix. [CITED: local canonical product doc]
- Source files inspected: `src/mcp/tools/llm.ts`, `src/llm/client.ts`, `src/llm/resolver.ts`, `src/llm/tool-registry.ts`, `src/mcp/tool-catalog.ts`, `src/llm/cost-tracker.ts`, `src/llm/types.ts`. [VERIFIED: source grep/read]
- Context7 `/modelcontextprotocol/typescript-sdk` - `registerTool()` signature and handler result shape. [CITED: Context7]
- OpenAI Chat Completions API Reference - tool role, `tool_call_id`, and `tool_calls` finish reason. [CITED: https://platform.openai.com/docs/api-reference/chat/create-chat-completion]

### Secondary (MEDIUM confidence)

- npm registry package versions checked with `npm view`. [VERIFIED: npm registry]
- Local environment commands for Node/npm/Vitest/Python availability. [VERIFIED: shell commands]

### Tertiary (LOW confidence)

- None. [VERIFIED: source audit]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - project package files, local commands, and npm registry verified versions. [VERIFIED: package.json; VERIFIED: npm registry]
- Architecture: HIGH - phase context and canonical product docs align with current source seams. [VERIFIED: source files; CITED: canonical product docs]
- Pitfalls: HIGH - risks are grounded in current code paths or explicit product constraints. [VERIFIED: source files; VERIFIED: 117-CONTEXT.md]

**Research date:** 2026-05-06  
**Valid until:** 2026-06-05 for codebase-specific planning; re-check npm/library versions if dependency changes are planned. [VERIFIED: current date]
