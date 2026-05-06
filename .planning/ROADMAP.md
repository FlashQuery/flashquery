# Roadmap: FlashQuery Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-03-25)
- ✅ **v1.5 Full MVP** — Phases 10-16 (shipped 2026-03-27)
- ✅ **v1.6 Prep for Open Source** — Phases 17-21 (shipped 2026-03-30)
- ✅ **v1.7 Issues Resolution & Pre-Release Hardening** — Phases 22-25 (shipped 2026-03-31)
- ✅ **v1.8 Bug Fixes: Plugin Scope & Token Security** — Phases 28-29 (shipped 2026-04-01)
- ✅ **v1.9 MCP Tool Overhaul** — Phases 30-33 (shipped 2026-04-06)
- ✅ **v2.0 Doc Sync Overhaul** — Phases 36-40 (shipped 2026-04-07)
- ✅ **v2.1 Test Suite Recovery** — Phases 41-44 (shipped 2026-04-07)
- ✅ **v2.2 Status Model Refactor & Infrastructure Hardening** — Phases 45-48 (shipped 2026-04-08)
- ✅ **v2.3 HTTP Authentication & Interoperability** — Phases 49-52 (shipped 2026-04-09)
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54–60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
- ✅ **v2.6 Test Infrastructure & Quality** — Phases 72-80 (shipped 2026-04-15)
- ✅ **v2.7 Name Change & Pre-Launch Preparation** — Phase 83 (shipped 2026-04-16)
- ✅ **v2.8 Plugin Callback Overhaul** — Phases 84-89 (shipped 2026-04-21)
- ✅ **v2.9 Filesystem Primitive Tools** — Phases 90-97 (shipped 2026-04-25)
- ✅ **v3.0 Native LLM Access** — Phases 98-106 (shipped 2026-04-30)
- ✅ **v3.1 Call Model With Reference** — Phases 107-110 + 111 (CMR verification fixes) (shipped 2026-05-05)
- ◆ **v3.2 Agentic LLM Tools** — Phases 112-120 (planning)

## Phases

<details>
<summary>✅ v2.8 Plugin Callback Overhaul (Phases 84-89) — SHIPPED 2026-04-21</summary>

- [x] Phase 84: Schema Parsing & Policy Infrastructure (3/3 plans) — completed 2026-04-20
- [x] Phase 85: Reconciliation Engine (5/5 plans) — completed 2026-04-20
- [x] Phase 86: Record Tool Integration & Pending Review (5/5 plans) — completed 2026-04-21
- [x] Phase 87: Scanner Modifications & Frontmatter Sync (3/3 plans) — completed 2026-04-21
- [x] Phase 88: Legacy Infrastructure Removal (6/6 plans) — completed 2026-04-21
- [x] Phase 89: Test Helper & Existing Test Updates (4/4 plans) — completed 2026-04-21

Full phase details: [milestones/v2.8-ROADMAP.md](milestones/v2.8-ROADMAP.md)

</details>

<details>
<summary>✅ v2.9 Filesystem Primitive Tools (Phases 90-97) — SHIPPED 2026-04-25</summary>

- [x] Phase 90: Frontmatter Field Name Centralization (7/7 plans) — completed 2026-04-23
- [x] Phase 91: Shared Utilities (2/2 plans) — completed 2026-04-24
- [x] Phase 92: `create_directory` Handler (1/1 plans) — completed 2026-04-24
- [x] Phase 93: `list_vault` Handler (2/2 plans) — completed 2026-04-24
- [x] Phase 94: Migration and Cleanup (1/1 plans) — completed 2026-04-25
- [x] Phase 95: Integration Tests (3/3 plans) — completed 2026-04-25
- [x] Phase 96: Coverage Matrix Updates (1/1 plans) — completed 2026-04-25
- [x] Phase 97: Plugin Updates (3/3 plans) — completed 2026-04-25

Full phase details: [milestones/v2.9-ROADMAP.md](milestones/v2.9-ROADMAP.md)

</details>

<details>
<summary>✅ v3.0 Native LLM Access (Phases 98-106) — SHIPPED 2026-04-30</summary>

- [x] Phase 98: Three-Layer Config Schema, DB Schema & Config Sync (5/5 plans) — completed 2026-04-28
- [x] Phase 99: LLM Completions Client (3/3 plans) — completed 2026-04-29
- [x] Phase 100: Purpose Resolver & Fallback Chain (3/3 plans) — completed 2026-04-29
- [x] Phase 101: `call_model` MCP Tool (2/2 plans) — completed 2026-04-29
- [x] Phase 102: Cost Tracking (2/2 plans) — completed 2026-04-29
- [x] Phase 103: `get_llm_usage` MCP Tool (2/2 plans) — completed 2026-04-29
- [x] Phase 104: Embedding Migration (3/3 plans) — completed 2026-04-30
- [x] Phase 105: Config Template Updates (2/2 plans) — completed 2026-04-30
- [x] Phase 106: v3.0 Gap Closure & Cleanup (1/1 plans) — completed 2026-04-30

Full phase details: archived inline above (see Phase Details section)

</details>

<details>
<summary>✅ v3.1 Call Model With Reference (Phases 107-111) — SHIPPED 2026-05-05</summary>

**Milestone Goal:** Extend `call_model` with document pass-by-reference injection, consolidate `get_document` + `get_doc_outline` into a single structured tool, and add model/purpose discovery — enabling intelligent token-cost-aware LLM delegation without the full agent loop.

- [x] **Phase 107: Consolidated `get_document`** - Structured JSON envelope, `include` parameter, case-insensitive section matching, `get_doc_outline` removal (GDOC-01 through GDOC-10) (completed 2026-05-01)
- [x] **Phase 108: Batch + `follow_ref`** - Array identifiers with partial-failure semantics, dot-path frontmatter pointer traversal to fetch linked document content (FREF-01 through FREF-05) (completed 2026-05-02)
- [x] **Phase 109: Reference Syntax in `call_model`** - `{{ref:...}}` and `{{id:...}}` inline template resolution before LLM dispatch, `injected_references` metadata in response (REFS-01 through REFS-07) (completed 2026-05-02)
- [x] **Phase 110: Discovery Resolvers** - `list_models`, `list_purposes`, `search` resolvers with hard cost metrics from config; `messages` optional for discovery calls (DISC-01 through DISC-06) (completed 2026-05-02)
- [x] **Phase 111: CMR Verification Fixes** - Occurrence-out-of-range error code, test assertion tightening (TC1..TC4 waves), discovery resolver Phase 4 test scenarios (9/9 plans, completed 2026-05-04)

Full details archived in [milestones/v3.1-ROADMAP.md](milestones/v3.1-ROADMAP.md).
Requirements snapshot: [milestones/v3.1-REQUIREMENTS.md](milestones/v3.1-REQUIREMENTS.md) (28/28 complete).

</details>

<details open>
<summary>◆ v3.2 Agentic LLM Tools (Phases 112-120) — PLANNING</summary>

**Milestone Goal:** Extend `call_model` from reference-aware text completion into a FlashQuery-managed agent loop that can expose safe native tools and document/template tools to delegated models.

- [x] **Phase 112: Chat Primitive & Envelope Migration** - Provider-normalized `chat()` primitive, text wrapper compatibility, `return_messages`, round-trippable message shape, provider response normalization, and runnable validation (CHAT-01 through CHAT-06, VAL-112, TEST-01 through TEST-03) — Complete 2026-05-05
- [x] **Phase 113: Document Reference System Core** - Reference grammar, span scanner, escape parity, identifier ambiguity, typed failure taxonomy, non-recursive hydration, and runnable validation (REF-01 through REF-08, VAL-113) — Complete 2026-05-05
- [x] **Phase 114: Template Parameterization** - Template detection, `template_params`, alias entries, document parameters, placeholder substitution, `_items` list injection, and runnable validation (TMPL-01 through TMPL-05, VAL-114) — Complete 2026-05-06
- [ ] **Phase 115: Purpose Config, Bindings & Capabilities** - Purpose orchestration fields, loop defaults validation, `fqc_purpose_templates`, generic config sync, structured model capabilities, Mode 2 admission, and runnable validation (BIND-01 through BIND-05, CAP-01 through CAP-05, VAL-115)
- [x] **Phase 116: Model-Visible Tool Registry** - Purpose-level native tool exposure, exclusions, hard-exclusion warnings, schema translation, strict tool definitions, and runnable validation (TOOL-01 through TOOL-04, VAL-116) — Complete 2026-05-06
- [ ] **Phase 117: Agent Loop Executor** - Mode 2 loop orchestration, internal native dispatch, parallel tool calls, guardrails, fallback, aggregate usage writes, calls log metadata, and runnable validation (LOOP-01 through LOOP-07, TOOL-05, TOOL-06, VAL-117)
- [ ] **Phase 118: Template Discovery & Masquerade Dispatch** - Fresh vault template discovery, generated `flashquery.<namespace>.<slug>` tools, collision-safe reverse map, template tool dispatch, and runnable validation (TMPL-06 through TMPL-08, VAL-118)
- [ ] **Phase 119: Discovery Diagnostics & Help Resolver** - Extended `list_purposes`, structured capability diagnostics in `list_models`, discovery `search`, v1 `help` resolver, and runnable validation (DISC-01 through DISC-04, VAL-119)
- [ ] **Phase 120: Cross-Phase ATL Validation & Coverage Closure** - End-to-end workflow suites, YAML integration closure, scenario matrix updates, and final coverage audit (VAL-120, TEST-04)

**Requirements snapshot:** [REQUIREMENTS.md](REQUIREMENTS.md) (20/62 requirements complete).

</details>

## Phase Details

### Phase 112: Chat Primitive & Envelope Migration
**Goal**: FlashQuery has a provider-normalized chat primitive and a non-breaking `call_model` envelope that can carry round-trippable tool-loop messages while preserving existing Mode 1 behavior.
**Depends on**: Phase 111
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, VAL-112, TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. Developer can call `chat()` and inspect the normalized assistant message, usage, latency, model/provider identity, fallback position, and finish reason for a single provider round trip.
  2. Existing text completion callers still receive text-only results; if a tool-call response reaches a text wrapper, the wrapper returns a clear error instead of pretending the call succeeded.
  3. MCP client can set `return_messages: true` and receive post-hydration input messages plus final assistant output; default Mode 1 calls keep `messages: []`.
  4. Returned message shapes can be passed into a later `call_model` call without schema rejection.
  5. Provider variations around `tool_calls`, empty assistant content, argument shapes, and finish reasons normalize to one internal contract.
  6. Phase-specific runnable tests exist and pass for chat primitive behavior, Mode 1 envelope compatibility, `return_messages`, message round-tripping, and provider normalization, including directed scenario coverage for the public `call_model` envelope behavior; the phase plan names exact commands/scenarios.
**Plans**: `112-01-PLAN.md`, `112-02-PLAN.md`, `112-03-PLAN.md`, `112-04-PLAN.md`, `112-05-PLAN.md`
**UI hint**: no

### Phase 113: Document Reference System Core
**Goal**: Host-authored references are parsed, resolved, hydrated, and reported through a complete v1 grammar with typed failure reasons and safe non-recursive boundaries.
**Depends on**: Phase 112
**Requirements**: REF-01, REF-02, REF-03, REF-04, REF-05, REF-06, REF-07, REF-08, VAL-113
**Success Criteria** (what must be TRUE):
  1. `{{ref:...}}` supports path, filename, and `fq_id` resolution through the standard document identifier ladder.
  2. Section, pointer, and alias operators parse before resolution and reject invalid combinations with stable diagnostics.
  3. Escaped placeholders follow parity semantics and never appear in reference metadata.
  4. Ambiguous shorthand identifiers fail with `ambiguous_document_identifier` and tell the caller to use path or `fq_id`.
  5. Hydration scans only host-authored input messages and does not recursively resolve injected content or model-produced strings.
  6. Phase-specific runnable tests exist and pass for parser edge cases, escape parity, ambiguity, typed failure reasons, metadata, and public reference behavior.
**Plans**: 4 plans
Plans:
**Wave 1**
- [x] 113-01-PLAN.md — Reference failure constants and unit contract coverage

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 113-02-PLAN.md — Span scanner, parser, resolver mapping, and metadata implementation

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 113-03-PLAN.md — `call_model` host-only hydration integration

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 113-04-PLAN.md — Integration, directed scenario, coverage, and traceability closure
**UI hint**: no

### Phase 114: Template Parameterization
**Goal**: Templates become first-class reference targets so hosts can inject parameterized markdown, document parameters, and ordered alias lists into `call_model` messages.
**Depends on**: Phase 113
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04, TMPL-05, VAL-114
**Success Criteria** (what must be TRUE):
  1. Referencing a document with `fq_template: true` applies declared parameters while referencing a plain document ignores `template_params`.
  2. Path-keyed and alias-keyed `template_params` both work, including multiple uses of the same template with different parameter values.
  3. `string` and `document` parameter types validate required/default behavior and produce stable typed failures.
  4. Placeholder substitution is single-pass, deterministic, and non-recursive even when substituted values contain reference-looking strings.
  5. `_items` alias lists inject an ordered sequence of documents/templates with separator support and correct metadata.
  6. Phase-specific runnable tests exist and pass for template validation, substitution, document parameters, aliases, `_items`, and public parameterized-template behavior.
**Plans:** 5/5 plans complete
Plans:
**Wave 1**
- [x] 114-01-PLAN.md — Unit contracts for template resolver and call_model wiring

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 114-02-PLAN.md — Path-keyed template rendering, validation, document params, and substitution

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 114-03-PLAN.md — Alias `_template`, `_items`, and public `template_params` wiring

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 114-04-PLAN.md — Supabase-backed resolver integration validation

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 114-05-PLAN.md — Managed directed scenario, coverage traceability, and docs review
**UI hint**: no

### Phase 115: Purpose Config, Bindings & Capabilities
**Goal**: Startup config and DB sync know which purposes may expose tools/templates, and model capability declarations gate Mode 2 admission before unsafe calls can run.
**Depends on**: Phase 114
**Requirements**: BIND-01, BIND-02, BIND-03, BIND-04, BIND-05, CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, VAL-115
**Success Criteria** (what must be TRUE):
  1. Purpose config accepts `tools`, `excluded_tools`, and `templates`, rejects unknown top-level purpose fields, and type-validates known loop guardrails in defaults.
  2. `fqc_purpose_templates` exists with canonical `template_path` identity, unique rows, source tracking, and YAML/API precedence behavior.
  3. Generic config sync handles the purpose-template binding flow without duplicating YAML scrub/insert logic.
  4. Structured model capabilities replace the old free-form behavior surface for tool execution decisions.
  5. Any purpose that exposes model-visible tools fails config validation unless every fallback model declares required support.
  6. Phase-specific runnable tests exist and pass for config parse/admission, DDL/schema verification, config sync precedence, binding resolution, runtime capability validation, and public startup/config scenarios for user-visible admission errors.
**Plans:** 5/5 plans complete
Plans:
**Wave 1**
- [x] 115-01-PLAN.md — Purpose config schema, loop default validation, capability migration, and example config
- [x] 115-02-PLAN.md — Purpose-template table DDL, schema verification, and capability/tag storage

**Wave 2** *(blocked on 115-01 completion)*
- [x] 115-04-PLAN.md — Structured capability defaulting, startup admission, discovery projection, and response_format guard

**Wave 3** *(blocked on 115-01, 115-02, and 115-04 completion)*
- [x] 115-03-PLAN.md — Generic config sync, purpose-template binding normalization, API precedence, and runtime admission

**Wave 4** *(blocked on 115-03 completion)*
- [x] 115-05-PLAN.md — Public scenario coverage, coverage ledgers, validation gate, and traceability closure
**UI hint**: no

### Phase 116: Model-Visible Tool Registry
**Goal**: FlashQuery can assemble a purpose-specific model-visible tool list from safe native tools and translate those tools into provider-compatible definitions.
**Depends on**: Phase 115
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, VAL-116
**Success Criteria** (what must be TRUE):
  1. Purpose `tools` expands tiers and named tools into a final native allowlist.
  2. `excluded_tools` removes tools from the final set and fails config validation when used without `tools`.
  3. Hard-excluded tools are never exposed and produce clear warnings rather than silent omission.
  4. MCP/Zod input schemas translate to OpenAI-compatible tool definitions with strict schemas when the selected model supports them.
  5. If no model-visible tools remain, provider requests omit `tools` entirely.
  6. Phase-specific runnable tests exist and pass for tier expansion, exclusions, hard-exclusion warnings, schema translation, and at least one public-surface tool-list scenario.
**Plans:** 4/4 plans complete
Plans:
**Wave 1**
- [x] 116-01-PLAN.md — Native tool tier expansion, exclusions, and hard-exclusion diagnostics

**Wave 2** *(blocked on 116-01 completion)*
- [x] 116-02-PLAN.md — MCP tool catalog capture and OpenAI-compatible schema translation
- [x] 116-03-PLAN.md — Startup config validation for purpose tool declarations

**Wave 3** *(blocked on 116-02 and 116-03 completion)*
- [x] 116-04-PLAN.md — call_model provider-tool wiring, public scenario coverage, and VAL-116 closure
**UI hint**: no

### Phase 117: Agent Loop Executor
**Goal**: `call_model` Mode 2 can execute delegated model tool calls internally, enforce loop budgets, aggregate usage, and return complete loop metadata.
**Depends on**: Phase 116
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06, LOOP-07, TOOL-05, TOOL-06, VAL-117
**Success Criteria** (what must be TRUE):
  1. A purpose exposing native tools triggers Mode 2 loop execution and returns a final assistant response after one or more tool iterations.
  2. Native tool calls dispatch through internal FlashQuery handlers and append OpenAI-compatible tool result messages with `tool_call_id`.
  3. Multiple tool calls in one assistant turn use `Promise.allSettled` semantics and let the model recover from individual tool errors.
  4. Timeout, iteration, token, and cost guardrails stop before the next model call and report the correct `stop_reason`.
  5. Mode 2 writes one aggregate usage row and exposes per-iteration detail only in `metadata.tools.calls_log`.
  6. Phase-specific runnable tests exist and pass with a deterministic mock provider for native tool loops, parallel calls, guardrail stops, fallback, usage aggregation, and metadata invariants.
**Plans:** 5 plans
Plans:
**Wave 1**
- [ ] 117-01-PLAN.md — Wave 0 validation scaffolding for loop executor, dispatcher, E2E, and directed scenarios

**Wave 2** *(blocked on 117-01 completion)*
- [ ] 117-02-PLAN.md — Internal native tool dispatcher and catalog handler capture
- [ ] 117-03-PLAN.md — Mode 2 loop executor, non-recording purpose chat, guardrails, and aggregate accounting

**Wave 3** *(blocked on 117-02 and 117-03 completion)*
- [ ] 117-04-PLAN.md — `call_model` Mode 2 routing, envelope metadata, and returned messages

**Wave 4** *(blocked on 117-04 completion)*
- [ ] 117-05-PLAN.md — E2E/directed validation closure, coverage ledgers, and VAL-117 traceability
**UI hint**: no

### Phase 118: Template Discovery & Masquerade Dispatch
**Goal**: Vault templates bound to purposes become collision-safe model-visible tools and can be invoked by delegated models inside the agent loop.
**Depends on**: Phase 117
**Requirements**: TMPL-06, TMPL-07, TMPL-08, VAL-118
**Success Criteria** (what must be TRUE):
  1. Template discovery reads current vault frontmatter and validates the v1 template tool contract.
  2. Generated tool names use `flashquery.<fq_namespace>.<slug>` and collisions are diagnosed before invocation.
  3. Dispatcher resolves model tool names through an explicit reverse map, never by re-searching slug parts.
  4. Template-tool calls validate arguments, hydrate output, and return tool results or typed errors to the delegated model.
  5. Mixed native/template tool purposes can expose both kinds of tools in one model-visible registry.
  6. Phase-specific runnable tests exist and pass for fresh discovery, tool-name generation, collision diagnostics, reverse-map dispatch, template-tool invocation, and mixed native/template loops.
**Plans**: TBD during `$gsd-plan-phase 118`
**UI hint**: no

### Phase 119: Discovery Diagnostics & Help Resolver
**Goal**: MCP clients can discover which purposes, models, templates, and tools are available before invoking an agentic `call_model` request.
**Depends on**: Phase 118
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, VAL-119
**Success Criteria** (what must be TRUE):
  1. `list_purposes` reports native tool and template-tool diagnostics, including collisions and dangling bindings.
  2. `list_models` reports structured tool capability diagnostics with distinct unknown-vs-false messages.
  3. `search` remains usable without messages and covers relevant model/purpose discovery metadata.
  4. `help` explains Mode 1, Mode 2, references, templates, tools, guardrails, and discovery usage in a machine-readable shape.
  5. Discovery calls remain outside the `CallModelEnvelope` and ignore `return_messages`.
  6. Phase-specific runnable tests exist and pass for `list_purposes`, `list_models`, discovery `search`, `help`, and public diagnostics.
**Plans**: TBD during `$gsd-plan-phase 119`
**UI hint**: no

### Phase 120: Cross-Phase ATL Validation & Coverage Closure
**Goal**: The already-tested phase implementations are validated together through cross-phase workflows, YAML integrations, and coverage matrix closure aligned to the accepted ATL Test Plan.
**Depends on**: Phase 119
**Requirements**: VAL-120, TEST-04
**Success Criteria** (what must be TRUE):
  1. Cross-phase E2E workflows prove Mode 1, native tool loops, template tool loops, mixed loops, stops, fallback, and provider compatibility failures together.
  2. YAML integration scenarios prove reference freshness, document-parameter freshness, discovery-to-invocation closure, runtime binding reappearance, and mixed reference modes.
  3. Directed scenario coverage proves public `call_model` behavior across envelopes, references, aliases, template failures, discovery, loops, budgets, usage, capabilities, and help.
  4. Coverage matrices contain accepted ATL rows with final IDs and traceability back to the test plan, including scenario rows that were added incrementally during Phases 112-119.
  5. Phase 120 verifies that Phases 112-119 each shipped their own runnable unit/integration/E2E/scenario tests as applicable; any missing phase-local public-behavior scenario blocks milestone completion unless the phase had no public surface.
  6. Full milestone preflight command set is documented and passes or has explicitly recorded environmental skips.
**Plans**: TBD during `$gsd-plan-phase 120`
**UI hint**: no

### Phase 98: Three-Layer Config Schema, DB Schema & Config Sync
**Goal**: FlashQuery startup accepts three-layer LLM config (providers, models, purposes) with case normalization enforced throughout, syncs the config to four Supabase tables on each startup, and creates the `fqc_llm_usage` table — all with types and constraints that cannot be changed after deployment
**Depends on**: Phase 97 (v2.9 complete)
**Requirements**: PROV-01, PROV-02, MOD-01, MOD-02, MOD-03, PURP-01, PURP-02, PURP-03, CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06, CONF-07, DB-01, DB-02, DB-03, COST-01 (DDL only)
**Success Criteria** (what must be TRUE):
  1. Developer can add a full `llm:` section to `flashquery.yml` with multiple providers, model aliases, and purposes — including names with mixed case like `Nano` or `FAST` — and the server starts without error, with all names stored and resolved as lowercase
  2. Developer with no `llm:` section in their config sees no error or warning at startup; the section is fully optional
  3. Developer using the old flat `llm: { provider: ..., model: ... }` format sees a clear human-readable migration error at startup naming the stale keys — not a cryptic Zod validation failure
  4. Developer providing an invalid name (fails `[a-z0-9][a-z0-9_-]*`), a duplicate model name, a model referencing a nonexistent provider, or a purpose referencing a nonexistent model sees a startup error that names the exact offending entry and the violated rule
  5. After startup with an `llm:` section, the four config tables (`fqc_llm_providers`, `fqc_llm_models`, `fqc_llm_purposes`, `fqc_llm_purpose_models`) contain rows matching the YAML config; webapp-sourced rows from a prior run are preserved and not overwritten; when YAML and webapp define the same name, the webapp row wins and a warning is logged
  6. The `fqc_llm_usage` table exists in Supabase after startup with `BIGINT` token columns and `NUMERIC(18,10)` cost column — verifiable in the Supabase dashboard
  7. All unit tests and directed scenario tests for Phase 98 pass with zero failures
**Plans**: 5 plans
  - [x] 98-01-PLAN.md — Wave 0 unit test scaffolds (U-01..U-14 + CONF-06) — RED state to lock the requirement contract before implementation
  - [x] 98-02-PLAN.md — Three-layer Zod schema, normalize/validate functions, CONF-06 legacy detection in src/config/loader.ts
  - [x] 98-03-PLAN.md — Five DDL blocks for fqc_llm_* tables in src/storage/supabase.ts (BIGINT tokens, NUMERIC(18,10) cost)
  - [x] 98-04-PLAN.md — src/llm/config-sync.ts with syncLlmConfigToDb() + raw api_key_ref preservation in loader.ts
  - [x] 98-05-PLAN.md — initLlm wiring in src/index.ts, three template files, FQCServer extra_config support, L-01/L-02 directed scenarios

### Phase 99: LLM Completions Client
**Goal**: FlashQuery can make a single Chat Completions API call to any configured provider and return a parsed result — the atomic HTTP unit covering OpenAI, OpenRouter, Ollama, and any OpenAI-compatible provider
**Depends on**: Phase 98
**Requirements**: LLM-01, LLM-05
**Success Criteria** (what must be TRUE):
  1. Developer calling `llmClient.complete()` with a configured model alias gets a parsed response with `content`, `usage.input_tokens`, and `usage.output_tokens` populated
  2. Developer starting the server with an `llm:` section sees a startup banner line reporting "LLM: N providers, M purposes configured"; developer without an `llm:` section sees "LLM: not configured"
  3. A call to an Ollama endpoint on a LAN address (e.g., `http://192.168.x.x:11434`) completes without EHOSTUNREACH — `nodeFetch` (`node:http`) is used for local addresses, not global `fetch`
  4. A call that exceeds the configured timeout produces a timeout error (not a hung process); the error message is human-readable regardless of whether the provider returns an OpenAI-shaped or vLLM-shaped error body
  5. All unit tests and directed scenario tests for Phase 99 pass with zero failures
**Plans**: 3 plans
  - [x] 99-00-PLAN.md — Wave 0 RED-state test scaffolds: tests/unit/llm-client.test.ts (U-15..U-28) + tests/scenarios/directed/testcases/test_llm_startup.py (L-03)
  - [x] 99-01-PLAN.md — Implement src/llm/client.ts: types, OpenAICompatibleLlmClient.complete(), NullLlmClient, mergeParameters, nodeFetch, AbortController timeout
  - [x] 99-02-PLAN.md — Wire initLlm into src/llm/client.ts; remove initLlm from src/llm/config-sync.ts; update src/index.ts import

### Phase 100: Purpose Resolver & Fallback Chain
**Goal**: FlashQuery can resolve a named purpose to a completion result by walking the fallback chain in order, applying three-level parameter merge, and classifying errors correctly to stop or advance the chain
**Depends on**: Phase 99
**Requirements**: LLM-02, LLM-03, LLM-04
**Success Criteria** (what must be TRUE):
  1. A call to `resolveAndComplete("my-purpose", messages, params)` returns a result from the first working model in the chain; if that model fails with a transient error (429/5xx/timeout), the call transparently retries on the next model with appropriate delay on 429
  2. A permanent error (400/401/403) from any model stops the chain immediately — no further models are attempted — and a structured error is returned
  3. A purpose where all models fail returns a structured error listing each attempted model and its failure reason — not a crash or unhandled rejection
  4. Caller-supplied params override purpose defaults, which override model/provider defaults — a developer can verify the correct `temperature`/`max_tokens` are sent in the outgoing request
  5. `getModelForPurpose("my-purpose")` returns the first model's config without making a network call; returns `null` for a purpose with an empty `models:` list
  6. All unit tests and directed scenario tests for Phase 100 pass with zero failures
**Plans**: 3 plans
  - [x] 100-00-PLAN.md — Wave 0 RED-state TDD scaffolds: tests/unit/llm-resolver.test.ts (U-39..U-62) + extend tests/unit/llm-client.test.ts (U-29..U-38)
  - [x] 100-01-PLAN.md — Add LlmHttpError/LlmNetworkError to src/llm/client.ts; upgrade complete() throws to typed errors with Retry-After parsing
  - [x] 100-02-PLAN.md — Create src/llm/resolver.ts (PurposeResolver, LlmFallbackError, delay); extend LlmClient interface; wire OpenAICompatibleLlmClient + NullLlmClient

### Phase 101: `call_model` MCP Tool
**Goal**: Claude (or any MCP client) can call `call_model` to invoke any configured model or purpose and receive a diagnostic response envelope with optional trace tracking — and the tool is always present in the tool list even when LLM is unconfigured
**Depends on**: Phase 100
**Requirements**: TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05
**Success Criteria** (what must be TRUE):
  1. An MCP client calling `call_model` with `resolver: "purpose"` and a valid purpose name receives the model's text output plus a diagnostic envelope containing `resolver`, `name`, `resolved_model_name`, `provider_name`, `fallback_position`, `tokens.input`, `tokens.output`, `cost_usd`, and `latency_ms`
  2. An MCP client calling `call_model` with `resolver: "model"` and a valid model alias receives the same diagnostic envelope with `fallback_position: null`
  3. An MCP client providing a `trace_id` string receives that value echoed in the response envelope and a `trace_cumulative` field showing total calls, tokens, cost, and latency across all calls sharing that `trace_id`
  4. An MCP client calling `call_model` on a FlashQuery instance with no `llm:` section receives a clean actionable error message explaining that LLM is not configured — not a crash or empty response
  5. `call_model` appears in the MCP tool listing regardless of whether an `llm:` section is present in the config
  6. All unit tests and directed scenario tests for Phase 101 pass with zero failures
**Plans**: 2 plans
  - [x] 101-00-PLAN.md — Wave 0 RED-state TDD scaffolds: tests/unit/llm-tool.test.ts (U-29..U-31) + 6 directed scenario stubs (L-04..L-15) + 2 integration scenario YAMLs (IL-01, IL-02)
  - [x] 101-01-PLAN.md — Implement src/mcp/tools/llm.ts (registerLlmTools, computeCost, call_model handler with NullLlmClient guard, LlmFallbackError formatting, fqc_llm_usage sync write, trace_cumulative); wire into src/mcp/server.ts

### Phase 102: Cost Tracking
**Goal**: Every LLM call is recorded to `fqc_llm_usage` in a fire-and-forget manner that never affects call latency, never advances the fallback chain on failure, records `trace_id` when provided, and drains cleanly on SIGTERM
**Depends on**: Phase 101
**Requirements**: COST-01 (runtime recording), COST-02, COST-03, COST-04
**Success Criteria** (what must be TRUE):
  1. After a successful `call_model` invocation, a row appears in `fqc_llm_usage` with purpose name, model alias, provider name, input tokens, output tokens, cost (USD), latency, fallback position, and timestamp — verifiable in the Supabase dashboard
  2. A direct model call (`resolver: "model"`) produces a `fqc_llm_usage` row with `purpose = "_direct"`, distinguishable from purpose-resolved calls
  3. A call that includes a `trace_id` produces a `fqc_llm_usage` row with that `trace_id` recorded alongside the other fields
  4. Deliberately breaking the Supabase connection during an LLM call results in a `WARN`-level log entry but the LLM response still reaches the MCP client with correct content — no error is surfaced
  5. On SIGTERM, in-flight cost writes drain before process exit (ShutdownCoordinator integration); no rows are silently dropped
  6. All unit tests and directed scenario tests for Phase 102 pass with zero failures
**Plans**: 2 plans
  - [x] 102-00-PLAN.md — Wave 0 RED-state TDD scaffolds (U-32..U-35 unit tests + L-16/L-17 directed scenario + IL-03 integration scenario; updates U-29 import in llm-tool.test.ts)
  - [x] 102-01-PLAN.md — Implement src/llm/cost-tracker.ts (LlmUsageRecord, recordLlmUsage fire-and-forget, drainCostWrites, computeCost); extend LlmClient with traceId; wire recordLlmUsage from OpenAICompatibleLlmClient with _direct sentinel; remove sync insert from llm.ts and adapt trace_cumulative; integrate drainCostWrites into ShutdownCoordinator as Step 2.5

### Phase 103: `get_llm_usage` MCP Tool
**Goal**: Claude (or any MCP client) can query aggregated LLM usage data across four modes with flexible date range and entity filters, always receiving pre-aggregated results rather than raw rows — and the tool is always registered regardless of LLM configuration
**Depends on**: Phase 102
**Requirements**: REPT-01, REPT-02
**Success Criteria** (what must be TRUE):
  1. An MCP client calling `get_llm_usage` with `mode: "summary"` receives total calls, total spend, avg cost per call, avg latency, top purpose, top model, and a `vs_prior_period` comparison block covering the same-length preceding period
  2. An MCP client calling `get_llm_usage` with `mode: "by_purpose"` receives a purposes array (named purposes) and a separate `direct_model_calls` field for `_direct` rows — the two are never merged
  3. An MCP client calling `get_llm_usage` with `mode: "by_model"` receives per-model aggregates including `pct_of_total_calls` and `avg_fallback_position`; `mode: "recent"` returns individual call records newest-first up to the requested `limit`
  4. An MCP client providing `period: "7d"` or explicit `from_date`/`to_date` ISO 8601 strings receives results scoped to that window; filters `purpose_name`, `model_name`, and `trace_id` further narrow results when provided
  5. `get_llm_usage` appears in the MCP tool listing regardless of whether an `llm:` section is present in the config
  6. All unit tests and directed scenario tests for Phase 103 pass with zero failures
**Plans**: 2 plans
  - [x] 103-00-PLAN.md — Wave 0 RED-state TDD scaffolds (U-36..U-42 unit tests + L-18..L-22 directed scenarios + IL-04 integration scenario + DIRECTED/INTEGRATION coverage matrix updates)
  - [x] 103-01-PLAN.md — Implement src/mcp/tools/llm-usage.ts (registerLlmUsageTools with summary/by_purpose/by_model/recent modes, resolveWindow four-rule precedence, vs_prior_period second query, _direct separation, NUMERIC/BIGINT coercion); wire into src/mcp/server.ts after registerLlmTools

### Phase 104: Embedding Migration
**Goal**: The embedding subsystem routes through the `embedding` purpose when one is configured, while remaining completely unchanged when no `embedding` purpose exists — zero behavioral regression for existing users
**Depends on**: Phase 103
**Requirements**: EMBED-01, EMBED-02
**Success Criteria** (what must be TRUE):
  1. Developer who adds an `embedding` purpose to their `llm:` config sees `save_memory` and document embedding calls route through that purpose's model — verifiable by checking `fqc_llm_usage` rows with `purpose = "embedding"`
  2. Developer with no `embedding` purpose configured sees identical embedding behavior to v2.x — same provider, same model, same vectors stored — with no config changes required
  3. `initLlm()` is called before `initEmbedding()` in the startup sequence, and `llmClient` is passed as an explicit parameter to `initEmbedding()` — visible in the startup log; no silent module-global ordering
  4. All integration tests covering semantic search (`search_memory`, `search_documents`) pass with both the old embedding config path and the new purpose-routing path
  5. All unit tests and directed scenario tests for Phase 104 pass with zero failures
**Plans**: 3 plans
  - [x] 104-00-PLAN.md — Wave 0 RED-state TDD scaffolds (U-44/U-44b/U-45/U-45b unit tests + L-23 directed scenario stub + DIRECTED_COVERAGE.md update)
  - [x] 104-01-PLAN.md — Implement initEmbedding(config, llmClient?) purpose-path branch in src/embedding/provider.ts; D-07 deprecation warning in src/config/loader.ts; flip startup order (initLlm before initEmbedding) in src/index.ts; replace L-23 stub with full save_memory/search_memory round-trip
  - [x] 104-02-PLAN.md — Gap closure: fix CR-01 (test_embedding_migration.py uses server.captured_logs property, not nonexistent server.read_log() method) and WR-02 (loader.ts D-07 condition excludes provider==='none' to suppress false-positive deprecation warning when user correctly migrates)

### Phase 105: Config Template Updates
**Goal**: The example config files accurately reflect the three-layer LLM config structure with representative examples that a new user can copy and adapt, with no stale references to the old flat format
**Depends on**: Phase 104
**Requirements**: TMPL-01
**Success Criteria** (what must be TRUE):
  1. `flashquery.example.yml` contains a commented `llm:` section showing at least one provider, one model alias with cost rates, and one purpose with a fallback list — a new user can copy-paste and fill in their API key
  2. `.env.example` and `.env.test.example` include example environment variable entries for provider API keys using the `${ENV_VAR}` expansion syntax introduced in MOD-03
  3. No stale references to the old flat `llm: { provider, model }` format remain in any of the three template files
  4. All unit tests and directed scenario tests for Phase 105 pass with zero failures (no regressions from template changes)
**Plans**: 2 plans
  - [x] 105-00-PLAN.md — Wave 0 RED-state TDD scaffold: tests/unit/config-template.test.ts with 8 [TMPL-01] cases (loadConfig parse + readFileSync regex assertions)
  - [x] 105-01-PLAN.md — Implementation: replace flashquery.example.yml LLM section (D-01..D-06), promote OPENAI_API_KEY to active entry in .env.example (D-07), append commented OPENROUTER_API_KEY to .env.test.example (D-11)

### Phase 106: v3.0 Gap Closure & Cleanup
**Goal**: Resolve all outstanding audit and verification gaps from the v3.0 milestone — the B-01 double-/v1 endpoint blocker, the pct_of_total_calls fraction bug, code quality warnings, and documentation debt — so the milestone audit passes cleanly
**Depends on**: Phase 105
**Requirements**: LLM-01, TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, COST-01, COST-02, COST-03, COST-04, EMBED-01, TMPL-01
**Gap Closure**: Closes all gaps from v3.0-MILESTONE-AUDIT.md and Native-LLM-Access-Requirements-Verification.md
**Success Criteria** (what must be TRUE):
  1. `flashquery.example.yml` uses base endpoint URLs (no `/v1` suffix) for OpenAI and OpenRouter providers; the `llm:` defaults block is uncommented; `embedding.provider: none` guidance is present — a user copying the template gets working config without URL errors
  2. `get_llm_usage` mode `by_model` returns `pct_of_total_calls` as a fraction (0–1), not a percentage (0–100); a unit test asserts the value is ≤ 1.0
  3. `NullLlmClient.getModelForPurpose()` returns `null` instead of throwing — satisfies the `LlmClient` interface contract
  4. The over-broad catch on the `resolver=model` path in `llm.ts` no longer converts HTTP 401/timeout errors into "model not found" responses
  5. The startup ready banner correctly reports embedding status when `embedding.provider: none` is set and routing via LLM purpose
  6. `call_model` tool description documents that `trace_id` is omitted (not null) in the response envelope when no trace ID is provided
  7. REQUIREMENTS.md checkboxes for TOOL-01..05 and COST-02..04 are checked `[x]`; TOOL-01 description reflects `messages[]` array input
  8. All tests pass with zero failures
**Plans**: 1 plan
  - [x] 106-01-PLAN.md — All 11 gap closure tasks: endpoint fix + uncomment + W-02 guidance, config-template.test.ts assertion, pct_of_total_calls fix + unit test, NullLlmClient fix, WR-01 catch narrowing, W-01 ready banner, trace_id tool description, REQUIREMENTS.md checkbox + description updates

### Phase 107: Consolidated `get_document`
**Goal**: The `get_document` MCP tool delivers a structured, LLM-friendly document retrieval API that gives callers precise control over what they receive — body, frontmatter, headings, or any combination — wrapped in a consistent metadata envelope; `get_doc_outline` is removed
**Depends on**: Phase 106
**Requirements**: GDOC-01, GDOC-02, GDOC-03, GDOC-04, GDOC-05, GDOC-06, GDOC-07, GDOC-08, GDOC-09, GDOC-10
**Success Criteria** (what must be TRUE):
  1. An LLM calling `get_document` with no `include` parameter receives the document body (default behavior); calling with `include: ["frontmatter", "headings"]` receives the complete frontmatter as a JSON object and a heading list with per-heading character counts — all in a single response
  2. Every `get_document` response (regardless of `include` value) contains a metadata envelope with `identifier`, `title`, `path`, `fq_id`, `modified`, and `size.chars` where `title` is `fq_title` trimmed when present and non-whitespace, otherwise the filename basename without extension
  3. An LLM calling `get_document` with `include: ["frontmatter"]` sees all user-defined custom frontmatter fields in the response — fields that the old `get_doc_outline` silently dropped are now present
  4. An LLM calling `get_document` with a section name that does not exist (or requesting the 3rd occurrence of a heading that only appears twice) receives a `section_not_found` error listing every failed query in `missing_sections[]` with a reason — no partial body is returned
  5. The `get_doc_outline` tool no longer appears in the MCP tool listing; all its functionality is available via `get_document` with `include: ["frontmatter", "headings"]`
**Plans**: 5 plans
  - [x] 107-01-PLAN.md — Wave 0 RED-state unit-test scaffolds (tests/unit/document-output.test.ts + tests/unit/markdown-sections.test.ts; locks GDOC-01,-02,-03,-05,-06,-07,-08,-09 contract via U-01..U-08s coverage IDs)
  - [x] 107-02-PLAN.md — Pure-logic implementation: src/mcp/utils/document-output.ts (NEW) + src/mcp/utils/markdown-sections.ts case-insensitive matching + extractMultipleSections (turns 107-01 tests GREEN)
  - [x] 107-03-PLAN.md — get_document handler rewrite (src/mcp/tools/documents.ts) returning JSON envelope; delete get_doc_outline registration from src/mcp/tools/compound.ts (GDOC-10)
  - [x] 107-04-PLAN.md — Update existing TypeScript test suite to JSON envelope assertions; delete tests/unit/get-doc-outline.test.ts; remove get_doc_outline references from unit/integration/e2e tests
  - [x] 107-05-PLAN.md — Create 3 new Python directed scenario tests (D-27..D-50, O-07..O-10), update 12 existing directed tests for JSON parsing, retire test_document_outline.py, update DIRECTED_COVERAGE.md
**UI hint**: no

### Phase 108: Batch + `follow_ref`
**Goal**: `get_document` supports array batch retrieval with per-element partial failure semantics and single-hop frontmatter pointer dereference — an LLM can fetch multiple related documents or follow an internal link in one call
**Depends on**: Phase 107
**Requirements**: FREF-01, FREF-02, FREF-03, FREF-04, FREF-05
**Success Criteria** (what must be TRUE):
  1. An LLM calling `get_document` with `identifiers: ["path/a.md", "path/b.md"]` receives a two-element array where a successfully resolved document contains its content and a failed document contains a structured error object at its array position — the call itself does not fail
  2. An LLM calling `get_document` with `follow_ref: "client"` on a document whose frontmatter contains `client: "uuid-or-path"` receives the source document's envelope plus the target document's content nested under `followed_ref` — all `include`, `sections`, and `max_depth` parameters apply to the target
  3. A `follow_ref` path that does not exist in the source document's frontmatter, points to a non-string value, or targets a document that cannot be found returns a top-level error (not nested); post-resolution errors like `section_not_found` on the target document return nested under `followed_ref`
  4. An LLM calling `get_document` with both `identifiers[]` (batch) and `follow_ref` gets the pointer applied to every source document; documents that lack the pointer return per-element errors while those with it return their `followed_ref` content
  5. All `include`, `sections`, `occurrence`, and `max_depth` parameter validation rules apply uniformly regardless of whether `follow_ref` is used — the same contract governs both single and dereferenced retrieval
**Plans**: 4 plans
  - [x] 108-01-PLAN.md — Wave 1 TDD: traverseFollowRef helper + FollowedRefResult type in document-output.ts; 7 unit tests [U-FR-01..07]
  - [x] 108-02-PLAN.md — Wave 2: get_document handler extension — Zod union for identifiers, follow_ref param, batch Promise.all loop, follow_ref pre/post-resolution error nesting (resolveOneElement extracted)
  - [x] 108-03-PLAN.md — Wave 3: directed scenario tests test_batch_get_document.py (D-51, D-52) + test_follow_ref_get_document.py (D-50, D-53..D-60, D-39a..D-39f) + DIRECTED_COVERAGE.md
  - [x] 108-04-PLAN.md — Wave 1 (parallel): close Phase 107 deferred YAML debt — get_document_metadata.yml + archive_status_field.yml migrations from get_doc_outline to get_document include=[frontmatter]
**UI hint**: no

### Phase 109: Reference Syntax in `call_model`
**Goal**: `call_model` can hydrate vault document content directly into message strings via `{{ref:...}}` and `{{id:...}}` placeholder syntax before dispatching to the LLM — the LLM does not need to make a separate `get_document` call; response metadata reports exactly what was injected
**Depends on**: Phase 108
**Requirements**: REFS-01, REFS-02, REFS-03, REFS-04, REFS-05, REFS-06, REFS-07
**Success Criteria** (what must be TRUE):
  1. An LLM message containing `{{ref:Projects/standup.md}}` results in a `call_model` request where that placeholder is replaced with the document's full body before the external model receives the message — the external model sees the resolved content, not the placeholder
  2. An LLM message using `{{ref:path#Section}}` receives only the named section's content in place of the placeholder; `{{ref:path->pointer}}` receives the content of the document referenced in the source's frontmatter at that dot-path; `#` and `->` operators cannot appear together in a single placeholder
  3. `call_model` with `{{id:uuid}}`, `{{id:uuid#Section}}`, and `{{id:uuid->pointer}}` placeholders resolves the same way as path-based references using `fq_id` lookup — both syntaxes are fully supported
  4. The `call_model` response includes `injected_references[]` in its metadata — one entry per resolved placeholder with the exact character count of the injected content and `resolved_to` for `->` dereferences; `prompt_chars` reflects total resolved message character count
  5. A message with no `{{ref:...}}` or `{{id:...}}` patterns is forwarded to the external model byte-for-byte unchanged — existing `call_model` behavior is fully preserved
  6. If any placeholder cannot be resolved (document not found, section missing, pointer target absent), `call_model` returns `reference_resolution_failed` with per-reference failure reasons and makes no LLM call
**Plans**: 3 plans
  - [x] 109-01-PLAN.md — Wave 1: extract resolve pipeline into resolveAndBuildDocument() + DocumentRequestError in document-output.ts; refactor documents.ts to delegate (prerequisite for reference-resolver imports)
  - [x] 109-02-PLAN.md — Wave 2: src/llm/reference-resolver.ts new module (5 functions + 5 types) calling resolveAndBuildDocument + tests/unit/reference-resolver.test.ts (U-RR-01..18) covering REFS-01, REFS-02, REFS-04, REFS-05, REFS-07
  - [x] 109-03-PLAN.md — Wave 3: wire Step 1.5 into src/mcp/tools/llm.ts + 5 handler-level unit tests (U-RR-INT-01..05) + 5 integration scenarios (IL-10..IL-14) covering REFS-01, REFS-03, REFS-06, REFS-07
**UI hint**: no

### Phase 110: Discovery Resolvers
**Goal**: An LLM can introspect the FlashQuery LLM configuration — listing models, purposes, or searching both — using `call_model` with a discovery resolver; no `messages` parameter is required for discovery calls
**Depends on**: Phase 109
**Requirements**: DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06
**Success Criteria** (what must be TRUE):
  1. An LLM calling `call_model` with `resolver: "list_models"` (and no `messages`) receives a list of all configured models with `name`, `provider`, `model_id`, `input_cost_per_million`, `output_cost_per_million`, and any declared optional fields (`description`, `context_window`, `capabilities`)
  2. An LLM calling `call_model` with `resolver: "list_purposes"` receives all configured purposes with their name, description, fallback model chain, and cost rates from the primary model
  3. An LLM calling `call_model` with `resolver: "search"` and `parameters.query: "fast"` receives purposes and models whose name or description contains "fast" (case-insensitive); categories with no matches return empty arrays, not an error
  4. Optional model fields (`description`, `context_window`, `capabilities`) appear in discovery responses only when declared in config; explicitly-declared empty values (e.g., `capabilities: []`) are preserved verbatim in the response
  5. An LLM calling any discovery resolver on a FlashQuery instance with no `llm:` section receives the same `llm_not_configured` error as model/purpose resolvers; a configured-but-empty `llm:` section returns empty arrays with a success response
**Plans**: 3 plans
  - [x] 110-01-PLAN.md — Wave 1: Extend ModelSchema + FlashQueryConfig with optional description/context_window/capabilities; add 6 DISC-05 unit tests in tests/unit/llm-config.test.ts
  - [x] 110-02-PLAN.md — Wave 2: Extend call_model resolver enum + make name/messages optional + insert Step 1.1 discovery dispatch (list_models/list_purposes/search) and Step 1.2 body-guard; add 14 U-DISC unit tests in tests/unit/llm-tool.test.ts
  - [x] 110-03-PLAN.md — Wave 3: Create llm_discovery_list.yml + llm_discovery_search.yml integration scenarios + 6 new IL-15..IL-20 rows in INTEGRATION_COVERAGE.md
**UI hint**: no

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 84. Schema Parsing & Policy Infrastructure | v2.8 | 3/3 | Complete | 2026-04-20 |
| 85. Reconciliation Engine | v2.8 | 5/5 | Complete | 2026-04-20 |
| 86. Record Tool Integration & Pending Review | v2.8 | 5/5 | Complete | 2026-04-21 |
| 87. Scanner Modifications & Frontmatter Sync | v2.8 | 3/3 | Complete | 2026-04-21 |
| 88. Legacy Infrastructure Removal | v2.8 | 6/6 | Complete | 2026-04-21 |
| 89. Test Helper & Existing Test Updates | v2.8 | 4/4 | Complete | 2026-04-21 |
| 90. Frontmatter Field Name Centralization | v2.9 | 7/7 | Complete | 2026-04-23 |
| 91. Shared Utilities | v2.9 | 2/2 | Complete | 2026-04-24 |
| 92. create_directory Handler | v2.9 | 1/1 | Complete | 2026-04-24 |
| 93. list_vault Handler | v2.9 | 2/2 | Complete | 2026-04-24 |
| 94. Migration and Cleanup | v2.9 | 1/1 | Complete | 2026-04-25 |
| 95. Integration Tests | v2.9 | 3/3 | Complete | 2026-04-25 |
| 96. Coverage Matrix Updates | v2.9 | 1/1 | Complete | 2026-04-25 |
| 97. Plugin Updates | v2.9 | 3/3 | Complete | 2026-04-25 |
| 98. Three-Layer Config Schema, DB Schema & Config Sync | v3.0 | 5/5 | Complete | 2026-04-28 |
| 99. LLM Completions Client | v3.0 | 3/3 | Complete | 2026-04-29 |
| 100. Purpose Resolver & Fallback Chain | v3.0 | 3/3 | Complete | 2026-04-29 |
| 101. call_model MCP Tool | v3.0 | 2/2 | Complete | 2026-04-29 |
| 102. Cost Tracking | v3.0 | 2/2 | Complete | 2026-04-29 |
| 103. get_llm_usage MCP Tool | v3.0 | 2/2 | Complete | 2026-04-29 |
| 104. Embedding Migration | v3.0 | 3/3 | Complete | 2026-04-30 |
| 105. Config Template Updates | v3.0 | 2/2 | Complete | 2026-04-30 |
| 106. v3.0 Gap Closure & Cleanup | v3.0 | 1/1 | Complete | 2026-04-30 |
| 107. Consolidated get_document | v3.1 | 5/5 | Complete    | 2026-05-01 |
| 108. Batch + follow_ref | v3.1 | 4/4 | Complete    | 2026-05-02 |
| 109. Reference Syntax in call_model | v3.1 | 3/3 | Complete   | 2026-05-02 |
| 110. Discovery Resolvers | v3.1 | 3/3 | Complete    | 2026-05-02 |

## Archive: Completed Milestones v1-v2.9

**For detailed information about completed milestones:**
- v2.9: [milestones/v2.9-ROADMAP.md](milestones/v2.9-ROADMAP.md) — Phases 90-97 detail
- v2.8: [milestones/v2.8-ROADMAP.md](milestones/v2.8-ROADMAP.md) — Phases 84-89 detail
- v2.5 + v2.5.1: [milestones/v2.5-ROADMAP.md](milestones/v2.5-ROADMAP.md) — Phases 61-68 + 69-71 detail
- v2.4: [milestones/v2.4-ROADMAP.md](milestones/v2.4-ROADMAP.md) — Phases 54-60b detail
- v2.2: [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md) — Phases 45-48 detail
- v1-v2.1: See milestones/ directory for complete historical records

**Roadmap structure:** Completed milestones are archived to keep the main ROADMAP lean and current.

### Phase 111: CMR Verification Fixes: occurrence_out_of_range error code, local flag, test correctness, and coverage gaps

**Goal:** Close all FAIL and NOT IMPLEMENTED findings from the Call Model With Reference (CMR) verification report, fix INCORRECT tests so spec-correct source code can pass them, and close the highest-priority coverage gaps — resulting in a test suite and source code that fully match the requirements specification.
**Requirements**: GDOC-03, GDOC-04, GDOC-05, GDOC-09, FREF-03, FREF-04, REFS-01, REFS-02, REFS-03, REFS-04, REFS-05, REFS-06, REFS-07, DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06, TMPL-01
**Depends on:** Phase 110
**Plans:** 9/9 plans complete

Plans:
**Wave 1**
- [x] 111-01-PLAN.md — Wave 1 / Phase A: Phase 1 INCORRECT test fixes (TC1-I1 O-10, TC1-I2 [U-07], TC1-I3 D-31e, TC1-I4 D-47)
- [x] 111-02-PLAN.md — Wave 1 / Phase A: Phase 2/4 INCORRECT test fixes + DIRECTED_COVERAGE.md regression flip (TC2-I1 D-39e, TC2-I2 D-59, TC4-I1 [U-DISC-01] + YAML)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 111-03-PLAN.md — Wave 2 / Phase B: Corrections 1+2 — SectionExtractError class + occurrence_out_of_range emission in source + follow_ref single-section catches
- [x] 111-04-PLAN.md — Wave 2 / Phase B: Correction 3 — local: boolean flag in ProviderSchema + interface + RawLlmProvider + auto-derive in modelToResponse + [U-DISC-NEW] unit test

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 111-05-PLAN.md — Wave 3 / Phase B (chained after 111-03; same file: document-output.ts): Correction 5 + Deviation 5 — classifyResolutionMethod helper + endsWith('.md') in resolve-document.ts
- [x] 111-06-PLAN.md — Wave 3 / Phase C: Correction 4 — annotate flashquery.example.yml with description / context_window / capabilities / local
- [x] 111-07-PLAN.md — Wave 3 / Phase C: Correction 6 — Phase 3 directed test files (test_call_model_references.py, test_call_model_multi_ref.py, test_call_model_ref_errors.py) + DIRECTED_COVERAGE.md

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 111-08-PLAN.md — Wave 4 / Phase C (chained after 111-07; same file: DIRECTED_COVERAGE.md): Correction 7 — Phase 4 directed test files (test_discovery_resolvers, test_discovery_resolver_errors, test_discovery_optional_fields) + llm_discovery_then_call.yml + coverage docs
- [x] 111-09-PLAN.md — Wave 4 / Phase D: WEAK test improvements (TC1-W6/7/8/10/13, TC2-W1..W6, TC3-W4/5/6)

---

*Last updated: 2026-05-02 — Phase 111 plans created: CMR Verification Fixes (4 waves, 9 plans, gates on Wave 1 RED → Wave 2 GREEN flip)*
