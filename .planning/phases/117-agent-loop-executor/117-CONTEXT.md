# Phase 117: Agent Loop Executor - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Source:** User-provided specification and test documents

<domain>
## Phase Boundary

Phase 117 implements `call_model` Mode 2 loop execution for purposes whose final assembled model-visible tool registry is non-empty. The phase must execute delegated model tool calls internally, append OpenAI-compatible assistant/tool messages, enforce loop guardrails before the next model call, aggregate usage, and return complete loop metadata.

This phase consumes Phase 116's model-visible registry and schema translation work. It should not reopen registry admission rules except where dispatch and loop execution require them.
</domain>

<decisions>
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
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements And Architecture

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md` - authoritative Mode 2 loop, guardrail, usage, provider, fallback, and dev-spec handoff contract.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md` - authoritative document/reference/template and masqueraded tool contract.

### Tests

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md` - authoritative test matrix for ATL and Document Reference System coverage.

### Project Context

- `.planning/ROADMAP.md` - Phase 117 roadmap goal, dependencies, and success criteria.
- `.planning/REQUIREMENTS.md` - requirement IDs LOOP-01 through LOOP-07, TOOL-05, TOOL-06, VAL-117.
- `.planning/STATE.md` - current milestone status and Phase 116 decisions to preserve.
- `.planning/phases/116-model-visible-tool-registry/116-PATTERNS.md` - Phase 116 analog patterns for registry, schema translation, and public scenario coverage.
- `.planning/phases/116-model-visible-tool-registry/116-VERIFICATION.md` - verified Phase 116 outcomes and residual risks.
</canonical_refs>

<specifics>
## Specific Ideas

- Prefer an `AgentLoopExecutor` / loop-executor module outside `src/llm/client.ts`; the client remains provider transport and response normalization.
- Reuse `src/llm/tool-registry.ts` outputs from Phase 116 for the final registry and provider tool schemas.
- Dispatch should work from an immutable per-call registry snapshot.
- Use centralized LLM constants/types already created in previous phases rather than scattering string literals for stop reasons, finish reasons, message roles, or hard-excluded tools.
- Tests should include a deterministic mock provider able to script tool-call responses, multiple tool calls, fallback, missing usage, finish reason variants, and request capture.
</specifics>

<deferred>
## Deferred Ideas

- MCP Broker and external tool routing.
- Mode 3 caller-owned tool dispatch.
- Vault audit document persistence for loop traces.
- Streaming / incremental loop output.
- Scoped write access by vault path.
</deferred>

---

*Phase: 117-agent-loop-executor*
*Context gathered: 2026-05-06 from user-provided product docs*
