# Phase 126: Plugin + Record Consolidation - Research

**Researched:** 2026-05-12
**Domain:** FlashQuery MCP plugin and record tool consolidation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Canonical Source Documents
- Downstream planning, implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
  - `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- If roadmap details and product docs appear to conflict, treat `.planning/ROADMAP.md` as the phase boundary and the two product docs above as the detailed contract inside that boundary.
- Implementation agents should answer their own scope questions from those docs first, then from phase artifacts, before asking the user.

### Tool-Specific Locked Scope
- `register_plugin` output must be `{ plugin_id, name, status, table_count, registered_at, was_new }`; registration remains an upsert keyed by `plugin_id` and must not add a `mode` discriminator.
- `unregister_plugin` output must be a plugin identification block with `status: "unregistered"` and `unregistered_at`; live records return canonical `conflict` unless `force: true`, and forced unregister returns `warnings: ["orphaned_records: N"]`.
- `get_plugin_info` must support include values `schema`, `tables`, and `status_detail`; default output includes identification plus table names only.
- `write_record` requires explicit `mode: "create" | "update"` with no default. `plugin_id` and `table` are always required.
- `write_record(mode: "create")` requires `data` with all schema-required fields, permits omitted optional fields, rejects `id`, and rejects generated or unknown fields.
- `write_record(mode: "update")` requires compound `(plugin_id, table, id)` and partial `data`; required-on-create fields are not required on update, but generated and unknown fields remain rejected.
- `write_record` is single-target only. Full `data` is gated by `include: ["data"]`; schema metadata is gated by `include: ["schema_metadata"]`; default include is identification-only.
- Plugin-record reconciliation and pending-review side effects must be returned structurally as `reconciliation` and `pending_review` only when non-empty. These are plugin workflow outputs, not scanner/index sync internals.
- `get_record` default include is `["data"]`; callers may pass `include: []` for identification-only output and `include: ["schema_metadata"]` for schema metadata.
- `archive_record` accepts `targets: [{ plugin_id, table, id }]`, preserves input order, returns per-element expected errors, sets `archived_at` when available, and returns `warnings: ["archived_at_unavailable"]` when a plugin table lacks the column.
- `search_records` returns `{ plugin_id?, table?, query, tag?, total, results }`, uses `include: ["data"]` for payloads, includes `score` only in semantic mode, excludes archived records by default, and supports `tag` plus `taggable_tables_only` for transitional briefing parity.
- `clear_pending_reviews` requires `action`; `action: "list"` returns `{ pending, items }`; `action: "clear"` accepts optional `plugin_id` and/or pending-review row `ids` filters and returns `{ cleared, items }`; nonexistent ids return `warnings: ["no_matching_items"]`.

### Testing And Traceability
- The first implementation task must instantiate a phase-local traceability table mapping `REC-01` through `REC-07` to unit, integration, E2E, directed scenario, and integration scenario evidence.
- Tests must be bundled with implementation and must not be deferred to Phase 128.
- `write_record` is high-risk and must satisfy its full Test Plan §4.4 contract in this phase.
- Standard plugin and record tools must satisfy the Test Plan §5.3 rows and the detailed checklist rows for `register_plugin`, `unregister_plugin`, `get_plugin_info`, `get_record`, `archive_record`, `search_records`, and `clear_pending_reviews`.
- Existing `create_record` / `update_record` assertions and integration workflows must be ported to `write_record(mode: "create" | "update")` before old coverage is removed.
- Directed and integration scenario coverage ledgers must be updated before scenario files are changed, following the MCP Tool Consolidation Test Plan ordering rules.

### the agent's Discretion
- Exact helper/module boundaries may follow existing repo patterns, but shared helpers in `src/mcp/utils/response-formats.ts` and existing Phase 121-125 output helpers should be preferred over per-tool JSON construction.
- Plugin/record validation helpers may live beside the existing record tools or in a new utility module if that keeps handler code concise and unit-testable.
- Existing tests may be expanded, renamed, or split where that reduces fixture complexity, provided legacy behavior coverage remains traceable.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

- Final host/delegated surface removal and absence audit for legacy record names is Phase 128 unless this phase includes a narrow, coverage-backed assertion.
- Macro-dependent legacy composition removals remain outside this phase.
- Directory, vault-maintenance, remove-document, and final cleanup phases remain separate roadmap phases.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REC-01 | `register_plugin` returns a plugin identification block with `was_new` and preserves explicit upsert semantics. | Current handler exists but emits prose; use `pluginIdentification` and preserve registry upsert behavior. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/plugins.ts`; VERIFIED: `src/mcp/utils/response-formats.ts`] |
| REC-02 | `unregister_plugin` returns a plugin identification block with unregister metadata and preserves plugin cleanup behavior. | Current handler performs dry-run/confirmed teardown; product contract replaces destructive `confirm_destroy` shape with conflict/force semantics for live records. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/plugins.ts`; CITED: MCP Tool Consolidation Requirements §4.25] |
| REC-03 | `get_plugin_info` returns a plugin envelope with include-controlled `schema`, `tables`, and `status_detail`. | Current handler reads `pluginManager.getEntry` and emits full prose schema; planner should add include parsing and JSON payload gates. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `src/mcp/tools/plugins.ts`; CITED: MCP Tool Consolidation Requirements §4.26] |
| REC-04 | `write_record(mode:"create")` replaces `create_record` by validating plugin/table schema, rejecting generated or unknown fields, and returning a record identification block. | `write_record` is metadata-future only; `create_record` currently inserts raw `fields` without schema field validation. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `src/mcp/tools/records.ts`; CITED: Test Plan §4.4] |
| REC-05 | `write_record(mode:"update")` replaces `update_record` by validating partial data against plugin schema and returning a record identification block. | Current `update_record` updates raw fields and returns prose; final contract requires mode discriminator, partial schema validation, and include gates. [VERIFIED: `src/mcp/tools/records.ts`; CITED: MCP Tool Consolidation Requirements §4.27] |
| REC-06 | `get_record`, `archive_record`, and `search_records` keep behavior while returning structured JSON envelopes, include-controlled data, ordered batch results, and taggable-record search support. | Current tools exist and reconcile before record access/search, but `archive_record` is single-target and `search_records` requires one plugin/table. [VERIFIED: `src/mcp/tools/records.ts`; CITED: MCP Tool Consolidation Requirements §4.28-§4.31] |
| REC-07 | `clear_pending_reviews` uses explicit `action: "list" | "clear"` and returns structured pending/cleared item envelopes. | Current tool infers query vs clear from `fqc_ids` and filters by document `fqc_id`, not pending-review row `id`. [VERIFIED: `src/mcp/tools/pending-review.ts`; CITED: MCP Tool Consolidation Requirements §4.32] |
</phase_requirements>

## Summary

Phase 126 is a bounded consolidation over the existing plugin and record MCP surface: keep plugin/record behavior and reconciliation workflows, but replace prose/key-value responses with structured JSON envelopes and replace `create_record`/`update_record` with a new explicit `write_record(mode)` tool. [VERIFIED: `.planning/ROADMAP.md`; CITED: MCP Tool Consolidation Requirements §4.24-§4.32]

The main planning risk is that record writes currently trust caller-provided field maps and rely on database errors for validation; the final contract requires plugin-schema validation before DB mutation, generated-field rejection, unknown-field rejection, include-gated payloads, and structured reconciliation/pending-review side effects. [VERIFIED: `src/mcp/tools/records.ts`; CITED: MCP Tool Consolidation Requirements §4.27; CITED: Test Plan §4.4]

**Primary recommendation:** plan Phase 126 in five waves: traceability/schema-helper foundation, plugin envelopes, `write_record`, record read/archive/search envelopes, then pending-review/scenario/E2E closure. [VERIFIED: phase dependency and test obligations in `.planning/ROADMAP.md`; VERIFIED: current code shape in `src/mcp/tools/*.ts`]

## Project Constraints (from AGENTS.md)

- Use Node.js >= 20 LTS, TypeScript strict mode, and ESM; do not introduce CommonJS. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`]
- FlashQuery is CLI + MCP only; do not build a web UI. [VERIFIED: `AGENTS.md`]
- Use `@modelcontextprotocol/sdk`, not `@modelcontextprotocol/server`. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`]
- Use Zod for external input validation. [VERIFIED: `AGENTS.md`; VERIFIED: existing MCP handlers]
- MCP tool handlers should catch internally and return MCP text content; expected validation/not-found/conflict errors must use structured expected-error envelopes with `isError:false`, while unexpected runtime failures use `isError:true`. [VERIFIED: `AGENTS.md`; VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: MCP SDK docs via Context7 `/modelcontextprotocol/typescript-sdk`]
- Unit tests live under `tests/unit/*.test.ts`; integration tests under `tests/integration/*.test.ts`; E2E tests under `tests/e2e/*.test.ts`; scenario suites live under `tests/scenarios/`. [VERIFIED: `AGENTS.md`; VERIFIED: codebase file listing]
- Integration and E2E tests use `.env.test` and skip when Supabase credentials are missing or incomplete. [VERIFIED: `AGENTS.md`; VERIFIED: test helpers referenced in existing tests]
- Never use `npm link` for local development. [VERIFIED: `AGENTS.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Plugin registration/info/unregistration | API / Backend | Database / Storage | MCP handlers own validation and response contracts; plugin registry and plugin table DDL persist in Supabase. [VERIFIED: `src/mcp/tools/plugins.ts`; VERIFIED: `src/storage/supabase.ts`] |
| Record create/update/read/archive/search | API / Backend | Database / Storage | MCP handlers resolve plugin/table scope and call Supabase/pg against dynamic plugin tables. [VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: `src/plugins/manager.ts`] |
| Plugin document reconciliation side effects | API / Backend | Local vault + Database / Storage | Record tools trigger `reconcilePluginDocuments` and `executeReconciliationActions`, which inspect vault/document rows and write plugin rows/pending reviews. [VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: `src/services/plugin-reconciliation.ts`] |
| Pending review list/clear | API / Backend | Database / Storage | `clear_pending_reviews` is an MCP tool over `fqc_pending_plugin_review`; final `ids` are row IDs. [VERIFIED: `src/mcp/tools/pending-review.ts`; CITED: MCP Tool Consolidation Requirements §4.32] |
| Scenario validation | Test Harness | MCP protocol process | Directed scenarios verify public single-tool behavior; YAML integration scenarios verify multi-step composition. [VERIFIED: `tests/scenarios/directed/WRITING_SCENARIOS.md`; VERIFIED: `tests/scenarios/integration/README.md`] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | Installed `^1.27.1`; npm latest `1.29.0`, modified 2026-03-30 | MCP server/tool registration and protocol results | Existing project standard; official SDK docs show `registerTool` with Zod input schemas and `CallToolResult` content/isError semantics. [VERIFIED: `package.json`; VERIFIED: npm registry; CITED: Context7 `/modelcontextprotocol/typescript-sdk`] |
| `zod` | Installed `^4.3.6`; npm latest `4.4.3`, modified 2026-05-04 | MCP input schemas and validation | Required by project conventions and used by existing handlers. [VERIFIED: `AGENTS.md`; VERIFIED: `package.json`; VERIFIED: npm registry] |
| `@supabase/supabase-js` | Installed `^2.100.0`; npm latest `2.105.4`, modified 2026-05-11 | Application-level row CRUD | Existing storage layer and dynamic record tools use Supabase client queries. [VERIFIED: `package.json`; VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: npm registry] |
| `pg` | Installed/latest `^8.20.0`, modified 2026-03-04 | Dynamic plugin DDL, vector SQL, information_schema checks | Current plugin DDL and semantic record search need raw PostgreSQL SQL beyond PostgREST. [VERIFIED: `package.json`; VERIFIED: `src/mcp/tools/plugins.ts`; VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | Installed `^4.1.1`; npm latest `4.1.6`, modified 2026-05-11 | Unit/integration/E2E test runner | Use existing Vitest configs and focused commands for handler, integration, and protocol coverage. [VERIFIED: `package.json`; VERIFIED: `tests/config`; VERIFIED: npm registry] |
| `js-yaml` | Installed `^4.1.1` | Plugin schema parsing | Keep existing `parsePluginSchema` path for plugin YAML; do not introduce a second YAML parser. [VERIFIED: `package.json`; VERIFIED: `src/plugins/manager.ts`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing response helpers | Per-tool JSON construction | Rejected because Phase 121 created shared helpers and product docs require consistent envelope semantics. [VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: MCP Tool Consolidation Requirements §2.11] |
| Existing Supabase + pg split | Raw pg for every operation | Rejected for routine CRUD because existing handlers and tests use Supabase client patterns; raw pg remains appropriate for DDL/vector/dynamic SQL. [VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: `src/mcp/tools/plugins.ts`] |
| New validation library | Ajv/custom schema validation | Rejected because project convention is Zod for MCP params and plugin schemas already use local parsed specs. [VERIFIED: `AGENTS.md`; VERIFIED: `src/plugins/manager.ts`] |

**Installation:**
```bash
npm install
```

**Version verification:** `npm view` was run for `@modelcontextprotocol/sdk`, `zod`, `@supabase/supabase-js`, `pg`, and `vitest`; installed versions are pinned in `package.json`, and latest registry versions above should be treated as informational only unless a separate dependency-upgrade phase is approved. [VERIFIED: npm registry; VERIFIED: `package.json`]

## Architecture Patterns

### System Architecture Diagram

```text
Host AI client
  -> MCP stdio tool call
    -> src/mcp/server.ts registration gate
      -> plugin tools / record tools / pending-review tools
        -> input schema validation (Zod)
        -> plugin/table resolution (pluginManager + resolveTableName)
        -> expected-error decision?
           -> yes: jsonExpectedError(...), isError:false
           -> no: DB/vault action
        -> reconciliation needed?
           -> yes: reconcilePluginDocuments -> executeReconciliationActions
                    -> plugin table writes + fqc_pending_plugin_review rows
           -> no: continue
        -> response helper builds plugin/record envelope
      -> MCP text content containing JSON
```

[VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: `src/mcp/tools/plugins.ts`; VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: MCP SDK docs via Context7]

### Recommended Project Structure

```text
src/mcp/tools/
  plugins.ts              # register_plugin, unregister_plugin, get_plugin_info
  records.ts              # write_record, get_record, archive_record, search_records
  pending-review.ts       # clear_pending_reviews action modes
src/mcp/utils/
  response-formats.ts     # canonical JSON helpers and entity identification builders
  record-output.ts        # recommended: include gates, schema metadata, side-effect envelopes
  record-validation.ts    # recommended: schema-required/unknown/generated field checks
tests/unit/
  write-record.test.ts
  record-tools.test.ts
  plugin-tools.test.ts
  pending-plugin-review.test.ts
tests/integration/
  write-record.integration.test.ts
  plugin-records.integration.test.ts
  plugin-reconciliation.integration.test.ts
tests/e2e/
  protocol.test.ts
tests/scenarios/
  directed/DIRECTED_COVERAGE.md
  integration/INTEGRATION_COVERAGE.md
```

[VERIFIED: current directories and files; VERIFIED: Phase 125 pattern in `.planning/phases/125-unified-search-memory-consolidation/125-PATTERNS.md`]

### Pattern 1: JSON Tool Result Helpers

**What:** Return JSON through MCP text content via shared helpers, and use expected-error envelopes for validation/not-found/conflict outcomes. [VERIFIED: `src/mcp/utils/response-formats.ts`]

**When to use:** Every migrated plugin/record tool response in this phase. [CITED: MCP Tool Consolidation Requirements §2.11]

**Example:**
```typescript
// Source: src/mcp/utils/response-formats.ts
return jsonToolResult({
  ...recordIdentification({
    id,
    plugin_id,
    table,
    created_at,
    updated_at,
  }),
  ...(includeData ? { data } : {}),
});
```

### Pattern 2: Plugin Table Resolution Before DB Access

**What:** Resolve `(plugin_id, plugin_instance, table)` through `pluginManager.getTableSpec`, then derive the physical `fqcp_*` table name through `resolveTableName`. [VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: `src/plugins/manager.ts`]

**When to use:** All record read/write/archive/search handlers before touching dynamic plugin tables. [VERIFIED: current handler pattern]

**Example:**
```typescript
// Source: src/mcp/tools/records.ts
const { fullTableName, tableSpec } = resolveAndValidateTable(plugin_id, instanceName, table);
```

### Pattern 3: Schema-Driven Record Data Validation

**What:** Validate `data` against `PluginTableSpec.columns` before insert/update, treating implicit/generated fields as caller-forbidden and schema columns as the allowed user field set. [CITED: MCP Tool Consolidation Requirements §4.27; VERIFIED: `src/plugins/manager.ts`]

**When to use:** `write_record(mode:"create")` and `write_record(mode:"update")`; create requires required schema fields, update accepts partial fields. [CITED: Test Plan §4.4]

**Example:**
```typescript
// Source: derived from src/plugins/manager.ts PluginTableSpec and product contract
const schemaFields = new Set(tableSpec.columns.map((column) => column.name));
const generatedFields = new Set([
  'id',
  'created_at',
  'updated_at',
  'instance_id',
  'fqc_id',
  'path',
  'status',
  'last_seen_updated_at',
  'embedding',
  'embedding_updated_at',
]);
```

### Anti-Patterns to Avoid

- **Inferring create/update mode from `id` or field presence:** `write_record.mode` is required and has no default. [CITED: MCP Tool Consolidation Requirements §4.27]
- **Returning prose plus JSON snippets:** final plugin/record tools must return parseable JSON envelopes. [CITED: MCP Tool Consolidation Requirements §2.11; VERIFIED: current prose in `src/mcp/tools/records.ts`]
- **Relying on database errors for schema validation:** product contract requires explicit required/unknown/generated field validation. [CITED: Test Plan §4.4]
- **Using document `fqc_id` as pending-review clear IDs:** final `clear_pending_reviews.ids` are `fqc_pending_plugin_review.id` row IDs. [CITED: MCP Tool Consolidation Requirements §4.32; VERIFIED: current `fqc_ids` behavior in `src/mcp/tools/pending-review.ts`]
- **Surfacing scanner/index sync internals:** only plugin workflow reconciliation and pending review side effects are returned structurally; internal sync state remains hidden. [CITED: MCP Tool Consolidation Requirements XC-11 and §4.27]
- **Dropping broad legacy tools in Phase 126:** final host/delegated absence audit for legacy record names belongs to Phase 128 unless a narrow coverage-backed assertion is explicitly planned. [VERIFIED: `126-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP result construction | Per-handler JSON/string assembly | `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `recordIdentification`, `pluginIdentification`, `withWarnings` | Keeps error/isError/envelope semantics consistent. [VERIFIED: `src/mcp/utils/response-formats.ts`] |
| Plugin YAML parsing | New YAML parser or ad hoc object traversal | `parsePluginSchema` and `PluginTableSpec` | Existing parser validates plugin IDs, table columns, types, embed fields, and document policies. [VERIFIED: `src/plugins/manager.ts`] |
| Dynamic table naming | String concatenation in handlers | `resolveTableName` plus `pg.escapeIdentifier` for SQL | Existing helper encodes `fqcp_${plugin}_${instance}_${table}` convention; raw SQL must escape identifiers. [VERIFIED: `src/plugins/manager.ts`; VERIFIED: `src/mcp/tools/records.ts`] |
| Reconciliation engine | New record-write reconciliation logic | `reconcilePluginDocuments` and `executeReconciliationActions` | Existing engine owns auto-track/archive/resurrect/path/sync-field/pending-review behavior. [VERIFIED: `src/services/plugin-reconciliation.ts`; VERIFIED: `src/mcp/tools/records.ts`] |
| Scenario runner assertions | Bespoke scenario parser | Existing directed framework and YAML JSON path assertion support | Scenario framework already defines public-surface test conventions and JSON assertions. [VERIFIED: `tests/scenarios/directed/WRITING_SCENARIOS.md`; VERIFIED: `tests/scenarios/integration/README.md`] |

**Key insight:** this phase is mostly contract migration and validation hardening around existing dynamic plugin infrastructure; new custom subsystems would increase risk without improving the public surface. [VERIFIED: current codebase patterns; CITED: product docs]

## Runtime State Inventory

> This phase is a consolidation/refactor of public MCP contracts and test references; runtime state can still embed old tool behavior through plugin tables, pending-review rows, and external scenario/test servers. [VERIFIED: phase context; VERIFIED: current codebase]

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `fqc_plugin_registry`, dynamic `fqcp_*` plugin tables, and `fqc_pending_plugin_review` exist in Supabase schema. [VERIFIED: `src/storage/supabase.ts`] | No data migration for tool names; planner must ensure new handlers preserve existing rows and dynamic table names. [VERIFIED: product scope] |
| Live service config | Host/delegated tool metadata currently marks `write_record` as `future` and `create_record`/`update_record` as `current`. [VERIFIED: `src/mcp/tool-metadata.ts`] | Promote/update metadata in phase; broad absence/removal audit deferred to Phase 128. [VERIFIED: `126-CONTEXT.md`] |
| OS-registered state | None found; FlashQuery runs as a CLI/MCP subprocess, and no launchd/systemd/pm2 state was inspected because phase does not rename installed services. [VERIFIED: `AGENTS.md`; ASSUMED: no external service registrations in this workspace] | No action unless user has separately installed long-running service wrappers. [ASSUMED] |
| Secrets/env vars | `.env.test` supplies Supabase/API credentials for integration/E2E/scenario tests; no phase-specific secret key rename is required. [VERIFIED: `AGENTS.md`; VERIFIED: test docs] | Ensure tests skip/record missing credentials through existing helpers. [VERIFIED: `AGENTS.md`] |
| Build artifacts | `dist/` exists and managed scenario runners rebuild when source is newer. [VERIFIED: `ls`; VERIFIED: `tests/scenarios/integration/README.md`] | Run `npm run build`; no artifact migration needed. [VERIFIED: package scripts] |

## Common Pitfalls

### Pitfall 1: Treating `unregister_plugin` As Existing Destructive Teardown

**What goes wrong:** planner keeps `confirm_destroy` dry-run/drop-table semantics instead of product `force` conflict/orphan behavior. [VERIFIED: `src/mcp/tools/plugins.ts`; CITED: MCP Tool Consolidation Requirements §4.25]

**How to avoid:** add an early design task to reconcile current `confirm_destroy` behavior against final `force` contract, including live-record conflict count and forced orphan warning. [CITED: `126-CONTEXT.md`]

### Pitfall 2: Missing Generated Field Rejection

**What goes wrong:** `write_record` accepts `id`, `instance_id`, timestamps, reconciliation fields, or embedding columns in caller `data`. [VERIFIED: current `create_record`/`update_record` insert raw fields]

**How to avoid:** define a single generated-field set and test create/update rejection for each high-risk category. [CITED: Test Plan §4.4]

### Pitfall 3: Breaking Reconciliation While Cleaning Output

**What goes wrong:** record tools stop calling reconciliation before read/search/write/archive, causing plugin-owned document workflows to regress. [VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: `tests/scenarios/directed/DIRECTED_COVERAGE.md` RO rows]

**How to avoid:** preserve reconciliation preamble and convert summaries into structured `reconciliation` / `pending_review` payloads only when non-empty. [CITED: MCP Tool Consolidation Requirements §4.27]

### Pitfall 4: Scenario Fossils

**What goes wrong:** directed/YAML scenario files keep `create_record`, `update_record`, old `clear_pending_reviews(fqc_ids)` calls, or prose assertions after Phase 126. [VERIFIED: `tests/scenarios/directed/DIRECTED_COVERAGE.md`; CITED: Test Plan §7]

**How to avoid:** update coverage ledgers first, then port scenario files to final tool names and parsed JSON assertions. [CITED: Test Plan §7.1-§7.4]

### Pitfall 5: Search Records Across All Plugins Without Table-Discovery Design

**What goes wrong:** planner promises `taggable_tables_only` across all registered taggable tables without accounting for plugin table discovery and per-result plugin/table identity. [CITED: MCP Tool Consolidation Requirements §4.31; VERIFIED: current `search_records` requires `plugin_id` and `table`]

**How to avoid:** schedule `search_records` taggable-table discovery after plugin envelope/helper work and before scenario coverage. [VERIFIED: codebase; CITED: product docs]

## Code Examples

### Expected Error Envelope

```typescript
// Source: src/mcp/utils/response-formats.ts
return jsonExpectedError({
  error: 'invalid_input',
  message: "Unknown field 'unknown' for crm.contacts",
  identifier: id,
  details: { field: 'unknown', plugin_id, table },
});
```

### Record Identification Envelope

```typescript
// Source: src/mcp/utils/response-formats.ts
const base = recordIdentification({
  id: row.id as string,
  plugin_id,
  table,
  created_at: row.created_at as string,
  updated_at: row.updated_at as string,
});
return jsonToolResult(includeData ? { ...base, data: stripGenerated(row) } : base);
```

### MCP Tool Registration Shape

```typescript
// Source: Context7 /modelcontextprotocol/typescript-sdk and existing src/mcp/tools/*.ts
server.registerTool(
  'write_record',
  {
    description: D.writeRecord,
    inputSchema: {
      mode: z.enum(['create', 'update']),
      plugin_id: z.string(),
      table: z.string(),
      id: z.string().optional(),
      data: z.record(z.string(), z.unknown()),
      include: z.array(z.enum(['data', 'schema_metadata'])).optional(),
    },
  },
  async (args) => {
    // handler returns ToolResult
  },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `create_record(fields)` and `update_record(fields)` | `write_record(mode:"create"|"update", data)` | Product contract dated 2026-05-11 | Plans must port tests and public examples to one explicit mode-based tool. [CITED: MCP Tool Consolidation Requirements §4.27; VERIFIED: `.planning/REQUIREMENTS.md`] |
| Prose/key-value plugin/record responses | JSON entity envelopes with include gates | v3.3 Phases 121-126 | All touched assertions should parse JSON, not substring prose. [CITED: MCP Tool Consolidation Requirements §2.11; VERIFIED: Phase 125 pattern] |
| `clear_pending_reviews(fqc_ids: [])` query-mode inference | `clear_pending_reviews(action:"list"|"clear", ids?: [])` | Product contract dated 2026-05-11 | Pending review callers must use row IDs returned by list, not document `fqc_id`. [CITED: MCP Tool Consolidation Requirements §4.32] |
| Scenario coverage after implementation | Coverage ledger before scenario file changes | Test Plan dated 2026-05-11 | Planner should create a scenario-ledger wave before scenario edits. [CITED: Test Plan §7.1] |

**Deprecated/outdated:**
- `create_record` and `update_record`: merged into `write_record`; broad removal/absence audit is Phase 128, but Phase 126 coverage must port behavior. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `126-CONTEXT.md`]
- Prose response assertions for plugin/record tools: invalid after migrated tools return JSON envelopes. [CITED: Test Plan §8.1]
- `clear_pending_reviews` query-via-empty-`fqc_ids`: replaced by required `action`. [CITED: MCP Tool Consolidation Requirements §4.32]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No OS-registered service state embeds old tool names in this workspace. | Runtime State Inventory | Low; if user has external service wrappers, planner may need a manual restart/check step. |
| A2 | No dependency upgrade is intended despite newer npm registry versions. | Standard Stack | Medium; upgrading SDK/Zod/Supabase during this phase would expand scope and test risk. |

## Open Questions (RESOLVED)

1. **Should current `unregister_plugin(confirm_destroy)` remain as a transitional parameter in addition to `force`, or should Phase 126 hard-switch the input schema?**
   - What we know: product contract says live records conflict unless `force:true`; current implementation uses dry-run/confirmed destructive teardown. [VERIFIED: `src/mcp/tools/plugins.ts`; CITED: MCP Tool Consolidation Requirements §4.25]
   - RESOLVED: Phase 126 hard-switches the public MCP input schema to `force?: boolean` and ports tests in the plugin-envelope wave. `confirm_destroy` is not retained as a public compatibility parameter because the product contract specifies conflict/force semantics and Phase 128 owns the broad final legacy surface audit. [VERIFIED: `126-02-PLAN.md`; CITED: MCP Tool Consolidation Requirements §4.25; CITED: Test Plan §8]

2. **Where should final `schema_metadata` come from for records?**
   - What we know: `PluginTableSpec.columns` carries names/types/required/default/description and is available via `pluginManager.getTableSpec`. [VERIFIED: `src/plugins/manager.ts`]
   - RESOLVED: Phase 126 uses the verifier-safe public shape `schema_metadata: { required_fields: string[] }`, derived from `PluginTableSpec.columns`. Broader field metadata is not exposed in this phase because the product docs only ground `required_fields`; expanding the public response shape requires a later explicit contract update. [VERIFIED: `126-01-PLAN.md`; CITED: MCP Tool Consolidation Requirements §4.28]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Build, tests, MCP server | yes | v24.7.0 | Must be >=20. [VERIFIED: local command; VERIFIED: `AGENTS.md`] |
| npm | Package scripts | yes | 11.5.1 | none needed. [VERIFIED: local command] |
| Python | Scenario runners | yes | 3.12.3 | none needed. [VERIFIED: local command; VERIFIED: scenario docs] |
| Git | Scenario cleanup/git-aware tests | yes | 2.50.1 | none needed. [VERIFIED: local command] |
| Docker | Preflight Docker compose validation | not found in command output | — | `npm run preflight:docker` skips automatically when Docker is unavailable. [VERIFIED: local command; VERIFIED: `.agents/skills/pre-push/SKILL.md`] |
| Supabase/.env.test | Integration/E2E/scenario DB tests | unknown | — | Existing tests skip gracefully when incomplete; full phase validation needs configured test DB. [VERIFIED: `AGENTS.md`] |

**Missing dependencies with no fallback:**
- None proven from local CLI probes. [VERIFIED: local command]

**Missing dependencies with fallback:**
- Docker CLI was not found in the local probe; preflight Docker validation has a skip path. [VERIFIED: local command; VERIFIED: pre-push skill]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest installed `^4.1.1`, latest `4.1.6`; Python directed and YAML scenario runners. [VERIFIED: `package.json`; VERIFIED: npm registry; VERIFIED: scenario docs] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.e2e.config.ts`. [VERIFIED: file listing] |
| Quick run command | `npm test -- tests/unit/write-record.test.ts tests/unit/record-tools.test.ts tests/unit/plugin-tools.test.ts tests/unit/pending-plugin-review.test.ts` [VERIFIED: package scripts and file listing] |
| Full suite command | `npm test && npm run test:integration && npm run test:e2e && npm run build` plus focused scenario commands. [VERIFIED: package scripts; VERIFIED: scenario docs] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REC-01 | `register_plugin` JSON envelope and `was_new` upsert semantics | unit/integration/E2E/directed/YAML | `npm test -- tests/unit/plugin-tools.test.ts && npm run test:integration -- tests/integration/plugin-records.integration.test.ts` | yes; needs updates [VERIFIED: file listing] |
| REC-02 | `unregister_plugin` conflict/force/orphan warning and cleanup preservation | unit/integration/directed/YAML | `npm test -- tests/unit/plugin-tools.test.ts tests/unit/advanced-document-tools.test.ts && npm run test:integration -- tests/integration/e2e-workflows.test.ts` | yes; needs updates [VERIFIED: file listing] |
| REC-03 | `get_plugin_info` include controls | unit/integration/E2E/directed/YAML | `npm test -- tests/unit/plugin-tools.test.ts && npm run test:integration -- tests/integration/plugin-records.integration.test.ts` | yes; needs updates [VERIFIED: file listing] |
| REC-04 | `write_record(create)` validation and envelope | unit/integration/E2E/directed/YAML | `npm test -- tests/unit/write-record.test.ts tests/unit/record-tools.test.ts && npm run test:integration -- tests/integration/write-record.integration.test.ts` | `write-record` files missing; Wave 0 [VERIFIED: file listing] |
| REC-05 | `write_record(update)` partial validation and envelope | unit/integration/E2E/directed/YAML | `npm test -- tests/unit/write-record.test.ts && npm run test:integration -- tests/integration/write-record.integration.test.ts` | missing; Wave 0 [VERIFIED: file listing] |
| REC-06 | `get_record`/`archive_record`/`search_records` structured envelopes, batch archive, tags | unit/integration/E2E/directed/YAML | `npm test -- tests/unit/record-tools.test.ts && npm run test:integration -- tests/integration/plugin-records.integration.test.ts tests/integration/plugin-reconciliation.integration.test.ts` | yes; needs updates [VERIFIED: file listing] |
| REC-07 | `clear_pending_reviews(action)` list/clear row IDs | unit/integration/E2E/directed/YAML | `npm test -- tests/unit/pending-plugin-review.test.ts && npm run test:integration -- tests/integration/pending-plugin-review.integration.test.ts` | yes; needs updates [VERIFIED: file listing] |

### Sampling Rate

- **Per task commit:** focused unit file(s) for touched tool plus `npm run build`. [VERIFIED: package scripts; ASSUMED: acceptable sampling policy]
- **Per wave merge:** touched unit + integration files and any scenario file changed by that wave. [CITED: Test Plan §8.6]
- **Phase gate:** unit, integration, E2E protocol, directed scenario subset, YAML integration subset, and build green before `$gsd-verify-work`. [VERIFIED: `.planning/ROADMAP.md`; CITED: Test Plan §2]

### Wave 0 Gaps

- [ ] `.planning/phases/126-plugin-record-consolidation/TRACEABILITY.md` — maps REC-01 through REC-07 to five-layer evidence. [VERIFIED: `126-CONTEXT.md`]
- [ ] `tests/unit/write-record.test.ts` — high-risk `write_record` validation and include coverage. [VERIFIED: file listing missing]
- [ ] `tests/integration/write-record.integration.test.ts` — real plugin schema create/update validation and include coverage. [VERIFIED: file listing missing]
- [ ] `tests/scenarios/directed/DIRECTED_COVERAGE.md` — modify `P-04`/`P-06` and add/modify rows for `D-wrec-*`, plugin envelopes, pending-review actions. [VERIFIED: coverage grep]
- [ ] `tests/scenarios/integration/INTEGRATION_COVERAGE.md` — add final `write_record -> search_records -> archive_record` and pending-review workflows. [VERIFIED: coverage grep; CITED: Test Plan §7.3]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth behavior changes in this phase; MCP auth remains existing server concern. [VERIFIED: phase boundary; VERIFIED: `AGENTS.md`] |
| V3 Session Management | no | MCP remains stateless; do not introduce server-side session state. [VERIFIED: `AGENTS.md`] |
| V4 Access Control | yes | Preserve host/delegated metadata eligibility and plugin table scoping by `instance_id`. [VERIFIED: `src/mcp/tool-metadata.ts`; VERIFIED: `src/mcp/tools/records.ts`] |
| V5 Input Validation | yes | Zod for MCP params plus plugin-schema field validation for record `data`. [VERIFIED: `AGENTS.md`; CITED: Test Plan §4.4] |
| V6 Cryptography | no | No cryptographic changes. [VERIFIED: phase boundary] |

### Known Threat Patterns for FlashQuery Plugin Records

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection through dynamic plugin/table/field names | Tampering | Resolve table names through plugin metadata and escape SQL identifiers in raw pg paths. [VERIFIED: `src/plugins/manager.ts`; VERIFIED: `src/mcp/tools/records.ts`] |
| Cross-instance record leakage | Information Disclosure | Filter dynamic table operations by `instance_id = config.instance.id`. [VERIFIED: `src/mcp/tools/records.ts`; VERIFIED: `tests/integration/plugin-records.integration.test.ts`] |
| Caller overwrites generated/system fields | Tampering | Reject generated/implicit/reconciliation/embedding fields before insert/update. [CITED: MCP Tool Consolidation Requirements §4.27] |
| Expected validation error treated as runtime failure | Repudiation/DoS | Return canonical JSON expected errors with `isError:false`. [VERIFIED: `src/mcp/utils/response-formats.ts`; CITED: MCP Tool Consolidation Requirements XC-5] |
| Plugin unregistration destroys live data unexpectedly | Tampering | Conflict on live records unless `force:true`; forced unregister warns about orphaned records. [CITED: MCP Tool Consolidation Requirements §4.25] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/126-plugin-record-consolidation/126-CONTEXT.md` — phase boundary, locked decisions, mandatory downstream docs. [VERIFIED]
- `.planning/REQUIREMENTS.md` — REC-01 through REC-07 and v3.3 traceability. [VERIFIED]
- `.planning/ROADMAP.md` — Phase 126 dependency and success criteria. [VERIFIED]
- `.planning/STATE.md` — Phase 125 completion baseline and v3.3 milestone constraints. [VERIFIED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md` — §2 cross-cutting decisions and §4.24-§4.32 plugin/record contracts. [CITED]
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md` — §4.4, §5.3, §7, §8 verification and migration contracts. [CITED]
- `src/mcp/tools/plugins.ts`, `src/mcp/tools/records.ts`, `src/mcp/tools/pending-review.ts`, `src/mcp/utils/response-formats.ts`, `src/plugins/manager.ts`, `src/mcp/tool-metadata.ts` — live implementation state. [VERIFIED]
- Context7 `/modelcontextprotocol/typescript-sdk` — `registerTool`, `CallToolResult`, `isError` semantics. [CITED]

### Secondary (MEDIUM confidence)

- `.planning/phases/125-unified-search-memory-consolidation/125-RESEARCH.md` and `125-PATTERNS.md` — prior phase planning patterns and helper/test conventions. [VERIFIED]
- `.agents/skills/*` and `tests/scenarios/*/README.md` — local scenario authoring and runner conventions. [VERIFIED]

### Tertiary (LOW confidence)

- None used for implementation claims. [VERIFIED: all major claims sourced above]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from `package.json`, npm registry, AGENTS.md, and Context7. [VERIFIED]
- Architecture: HIGH — verified from live source and product docs. [VERIFIED; CITED]
- Pitfalls: HIGH — derived from current code/product contract mismatches and existing scenario ledgers. [VERIFIED; CITED]

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 for codebase-local planning; re-check npm/SDK docs if dependency upgrades become in-scope. [ASSUMED]
