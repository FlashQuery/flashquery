# Phase 129: Correct Delegated Tier Eligibility Derivation - Research

**Researched:** 2026-05-13 [VERIFIED: gsd init.phase-op]
**Domain:** FlashQuery MCP metadata-derived delegated native tool tier eligibility [VERIFIED: .planning/phases/129-correct-delegated-tier-eligibility-derivation/129-CONTEXT.md]
**Confidence:** HIGH [VERIFIED: codebase grep + product requirements §3.11.1/§3.11.1.1]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### D-01 Source of truth
- Downstream agents MUST read section 3.11.1 and 3.11.1.1 of `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md` before planning or implementing. If any local implementation state conflicts with those sections, the requirements document wins.

### D-02 Remove array-based delegated eligibility
- Remove `CURRENT_DELEGATED_TIER_ORDER` and `CURRENT_DELEGATED_TIER_TOOLS` from `src/mcp/tool-metadata.ts`. No replacement hand-maintained delegated tier allow-list is allowed.

### D-03 Add principled future exclusion field
- Add optional `delegatedExclusionReason?: string` to `ToolMetadata`, parallel to `delegatedHardExcludedReason`. Leave it unpopulated for all existing production tools in this phase.

### D-04 Data category filter
- Add a `DATA_CATEGORIES` constant or equivalent in `src/mcp/tool-metadata.ts` containing exactly `doc-read`, `doc-write`, `memory`, and `plugin`. The categories `llm` and `system` are intentionally excluded from broad delegated tier expansion.

### D-05 Delegated eligibility derivation
- `delegatedEligible` must be computed from metadata instead of array membership. A tool passes common delegated eligibility only when `hostEligible === true`, it has no `delegatedHardExcludedReason`, it has no `delegatedExclusionReason`, its current status is not `removed`, and at least one category is in `DATA_CATEGORIES`.

### D-06 Tier expansion rules
- `getToolNamesByTier("tier:read-only")` must include exactly tools with `tier === "read-only"` that pass common delegated eligibility. `getToolNamesByTier("tier:read-write")` must include the full read-only set plus tools with `tier === "read-write"` that pass common delegated eligibility. `tier === "admin"` tools are in neither broad tier and remain reachable only by explicit per-purpose `tools: [...]` declaration when not otherwise hard-excluded.

### D-07 Expected behavioral diff
- The post-refactor delegated tier composition must equal the pre-refactor composition plus exactly these four corrected tools and no other changes: `list_vault` in `tier:read-only`; `copy_document`, `insert_in_doc`, and `replace_doc_section` in `tier:read-write`.

### D-08 Non-data-category regression guard
- `get_llm_usage` must remain absent from `tier:read-only` and `tier:read-write` even though it is `tier === "read-only"` and `hostEligible === true`, because its only category is `llm`.

### D-09 Coverage obligation
- Plans must instantiate the section 3.11.1.1 coverage contract: unit tests U-tier-1 through U-tier-9 where durable, integration tests I-tier-1 through I-tier-5, an E2E or equivalent MCP round-trip for the corrected delegated surface, directed scenario coverage for at least one corrected delegated edit/list path, integration scenario coverage for a delegated purpose workflow, coverage ledger updates, and documentation updates.

### D-10 Migration callout
- The PR description must explicitly call out that deployments using delegated purpose `tools: ["tier:read-only"]` or `tools: ["tier:read-write"]` can gain the four corrected tools, and that deployments wanting narrower behavior should use per-purpose `excludedTools`.

### the agent's Discretion
- Planner and implementers may choose exact test file names, scenario row IDs, and helper extraction shape, provided they follow existing repo patterns and preserve the source-of-truth behavior above.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- No current production tool should receive `delegatedExclusionReason`; it exists for future principled exclusions only.
- Do not change broad host MCP exposure semantics, `call_model`, or `get_llm_usage` behavior beyond preserving non-data-category exclusion from delegated tiers.
- Do not preserve the old narrower delegated tier behavior as a compatibility default.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POST-01 | §3.11.1 Delegated Tier Eligibility — Hand-Maintained Allow-List Drift | `src/mcp/tool-metadata.ts` currently computes `delegatedEligible` from `CURRENT_DELEGATED_TIER_TOOLS` and `getToolNamesByTier` iterates `CURRENT_DELEGATED_TIER_ORDER`; §3.11.1 requires metadata-derived eligibility and §3.11.1.1 defines U-tier/I-tier coverage. [VERIFIED: src/mcp/tool-metadata.ts + CITED: MCP Tool Consolidation Requirements §3.11.1/§3.11.1.1] |
</phase_requirements>

## Summary

Phase 129 is a codebase-local correction, not a new framework integration: the authoritative product requirements say delegated broad tiers must be derived from canonical tool metadata rather than `CURRENT_DELEGATED_TIER_ORDER` and `CURRENT_DELEGATED_TIER_TOOLS`. [CITED: MCP Tool Consolidation Requirements §3.11.1] The primary implementation file is `src/mcp/tool-metadata.ts`; `src/llm/tool-registry.ts` consumes `getToolNamesByTier` at module load through `TOOL_TIERS`, so preserving that helper contract avoids broad registry rewrites. [VERIFIED: src/mcp/tool-metadata.ts + src/llm/tool-registry.ts]

The required behavior change is intentionally narrow: after implementation, broad delegated tiers gain exactly `list_vault`, `copy_document`, `insert_in_doc`, and `replace_doc_section`, while `get_llm_usage` remains excluded by the non-data-category filter. [CITED: MCP Tool Consolidation Requirements §3.11.1] Host MCP exposure is a separate path in `src/mcp/tool-exposure.ts` and already includes host tier/category behavior such as `tier:read-only` including `get_llm_usage`; this phase must not make host tier semantics follow delegated tier semantics. [VERIFIED: src/mcp/tool-exposure.ts + tests/unit/tool-exposure.test.ts]

**Primary recommendation:** implement a single metadata helper in `src/mcp/tool-metadata.ts` such as `isDelegatedTierEligible(metadata)` and make both `current()` and `getToolNamesByTier()` use it, then update unit, integration, E2E, directed scenario, YAML integration, and docs exactly against §3.11.1.1. [CITED: MCP Tool Consolidation Requirements §3.11.1.1 + VERIFIED: tests/unit/tool-metadata.test.ts]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Delegated tier eligibility derivation | API / Backend | — | Eligibility is computed in the TypeScript MCP metadata module before model-visible registry assembly. [VERIFIED: src/mcp/tool-metadata.ts] |
| Delegated native registry assembly | API / Backend | Frontend Server (SSR): none | `assembleNativeToolRegistry` expands `TOOL_TIERS`, intersects with the host-enabled native catalog, applies `excludedTools`, and removes hard-excluded tools. [VERIFIED: src/llm/tool-registry.ts] |
| Host MCP exposure | API / Backend | — | Host `listTools` filtering is resolved by `resolveHostToolExposure` and registered through `wrapServerWithToolCatalog`; it is intentionally separate from delegated data-category gating. [VERIFIED: src/mcp/tool-exposure.ts + src/mcp/server.ts] |
| Purpose config validation | API / Backend | Database / Storage for persisted config sync | `validateLlmConfig` validates purpose `tools`/`excluded_tools` against `TOOL_TIERS` and `HARD_EXCLUDED_NATIVE_TOOLS`, while config sync persists purpose tool fields separately. [VERIFIED: src/config/loader.ts + src/llm/config-sync.ts] |
| Scenario coverage ledgers | Test / Tooling | — | Directed and YAML integration coverage matrices track public observable behavior and must be updated in the same phase. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md + tests/scenarios/integration/INTEGRATION_COVERAGE.md] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; the repo currently runs under Node v24.7.0 on this machine. [VERIFIED: AGENTS.md + environment probe]
- Keep TypeScript strict ESM; do not introduce CommonJS `require`. [VERIFIED: AGENTS.md + package.json]
- MCP SDK package is `@modelcontextprotocol/sdk`; do not use nonexistent `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md + package.json]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- Use `async/await`; MCP tool handlers return `{ content: [{ type: "text", text: "..." }] }`, and handler failures should return `isError: true` where applicable. [VERIFIED: AGENTS.md]
- Use Zod for external input validation, including config and MCP params. [VERIFIED: AGENTS.md + src/config/loader.ts]
- Unit tests live under `tests/unit/*.test.ts`; integration tests under `tests/integration/*.test.ts`; E2E tests under `tests/e2e/*.test.ts`; scenario suites live under `tests/scenarios/`. [VERIFIED: AGENTS.md + repo file tree]
- Run unit tests with `npm test`, integration with `npm run test:integration`, and E2E with `npm run test:e2e`. [VERIFIED: AGENTS.md + package.json]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]
- Do not implement server-side session state; MCP remains stateless and project context is per call. [VERIFIED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | package `^6.0.2`; npm latest `6.0.3`, modified 2026-04-16 | Strict ESM source and compile-time contracts | Existing repo language and compiler stack. [VERIFIED: package.json + npm registry] |
| Vitest | package `^4.1.1`; npm latest `4.1.6`, modified 2026-05-11 | Unit, integration, and E2E test runner | Existing `npm test`, `npm run test:integration`, and `npm run test:e2e` scripts use Vitest configs. [VERIFIED: package.json + npm registry] |
| Zod | package `^4.3.6`; npm latest `4.4.3`, modified 2026-05-04 | Config schema and native tool input schema translation | Existing config validation and OpenAI tool schema conversion depend on Zod. [VERIFIED: src/config/loader.ts + src/llm/tool-registry.ts + npm registry] |
| @modelcontextprotocol/sdk | package `^1.27.1`; npm latest `1.29.0`, modified 2026-03-30 | MCP server/client protocol types and test transports | Existing MCP server and E2E client use this SDK. [VERIFIED: package.json + tests/e2e/protocol.test.ts + npm registry] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| tsx | package `^4.21.0`; npm latest `4.21.0`, modified 2025-11-30 | Run TypeScript entrypoints in dev and managed test servers | Use existing managed E2E/scenario subprocess paths. [VERIFIED: package.json + tests/e2e/call-model-agent-loop.e2e.test.ts + npm registry] |
| tsup | package `^8.5.1`; npm latest `8.5.1`, modified 2025-11-12 | Production ESM build and declarations | Use `npm run build` as phase gate. [VERIFIED: package.json + npm registry] |
| @supabase/supabase-js | package `^2.100.0`; npm latest `2.105.4`, modified 2026-05-13 | Data/storage integration for broader test suite | Required by integration/E2E fixtures, though this phase's core metadata logic is not DB-dependent. [VERIFIED: package.json + tests/helpers/test-env.ts + npm registry] |
| js-yaml | package `^4.1.1`; npm latest `4.1.1`, modified 2025-11-14 | YAML config parsing | Purpose and host exposure config tests use YAML loader path. [VERIFIED: src/config/loader.ts + npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Metadata-derived helper in `tool-metadata.ts` | New delegated registry config module | A new module would add indirection without changing the source-of-truth requirement; keep eligibility near `ToolMetadata`. [VERIFIED: src/mcp/tool-metadata.ts + CITED: MCP Tool Consolidation Requirements §3.11.1] |
| Existing Vitest + scenario frameworks | New test runner | Existing phase governance requires the current unit/integration/E2E/scenario layers; a new runner would not improve traceability. [VERIFIED: .planning/ROADMAP.md + package.json] |
| Purpose-specific compatibility default | Preserve old narrower tiers | Explicitly out of scope; §3.11.1 says the old behavior was a bug and should not be preserved. [CITED: MCP Tool Consolidation Requirements §3.11.1] |

**Installation:**
```bash
npm install
```
[VERIFIED: package.json]

**Version verification:** recommended package versions above were checked with `npm view <package> version time.modified` on 2026-05-13. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Tool metadata declarations
  src/mcp/tool-metadata.ts
  current(name, categories, tier, description, hardExcludedReason?)
        |
        v
  isDelegatedTierEligible(metadata)
        | checks hostEligible, status, delegatedHardExcludedReason,
        | delegatedExclusionReason, DATA_CATEGORIES
        v
  getToolNamesByTier("tier:read-only" | "tier:read-write")
        |
        v
TOOL_TIERS in src/llm/tool-registry.ts
        |
        v
assembleNativeToolRegistry(config, purposeName, host-enabled catalog)
        | expands tiers, adds explicit tools, applies excludedTools,
        | removes hard-excluded names, reports diagnostics
        v
call_model purpose Mode 2 provider tool definitions
        |
        v
Delegated model can call corrected data tools
```
[VERIFIED: src/mcp/tool-metadata.ts + src/llm/tool-registry.ts]

### Recommended Project Structure

```text
src/
├── mcp/
│   ├── tool-metadata.ts      # Primary Phase 129 derivation change
│   └── tool-exposure.ts      # Host exposure regression boundary, do not retarget to delegated categories
├── llm/
│   └── tool-registry.ts      # Consumer of getToolNamesByTier through TOOL_TIERS
└── config/
    └── loader.ts             # Purpose tools/excluded_tools validation against TOOL_TIERS/HARD_EXCLUDED_NATIVE_TOOLS

tests/
├── unit/
│   ├── tool-metadata.test.ts
│   ├── llm-tool-registry.test.ts
│   └── tool-exposure.test.ts
├── integration/
│   └── tool-registry.test.ts # Recommended new file or nearest existing integration file
├── e2e/
│   └── call-model-agent-loop.e2e.test.ts # Recommended delegated MCP round-trip extension
└── scenarios/
    ├── directed/
    │   ├── DIRECTED_COVERAGE.md
    │   └── testcases/test_call_model_native_tool_registry.py
    └── integration/
        ├── INTEGRATION_COVERAGE.md
        └── tests/*.yml
```
[VERIFIED: repo file tree + tests/unit/tool-metadata.test.ts + tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py]

### Pattern 1: Single Eligibility Helper

**What:** Add `DATA_CATEGORIES` and one helper, then reuse it for `delegatedEligible` and tier expansion. [CITED: MCP Tool Consolidation Requirements §3.11.1]

**When to use:** Use for every broad delegated tier decision in this phase. [VERIFIED: src/mcp/tool-metadata.ts]

**Example:**
```typescript
const DATA_CATEGORIES = new Set<ToolCategory>(['doc-read', 'doc-write', 'memory', 'plugin']);

function isDelegatedTierEligible(metadata: Pick<
  ToolMetadata,
  'hostEligible' | 'status' | 'categories' | 'delegatedHardExcludedReason' | 'delegatedExclusionReason'
>): boolean {
  return metadata.hostEligible
    && metadata.status !== 'removed'
    && metadata.delegatedHardExcludedReason === undefined
    && metadata.delegatedExclusionReason === undefined
    && metadata.categories.some((category) => DATA_CATEGORIES.has(category));
}
```
[CITED: MCP Tool Consolidation Requirements §3.11.1]

### Pattern 2: Preserve Declaration Order

**What:** Iterate `TOOL_METADATA` directly in `getToolNamesByTier` instead of a replacement order array. [CITED: MCP Tool Consolidation Requirements §3.11.1]

**When to use:** Use when returning tier-expanded names so returned order follows metadata declaration order. [VERIFIED: src/mcp/tool-metadata.ts]

**Example:**
```typescript
export function getToolNamesByTier(tier: ToolTierSelector): string[] {
  const includeReadWrite = tier === 'tier:read-write';
  return TOOL_METADATA
    .filter((entry) => isDelegatedTierEligible(entry))
    .filter((entry) => entry.tier === 'read-only' || (includeReadWrite && entry.tier === 'read-write'))
    .map((entry) => entry.name);
}
```
[CITED: MCP Tool Consolidation Requirements §3.11.1]

### Pattern 3: Registry Consumer Contract

**What:** Leave `src/llm/tool-registry.ts` behavior intact unless tests expose a stale constant expectation. [VERIFIED: src/llm/tool-registry.ts]

**When to use:** Update test constants in `tests/unit/llm-tool-registry.test.ts` to include `list_vault`, `copy_document`, `insert_in_doc`, and `replace_doc_section`; do not rewrite `assembleNativeToolRegistry` for the core fix. [VERIFIED: tests/unit/llm-tool-registry.test.ts + CITED: MCP Tool Consolidation Requirements §3.11.1]

### Anti-Patterns to Avoid

- **Replacement allow-list:** Do not replace `CURRENT_DELEGATED_TIER_ORDER` with another hand-maintained delegated tier array. [CITED: MCP Tool Consolidation Requirements §3.11.1]
- **Host/delegated semantic collapse:** Do not change `src/mcp/tool-exposure.ts` so host tiers use `DATA_CATEGORIES`; host `tier:read-only` currently includes `get_llm_usage` and that is separately tested. [VERIFIED: tests/unit/tool-exposure.test.ts]
- **Production `delegatedExclusionReason` population:** Do not set the new field on existing production tools during this phase. [VERIFIED: 129-CONTEXT.md]
- **Config validation drift:** Do not forget that `src/config/loader.ts` builds allowed purpose native tools from `TOOL_TIERS` and `HARD_EXCLUDED_NATIVE_TOOLS`; new tier members become valid delegated purpose tool names through that path. [VERIFIED: src/config/loader.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delegated tier membership | New config file or hidden allow-list | `TOOL_METADATA` + `isDelegatedTierEligible` | The source requirement is to derive from canonical metadata. [CITED: MCP Tool Consolidation Requirements §3.11.1] |
| Test fixture mutation for `delegatedExclusionReason` | Runtime mutation of production metadata in shared state | Pure helper export or synthetic local metadata object test | Shared module state can leak across Vitest tests; pure helper tests are deterministic. [ASSUMED] |
| Purpose config validation | Ad hoc string list in config loader | Existing `TOOL_TIERS` and `HARD_EXCLUDED_NATIVE_TOOLS` imports | `validateLlmConfig` already validates purpose tool names through those values. [VERIFIED: src/config/loader.ts] |
| Public MCP round-trip | Manual JSON-RPC script | Existing E2E helpers or directed `FQCServer`/`FQCClient` framework | Existing tests already start managed MCP servers and scripted mock providers. [VERIFIED: tests/e2e/call-model-agent-loop.e2e.test.ts + tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py] |

**Key insight:** the dangerous complexity is not computing a set; it is keeping host exposure, delegated registry assembly, config validation, docs, and coverage matrices aligned after the four-tool behavior change. [VERIFIED: codebase grep + CITED: MCP Tool Consolidation Requirements §3.11.1.1]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None found; Phase 129 changes TypeScript metadata derivation and does not rename persisted keys, table names, user IDs, or document frontmatter. [VERIFIED: phase scope + rg for delegated/tier references] | None. [VERIFIED: phase scope] |
| Live service config | Existing deployments may have purpose configs using `tools: ["tier:read-only"]` or `tools: ["tier:read-write"]`; after the fix those configs can expose the four corrected tools. [CITED: MCP Tool Consolidation Requirements §3.11.1] | PR migration callout and docs update; no data migration. [CITED: MCP Tool Consolidation Requirements §3.11.1] |
| OS-registered state | None found; FlashQuery runs as CLI/MCP subprocess and this phase does not alter launchd/systemd/pm2 registrations. [VERIFIED: AGENTS.md + phase scope] | None. [VERIFIED: phase scope] |
| Secrets/env vars | None found; this phase does not change env var names or secret keys. [VERIFIED: phase scope + tests/helpers/test-env.ts] | None. [VERIFIED: phase scope] |
| Build artifacts | Existing `dist/index.js` is present and may become stale after source edits. [VERIFIED: environment probe] | Run `npm run build` after implementation. [VERIFIED: package.json] |

## Common Pitfalls

### Pitfall 1: Including `get_llm_usage` In Delegated Broad Tiers
**What goes wrong:** Removing the category filter lets `get_llm_usage` into `tier:read-only`. [CITED: MCP Tool Consolidation Requirements §3.11.1]
**Why it happens:** `get_llm_usage` has `tier === "read-only"`, `hostEligible === true`, and no hard exclusion, so only its `llm` category keeps it out. [VERIFIED: src/mcp/tool-metadata.ts]
**How to avoid:** Add explicit U-tier-7 assertions against both delegated tiers. [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
**Warning signs:** `TOOL_TIERS['tier:read-only']` contains `get_llm_usage`, or `assembleNativeToolRegistry` exposes it from a tier selector. [VERIFIED: src/llm/tool-registry.ts]

### Pitfall 2: Accidentally Changing Host Exposure Behavior
**What goes wrong:** Host `tier:read-only` or `category:doc-read` listTools output changes while fixing delegated tiers. [VERIFIED: tests/unit/tool-exposure.test.ts]
**Why it happens:** Host and delegated selectors share strings but not identical policy; host tiers are based on host-current metadata, while delegated tiers require data-category eligibility. [VERIFIED: src/mcp/tool-exposure.ts + src/mcp/tool-metadata.ts]
**How to avoid:** Keep `resolveHostToolExposure` unchanged and run `npm test -- tests/unit/tool-exposure.test.ts`. [VERIFIED: package.json + tests/unit/tool-exposure.test.ts]
**Warning signs:** `tests/unit/tool-exposure.test.ts` expectation that host read-only contains `get_llm_usage` fails. [VERIFIED: tests/unit/tool-exposure.test.ts]

### Pitfall 3: Stale Test Constants In Registry Tests
**What goes wrong:** `tests/unit/llm-tool-registry.test.ts` continues to assert old `READ_ONLY_TOOLS` and `READ_WRITE_EXTRA_TOOLS`. [VERIFIED: tests/unit/llm-tool-registry.test.ts]
**Why it happens:** `TOOL_TIERS` is materialized at module load from `getToolNamesByTier`, so old constants fail after metadata correction. [VERIFIED: src/llm/tool-registry.ts]
**How to avoid:** Update constants and add direct assertions for the four corrected tools. [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
**Warning signs:** Registry tests fail in `defines the exact tier:read-only native tool allowlist` or `defines tier:read-write as read-only plus write-capable native tools`. [VERIFIED: tests/unit/llm-tool-registry.test.ts]

### Pitfall 4: Config Validation Only Knows Tier Members
**What goes wrong:** Explicit purpose `tools: ["list_vault"]` or `tools: ["insert_in_doc"]` is rejected unexpectedly. [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
**Why it happens:** `validateLlmConfig` constructs `nativeToolNames` from `Object.values(TOOL_TIERS).flat()` plus hard-excluded names. [VERIFIED: src/config/loader.ts]
**How to avoid:** Include config-loader or registry integration tests for explicit corrected tool names and tier selectors. [VERIFIED: src/config/loader.ts]
**Warning signs:** `loadConfig` errors with `unknown native tool` for a corrected final tool. [VERIFIED: src/config/loader.ts]

## Code Examples

### Current Drift Site
```typescript
const CURRENT_DELEGATED_TIER_ORDER = [
  'search_documents',
  'get_document',
  // ...
] as const;

const CURRENT_DELEGATED_TIER_TOOLS = new Set<string>(CURRENT_DELEGATED_TIER_ORDER);
```
[VERIFIED: src/mcp/tool-metadata.ts]

### Current Consumer Path
```typescript
export const TOOL_TIERS = {
  'tier:read-only': getToolNamesByTier('tier:read-only'),
  'tier:read-write': getToolNamesByTier('tier:read-write'),
} as const satisfies Record<string, readonly string[]>;
```
[VERIFIED: src/llm/tool-registry.ts]

### Current Host Boundary To Preserve
```typescript
if (selector === 'tier:read-only' || selector === 'tier:read-write') {
  const includeWrite = selector === 'tier:read-write';
  return listToolMetadata({ hostEligible: true })
    .filter(isCurrentHostSelectable)
    .filter((entry) => entry.tier === 'read-only' || (includeWrite && entry.tier === 'read-write'))
    .map((entry) => entry.name);
}
```
[VERIFIED: src/mcp/tool-exposure.ts]

## State of the Art

| Old Approach | Current Required Approach | When Changed | Impact |
|--------------|---------------------------|--------------|--------|
| Hand-maintained delegated tier allow-list in `CURRENT_DELEGATED_TIER_ORDER` | Metadata-derived eligibility using tier, categories, host eligibility, status, hard exclusion, and optional future exclusion reason | 2026-05-13 finding in §3.11.1 | Prevents drift when final tools are added or consolidated. [CITED: MCP Tool Consolidation Requirements §3.11.1] |
| Docs list old delegated tier membership without corrected tools | Docs must list `list_vault` in read-only and `copy_document`, `insert_in_doc`, `replace_doc_section` in read-write | Phase 129 | Users using broad delegated tiers can see newly available tools. [VERIFIED: docs/LLM Providers Models and Purposes.md + CITED: MCP Tool Consolidation Requirements §3.11.1] |
| Directed coverage row `D-foundation-tools-6` covers only host-disabled intersection | Add metadata/delegated tier rows or equivalent, preferably a new metadata/tool-registry subsection | Phase 129 | Coverage matrix should expose the drift guard rather than bury it in unit files. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md + CITED: MCP Tool Consolidation Requirements §3.11.1.1] |

**Deprecated/outdated:**
- `CURRENT_DELEGATED_TIER_ORDER` and `CURRENT_DELEGATED_TIER_TOOLS` are obsolete for Phase 129 and must be removed. [CITED: MCP Tool Consolidation Requirements §3.11.1]
- The delegated tier table in `docs/LLM Providers Models and Purposes.md` is outdated because it omits the four corrected tools. [VERIFIED: docs/LLM Providers Models and Purposes.md + CITED: MCP Tool Consolidation Requirements §3.11.1]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A pure helper export or synthetic local metadata object is safer than mutating `TOOL_METADATA` in tests. | Don't Hand-Roll | If the repo prefers private helper testing only, planner should instead test through exported public functions. |

## Open Questions

1. **Should the durable U-tier-9 expected-diff test remain after merge?** [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
   - What we know: §3.11.1.1 says U-tier-9 can be run once during refactor and removed after merge. [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
   - What's unclear: The project may prefer keeping an exact final membership assertion as durable regression coverage. [ASSUMED]
   - Recommendation: Keep durable exact expected membership assertions in `tests/unit/tool-metadata.test.ts` and phrase the "pre-refactor diff" as a comment or one-time implementation aid. [VERIFIED: tests/unit/tool-metadata.test.ts]

2. **Which scenario row prefix should be used for metadata/tool-registry coverage?** [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
   - What we know: The product requirements prefer a new `M-` metadata/tool-registry section, but the current directed matrix already uses `M-` for memory lifecycle rows. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md + CITED: MCP Tool Consolidation Requirements §3.11.1.1]
   - What's unclear: Reusing `M-` would collide with memory IDs. [VERIFIED: tests/scenarios/directed/DIRECTED_COVERAGE.md]
   - Recommendation: Use a non-colliding section such as `D-delegated-tier-*` or `TIER-*`, and explicitly note it fulfills §3.11.1.1's preferred metadata/tool-registry coverage intent. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, Vitest, MCP subprocess tests | yes | v24.7.0 | Node >=20 required. [VERIFIED: environment probe + AGENTS.md] |
| npm | Scripts and package/version checks | yes | 11.5.1 | None needed. [VERIFIED: environment probe] |
| Python 3 | Directed and YAML scenario runners | yes | 3.12.3 | None needed. [VERIFIED: environment probe] |
| git | Scenario/test cleanup and repo status | yes | Apple Git 2.50.1 | None needed. [VERIFIED: environment probe] |
| `.env.test` | Integration/E2E Supabase-backed tests | yes | present | Existing helpers skip when incomplete. [VERIFIED: environment probe + tests/helpers/test-env.ts] |
| `node_modules` | Local test execution without install | yes | present | Run `npm install` if missing. [VERIFIED: environment probe] |
| `dist/index.js` | Built binary/E2E fallback | yes | present | Run `npm run build` after source edits. [VERIFIED: environment probe + package.json] |
| Docker | `npm run preflight:docker` | no | — | Script skips automatically if Docker is not installed. [VERIFIED: environment probe + .agents/skills/pre-push/SKILL.md] |
| `psql` CLI | Manual DB inspection only | no | — | Tests use Node `pg` helpers instead. [VERIFIED: environment probe + tests/helpers/supabase.ts] |

**Missing dependencies with no fallback:**
- None identified for planning Phase 129. [VERIFIED: environment probe]

**Missing dependencies with fallback:**
- Docker is absent; `npm run preflight:docker` is documented to skip automatically if Docker is not installed. [VERIFIED: environment probe + .agents/skills/pre-push/SKILL.md]
- `psql` is absent; integration/E2E tests use application/test helpers rather than requiring the CLI. [VERIFIED: environment probe + tests/helpers/test-env.ts]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest package `^4.1.1`, npm latest `4.1.6`. [VERIFIED: package.json + npm registry] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: repo file tree] |
| Quick run command | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/tool-exposure.test.ts` [VERIFIED: package.json + repo file tree] |
| Full suite command | `npm run lint && npm test && npm run test:integration && npm run test:e2e && npm run build` [VERIFIED: package.json + .planning/ROADMAP.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| POST-01 | U-tier-1/U-tier-2 exact delegated tier outputs include the four corrected tools and no unintended tools | unit | `npm test -- tests/unit/tool-metadata.test.ts` | yes [VERIFIED: tests/unit/tool-metadata.test.ts] |
| POST-01 | U-tier-3 read-only set is subset of read-write set | unit | `npm test -- tests/unit/tool-metadata.test.ts` | yes [VERIFIED: tests/unit/tool-metadata.test.ts] |
| POST-01 | U-tier-4/U-tier-5/U-tier-6 hard-excluded, admin, and removed tools do not expand from broad tiers | unit | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/llm-tool-registry.test.ts` | yes [VERIFIED: tests/unit/tool-metadata.test.ts + tests/unit/llm-tool-registry.test.ts] |
| POST-01 | U-tier-7 `get_llm_usage` remains excluded by category filter | unit | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/llm-tool-registry.test.ts` | yes [VERIFIED: src/mcp/tool-metadata.ts + tests/unit/tool-exposure.test.ts] |
| POST-01 | U-tier-8 synthetic `delegatedExclusionReason` excludes natural tier and reason is reachable | unit | `npm test -- tests/unit/tool-metadata.test.ts` | yes, needs new assertion [VERIFIED: tests/unit/tool-metadata.test.ts] |
| POST-01 | I-tier-1/I-tier-2 `assembleNativeToolRegistry` exposes corrected tools through `tools: ["tier:read-only"]` and `tools: ["tier:read-write"]` | integration | `npm run test:integration -- tests/integration/tool-registry.test.ts` | no, Wave 0 [CITED: MCP Tool Consolidation Requirements §3.11.1.1] |
| POST-01 | I-tier-3 per-purpose `excludedTools` removes corrected tools after tier expansion | integration | `npm run test:integration -- tests/integration/tool-registry.test.ts` | no, Wave 0 [CITED: MCP Tool Consolidation Requirements §3.11.1.1] |
| POST-01 | I-tier-4 hard-excluded `call_model` remains excluded even when explicit | integration | `npm run test:integration -- tests/integration/tool-registry.test.ts` | no, Wave 0 [CITED: MCP Tool Consolidation Requirements §3.11.1.1] |
| POST-01 | I-tier-5 explicit admin-tier `maintain_vault` remains reachable by explicit declaration if not otherwise filtered by catalog and hard-exclusion policy is handled as specified | integration | `npm run test:integration -- tests/integration/tool-registry.test.ts` | no, Wave 0 [CITED: MCP Tool Consolidation Requirements §3.11.1.1] |
| POST-01 | MCP round-trip proves corrected delegated surface | e2e | `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts` or new focused E2E file | yes for candidate file [VERIFIED: tests/e2e/call-model-agent-loop.e2e.test.ts] |
| POST-01 | Directed scenario exercises a corrected delegated edit/list path | directed scenario | `python3 tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py --managed` or new focused scenario | yes for candidate file [VERIFIED: tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py] |
| POST-01 | YAML integration workflow proves delegated purpose workflow | integration scenario | `python3 tests/scenarios/integration/run_integration.py --managed <new-test-name>` | runner exists; test file likely Wave 0 [VERIFIED: tests/scenarios/integration/run_integration.py + tests/scenarios/integration/tests] |

### Sampling Rate

- **Per task commit:** `npm test -- tests/unit/tool-metadata.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/tool-exposure.test.ts` [VERIFIED: package.json]
- **Per wave merge:** add `npm run test:integration -- tests/integration/tool-registry.test.ts` and the focused E2E/scenario commands once authored. [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
- **Phase gate:** `npm run lint && npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/testcases/<phase129_test>.py --managed && python3 tests/scenarios/integration/run_integration.py --managed <phase129-test> && npm run build`. [VERIFIED: package.json + scenario runner files]

### Wave 0 Gaps

- [ ] `tests/integration/tool-registry.test.ts` or equivalent integration file — covers I-tier-1 through I-tier-5. [CITED: MCP Tool Consolidation Requirements §3.11.1.1]
- [ ] E2E delegated tier round-trip — extend `tests/e2e/call-model-agent-loop.e2e.test.ts` or create a focused file that configures `tools: ["tier:read-write"]` and proves corrected provider tools are exposed. [VERIFIED: tests/e2e/call-model-agent-loop.e2e.test.ts]
- [ ] Directed scenario row and testcase for corrected delegated edit/list path — likely extend `test_call_model_native_tool_registry.py` or add a focused `test_delegated_tier_eligibility.py`. [VERIFIED: tests/scenarios/directed/testcases/test_call_model_native_tool_registry.py]
- [ ] YAML integration row and test for a delegated purpose workflow using corrected tools. [VERIFIED: tests/scenarios/integration/INTEGRATION_COVERAGE.md]
- [ ] Documentation update in `docs/LLM Providers Models and Purposes.md`; possibly also `docs/ARCHITECTURE.md`, `docs/FlashQuery MCP Tool Guide.md`, and `flashquery.example.yml` if examples or tier prose mention delegated native tiers. [VERIFIED: rg docs]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Phase does not alter auth flows. [VERIFIED: phase scope] |
| V3 Session Management | no | MCP remains stateless and this phase does not add session state. [VERIFIED: AGENTS.md + phase scope] |
| V4 Access Control | yes | Delegated model tool authorization is controlled by metadata-derived tiers, host-enabled catalog intersection, explicit exclusions, and hard exclusions. [VERIFIED: src/mcp/tool-metadata.ts + src/llm/tool-registry.ts] |
| V5 Input Validation | yes | Config validation continues through Zod and `validateLlmConfig`; corrected tool names must be accepted or rejected through existing validation paths. [VERIFIED: src/config/loader.ts] |
| V6 Cryptography | no | Phase does not introduce cryptographic operations. [VERIFIED: phase scope] |

### Known Threat Patterns for FlashQuery Delegated Tools

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Over-broad delegated model tool access | Elevation of privilege | Data-category gating, hard exclusions, explicit `excludedTools`, and exact tier tests. [CITED: MCP Tool Consolidation Requirements §3.11.1] |
| Recursive model calls through delegated tools | Elevation of privilege / Denial of service | `call_model` remains hard-excluded through `delegatedHardExcludedReason` and `HARD_EXCLUDED_NATIVE_TOOLS`. [VERIFIED: src/mcp/tool-metadata.ts + src/llm/tool-registry.ts] |
| Host-disabled tool regained by delegated tier | Elevation of privilege | `assembleNativeToolRegistry` intersects tier expansion with the host-enabled native catalog. [VERIFIED: src/llm/tool-registry.ts + tests/unit/llm-tool-registry.test.ts] |
| Unintended non-data tool expansion | Information disclosure | `DATA_CATEGORIES` excludes `llm` and `system`; `get_llm_usage` is the explicit regression guard. [CITED: MCP Tool Consolidation Requirements §3.11.1] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/129-correct-delegated-tier-eligibility-derivation/129-CONTEXT.md` - locked decisions, canonical refs, deferred ideas. [VERIFIED: file read]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md` §3.11.1 and §3.11.1.1 - authoritative behavior and coverage contract. [CITED: product requirements]
- `.planning/ROADMAP.md` - Phase 129 goal, success criteria, and per-phase verification contract. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - POST-01 traceability and v3.3 governance. [VERIFIED: file read]
- `AGENTS.md` - project-specific architecture, testing, and forbidden patterns. [VERIFIED: file read]
- `src/mcp/tool-metadata.ts` - current drift implementation and target helpers. [VERIFIED: codebase grep]
- `src/llm/tool-registry.ts` - delegated registry assembly and `TOOL_TIERS` consumer path. [VERIFIED: codebase grep]
- `src/mcp/tool-exposure.ts` - host exposure behavior to preserve. [VERIFIED: codebase grep]
- `src/config/loader.ts` - purpose tool validation and host exposure config resolution. [VERIFIED: codebase grep]
- `tests/unit/tool-metadata.test.ts`, `tests/unit/llm-tool-registry.test.ts`, `tests/unit/tool-exposure.test.ts` - current unit coverage and stale constants. [VERIFIED: codebase grep]
- `tests/scenarios/directed/DIRECTED_COVERAGE.md`, `tests/scenarios/integration/INTEGRATION_COVERAGE.md` - coverage ledger structure and existing rows. [VERIFIED: file read]

### Secondary (MEDIUM confidence)

- npm registry `npm view` output for TypeScript, Vitest, Zod, MCP SDK, Supabase JS, tsx, tsup, and js-yaml latest versions and modified timestamps. [VERIFIED: npm registry]
- Project skills under `.agents/skills/` for directed/integration coverage and run conventions. [VERIFIED: file read]

### Tertiary (LOW confidence)

- Assumption A1 about preferring pure helper tests over shared metadata mutation. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions were verified from `package.json` and npm registry. [VERIFIED: package.json + npm registry]
- Architecture: HIGH - direct code paths were read in `tool-metadata.ts`, `tool-registry.ts`, `tool-exposure.ts`, and `loader.ts`. [VERIFIED: codebase grep]
- Pitfalls: HIGH - pitfalls are derived from explicit §3.11.1 requirements and existing tests that would fail on policy drift. [CITED: MCP Tool Consolidation Requirements §3.11.1 + VERIFIED: tests/unit]

**Research date:** 2026-05-13 [VERIFIED: environment context]
**Valid until:** 2026-05-20 because the implementation is local and current milestone code is moving quickly. [ASSUMED]
