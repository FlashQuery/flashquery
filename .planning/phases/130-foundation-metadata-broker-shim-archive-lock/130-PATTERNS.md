# Phase 130: Foundation, Metadata, Broker Shim, Archive Lock - Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 10 new/modified files
**Analogs found:** 10 / 10

## Required Reading For Implementers

Downstream implementation agents MUST read these two canonical Macro Language documents before coding Phase 130:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`

If local planning docs conflict with those external documents for macro language behavior, treat the external requirements and test plan as the higher-fidelity source. Phase 130 still remains foundation-only: do not implement parser, evaluator, source resolution, dry-run execution, task lifecycle, progress modes, budgets, shell verbs, or real broker transport.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/mcp/utils/response-formats.ts` | utility | transform | `src/mcp/utils/response-formats.ts` existing builders | exact |
| `src/mcp/tool-metadata.ts` | config | transform | `src/mcp/tool-metadata.ts` `call_model` metadata | exact |
| `src/mcp/tools/macro.ts` | route | request-response | `src/mcp/tools/llm.ts` / `src/mcp/tools/llm-usage.ts` registrars | role-match |
| `src/mcp/server.ts` | config | request-response | existing registrar wiring in `src/mcp/server.ts` | exact |
| `src/services/mcp-broker.ts` | service | request-response | `src/llm/client.ts` + `src/llm/tool-registry.ts` interfaces | role-match |
| `src/mcp/tools/documents.ts` | route | request-response + file-I/O + CRUD | `remove_document` in same file | exact |
| `tests/unit/response-formats.test.ts` | test | transform | existing response helper tests | exact |
| `tests/unit/tool-metadata.test.ts` / `tests/unit/mcp-server-tools.test.ts` | test | request-response | existing metadata/catalog tests | exact |
| `tests/unit/mcp-broker.test.ts` | test | request-response | `tests/unit/llm-client.test.ts` / service interface tests | role-match |
| `tests/integration/archive-document-lock.test.ts` and `tests/config/vitest.integration.config.ts` | test/config | request-response + file-I/O + CRUD | `tests/integration/remove-document.integration.test.ts` | role-match |

## Pattern Assignments

### `src/mcp/utils/response-formats.ts` (utility, transform)

**Analog:** existing additive response helper exports in `src/mcp/utils/response-formats.ts`

**Imports pattern:** no imports; this module is self-contained.

**Canonical JSON response pattern** (lines 16-39, 111-149):
```typescript
export const CANONICAL_ERROR_CODES = [
  'not_found',
  'ambiguous_identifier',
  'permission_denied',
  'invalid_input',
  'conflict',
  'unsupported',
  'not_supported_in_mode',
] as const;

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}
```

**Additive typed helper pattern** (lines 65-78, 202-217):
```typescript
export interface MaintenanceActionResult {
  action: 'sync' | 'repair';
  started_at: string;
  finished_at: string;
  dry_run: boolean;
  counts: {
    scanned: number;
    added: number;
    updated: number;
    repaired: number;
    archived: number;
  };
  warnings?: WarningCode[];
}

export function maintenanceActionResult(input: MaintenanceActionResult): MaintenanceActionResult {
  return {
    action: input.action,
    started_at: input.started_at,
    finished_at: input.finished_at,
    dry_run: input.dry_run,
    counts: {
      scanned: input.counts.scanned,
      added: input.counts.added,
      updated: input.counts.updated,
      repaired: input.counts.repaired,
      archived: input.counts.archived,
    },
    ...(input.warnings === undefined ? {} : { warnings: input.warnings }),
  };
}
```

**Apply to Phase 130:** Add `MACRO_ERROR_CODES`, `MacroErrorCode`, `TraceStep`, `MacroExecutionResult`, `MacroDryRunResult`, `MacroSuccessPayload`, and `macroResult(payload)` in this style. Keep `TraceStep` flat; do not add `children`.

---

### `src/mcp/tool-metadata.ts` (config, transform)

**Analog:** `call_model` metadata and shared `current()` helper in `src/mcp/tool-metadata.ts`

**Description pattern** (lines 29-60):
```typescript
const RECURSIVE_MODEL_REASON = 'Tool can recursively call models and is not safe for delegated native access.';

function description(summary: string, useWhen: string, doNotUseWhen: string, example: string): string {
  return `Summary: ${summary}\nUse when: ${useWhen}\nDo not use when: ${doNotUseWhen}\nExample: ${example}`;
}
```

**Metadata row pattern** (lines 260-261):
```typescript
current('call_model', ['llm'], 'admin', D.callModel, RECURSIVE_MODEL_REASON),
current('get_llm_usage', ['llm'], 'read-only', D.getLlmUsage),
```

**Delegated hard-exclusion pattern** (lines 406-433):
```typescript
function current(
  name: string,
  categories: ToolCategory[],
  tier: ToolTier,
  toolDescription: string,
  hardExcludedReason?: string,
  delegatedExclusionReason?: string
): ToolMetadata {
  const status = currentToolStatus(name);
  const replacement = legacyReplacement(name);
  const metadata = {
    name,
    status,
    categories,
    tier,
    hostEligible: true,
    delegatedEligible: false,
    ...(hardExcludedReason === undefined ? {} : { delegatedHardExcludedReason: hardExcludedReason }),
    ...(delegatedExclusionReason === undefined ? {} : { delegatedExclusionReason }),
    ...(replacement === undefined ? {} : { replacement }),
    description: toolDescription,
  } satisfies ToolMetadata;

  return {
    ...metadata,
    delegatedEligible: isDelegatedTierEligible(metadata),
  };
}
```

**Apply to Phase 130:** Add `D.callMacro` using the four-block `description(...)` format. Add `current('call_macro', ['llm'], 'admin', D.callMacro, RECURSIVE_MODEL_REASON)` next to `call_model`. Preserve legacy replacement behavior for `get_briefing` and `insert_doc_link`; do not add legacy aliases.

---

### `src/mcp/tools/macro.ts` (route, request-response)

**Analog:** `registerLlmTools` and `registerLlmUsageTools`

**Imports pattern** (`src/mcp/tools/llm-usage.ts` lines 30-35):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { supabaseManager } from '../../storage/supabase.js';
```

**Tool registration and Zod input schema pattern** (`src/mcp/tools/llm.ts` lines 293-336):
```typescript
export function registerLlmTools(server: McpServer, config: FlashQueryConfig): void {
  const nativeToolCatalog = getNativeToolCatalog(server);

  server.registerTool(
    'call_model',
    {
      description: "...",
      inputSchema: {
        resolver: z.enum(CALL_MODEL_RESOLVERS).describe("..."),
        name: z.string().optional().describe("..."),
        messages: z.array(callModelMessageSchema).optional().describe("..."),
      },
    },
    async (params) => {
      // Step 0: Shutdown guard — must be first (consistent with all other tools)
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed.' }],
          isError: true,
        };
      }
```

**Expected-error scaffold pattern** (`src/mcp/utils/response-formats.ts` lines 115-117):
```typescript
export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}
```

**Apply to Phase 130:** Create `registerMacroTools(server, config)`. Register `call_macro` with a minimal schema only needed for scaffold safety. The handler must shutdown-guard first and return `jsonExpectedError({ error: 'unsupported', message: 'call_macro is registered but macro execution is not implemented in this phase.', details: { reason: 'phase_130_scaffold' } })` or equivalent canonical expected-error semantics. Do not validate macro sources or execute anything.

---

### `src/mcp/server.ts` (config, request-response)

**Analog:** existing registrar ordering in `createMcpServer`

**Imports pattern** (lines 13-24):
```typescript
import { registerMemoryTools } from './tools/memory.js';
import { registerDocumentTools } from './tools/documents.js';
import { registerPluginTools } from './tools/plugins.js';
import { registerRecordTools } from './tools/records.js';
import { registerCompoundTools } from './tools/compound.js';
import { registerScanTools } from './tools/scan.js';
import { registerPendingReviewTools } from './tools/pending-review.js';
import { registerFileTools } from './tools/files.js';
import { registerLlmTools } from './tools/llm.js';
import { registerLlmUsageTools } from './tools/llm-usage.js';
```

**Registrar ordering pattern** (lines 445-463):
```typescript
function createMcpServer(config: FlashQueryConfig, version: string): McpServer {
  const server = new McpServer({ name: 'flashquery', version });
  wrapServerWithCorrelationIds(server);
  const hostEnabledToolNames = new Set(getResolvedHostToolExposure(config).hostEnabledToolNames);
  wrapServerWithToolCatalog(server, { hostEnabledToolNames });
  registerMemoryTools(server, config);
  registerDocumentTools(server, config);
  registerPluginTools(server, config);
  registerRecordTools(server, config);
  registerCompoundTools(server, config);
  registerScanTools(server, config);
  registerPendingReviewTools(server, config);
  registerFileTools(server, config);
  registerLlmTools(server, config);
  registerLlmUsageTools(server, config);
  validateAndCacheNativeToolSchemas(getNativeToolCatalog(server));
  return server;
}
```

**Apply to Phase 130:** Import `registerMacroTools` and call `registerMacroTools(server, config)` immediately after `registerLlmUsageTools(server, config)` and before `validateAndCacheNativeToolSchemas(...)`.

---

### `src/services/mcp-broker.ts` (service, request-response)

**Analogs:** service interface style in `src/llm/client.ts`; native handler callable in `src/llm/tool-registry.ts`

**Interface pattern** (`src/llm/client.ts` lines 44-64):
```typescript
export interface LlmClient {
  chat(
    modelName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmChatResult>;
```

**Callable handler compatibility pattern** (`src/llm/tool-registry.ts` lines 14-30):
```typescript
export interface NativeToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface NativeToolDispatchContext {
  signal: AbortSignal;
  traceId?: string | null;
  instanceId: string;
  logger?: Pick<typeof logger, 'debug' | 'warn' | 'error'>;
  logContext?: Record<string, unknown>;
}

export type NativeToolHandler = (
  args: Record<string, unknown>,
  context: NativeToolDispatchContext
) => Promise<NativeToolResponse>;
```

**Apply to Phase 130:** Prefer exporting a broker handler type compatible with `NativeToolHandler` or reusing `NativeToolHandler` directly. Implement:

```typescript
export interface McpBroker {
  isConnected(serverId: string): Promise<boolean>;
  getToolHandler(serverId: string, toolName: string): NativeToolHandler | null;
}

export class NullMcpBroker implements McpBroker {
  async isConnected(_serverId: string): Promise<boolean> {
    return false;
  }

  getToolHandler(_serverId: string, _toolName: string): NativeToolHandler | null {
    return null;
  }
}
```

Do not add process management, external transports, live probes, or registry discovery in this phase.

---

### `src/mcp/tools/documents.ts` (route, request-response + file-I/O + CRUD)

**Analog:** `remove_document` lock lifecycle in the same file

**Imports pattern** (lines 13-31):
```typescript
import type { FlashQueryConfig } from '../../config/loader.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  documentArchiveResult,
  documentRemovalResult,
  documentIdentification,
  withWarnings,
  type ErrorEnvelope,
} from '../utils/response-formats.js';
```

**Current archive handler entry point** (lines 819-847):
```typescript
server.registerTool(
  'archive_document',
  {
    description:
      'Archive one or more documents by setting their status to \'archived\'. ...',
    inputSchema: {
      identifiers: z.union([z.string(), z.array(z.string())]).describe("..."),
    },
  },
  async ({ identifiers }) => {
    if (getIsShuttingDown()) {
      return {
        content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
        isError: true,
      };
    }

    try {
      const supabase = supabaseManager.getClient();
```

**Lock acquisition and conflict pattern to copy** (`remove_document`, lines 1026-1040):
```typescript
if (config.locking.enabled) {
  const locked = await acquireLock(
    supabaseManager.getClient(),
    config.instance.id,
    'documents',
    { ttlSeconds: config.locking.ttlSeconds }
  );
  if (!locked) {
    return jsonExpectedError({
      error: 'conflict',
      message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
      details: { reason: 'lock_contention' },
    });
  }
}
```

**Release-in-finally pattern to copy** (`remove_document`, lines 1219-1227):
```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`remove_document failed - ${msg}`);
  return jsonRuntimeError(msg);
} finally {
  if (config.locking.enabled) {
    await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
  }
}
```

**Lock helper semantics** (`src/services/write-lock.ts` lines 39-89, 95-106):
```typescript
export async function acquireLock(
  client: SupabaseClient,
  instanceId: string,
  resourceType: string,
  options: LockOptions = {}
): Promise<boolean> {
  const ttlSeconds = options.ttlSeconds ?? 30;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  ...
  return false;
}

export async function releaseLock(
  client: SupabaseClient,
  instanceId: string,
  resourceType: string
): Promise<void> {
  await client
    .from('fqc_write_locks')
    .delete()
    .eq('instance_id', instanceId)
    .eq('resource_type', resourceType);
}
```

**Apply to Phase 130:** Add lock acquisition to `archive_document` after shutdown guard and before mutation. Release in `finally`. Avoid releasing when acquisition returned false. The simplest safe pattern is the same as `remove_document`: return immediately on failed acquisition before entering `try`; otherwise release in `finally` when locking is enabled.

---

### `tests/unit/response-formats.test.ts` (test, transform)

**Analog:** existing response helper tests

**Imports and parse helper pattern** (lines 1-33):
```typescript
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_ERROR_CODES,
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  maintenanceActionResult,
  withWarnings,
} from '../../src/mcp/utils/response-formats.js';

function parseToolText(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]?.text ?? '');
}
```

**Stable constants test pattern** (lines 94-107):
```typescript
it('defines canonical error codes as lowercase snake_case', () => {
  expect(CANONICAL_ERROR_CODES).toEqual([
    'not_found',
    'ambiguous_identifier',
    'permission_denied',
    'invalid_input',
    'conflict',
    'unsupported',
    'not_supported_in_mode',
  ]);
  for (const code of CANONICAL_ERROR_CODES) {
    expect(code).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
  }
});
```

**Apply to Phase 130:** Extend imports with macro exports. Add tests that `MACRO_ERROR_CODES` equals the canonical macro list, all codes are lowercase snake_case, `macroResult(payload)` returns the exact payload shape, and a sample `TraceStep` has no `children` property.

---

### `tests/unit/tool-metadata.test.ts` and `tests/unit/mcp-server-tools.test.ts` (test, request-response)

**Analogs:** metadata registry tests and native catalog tests

**Metadata description contract pattern** (`tests/unit/tool-metadata.test.ts` lines 142-149):
```typescript
it('uses the four-block XC-8 description template for every entry', () => {
  for (const entry of TOOL_METADATA) {
    expect(entry.description, entry.name).toContain('Summary:');
    expect(entry.description, entry.name).toContain('Use when:');
    expect(entry.description, entry.name).toContain('Do not use when:');
    expect(entry.description, entry.name).toContain('Example:');
  }
});
```

**Native catalog registration helper pattern** (`tests/unit/mcp-server-tools.test.ts` lines 30-45):
```typescript
function makeCatalogServer(): McpServer {
  return wrapServerWithToolCatalog(new McpServer({ name: 'test', version: '0.1.0' }));
}

function registerAllCurrentTools(server: McpServer): void {
  registerMemoryTools(server, mockConfig);
  registerDocumentTools(server, mockConfig);
  ...
  registerLlmTools(server, mockConfig);
  registerLlmUsageTools(server, mockConfig);
}
```

**Metadata coverage assertion pattern** (`tests/unit/mcp-server-tools.test.ts` lines 77-99):
```typescript
it('registers current tool modules into the native catalog', () => {
  const server = makeCatalogServer();

  expect(() => registerAllCurrentTools(server)).not.toThrow();

  const catalog = getNativeToolCatalog(server);
  const registeredNames = catalog.map((tool) => tool.name);

  expect(registeredNames).toContain('get_document');
  expect(registeredNames).toContain('call_model');
});

it('has central metadata for every currently registered native tool', () => {
  const server = makeCatalogServer();
  registerAllCurrentTools(server);
  const catalog = getNativeToolCatalog(server);

  expect(() => assertRegisteredToolsHaveMetadata(catalog)).not.toThrow();
});
```

**Apply to Phase 130:** Add assertions for `call_macro` metadata: admin tier, `llm` category, `delegatedHardExcludedReason` equal to `RECURSIVE_MODEL_REASON` value, not present in delegated read/write tiers, and legacy replacement suggestions for `get_briefing` / `insert_doc_link` remain unchanged. Update `registerAllCurrentTools` to include `registerMacroTools`; assert native catalog includes `call_macro` and registered description equals metadata description.

---

### `tests/unit/mcp-broker.test.ts` (test, request-response)

**Analog:** service unit tests with named Vitest imports and direct class/interface behavior assertions.

**Unit import style** (`tests/unit/write-lock.test.ts` lines 8-10):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { acquireLock, releaseLock, isLocked } from '../../src/services/write-lock.js';
import type { LockOptions } from '../../src/services/write-lock.js';
```

**Apply to Phase 130:** Create a lightweight test:

```typescript
import { describe, expect, it } from 'vitest';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';

describe('NullMcpBroker', () => {
  it('reports every server as disconnected', async () => {
    await expect(new NullMcpBroker().isConnected('external')).resolves.toBe(false);
  });

  it('returns no tool handler for every tool', () => {
    expect(new NullMcpBroker().getToolHandler('external', 'tool')).toBeNull();
  });
});
```

---

### `tests/unit/archive-document.test.ts` (test, request-response + file-I/O)

**Analog:** existing archive helper/source assertions

**Current source-inspection test pattern** (lines 46-58):
```typescript
it('keeps batch archive runtime failures inside positional JSON results', () => {
  const source = readFileSync('src/mcp/tools/documents.ts', 'utf8');
  const archiveSection = source.slice(
    source.indexOf("'archive_document'"),
    source.indexOf("'search_documents'")
  );

  expect(archiveSection).toContain('Supabase archive update failed');
  expect(archiveSection).toContain("error: 'runtime_error'");
  expect(archiveSection).toContain('return jsonToolResult(isBatch ? results : results[0])');
});
```

**Apply to Phase 130:** Either extend this file or add a more behavioral handler test. Minimum assertions should prove the `archive_document` section contains `acquireLock`, `releaseLock`, `'documents'`, `lock_contention`, and `finally`. Prefer behavioral tests if mocking handler registration is practical.

---

### `tests/integration/archive-document-lock.test.ts` and `tests/config/vitest.integration.config.ts` (test/config, request-response + file-I/O + CRUD)

**Analog:** `tests/integration/remove-document.integration.test.ts`

**Integration setup pattern** (lines 1-24, 28-58):
```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const TEST_INSTANCE_ID = `remove-document-${randomUUID().slice(0, 8)}`;
```

**Handler capture pattern** (lines 60-79):
```typescript
function createHandlers(config: FlashQueryConfig): Record<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerDocumentTools(server, config);
  return handlers;
}

function parseResult<T extends Record<string, unknown> = Record<string, unknown>>(result: unknown): T {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text) as T;
}
```

**Lifecycle and skip pattern** (lines 81-115):
```typescript
describe.skipIf(!HAS_SUPABASE)('remove_document integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-remove-document-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
    handlers = createHandlers(config);
  }, 60_000);

  beforeEach(async () => {
    await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await initVault(config);
    handlers = createHandlers(config);
  });
```

**Explicit include-list pattern** (`tests/config/vitest.integration.config.ts` lines 4-14):
```typescript
export default defineConfig({
  test: {
    root: resolve(import.meta.dirname, '../..'),
    include: [
      'tests/integration/documents.integration.test.ts',
      'tests/integration/save-memory-tags.test.ts',
      'tests/integration/compound-tools.integration.test.ts',
      'tests/integration/llm-config-sync.test.ts',
      'tests/integration/tool-registry.test.ts',
    ],
    setupFiles: ['tests/helpers/setup-build.ts', 'tests/helpers/setup-env.ts'],
```

**Apply to Phase 130:** New integration file should use `describe.skipIf(!HAS_SUPABASE)`, temporary vaults, direct handler capture, and config with `locking: { enabled: true, ttlSeconds: 30 }`. Add the new test path to `include`, otherwise it will not run.

## Shared Patterns

### MCP Tool Registration
**Source:** `src/mcp/tool-catalog.ts` lines 30-56 and `src/mcp/server.ts` lines 445-463  
**Apply to:** `src/mcp/tools/macro.ts`, `src/mcp/server.ts`, metadata/catalog tests
```typescript
server.registerTool = ((name: string, config: ToolRegistrationConfig, cb: unknown) => {
  if (options.hostEnabledToolNames && !options.hostEnabledToolNames.has(name)) {
    return undefined;
  }

  const metadataDescription = getToolMetadata(name)?.description;
  const registeredConfig = metadataDescription === undefined
    ? config
    : { ...config, description: metadataDescription };
  const handler: NativeToolHandler = async (args, context) => {
    return await (cb as NativeToolHandler)(args, context);
  };
  catalog.push({ name, description: registeredConfig.description ?? '', inputSchema: registeredConfig.inputSchema ?? {}, handler });
  return originalRegisterTool(name, registeredConfig, cb as never);
}) as RegisterToolFunction;
```

### Expected vs Runtime Errors
**Source:** `src/mcp/utils/response-formats.ts` lines 111-139  
**Apply to:** `src/mcp/tools/macro.ts`, `src/mcp/tools/documents.ts`, tests
```typescript
export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}

function jsonRuntimeErrorFromEnvelope(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: true };
}
```

### Write Locking
**Source:** `src/mcp/tools/documents.ts` lines 1026-1040 and 1219-1227  
**Apply to:** `archive_document` lock fix
```typescript
if (config.locking.enabled) {
  const locked = await acquireLock(supabaseManager.getClient(), config.instance.id, 'documents', {
    ttlSeconds: config.locking.ttlSeconds,
  });
  if (!locked) {
    return jsonExpectedError({
      error: 'conflict',
      message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
      details: { reason: 'lock_contention' },
    });
  }
}

try {
  // mutation
} finally {
  if (config.locking.enabled) {
    await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
  }
}
```

### Native Handler Type Compatibility
**Source:** `src/llm/tool-registry.ts` lines 14-30  
**Apply to:** `src/services/mcp-broker.ts`
```typescript
export type NativeToolHandler = (
  args: Record<string, unknown>,
  context: NativeToolDispatchContext
) => Promise<NativeToolResponse>;
```

### Test Imports
**Source:** `tests/unit/response-formats.test.ts` lines 1-33 and `tests/integration/remove-document.integration.test.ts` lines 1-24  
**Apply to:** all Phase 130 tests
```typescript
import { describe, it, expect } from 'vitest';
import { ... } from '../../src/.../*.js';
```

Use `.js` extensions for source imports in TypeScript tests.

## No Analog Found

No Phase 130 file is without an analog. `src/services/mcp-broker.ts` has no broker-specific implementation analog, but it has strong local analogs for interface/class shape (`src/llm/client.ts`) and handler callable compatibility (`src/llm/tool-registry.ts`).

## Metadata

**Analog search scope:** `src/mcp`, `src/services`, `src/llm`, `tests/unit`, `tests/integration`, `tests/config`  
**Files scanned:** 100+ via `rg --files`; 15 source/test/config files read for concrete excerpts  
**Pattern extraction date:** 2026-05-14  
**Project instructions applied:** `AGENTS.md` read; local `.agents/skills/*/SKILL.md` indexes reviewed.
