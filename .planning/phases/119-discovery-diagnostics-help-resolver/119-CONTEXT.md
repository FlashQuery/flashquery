# Phase 119: Discovery Diagnostics & Help Resolver - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Source:** User-supplied source documents plus roadmap requirements

<domain>
## Phase Boundary

Phase 119 implements the discovery and help slice for v3.2 Agentic LLM Tools. MCP clients must be able to inspect model capabilities, purpose tool/template diagnostics, discovery search metadata, and protocol help before invoking an agentic `call_model` purpose request.

This phase does not reopen the already-completed ATL implementation phases 112 through 118. Prior work already delivered chat/envelope migration, document references, template parameterization, purpose config and capabilities, native tool registry, agent loop execution, and template masquerade dispatch. Phase 119 makes those capabilities discoverable, diagnosable, and documented through raw discovery/help resolver responses.
</domain>

<decisions>
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
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Specifications
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md` — authoritative ATL requirements, including discovery resolvers outside the envelope and capability diagnostic semantics.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md` — definitive reference/template system spec, including `list_purposes` template diagnostics and dangling binding examples.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md` — authoritative test plan for `ATL-U-16`, `ATL-DS-07`, `ATL-DS-15`, and Phase 119 acceptance.

### Project Planning
- `.planning/ROADMAP.md` — Phase 119 goal, dependency on Phase 118, and success criteria.
- `.planning/REQUIREMENTS.md` — `DISC-01` through `DISC-04` and `VAL-119`.
- `.planning/STATE.md` — milestone context and Phase 112-118 completion state.
- `.planning/phases/118-template-discovery-masquerade-dispatch/118-05-SUMMARY.md` — confirms Phase 118 completion and recent gap-fill context.

### Existing Implementation Surfaces
- `src/mcp/tools/llm.ts` — current `call_model` resolver dispatch, discovery resolver handling, and public response shaping.
- `src/llm/template-tools.ts` — template-tool discovery, diagnostics, conflicts, dangling paths, generated names, and reverse-map assembly.
- `src/llm/tool-registry.ts` — native tool registry, safety tiers, hard exclusions, schema translation, and diagnostics.
- `src/llm/capabilities.ts` — structured model capability diagnostics and unknown-vs-false semantics.
- `src/llm/types.ts` — canonical LLM message/envelope types.

### Existing Test Surfaces
- `tests/unit/llm-tool.test.ts`
- `tests/unit/llm-template-tools.test.ts`
- `tests/unit/llm-tool-registry.test.ts`
- `tests/unit/llm-config.test.ts`
- `tests/scenarios/directed/testcases/test_discovery_resolvers.py`
- `tests/scenarios/directed/testcases/test_call_model_template_discovery.py`
- `tests/scenarios/directed/testcases/test_call_model_template_tool_conflicts.py`
- `tests/scenarios/directed/testcases/test_call_model_agent_loop_capabilities.py`
- `tests/scenarios/directed/DIRECTED_COVERAGE.md`
</canonical_refs>

<specifics>
## Specific Ideas

- The implementation should prefer a dedicated discovery/help response helper if it keeps `src/mcp/tools/llm.ts` from accumulating more inline shape-building logic.
- `help` should be added to the resolver enum and to any resolver lists surfaced in discovery usage blocks.
- Drift tests should pin the `help` top-level key order and ensure supported resolver lists include every resolver value.
- Public tests should assert that discovery/help calls do not produce usage rows or trace deltas where existing helpers make that observable.
- Search should prove discovery metadata terms such as `tool_calling`, `usage_on_tool_calls`, `template_tools`, `template_tool_conflicts`, `dangling_template_paths`, and `help`.
</specifics>

<deferred>
## Deferred Ideas

- Cross-phase ATL happy-path and coverage-matrix closure remains Phase 120.
- Documentation outside the discovery/help resolver can be updated later unless a small README note is required by the implementation plan.
- Audit document writes, MCP Broker, Mode 3, model-initiated response references, and path-scoped delegated writes remain out of scope.
</deferred>

---

*Phase: 119-discovery-diagnostics-help-resolver*
*Context gathered: 2026-05-06 via source-doc-backed planning*
