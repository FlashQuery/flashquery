# Phase 145: Silent Failure Quick Wins - Pattern Map

**Mapped:** 2026-05-24
**Files analyzed:** 12
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/mcp/tools/memory.ts` | controller | request-response + CRUD | `src/mcp/tools/memory.ts` | exact |
| `src/mcp/tool-help/write_memory.tool.md` | config | request-response docs | `src/mcp/tool-help/write_memory.tool.md` | exact |
| `src/mcp/tool-metadata.ts` | config | transform | `src/mcp/tool-metadata.ts` | exact |
| `src/services/scanner.ts` | service | file-I/O + batch | `src/services/scanner.ts` | exact |
| `src/services/maintenance.ts` | service | request-response + batch | `src/services/maintenance.ts` | exact |
| `src/mcp/tools/scan.ts` | controller | request-response | `src/mcp/tools/scan.ts` | exact |
| `tests/unit/write-memory.test.ts` | test | request-response + CRUD | `tests/unit/write-memory.test.ts` | exact |
| `tests/unit/scanner-embed-drain-status.test.ts` | test | file-I/O + batch | `tests/unit/scanner.test.ts` | role-match |
| `tests/unit/maintain-vault.test.ts` | test | request-response + batch | `tests/unit/maintain-vault.test.ts` | exact |
| `tests/integration/write-memory.integration.test.ts` or `tests/integration/mcp/tools/memory-plugin-scope.test.ts` | test | request-response + CRUD | `tests/integration/write-memory.integration.test.ts` | exact |
| `tests/integration/services/scanner-embed-drain.test.ts` | test | file-I/O + batch | `tests/integration/maintain-vault.integration.test.ts` | role-match |
| `tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py` | test | request-response | `tests/scenarios/directed/testcases/test_memory_plugin_scope.py` | exact |

## Pattern Assignments

### `src/mcp/tools/memory.ts` (controller, request-response + CRUD)

**Analog:** `src/mcp/tools/memory.ts`

**Imports and response-helper pattern** (lines 1-21):
```typescript
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult } from '../utils/response-formats.js';
```

**Current plugin-scope lookup to replace** (lines 60-78):
```typescript
async function resolvePluginScope(config: FlashQueryConfig, pluginScope: string | undefined): Promise<string> {
  if (!pluginScope || pluginScope === 'global') return 'global';
  try {
    const { data: matchedScope, error: rpcError } = await (supabaseManager.getClient()
      .rpc('find_plugin_scope', { search_name: pluginScope, p_instance_id: config.instance.id, threshold: 0.8 }) as unknown as Promise<{ data: string; error: { message: string } | null }>);
    if (rpcError) {
      logger.warn(`write_memory: plugin_scope lookup failed: ${rpcError.message} - defaulting to 'global'`);
      return 'global';
    }
    return matchedScope || 'global';
  } catch (err) {
    logger.warn(`write_memory: plugin_scope lookup error: ${err instanceof Error ? err.message : String(err)} - defaulting to 'global'`);
    return 'global';
  }
}
```

**Create-mode insertion point** (lines 210-254):
```typescript
const supabase = supabaseManager.getClient();
if (params.mode === 'create') {
  const resolvedScope = await resolvePluginScope(config, params.plugin_scope as string | undefined);
  const memoryId = randomUUID();
  const insertRow = {
    id: memoryId,
    instance_id: config.instance.id,
    content: params.content as string,
    tags: tagsValidation.normalized,
    plugin_scope: resolvedScope,
    status: 'active',
    version: 1,
    previous_version_id: null,
    chain_root_id: memoryId,
    is_latest: true,
    archived_at: null,
    embedding: null,
  };
```

**Error envelope pattern to copy** (lines 46-52, 330-333):
```typescript
function expectedInvalidInput(message: string, details?: Record<string, unknown>, identifier?: string) {
  return jsonExpectedError({
    error: 'invalid_input',
    message,
    ...(identifier !== undefined ? { identifier } : {}),
    ...(details ? { details } : {}),
  });
}

logger.error(`write_memory failed: ${msg}`);
return jsonRuntimeError(msg);
```

**Planner note:** Add a discriminated result such as `{ ok: true; scope: string } | { ok: false; reason: 'lookup_failed'; message: string }`. In create mode, return `jsonExpectedError({ error: 'lookup_failed', message, details: { reason: 'lookup_failed' } })` before `insertRow` is built; the Phase 145 locked decision treats lookup failure as an anticipated expected JSON error, not a runtime `isError: true` response. Keep omitted/`global` as `{ ok: true; scope: 'global' }`. Model the RPC response with a local interface plus runtime narrowing, following the existing `searchMemoriesSemantic` direct `rpcResult as { data: unknown; error: ... }` style at `src/mcp/tools/memory.ts` lines 145-158, but avoid the current double assertion.

### `src/mcp/utils/response-formats.ts` (shared MCP error envelopes)

**Analog:** `src/mcp/utils/response-formats.ts`

**Contract comments and runtime/expected split** (lines 5-9, 184-221):
```typescript
// JSON helpers return MCP text content whose text parses as JSON
// Expected errors are structured JSON and do not set runtime isError semantics
// Runtime errors set isError: true

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}

export function jsonRuntimeError(message: string, details?: object): ToolResult;
export function jsonRuntimeError(error: RuntimeErrorInput): ToolResult;

function jsonRuntimeErrorFromEnvelope(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: true };
}
```

**Planner note:** REQ-001 says RPC errors and thrown lookup failures return an MCP error envelope. Because these are underlying operation failures, use the runtime pattern (`isError: true`) and include parseable `reason: 'lookup_failed'` in `details`.

### `src/services/scanner.ts` (service, file-I/O + batch)

**Analog:** `src/services/scanner.ts`

**Status union to extend** (lines 29-36):
```typescript
export interface ScanResult {
  hashMismatches: number;
  statusMismatches: number;
  newFiles: number;
  movedFiles: number;
  deletedFiles: number;
  embeddingStatus: 'complete' | 'partial' | 'timed_out' | 'skipped';
  embedsAwaited: number;
}
```

**EMBED-DRAIN query/error flow to modify** (lines 1139-1190):
```typescript
try {
  const { data: unembeddedDocs, error: unembeddedErr } = await supabase
    .from('fqc_documents')
    .select('id, path, title')
    .eq('instance_id', instanceId)
    .eq('status', 'active')
    .is('embedding', null);

  if (unembeddedErr) {
    logger.warn(`[EMBED-DRAIN] failed to query unembedded docs: ${unembeddedErr.message}`);
  } else if (unembeddedDocs && unembeddedDocs.length > 0) {
    logger.info(`[EMBED-DRAIN] found ${unembeddedDocs.length} doc(s) with no embedding — draining`);
  }
} catch (drainQueryErr: unknown) {
  logger.warn(`[EMBED-DRAIN] unembedded-doc query threw: ${drainQueryErr instanceof Error ? drainQueryErr.message : String(drainQueryErr)}`);
}
```

**Final status precedence point** (lines 1192-1233):
```typescript
const embedsAwaited = embedPromises.length;
let embeddingStatus: ScanResult['embeddingStatus'] = 'skipped';

if (embedsAwaited > 0) {
  await Promise.race([
    Promise.allSettled(embedPromises).then(() => undefined),
    timeoutPromise,
  ]);

  if (timedOut) {
    embeddingStatus = 'timed_out';
  } else {
    embeddingStatus = 'complete';
  }
} else {
  embeddingStatus = 'complete';
}
```

**Planner note:** Add `drain_query_failed` to the union. Track a boolean like `drainQueryFailed`; set it for both `unembeddedErr` and thrown query failures. Use `logger.error` with stable text such as `[EMBED-DRAIN] drain_query_failed`. Preserve timeout precedence: if embed promises time out, keep `timed_out`; otherwise return `drain_query_failed` instead of falling through to `complete`.

### `src/services/maintenance.ts` and `src/mcp/tools/scan.ts` (consumer/controller)

**Analog:** `src/services/maintenance.ts`, `src/mcp/tools/scan.ts`

**ScanResult consumer currently hides scanner internals** (lines 223-232, 286-298):
```typescript
const result = await runScanOnce(config);
invalidateReconciliationCache();
results.push(maintenanceActionResult({
  action: 'sync',
  started_at: startedAt,
  finished_at: finishedAt,
  dry_run: false,
  counts: scanCounts(result),
  ...(getIsShuttingDown() ? { warnings: ['maintenance_aborted'] } : {}),
}));

function scanCounts(result: ScanResult): MaintenanceActionResult['counts'] {
  return {
    scanned: result.hashMismatches + result.statusMismatches + result.newFiles + result.movedFiles + result.deletedFiles,
    added: result.newFiles,
    updated: result.hashMismatches + result.movedFiles,
    repaired: 0,
    archived: result.deletedFiles,
  };
}
```

**MCP wrapping pattern** (lines 36-47):
```typescript
const result = await maintainVault(config, input);

if (result.ok) {
  return jsonToolResult(result.payload);
}

if (result.error.error === 'runtime_error') {
  return jsonRuntimeError(result.error);
}

return jsonExpectedError(result.error);
```

**Planner note:** `maintenance.ts` is currently a consumer because it accepts `ScanResult` and intentionally strips `embeddingStatus` from public output. Add explicit handling for `drain_query_failed`, probably as a sync warning such as `warnings: ['embedding_drain_query_failed']`, while preserving the existing unit expectation that raw `embedding_status` and `embeds_awaited` fields are not exposed.

### `src/mcp/tool-help/write_memory.tool.md` and `src/mcp/tool-metadata.ts` (docs/config)

**Analog:** `src/mcp/tool-help/write_memory.tool.md`, `src/mcp/tool-metadata.ts`

**Help arg table pattern** (lines 21-35):
```markdown
| `plugin_scope` | string | create only | `global` | Scope name resolved to a plugin scope when available. |

Returns JSON text with memory identification, timestamps, version metadata, optional requested include payloads, and tag/plugin scope data. Expected errors cover missing mode, invalid mode, invalid tags, generated fields, missing update IDs, non-latest updates, and missing memories.
```

**Metadata description pattern** (lines 124-129):
```typescript
writeMemory: description(
  'Create or update persistent memory through one explicit mode-based memory writer.',
  'Use when you need to save a new memory or create a new latest version of an existing memory.',
  'Do not use when you only need to retrieve or search memories; use get_memory or search instead.',
  'write_memory({ "mode": "create", "content": "The user prefers concise updates." })'
),
```

**Planner note:** Update help text where `plugin_scope` is documented to state that lookup failures are visible runtime errors with reason `lookup_failed` and do not create a global-scoped memory. `tool-metadata.ts` only needs a change if planner chooses to expose that behavior in the short native metadata description.

## Test Pattern Assignments

### `tests/unit/write-memory.test.ts` (test, request-response + CRUD)

**Analog:** `tests/unit/write-memory.test.ts`

**Mock imports and server capture** (lines 1-37):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn() },
}));

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = { registerTool: vi.fn((name, _config, handler) => { handlers[name] = handler; }) } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}
```

**Parse JSON text and assert expected-error envelopes** (lines 51-53, 71-82):
```typescript
function parseResult(result: unknown): Record<string, unknown> {
  const toolResult = result as { content: Array<{ text: string }>; isError?: boolean };
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>;
}

const missing = await handler({ content: 'remember this' }) as { isError?: boolean };
expect(missing.isError).toBe(false);
expect(parseResult(missing)).toMatchObject({ error: 'invalid_input', message: expect.stringContaining('mode is required') });
```

**Create insert-capture pattern** (lines 97-129):
```typescript
let capturedInsert: Record<string, unknown> = {};
const insertChain = makeThenableChain({ data: { id: 'mem-1', plugin_scope: 'global', is_latest: true }, error: null });
(insertChain.insert as ReturnType<typeof vi.fn>).mockImplementation((row: Record<string, unknown>) => {
  capturedInsert = row;
  return insertChain;
});
(supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(insertChain) });

const result = await getHandler('write_memory')({ mode: 'create', content: 'User prefers JSON' });
expect(capturedInsert).toMatchObject({ plugin_scope: 'global', is_latest: true });
```

**Planner note:** Put T-U-001 through T-U-003 in this file unless the helper tests become too large. Add mocked `rpc` cases for omitted/global, matched scope, RPC error, thrown RPC, and unexpected data shape. For failure cases, assert `result.isError === true`, parsed JSON has `error: 'lookup_failed'` or `details.reason: 'lookup_failed'`, and `from('fqc_memory').insert` was not called.

### `tests/unit/scanner-embed-drain-status.test.ts` or `tests/unit/scanner.test.ts` (test, file-I/O + batch)

**Analog:** `tests/unit/scanner.test.ts`

**Scanner mock setup pattern** (lines 15-23, 76-95, 111-137):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { titleFromFilename, runScanOnce, scanMutex, repairFrontmatter } from '../../src/services/scanner.js';

vi.mock('../../src/storage/supabase.js', () => {
  const createChainableQuery = () => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockResolvedValue({ data: [], error: null }),
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
  });
  return { supabaseManager: { getClient: vi.fn(() => ({ from: vi.fn().mockImplementation(createChainableQuery) })) } };
});

vi.mock('../../src/embedding/provider.js', () => ({
  embeddingProvider: { embed: vi.fn().mockResolvedValue(Array(1536).fill(0.1)) },
}));
vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
```

**Focused runScanOnce assertion style** (lines 896-904):
```typescript
const config = makeConfig();
const { readdir } = vi.mocked(fsPromises);
readdir.mockResolvedValueOnce([] as any);

const result = await runScanOnce(config);
expect(result).toBeDefined();
expect(result.newFiles).toBe(0);
```

**Planner note:** Prefer a new focused `tests/unit/scanner-embed-drain-status.test.ts` so the complex existing `scanner.test.ts` does not grow further. Mock the `fqc_documents` unembedded query chain through `.from().select().eq().eq().is()` to return `{ error: { message: 'boom' } }` and to throw. Assert `embeddingStatus === 'drain_query_failed'`, scan still resolves, and `logger.error` contains `[EMBED-DRAIN] drain_query_failed`.

### `tests/unit/maintain-vault.test.ts` (test, request-response + batch consumer)

**Analog:** `tests/unit/maintain-vault.test.ts`

**Service mock pattern** (lines 12-22, 75-88):
```typescript
const scannerMocks = vi.hoisted(() => ({
  runScanOnce: vi.fn(),
  repairFrontmatter: vi.fn(),
  reconcileTrackedDocuments: vi.fn(),
}));

vi.mock('../../src/services/scanner.js', () => ({
  runScanOnce: scannerMocks.runScanOnce,
  repairFrontmatter: scannerMocks.repairFrontmatter,
  reconcileTrackedDocuments: scannerMocks.reconcileTrackedDocuments,
}));

scannerMocks.runScanOnce.mockResolvedValue({
  hashMismatches: 3,
  statusMismatches: 1,
  newFiles: 2,
  movedFiles: 4,
  deletedFiles: 5,
  embeddingStatus: 'complete',
  embedsAwaited: 9,
});
```

**Public-output hiding pattern** (lines 346-363):
```typescript
const result = await handlers.maintain_vault({ action: 'sync' });
const payload = parseToolResult(result);

expect(payload.actions).toMatchObject([
  {
    action: 'sync',
    started_at: expect.any(String),
    finished_at: expect.any(String),
    dry_run: false,
    counts: { scanned: 3, added: 2, updated: 1, repaired: 0, archived: 0 },
  },
]);
expect(JSON.stringify(payload)).not.toContain('embedding_status');
expect(JSON.stringify(payload)).not.toContain('embeds_awaited');
```

**Planner note:** Add T-U-005 here. Mock `runScanOnce` with `embeddingStatus: 'drain_query_failed'` and assert the public response handles it explicitly, ideally by adding a stable warning while still not exposing raw scanner field names.

### `tests/integration/write-memory.integration.test.ts` (test, Supabase-backed request-response)

**Analog:** `tests/integration/write-memory.integration.test.ts`

**Integration config and skip pattern** (lines 1-11, 13-29, 46-60):
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initLogger } from '../../src/logging/logger.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-125-write-memory-integration';
const SKIP = !HAS_SUPABASE;

describe.skipIf(SKIP)('write_memory final contracts (integration)', () => {
  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
  }, 60_000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.close();
  });
```

**Handler invocation and DB verification pattern** (lines 62-110):
```typescript
const { server, getHandler } = createMockServer();
registerMemoryTools(server, config);

const createResult = await getHandler('write_memory')({
  mode: 'create',
  content: 'Phase 125 memory create integration.',
  tags: ['phase125', 'memory'],
  include: ['content', 'tags_full'],
}) as { isError?: boolean };
expect(createResult.isError).toBeFalsy();

const { data: rows, error: chainError } = await supabaseManager.getClient()
  .from('fqc_memory')
  .select('id, previous_version_id, is_latest, tags')
  .eq('instance_id', TEST_INSTANCE_ID);
expect(chainError).toBeNull();
```

**Planner note:** Put T-I-001 in a new `tests/integration/mcp/tools/memory-plugin-scope.test.ts` if subdirectories are acceptable; otherwise append to `write-memory.integration.test.ts`. Use the same `HAS_SUPABASE` skip and cleanup. To force lookup failure without changing production code, prefer a test-specific mocked handler at unit level; for integration, use an invalid/missing RPC condition only if it can be induced deterministically. If not, document skip/rationale in phase summary per context.

### `tests/integration/services/scanner-embed-drain.test.ts` (test, Supabase-backed file-I/O + batch)

**Analog:** `tests/integration/maintain-vault.integration.test.ts`

**Vault tempdir + Supabase lifecycle pattern** (lines 64-104):
```typescript
describe.skipIf(!HAS_SUPABASE)('maintain_vault integration', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let maintainVault: (params: Record<string, unknown>) => Promise<unknown>;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-maintain-vault-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
    maintainVault = createHandler(config);
  }, 30_000);

  afterAll(async () => {
    try {
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // Ignore cleanup failures in skipped or partially initialized environments.
    }
    await rm(vaultPath, { recursive: true, force: true });
  });
```

**Maintain-vault sync assertion pattern** (lines 106-115):
```typescript
await writeFile(join(vaultPath, 'external-sync.md'), '# External Sync\n\nCreated outside FlashQuery.');

const result = await maintainVault({ action: 'sync' });
const payload = parseResult(result);

expect(payload.actions).toMatchObject([
  { action: 'sync', counts: { scanned: expect.any(Number), added: expect.any(Number) } },
]);
```

**Planner note:** T-I-002 may be difficult to induce through real Supabase without schema/permission manipulation. If implemented, isolate it in `tests/integration/services/scanner-embed-drain.test.ts`, use a unique `TEST_INSTANCE_ID`, and restore any DB changes. If no deterministic Supabase failure can be created safely, skip with an explicit reason and rely on unit coverage plus directed public behavior only where observable.

### `tests/scenarios/directed/testcases/test_write_memory_plugin_scope_lookup_failure.py` (test, public MCP request-response)

**Analog:** `tests/scenarios/directed/testcases/test_memory_plugin_scope.py`

**Scenario identity and framework imports** (lines 36-47, 54-56):
```python
COVERAGE = ["M-15"]

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_memory_plugin_scope"
```

**Public tool call, JSON assertions, cleanup tracking** (lines 143-196):
```python
with TestContext(
    fqc_dir=args.fqc_dir,
    url=args.url,
    secret=args.secret,
    vault_path=getattr(args, "vault_path", None),
    managed=args.managed,
    port_range=port_range,
    require_embedding=False,
) as ctx:
    scoped_save_result = ctx.client.call_tool(
        "write_memory",
        mode="create",
        content=scoped_content,
        tags=["fqc-test", f"scope-test-{run.run_id}"],
        plugin_scope=plugin_id,
    )
    scoped_memory_id = _extract_memory_id(scoped_save_result.text)
    if scoped_memory_id:
        ctx.cleanup.track_mcp_memory(scoped_memory_id)
    scoped_save_result.expect_json_path("memory_id")
    scoped_save_result.expect_json_equals("plugin_scope", plugin_id)
```

**Cleanup and server-log attachment** (lines 331-377):
```python
for mid, label in [(scoped_memory_id, "scoped"), (fuzzy_memory_id, "fuzzy"), (global_memory_id, "global")]:
    if not mid:
        continue
    try:
        ctx.client.call_tool("archive_memory", memory_id=mid)
    except Exception as e:
        ctx.cleanup_errors.append(f"Cleanup archive_memory({label}={mid}) failed: {e}")

if ctx.server:
    run.attach_server_logs(ctx.server.captured_logs)

run.record_cleanup(ctx.cleanup_errors)
return run
```

**Writing guide rule** (lines 9-17, 119-135):
```markdown
Scenario tests assert on tool responses, vault filesystem state, and the tool's own return values. They do not query the database directly, read internal logs, or poke at private fields.

with TestContext(
    fqc_dir=args.fqc_dir,
    url=args.url,
    secret=args.secret,
    vault_path=getattr(args, "vault_path", None),
    managed=args.managed,
    port_range=port_range,
) as ctx:
```

**Planner note:** Add directed T-S-001 / D-68 only if unit and integration coverage do not prove public MCP behavior end to end. A pure RPC-outage simulation is not naturally public-surface controllable, so this may need managed-server config manipulation or a documented non-add if not deterministic. If added, update `tests/scenarios/directed/DIRECTED_COVERAGE.md`; the existing memory plugin-scope row is `M-15` at lines 413-437.

## Shared Patterns

### MCP Error Envelopes
**Source:** `src/mcp/utils/response-formats.ts` lines 184-221  
**Apply to:** `src/mcp/tools/memory.ts`, `src/mcp/tools/scan.ts`, tests asserting handler responses

Use `jsonExpectedError` for recoverable expected envelopes with `isError:false`; Phase 145 explicitly places `lookup_failed` in this category. Use `jsonRuntimeError` for generic runtime failures with `isError:true`. Parse test responses from `content[0].text` as JSON.

### Supabase RPC Typing
**Source:** `src/mcp/tools/memory.ts` lines 145-158 and 282-288  
**Apply to:** `resolvePluginScope` replacement

Existing code accepts local RPC result casts after awaiting, but Phase 145 must remove the double assertion at lines 63-68. Use an explicit local interface plus runtime narrowing:
```typescript
type FindPluginScopeRpcResult = { data: unknown; error: { message: string } | null };
const result = await supabaseManager.getClient().rpc('find_plugin_scope', {...});
const { data, error } = result as FindPluginScopeRpcResult;
```
Then narrow `data` to a string before returning a resolved scope.

### Integration Test Environment
**Source:** `tests/helpers/test-env.ts` lines 1-29  
**Apply to:** all Supabase-backed Phase 145 integration tests
```typescript
export const TEST_SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const TEST_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? '';
export const HAS_SUPABASE = !!(TEST_SUPABASE_URL && TEST_SUPABASE_KEY && TEST_DATABASE_URL);
```

### Scanner Consumer Privacy
**Source:** `tests/unit/maintain-vault.test.ts` lines 346-363  
**Apply to:** `maintenance.ts` and maintain-vault tests

Public `maintain_vault` responses should not leak raw scanner internals. If Phase 145 surfaces `drain_query_failed`, expose it as a stable warning or explicit public status field chosen in the plan, not as raw `embedding_status`/`embeds_awaited` snake_case internals.

## No Analog Found

None. Every Phase 145 file has either an exact existing file or a close role/data-flow analog.

## Metadata

**Analog search scope:** `src/mcp`, `src/services`, `tests/unit`, `tests/integration`, `tests/scenarios/directed`, `tests/scenarios/integration`  
**Files scanned:** 40+ targeted files via `rg`, with concrete excerpts from 14 files  
**Pattern extraction date:** 2026-05-24
