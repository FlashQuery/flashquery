# Phase 152: Type-Safety Cleanup Pass - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 17
**Analogs found:** 17 / 17

## Mandatory Source Order

Downstream implementation and verification agents MUST read these external docs first for any Phase 152 question, then local planning docs:

1. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Requirements.md` - authoritative spec, Phase 152 scope is Spec Section 6.2 / REQ-006 through REQ-008.
2. `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Remaining Remediation Requirements pt2/Codebase Audit Remaining Remediation Test Plan.md` - authoritative test plan, Phase 152 scope is Test Plan Section 4.2.
3. `.planning/phases/152-type-safety-cleanup-pass/152-CONTEXT.md`
4. `.planning/ROADMAP.md`
5. `.planning/REQUIREMENTS.md`

Phase 152 is only REQ-006, REQ-007, and REQ-008. Do not include Phase 153 / REQ-009 document-tool decomposition.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/mcp/utils/document-output.ts` | utility | transform | `src/mcp/utils/document-output.ts` | exact |
| `src/services/scanner.ts` | service | file-I/O + CRUD | `src/services/scanner.ts` | exact |
| `src/mcp/tools/llm-usage.ts` | controller | request-response + transform | `src/mcp/tools/llm-usage.ts` | exact |
| `src/mcp/tools/records.ts` | controller | request-response + CRUD | `src/mcp/tools/records.ts` | exact |
| `tests/unit/codebase-audit-remaining-remediation.test.ts` | test | static-guard | `tests/unit/codebase-audit-remaining-remediation.test.ts` | exact |
| `tests/unit/scanner.test.ts` | test | file-I/O + CRUD | `tests/unit/scanner.test.ts` | exact |
| `tests/unit/llm-usage-tool.test.ts` | test | request-response + transform | `tests/unit/llm-usage-tool.test.ts` | exact |
| `tests/unit/record-tools.test.ts` | test | request-response + CRUD | `tests/unit/llm-usage-tool.test.ts` | role-match |
| `tests/integration/services/scanner-embed-drain.test.ts` | test | file-I/O + CRUD | `tests/unit/scanner.test.ts` | role-match |
| `tests/integration/tools-response-format.test.ts` | test | request-response | `tests/integration/tools-response-format.test.ts` | exact |
| `tests/integration/documents.integration.test.ts` | test | request-response + file-I/O | `tests/unit/document-output.test.ts` | role-match |
| `tests/integration/write-record.integration.test.ts` | test | request-response + CRUD | `tests/integration/write-record.integration.test.ts` | exact |
| `tests/scenarios/directed/testcases/test_get_llm_usage_by_purpose.py` | test | request-response scenario | `tests/scenarios/directed/testcases/test_get_llm_usage_by_purpose.py` | exact |
| `tests/scenarios/directed/testcases/test_get_llm_usage_by_model.py` | test | request-response scenario | `tests/scenarios/directed/testcases/test_get_llm_usage_by_model.py` | exact |
| `tests/scenarios/integration/tests/llm_by_purpose_mode.yml` | test | request-response scenario | `tests/scenarios/integration/tests/llm_by_purpose_mode.yml` | exact |
| `tests/scenarios/integration/tests/llm_by_model_mode.yml` | test | request-response scenario | `tests/scenarios/integration/tests/llm_by_model_mode.yml` | exact |
| `tests/scenarios/integration/tests/plugin_record_consolidation.yml` | test | request-response + CRUD scenario | `tests/scenarios/integration/tests/plugin_record_consolidation.yml` | exact |

## Pattern Assignments

### `src/mcp/utils/document-output.ts` (utility, transform)

**Analog:** `src/mcp/utils/document-output.ts`

**Imports and local interface pattern** (lines 16-24, 62-72):
```typescript
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FM } from '../../constants/frontmatter-fields.js';
import { DocumentReadError, resolveDocumentIdentifier, targetedScan } from './document-resolver-primitives.js';
import type { ErrorEnvelope } from './response-formats.js';
import { extractHeadings } from './markdown-utils.js';

export interface DocumentEnvelope {
  identifier: string;
  title: string;
  path: string;
  fq_id: string;
  modified: string;
  size: { chars: number };
  body?: string;
  extracted_sections?: Array<{ heading: string; chars: number }>;
  frontmatter?: Record<string, unknown>;
  headings?: Array<{ level: number; text: string; chars: number }>;
}
```

**Core return typing pattern** (lines 215-247):
```typescript
export function buildConsolidatedResponse(
  envelope: {
    identifier: string;
    title: string;
    path: string;
    fq_id: string;
    modified: string;
    size: { chars: number };
  },
  include: Array<'body' | 'frontmatter' | 'headings'>,
  options: {
    body?: string;
    extractedSections?: Array<{ heading: string; chars: number }>;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{ level: number; text: string; chars: number }>;
  }
): DocumentEnvelope {
  const effectiveInclude = include && include.length > 0 ? include : ['body' as const];
  const result: DocumentEnvelope = { ...envelope };
  if (effectiveInclude.includes('body') && options.body !== undefined) {
    result.body = options.body;
    if (options.extractedSections !== undefined) {
      result.extracted_sections = options.extractedSections;
    }
  }
  return result;
}
```

**Site to replace** (lines 699-704): remove the cast by making the callee/caller return type accept the structured envelope shape.
```typescript
return buildConsolidatedResponse(envelope, [...effectiveInclude], {
  body: responseBody,
  extractedSections,
  frontmatter: frontmatterField,
  headings: headingsField,
}) as unknown as Record<string, unknown>;
```

**Regression test pattern:** `tests/unit/document-output.test.ts` lines 306-324 asserts optional fields and envelope fields are preserved.

### `src/services/scanner.ts` (service, file-I/O + CRUD)

**Analog:** `src/services/scanner.ts`

**Imports and row/service structure** (lines 1-22, 34-42):
```typescript
import { basename, dirname, extname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { Mutex } from 'async-mutex';
import matter from 'gray-matter';
import pg from 'pg';
import { createPgClientIPv4 } from '../utils/pg-client.js';
import { vaultManager } from '../storage/vault.js';
import { logger } from '../logging/logger.js';
import { listMarkdownFiles, computeHash } from '../storage/document-primitives.js';

export interface ScanResult {
  hashMismatches: number;
  statusMismatches: number;
  newFiles: number;
  movedFiles: number;
  deletedFiles: number;
  embeddingStatus: 'complete' | 'partial' | 'timed_out' | 'skipped' | 'drain_query_failed';
  embedsAwaited: number;
}
```

**Supabase select pattern without Promise double assertion** (lines 86-97):
```typescript
const { data: rows, error: fetchError } = await supabase
  .from('fqc_documents')
  .select('id, path, title, status')
  .eq('instance_id', instanceId)
  .neq('status', 'archived');

if (fetchError) {
  throw new Error(`document reconciliation query failed: ${fetchError.message}`);
}

const activeRows = (rows ?? []) as Array<{ id: string; path: string; title: string | null; status: string | null }>;
```

**REQ-006 sites to replace** (lines 301-305, 379-383):
```typescript
const { data: allDbDocs, error: dbDocsError } = await (supabase
  .from('fqc_documents')
  .select('id, path, content_hash, title, status, updated_at, template_meta')
  .eq('instance_id', instanceId)
  .in('status', ['active', 'missing']) as unknown as Promise<{ data: DbRow[] | null; error: unknown }>);

const { data: archivedDocs } = await (supabase
  .from('fqc_documents')
  .select('id, path, content_hash, status, updated_at, template_meta')
  .eq('instance_id', instanceId)
  .eq('status', 'archived') as unknown as Promise<{ data: DbRow[] | null; error: unknown }>);
```

**Map/dedup flow to preserve** (lines 307-359): build `hashToRow`, `idToRow`, and `pathToRow`; keep newer duplicate rows by `updated_at`; preserve `template_meta`.

**Error/logging pattern** (lines 366-374):
```typescript
const { error: archiveErr } = await supabase
  .from('fqc_documents')
  .update({ status: 'archived', updated_at: now })
  .eq('id', archiveId);
if (archiveErr) {
  logger.warn(`[INF-02] failed to archive duplicate row id=${archiveId}: ${archiveErr.message}`);
} else {
  logger.info(`[INF-02] archived older duplicate row id=${archiveId}`);
}
```

**Typed raw-query analog if Supabase builder typing is impractical:** `src/services/plugin-reconciliation.ts` lines 641-649 uses `pgClient.query<FqcDocRow>(sql, params)` and handles errors without broad casts.

### `src/mcp/tools/llm-usage.ts` (controller, request-response + transform)

**Analog:** `src/mcp/tools/llm-usage.ts`

**Imports and row type pattern** (lines 30-56):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { supabaseManager } from '../../storage/supabase.js';

interface UsageRow {
  id: string;
  instance_id: string;
  purpose_name: string;
  model_name: string;
  provider_name: string;
  input_tokens: string | number;
  output_tokens: string | number;
  cost_usd: string | number;
  latency_ms: number;
  fallback_position: number | null;
  trace_id: string | null;
  created_at: string;
}
```

**Current query helper surface to type narrowly** (lines 149-181):
```typescript
async function fetchRows(
  supabase: any,
  instanceId: string,
  window: ResolvedWindow | null,
  filters: { purpose_name?: string; model_name?: string; trace_id?: string },
  options?: { orderDescByCreatedAt?: boolean; limit?: number; omitUpperBound?: boolean }
): Promise<{ rows: UsageRow[]; error: { message: string } | null }> {
  let query = supabase
    .from('fqc_llm_usage')
    .select('*')
    .eq('instance_id', instanceId);

  if (window) {
    query = query.gte('created_at', window.from.toISOString());
    if (!options?.omitUpperBound) {
      query = query.lte('created_at', window.to.toISOString());
    }
  }
  query = applyEntityFilters(query, filters);

  if (options?.orderDescByCreatedAt) {
    query = query.order('created_at', { ascending: false });
  }
  if (options?.limit !== undefined) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) return { rows: [], error };
  return { rows: (data as UsageRow[] | null) ?? [], error: null };
}
```

Replacement should define local structural interfaces for `from`, `select`, `eq`, `gte`, `lte`, `order`, `limit`, and the awaited result, then remove the broad block-level eslint disables around `applyEntityFilters` and `fetchRows`.

**Grouping pattern to fix** (lines 272-281, 328-337):
```typescript
const purposeGroups = new Map<string, UsageRow[]>();
for (const r of rows) {
  if (r.purpose_name === '_direct') {
    directRows.push(r);
  } else {
    if (!purposeGroups.has(r.purpose_name)) purposeGroups.set(r.purpose_name, []);
    purposeGroups.get(r.purpose_name)!.push(r);
  }
}
```

Replace with a helper such as `getOrCreateGroup(map, key).push(row)` to avoid non-null assertions while preserving by-purpose `_direct` separation and by-model composite keys.

**Handler error pattern** (lines 544-554):
```typescript
const { rows, error } = await fetchRows(
  supabase,
  config.instance.id,
  window,
  filters,
  fetchOptions,
);
if (error) {
  logger.warn(`get_llm_usage query failed: ${error.message}`);
  return { content: [{ type: 'text' as const, text: error.message }], isError: true };
}
```

### `src/mcp/tools/records.ts` (controller, request-response + CRUD)

**Analog:** `src/mcp/tools/records.ts`

**Imports and response helpers** (lines 1-29):
```typescript
import { z } from 'zod';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pluginManager, resolveTableName } from '../../plugins/manager.js';
import type { PluginTableSpec, RegistryEntry } from '../../plugins/manager.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { queryPgPool } from '../../utils/pg-client.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  withWarnings,
} from '../utils/response-formats.js';
```

**Filters-only path to instrument** (lines 701-727):
```typescript
const supabase = supabaseManager.getClient();
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
if (error) {
  return jsonRuntimeError(error.message);
}

const rows = asRecordRows(data);
logger.info(
  `search_records: filters-only found ${rows.length} record(s) in ${fullTableName}`
);
return jsonToolResult(buildSearchEnvelope({ plugin_id, table, query, tag, rows, include: effectiveInclude, tableSpec, reconciliation }));
```

Add timing around the awaited DB query and log safe metadata on both success and failure: path (`filters-only`), table name, row count when available, and elapsed ms. Do not log raw rows, query text, or vectors.

**Semantic path to instrument** (lines 729-765):
```typescript
const queryEmbedding = await embeddingProvider.embed(queryText);
const escapedTable = pg.escapeIdentifier(fullTableName);
const params: unknown[] = [
  `[${queryEmbedding.join(',')}]`,
  config.instance.id,
  maxResults,
];
const result = await queryPgPool(config.supabase.databaseUrl, sql, params);
const rows = asRecordRows(result.rows);
logger.info(
  `search_records: semantic found ${rows.length} record(s) in ${fullTableName}`
);
return jsonToolResult(buildSearchEnvelope({ plugin_id, table, query, tag, rows, include: effectiveInclude, tableSpec, semantic: true, reconciliation }));
```

Instrument only the vector SQL query path, not the embedding call, unless the source docs explicitly say otherwise. Log `semantic` path, table, row count, elapsed ms on success and failure. The existing `catch` at lines 820-823 converts failures to `jsonRuntimeError`.

**Timing/log style analog:** `src/git/manager.ts` lines 185-192:
```typescript
const startTime = performance.now();
...
const duration = Math.round(performance.now() - startTime);
logger.debug(`Git: committed "${message}" (${duration}ms) — maintaining version history`);
```

### `tests/unit/codebase-audit-remaining-remediation.test.ts` (test, static-guard)

**Analog:** `tests/unit/codebase-audit-remaining-remediation.test.ts`

**Static source read helpers** (lines 1-19):
```typescript
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}
```

**Guard assertion pattern** (lines 21-30, 46-48):
```typescript
describe('codebase audit remaining remediation guards', () => {
  it('T-U-007: plugin reconciliation no longer casts VaultManager to private rootPath', () => {
    const source = read('src/services/plugin-reconciliation.ts');
    expect(source).not.toContain('vaultManager as unknown as { rootPath: string }');
    expect(source).not.toMatch(/rootPath/);
  });

  it('T-U-011: git backup cleanup no longer swallows pg close failures', () => {
    expect(read('src/git/manager.ts')).not.toContain('.catch(() => {})');
  });
});
```

Add T-U-016 through T-U-020 and T-U-025 with exact forbidden patterns from the spec/context, not broad repository-wide bans.

### `tests/unit/scanner.test.ts` (test, file-I/O + CRUD)

**Analog:** `tests/unit/scanner.test.ts`

**Mock setup pattern** (lines 15-23, 76-97, 117-137):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { titleFromFilename, runScanOnce, scanMutex, repairFrontmatter } from '../../src/services/scanner.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

vi.mock('../../src/storage/supabase.js', () => {
  const createChainableQuery = () => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockResolvedValue({ data: [], error: null }),
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  return { supabaseManager: { getClient: vi.fn(() => ({ from: vi.fn().mockImplementation(createChainableQuery) })) } };
});

import { supabaseManager } from '../../src/storage/supabase.js';
import { logger } from '../../src/logging/logger.js';
```

**Regression test shape** (lines 506-556, 558-605): mock `supabaseManager.getClient`, mock vault file listing, run `runScanOnce(config)`, assert unchanged scan behavior. Extend only if needed for active/missing/archived row coverage.

### `tests/unit/llm-usage-tool.test.ts` (test, request-response + transform)

**Analog:** `tests/unit/llm-usage-tool.test.ts`

**Chainable query mock pattern** (lines 22-47):
```typescript
let _currentRows: Array<Record<string, unknown>> = [];
let _currentError: Error | null = null;

function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ['eq', 'gte', 'lte', 'order', 'limit'] as const) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data: _currentRows, error: _currentError }).then(onFulfilled);
  return chain;
}

const selectMock = vi.fn(() => makeChain());
const fromMock = vi.fn(() => ({ select: selectMock }));
```

**Handler capture pattern** (lines 55-69):
```typescript
type Handler = (params: unknown) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>;

function getHandler(): Handler {
  const handlers = new Map<string, Handler>();
  const fakeServer = {
    registerTool: vi.fn((name: string, _spec: unknown, handler: Handler) => {
      handlers.set(name, handler);
    }),
  };
  registerLlmUsageTools(fakeServer as any, TEST_CONFIG);
  const handler = handlers.get('get_llm_usage');
  if (!handler) throw new Error('get_llm_usage handler was not registered');
  return handler;
}
```

**By-purpose regression assertions** (lines 227-247) and **by-model regression assertions** (lines 312-349) are the direct analogs for T-U-021 and T-U-022.

### `tests/unit/record-tools.test.ts` (test, request-response + CRUD)

**Analog:** `tests/unit/llm-usage-tool.test.ts` for handler capture and chain mocks; `tests/unit/record-tools.test.ts` for record tool registration.

**Existing record tool registration pattern** (lines 1-18, 21-38):
```typescript
import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => ({})) },
}));

describe('record tools final surface', () => {
  it('registers current record tools and omits removed legacy handlers', () => {
    const names: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => names.push(name)),
    } as unknown as McpServer;
    registerRecordTools(server, makeConfig());
    expect(names).toEqual(expect.arrayContaining(['write_record', 'get_record', 'archive_record', 'search_records']));
  });
});
```

For T-U-023/T-U-024, extend this suite or add a neighboring unit test that captures the `search_records` handler, mocks plugin table resolution, mocks Supabase/queryPgPool paths, and spies on `logger.info`/`logger.warn`/`logger.error` to assert safe timing metadata. Follow the logger mock style from `tests/unit/llm-usage-tool.test.ts` lines 14-16.

### Integration And Scenario Tests

**Document response format analog:** `tests/integration/tools-response-format.test.ts` lines 12-27 captures handlers and parses JSON text; lines 96-112 assert `get_document` expected errors remain JSON with `isError: false`.

**Record integration analog:** `tests/integration/write-record.integration.test.ts` lines 83-112 uses `describe.skipIf(SKIP)`, initializes Supabase/plugins/records, and cleans up with `afterAll`.

**Directed LLM scenario analogs:**
```python
# tests/scenarios/directed/testcases/test_get_llm_usage_by_purpose.py lines 61-90
with FQCServer(fqc_dir=args.fqc_dir, extra_config=CONFIGURED_LLM) as server:
    client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
    client.call_tool("call_model", **{"resolver": "purpose", "name": "general", "messages": [...]})
    time.sleep(3)
    result = client.call_tool("get_llm_usage", **{"mode": "by_purpose", "period": "24h"})
```

```python
# tests/scenarios/directed/testcases/test_get_llm_usage_by_model.py lines 81-108
result = client.call_tool("get_llm_usage", **{
    "mode": "by_model",
    "period": "24h",
})
shape_ok = (
    parsed.get("mode") == "by_model"
    and isinstance(models, list)
    and fast_entry is not None
    and "pct_of_total_calls" in fast_entry
)
```

**YAML LLM scenario analogs:** `tests/scenarios/integration/tests/llm_by_purpose_mode.yml` lines 1-8 for metadata/deps and lines 31-45 for `get_llm_usage` assertions; `llm_by_model_mode.yml` lines 33-55 for by-model assertions.

**YAML records scenario analog:** `tests/scenarios/integration/tests/plugin_record_consolidation.yml` lines 1-7 for metadata, lines 10-28 for plugin registration, lines 29-56 for `write_record -> search_records`, and lines 112-123 for archived search result assertions. For T-Y-003, update coverage if required but preserve public workflow behavior.

## Shared Patterns

### MCP Response Envelopes

**Source:** `src/mcp/utils/response-formats.ts` lines 176-185
```typescript
export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}
```

Apply to all MCP tool behavior checks: preserve `{ content: [{ type: "text", text: "..." }] }`; preserve `isError: true` for runtime failures and expected-error semantics where already present.

### Logging

**Source:** `src/logging/logger.ts` lines 60-80
```typescript
private _emit(level: LogLevel, msg: string): void {
  if (LEVEL_RANK[level] < this.minLevel) return;
  const cid = getCurrentCorrelationId() ?? '----';
  this._write(`[${this._timestamp()} REQ:${cid}] ${LEVEL_LABEL[level]}  ${msg}`);
}

debug(msg: string): void { this._emit('debug', msg); }
info(msg: string): void { this._emit('info', msg); }
warn(msg: string): void { this._emit('warn', msg); }
error(msg: string): void { this._emit('error', msg); }
```

Apply to REQ-008: log only safe identifiers (`path`, `table`, `row_count`, `elapsed_ms`); never raw record payloads, vectors, or caller query text.

### Static Guards

**Source:** `tests/unit/codebase-audit-remaining-remediation.test.ts` lines 21-30
```typescript
it('T-U-007: plugin reconciliation no longer casts VaultManager to private rootPath', () => {
  const source = read('src/services/plugin-reconciliation.ts');
  expect(source).not.toContain('vaultManager as unknown as { rootPath: string }');
  expect(source).not.toMatch(/rootPath/);
});
```

Apply exact guards for:
- `as unknown as Record<string, unknown>` in `src/mcp/utils/document-output.ts`
- `as unknown as Promise` in `src/services/scanner.ts`
- broad block-level eslint disables around `applyEntityFilters` / `fetchRows` in `src/mcp/tools/llm-usage.ts`
- grouping `!.push` or equivalent non-null assertion push patterns in `src/mcp/tools/llm-usage.ts`
- `TODO LOG-01` in `src/mcp/tools/records.ts`

## No Analog Found

None. Every in-scope Phase 152 file has an exact or role-match analog in the existing codebase.

## Metadata

**Analog search scope:** `src/mcp/utils`, `src/services`, `src/mcp/tools`, `src/logging`, `tests/unit`, `tests/integration`, `tests/scenarios/directed`, `tests/scenarios/integration`
**Files scanned:** 120+ via `rg --files` / targeted `rg`
**Pattern extraction date:** 2026-05-25
