# Phase 128: Legacy Surface Removal + Final Audit - Research

**Researched:** 2026-05-12  
**Domain:** FlashQuery MCP tool-surface removal, delegated registry filtering, scenario/documentation cleanup, and final milestone validation  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Canonical Source Documents
- Downstream planning, implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- If roadmap details and product docs appear to conflict, treat `.planning/ROADMAP.md` as the Phase 128 boundary and the two product docs above as the detailed contract inside that boundary.
- Implementation agents should answer scope questions from those docs first, then from phase artifacts and prior phase summaries, before asking the user.

### Removed And Merged Tool Cleanup
- `append_to_doc`, `create_document`, `update_document`, `update_doc_header`, `search_documents`, `save_memory`, `update_memory`, `search_memory`, `list_memories`, `force_file_scan`, `reconcile_documents`, `create_directory`, `remove_directory`, `create_record`, `update_record`, and any prior renamed `search_all` references must be absent from final active MCP/delegated surfaces unless they appear only in historical docs, migration suggestion maps, or explicitly classified test/audit evidence.
- Removed names hard-fail in config/purpose validation with helpful suggestions where the requirements/test plan require suggestions. They must not be silently rewritten or kept as compatibility aliases.
- Scenario files and coverage ledgers must not keep parallel legacy scenarios for removed or merged tools. Rows must be ported to final surfaces, struck through/deleted when behavior is intentionally removed, or documented as transitional only when the tool still intentionally exists.

### Reference Tool Regression
- `call_model` and `get_llm_usage` are compliant reference tools. Phase 128 must not migrate their output shape inadvertently.
- `call_model` document `{{ref:...}}` resolution must continue to work even when host MCP document categories are hidden, because resolution uses internal document services rather than exposed MCP document tools.
- Delegated tool assembly must continue to start from host-enabled tools and obey host exclusions plus delegated hard exclusions.

### Transitional Legacy Tools
- `get_briefing` remains a macro-dependent legacy tool in `doc-read` until `call_macro` ships with parity. It must return a structured JSON envelope while registered and carry explicit removal-gate documentation.
- `insert_doc_link` remains a macro-dependent legacy tool in `doc-write` until `call_macro` can resolve target documents, append/dedup frontmatter arrays, construct link values, and call `write_document`. It must return structured JSON, source batch results, target pre-resolution failures, per-source errors, and unchanged status for existing links while registered.
- Neither transitional tool should be classified as a final primitive. Metadata/tests/docs should make the legacy/removal-gate status explicit.

### Final Audit And Traceability
- The first implementation task must instantiate or update phase-local traceability for `DOC-10`, `MEM-05`, `SYS-04`, `SYS-05`, `SYS-06`, `TEST-07`, and `TEST-08`.
- Final validation must include exact commands and results for lint, focused/full unit tests, integration tests, E2E MCP tests, directed scenarios, YAML integration scenarios, build, and audits.
- Audit commands must classify every remaining old-name match in `src`, `tests`, docs, skills, config validation, and scenario coverage as one of: allowed migration suggestion, historical planning artifact, transitional legacy tool, or bug to remove.

### the agent's Discretion
- Exact plan slicing may follow existing test and source ownership, but prefer small plans that each close a concrete cleanup/audit surface with verifiable absence and regression evidence.
- Existing phase 121-127 helper patterns should be reused rather than inventing new output, metadata, config, delegated-registry, or scenario-ledger conventions.
- Some final audit gates may be expensive; plans may use focused gates first and reserve full preflight for the final validation plan, provided each earlier plan has targeted verification.

### Deferred Ideas (OUT OF SCOPE)
- Actual removal of `get_briefing` and `insert_doc_link` is deferred until `call_macro` parity exists.
- Macro language implementation, macro parity replacement, restore/trash lifecycle, runtime hot reload, and compatibility aliases remain outside this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOC-10 | `append_to_doc`, `create_document`, `update_document`, `update_doc_header`, and `search_documents` are removed from final host/delegated surfaces with migrated tests and no compatibility aliases. | Active document legacy handlers and tests remain in `src/mcp/tools/documents.ts`, `src/mcp/tools/compound.ts`, and multiple unit/integration/scenario files; Phase 124 already ported behavior to final tools, so Phase 128 should delete or retire active old-name surfaces and assert absence. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/documents.ts`; VERIFIED: `src/mcp/tools/compound.ts`; VERIFIED: `rg` inventory] |
| MEM-05 | `save_memory`, `update_memory`, `search_memory`, and `list_memories` are removed from host/delegated surfaces with migrated coverage. | `write_memory`, `get_memory`, `archive_memory`, and `search` exist, but legacy memory handlers/tests/scenarios still appear; Phase 125 explicitly left broad legacy memory removal to Phase 128. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/memory.ts`; VERIFIED: `.planning/phases/125-unified-search-memory-consolidation/125-02-SUMMARY.md`; VERIFIED: `rg` inventory] |
| SYS-04 | `call_model` and `get_llm_usage` remain compliant reference tools and document reference resolution works when document MCP categories are hidden. | Product docs require internal document-service reference resolution independent of host `doc-read`; existing server catalog and delegated registry are host-filtered, so Phase 128 needs focused regression tests rather than output migration. [CITED: MCP Tool Consolidation Requirements §3.10.2; VERIFIED: `src/mcp/tool-catalog.ts`; VERIFIED: `src/llm/tool-registry.ts`] |
| SYS-05 | Dead project tools `list_projects` and `get_project_info` stay absent from registration and stale source/tests are deleted. | `src/mcp/tools/projects.ts` and `tests/unit/project-tools.test.ts` still exist even though metadata marks both names as `dead` and server registration no longer imports `registerProjectTools`. [VERIFIED: `src/mcp/tools/projects.ts`; VERIFIED: `tests/unit/project-tools.test.ts`; VERIFIED: `src/mcp/server.ts`; VERIFIED: `src/mcp/tool-metadata.ts`] |
| SYS-06 | `get_briefing` and `insert_doc_link` remain only as macro-dependent transitional legacy tools with structured output and explicit removal gates. | Metadata marks both as `transitional`, but active tests and docs still contain prose/key-value assumptions and need structured JSON/removal-gate assertions. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `src/mcp/tools/compound.ts`; VERIFIED: `tests/unit/compound-tools.test.ts`; VERIFIED: `docs/FlashQuery MCP Tool Guide.md`] |
| TEST-07 | Removed and merged tools have explicit migration decisions: port, rewrite, absence assertion, or dependency-gated skip. | Product Test Plan §6 provides the decision table; repo grep shows active tests/scenarios/docs still need classification. [CITED: MCP Tool Consolidation Test Plan §6; VERIFIED: `rg` inventory] |
| TEST-08 | Milestone closes only after ledgers, unit/integration/E2E suites, lint, build, and final coverage audit agree no v3.3 requirement is unverified. | `.planning/config.json` has `workflow.nyquist_validation: true`, and Phase 127 established final validation artifact patterns with exact commands and audit classifications. [VERIFIED: `.planning/config.json`; VERIFIED: `.planning/phases/127-removal-directory-and-vault-maintenance/127-VALIDATION.md`] |
</phase_requirements>

## Summary

Phase 128 should be planned as a closure/audit phase, not as new behavior development. The product contract and roadmap say behavior-specific tests should already have shipped in Phases 121-127; Phase 128 should remove active legacy surfaces, port or retire stale references, preserve only the two macro-dependent transitional tools, and prove the final host/delegated surface with absence/regression tests. [VERIFIED: `.planning/ROADMAP.md`; CITED: MCP Tool Consolidation Test Plan §1, §6, §9.7]

The riskiest implementation areas are central metadata status, wrapper-based host registration, delegated native tool assembly, and stale scenario/docs/skills references. The MCP server wrapper skips registration for host-disabled names, and delegated assembly consumes the native catalog plus metadata-derived tiers/hard exclusions, so deleting legacy handlers must be paired with catalog, metadata, config-validation, and `listTools`/delegated assertions. [VERIFIED: `src/mcp/tool-catalog.ts`; VERIFIED: `src/mcp/tool-exposure.ts`; VERIFIED: `src/llm/tool-registry.ts`; CITED: Context7 `/modelcontextprotocol/typescript-sdk` registerTool/listTools docs]

**Primary recommendation:** Plan Phase 128 in five executable slices: traceability/audit harness, active source+metadata removal, test/scenario/doc/skill migration, transitional/reference regression hardening, and final full validation. [VERIFIED: Phase 121-127 plan/validation patterns; VERIFIED: `.planning/phases/127-removal-directory-and-vault-maintenance/127-VALIDATION.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Active MCP tool removal | API / Backend | Browser / Client: none | MCP tools are registered server-side through `server.registerTool`; removing a host tool means not registering it and not exposing it in the native catalog. [VERIFIED: `src/mcp/server.ts`; VERIFIED: `src/mcp/tool-catalog.ts`] |
| Delegated tool-belt absence | API / Backend | LLM provider adapter | Delegated tool assembly happens in `src/llm/tool-registry.ts` from the server native catalog, purpose config, metadata tiers, exclusions, and hard exclusions. [VERIFIED: `src/llm/tool-registry.ts`] |
| Legacy-name config validation | API / Backend | Config loader | Purpose/tool selector validation uses metadata replacement suggestions and loader validation; removed names should fail config instead of aliasing. [VERIFIED: `src/config/loader.ts`; VERIFIED: `src/mcp/tool-metadata.ts`] |
| Scenario ledgers | Test Harness | Docs | Directed and YAML coverage matrices are active planning/test artifacts and must reflect current public tool behavior. [VERIFIED: `tests/scenarios/directed/DIRECTED_COVERAGE.md`; VERIFIED: `tests/scenarios/integration/INTEGRATION_COVERAGE.md`; CITED: MCP Tool Consolidation Test Plan §7] |
| Product docs and skills cleanup | Docs | Test Harness | User-facing docs and local FlashQuery skills contain old tool names and will otherwise instruct agents to call removed tools. [VERIFIED: `docs/FlashQuery MCP Tool Guide.md`; VERIFIED: `.agents/skills/*/SKILL.md`; VERIFIED: `.claude/skills/*/SKILL.md`] |
| `call_model` reference regression | API / Backend | Storage / Vault | Reference resolution is internal service work and must continue even when document MCP tools are hidden. [CITED: MCP Tool Consolidation Requirements §3.10.2; VERIFIED: `src/llm/reference-resolver.ts`; VERIFIED: `src/mcp/tools/llm.ts`] |

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS; current local Node is v24.7.0. [VERIFIED: `AGENTS.md`; VERIFIED: `node --version`]
- Keep TypeScript strict ESM; do not introduce CommonJS `require`. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`]
- Use `@modelcontextprotocol/sdk`; do not use `@modelcontextprotocol/server`. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`]
- Use `async/await`; MCP handlers catch failures and return MCP `isError: true` only for runtime failures at handler boundaries. [VERIFIED: `AGENTS.md`; CITED: Context7 `/modelcontextprotocol/typescript-sdk` CallToolResult docs]
- Use Zod for external input validation. [VERIFIED: `AGENTS.md`; VERIFIED: current tool registration schemas]
- FlashQuery is CLI + MCP only; do not build a web UI or server-side sessions. [VERIFIED: `AGENTS.md`]
- Unit tests live under `tests/unit`, integration tests under `tests/integration`, E2E under `tests/e2e`, and scenario suites under `tests/scenarios`. [VERIFIED: `AGENTS.md`; VERIFIED: repo file listing]
- `.env.test` is present locally, so integration/E2E/scenario plans can assume credentials exist but still rely on existing skip guards. [VERIFIED: `.env.test` probe; VERIFIED: `tests/helpers/test-env.ts` convention from AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | v24.7.0 local; package requires `>=20` | Runtime for CLI/MCP server | Project requires Node >=20 and current local runtime satisfies it. [VERIFIED: `package.json`; VERIFIED: `node --version`] |
| TypeScript | npm current 6.0.3; project range `^6.0.2` | Strict TypeScript source | Project is TypeScript/ESM and current npm registry version was checked. [VERIFIED: npm registry; VERIFIED: `package.json`] |
| `@modelcontextprotocol/sdk` | npm current 1.29.0; project range `^1.27.1` | MCP server/client types, transports, `registerTool` | Existing server imports `McpServer`, stdio, and Streamable HTTP from this SDK; Context7 confirms `registerTool` tool-result shape. [VERIFIED: npm registry; VERIFIED: `src/mcp/server.ts`; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Zod | npm current 4.4.3; project range `^4.3.6` | Tool/config/schema validation | Existing MCP handlers use Zod input schemas and the SDK docs show Zod registration patterns. [VERIFIED: npm registry; VERIFIED: `package.json`; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| Vitest | npm current 4.1.6; project range `^4.1.1` | Unit/integration/E2E test runner | Project scripts use Vitest configs, and Context7 confirms file-filtered `vitest run` usage for focused gates. [VERIFIED: npm registry; VERIFIED: `package.json`; CITED: Context7 `/vitest-dev/vitest`] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `tsx` | project range `^4.21.0` | Dev execution of TS entrypoint | Use through `npm run dev`/managed scenario servers, not as a new direct dependency. [VERIFIED: `package.json`; VERIFIED: `AGENTS.md`] |
| `tsup` | project range `^8.5.1` | Production ESM/DTS build | Final validation must run `npm run build`. [VERIFIED: `package.json`; VERIFIED: Phase 127 validation pattern] |
| Python 3 | local 3.12.3 | Directed and YAML scenario runners | Use `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup ...` and `python3 tests/scenarios/integration/run_integration.py --managed ...`. [VERIFIED: `python3 --version`; VERIFIED: project skills; VERIFIED: Phase 127 validation] |
| ripgrep | local 15.1.0 | Legacy reference audit | Use for source/test/docs/skills audit commands; exclude historical `.planning` except Phase 128 evidence. [VERIFIED: `rg --version`; VERIFIED: Phase 127 audit pattern] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deleting handlers and metadata in one large edit | Separate by source ownership | Smaller slices reduce risk because legacy names appear across `documents`, `memory`, `records`, `files`, `compound`, docs, skills, and scenario ledgers. [VERIFIED: `rg` inventory] |
| Keeping deprecated compatibility aliases | Hard-fail with suggestions | Product contract forbids aliases and requires helpful validation failures. [VERIFIED: `128-CONTEXT.md`; CITED: MCP Tool Consolidation Requirements XC-6/§3.10.1.1] |
| Removing `get_briefing`/`insert_doc_link` now | Preserve as transitional | Product contract defers removal until `call_macro` parity exists. [VERIFIED: `128-CONTEXT.md`; CITED: MCP Tool Consolidation Requirements XC-17] |

**Installation:** No new package install should be planned for Phase 128. [VERIFIED: repo stack and phase scope]

**Version verification:** `npm view typescript version time.modified`, `npm view vitest version time.modified`, `npm view @modelcontextprotocol/sdk version time.modified`, and `npm view zod version time.modified` were run on 2026-05-12. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
flashquery.yml / LLM purpose config
  -> config loader validation
  -> central tool metadata + replacement suggestions
  -> host exposure resolution
  -> MCP server registerTool wrapper
      -> host listTools / tool calls
      -> native tool catalog
          -> delegated tool assembly in call_model
              -> provider-visible tool belt

Phase 128 cleanup path:
legacy-name inventory
  -> classify each match: remove | port | suggestion | transitional | historical
  -> delete/port active source/tests/docs/scenarios/skills
  -> assert host absence + delegated absence + config hard-fail suggestions
  -> preserve transitional get_briefing/insert_doc_link JSON + removal gates
  -> run final v3.3 validation and write evidence
```

### Recommended Project Structure

```text
.planning/phases/128-legacy-surface-removal-final-audit/
├── TRACEABILITY.md      # first implementation task; maps DOC-10/MEM-05/SYS-04/SYS-05/SYS-06/TEST-07/TEST-08
├── 128-VALIDATION.md    # final exact commands, results, and classified grep audit
└── 128-*-PLAN.md        # small ownership-based implementation plans

src/
├── mcp/tool-metadata.ts # final/dead/transitional status, replacement suggestions, tiers
├── mcp/tool-exposure.ts # host selectable filter and selector warnings
├── mcp/tools/*.ts       # delete active removed handlers or keep only final/transitional handlers
└── llm/tool-registry.ts # delegated assembly regression target

tests/
├── unit/                # absence/config/metadata/transitional output tests
├── integration/         # registration/delegated/reference regression tests
├── e2e/protocol.test.ts # listTools absence/presence and final protocol assertions
└── scenarios/           # directed + YAML ledgers and current scenario files
```

### Pattern 1: Metadata-First Removal

**What:** Mark removed names as unavailable for active surfaces, keep replacement suggestions only in metadata/config validation, then delete handler registrations and old tests that still exercise removed names. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `src/mcp/tool-exposure.ts`; CITED: MCP Tool Consolidation Test Plan §6]

**When to use:** Use for document, memory, record, directory, scan, and dead project names that should not remain as callable MCP tools. [VERIFIED: `128-CONTEXT.md`]

**Example:**

```typescript
// Source: src/mcp/tool-metadata.ts
function legacyReplacement(name: string): string | undefined {
  const replacements: Record<string, string> = {
    search_documents: 'search',
    create_document: 'write_document',
    save_memory: 'write_memory',
    force_file_scan: 'maintain_vault',
  };
  return replacements[name];
}
```

### Pattern 2: Host Registration Is the Catalog Boundary

**What:** `wrapServerWithToolCatalog` skips `registerTool` entirely when a name is not host-enabled; the native delegated catalog is recorded from registered tools only. [VERIFIED: `src/mcp/tool-catalog.ts`]

**When to use:** Absence tests should check both MCP `listTools` and delegated native assembly because both depend on the registration/catalog boundary. [VERIFIED: `src/mcp/tool-catalog.ts`; VERIFIED: `src/llm/tool-registry.ts`]

**Example:**

```typescript
// Source: src/mcp/tool-catalog.ts
if (options.hostEnabledToolNames && !options.hostEnabledToolNames.has(name)) {
  return undefined;
}
```

### Pattern 3: Scenario-Ledger-First Migration

**What:** Update `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` before scenario files, then port, strike through, delete, or classify each legacy row. [CITED: MCP Tool Consolidation Test Plan §7; VERIFIED: project skills for directed/integration covgen]

**When to use:** Use for stale rows such as `search_documents`, `search_all`, `list_memories`, directory, scan/reconcile, and old document write rows still present in ledgers. [VERIFIED: `rg` inventory of scenario ledgers]

### Pattern 4: Transitional Legacy Gate

**What:** `get_briefing` and `insert_doc_link` stay registered with `status: transitional`, have no legacy replacement suggestion failure, return structured JSON, and document `call_macro` parity as the removal gate. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `128-CONTEXT.md`]

**When to use:** Use only for those two tools; do not generalize transitional status to other removed names. [VERIFIED: `128-CONTEXT.md`]

### Anti-Patterns to Avoid

- **Removing old tests without port/absence evidence:** TEST-07 requires every legacy reference to be ported, rewritten, absence-asserted, or dependency-gated. [VERIFIED: `.planning/REQUIREMENTS.md`; CITED: MCP Tool Consolidation Test Plan §6]
- **Leaving old names in skills/docs as active instructions:** `.agents/skills` and `.claude/skills` currently instruct agents to call removed tools, which would reintroduce bad workflows after surface removal. [VERIFIED: `rg` inventory]
- **Treating historical `.planning` artifacts as bugs:** Prior phase docs are historical; Phase 128 validation should exclude old `.planning` except its own validation artifact and explicitly classify remaining matches. [VERIFIED: `128-CONTEXT.md`; VERIFIED: Phase 127 audit pattern]
- **Migrating `call_model` output shape:** SYS-04 says it is a reference tool; only regression tests should be added/kept. [VERIFIED: `.planning/REQUIREMENTS.md`; CITED: MCP Tool Consolidation Requirements §3.5]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP registration/catalog filtering | Parallel hidden tool registry | Existing `wrapServerWithToolCatalog`, `resolveHostToolExposure`, and metadata registry | Existing path is already the host/delegated boundary. [VERIFIED: `src/mcp/tool-catalog.ts`; VERIFIED: `src/mcp/tool-exposure.ts`] |
| JSON tool result formatting | Per-handler ad hoc stringification | Existing `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, identification builders | Phase 121 established shared response helpers. [VERIFIED: `src/mcp/utils/response-formats.ts`; VERIFIED: `.planning/phases/121-foundation-metadata-response-helpers-test-harness/121-02-SUMMARY.md`] |
| Scenario assertions | New runner syntax | Existing directed Python framework and YAML integration runner | Project skills and docs define current scenario patterns. [VERIFIED: `.agents/skills/flashquery-directed-run/SKILL.md`; VERIFIED: `.agents/skills/flashquery-integration-run/SKILL.md`] |
| Legacy reference classification | Manual one-off notes | Repeatable `rg` audits plus classification tables in validation artifact | Phase 127 used this pattern successfully. [VERIFIED: `.planning/phases/127-removal-directory-and-vault-maintenance/127-VALIDATION.md`] |

**Key insight:** The hard part is not deleting strings; it is preserving traceability that every deleted string was either migrated to a final surface or intentionally retained only as suggestion, historical, or transitional evidence. [VERIFIED: MCP Tool Consolidation Test Plan §6/§9.7; VERIFIED: `rg` inventory]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | No runtime datastore should store MCP tool names as required persistent keys for this phase; project data tables are already removed from schema, and old `projects` config is rejected. [VERIFIED: `src/storage/supabase.ts`; VERIFIED: `src/config/loader.ts`] | None for data migration; keep code deletion separate from config validation. [VERIFIED: phase scope] |
| Live service config | `flashquery.yml`, `tests/fixtures/*.yaml`, and LLM purpose configs may reference tool names through `host_mcp_tools` or purpose `tools`. [VERIFIED: `src/config/loader.ts`; VERIFIED: `tests/fixtures/flashquery.e2e.host-filtered.yaml`] | Add/keep startup validation failures for removed names and update fixtures that intentionally test final surfaces. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `tests/unit/llm-config.test.ts`] |
| OS-registered state | None found; FlashQuery runs as CLI/MCP subprocess in this repo and no launchd/systemd/pm2 state was part of the phase scope. [VERIFIED: `AGENTS.md`; VERIFIED: no project service files in repo listing] | None. [VERIFIED: scope audit] |
| Secrets/env vars | `.env.test` exists but tool names are not secret/env-var names. [VERIFIED: `.env.test` probe; VERIFIED: AGENTS.md test setup] | None. [VERIFIED: scope audit] |
| Build artifacts | `dist/` may contain stale built JS after source deletion if not rebuilt. [VERIFIED: `package.json` build script; VERIFIED: Phase 127 build gate] | Run `npm run build` in final validation; do not edit `dist/` by hand. [VERIFIED: AGENTS.md; VERIFIED: Phase 127 validation] |

## Common Pitfalls

### Pitfall 1: Metadata Says Removed But Handler Still Registers

**What goes wrong:** `TOOL_METADATA` can mark a name `removed`, but active `server.registerTool("old_name")` code still exists and may be registered if filtering rules change. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: active handlers in `src/mcp/tools/documents.ts`, `memory.ts`, `records.ts`, `files.ts`, `compound.ts`]

**How to avoid:** Delete handler registrations for removed names and add unit/E2E assertions that registered names do not contain them. [CITED: MCP Tool Consolidation Test Plan §6]

**Warning signs:** `rg` finds `server.registerTool('create_document'` or handler tests calling `getHandler('save_memory')`. [VERIFIED: `rg` inventory]

### Pitfall 2: Delegated Tool Tiers Retain Old Names

**What goes wrong:** `CURRENT_DELEGATED_TIER_ORDER` still lists old tool names, so tier diagnostics/config tests can preserve obsolete expectations even if metadata filters them out. [VERIFIED: `src/mcp/tool-metadata.ts`]

**How to avoid:** Plan a delegated-tier cleanup with tests in `tests/unit/llm-tool-registry.test.ts`, `tests/e2e/call-model-agent-loop.e2e.test.ts`, and config sync tests. [VERIFIED: `rg` inventory]

### Pitfall 3: Scenario Ledgers Claim Legacy Behavior As Current

**What goes wrong:** `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` still contain old behavior names and historical remediation notes; active scenario rows can make removed tools look required. [VERIFIED: `rg` inventory of scenario ledgers]

**How to avoid:** Update ledgers first, then scenario files, and classify historical remediation notes separately from active rows. [CITED: MCP Tool Consolidation Test Plan §7]

### Pitfall 4: Docs And Skills Teach Removed Calls

**What goes wrong:** `docs/FlashQuery MCP Tool Guide.md`, `docs/LLM Providers Models and Purposes.md`, `.agents/skills`, and `.claude/skills` still name removed tools as active instructions. [VERIFIED: `rg` inventory]

**How to avoid:** Include docs/skills in the audit scope, not just `src` and `tests`. [VERIFIED: `128-CONTEXT.md`]

### Pitfall 5: Transitional Tools Get Deleted Or Promoted Accidentally

**What goes wrong:** Broad legacy removal could delete `get_briefing`/`insert_doc_link`, or metadata/docs could present them as final primitives. [VERIFIED: `128-CONTEXT.md`; VERIFIED: `src/mcp/tool-metadata.ts`]

**How to avoid:** Keep them `transitional`, prove structured JSON, and document explicit `call_macro` removal gates. [VERIFIED: `128-CONTEXT.md`; CITED: MCP Tool Consolidation Requirements XC-17]

## Code Examples

### Host-Enabled Registration Guard

```typescript
// Source: src/mcp/tool-catalog.ts
server.registerTool = ((name: string, config: ToolRegistrationConfig, cb: unknown) => {
  if (options.hostEnabledToolNames && !options.hostEnabledToolNames.has(name)) {
    return undefined;
  }
  // catalog push + original registerTool happen only after this guard
}) as RegisterToolFunction;
```

### Legacy Suggestion Map

```typescript
// Source: src/mcp/tool-metadata.ts
export function getLegacyToolSuggestion(name: string): { replacement: string; message: string } | undefined {
  const entry = getToolMetadata(name);
  if (entry?.status !== 'removed' || !entry.replacement) return undefined;
  return {
    replacement: entry.replacement,
    message: `Tool '${name}' has been replaced by '${entry.replacement}'. Update configuration or calls to use the canonical tool name; FlashQuery does not alias legacy tool names.`,
  };
}
```

### Focused Final Absence Audit Shape

```bash
rg -n "append_to_doc|create_document|update_document|update_doc_header|search_documents|save_memory|update_memory|search_memory|list_memories|force_file_scan|reconcile_documents|create_directory|remove_directory|create_record|update_record|search_all|list_projects|get_project_info" \
  src tests docs .agents/skills .claude/skills \
  --glob '!**/.claude/worktrees/**' --glob '!**/node_modules/**'
```

This command found active matches in source, tests, docs, skills, and scenario ledgers during research; Phase 128 validation should classify every remaining match. [VERIFIED: `rg` inventory]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate document create/update/header/append/search tools | `write_document`, `insert_in_doc`, `replace_doc_section`, and unified `search` | v3.3 Phases 124-125 | Phase 128 removes active old document tool surface. [VERIFIED: `.planning/ROADMAP.md`; VERIFIED: Phase 124/125 summaries] |
| Separate memory save/update/search/list tools | `write_memory`, `get_memory`, `archive_memory`, and unified `search` | v3.3 Phase 125 | Phase 128 removes legacy memory surface. [VERIFIED: `.planning/ROADMAP.md`; VERIFIED: Phase 125 summaries] |
| Directory/scan/reconcile tools | `manage_directory` and `maintain_vault` | v3.3 Phase 127 | Phase 127 hid local host exposure; Phase 128 owns broad global cleanup. [VERIFIED: `.planning/phases/127-removal-directory-and-vault-maintenance/127-06-SUMMARY.md`] |
| Dead project tools | No active project MCP tools | v1.7 cleanup and v3.3 final audit | Delete stale source/tests/docs while preserving config rejection for `projects`. [VERIFIED: `src/mcp/tools/projects.ts`; VERIFIED: `src/config/loader.ts`] |

**Deprecated/outdated:**
- `src/mcp/tools/projects.ts`: active source for dead project tools; delete or retire in Phase 128. [VERIFIED: `src/mcp/tools/projects.ts`; VERIFIED: `src/mcp/server.ts`]
- `tests/unit/project-tools.test.ts`: tests dead handlers; replace with absence checks. [VERIFIED: `tests/unit/project-tools.test.ts`; CITED: MCP Tool Consolidation Test Plan §6]
- `docs/FlashQuery MCP Tool Guide.md`: still has legacy tool sections and replacement text pointing to `search_documents`. [VERIFIED: `docs/FlashQuery MCP Tool Guide.md`]
- `.agents/skills/fq-devplan/SKILL.md` and related skills: still instruct agents to call removed FlashQuery tool names. [VERIFIED: `rg` inventory]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|

All actionable claims in this research were verified from local files, npm registry, Context7, or the supplied product docs; no `[ASSUMED]` claims are intentionally used. [VERIFIED: research protocol]

## Open Questions

1. **Should duplicate skill copies under `.agents/skills` and `.claude/skills` both be edited in Phase 128?**
   - What we know: both directories contain old tool instructions and both are present in this repo. [VERIFIED: `rg` inventory]
   - What's unclear: whether one directory is generated from the other or both are authoritative. [VERIFIED: no generation rule found in read files]
   - Recommendation: plan to update both or document one as generated/historical before leaving stale active instructions. [VERIFIED: risk from `rg` inventory]

2. **Should old lower-level scanner comments naming `force_file_scan` be rewritten?**
   - What we know: Phase 127 classified scanner comments as transitional implementation context, not active surface. [VERIFIED: `127-VALIDATION.md`]
   - What's unclear: whether Phase 128 wants zero source matches outside suggestion maps, or allows internal comments after classification. [VERIFIED: `128-CONTEXT.md` requires classification]
   - Recommendation: rewrite comments to `maintain_vault(action:"sync")` where low risk, and classify any remaining internal historical wording in `128-VALIDATION.md`. [VERIFIED: `rg` inventory]

3. **Should `src/projects/seeder.ts` be removed with dead project MCP tools?**
   - What we know: project MCP tools are dead, project config is rejected, but `src/projects/seeder.ts` still exists and `backup-command` mocks it. [VERIFIED: `src/projects/seeder.ts`; VERIFIED: `src/config/loader.ts`; VERIFIED: `tests/unit/backup-command.test.ts`]
   - What's unclear: whether the seeder is out-of-scope because SYS-05 names only `list_projects`/`get_project_info`. [VERIFIED: `.planning/REQUIREMENTS.md`]
   - Recommendation: keep Phase 128 focused on MCP tool source/tests unless deleting seeder is needed to remove stale project-tool tests; classify remaining project config/schema comments as historical v1.7 cleanup. [VERIFIED: phase scope]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, Vitest, MCP server | yes | v24.7.0 | None needed; package requires >=20. [VERIFIED: `node --version`; VERIFIED: `package.json`] |
| npm | Scripts and package version checks | yes | 11.5.1 | None. [VERIFIED: `npm --version`] |
| Python 3 | Directed/YAML scenario runners | yes | 3.12.3 | None. [VERIFIED: `python3 --version`] |
| `.env.test` | Integration/E2E Supabase-backed tests | yes | file present | Existing helper skip guards still apply for incomplete values. [VERIFIED: `.env.test` probe; VERIFIED: AGENTS.md] |
| ripgrep | Final audits | yes | 15.1.0 | `grep` if unavailable, but not needed. [VERIFIED: `rg --version`] |

**Missing dependencies with no fallback:** None found. [VERIFIED: environment probe]

**Missing dependencies with fallback:** None found. [VERIFIED: environment probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 current on npm; project uses `^4.1.1`. [VERIFIED: npm registry; VERIFIED: `package.json`] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: repo file listing] |
| Quick run command | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/tool-exposure.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/config.test.ts tests/unit/compound-tools.test.ts` [VERIFIED: existing files] |
| Full suite command | `npm run lint && npm test && npm run test:integration && npm run test:e2e && npm run build` plus directed/YAML scenario commands. [VERIFIED: `package.json`; VERIFIED: roadmap validation contract] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DOC-10 | Removed document tool names absent from metadata-current, registration, host `listTools`, delegated assembly, docs/scenarios except suggestions/history. | unit/e2e/audit | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/document-tools.test.ts tests/unit/compound-tools.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes [VERIFIED: repo file listing] |
| MEM-05 | Removed memory tool names absent from active surfaces and migrated coverage. | unit/integration/e2e/audit | `npm test -- tests/unit/memory-tools.test.ts tests/unit/write-memory.test.ts tests/unit/search.test.ts && npm run test:integration -- tests/integration/write-memory.integration.test.ts tests/integration/search.integration.test.ts` | yes [VERIFIED: repo file listing] |
| SYS-04 | `call_model`/`get_llm_usage` output/reference behavior unchanged, including hidden doc MCP categories. | unit/e2e/integration | `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-usage-tool.test.ts && npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/protocol.test.ts` | yes [VERIFIED: repo file listing] |
| SYS-05 | `list_projects`/`get_project_info` source/tests gone or absence-classified. | unit/e2e/audit | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/mcp-server-tools.test.ts tests/unit/tool-exposure.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts` | yes [VERIFIED: repo file listing] |
| SYS-06 | `get_briefing`/`insert_doc_link` stay transitional, structured JSON, removal gates documented. | unit/integration/scenario | `npm test -- tests/unit/tool-metadata.test.ts tests/unit/compound-tools.test.ts tests/unit/get-briefing.test.ts && npm run test:integration -- tests/integration/compound-tools.integration.test.ts` | yes [VERIFIED: repo file listing] |
| TEST-07 | Every legacy reference has port/rewrite/absence/skip decision. | audit/scenario | `rg` audit plus `python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup <phase128 subset>` | runner exists [VERIFIED: repo file listing] |
| TEST-08 | Full milestone validation green and recorded. | full gate | `npm run lint && npm test && npm run test:integration && npm run test:e2e && python3 tests/scenarios/directed/run_suite.py --managed --strict-cleanup && python3 tests/scenarios/integration/run_integration.py --managed && npm run build` | yes [VERIFIED: `package.json`; VERIFIED: scenario runners] |

### Sampling Rate

- **Per task commit:** Run focused unit tests for touched source plus a targeted `rg` audit on the relevant legacy-name subset. [VERIFIED: Phase 127 validation pattern]
- **Per wave merge:** Run focused integration/E2E or scenario subset for the wave. [VERIFIED: roadmap validation contract]
- **Phase gate:** Run lint, unit, integration, E2E, directed scenarios, YAML integration scenarios, build, and final classified legacy grep. [VERIFIED: `128-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`]

### Wave 0 Gaps

- [ ] `.planning/phases/128-legacy-surface-removal-final-audit/TRACEABILITY.md` - map DOC-10, MEM-05, SYS-04, SYS-05, SYS-06, TEST-07, TEST-08 before source edits. [VERIFIED: `128-CONTEXT.md`]
- [ ] `128-VALIDATION.md` - final validation artifact does not exist yet and should be created by the last plan. [VERIFIED: phase directory listing via init]
- [ ] Focused Phase 128 scenario subset names are not yet defined; planner should either create a new subset or use existing current-surface suites plus audit commands. [VERIFIED: no Phase 128 plans/scenarios yet]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no new auth behavior | Preserve existing MCP auth paths; Phase 128 should not alter auth. [VERIFIED: phase scope; VERIFIED: `src/mcp/auth.ts`] |
| V3 Session Management | no | MCP remains stateless per project instructions. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Host/delegated tool exposure limits available operations; not a security boundary, but it controls model-visible capabilities. [CITED: MCP Tool Consolidation Requirements §3.10.1.1] |
| V5 Input Validation | yes | Removed names must hard-fail config/purpose validation with suggestions and no alias rewrite. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `src/config/loader.ts`] |
| V6 Cryptography | no new crypto | No crypto changes planned. [VERIFIED: phase scope] |

### Known Threat Patterns for FlashQuery MCP Surface Cleanup

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Removed tool still callable through delegated model | Elevation of privilege | Assert delegated tool assembly starts from host-enabled catalog and excludes removed names. [VERIFIED: `src/llm/tool-registry.ts`; VERIFIED: `src/mcp/tool-catalog.ts`] |
| Compatibility alias silently rewrites old name | Tampering / Repudiation | Config validation should fail with explicit suggestion and "does not alias legacy tool names" messaging. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `tests/unit/llm-config.test.ts`] |
| Docs/skills tell agents to call removed tools | Spoofing / Operational misuse | Include docs and skills in final audit scope. [VERIFIED: `rg` inventory] |
| Transitional tool lacks removal gate | Repudiation / Maintenance risk | Metadata/docs/tests should state macro parity removal gate. [VERIFIED: `128-CONTEXT.md`] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/128-legacy-surface-removal-final-audit/128-CONTEXT.md` - Phase boundary, locked decisions, downstream-doc requirement, transitional/deferred scope. [VERIFIED]
- `.planning/ROADMAP.md` - Phase 128 success criteria and v3.3 validation contract. [VERIFIED]
- `.planning/REQUIREMENTS.md` - DOC-10, MEM-05, SYS-04, SYS-05, SYS-06, TEST-07, TEST-08 definitions. [VERIFIED]
- `.planning/STATE.md` - Phase 127 handoff and v3.3 constraints. [VERIFIED]
- `.planning/phases/127-removal-directory-and-vault-maintenance/127-06-SUMMARY.md` and `127-VALIDATION.md` - previous phase final audit pattern and cleanup handoff. [VERIFIED]
- Product requirements doc - tool inventory, cross-cutting decisions, category rules, transitional gates. [CITED: local product doc path supplied by user]
- Product test plan - test migration decisions, scenario rules, file migration list, final audit checklist. [CITED: local product doc path supplied by user]
- `src/mcp/tool-metadata.ts`, `src/mcp/tool-exposure.ts`, `src/mcp/tool-catalog.ts`, `src/llm/tool-registry.ts`, `src/mcp/tools/*.ts` - current implementation surfaces. [VERIFIED]
- Context7 `/modelcontextprotocol/typescript-sdk` - MCP `registerTool`, `listTools`, `callTool`, `CallToolResult.isError` semantics. [CITED]
- Context7 `/vitest-dev/vitest` - focused Vitest file-filter command behavior. [CITED]

### Secondary (MEDIUM confidence)

- npm registry version checks for TypeScript, Vitest, `@modelcontextprotocol/sdk`, and Zod on 2026-05-12. [VERIFIED: npm registry]
- Project skill docs under `.agents/skills` for directed/YAML scenario runner conventions. [VERIFIED]

### Tertiary (LOW confidence)

- None used. [VERIFIED: source list]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - project package, npm registry, and Context7 docs agree on the active stack. [VERIFIED: `package.json`; VERIFIED: npm registry; CITED: Context7]
- Architecture: HIGH - active repo code shows metadata, host exposure, catalog, and delegated assembly boundaries. [VERIFIED: `src/mcp/*`; VERIFIED: `src/llm/tool-registry.ts`]
- Pitfalls: HIGH - pitfalls come from current grep inventory plus Phase 127 handoff and product test-plan migration tables. [VERIFIED: `rg` inventory; VERIFIED: `127-VALIDATION.md`; CITED: MCP Tool Consolidation Test Plan]

**Research date:** 2026-05-12  
**Valid until:** 2026-06-11 for local planning assumptions; re-run npm/doc checks if dependency updates happen before execution. [VERIFIED: current-date context; VERIFIED: npm registry checks]
