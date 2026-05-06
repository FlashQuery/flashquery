# Phase 118: Template Discovery & Masquerade Dispatch - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Source:** Product docs supplied for `$gsd-plan-phase 118`

<domain>
## Phase Boundary

Phase 118 implements the template-tool half of the Agentic Tool Loop. Vault templates bound to purposes become model-visible tools, are assembled into the same provider-visible registry as native tools, and can be called by delegated models during the Mode 2 loop built in Phase 117.

This phase must cover requirements `TMPL-06`, `TMPL-07`, `TMPL-08`, and `VAL-118`.

The phase is not responsible for Phase 119 discovery/help polish except where Phase 118 behavior needs enough public diagnostics to validate template-tool collisions and runtime behavior. The `list_purposes` template-tool diagnostics required for collision and usability tests are in scope because `VAL-118` needs them; broader discovery UX remains Phase 119.

</domain>

<decisions>
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Source Docs
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md` - Requirements and resolved decisions for tool masquerade, template identity, collision policy, purpose composition, and implementation sequencing.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md` - Definitive contract for templates, frontmatter, access paths, reference/template hydration, masquerade tool generation, reverse-map dispatch, and diagnostics.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md` - Required unit, integration, E2E, directed scenario, and coverage expectations for Phase 118 behavior.

### Local Planning Artifacts
- `.planning/ROADMAP.md` - Phase 118 goal, dependency on Phase 117, requirements, and success criteria.
- `.planning/REQUIREMENTS.md` - Requirement IDs `TMPL-06`, `TMPL-07`, `TMPL-08`, and `VAL-118`.
- `.planning/phases/117-agent-loop-executor/117-VERIFICATION.md` - Confirmed Phase 117 loop behavior and residual Phase 118 dependency.
- `.planning/phases/117-agent-loop-executor/*-SUMMARY.md` - Implementation summaries for Mode 2 routing, native dispatch, loop metadata, and final validation.

</canonical_refs>

<specifics>
## Specific Ideas

- Expected public/generated tool name examples include `flashquery.skill.research_skill`, `flashquery.review.document_review`, and `flashquery.template.weekly_checklist`.
- `list_purposes`-style diagnostics needed for Phase 118 tests include usable `template_tools` entries with `name`, `template_path`, `description`, `parameters`, and `template_tool_conflicts` entries with `{ name, template_paths }`.
- Directed scenario names from the test plan: `ATL-DS-07` template discovery and purpose listing, `ATL-DS-08` collision diagnostics, `ATL-DS-10` template tool loop, and `ATL-DS-11` mixed native/template loop.
- E2E names from the test plan: `ATL-E2E-04` template-tool masquerade loop and `ATL-E2E-05` mixed native and template tools.
- Required failure codes include at least `template_missing_required_param` for missing arguments and `tool_not_in_registry` for reverse-map misses. Reuse existing reference/template failure and warning constants where applicable.

</specifics>

<deferred>
## Deferred Ideas

- Broad Phase 119 discovery/help resolver work remains deferred unless needed to expose Phase 118 collision diagnostics and testable template-tool metadata.
- MCP Broker external tool routing, Mode 3 cooperative caller-owned tool calls, model-initiated response references, audit document writes, path-scoped delegated writes, and advanced context-overflow summarization remain out of scope.

</deferred>

---

*Phase: 118-template-discovery-masquerade-dispatch*
*Context gathered: 2026-05-06 from product docs and Phase 117 verification artifacts*
