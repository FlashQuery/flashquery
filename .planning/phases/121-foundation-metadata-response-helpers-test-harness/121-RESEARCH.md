# Phase 121: Foundation: Metadata, Response Helpers, Test Harness - Research

## RESEARCH COMPLETE

<summary>
Phase 121 should be implemented as a foundation slice, not a hidden broad migration. The repo already has several partial pieces: a tool catalog wrapper, delegated native tool tier arrays, legacy key-value response helpers, scenario runners, and existing coverage ledgers. The plan should convert those into stable contracts that later phases consume.
</summary>

## Current-State Findings

### Metadata And Tool Selection

- `src/mcp/server.ts` registers all tool groups directly, then calls `validateAndCacheNativeToolSchemas(getNativeToolCatalog(server))`.
- `src/mcp/tool-catalog.ts` monkey-patches `server.registerTool` to collect `{ name, description, inputSchema, handler }`, but it does not know categories, tiers, eligibility, legacy names, or hard-exclusion reasons.
- `src/llm/tool-registry.ts` hardcodes `READ_ONLY_TOOL_NAMES`, `READ_WRITE_EXTRA_TOOL_NAMES`, `TOOL_TIERS`, and `HARD_EXCLUDED_NATIVE_TOOLS`. This is the main duplication Phase 121 needs to collapse.
- `src/config/loader.ts` validates LLM purpose `tools` against `TOOL_TIERS` and `HARD_EXCLUDED_NATIVE_TOOLS`, so config validation is already coupled to duplicated arrays.

### Response Helpers

- `src/mcp/utils/response-formats.ts` is explicitly a legacy key-value formatting helper. It validates labels and `---` batch separators, not JSON envelopes.
- Some tools already return JSON-like content, especially `get_document`; other handlers return prose strings and use `isError: true` for expected validation failures.
- Phase 121 should introduce JSON helper APIs alongside or in place of legacy exports carefully, so existing tests can be ported deliberately instead of breaking every tool at once.

### Frontmatter Constants

- `src/constants/frontmatter-fields.ts` currently defines `TITLE`, `STATUS`, `TAGS`, `CREATED`, `UPDATED`, `OWNER`, `TYPE`, `INSTANCE`, and `ID`.
- Product docs call out new consolidation-managed fields such as `fq_archived_at` and possibly trash recovery metadata such as original path.
- Existing code already uses `FM.*` in many scanner/document paths; the missing guard is a test that catches new hardcoded managed `fq_*` usage.

### Scenario Harness

- Directed scenario runner (`tests/scenarios/directed/run_suite.py`) stores raw tool response text in reports.
- YAML integration runner (`tests/scenarios/integration/run_integration.py`) currently documents substring-style assertions such as `expect_contains`, `expect_path`, and count checks.
- Foundation work should add JSON parsing/assertion helpers without removing substring assertions, because pre-migration tools still need to pass until their phase migrates them.

## Recommended Architecture

### Central Tool Metadata

Create `src/mcp/tool-metadata.ts` with:

- `ToolName`, `ToolCategory`, `ToolTier`, and `ToolStatus` types.
- `TOOL_METADATA` as the canonical registry. Each entry should include:
  - `name`
  - `status: "final" | "transitional" | "removed" | "dead"`
  - `categories`
  - `tier`
  - `hostEligible`
  - `delegatedEligible`
  - `delegatedHardExcludedReason?`
  - `legacyNames?`
  - `replacement?`
  - `description`
- Pure resolver functions:
  - `getToolMetadata(name)`
  - `listToolMetadata(filter?)`
  - `expandToolSelectors(selectors, options)`
  - `getLegacyToolSuggestion(name)`
  - `assertRegisteredToolsHaveMetadata(catalog)`

Phase 121 should update delegated native tier assembly to use metadata-derived tiers. Full host config parsing can remain Phase 122, but metadata APIs must be ready for it.

### JSON Response Helpers

Expand or replace `src/mcp/utils/response-formats.ts` with typed helpers such as:

- `jsonToolResult(payload, options?)`
- `jsonExpectedError(errorEnvelope, options?)`
- `jsonRuntimeError(message, details?)`
- `errorEnvelope(code, message, identifier?, details?)`
- `withWarnings(payload, warnings)`
- `batchResult(results)`
- identification builders:
  - `documentIdentification(...)`
  - `memoryIdentification(...)`
  - `recordIdentification(...)`
  - `pluginIdentification(...)`
  - `llmCallIdentification(...)`

Keep the output MCP envelope as text content, but make the text parseable JSON. Expected errors return the error JSON with `isError: false`; runtime exceptions may use `isError: true`.

### Scenario JSON Assertions

Add shared scenario helpers in `tests/scenarios/framework/`:

- parse MCP result `content[0].text` as JSON.
- assert dotted paths and array indexes, e.g. `results[0].error`, `identifier`, `warnings[0].code`.
- preserve existing substring assertions for legacy tools.

Add YAML runner keys such as:

- `expect_json_path`
- `expect_json_equals`
- `expect_json_contains`
- `expect_json_array_length`

The exact names can vary, but Phase 121 tests must prove arrays, errors, warnings, and ordered batch results are assertable.

## Risk And Mitigations

- **Risk:** Over-implementing Phase 122 config in Phase 121.  
  **Mitigation:** Build metadata and selector primitives now; leave full `host_mcp_tools` parsing and default config behavior to Phase 122.

- **Risk:** Rewriting response helpers breaks legacy tools before migration.  
  **Mitigation:** Add JSON helper exports while keeping legacy helpers until their callers are migrated. Tests should distinguish legacy helpers from new JSON helpers.

- **Risk:** Metadata registry drifts from actual registered tools.  
  **Mitigation:** Add a unit test that registers all current tool modules through the catalog and asserts registered names resolve to metadata entries.

- **Risk:** Scenario runner changes only update docs, not executable assertions.  
  **Mitigation:** Add a small runner/unit test fixture that validates JSON path assertions against sample MCP responses.

## Validation Architecture

Phase 121 validation should cover:

- Unit:
  - metadata registry completeness, tier expansion, delegated hard exclusions, description shape, legacy suggestions.
  - JSON response helper success/error/warning/batch/identification builders.
  - frontmatter constants and hardcoded managed-field guard.
  - scenario JSON assertion helpers.
- Integration:
  - representative handler smoke proving a real MCP handler can return parseable JSON through the shared helper.
  - registration/catalog metadata assertion against real registered tools.
- E2E:
  - `tests/e2e/protocol.test.ts` or a focused protocol test parses `content[0].text` JSON from a representative helper-backed tool.
- Directed scenarios:
  - add foundation rows for JSON envelope and metadata behavior.
  - add at least one runnable directed scenario that uses JSON assertions.
- Integration scenarios:
  - add foundation rows for helper + handler + protocol alignment.
  - add at least one YAML workflow using JSON-path assertions.

## Open Questions

None blocking. The product docs and roadmap are sufficient for planning. The main phase-boundary judgment is to keep full `host_mcp_tools` YAML rollout in Phase 122 while making Phase 121 metadata APIs ready for it.
