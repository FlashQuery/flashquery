# Phase 126: Plugin + Record Consolidation - Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 19 new/modified files
**Analogs found:** 19 / 19

## Mandatory Product Contract

Downstream implementation, review, and verification agents MUST read these two product docs before making requirement or test-scope decisions:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`

Treat `.planning/ROADMAP.md` as the phase boundary and the two product docs above as the detailed contract inside that boundary.

## Phase 125 Gap-Fix Compatibility Note

Reviewed after the Phase 125 post-implementation gap fixes. The current dirty codebase includes Phase 125 fixes in:

- `src/mcp/tools/compound.ts` — `get_briefing` now points callers to final `search` rather than legacy `search_all`.
- `src/mcp/tools/memory.ts` — `write_memory(mode:"update")` maps transactional non-latest races to canonical `conflict` and missing-row races to canonical `not_found`; legacy descriptions now point to final `search`; `archive_memory` handles empty batches and fetches the memory chain once per request.
- `tests/unit/write-memory.test.ts` — adds regression coverage for those transactional `write_memory` expected-error envelopes.

Impact on Phase 126 plans: no plan changes are required because Phase 126 modifies plugin/record/pending-review files, not search/memory handlers. Downstream implementers should still use these Phase 125 fixes as stronger analogs for expected-error mapping and final-tool description wording:

- Record write race/validation failures should return `jsonExpectedError` with `isError:false`, mirroring the fixed `write_memory` behavior.
- Plugin/record descriptions should point to final tools (`search`, `write_record`, `clear_pending_reviews(action)`) and should not mention removed legacy names as preferred paths.
- Batch-capable handlers should explicitly handle empty arrays where the product contract permits them; for Phase 126, keep `archive_record.targets` array-only per the locked contract.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/phases/126-plugin-record-consolidation/TRACEABILITY.md` | config | transform | `.planning/phases/125-unified-search-memory-consolidation/TRACEABILITY.md` | role-match |
| `src/mcp/utils/record-output.ts` | utility | transform | `src/mcp/utils/memory-output.ts` | exact |
| `src/mcp/utils/record-validation.ts` | utility | transform | `src/mcp/utils/document-write.ts` + `src/mcp/tools/memory.ts` validation helpers | exact |
| `src/mcp/utils/response-formats.ts` | utility | transform | existing same file | exact |
| `src/mcp/tools/plugins.ts` | route/controller | request-response + CRUD | existing same file + `src/mcp/tools/memory.ts` JSON migration | exact |
| `src/mcp/tools/records.ts` | route/controller | CRUD + request-response + event-driven reconciliation | existing same file + `src/mcp/tools/memory.ts` write consolidation | exact |
| `src/mcp/tools/pending-review.ts` | route/controller | CRUD + request-response | existing same file + `src/mcp/tools/memory.ts` JSON expected-error handling | exact |
| `src/mcp/tool-metadata.ts` | config | transform | existing same file, `write_memory` metadata entry | exact |
| `tests/unit/write-record.test.ts` | test | request-response | `tests/unit/write-memory.test.ts` + `tests/unit/record-tools.test.ts` | exact |
| `tests/unit/record-tools.test.ts` | test | CRUD + request-response | existing same file | exact |
| `tests/unit/plugin-tools.test.ts` | test | CRUD + request-response | existing same file | exact |
| `tests/unit/pending-plugin-review.test.ts` | test | CRUD + request-response | existing same file | exact |
| `tests/unit/response-formats.test.ts` | test | transform | existing same file | exact |
| `tests/integration/write-record.integration.test.ts` | test | CRUD + request-response | `tests/integration/write-memory.integration.test.ts` + `tests/integration/plugin-records.integration.test.ts` | exact |
| `tests/integration/plugin-records.integration.test.ts` | test | CRUD + request-response | existing same file | exact |
| `tests/integration/plugin-reconciliation.integration.test.ts` | test | event-driven + CRUD | existing same file | exact |
| `tests/e2e/protocol.test.ts` | test | request-response | existing `write_memory` / `write_document` E2E blocks | exact |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | test config | transform | existing plugin coverage rows | exact |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` and `tests/scenarios/integration/tests/*.yml` | test config | batch + request-response | existing IR/IF plugin scenario rows and YAML tests | exact |

## Pattern Assignments

### `src/mcp/utils/record-output.ts` (utility, transform)

**Analog:** `src/mcp/utils/memory-output.ts`

**Imports pattern** (lines 1-8):
```typescript
import {
  batchResult,
  jsonExpectedError,
  memoryIdentification,
  type ErrorEnvelope,
  type MemoryIdentificationInput,
  type ToolResult,
} from './response-formats.js';
```

**Core output builder pattern** (lines 44-70):
```typescript
export function buildMemoryResult(row: MemoryRow, include?: MemoryInclude[]): MemoryResult {
  const result: MemoryResult = {
    ...memoryIdentification({
      memory_id: row.id,
      content_preview: buildContentPreview(row.content),
      tags,
      plugin_scope: row.plugin_scope ?? 'global',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
    version: row.version ?? null,
  };

  const effectiveInclude = normalizeMemoryInclude(include);
  if (effectiveInclude.includes('content')) {
    result.content = row.content;
  }
  return result;
}
```

**Apply to Phase 126:** Create record helpers that wrap `recordIdentification(...)`, normalize `include: ["data", "schema_metadata"]`, omit generated/internal fields from `data`, and build ordered batch arrays for `archive_record.targets`.

### `src/mcp/utils/record-validation.ts` (utility, transform)

**Analogs:** `src/mcp/utils/document-write.ts`, `src/mcp/tools/memory.ts`

**Explicit mode validation pattern** from `document-write.ts` (lines 25-39):
```typescript
export function validateWriteDocumentInput(input: WriteDocumentInput): ErrorEnvelope | null {
  if (input.mode === undefined) {
    return {
      error: 'invalid_input',
      message: 'mode is required; use mode: "create" or mode: "update"',
    };
  }

  if (input.mode !== 'create' && input.mode !== 'update') {
    return {
      error: 'invalid_input',
      message: 'mode must be "create" or "update"',
      details: { field: 'mode', value: input.mode },
    };
  }
}
```

**Generated-field rejection pattern** from `memory.ts` (lines 38-52, 91-99):
```typescript
const generatedMemoryFields = new Set([
  'id',
  'memory_id',
  'version',
  'previous_version_id',
  'is_latest',
  'archived_at',
  'created_at',
  'updated_at',
  'status',
  'embedding',
]);

function expectedInvalidInput(message: string, details?: Record<string, unknown>) {
  return jsonExpectedError({ error: 'invalid_input', message, ...(details ? { details } : {}) });
}
```

**Apply to Phase 126:** Validate `write_record(mode)` before DB mutation. Create mode requires schema-required fields, rejects `id`, generated fields, and unknown fields. Update mode requires `(plugin_id, table, id)` and partial `data`, while still rejecting generated/unknown fields.

### `src/mcp/utils/response-formats.ts` (utility, transform)

**Analog:** existing same file

**JSON helper pattern** (lines 85-122):
```typescript
export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}

export function withWarnings<T extends Record<string, unknown>>(
  payload: T,
  warnings: WarningCode[]
): T & { warnings?: WarningCode[] } {
  if (warnings.length === 0) {
    return payload;
  }
  return { ...payload, warnings };
}
```

**Record/plugin identification pattern** (lines 169-185):
```typescript
export function recordIdentification(input: RecordIdentificationInput): RecordIdentificationInput {
  return {
    id: input.id,
    plugin_id: input.plugin_id,
    table: input.table,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

export function pluginIdentification(input: PluginIdentificationInput): PluginIdentificationInput {
  return {
    plugin_id: input.plugin_id,
    name: input.name,
    status: input.status,
    table_count: input.table_count,
  };
}
```

**Apply to Phase 126:** Use `jsonToolResult`, `jsonExpectedError`, `jsonRuntimeError`, `recordIdentification`, `pluginIdentification`, and `withWarnings`; do not hand-roll JSON strings or prose responses.

### `src/mcp/tools/plugins.ts` (route/controller, request-response + CRUD)

**Analog:** existing same file

**Imports and project conventions** (lines 1-20):
```typescript
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
import {
  pluginManager,
  parsePluginSchema,
  buildPluginTableDDL,
  resolveTableName,
  validateInstanceName,
  buildGlobalTypeRegistry,
} from '../../plugins/manager.js';
```

**Registration/upsert and DDL pattern** (lines 77-89, 264-303):
```typescript
const schema = parsePluginSchema(rawYaml);
const tablePrefix = `fqcp_${schema.plugin.id}_${instanceName}_`;

const { data: existing, error: selectError } = await supabase
  .from('fqc_plugin_registry')
  .select('id, schema_version')
  .eq('plugin_id', schema.plugin.id)
  .eq('plugin_instance', instanceName)
  .eq('instance_id', config.instance.id)
  .maybeSingle();

for (const table of schema.tables) {
  const fullTableName = resolveTableName(schema.plugin.id, instanceName, table.name);
  const ddl = buildPluginTableDDL(fullTableName, table, getEmbeddingDimensions(config));
  await pgClient.query(ddl);
  createdTables.push(fullTableName);
}
```

**Unregister cleanup pattern** (lines 645-669):
```typescript
await supabase
  .from('fqc_pending_plugin_review')
  .delete()
  .eq('plugin_id', plugin_id)
  .eq('instance_id', config.instance.id);

await supabase
  .from('fqc_plugin_registry')
  .delete()
  .eq('plugin_id', plugin_id)
  .eq('plugin_instance', instanceName)
  .eq('instance_id', config.instance.id);

pluginManager.removeEntry(plugin_id, instanceName);
```

**Required contract overlay:** Product Requirements lines 1453-1472 require `register_plugin`, `unregister_plugin`, and `get_plugin_info` to return plugin identification JSON envelopes with `was_new`, `unregistered_at`, `force`, and `include` semantics. Keep the DDL/upsert/cleanup logic above, but replace prose/error output with response helpers.

### `src/mcp/tools/records.ts` (route/controller, CRUD + reconciliation)

**Analog:** existing same file plus `write_memory`

**Imports and table resolution pattern** (lines 1-17, 23-40):
```typescript
import { z } from 'zod';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pluginManager, resolveTableName } from '../../plugins/manager.js';
import type { PluginTableSpec, RegistryEntry } from '../../plugins/manager.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';

function resolveAndValidateTable(
  pluginId: string,
  instanceName: string,
  tableName: string
): { fullTableName: string; tableSpec: PluginTableSpec; entry: RegistryEntry } {
  const result = pluginManager.getTableSpec(pluginId, instanceName, tableName);
  if (!result) {
    throw new Error(`Plugin '${pluginId}' instance '${instanceName}' table '${tableName}' not found`);
  }
  const fullTableName = resolveTableName(pluginId, instanceName, tableName);
  if (!fullTableName.startsWith('fqcp_')) {
    throw new Error('Invalid table name - must start with fqcp_');
  }
  return { fullTableName, ...result };
}
```

**Current create/update DB patterns to preserve** (lines 174-195, 358-382):
```typescript
const { data, error } = await supabase
  .from(fullTableName)
  .insert({ ...fields, instance_id: config.instance.id })
  .select('id')
  .single();

if (tableSpec.embed_fields && tableSpec.embed_fields.length > 0) {
  fireAndForgetEmbed(fullTableName, data.id as string, fields, tableSpec.embed_fields, config.supabase.databaseUrl);
}

const updateResult = (await supabase
  .from(fullTableName)
  .update({ ...fields, updated_at: new Date().toISOString() })
  .eq('id', id)
  .eq('instance_id', config.instance.id)
  .select('*')
  .single()) as { data: Record<string, unknown> | null; error: { message: string } | null };
```

**Search patterns to preserve** (lines 571-610, 613-666, 707-751):
```typescript
if (!hasQuery) {
  let qb = supabase
    .from(fullTableName)
    .select('*')
    .eq('instance_id', config.instance.id)
    .eq('status', 'active');
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      qb = qb.eq(key, value);
    }
  }
  const { data, error } = await qb.limit(maxResults);
}

const sql = `
  SELECT *, 1 - (embedding <=> $1::vector) AS similarity
  FROM ${escapedTable}
  WHERE instance_id = $2
    AND status = 'active'
    AND embedding IS NOT NULL
    ${filterSql}
  ORDER BY embedding <=> $1::vector
  LIMIT $3
`;
```

**Write consolidation analog** from `memory.ts` (lines 156-179, 206-243, 246-312):
```typescript
server.registerTool(
  'write_memory',
  {
    inputSchema: {
      mode: z.enum(['create', 'update']).describe('Memory write mode: create or update'),
      include: z.array(z.enum(['content', 'tags_full'])).optional(),
    },
  },
  async (params: MemoryToolParams) => {
    const validationError = validateWriteMemoryInput(params);
    if (validationError) return validationError;
    const include = parseMemoryInclude(params.include);
    ...
    return jsonToolResult(buildMemoryResult(row, include));
  }
);
```

**Required contract overlay:** Product Requirements lines 1474-1537 and Test Plan lines 291-341 define the `write_record`, `get_record`, `archive_record`, and `search_records` contracts. Preserve dynamic table resolution, embeddings, instance scoping, reconciliation preamble, and pg cleanup, but return JSON envelopes and expected-error envelopes.

### `src/mcp/tools/pending-review.ts` (route/controller, CRUD + request-response)

**Analog:** existing same file

**Current query/clear flow** (lines 17-30, 52-74):
```typescript
inputSchema: {
  plugin_id: z.string().describe('Plugin identifier'),
  plugin_instance: z.string().optional().default('default'),
  fqc_ids: z.array(z.string()).default([]),
},
...
if (fqc_ids.length > 0) {
  await supabase
    .from('fqc_pending_plugin_review')
    .delete()
    .eq('plugin_id', plugin_id)
    .eq('instance_id', fqcInstanceId)
    .in('fqc_id', fqc_ids);
}

const { data, error } = await supabase
  .from('fqc_pending_plugin_review')
  .select('fqc_id, table_name, review_type, context')
  .eq('plugin_id', plugin_id)
  .eq('instance_id', fqcInstanceId);
```

**Required contract overlay:** Product Requirements lines 1539-1546 require `action: "list" | "clear"`, `ids` as pending-review row IDs, `pending/items` and `cleared/items` envelopes, and `warnings:["no_matching_items"]` for nonexistent ids. Update the select list to include row `id` and return JSON via response helpers.

### `src/mcp/tool-metadata.ts` (config, transform)

**Analog:** existing same file

**Description template and final tool entries** (lines 86-88, 151-162, 221-239):
```typescript
function description(summary: string, useWhen: string, doNotUseWhen: string, example: string): string {
  return `Summary: ${summary}\nUse when: ${useWhen}\nDo not use when: ${doNotUseWhen}\nExample: ${example}`;
}

writeRecord: description(
  'Create or update plugin records through one explicit mode-based record writer.',
  'Use when you need to insert or change structured data owned by a registered plugin.',
  'Do not use when you need plugin metadata or record retrieval; use get_plugin_info or get_record instead.',
  'write_record({ "mode": "create", "plugin_id": "crm", "table": "contacts", "data": {} })'
),

current('create_record', ['plugin'], 'read-write', legacyDescription('create_record', 'write_record', ...)),
future('write_record', ['plugin'], 'read-write', D.writeRecord),
```

**Apply to Phase 126:** Promote `write_record` to current/final and update plugin/record descriptions using the literal product descriptions. Keep broad final absence/removal audit scoped to Phase 128 unless this phase explicitly ports the relevant coverage.

## Test Pattern Assignments

### Unit Tests

**Analog:** `tests/unit/record-tools.test.ts`

**Handler registration pattern** (lines 247-262):
```typescript
const config = makeConfig();
const { server } = createMockServer();
registerRecordTools(server, config);

const registerTool = vi.mocked(server.registerTool);
expect(registerTool).toHaveBeenCalledTimes(5);

const names = registerTool.mock.calls.map(call => call[0]);
expect(names).toContain('create_record');
expect(names).toContain('get_record');
expect(names).toContain('update_record');
expect(names).toContain('archive_record');
expect(names).toContain('search_records');
```

**Record write behavior pattern** (lines 277-314):
```typescript
vi.mocked(pluginManager.getTableSpec).mockReturnValue(TABLE_SPEC_NO_EMBED);
const { mockInsert } = makeSupabaseMock({ insertData: { id: 'rec-id' } });

const handler = getHandler('create_record');
await handler({
  plugin_id: 'crm',
  table: 'tasks',
  fields: { title: 'Test Task' },
});

expect(mockInsert).toHaveBeenCalledWith(
  expect.objectContaining({ instance_id: 'test-instance-id' })
);
```

**Reconciliation side-effect pattern** (lines 961-974, 1003-1023):
```typescript
await handler({ plugin_id: 'crm', table: 'tasks', fields: {} });

expect(reconcilePluginDocuments).toHaveBeenCalledWith('crm', 'default', expect.any(String));
expect(executeReconciliationActions).toHaveBeenCalled();

mockReconcilePluginDocuments.mockRejectedValueOnce(new Error('DB connection lost'));
const result = await handler({ plugin_id: 'crm', table: 'tasks', fields: {} });
expect(result.isError).toBeUndefined();
expect(result.content[0].text).toContain('Reconciliation warning');
```

**Phase 126 adjustment:** Existing tests assert prose and `isError:true` for expected errors. New tests should parse `result.content[0].text` as JSON and expect `jsonExpectedError` semantics (`isError:false`) for validation/not-found/conflict.

### Integration Tests

**Analog:** `tests/integration/plugin-records.integration.test.ts`, `tests/integration/plugin-reconciliation.integration.test.ts`

**Plugin/record registration pattern** (from `plugin-records.integration.test.ts` lines 47-48, 200-208):
```typescript
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';

registerPluginTools(server, config);
const result = await getHandler('register_plugin')({
  schema_yaml: TEST_PLUGIN_SCHEMA,
});
```

**Scenario under test:** Port existing `create_record` and `update_record` assertions into `write_record(mode:"create"|"update")`; add schema validation, include gates, and structured side-effect assertions.

### E2E Protocol Tests

**Analog:** `tests/e2e/protocol.test.ts`

**JSON round-trip pattern** (lines 184-256):
```typescript
const createResult = await client.callTool({
  name: 'write_memory',
  arguments: {
    mode: 'create',
    content: 'Phase 125 protocol memory about durable JSON search.',
    tags: ['phase125-e2e'],
    include: ['content'],
  },
});

expect(createResult.isError).toBeFalsy();
const created = JSON.parse(getText(createResult));
expect(created).toMatchObject({
  memory_id: expect.any(String),
  content: 'Phase 125 protocol memory about durable JSON search.',
  is_latest: true,
});
```

**Apply to Phase 126:** Add protocol round trips for `register_plugin`, `write_record(create)`, `write_record(update, include:["data"])`, `get_record`, `archive_record`, `search_records`, and `clear_pending_reviews(action:"list"|"clear")` as required by Test Plan lines 318-324 and 601-607.

### Scenario Coverage

**Directed analog:** `tests/scenarios/directed/DIRECTED_COVERAGE.md` plugin rows (lines 237-257)
```markdown
| P-01 | Register plugin from YAML schema (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-05-07 |
| P-04 | Create record in plugin table (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-05-07 |
| P-06 | Update record changes only specified fields (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-05-07 |
| P-10 | Archived record excluded from search_records (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-05-07 |
```

**Integration analog:** `tests/scenarios/integration/INTEGRATION_COVERAGE.md` reconciliation rows (lines 136-150)
```markdown
| IR-03 | Auto-track + pending template review + clear -> subsequent tool responses show no pending items (VALIDATED) | ir03_plugin_autotrack_pending_clear | 2026-05-07 | 2026-05-07 |
| IR-10 | Large pending review backlog processable incrementally - subset cleared per invocation, remainder stable (VALIDATED) | ir10_plugin_incremental_pending_review | 2026-05-07 | 2026-05-07 |
| IR-12 | Pending review items appear in record tool response even when reconciliation staleness check skips diff (VALIDATED) | ir12_plugin_pending_review_staleness | 2026-05-07 | 2026-05-07 |
```

**Apply to Phase 126:** Update coverage ledgers before scenario files when changing expected public behavior. Port `create_record`/`update_record` scenario expectations to `write_record`, and update pending review scenarios to use `action` plus pending-review row `ids`.

## Shared Patterns

### Product Contract and Traceability

**Source:** `126-CONTEXT.md`; product docs cited above.

First implementation task must instantiate a phase-local traceability table mapping `REC-01` through `REC-07` to unit, integration, E2E, directed scenario, and integration scenario evidence. The Test Plan traceability row for `write_record` points to `tests/unit/write-record.test.ts`, `tests/integration/write-record.integration.test.ts`, a write/get record E2E round trip, `D-wrec-*`, and `INT-wrec-*`.

### Expected Error Handling

**Source:** `src/mcp/utils/response-formats.ts` lines 85-112

Expected validation/not-found/conflict/unsupported outcomes use `jsonExpectedError(...)` and `isError:false`. Unexpected DB/FS/runtime failures use `jsonRuntimeError(...)` or equivalent `isError:true`.

### Plugin Table Resolution

**Source:** `src/mcp/tools/records.ts` lines 23-40

All record tools resolve `(plugin_id, plugin_instance ?? "default", table)` through `pluginManager.getTableSpec(...)` and `resolveTableName(...)`; keep the `fqcp_` prefix guard before any dynamic table DB access.

### Reconciliation Side Effects

**Source:** `src/mcp/tools/records.ts` lines 153-166, 247-260, 338-350, 447-459, 547-559

Current record tools run `reconcilePluginDocuments(...)` then `executeReconciliationActions(...)` before core operations and treat reconciliation failure as non-fatal. Phase 126 must convert summaries/warnings into structured `reconciliation` and `pending_review` fields only when non-empty, and must not expose scanner/index sync internals.

### Locking

**Source:** `src/mcp/tools/records.ts` lines 139-151, 323-335, 432-444, 532-544; `src/mcp/tools/memory.ts` lines 188-203

Write tools acquire the configured write lock before mutation. New expected lock contention should return a canonical `conflict` envelope with `details.reason: "lock_contention"` instead of prose runtime failure when the product contract classifies it as expected.

### Metadata

**Source:** `src/mcp/tool-metadata.ts` lines 86-88, 151-162, 221-239

Descriptions use the four-block `description(summary, useWhen, doNotUseWhen, example)` shape. Promote `write_record` and update plugin/record tool descriptions in metadata alongside handler behavior.

## No Analog Found

None. Every planned source, helper, test, and scenario-ledger change has a close existing analog in the codebase.

## Metadata

**Analog search scope:** `src/mcp/tools`, `src/mcp/utils`, `src/plugins`, `src/services`, `tests/unit`, `tests/integration`, `tests/e2e`, `tests/scenarios`, prior phase artifacts 124-125.
**Files scanned:** 120+ paths by `rg --files`; 19 target files classified.
**Pattern extraction date:** 2026-05-12
