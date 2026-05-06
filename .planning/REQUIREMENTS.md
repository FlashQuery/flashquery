# Requirements: FlashQuery Core v3.2 Agentic LLM Tools

**Defined:** 2026-05-05
**Last Updated:** 2026-05-06 after Phase 116 model-visible registry validation
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.

## v3.2 Requirements

### Chat Primitive And Envelope

- [x] **CHAT-01**: Developer can call a lower-level `chat()` primitive that returns normalized assistant messages, usage, latency, model/provider identity, fallback position, and finish reason.
- [x] **CHAT-02**: Existing `complete()` and `completeByPurpose()` remain text-only wrappers that reject tool-call responses instead of silently dropping them.
- [x] **CHAT-03**: MCP client can pass and receive round-trippable `call_model` messages with nullable assistant content, `tool_calls`, `tool_call_id`, and participant `name` fields.
- [x] **CHAT-04**: MCP client can set `return_messages: true` and receive the post-hydration message history plus final assistant output; default responses keep `messages: []`.
- [x] **CHAT-05**: Discovery resolvers ignore `return_messages` and keep their existing raw discovery response shapes.
- [x] **CHAT-06**: Provider response normalization handles tool-call finish reasons, string/object arguments, missing content with tool calls, and provider capability mismatches with typed actionable errors.

### Document References

- [x] **REF-01**: Host-authored `{{ref:...}}` placeholders support path, filename, and `fq_id` identifier resolution using the standard document identifier ladder.
- [x] **REF-02**: Reference parser supports mutually exclusive section (`#`), pointer (`->`), and alias (`@`) operators with typed invalid-syntax diagnostics.
- [x] **REF-03**: Reference scanner implements escape parity for `\{{ref:...}}` without resolving escaped placeholders or corrupting hydration spans.
- [x] **REF-04**: Bare filename/shorthand references fail with `ambiguous_document_identifier` when more than one active document matches.
- [x] **REF-05**: `{{id:...}}` active and escaped legacy support is removed during the ATL release and treated as literal text.
- [x] **REF-06**: Failed references return stable `ReferenceFailureReason` codes and human-readable detail under `failed_references`.
- [x] **REF-07**: Injected reference metadata includes resolved identity, content character counts, template usage details, and warnings where applicable.
- [x] **REF-08**: Reference hydration is non-recursive and applies only to host-authored input messages, not model tool-call arguments, assistant messages, or tool result messages.

### Templates And Host Parameterization

- [x] **TMPL-01**: Vault documents with `fq_template: true` are treated as parameterizable templates; plain documents continue resolving as plain references.
- [x] **TMPL-02**: `call_model.template_params` supports path-keyed template parameters and alias-keyed entries with `_template`.
- [x] **TMPL-03**: Template parameters support `string` and `document` types, required/default validation, document identifier resolution, and typed failures.
- [x] **TMPL-04**: Template placeholder substitution is deterministic, single-pass, non-recursive, and supports escape parity for template placeholders.
- [x] **TMPL-05**: Alias entries support `_items` lists with optional `_separator` for ordered multi-document injection at one `{{ref:@alias}}` slot.
- [ ] **TMPL-06**: Template discovery reads frontmatter fresh from vault documents and validates `fq_namespace`, `fq_desc`, `fq_expose_as_tool`, and `fq_params`.
- [ ] **TMPL-07**: Masqueraded template tools use generated names `flashquery.<fq_namespace>.<slug>` and maintain an explicit reverse map to canonical template paths.
- [ ] **TMPL-08**: Template-tool dispatch validates model-supplied arguments, hydrates template output, and returns JSON-stringified tool results or typed tool errors to the loop.

### Purpose Config And Bindings

- [x] **BIND-01**: Purpose config accepts first-class orchestration fields `tools`, `excluded_tools`, and `templates` while rejecting unknown top-level purpose fields.
- [x] **BIND-02**: Purpose defaults continue passing provider parameters through permissively while type-validating known loop guardrail keys.
- [x] **BIND-03**: Schema verification creates `fqc_purpose_templates` with unique `(instance_id, purpose_name, template_path)` rows and source tracking.
- [x] **BIND-04**: Generic config sync supports YAML-to-DB adapter flows and lets API/runtime template bindings override YAML until removed.
- [x] **BIND-05**: Template bindings resolve ergonomic identifiers to normalized vault-relative `template_path` values and warn on dangling bindings.

### Model Capabilities

- [x] **CAP-01**: Model config supports structured capabilities for tool calling, usage on tool calls, strict tools, parallel tool calls, and structured outputs with tools.
- [x] **CAP-02**: Existing free-form model `capabilities: string[]` is migrated or replaced without preserving two conflicting capability surfaces.
- [x] **CAP-03**: Mode 2 purposes fail config validation unless every fallback model declares required tool-calling and usage capabilities.
- [x] **CAP-04**: Runtime/API template binding runs the same capability admission validation as YAML config.
- [x] **CAP-05**: Requests combining `response_format` with model-visible tools fail when the resolved model does not support structured outputs with tools.

### Native Tool Exposure

- [x] **TOOL-01**: Purpose-level `tools` expands safe tool tiers and named tools into a final model-visible native tool allowlist.
- [x] **TOOL-02**: Purpose-level `excluded_tools` removes tools from the final set and is invalid without `tools`.
- [x] **TOOL-03**: Hard-excluded tools, including `call_model` and admin/plugin management tools, are removed from exposure with warnings.
- [x] **TOOL-04**: Internal tool registry translates MCP/Zod schemas into OpenAI-compatible tool definitions with strict-mode support where available.
- [x] **TOOL-05**: Delegated model native tool calls are dispatched internally through FlashQuery handlers without exposing an MCP server to the delegated model.
- [x] **TOOL-06**: Tool result messages use OpenAI-compatible `tool` role messages keyed by `tool_call_id`, with JSON-stringified raw results.

### Agent Loop Execution

- [ ] **LOOP-01**: `call_model` Mode 2 runs a FlashQuery-managed loop when a purpose exposes native tools, template tools, or both.
- [ ] **LOOP-02**: Loop executor appends assistant tool-call messages, dispatches returned tool calls, appends tool result messages, and continues until a final assistant response or stop condition.
- [x] **LOOP-03**: Multiple tool calls in one assistant message are dispatched with `Promise.allSettled` semantics and individual errors returned to the model.
- [ ] **LOOP-04**: Loop guardrails enforce `timeout_ms`, `max_iterations`, `max_tokens_budget`, and `max_cost_usd` before starting the next model call.
- [ ] **LOOP-05**: Existing purpose fallback behavior works across chat iterations, preserving completed iteration history when a fallback model is selected.
- [ ] **LOOP-06**: Mode 2 writes exactly one aggregate `fqc_llm_usage` row per `call_model` invocation via the existing cost tracker shutdown drain.
- [ ] **LOOP-07**: Mode 2 response metadata includes `metadata.tools.calls_log`, aggregate tokens/cost, stop reason, exposed tool diagnostics, and token arithmetic invariants.

### Discovery And Help

- [ ] **DISC-01**: `list_purposes` exposes native tool and template-tool diagnostics, including usable tools and template collision details.
- [ ] **DISC-02**: `list_models` exposes structured capability diagnostics with clear unknown-vs-false explanations.
- [ ] **DISC-03**: `search` continues to provide discovery over model and purpose metadata without requiring messages.
- [ ] **DISC-04**: A v1 `help` resolver describes supported `call_model` modes, references, templates, tools, loop controls, and discovery usage.

### Test Coverage

- [x] **VAL-112**: Phase 112 ships runnable unit, MCP-boundary, and directed scenario tests that validate `chat()`, Mode 1 envelope compatibility, `return_messages`, round-trippable messages, and provider normalization.
- [x] **VAL-113**: Phase 113 ships runnable unit, directed, and integration tests that validate reference parsing, escaping, ambiguity handling, typed failures, metadata, and non-recursive hydration.
- [x] **VAL-114**: Phase 114 ships runnable unit, directed, and integration tests that validate template parameter validation, substitution, document parameters, aliases, and `_items` list injection.
- [x] **VAL-115**: Phase 115 ships runnable unit, TypeScript integration, and public startup/config scenario tests that validate purpose config fields, loop default validation, DB schema, config sync, template binding precedence, and capability admission.
- [x] **VAL-116**: Phase 116 ships runnable unit tests and at least one public-surface scenario that validate native tool exposure, exclusions, hard exclusions, schema translation, and empty-tool omission.
- [ ] **VAL-117**: Phase 117 ships runnable unit, E2E, and directed scenario tests with a deterministic mock provider validating native tool loops, parallel tool calls, guardrail stops, fallback, usage aggregation, and calls-log metadata.
- [ ] **VAL-118**: Phase 118 ships runnable unit, integration, E2E, and directed scenario tests validating fresh template discovery, masquerade tool naming, collision diagnostics, reverse-map dispatch, and mixed native/template loops.
- [ ] **VAL-119**: Phase 119 ships runnable unit and directed scenario tests validating discovery diagnostics, structured capability reporting, discovery search behavior, and the `help` resolver.
- [ ] **VAL-120**: Phase 120 ships runnable cross-phase E2E, directed, and YAML integration suites proving the full ATL workflows and updating coverage matrices with final scenario IDs.
- [x] **TEST-01**: Every implementation phase includes its own runnable validation before the phase can be marked complete; tests are not deferred wholesale to Phase 120.
- [x] **TEST-02**: A deterministic OpenAI-compatible mock provider exists early enough for the first phase that needs provider/tool-loop validation and is reused by later E2E/scenario tests.
- [x] **TEST-03**: Phase plans identify exact test commands or scenario invocations required for that phase's acceptance.
- [ ] **TEST-04**: Scenario tests are added in the same phase as the public behavior they validate; Phase 120 only fills cross-phase gaps and finalizes coverage matrices.

## Future Requirements

### Deferred Agent Capabilities

- **FUT-01**: Mode 3 cooperative loop where FlashQuery yields unserviced tool calls to the caller.
- **FUT-02**: MCP Broker support for routing delegated model tool calls to external MCP servers.
- **FUT-03**: Model-initiated response references that let delegated models request host-side document hydration in their final output.
- **FUT-04**: Opt-in audit document writes for detailed agent-loop traces.
- **FUT-05**: Path-scoped write permissions for delegated model tools.
- **FUT-06**: Context-window overflow preflight and summarization beyond provider-error handling.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web UI | FlashQuery remains CLI + MCP only for this milestone |
| Streaming `call_model` responses | Native LLM Access deferred streaming; ATL v1 returns a complete envelope |
| Full Projections implementation | Agent loop enables early skill/template workflows but projections are separate |
| MCP Broker external tool routing | Separate feature with different lifecycle and security concerns |
| Mode 3 cooperative loop | Primary v1 use case is internal FlashQuery dispatch |
| Model-initiated response references | Trust model and model behavior are not ready for v1 |
| Audit document writes | Aggregate usage rows plus response metadata are sufficient for v1 observability |
| Path-scoped delegated writes | Purpose-level exposure is the v1 safety boundary |
| Real provider conformance tests | Correctness tests use deterministic mock providers |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CHAT-01 | Phase 112 | Complete |
| CHAT-02 | Phase 112 | Complete |
| CHAT-03 | Phase 112 | Complete |
| CHAT-04 | Phase 112 | Complete |
| CHAT-05 | Phase 112 | Complete |
| CHAT-06 | Phase 112 | Complete |
| REF-01 | Phase 113 | Complete |
| REF-02 | Phase 113 | Complete |
| REF-03 | Phase 113 | Complete |
| REF-04 | Phase 113 | Complete |
| REF-05 | Phase 113 | Complete |
| REF-06 | Phase 113 | Complete |
| REF-07 | Phase 113 | Complete |
| REF-08 | Phase 113 | Complete |
| TMPL-01 | Phase 114 | Complete |
| TMPL-02 | Phase 114 | Complete |
| TMPL-03 | Phase 114 | Complete |
| TMPL-04 | Phase 114 | Complete |
| TMPL-05 | Phase 114 | Complete |
| BIND-01 | Phase 115 | Complete |
| BIND-02 | Phase 115 | Complete |
| BIND-03 | Phase 115 | Complete |
| BIND-04 | Phase 115 | Complete |
| BIND-05 | Phase 115 | Complete |
| CAP-01 | Phase 115 | Complete |
| CAP-02 | Phase 115 | Complete |
| CAP-03 | Phase 115 | Complete |
| CAP-04 | Phase 115 | Complete |
| CAP-05 | Phase 115 | Complete |
| TOOL-01 | Phase 116 | Complete |
| TOOL-02 | Phase 116 | Complete |
| TOOL-03 | Phase 116 | Complete |
| TOOL-04 | Phase 116 | Complete |
| LOOP-01 | Phase 117 | Pending |
| LOOP-02 | Phase 117 | Pending |
| LOOP-03 | Phase 117 | Complete |
| LOOP-04 | Phase 117 | Pending |
| LOOP-05 | Phase 117 | Pending |
| LOOP-06 | Phase 117 | Pending |
| LOOP-07 | Phase 117 | Pending |
| TOOL-05 | Phase 117 | Complete |
| TOOL-06 | Phase 117 | Complete |
| TMPL-06 | Phase 118 | Pending |
| TMPL-07 | Phase 118 | Pending |
| TMPL-08 | Phase 118 | Pending |
| DISC-01 | Phase 119 | Pending |
| DISC-02 | Phase 119 | Pending |
| DISC-03 | Phase 119 | Pending |
| DISC-04 | Phase 119 | Pending |
| VAL-112 | Phase 112 | Complete |
| VAL-113 | Phase 113 | Complete |
| VAL-114 | Phase 114 | Complete |
| VAL-115 | Phase 115 | Complete |
| VAL-116 | Phase 116 | Complete |
| VAL-117 | Phase 117 | Pending |
| VAL-118 | Phase 118 | Pending |
| VAL-119 | Phase 119 | Pending |
| VAL-120 | Phase 120 | Pending |
| TEST-01 | Phase 112 | Complete |
| TEST-02 | Phase 112 | Complete |
| TEST-03 | Phase 112 | Complete |
| TEST-04 | Phase 120 | Pending |

**Coverage:**
- v3.2 requirements: 62 total
- Mapped to phases: 62
- Unmapped: 0

---
*Requirements defined: 2026-05-05*
*Last updated: 2026-05-06 after Phase 116 model-visible registry validation*
