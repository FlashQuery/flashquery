# Phase 121: Foundation: Metadata, Response Helpers, Test Harness - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning
**Source:** User-provided product requirements and test plan

<domain>
## Phase Boundary

Phase 121 establishes the shared foundation for the v3.3 MCP Tool Consolidation. It does not migrate broad tool behavior yet. It creates the central metadata registry, JSON response helper contracts, frontmatter constant guardrails, phase-local traceability format, and scenario/test assertion scaffolding that later phases must reuse.

The implementation must preserve the roadmap split:
- Phase 121 owns foundation APIs, helpers, tests, traceability, and representative smoke wiring.
- Phase 122 owns full `host_mcp_tools` YAML parsing and host/delegated selector rollout.
- Phases 123-128 own per-tool migrations and legacy removals.
</domain>

<decisions>
## Implementation Decisions

### Canonical Source Documents
- Downstream planning, implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- If roadmap details and product docs appear to conflict, treat `.planning/ROADMAP.md` as the phase boundary and the product docs as the detailed contract inside that boundary.

### Metadata Registry
- Introduce one central metadata registry for MCP tool canonical names, categories, tiers, host eligibility, delegated eligibility, status, hard-exclusion reason, legacy replacements, and registered description text.
- Existing hardcoded arrays in `src/llm/tool-registry.ts` and metadata capture in `src/mcp/tool-catalog.ts` must become consumers of the central registry, not parallel sources of truth.
- Phase 121 should expose resolver/expansion primitives that Phase 122 can use for `host_mcp_tools`; it should not complete the full host config rollout unless required to make tests meaningful.

### JSON Response Helpers
- Replace the legacy key-value response helper foundation with JSON response helpers that produce MCP text results whose `content[0].text` parses as JSON.
- Expected errors use structured envelopes and `isError: false`; only unexpected runtime failures set `isError: true`.
- Identification builders are required for documents, memories, records, plugins, and LLM calls.

### Frontmatter Constants
- New and migrated code must use `FM.*` constants for FlashQuery-managed frontmatter fields.
- Add constants needed by consolidation foundation, including at least `FM.ARCHIVED_AT` and any accepted trash recovery field such as `FM.ORIGINAL_PATH` if Phase 121 scaffolds it.
- Add a guard test that fails on new hardcoded `fq_*` field literals outside the constants module and explicit allowlist contexts.

### Testing And Traceability
- Every Phase 121 plan must instantiate a traceability table before coding, mapping touched requirements to unit, integration, E2E, directed scenario, and integration scenario coverage.
- Tests are part of the phase work, not deferred to Phase 128.
- Scenario runner changes should add JSON-path assertion capability without removing existing substring assertions needed by pre-migration tests.

### the agent's Discretion
- Exact file/module names may follow repo conventions if they preserve the central-source-of-truth rule. Suggested names include `src/mcp/tool-metadata.ts`, expanded `src/mcp/utils/response-formats.ts`, and scenario framework helpers under `tests/scenarios/framework/`.
- The agent may split implementation into more granular commits or task groups, but must preserve the phase boundary and traceability coverage.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product Contracts
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md` - Cross-cutting decisions, output/input standards, metadata registry requirement, error semantics, frontmatter checklist.
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md` - Foundation test assignments, traceability contract, current gap audit, scenario and E2E requirements.

### Local Planning
- `.planning/REQUIREMENTS.md` - Phase 121 requirement IDs FND-01..FND-08 and TEST-01..TEST-06.
- `.planning/ROADMAP.md` - Phase 121 goal, success criteria, and phase boundary with Phase 122.

### Current Code Anchors
- `src/mcp/utils/response-formats.ts` - Legacy key-value response helpers to evolve/replace with JSON helper APIs.
- `src/mcp/tool-catalog.ts` - Current registration metadata capture wrapper.
- `src/llm/tool-registry.ts` - Current hardcoded delegated native tiers and hard exclusions.
- `src/mcp/server.ts` - Current MCP tool registration flow.
- `src/config/loader.ts` - Current LLM purpose validation and future config consumer boundary.
- `src/constants/frontmatter-fields.ts` - Existing `FM.*` constants.
- `tests/unit/response-formats.test.ts` - Legacy helper tests to expand or replace with JSON helper tests.
- `tests/unit/mcp-server-tools.test.ts` - Existing metadata/description smoke tests to replace with real registry assertions.
- `tests/unit/llm-tool-registry.test.ts` - Existing hardcoded delegated-tier tests to derive from metadata.
- `tests/e2e/protocol.test.ts` - MCP list/call protocol smoke tests.
- `tests/scenarios/directed/DIRECTED_COVERAGE.md` - Directed coverage ledger.
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - Integration scenario coverage ledger.
- `tests/scenarios/directed/run_suite.py`, `tests/scenarios/integration/run_integration.py`, `tests/scenarios/framework/fqc_client.py` - Scenario assertion plumbing.
</canonical_refs>

<specifics>
## Specific Ideas

- Treat `get_document`'s existing JSON output as the seed pattern, but move reusable response construction into shared helpers rather than copying JSON snippets into every handler.
- Preserve existing MCP SDK result shape: `{ content: [{ type: "text", text: JSON.stringify(payload) }] }`.
- Metadata descriptions must be testable for the four-block XC-8 format: summary, when-to-use signals, when-not-to-use alternative, example invocation.
- Legacy-name suggestions should be represented in metadata now; full startup enforcement can land in Phase 122 if it depends on host config parsing.
</specifics>

<deferred>
## Deferred Ideas

- Full `host_mcp_tools` config parsing and listTools filtering are Phase 122.
- Broad per-tool JSON migrations are Phases 123-127.
- Final removed-tool absence audit is Phase 128.
- Macro-dependent removals are gated on macro parity outside this foundation phase.
</deferred>

---

*Phase: 121-foundation-metadata-response-helpers-test-harness*
*Context gathered: 2026-05-11 from user-provided MCP Tool Consolidation requirements and test plan*
