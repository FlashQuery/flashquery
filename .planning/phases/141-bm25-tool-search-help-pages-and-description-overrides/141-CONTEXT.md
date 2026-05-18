# Phase 141: BM25 Tool Search, Help Pages, And Description Overrides - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning
**Source:** User-supplied MCP Broker requirements and test plan

<domain>
## Phase Boundary

This phase implements Phase C of the MCP Broker feature: native tool search, `fq.search_tools`, FlashQuery-native `.tool.md` help pages, the `help: true` sentinel, FQ-native help hints on errors, and `description_override` propagation.

The phase goal from ROADMAP.md is locked:

- Ship a pure TypeScript BM25 indexer with the pinned parameters and invariants from the POC.
- Expose `fq.search_tools` with ranked `SearchResult` envelopes and clean empty-state behavior.
- For `tool_search: enabled` delegated purposes, inject only `fq.search_tools` up front while keeping disabled purposes on the existing flat tool-injection path.
- Provide validated `.tool.md` metadata for every FlashQuery-native tool, return full help content through `help: true`, and append help hints to FlashQuery-native tool errors.
- Ensure `description_override` reaches every downstream consumer while TOFU continues hashing upstream descriptions.

</domain>

<decisions>
## Implementation Decisions

### Canonical Source Priority
- Downstream agents MUST read the two MCP Broker docs listed in `<canonical_refs>` before making implementation, testing, or ambiguity-resolution decisions.
- If this `CONTEXT.md`, ROADMAP.md, generated research, or generated plan text conflicts with the MCP Broker Requirements or MCP Broker Test Plan, downstream agents must treat the two MCP Broker docs as the higher-priority source and call out the conflict in the plan or summary.
- The MCP Broker Requirements doc is the source of truth for behavior and acceptance requirements.
- The MCP Broker Test Plan doc is the source of truth for test IDs, layers, and per-phase test coverage.
- Every Phase 141 `PLAN.md` task that touches implementation or tests must include both MCP Broker docs in `<read_first>`.

### Phase Scope
- Implement requirements `REQ-074..102`, plus `REQ-011` where per-purpose index lifecycle and `tool_search: enabled` injection behavior are required.
- Treat `REQ-085..087` as the consumer-surface contract for delegated purpose and host search behavior.
- Keep semantic vector routing, `.tool.md` hot reload, persistent TOFU, HTTP transport, OAuth/DCR, MCP resources/prompts/sampling forwarding, and synthesized-skill features out of scope.
- Do not reimplement Phase 139 broker foundation or Phase 140 TOFU/list-changed state except where Phase 141 must attach to their existing seams.

### BM25 Indexer And Search Tool
- Implement a zero-dependency pure TypeScript indexer with pinned parameters: `k1=2.0`, `b=0.5`, BM25+ `delta=0.25`, name boost `3x`, stopwords enabled, stemming disabled.
- Preserve the fixed indexer API from the MCP Broker Requirements: `build`, `addTools`, `removeTools`, `search`, `getStats`.
- `build(tools)` and duplicate `addTools(tools)` must be idempotent.
- `removeTools(keys)` must tolerate nonexistent keys as a no-op.
- `search(query, k)` must return up to `k` ranked results, with an empty query or empty corpus returning an empty array rather than an error.
- `getStats()` reports live counts, not tombstones.
- Port the BM25 POC corpora and query fixtures into production tests per `REQ-088`.

### `fq.search_tools`
- Add an MCP tool named `fq.search_tools` with signature `query: string, limit?: number = 8`.
- Return `SearchResult` envelopes containing `server`, `tool`, `registry_key`, `description`, `arg_summary`, `score`, `normalizedScore`, and optional `has_help` / `help_hint`.
- Populate `has_help` and `help_hint` only for FlashQuery-native results; omit them or set `has_help: false` for brokered results.
- `description` in search results must reflect `description_override` when configured.
- Audit each `search_tools` invocation with consumer identity, query, result count, latency, and trace ID.

### Tool Search Consumer Behavior
- For a delegated purpose with `tool_search: enabled`, build a per-invocation BM25 index at `call_model` engine initialization time.
- For a `tool_search: enabled` purpose with at least one eligible tool, inject only `fq.search_tools` up front, plus any already-always-present tools; discover all other eligible FQ-native and brokered tools through search.
- For `tool_search: disabled`, preserve existing flat-list behavior.
- Host search behavior must index FQ-native tools plus brokered tools visible through `host.mcp_servers` when `host.tool_search: enabled`.
- Phase 140 list-changed handling must be able to call into the indexer synchronously through the existing or planned index-update seam.

### Help Convention
- Add one `.tool.md` file per FlashQuery-native tool at `src/mcp/tools/<tool_name>.tool.md`.
- Each `.tool.md` file must include frontmatter with `name` and `description`, and the `description` must end with a sentence containing both "help" and "true" or `{help: true}`. Optional `help_hint`, `tier`, and `args` fields may be recognized when present, but missing `tier` or `args` is warning-level only.
- Build or startup validation must fail clearly on missing `name`, name/filename mismatch, missing required fields, invalid description suffix, duplicate names, or YAML/frontmatter parse failure.
- Short descriptions under 40 chars warn but do not fail.
- Build a `TOOL_META` registry from `.tool.md` files and use it for MCP registration descriptions, `search_tools` help hints, and `help: true` dispatch.
- `help: true` on an FQ-native tool bypasses normal schema validation and returns the raw `.tool.md` body as text.
- `help: true` on a brokered tool is forwarded upstream unchanged; FlashQuery must not synthesize brokered help.
- FQ-native tool errors append the canonical help-pointer footer. Brokered tool errors remain unwrapped.
- `call_macro.tool.md` frontmatter `description` and `help_hint` must use the verbatim strings from the MCP Broker Requirements and BM25 POC; retuning requires rerunning the call-macro placement validation.

### `description_override`
- Substitute `description_override` before every downstream consumer sees a brokered tool description, including agent-loop tool lists, host MCP `tools/list`, BM25 indexing, and `fq.search_tools` results.
- TOFU hashing must continue using the upstream original description, not the override.
- Changing or removing `description_override` must not trigger TOFU re-approval.

### Phase 140 Gap-Fix Carry-Forward
- Phase 140 gap fixes were committed in FlashQuery as `9020acc fix: close mcp broker tofu phase 140 gaps`. Downstream Phase 141 agents must treat these as the current broker/TOFU/list-changed contract.
- `ConsumerContext` now includes optional `interactive?: boolean`. Purpose contexts created by the agent loop set `interactive` based on whether a live chat surface exists. Phase 141 search-index code must preserve this field when calling `Broker.listToolsForConsumer(ctx)` or `Broker.callTool(...)` so schema drift remains promptable only in interactive contexts and records `blocked_on_user` otherwise.
- `Broker.ensureConnected(serverId, options?)` now accepts `ToolListSnapshotOptions`; `McpBroker.callTool` and `listToolsForConsumer` derive snapshot options from `ConsumerContext`. Phase 141 host/purpose index builds must use the broker public APIs with the right consumer context rather than bypassing `ensureConnected` or re-fetching broker clients directly.
- `ToolIndexSink` remains the synchronous add/remove seam. `McpBroker.applyToolListSnapshot` removes changed/removed registry keys before adding trusted tools, and calls `indexSink.removeTools(...)` / `indexSink.addTools(...)` in that order. Phase 141 should attach BM25 index managers to this seam instead of creating a second list-changed path.
- Broker audit events are timestamped through `recordBrokerAuditEvent(event: BrokerAuditEventInput): BrokerAuditEvent`. If Phase 141 adds `search_tools` audit events in this module, it must follow the same input-vs-timestamped event pattern and include tests for `ts`.
- `hashToolSchema` canonicalizes `undefined` as `null` and hashes upstream `{ name, description, inputSchema }`. Do not change this behavior while wiring `description_override` into search/index surfaces.

### Test Contract
- The implementation plan must include the Phase C test set from the MCP Broker Test Plan:
  - Unit: `T-U-022..034` and `T-U-044`.
  - Integration: `T-I-026`, `T-I-028`, `T-I-029`, `T-I-033..035`, `T-I-035a`, `T-I-036`, `T-I-037`, `T-I-040..049`.
  - E2E: `T-E-C1`.
  - Directed scenarios: `T-S-021`, `T-S-022`.
  - YAML integration scenarios: `T-Y-008`, `T-Y-013`.
- Plans should include targeted regressions for `REQ-101` and `REQ-102` if existing Phase 140 tests do not already protect them after `description_override` wiring changes.

### the agent's Discretion
- Exact module decomposition is left to the planner and executor, but it should align with `src/services/tool-search/` from the MCP Broker Requirements and with existing Phase 139/140 broker modules.
- Exact text of individual `.tool.md` help bodies is discretionary, but each page must be useful to an AI caller and must include purpose, params, returns, examples, gotchas, and related tools.
- Exact benchmark harness shape is discretionary as long as the POC fixture expectations and performance budgets are asserted.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MCP Broker Requirements
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` - Primary requirements source. Read especially §7.12 `REQ-074..088`, §7.13 `REQ-089..099`, §7.14 `REQ-100..102`, `REQ-011`, `REQ-085..087`, and Phase C implementation guidance in §10.

### MCP Broker Test Plan
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md` - Primary QA source. Read especially the Phase C test slice and detailed cases for `T-U-022..034`, `T-U-044`, `T-I-026`, `T-I-028`, `T-I-029`, `T-I-033..049`, `T-E-C1`, `T-S-021`, `T-S-022`, `T-Y-008`, and `T-Y-013`.

### BM25 POC Fixtures And Reference Implementation
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/src/libraries/pure.ts` - Pure TypeScript BM25 reference indexer.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/src/incremental-test.ts` - Four-invariant unit-test source.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/queries.json` - 48 ranking-quality query fixtures.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/queries-call-macro.json` - 18 `call_macro` placement query fixtures.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/corpus.md` - POC corpus fixture.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/corpus-flashquery.md` - FlashQuery-native corpus fixture and verbatim `call_macro` strings.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/tool-search-bm25-poc/src/call-macro-validation.ts` - No-penalty `call_macro` validation source.

### Project Planning
- `.planning/ROADMAP.md` - Phase 141 goal and success criteria.
- `.planning/REQUIREMENTS.md` - Project-level requirement index.
- `.planning/STATE.md` - Project state and prior decisions.
- `.planning/phases/139-broker-foundation-registry-and-dispatch/139-VERIFICATION.md` - Broker foundation verification status.
- `.planning/phases/140-tofu-schema-pinning-and-tool-list-change-handling/140-RESEARCH.md` - Prior phase research, especially index-update seam handoff.

</canonical_refs>

<specifics>
## Specific Ideas

- Keep the BM25 implementation isolated enough that it can be unit-tested without starting FlashQuery or an MCP server.
- Prefer fixture graduation over synthetic-only tests: copy the POC corpus/query files into `tests/fixtures/tool-search/` and assert against those.
- Treat `.tool.md` validation as a build/startup quality gate; incomplete help metadata should fail before runtime tool exposure.
- Ensure `fq.search_tools` is itself documented through `.tool.md` if it is an FQ-native tool exposed to models.
- Ensure every implementation plan task that modifies behavior or tests lists the two MCP Broker docs in `<read_first>`.

</specifics>

<deferred>
## Deferred Ideas

- Semantic vector tool routing.
- Hot-reload of `.tool.md` files.
- Persistent TOFU storage across FlashQuery restarts.
- Streamable HTTP transport and OAuth/DCR.
- MCP resources, prompts, sampling, and elicitation forwarding.

</deferred>

---

*Phase: 141-bm25-tool-search-help-pages-and-description-overrides*
*Context gathered: 2026-05-18 from user-supplied MCP Broker docs*
