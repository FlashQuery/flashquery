# Phase 171: Graph Foundation, Structural Graph, and Read Surfaces - Research

**Researched:** 2026-06-23  
**Domain:** TypeScript MCP server, Supabase/Postgres graph tables, markdown chunk graphing, deterministic graph read surfaces  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Source of Truth
- Downstream agents MUST read the product requirements document before making implementation decisions:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md`
- Downstream agents MUST read the product test plan before designing verification:
  `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md`
- If the roadmap, local `.planning/REQUIREMENTS.md`, and product docs differ, use the two product docs above first, then `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` for GSD phase mapping.

### Scope Locks
- Implement requirements mapped to Phase 171: `GR-001`, `GR-002`, `GR-003`, `GR-004`, `GR-005`, `GR-006`, `GR-007`, `GR-008`, `GR-009`, `GR-013A`, `GR-014A`, `GR-016A`, `GR-017`, `GR-018`, `GR-019`, `GR-020A`, and `GR-024A`.
- Treat source Test Plan sections `4.1`, `4.2`, and `4.3` as the required verification surface for this phase.
- Preserve disabled-by-default behavior: when `graph:` is absent or `graph.enabled:false`, existing write, scan, search, and get-document behavior must not drift.
- Use existing chunk identity from `fqc_chunks.id`; do not create a parallel document-section identity system.
- Store deterministic Tier 1 `contains` and `references` edges only in this phase; do not persist semantic-similarity topology.
- Add graph read surfaces in the MCP/CLI-only architecture. Do not build a web UI or server-side session state.

### the agent's Discretion
- Choose the exact internal module boundaries, helper names, and plan slicing that best fit the current codebase.
- Decide whether graph tables are always present or only required under enabled graph mode, as long as disabled behavior is unchanged and schema verification follows the product requirements.
- Decide whether disabled `query_graph` is unregistered or returns a canonical unsupported envelope, but make the behavior deterministic and documented through tests.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Phase 172 owns requirements `GR-010`, `GR-011`, `GR-012`, `GR-013B`, `GR-014B`, `GR-015`, `GR-016B`, `GR-020B`, `GR-021`, `GR-022`, `GR-023`, and `GR-024B`.
- Do not implement stable community identity, edge history/supersession chains, direct contradiction review lifecycle, user graph metadata editing, graph visualization UI, non-markdown graph processing, or scheduled autonomous research loops in this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GR-001 | Disabled or absent `graph:` preserves existing behavior with no graph queueing/writes/LLM calls/shape drift. | Use a null graph provider and disabled-mode contract tests around write, scan, search, get_document, and query_graph. [VERIFIED: .planning/REQUIREMENTS.md] |
| GR-002 | Enabled graph config cross-validates embedding and LLM model/purpose references. | Extend strict Zod config and existing cross-reference validators in `src/config/loader.ts`. [VERIFIED: codebase grep] |
| GR-003 | Relation and prompt sidecars have deterministic defaults or remediation plus strict validation. | Create `src/graph/` loaders using `js-yaml`, resolve paths relative to vault root, and validate before workers/tools run. [VERIFIED: product requirements] |
| GR-004 | Namespaced template variables such as `{{graph:classified_types}}` do not regress `{{ref:...}}`. | Refactor `src/llm/reference-resolver.ts` around provider dispatch while preserving current ref scanner behavior. [VERIFIED: codebase grep] |
| GR-005 | Graph schema DDL exists with instance isolation, chunk FKs, indexes, JSONB support. | Add DDL to `buildSchemaDDL()` and verification to `verifySchema()`. [VERIFIED: codebase grep] |
| GR-006 | Graph node identity is `fqc_chunks.id`. | Use parser/store outputs and FK `fqc_graph_nodes.chunk_id -> fqc_chunks(id)`. [VERIFIED: codebase grep] |
| GR-007 | v1 relation vocabulary includes structural/classified types, directionality/symmetry, no similarity edges. | Relation loader must be shared by writers and query tools. [VERIFIED: product requirements] |
| GR-008 | Edges carry confidence, reasoning, and validated metadata. | Add graph edge validators under `src/graph/` and test with unit cases. [VERIFIED: product requirements] |
| GR-009 | Tier 1 structural edges from hierarchy and markdown links with unresolved diagnostics and code-fence safety. | Reuse parser line/fence behavior; add link resolver with mdast/GFM parsing. [VERIFIED: codebase grep] |
| GR-013A | Changed chunks mark touching edges stale and update Tier 1 without blocking LLM work. | Hook after `diffAndPersistDocumentChunks()` inside the chunk scheduling path; Phase 172 owns Tier 3 stale reconciliation. [VERIFIED: product requirements] |
| GR-014A | `fq_processing: full|embedded|none`, absent means full. | Add frontmatter constant and scanner/write processing gates before chunk/embed/graph scheduling. [VERIFIED: product requirements] |
| GR-016A | Read-surface inactive filtering differs by search/get_document/query/provenance. | Implement read filters in graph query helpers and graph extensions. [VERIFIED: product requirements] |
| GR-017 | Read-only `query_graph` supports primitive and compound graph reads with bounded traversal. | Add `src/mcp/tools/graph.ts`, graph query helpers, cycle protection, and expected-error envelopes. [VERIFIED: product requirements] |
| GR-018 | Unified `search` can opt into graph expansion without existing-call drift. | Extend `src/mcp/tools/compound.ts` schema and result shaping additively. [VERIFIED: codebase grep] |
| GR-019 | `get_document` supports `graph_summary` and graph-primary connections. | Extend `src/mcp/tools/documents/get.ts` and document-output utilities; validate old `limit_per_chunk` only for graph-aware calls. [VERIFIED: codebase grep] |
| GR-020A | Provenance/question metadata is queryable and prioritizes extracted edges. | Schema/read helpers must include node question fields and extracted-before-inferred sort. [VERIFIED: product requirements] |
| GR-024A | Canonical JSON MCP envelopes for graph success, warning, unsupported, and expected errors. | Use `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, and `withWarnings`. [VERIFIED: codebase grep] |
</phase_requirements>

## Summary

Phase 171 should be planned as a foundation-plus-read phase, not an LLM-classification phase. It adds the optional graph substrate, strict graph config/sidecar validation, graph DDL, chunk-keyed nodes, deterministic `contains`/`references` edges, `fq_processing` gates, and graph read surfaces. It must not persist Tier 2 similarity edges or require Tier 3 classification to pass. [VERIFIED: product requirements]

The highest-risk integration point is the current chunk scheduling path: `scheduleChangedDocumentChunks()` calls `diffAndPersistDocumentChunks()` and immediately schedules embeddings. Structural graph updates need the diff result and should run after the chunk transaction has committed, while disabled graph and `fq_processing: embedded|none` must short-circuit before graph mutation. [VERIFIED: codebase grep]

**Primary recommendation:** plan four build slices: config/vocabulary/schema, structural graph write helpers, MCP read helpers/tool registration, then search/get_document integrations plus validation. Keep every slice disabled-mode-safe and test-backed. [VERIFIED: product requirements]

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS; do not rely on older Node behavior. [VERIFIED: AGENTS.md]
- TypeScript is strict mode and ESM; do not introduce CommonJS `require`. [VERIFIED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: AGENTS.md]
- MCP remains stateless; do not implement server-side session state. [VERIFIED: AGENTS.md]
- Use Zod for external input validation. [VERIFIED: AGENTS.md]
- MCP tool handlers should catch errors internally and return text-content responses with `isError: true` on runtime failure. [VERIFIED: AGENTS.md]
- Unit tests live under `tests/unit/*.test.ts`; integration tests under `tests/integration/*.test.ts`; E2E under `tests/e2e/*.test.ts`; scenario tests under `tests/scenarios/`. [VERIFIED: AGENTS.md]
- Integration/E2E tests require `.env.test` and skip gracefully when Supabase credentials are missing. [VERIFIED: AGENTS.md]
- Never use `npm link` for local development. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Graph config and sidecars | API / Backend | Database / Storage | Config loads at startup and controls downstream graph modules before DB writes. [VERIFIED: codebase grep] |
| Graph schema and RPCs | Database / Storage | API / Backend | Tables, indexes, constraints, and traversal functions belong in Postgres DDL generated by `buildSchemaDDL()`. [VERIFIED: codebase grep] |
| Structural graph construction | API / Backend | Database / Storage | The scanner/write paths own parsing and chunk diffs; DB stores resulting rows. [VERIFIED: codebase grep] |
| Graph read surfaces | API / Backend | Database / Storage | MCP tools validate parameters, shape envelopes, and call DB/helper functions. [VERIFIED: codebase grep] |
| Search graph expansion | API / Backend | Database / Storage | Unified search already composes retrievers and result ranking; graph expansion should be additive there. [VERIFIED: codebase grep] |
| Disabled graph behavior | API / Backend | — | Tool registration and write/read short-circuits are process-level behavior, not DB behavior alone. [VERIFIED: product requirements] |

## Standard Stack

### Core

| Library | Project Version | Registry Latest Checked | Purpose | Why Standard |
|---------|-----------------|-------------------------|---------|--------------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | `1.29.0`, modified 2026-06-04 | MCP server/tool registration | Official SDK supports `server.registerTool()` with Zod input schemas and text-content responses. [CITED: Context7 `/modelcontextprotocol/typescript-sdk/v1.29.0`] |
| `@supabase/supabase-js` | `^2.106.2` | `2.108.2`, modified 2026-06-19 | Supabase table/RPC queries | Official docs show `.from().select().eq()` and `.rpc()` as standard patterns. [CITED: Context7 `/supabase/supabase`] |
| `pg` | `^8.21.0` | `8.22.0`, modified 2026-06-19 | Direct Postgres DDL/schema verification | Existing schema code uses direct `pg.Client` for DDL verification and integration tests. [VERIFIED: codebase grep] |
| `zod` | `^4.4.3` | `4.4.3`, modified 2026-05-04 | Config/tool/vocabulary validation | Existing config and MCP schemas are Zod-based. [VERIFIED: package.json + codebase grep] |
| `js-yaml` | `^4.1.1` | `4.2.0`, modified 2026-06-22 | YAML config/sidecar parsing | Existing config loader already uses `js-yaml`; graph sidecars should reuse it. [VERIFIED: package.json + codebase grep] |
| `mdast-util-from-markdown` + `mdast-util-gfm` + `micromark-extension-gfm` | `^2.0.3`, `^3.1.0`, `^3.0.0` | `2.0.3`, `3.1.0`, `3.0.0` | Markdown/GFM parsing | Existing chunk atomic-block parser uses these packages; link extraction should share this parser family instead of regex-only parsing. [VERIFIED: package.json + codebase grep] |
| `uuid` | `^13.0.0` | `14.0.1`, modified 2026-06-20 | Deterministic chunk IDs already use UUID v5 | Graph nodes must preserve existing chunk IDs rather than minting graph IDs. [VERIFIED: codebase grep] |
| `vitest` | `^4.1.1` | `4.1.9`, modified 2026-06-15 | Unit/integration/e2e tests | Repo test configs are Vitest-based. [VERIFIED: package.json + codebase grep] |

### Supporting

| Library | Project Version | Purpose | When to Use |
|---------|-----------------|---------|-------------|
| `gray-matter` | `^4.0.3` | Frontmatter parsing | Read `fq_processing`, document metadata, and sidecar-adjacent vault docs. [VERIFIED: package.json + codebase grep] |
| Existing `jsonToolResult` helpers | local | MCP JSON envelopes | Use for graph success, expected errors, runtime errors, and warnings. [VERIFIED: codebase grep] |
| Existing chunk parser/store | local | Node identity and diff lifecycle | Use as the only graph node identity source. [VERIFIED: codebase grep] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Postgres tables/RPCs | Neo4j, Apache AGE, pg_graphql | Explicitly out of scope; product requirements make Supabase/Postgres tables authoritative. [VERIFIED: product requirements] |
| Existing markdown AST parser family | Regex-only link scanner | Regex is simpler but easier to get wrong for code fences, GFM links, and nested syntax. [ASSUMED] |
| Disabled `query_graph` unsupported envelope | Not registering `query_graph` | Both are allowed; unsupported envelope is more discoverable and easier to scenario-test. [VERIFIED: CONTEXT.md] |

**Installation:** No new packages should be installed for Phase 171; use existing dependencies. [VERIFIED: package.json]

**Version verification commands run:**
```bash
npm view @modelcontextprotocol/sdk version time.modified scripts.postinstall
npm view @supabase/supabase-js version time.modified scripts.postinstall
npm view zod pg js-yaml gray-matter mdast-util-from-markdown mdast-util-gfm micromark-extension-gfm uuid vitest version time.modified scripts.postinstall
```

## Package Legitimacy Audit

> Phase 171 should not install new external packages. This audit records existing stack checks because the planner may be tempted to add a graph library.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@modelcontextprotocol/sdk` | npm | existing project dep | not checked | official Context7 docs | OK | Use existing dependency. [VERIFIED: npm registry + Context7] |
| `@supabase/supabase-js` | npm | existing project dep | not checked | official Context7 docs | OK | Use existing dependency. [VERIFIED: npm registry + Context7] |
| `zod` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `pg` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `js-yaml` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `gray-matter` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `mdast-util-from-markdown` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `mdast-util-gfm` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `micromark-extension-gfm` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `uuid` | npm | existing project dep | not checked | project package.json | OK | Use existing dependency. [VERIFIED: npm registry] |
| `vitest` | npm | existing project dep | not checked | project package.json | SUS | Existing dev dependency; do not add or upgrade in this phase without human confirmation because slopcheck flagged a typosquat-like name. [VERIFIED: slopcheck] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]  
**Packages flagged as suspicious [SUS]:** `vitest` only; it is an existing project dependency, not a new recommendation. [VERIFIED: slopcheck]  
**Note:** `slopcheck install --json` is unsupported in installed slopcheck 0.6.1; running without `--json` attempted `npm install`, and the resulting `package.json`/`package-lock.json` churn was reverted. [VERIFIED: terminal]

## Architecture Patterns

### System Architecture Diagram

```text
flashquery.yml + sidecars
  -> loadConfig() / graph config validation
  -> graph runtime object (enabled | disabled/null provider)
  -> server startup
     -> optional graph schema verification
     -> MCP tool metadata + registration

write_document / copy / scan / chunk lifecycle
  -> parse markdown/frontmatter
  -> fq_processing gate
     -> none: skip chunks, embeddings, graph
     -> embedded: chunks + embeddings, no graph
     -> full: chunks + embeddings + structural graph
  -> diffAndPersistDocumentChunks()
  -> graph stale marking for changed chunks
  -> Tier 1 structural graph builder
     -> contains edges from chunk hierarchy
     -> references edges from resolved markdown links
     -> unresolved diagnostics metadata

query_graph / search / get_document
  -> Zod input validation
  -> graph enabled check
     -> disabled: unsupported/expected-error envelope
     -> enabled: graph query helper
  -> Supabase/Postgres filtered reads
  -> jsonToolResult/jsonExpectedError/jsonRuntimeError
```

### Recommended Project Structure

```text
src/
├── graph/
│   ├── config.ts              # graph config normalization and enabled/disabled runtime shape
│   ├── vocabulary.ts          # relation vocabulary defaults + sidecar validation
│   ├── prompts.ts             # prompt sidecar loading and template variable requirements
│   ├── edge-validation.ts     # confidence/metadata/relation validators
│   ├── structural.ts          # contains/references write planning
│   ├── link-resolver.ts       # markdown/wikilink/anchor resolution to chunk IDs
│   ├── staleness.ts           # changed-chunk stale marking
│   ├── queries.ts             # query_graph/search/get_document read helpers
│   └── response.ts            # graph response envelope builders if shared helpers are insufficient
└── mcp/tools/
    └── graph.ts               # query_graph registration
```

### Pattern 1: Config Extension Through Strict Zod + Post-Parse Cross-Validation

**What:** Add a `GraphSchema` to `ConfigSchema`, camelize it into `FlashQueryConfig`, then run cross-validation against `embeddings`, `llm.models`, and `llm.purposes`. [VERIFIED: codebase grep]

**When to use:** Graph config references names defined in other config sections, so schema validation alone is insufficient. [VERIFIED: product requirements]

**Example:**
```typescript
// Source: src/config/loader.ts patterns around ConfigSchema and validateEmbeddingCatalogConfig.
const GraphSchema = z.object({
  enabled: z.boolean().default(false),
  embedding_name: z.string().optional(),
  classification_purpose: z.string().optional(),
  classification_model: z.string().optional(),
}).strip().prefault({});

function validateGraphConfig(config: RawBrokerConfig): void {
  if (!config.graph?.enabled) return;
  // Cross-check embedding_name against config.embeddings and resolver keys against config.llm.
}
```

### Pattern 2: DB Schema Via Idempotent DDL + Verification

**What:** Add graph tables/indexes/checks to `buildSchemaDDL()` and extend `verifySchema()` required tables/columns. [VERIFIED: codebase grep]

**When to use:** Any graph table/RPC needed before runtime tool calls. [VERIFIED: codebase grep]

**Example:**
```sql
-- Source: src/storage/supabase.ts buildSchemaDDL() style.
CREATE TABLE IF NOT EXISTS fqc_graph_nodes (...);
ALTER TABLE IF EXISTS fqc_graph_nodes ADD COLUMN IF NOT EXISTS ...;
CREATE INDEX IF NOT EXISTS idx_fqc_graph_nodes_instance ON fqc_graph_nodes(instance_id);
```

### Pattern 3: MCP Tool Responses Use Existing JSON Helpers

**What:** Graph tool handlers should return JSON in `content[0].text`; expected errors use `jsonExpectedError`, runtime errors use `jsonRuntimeError`. [VERIFIED: codebase grep]

**When to use:** All graph public surfaces and graph-aware extensions. [VERIFIED: product requirements]

**Example:**
```typescript
// Source: src/mcp/utils/response-formats.ts and MCP SDK docs.
return jsonToolResult({ action: 'schema', relations, feature_flags });
return jsonExpectedError({ error: 'unsupported', message: 'Graph is disabled.' });
```

### Anti-Patterns to Avoid

- **Creating a graph-specific section ID:** use `fqc_chunks.id`; parallel identities break joins and product invariants. [VERIFIED: product requirements]
- **Adding graph writes to disabled mode:** disabled graph must be a no-op for write, scan, search, get_document, and LLM paths. [VERIFIED: product requirements]
- **Persisting semantic similarity as graph topology:** Phase 171 stores only Tier 1 `contains` and `references`. [VERIFIED: product requirements]
- **Putting graph lint/community execution into `query_graph`:** Phase 171 `query_graph` is read-only; Phase 172 owns maintenance/lint execution. [VERIFIED: product requirements]
- **Changing legacy `get_document` connections semantics for non-graph calls:** old `limit_per_chunk` remains valid unless graph-aware options are present. [VERIFIED: product test plan]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP tool registration and responses | Custom protocol wrappers | `@modelcontextprotocol/sdk` + local response helpers | SDK and repo already standardize tool schemas and response envelopes. [CITED: Context7 `/modelcontextprotocol/typescript-sdk/v1.29.0`] |
| YAML parsing | Ad hoc parsers | `js-yaml` | Existing config loader uses it; sidecar parsing should match. [VERIFIED: codebase grep] |
| Markdown/GFM parsing | Regex-only full parser | existing mdast/GFM parser packages | Code fences and GFM links are edge-case heavy. [VERIFIED: package.json + codebase grep] |
| Traversal safety | Unbounded recursive JS loops | Bounded helper/RPC with max-depth and visited-set/cycle protection | Product invariant requires cycle protection. [VERIFIED: product requirements] |
| Error envelopes | One-off JSON shapes | `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `withWarnings` | Existing tools and tests depend on canonical shapes. [VERIFIED: codebase grep] |

**Key insight:** this feature is complex because it touches startup config, schema, write lifecycle, and read surfaces. Keep graph concerns behind small local helpers and make disabled mode explicit at each boundary. [VERIFIED: product requirements]

## Common Pitfalls

### Pitfall 1: Disabled Graph Drift
**What goes wrong:** existing write/search/get_document calls change response shape or mutate graph tables when `graph:` is absent. [VERIFIED: product requirements]  
**Why it happens:** graph code gets added inline to existing handlers without a null provider or early gate. [ASSUMED]  
**How to avoid:** centralize `isGraphEnabled(config)` and use it in write hooks and read extensions. [ASSUMED]  
**Warning signs:** tests without graph config need fixture updates; graph tables contain rows after disabled write tests. [VERIFIED: product test plan]

### Pitfall 2: Misplaced Graph Hook
**What goes wrong:** structural graph writes run before chunks are committed or after embeddings only. [ASSUMED]  
**Why it happens:** `scheduleChangedDocumentChunks()` currently combines chunk persistence and embedding scheduling. [VERIFIED: codebase grep]  
**How to avoid:** refactor scheduler to expose/use the diff result after `diffAndPersistDocumentChunks()` and before/alongside embedding scheduling. [VERIFIED: codebase grep]  
**Warning signs:** graph nodes missing for newly created chunks, or stale marking misses changed chunks. [VERIFIED: product test plan]

### Pitfall 3: Link Resolution Ignores Chunk Model
**What goes wrong:** document-only links, heading anchors, merged tiny sections, or code-fenced links produce wrong targets. [VERIFIED: product requirements]  
**Why it happens:** graph link logic bypasses the parser’s actual chunk outputs. [ASSUMED]  
**How to avoid:** resolve references against persisted chunks and heading paths, with explicit document-root behavior for no-anchor links. [VERIFIED: product test plan]  
**Warning signs:** tests T-U-070/T-U-071 fail or fake node rows appear for missing targets. [VERIFIED: product test plan]

### Pitfall 4: Tool Metadata Missing
**What goes wrong:** server startup fails after registering `query_graph`. [VERIFIED: codebase grep]  
**Why it happens:** `assertRegisteredToolsHaveToolMeta()` runs after native tool registration. [VERIFIED: codebase grep]  
**How to avoid:** add `query_graph` metadata in `src/mcp/tool-metadata.ts` in the same slice as registration. [VERIFIED: codebase grep]  
**Warning signs:** unit tests around MCP server tools fail with missing metadata. [VERIFIED: codebase grep]

## Code Examples

### Query Graph Disabled Envelope
```typescript
// Source: MCP SDK docs + src/mcp/utils/response-formats.ts.
if (!config.graph?.enabled) {
  return jsonExpectedError({
    error: 'unsupported',
    message: 'Graph intelligence is disabled. Set graph.enabled: true and configure graph.embedding_name to use query_graph.',
    details: { feature: 'graph' },
  });
}
```

### Chunk Diff Hook Shape
```typescript
// Source: src/embedding/chunks/scheduler.ts.
const diff = await diffAndPersistDocumentChunks({ ... });
if (graphRuntime.enabled && processingLevel === 'full') {
  await markGraphStateStaleForChangedChunks(diff.changedChunks);
  await upsertStructuralGraph({ chunks: diff.chunks, changed: diff.chunksNeedingEmbedding });
}
```

### Supabase RPC/Table Pattern
```typescript
// Source: Context7 Supabase docs + src/mcp/tools/compound.ts.
const { data, error } = await supabase.rpc('fqc_graph_neighbors', {
  filter_instance_id: config.instance.id,
  source_chunk_id: chunkId,
  max_depth: maxDepth,
});
if (error) throw new Error(error.message);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Whole-document document embeddings | Section-level `fqc_chunks` with per-entry embeddings | v4.1 / Phases 168-169 | Graph nodes must key to chunks, not documents. [VERIFIED: .planning/STATE.md] |
| Legacy document `embedding` column | `fqc_chunks.embedding_<name>` and `match_chunks_<name>()` | v4.1 / Phase 168+ | Graph search expansion can rely on chunk IDs already present in semantic results. [VERIFIED: codebase grep] |
| Ad hoc JSON response strings | Canonical JSON helpers | Existing Phase 121 pattern | Graph public responses must use the same JSON envelope style. [VERIFIED: codebase grep] |

**Deprecated/outdated:**
- `@modelcontextprotocol/server`: explicitly forbidden; use `@modelcontextprotocol/sdk`. [VERIFIED: AGENTS.md]
- Web UI graph visualization: out of scope; FlashQuery remains CLI + MCP. [VERIFIED: product requirements]
- Stored similarity graph edges: out of scope for v1 topology. [VERIFIED: product requirements]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Regex-only link scanning is riskier than sharing the markdown AST parser family. | Standard Stack / Don't Hand-Roll | Could over-invest in AST parsing if existing regex helpers are sufficient. |
| A2 | Disabled graph is best implemented through a null-provider/early-return pattern. | Architecture Patterns / Pitfalls | Planner may choose inline guards instead; tests still enforce behavior. |
| A3 | Structural graph writes should run after chunk commit in scheduler rather than inside chunk store transaction. | Common Pitfalls / Code Examples | Transactional consistency might require moving graph writes into the same pg transaction. |

## Open Questions

1. **Always-create graph tables or enabled-only verification?**
   - What we know: CONTEXT.md permits either if disabled behavior and schema verification stay deterministic. [VERIFIED: CONTEXT.md]
   - What's unclear: whether startup should verify graph schema when graph is disabled. [VERIFIED: CONTEXT.md]
   - Recommendation: always include graph DDL in `buildSchemaDDL()`, but only require graph-specific readiness checks for graph-enabled behavior. [ASSUMED]

2. **Disabled `query_graph`: registered unsupported envelope or absent tool?**
   - What we know: CONTEXT.md permits either. [VERIFIED: CONTEXT.md]
   - What's unclear: which behavior is more desirable for clients. [VERIFIED: CONTEXT.md]
   - Recommendation: register `query_graph` always and return canonical `unsupported` when disabled for discoverability. [ASSUMED]

3. **How much of community-oriented `query_graph` returns in Phase 171?**
   - What we know: Phase 171 wires actions; Phase 172 populates community/lint data. [VERIFIED: product requirements]
   - What's unclear: exact empty/not-applicable payload shape. [ASSUMED]
   - Recommendation: implement action schemas and empty contract-shaped responses now; richer rows arrive in Phase 172. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript build/tests | ✓ | `v26.0.0` | Project requires >=20. [VERIFIED: terminal + AGENTS.md] |
| npm | Package scripts/version checks | ✓ | `11.12.1` | — [VERIFIED: terminal] |
| Python 3 | Scenario test runners | ✓ | `3.12.3` | — [VERIFIED: terminal] |
| Supabase/Postgres credentials | Integration tests | ✓ env file exists | `.env.test` present; exact secrets not printed | Tests skip via `HAS_SUPABASE` if incomplete. [VERIFIED: codebase grep] |
| Docker CLI | Preflight docker validation | not confirmed | command produced no output | Preflight script skips Docker validation if unavailable. [ASSUMED] |
| `slopcheck` | Package legitimacy gate | ✓ | `0.6.1` | JSON output unsupported; use text output. [VERIFIED: terminal] |

**Missing dependencies with no fallback:** none identified for research/planning. [VERIFIED: terminal]  
**Missing dependencies with fallback:** Docker may be absent; preflight docker validation is designed to skip when Docker is not installed. [ASSUMED]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.1` for unit/integration/e2e; Python scenario runners for directed/YAML tests. [VERIFIED: package.json + codebase grep] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: codebase grep] |
| Quick run command | `npm test -- --run <unit files>` for unit scope. [VERIFIED: package.json] |
| Full suite command | `npm test` plus graph-specific `npm run test:integration -- --run ...` for Supabase coverage. [VERIFIED: package.json + ROADMAP.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GR-001 | Disabled graph no-op and unsupported discoverability | unit + YAML | `npm test -- --run tests/unit/graph-config.test.ts`; `python3 tests/scenarios/integration/run_integration.py --managed graph_disabled_noop` | ❌ Wave 0 |
| GR-002 | Graph config cross-validation | unit | `npm test -- --run tests/unit/graph-config.test.ts` | ❌ Wave 0 |
| GR-003 | Vocabulary/prompt sidecars | unit | `npm test -- --run tests/unit/graph-vocabulary.test.ts tests/unit/graph-prompts.test.ts` | ❌ Wave 0 |
| GR-004 | Namespaced template variables | unit + integration | `npm test -- --run tests/unit/reference-resolver-namespaces.test.ts`; `npm run test:integration -- --run tests/integration/graph/namespaced-template-vars.test.ts` | ❌ Wave 0 |
| GR-005 | Graph schema | integration | `npm run test:integration -- --run tests/integration/graph/graph-schema.test.ts` | ❌ Wave 0 |
| GR-006 | Chunk-based node identity | unit + integration | `npm test -- --run tests/unit/graph-node-identity.test.ts`; `npm run test:integration -- --run tests/integration/graph/node-identity.test.ts` | ❌ Wave 0 |
| GR-007 | Relation vocabulary semantics | unit + integration | `npm test -- --run tests/unit/graph-relations.test.ts`; query graph symmetric edge case in integration | ❌ Wave 0 |
| GR-008 | Edge confidence/metadata validation | unit | `npm test -- --run tests/unit/graph-edge-validation.test.ts` | ❌ Wave 0 |
| GR-009 | Structural contains/references edges | unit + integration | `npm test -- --run tests/unit/graph-structural.test.ts tests/unit/graph-link-resolver.test.ts`; `npm run test:integration -- --run tests/integration/graph/structural-edges.test.ts` | ❌ Wave 0 |
| GR-013A | Staleness + nonblocking Tier 1 | unit | `npm test -- --run tests/unit/graph-staleness.test.ts` | ❌ Wave 0 |
| GR-014A | `fq_processing` gates | unit + integration | `npm test -- --run tests/unit/graph-processing-level.test.ts`; `npm run test:integration -- --run tests/integration/graph/fq-processing.test.ts` | ❌ Wave 0 |
| GR-016A | Status filtering | unit | `npm test -- --run tests/unit/graph-query-status-filter.test.ts` or fold into `graph-query.test.ts` | ❌ Wave 0 |
| GR-017 | `query_graph` read actions | unit + integration | `npm test -- --run tests/unit/graph-query.test.ts`; `npm run test:integration -- --run tests/integration/graph/query-graph.test.ts` | ❌ Wave 0 |
| GR-018 | Search graph expansion | unit + integration | `npm test -- --run tests/unit/graph-search-ranking.test.ts`; `npm run test:integration -- --run tests/integration/graph/search-graph-expansion.test.ts` | ❌ Wave 0 |
| GR-019 | `get_document` graph output | integration | `npm run test:integration -- --run tests/integration/graph/get-document-graph.test.ts` | ❌ Wave 0 |
| GR-020A | Provenance/question read shaping | unit + integration | `npm test -- --run tests/unit/graph-question-lifecycle.test.ts tests/unit/graph-provenance.test.ts`; `npm run test:integration -- --run tests/integration/graph/provenance-question.test.ts` | ❌ Wave 0 |
| GR-024A | Canonical graph envelopes | unit + integration | Covered by `graph-query`, `search-graph-expansion`, and disabled/noop tests | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** run the relevant unit file(s) for the edited module. [ASSUMED]
- **Per wave merge:** run all unit files listed in `.planning/ROADMAP.md` for Phase 171. [VERIFIED: ROADMAP.md]
- **Phase gate:** run graph integration command set from `.planning/ROADMAP.md`, then full `npm test`; run `npm run test:integration` only if Supabase is configured. [VERIFIED: ROADMAP.md]

### Wave 0 Gaps

- [ ] `tests/unit/graph-config.test.ts` - covers GR-001/GR-002. [VERIFIED: product test plan]
- [ ] `tests/unit/graph-vocabulary.test.ts` - covers GR-003/GR-007. [VERIFIED: product test plan]
- [ ] `tests/unit/graph-prompts.test.ts` - covers GR-003. [VERIFIED: product test plan]
- [ ] `tests/unit/reference-resolver-namespaces.test.ts` - covers GR-004. [VERIFIED: product test plan]
- [ ] `tests/unit/graph-edge-validation.test.ts` - covers GR-008. [VERIFIED: product test plan]
- [ ] `tests/unit/graph-structural.test.ts`, `tests/unit/graph-link-resolver.test.ts`, `tests/unit/graph-staleness.test.ts`, `tests/unit/graph-processing-level.test.ts` - covers GR-006/GR-009/GR-013A/GR-014A. [VERIFIED: product test plan]
- [ ] `tests/unit/graph-query.test.ts`, `tests/unit/graph-search-ranking.test.ts`, `tests/unit/graph-question-lifecycle.test.ts`, `tests/unit/graph-provenance.test.ts` - covers read surfaces. [VERIFIED: product test plan]
- [ ] `tests/integration/graph/` directory and graph integration files named in the roadmap. [VERIFIED: ROADMAP.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no new auth | Existing MCP auth remains unchanged. [VERIFIED: codebase grep] |
| V3 Session Management | no | MCP remains stateless; no server-side sessions. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Every graph table/RPC/query must filter by `instance_id`. [VERIFIED: product requirements] |
| V5 Input Validation | yes | Zod schemas for config, tool params, vocabulary, prompt sidecars, and edge metadata. [VERIFIED: AGENTS.md] |
| V6 Cryptography | no new crypto | Do not add crypto; existing UUID/content hash behavior remains. [VERIFIED: codebase grep] |
| V8 Data Protection | yes | Runtime errors must not leak raw LLM output, API keys, database URLs, or prompt content. [VERIFIED: product requirements] |

### Known Threat Patterns for FlashQuery Graph Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-instance graph leakage | Information Disclosure | Require `instance_id` in every table and query/RPC filter. [VERIFIED: product requirements] |
| Unbounded traversal / cycles | Denial of Service | Enforce `max_depth`, limits, relation filters, and visited-set/cycle protection. [VERIFIED: product requirements] |
| Raw error leakage | Information Disclosure | Use bounded expected/runtime envelopes; redact raw LLM/database details. [VERIFIED: product requirements] |
| Invalid sidecar vocabulary writes bad graph rows | Tampering | Validate relation names, directionality, detection method, and metadata schema before workers run. [VERIFIED: product requirements] |
| Graph disabled but hidden work runs | Elevation of Cost / DoS | Explicit disabled no-op provider and tests proving no graph queue/writes/LLM calls. [VERIFIED: product requirements] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/171-graph-foundation-structural-graph-and-read-surfaces/171-CONTEXT.md` - locked phase decisions and canonical refs. [VERIFIED: file read]
- Product Requirements: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md` - authoritative requirements. [VERIFIED: file read]
- Product Test Plan: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md` - authoritative verification plan. [VERIFIED: file read]
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md` - GSD phase mapping and project state. [VERIFIED: file read]
- `AGENTS.md` - project constraints. [VERIFIED: file read]
- Context7 `/modelcontextprotocol/typescript-sdk/v1.29.0` - MCP tool registration/response docs. [CITED: Context7]
- Context7 `/supabase/supabase` - Supabase table and RPC query docs. [CITED: Context7]
- Code anchors read: `src/config/loader.ts`, `src/config/types.ts`, `src/storage/supabase.ts`, `src/storage/schema-verify.ts`, `src/embedding/chunks/*`, `src/mcp/tools/documents/get.ts`, `src/mcp/tools/compound.ts`, `src/mcp/server.ts`, `src/mcp/tool-metadata.ts`, `src/llm/reference-resolver.ts`, `src/mcp/utils/response-formats.ts`. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)

- npm registry version checks for existing dependencies. [VERIFIED: npm registry]
- `slopcheck` text output for existing dependency names. [VERIFIED: slopcheck]

### Tertiary (LOW confidence)

- None used for locked requirements. [VERIFIED: research log]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package.json, npm registry, Context7, and codebase patterns agree; no new package install is recommended. [VERIFIED: package.json + npm registry + Context7]
- Architecture: HIGH - product docs name code anchors that match current source. [VERIFIED: file read + codebase grep]
- Pitfalls: MEDIUM - major pitfalls are requirement-backed; hook placement details need implementation confirmation. [VERIFIED: product requirements]

**Research date:** 2026-06-23  
**Valid until:** 2026-07-23 for local codebase patterns; re-check npm/package docs before package upgrades. [ASSUMED]
