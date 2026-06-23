# Phase 171: Graph Foundation, Schema, and Vocabulary - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 31 file/module groups
**Analogs found:** 31 / 31

## Required Implementation Reading

Downstream planner and executor agents MUST read these two product docs before planning or implementation. They are the source of truth when they differ from roadmap or local planning summaries:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/Graph-Enhanced-Document-Intelligence Test Plan.md`

Phase 171 covers product phases 1-3 only: graph config/schema/vocabulary, deterministic Tier 1 structural graph, `fq_processing`, and read surfaces. Do not implement Tier 2 similarity persistence, Tier 3 LLM classification, lint/community execution, graph UI, or server-side session state in this phase.

## File Classification

| New/Modified File or Group | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/config/loader.ts` | config | transform + request-response startup | `src/config/loader.ts` existing LLM/embedding schemas | exact |
| `src/config/types.ts` | config | transform | `src/config/types.ts` existing `FlashQueryConfig` | exact |
| `src/graph/config.ts` | config/utility | transform | `src/config/loader.ts`, `src/mcp/utils/document-connections.ts` | role-match |
| `src/graph/vocabulary.ts` | config/utility | file-I/O + transform | `src/config/loader.ts`, `tests/unit/embedding-yaml-parser.test.ts` | role-match |
| `src/graph/prompts.ts` | config/utility | file-I/O + transform | `src/config/loader.ts`, `src/llm/reference-resolver.ts` | role-match |
| `src/graph/edge-validation.ts` | utility | transform | `src/config/loader.ts` validation functions | role-match |
| `src/storage/supabase.ts` | storage/config | DDL + CRUD | existing `fqc_chunks`, `fqc_pending_embeds`, `match_chunks_*` DDL | exact |
| `src/storage/schema-verify.ts` | storage/config | request-response verification | existing `verifySchema()` table/column verification | exact |
| `src/embedding/chunks/parser.ts` | utility | transform | existing `parseDocumentChunks()` | exact |
| `src/embedding/chunks/store.ts` | storage/service | CRUD + transform | existing `diffAndPersistDocumentChunks()` | exact |
| `src/embedding/chunks/scheduler.ts` | service | event-driven + batch | existing chunk embedding scheduler | exact |
| `src/constants/frontmatter-fields.ts` | config/constants | transform | existing `FM` constants | exact |
| `src/graph/structural.ts` | service | CRUD + transform | `src/embedding/chunks/store.ts`, `src/embedding/chunks/parser.ts` | role-match |
| `src/graph/link-resolver.ts` | utility | transform | `src/embedding/chunks/atomic-blocks.ts`, `src/embedding/chunks/parser.ts` | role-match |
| `src/graph/staleness.ts` | service | CRUD + batch | `src/embedding/chunks/store.ts` diff/delete/update flow | role-match |
| `src/graph/queries.ts` | service/utility | request-response + traversal | `src/mcp/utils/document-connections.ts`, `src/mcp/tools/compound.ts` | role-match |
| `src/graph/response.ts` | utility | transform | `src/mcp/utils/response-formats.ts` | role-match |
| `src/llm/reference-resolver.ts` | utility | transform + file-I/O via resolver | existing `parseReferences()` / `resolveReferences()` | exact |
| `src/mcp/tools/graph.ts` | route/controller | request-response | `src/mcp/tools/documents/get.ts`, `src/mcp/tools/compound.ts` | role-match |
| `src/mcp/server.ts` | route/config | request-response registration | existing native tool registration block | exact |
| `src/mcp/tool-metadata.ts` | config | transform | existing `search` and `get_document` metadata entries | exact |
| `src/mcp/tools/compound.ts` | controller/service | request-response + CRUD reads | existing unified `search` handler | exact |
| `src/mcp/tools/documents/get.ts` | controller | request-response | existing `get_document` include/connections handler | exact |
| `src/mcp/utils/document-output.ts` | utility | transform + request-response | existing `buildConsolidatedResponse()` and connection plumbing | exact |
| `src/mcp/utils/document-connections.ts` | service/utility | CRUD reads + request-response | existing stored chunk-vector connection builder | exact |
| `tests/unit/graph-*.test.ts` | test | transform + CRUD mocked | `tests/unit/embedding-yaml-parser.test.ts`, `tests/unit/document-connections.test.ts`, `tests/unit/chunk-store.test.ts` | role-match |
| `tests/unit/reference-resolver-namespaces.test.ts` | test | transform | `tests/unit/reference-resolver.test.ts` | exact |
| `tests/integration/graph/*.test.ts` | test | CRUD + request-response | `tests/integration/embedding/chunk-schema.test.ts`, `get-document-connections.test.ts` | role-match |
| `tests/scenarios/integration/tests/graph_*.yml` | test | request-response workflow | existing YAML scenario skill/test patterns | role-match |
| `tests/scenarios/directed/testcases/test_graph_*.py` | test | request-response workflow | existing directed scenario skill/test patterns | role-match |
| `src/mcp/tool-help/query_graph.tool.md` and related help | docs/config | transform | existing `src/mcp/tool-help/search.tool.md`, metadata descriptions | role-match |

## Pattern Assignments

### Config Loader and Types

**Applies to:** `src/config/loader.ts`, `src/config/types.ts`, `src/graph/config.ts`

**Analog:** `src/config/loader.ts`

**Imports and schema pattern** (lines 1-11, 318-338):
```typescript
import { z } from 'zod';
import * as yaml from 'js-yaml';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import type { FlashQueryConfig } from './types.js';

const ConfigSchema = z
  .object({
    instance: InstanceSchema,
    supabase: SupabaseSchema,
    llm: LlmSchema,
    embeddings: EmbeddingsSchema,
    logging: LoggingSchema,
    locking: LockingSchema,
  })
  .strict();
```

**Cross-reference validation pattern** (lines 760-794):
```typescript
function validateEmbeddingCatalogConfig(config: RawBrokerConfig): void {
  const embeddings = config.embeddings ?? [];
  if (embeddings.length === 0) return;

  const errors: string[] = [];
  const providerNames = new Set((config.llm?.providers ?? []).map((provider) => provider.name));
  for (const entry of embeddings) {
    for (const endpoint of entry.endpoints) {
      if (!providerNames.has(endpoint.provider_name)) {
        errors.push(`Config error: embedding '${entry.name}' endpoint provider_name '${endpoint.provider_name}' references unknown llm provider`);
      }
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
}
```

**Load, parse, validate, camelize pattern** (lines 936-1008, 1010-1027, 1032-1086):
```typescript
const contents = readFileSync(configPath, 'utf-8');
raw = yaml.load(contents);
const expanded = expandEnvVars(raw);
const result = ConfigSchema.safeParse(expanded);
if (!result.success) throw new Error(formatZodErrors(result.error.issues as ZodIssue[]));

validateBrokerServerReferences(result.data);
if (result.data.llm) {
  normalizeLlmNames(result.data.llm);
  const llmErrors = validateLlmConfig(result.data.llm);
  if (llmErrors.length > 0) throw new Error(llmErrors.map((e) => `Config error: [${e.layer}] ${e.message}`).join('\n'));
}
validateEmbeddingCatalogConfig(result.data);

const camel = snakeToCamel(result.data) as Record<string, unknown>;
const config: FlashQueryConfig = {
  ...(camel as unknown as FlashQueryConfig),
  instance: instanceData,
};
```

**Tests to copy:** `tests/unit/embedding-yaml-parser.test.ts` lines 1-60 for temp YAML fixtures; lines 70-104 for positive parse; lines 107-152 for missing-field negative cases; lines 181-218 for name and cross-reference validation.

**Graph-specific guidance:** add `GraphSchema` in the snake_case YAML schema block, a camelCase `graph` field in `FlashQueryConfig`, and a `validateGraphConfig(config)` pass after LLM and embedding normalization. Preserve absent/disabled defaults with `enabled:false`.

### Graph Sidecar Loaders

**Applies to:** `src/graph/vocabulary.ts`, `src/graph/prompts.ts`

**Analog:** `src/config/loader.ts`, `tests/unit/embedding-yaml-parser.test.ts`

**File-I/O + YAML exception pattern** (lines 936-948):
```typescript
try {
  const contents = readFileSync(configPath, 'utf-8');
  raw = yaml.load(contents);
} catch (err: unknown) {
  if (err instanceof yaml.YAMLException) {
    const line = err.mark ? err.mark.line + 1 : '?';
    throw new Error(`Config error: Invalid YAML syntax at line ${line}: ${err.reason}`, { cause: err });
  }
  throw err;
}
```

**Validation pattern:** use strict Zod object schemas like `PurposeSchema` lines 183-195 and collect multiple semantic validation errors like `validateLlmConfig()` lines 585-716. Resolve configured sidecar paths relative to `config.instance.vault.path`, not process CWD.

**Tests to copy:** use `mkdtempSync`, `writeFileSync`, `afterEach` cleanup from `tests/unit/embedding-yaml-parser.test.ts` lines 1-24 and 63-68. Test defaults, duplicate relation names, invalid directionality, invalid detection method, and prompt variable validation before workers/tools run.

### Graph DDL and Verification

**Applies to:** `src/storage/supabase.ts`, `src/storage/schema-verify.ts`

**Analog:** `src/storage/supabase.ts`, `src/storage/schema-verify.ts`

**Idempotent table/index pattern** (`src/storage/supabase.ts` lines 371-437, 520-562):
```sql
CREATE TABLE IF NOT EXISTS fqc_chunks (
  id UUID PRIMARY KEY,
  instance_id TEXT NOT NULL,
  document_id UUID NOT NULL REFERENCES fqc_documents(id) ON DELETE CASCADE,
  parent_chunk_id UUID REFERENCES fqc_chunks(id) ON DELETE CASCADE,
  UNIQUE(instance_id, document_id, heading_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_fqc_chunks_document_id ON fqc_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_fqc_chunks_instance_id ON fqc_chunks(instance_id);

CREATE TABLE IF NOT EXISTS fqc_pending_embeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fqc_pending_embeds_target_entry_unique
  ON fqc_pending_embeds(instance_id, target_kind, target_table, target_id, embedding_name);
```

**Constraint repair pattern** (`src/storage/supabase.ts` lines 538-548):
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fqc_pending_embeds_status_check'
  ) THEN
    ALTER TABLE fqc_pending_embeds
      ADD CONSTRAINT fqc_pending_embeds_status_check
      CHECK (status IN ('pending', 'complete', 'failed'));
  END IF;
END $$;
```

**Instance-filtered RPC pattern** (`src/storage/supabase.ts` lines 1118-1184):
```sql
CREATE OR REPLACE FUNCTION match_chunks_primary(
  query_embedding vector(1536),
  filter_instance_id text DEFAULT NULL
)
RETURNS TABLE (chunk_id uuid, document_id uuid, path text, similarity float)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, d.id, d.path, 1 - (c.embedding_primary <=> query_embedding) AS similarity
  FROM fqc_chunks c
  JOIN fqc_documents d ON d.id = c.document_id
  WHERE (filter_instance_id IS NULL OR d.instance_id = filter_instance_id)
    AND (filter_instance_id IS NULL OR c.instance_id = filter_instance_id);
END;
$$;
```

**Schema verification pattern** (`src/storage/schema-verify.ts` lines 226-286):
```typescript
const requiredTables = ['fqc_memory', 'fqc_documents', 'fqc_chunks', 'fqc_pending_embeds'];
for (const table of requiredTables) {
  const exists = await tableExists(client, table);
  if (!exists) missingTables.push(table);
}
if (missingTables.length > 0) throw new Error(`Missing required tables after DDL: [${missingTables.join(', ')}]`);

const requiredColumns: Array<{ table: string; column: string }> = [
  { table: 'fqc_pending_embeds', column: 'instance_id' },
  { table: 'fqc_pending_embeds', column: 'status' },
];
```

**Tests to copy:** `tests/integration/embedding/chunk-schema.test.ts` lines 39-57 for `describe.skipIf(!HAS_SUPABASE).sequential`, setup and teardown; lines 59-117 for `information_schema`, `pg_constraint`, and `pg_indexes`; lines 119-153 for cascade and uniqueness tests.

**Graph-specific guidance:** graph tables must be `fqc_` prefixed, include `instance_id`, FK graph nodes to `fqc_chunks(id) ON DELETE CASCADE`, add source/target/relation/status indexes, and add JSONB GIN indexes only where graph queries need containment.

### Chunk Identity, Structural Graph, and Staleness

**Applies to:** `src/embedding/chunks/parser.ts`, `src/embedding/chunks/store.ts`, `src/embedding/chunks/scheduler.ts`, `src/graph/structural.ts`, `src/graph/link-resolver.ts`, `src/graph/staleness.ts`

**Analog:** `src/embedding/chunks/parser.ts`, `src/embedding/chunks/store.ts`, `src/embedding/chunks/scheduler.ts`

**Parser output pattern** (`src/embedding/chunks/parser.ts` lines 33-67):
```typescript
chunks.push({
  id: deriveChunkId(identityInput),
  document_id: input.documentId,
  heading_path: pendingChunk.headingPath,
  heading_level: pendingChunk.headingLevel,
  breadcrumb: pendingChunk.breadcrumb,
  content_hash: chunkContentHash(content),
  parent_chunk_id: deriveParentChunkId(identityInput),
  source_start_line: pendingChunk.startLine,
  source_end_line: pendingChunk.endLine,
  merged_heading_paths: pendingChunk.mergedHeadingPaths,
});
```

**Code-fence-safe heading scan pattern** (`src/embedding/chunks/parser.ts` lines 134-169):
```typescript
let activeFence: { marker: '`' | '~'; length: number } | null = null;
for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
  if (activeFence) {
    const closeRegex = new RegExp(`^ {0,3}\\${activeFence.marker}{${activeFence.length},}[ \\t]*$`);
    if (closeRegex.test(line)) activeFence = null;
    continue;
  }
  const fenceMatch = FENCE_OPEN_REGEX.exec(line);
  if (fenceMatch) { activeFence = { marker, length: fence.length }; continue; }
  const headingMatch = HEADING_REGEX.exec(line);
}
```

**Diff and persistence pattern** (`src/embedding/chunks/store.ts` lines 46-79, 92-123):
```typescript
export function classifyDocumentChunkDiff(existingRows, parsedChunks): DocumentChunkDiff {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const newChunks: ParsedChunk[] = [];
  const changedChunks: ParsedChunk[] = [];
  const unchangedChunks: ParsedChunk[] = [];
  // classify by id and content_hash
  return { newChunks, changedChunks, unchangedChunks, orphanChunks, chunksNeedingEmbedding };
}

await client.query('BEGIN');
const existingRows = await selectExistingChunks(client, options.instanceId, options.documentId);
const diff = classifyDocumentChunkDiff(existingRows, parsedChunks);
await insertChunks(client, options.instanceId, diff.newChunks);
await updateChunks(client, options.instanceId, diff.changedChunks);
await deleteOrphanChunks(client, options.instanceId, options.documentId, diff.orphanChunks);
await client.query('COMMIT');
return { chunks: parsedChunks, ...diff, operations: planDocumentChunkPersistence(diff) };
```

**Scheduler hook pattern** (`src/embedding/chunks/scheduler.ts` lines 33-67):
```typescript
const diff = await diffAndPersistDocumentChunks({
  databaseUrl: options.config.supabase.databaseUrl,
  instanceId: options.config.instance.id,
  documentId: options.documentId,
  title: options.title,
  body: options.body,
});

const results = await Promise.all(
  diff.chunksNeedingEmbedding.map((chunk) => scheduleBackgroundEmbeddingsForActiveEntries(...))
);
```

**Markdown AST parser family pattern** (`src/embedding/chunks/atomic-blocks.ts` lines 1-4, 40-68):
```typescript
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const tree = fromMarkdown(content, {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()],
}) as PositionedNode;
```

**Tests to copy:** `tests/unit/chunk-parser.test.ts` lines 21-100 for heading and code fence regression cases; lines 102-216 for merged heading and stable ID behavior. `tests/unit/chunk-store.test.ts` lines 21-96 for diff classification and transaction-order assertions.

**Graph-specific guidance:** use `ParsedChunk.id` as the graph node identity. Structural `contains` edges come from `parent_chunk_id`; `references` edges should resolve markdown links/wikilinks against persisted chunks and heading paths. Run stale marking and Tier 1 structural updates after the chunk transaction commits and before/alongside embedding scheduling. Disabled graph and `fq_processing: embedded|none` must short-circuit before graph mutation.

### Frontmatter Processing Level

**Applies to:** `src/constants/frontmatter-fields.ts`, scanner/write paths that gate chunk/embed/graph processing

**Analog:** `src/constants/frontmatter-fields.ts`

**Constant pattern** (lines 11-23):
```typescript
export const FM = {
  TITLE:    'fq_title',
  STATUS:   'fq_status',
  TAGS:     'fq_tags',
  ARCHIVED_AT: 'fq_archived_at',
  ID:       'fq_id',
} as const;

export type FrontmatterFieldName = typeof FM[keyof typeof FM];
```

**Graph-specific guidance:** add `PROCESSING: 'fq_processing'`. Absence means `full`; valid values are `full`, `embedded`, `none`. Invalid values should produce scanner/maintenance diagnostics and prevent partial graph processing.

### MCP JSON Response and Error Envelopes

**Applies to:** `src/graph/response.ts`, `src/mcp/tools/graph.ts`, graph-aware `search` / `get_document`

**Analog:** `src/mcp/utils/response-formats.ts`

**Canonical helpers** (lines 247-303):
```typescript
export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}

export function jsonRuntimeError(messageOrError: string | RuntimeErrorInput, details?: object): ToolResult {
  // runtime errors return isError: true
}

export function withWarnings<T extends object>(payload: T, warnings: WarningCode[]): T & { warnings?: WarningCode[] } {
  const deduped = [...new Set(warnings)];
  return deduped.length === 0 ? payload : { ...payload, warnings: deduped };
}
```

**Tests to copy:** `tests/unit/response-formats.test.ts` lines 38-110 verify JSON parseability, expected error `isError:false`, runtime error `isError:true`, warnings, and canonical snake_case error codes.

**Graph-specific guidance:** disabled `query_graph` should use `jsonExpectedError({ error:'unsupported', ... })` if registered. Invalid action/parameter combinations should be expected errors, not thrown exceptions. Runtime failures must not expose raw LLM output, database URLs, API keys, or prompt bodies.

### MCP Tool Registration and Metadata

**Applies to:** `src/mcp/tools/graph.ts`, `src/mcp/server.ts`, `src/mcp/tool-metadata.ts`, `src/mcp/tool-help/query_graph.tool.md`

**Analog:** `src/mcp/server.ts`, `src/mcp/tool-metadata.ts`

**Native registration imports and call order** (`src/mcp/server.ts` lines 13-23, 666-679):
```typescript
import { registerCompoundTools } from './tools/compound.js';
import { registerScanTools } from './tools/scan.js';

registerMemoryTools(server, config);
registerDocumentTools(server, config);
registerCompoundTools(server, config);
registerScanTools(server, config);
const catalog = getNativeToolCatalog(server);
assertRegisteredToolsHaveToolMeta(catalog, toolMeta);
validateAndCacheNativeToolSchemas(catalog);
```

**Metadata pattern** (`src/mcp/tool-metadata.ts` lines 59-69, 222-242):
```typescript
function description(summary: string, useWhen: string, doNotUseWhen: string, example: string): string {
  return `Summary: ${summary}\nUse when: ${useWhen}\nDo not use when: ${doNotUseWhen}\nExample: ${example}`;
}

export const TOOL_METADATA = [
  current('get_document', ['doc-read'], 'read-only', D.getDocument),
  current('search', ['doc-read', 'memory'], 'read-only', D.search),
];
```

**Graph-specific guidance:** add `registerGraphTools(server, config)` in the same native registration block as `registerCompoundTools`; add `query_graph` metadata in the same slice, likely category `doc-read`, tier `read-only`, `hostEligible:true`, `delegatedEligible` per local policy. Missing metadata will fail `assertRegisteredToolsHaveToolMeta()`.

### `query_graph` Tool

**Applies to:** `src/mcp/tools/graph.ts`, `src/graph/queries.ts`

**Analog:** `src/mcp/tools/documents/get.ts`, `src/mcp/tools/compound.ts`

**Tool handler skeleton** (`src/mcp/tools/documents/get.ts` lines 12-56, 70-98, 141-163):
```typescript
export function registerGetDocumentTool(server: McpServer, deps: DocumentToolDeps): void {
  server.registerTool(
    'get_document',
    {
      description: 'Read one or more documents and return a structured JSON envelope.',
      inputSchema: {
        identifiers: z.union([z.string(), z.array(z.string())]),
        include: z.array(z.enum(['body', 'frontmatter', 'headings', 'connections'])).optional().default(['body']),
      },
    },
    async (params) => {
      if (invalid) return jsonExpectedError({ error: 'invalid_input', message, details });
      try {
        const result = await resolveAndBuildDocument(...);
        return jsonToolResult(result);
      } catch (err) {
        if (err instanceof DocumentRequestError) return jsonExpectedError(err.envelope);
        return jsonRuntimeError({ message: `Error reading document: ${msg}`, identifier });
      }
    }
  );
}
```

**Supabase read helper pattern** (`src/mcp/utils/document-connections.ts` lines 199-269, 299-338):
```typescript
const { data: sourceRows, error: sourceError } = await input.supabase
  .from('fqc_chunks')
  .select(`id, heading_path, breadcrumb, ${embeddingColumn}`)
  .eq('document_id', input.sourceDocumentId)
  .eq('instance_id', input.config.instance.id)
  .not(embeddingColumn, 'is', null);
if (sourceError) throw new Error(sourceError.message);

const { data, error } = await input.supabase.rpc(`match_chunks_${input.entry.name}`, {
  filter_instance_id: input.config.instance.id,
  include_archived: false,
});
if (error) throw new Error(error.message);
```

**Graph-specific guidance:** implement read-only actions required by the product doc: `neighbors`, `node`, `edges`, `path`, `subgraph`, `stats`, `schema`, `provenance_chain`, `impact`, `contradictions`, plus empty/not-applicable scaffolding for community/lint dependent actions. Enforce `max_depth`, limits, relation filters, `include_stale`, document status filtering, instance isolation, and visited-set/cycle protection.

### Unified Search Graph Expansion

**Applies to:** `src/mcp/tools/compound.ts`, `src/graph/queries.ts`

**Analog:** `src/mcp/tools/compound.ts`

**Search schema and warning/error pattern** (lines 1528-1550, 1552-1572):
```typescript
server.registerTool('search', {
  inputSchema: {
    query: z.string().optional(),
    mode: z.enum(['filesystem', 'semantic', 'mixed']).optional(),
    tags: z.array(z.string()).optional(),
    include_archived: z.boolean().optional(),
  },
}, async (params) => {
  const intentResult = resolveSearchIntent(params, enabled);
  if (intentResult.error) return jsonExpectedError(intentResult.error);
  const warnings = [...intentResult.warnings];
});
```

**Semantic seed pattern** (lines 431-506):
```typescript
const rpcResult = await supabase.rpc(`match_chunks_${input.entry.name}`, {
  query_embedding: JSON.stringify(input.queryEmbedding),
  match_threshold: 0.4,
  match_count: input.limit,
  filter_instance_id: input.config.instance.id,
  include_archived: input.includeArchived,
});
if (error) throw new Error(error.message);
hits.push({
  entity_type: 'document',
  match_source: ['semantic'],
  matched_chunks: [{ chunk_id: chunk.chunk_id, heading_path: chunk.heading_path }],
});
```

**Final response pattern** (lines 1788-1804):
```typescript
const mergedResults = mergeSearchResults(allResults, intent.limit);
const results = mergedResults.map((result) => capMatchedChunks(result, limitChunksPerResult));
return jsonToolResult({
  query: intent.query,
  entity_types: intent.entity_types,
  mode: intent.mode,
  total: results.length,
  ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
  results,
});
```

**Tests to copy:** `tests/unit/search.test.ts` lines 11-80 for pure validation helpers and unsupported/warning behavior; lines 83-107 for deterministic merge/dedupe/ranking. Graph ranking tests should follow this helper-first style.

**Graph-specific guidance:** keep existing `mode` semantics unchanged. Add graph parameters additively. Only expand graph from semantic seed chunks when graph expansion is requested. Use `match_source` values that distinguish graph expansion from existing `filesystem` and `semantic`.

### `get_document` Graph Summary and Connections

**Applies to:** `src/mcp/tools/documents/get.ts`, `src/mcp/utils/document-output.ts`, `src/mcp/utils/document-connections.ts`

**Analog:** current `get_document` include and connection plumbing

**Include schema pattern** (`src/mcp/tools/documents/get.ts` lines 26-53):
```typescript
include: z.array(z.enum(['body', 'frontmatter', 'headings', 'connections']))
  .optional()
  .default(['body']),
connections: z.object({
  limit: z.number().int().positive().max(200).optional(),
  limit_per_chunk: z.number().int().positive().max(25).optional(),
  embedding_names: z.array(z.string()).optional(),
}).optional()
```

**Consolidated response pattern** (`src/mcp/utils/document-output.ts` lines 223-259):
```typescript
const result: DocumentEnvelope = { ...envelope };
if (effectiveInclude.includes('body') && options.body !== undefined) result.body = options.body;
if (effectiveInclude.includes('frontmatter') && options.frontmatter !== undefined) result.frontmatter = options.frontmatter;
if (effectiveInclude.includes('headings') && options.headings !== undefined) result.headings = options.headings;
if (effectiveInclude.includes('connections') && options.connections !== undefined) result.connections = options.connections;
return result;
```

**Pre-I/O parameter validation pattern** (`src/mcp/utils/document-output.ts` lines 270-320):
```typescript
if (input.connections !== undefined && !include.includes('connections')) {
  return {
    error: 'invalid_input',
    message: 'connections options require "connections" in include',
    details: { conflict: 'connections_without_include', include },
  };
}
```

**Connection builder pattern** (`src/mcp/utils/document-output.ts` lines 762-770):
```typescript
if (effectiveInclude.includes('connections')) {
  const connectionsResult = await buildDocumentConnections({
    supabase: sm.getClient(),
    config: cfg,
    sourceDocumentId: fqcId,
    options: connections,
  });
  if (connectionsResult.error) throw new DocumentRequestError(connectionsResult.error);
  connectionsField = connectionsResult.result;
}
```

**Tests to copy:** `tests/unit/document-output.test.ts` lines 95-147 for include-gated connection response shape; `tests/unit/document-connections.test.ts` lines 27-74 for unsupported and empty results; lines 76-135 for stored-vector reads, self-document filtering, dedupe, and sorting. `tests/integration/embedding/get-document-connections.test.ts` lines 126-201 for MCP handler capture and no-query-embedding assertion.

**Graph-specific guidance:** add `graph_summary` to include enum; add graph-aware connection options (`graph_limit_per_chunk`, `embedding_limit_per_chunk`, `include_embedding_only`, `include_inactive_targets`, `relations`, `include_stale`). Preserve legacy `limit_per_chunk` when no graph-aware options are present; return a documented validation error when old `limit_per_chunk` is used in graph-aware calls.

### Namespaced Template Variables

**Applies to:** `src/llm/reference-resolver.ts`, `tests/unit/reference-resolver-namespaces.test.ts`

**Analog:** `src/llm/reference-resolver.ts`

**Current scan/parse pattern** (lines 118-132, 144-181, 183-252):
```typescript
export function parseReferences(messages: Array<{ role: string; content: string }>): ParsedRef[] | ParseRefError {
  const results: ParsedRef[] = [];
  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    for (const span of scanReferenceSpans(content)) {
      if (span.kind === 'escaped') continue;
      const parsed = parseActiveSpan(span, msgIdx);
      if ('error' in parsed) return parsed;
      results.push(parsed);
    }
  }
  return results;
}
```

**Resolution pattern** (lines 265-280):
```typescript
export async function resolveReferences(parsed, config, sm, ep, log, templateParams?) {
  return Promise.all(parsed.map(async (p) => {
    try {
      const result = await resolveAndBuildDocument(p.identifier, { effectiveInclude: ['body'] }, documentResolutionDeps(...));
      // map success to ResolvedRef
    } catch (err) {
      // map DocumentRequestError and generic errors to FailedRef
    }
  }));
}
```

**Tests to copy:** `tests/unit/reference-resolver.test.ts` lines 85-221 for parser compatibility and literal `{{id:...}}` behavior; lines 25-56 for Vitest module mocking of `resolveAndBuildDocument`, logger, Supabase, and embedding provider.

**Graph-specific guidance:** refactor toward namespace-provider dispatch without regressing `{{ref:...}}`, escaped refs, aliases, section `#`, pointer `->`, duplicate placeholders, or literal unsupported `{{id:...}}`. Unknown namespace variables should remain unresolved/non-destructive.

### LLM JSON Parser Reuse for Future Graph Parse Sites

**Applies to:** Phase 171 prompt validation only; Phase 172 LLM analysis parse sites

**Analog:** `src/llm/json-repair.ts`, `tests/unit/llm-json-repair.test.ts`

**Tested parser contract** (`tests/unit/llm-json-repair.test.ts` lines 32-43, 107-130):
```typescript
const result = parseLlmJson(raw, payloadSchema);
expect(result).toEqual({ ok: true, data: { ok: true, label: 'ready' }, raw, repaired: false });

const result = parseLlmJson('{"ok":"yes"}', payloadSchema);
expect(result).toMatchObject({
  ok: false,
  failure: 'schema',
  issues: [{ path: ['ok'], message: expect.any(String) }],
});
```

**Graph-specific guidance:** do not introduce a second LLM JSON parser. Phase 171 should only validate prompt sidecars and namespace rendering; Phase 172 must use `parseLlmJson` for graph LLM outputs.

## Shared Patterns

### Disabled-by-Default Gates

**Sources:** `src/config/loader.ts`, `src/mcp/utils/document-connections.ts`, `src/mcp/tools/compound.ts`

**Apply to:** all graph write hooks and graph read surfaces.

Copy the pattern of returning early before side effects:
```typescript
if ((input.config.embeddings ?? []).length === 0) return { error: embeddingsNotConfigured() };
if (selection.selected.length === 0) return { error: zeroActiveEmbeddings() };
if (intentResult.error) return jsonExpectedError(intentResult.error);
```

For graph: if absent or `enabled:false`, do not queue, mutate graph tables, call LLMs, or alter existing search/get_document output. `query_graph` may be registered but must return canonical `unsupported`.

### Instance Isolation

**Sources:** `src/storage/supabase.ts` lines 1168-1175, `src/mcp/utils/document-connections.ts` lines 207-212.

Every graph table, RPC, and query must filter on `instance_id`:
```typescript
.eq('instance_id', input.config.instance.id)
```
```sql
AND (filter_instance_id IS NULL OR d.instance_id = filter_instance_id)
AND (filter_instance_id IS NULL OR c.instance_id = filter_instance_id)
```

### Expected vs Runtime Errors

**Source:** `src/mcp/utils/response-formats.ts` lines 247-303.

Expected user/config/input errors use:
```typescript
return jsonExpectedError({ error: 'invalid_input', message, identifier, details });
```

Unexpected failures use:
```typescript
logger.error(`query_graph failed: ${msg}`);
return jsonRuntimeError({ message: `Error querying graph: ${msg}`, identifier });
```

### Test Conventions

**Unit:** use Vitest helper-first pure tests like `tests/unit/search.test.ts`, temp YAML fixtures like `tests/unit/embedding-yaml-parser.test.ts`, and module mocks like `tests/unit/reference-resolver.test.ts`.

**Integration:** use `describe.skipIf(!HAS_SUPABASE).sequential`, `setupTestSupabase`, direct `pg.Client` inspection, and cleanup by `instance_id` as in `tests/integration/embedding/chunk-schema.test.ts`.

**Scenario:** use `flashquery-directed-covgen`/`flashquery-directed-testgen` for Python directed scenarios and `flashquery-integration-covgen`/`flashquery-integration-testgen` for YAML workflows. Graph IDs named in the product test plan (`D-GR-*`, `IG-*`) should be added through those project workflows when scenario tests land.

## No Analog Found

No file group is wholly without an analog. The least-direct analog is graph vocabulary/prompt sidecars because the repo has config YAML loaders but no existing graph sidecar module. Use the config loader and embedding YAML tests as the local pattern, and use the product requirements for relation/prompt semantics.

## Metadata

**Analog search scope:** `src/config`, `src/storage`, `src/embedding/chunks`, `src/mcp`, `src/llm`, `src/constants`, `tests/unit`, `tests/integration/embedding`, `tests/scenarios`

**Files scanned:** 200+ paths via `rg --files`, with 24 source/test analog files read in detail.

**Pattern extraction date:** 2026-06-23
