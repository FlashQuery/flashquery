import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildSchemaDDL, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { verifySchema } from '../../../src/storage/schema-verify.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initVault } from '../../../src/storage/vault.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import { registerPluginTools } from '../../../src/mcp/tools/plugins.js';
import { registerMemoryTools } from '../../../src/mcp/tools/memory.js';
import { registerDocumentTools } from '../../../src/mcp/tools/documents.js';
import { registerCompoundTools } from '../../../src/mcp/tools/compound.js';
import { registerRecordTools } from '../../../src/mcp/tools/records.js';
import { initPlugins } from '../../../src/plugins/manager.js';
import {
  EMBEDDING_DEFERRED_WARNING,
  documentEmbeddingTarget,
  memoryEmbeddingTarget,
  recordEmbeddingTarget,
  scheduleBackgroundEmbedding,
} from '../../../src/embedding/background-embed.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-146-background-embed';
const TEST_PLUGIN_ID = 'phase146_embed_records';
const TEST_PLUGIN_TABLE = `fqcp_${TEST_PLUGIN_ID}_default_contacts`;

vi.mock('../../../src/services/plugin-reconciliation.js', () => ({
  reconcilePluginDocuments: vi.fn().mockResolvedValue({
    pluginId: 'phase146_embed_records',
    instanceId: 'default',
    classified: { autoTrack: [], archive: [], resurrect: [], updatePath: [], syncFields: [], createPendingReview: [], clearPendingReview: [] },
    stale: false,
    cacheHit: false,
  }),
  executeReconciliationActions: vi.fn().mockResolvedValue({
    autoTracked: 0,
    archived: 0,
    resurrected: 0,
    pathsUpdated: 0,
    fieldsSynced: 0,
    pendingReviewsCreated: 0,
    pendingReviewsCleared: 0,
  }),
  invalidateReconciliationCache: vi.fn(),
  ensureLastSeenColumn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/embedding/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/embedding/provider.js')>();
  return {
    ...actual,
    embeddingProvider: {
      embed: vi.fn(async () => {
        throw new Error('forced provider failure');
      }),
      getDimensions: vi.fn(() => 1536),
    },
  };
});

const REQUIRED_PENDING_COLUMNS = [
  'id',
  'instance_id',
  'target_kind',
  'target_table',
  'target_id',
  'target_label',
  'embed_text',
  'attempt_count',
  'last_error',
  'last_attempt_at',
  'next_retry_at',
  'status',
  'created_at',
  'updated_at',
] as const;

const TEST_PLUGIN_SCHEMA = `
plugin:
  id: ${TEST_PLUGIN_ID}
  name: Phase 146 Embed Records
  version: 1
tables:
  - name: contacts
    embed_fields:
      - notes
    columns:
      - name: name
        type: text
        required: true
      - name: notes
        type: text
`.trim();

const failingProvider: EmbeddingProvider = {
  embed: async () => {
    throw new Error('forced provider failure');
  },
  getDimensions: () => 1536,
};

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-146-background-embed', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

function createMockServer(): {
  server: McpServer;
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
} {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: vi.fn(
      (name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
        handlers[name] = handler;
      }
    ),
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function parseJsonResult(result: unknown): Record<string, unknown> {
  const toolResult = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  expect(toolResult.isError).toBeUndefined();
  expect(toolResult.content[0]).toMatchObject({ type: 'text' });
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>;
}

describe('pending embedding schema foundation', () => {
  it('buildSchemaDDL creates fqc_pending_embeds with target metadata and retry indexes', () => {
    const ddl = buildSchemaDDL(1536);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_pending_embeds');
    for (const column of REQUIRED_PENDING_COLUMNS) {
      expect(ddl).toContain(column);
    }
    expect(ddl).toContain('target_kind');
    expect(ddl).toContain('attempt_count');
    expect(ddl).toContain('last_attempt_at');
    expect(ddl).toMatch(/UNIQUE INDEX IF NOT EXISTS .*fqc_pending_embeds.*instance_id.*target_kind.*target_table.*target_id/s);
    expect(ddl).toMatch(/INDEX IF NOT EXISTS .*fqc_pending_embeds.*instance_id.*status.*next_retry_at/s);
    expect(ddl).toMatch(/INDEX IF NOT EXISTS .*fqc_pending_embeds.*instance_id.*target_kind.*target_id/s);
  });
});

describe.skipIf(!HAS_SUPABASE)('pending embedding schema bootstrap (integration)', () => {
  let client: pg.Client;
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'phase-146-background-embed-'));
    config = makeConfig();
    config.instance.vault.path = vaultPath;
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    await initPlugins(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(TEST_PLUGIN_TABLE)}`).catch(() => undefined);
    try {
      await supabaseManager.getClient()
        .from('fqc_plugin_registry')
        .delete()
        .eq('plugin_id', TEST_PLUGIN_ID)
        .eq('instance_id', TEST_INSTANCE_ID);
    } catch {
      // Cleanup should not mask the behavior assertions above.
    }
    await client?.end();
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager?.close();
  });

  it('verifySchema accepts the bootstrapped pending embedding table and required columns', async () => {
    await expect(verifySchema(client)).resolves.toBeUndefined();

    const result = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_pending_embeds'
      `
    );
    const columns = new Set(result.rows.map((row: { column_name: string }) => row.column_name));
    for (const column of REQUIRED_PENDING_COLUMNS) {
      expect(columns.has(column)).toBe(true);
    }
  });

  it('forced provider failure creates pending rows for document, memory, and record targets', async () => {
    const supabase = supabaseManager.getClient();
    const targets = [
      documentEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: 'doc-target', label: 'Doc target' }),
      memoryEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: 'memory-target', label: 'Memory target' }),
      recordEmbeddingTarget({
        instanceId: TEST_INSTANCE_ID,
        targetTable: 'fqcp_phase146_records',
        id: 'record-target',
        label: 'Record target',
      }),
    ];

    for (const target of targets) {
      const result = await scheduleBackgroundEmbedding({
        target,
        embedText: `${target.kind} retry text`,
        provider: failingProvider,
        supabase,
      });

      expect(result.warnings).toEqual([EMBEDDING_DEFERRED_WARNING]);
    }

    const { rows } = await client.query(
      `
      SELECT target_kind, target_table, target_id, target_label, embed_text, attempt_count, last_error, last_attempt_at, status
      FROM fqc_pending_embeds
      WHERE instance_id = $1
      ORDER BY target_kind
      `,
      [TEST_INSTANCE_ID]
    );

    expect(rows).toEqual([
      expect.objectContaining({
        target_kind: 'document',
        target_table: 'fqc_documents',
        target_id: 'doc-target',
        target_label: 'Doc target',
        embed_text: 'document retry text',
        attempt_count: 1,
        last_error: 'forced provider failure',
        status: 'pending',
      }),
      expect.objectContaining({
        target_kind: 'memory',
        target_table: 'fqc_memory',
        target_id: 'memory-target',
        target_label: 'Memory target',
        embed_text: 'memory retry text',
        attempt_count: 1,
        last_error: 'forced provider failure',
        status: 'pending',
      }),
      expect.objectContaining({
        target_kind: 'record',
        target_table: 'fqcp_phase146_records',
        target_id: 'record-target',
        target_label: 'Record target',
        embed_text: 'record retry text',
        attempt_count: 1,
        last_error: 'forced provider failure',
        status: 'pending',
      }),
    ]);
    for (const row of rows) {
      expect(row.last_attempt_at).toBeTruthy();
    }
  });

  it('write_memory remains successful and returns embedding_deferred when embedding fails', async () => {
    const { server, getHandler } = createMockServer();
    registerMemoryTools(server, config);

    const result = await getHandler('write_memory')({
      mode: 'create',
      content: 'Memory content that forces a deferred embedding warning',
      tags: ['phase146'],
    });
    const payload = parseJsonResult(result);

    expect(payload).toMatchObject({
      memory_id: expect.any(String),
      warnings: [EMBEDDING_DEFERRED_WARNING],
    });

    const { rows } = await client.query(
      `
      SELECT target_kind, target_table, target_id, embed_text, last_error, status
      FROM fqc_pending_embeds
      WHERE instance_id = $1
        AND target_kind = 'memory'
        AND target_id = $2
      `,
      [TEST_INSTANCE_ID, payload.memory_id]
    );
    expect(rows).toEqual([
      expect.objectContaining({
        target_kind: 'memory',
        target_table: 'fqc_memory',
        target_id: payload.memory_id,
        embed_text: 'Memory content that forces a deferred embedding warning',
        last_error: 'forced provider failure',
        status: 'pending',
      }),
    ]);
  });

  it('write_document remains successful and returns embedding_deferred when embedding fails', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const result = await getHandler('write_document')({
      mode: 'create',
      path: 'phase-146/deferred-warning.md',
      title: 'Deferred Warning Document',
      content: 'Document content that forces a deferred embedding warning',
      tags: ['phase146'],
    });
    const payload = parseJsonResult(result);

    expect(payload).toMatchObject({
      path: 'phase-146/deferred-warning.md',
      fq_id: expect.any(String),
      warnings: [EMBEDDING_DEFERRED_WARNING],
    });

    const { rows } = await client.query(
      `
      SELECT target_kind, target_table, target_id, target_label, embed_text, last_error, status
      FROM fqc_pending_embeds
      WHERE instance_id = $1
        AND target_kind = 'document'
        AND target_id = $2
      `,
      [TEST_INSTANCE_ID, payload.fq_id]
    );
    expect(rows).toEqual([
      expect.objectContaining({
        target_kind: 'document',
        target_table: 'fqc_documents',
        target_id: payload.fq_id,
        target_label: 'phase-146/deferred-warning.md',
        embed_text: 'Deferred Warning Document\n\nDocument content that forces a deferred embedding warning',
        last_error: 'forced provider failure',
        status: 'pending',
      }),
    ]);
  });

  it('insert_in_doc remains successful and returns embedding_deferred when embedding fails', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    const createResult = await getHandler('write_document')({
      mode: 'create',
      path: 'phase-146/compound-warning.md',
      title: 'Compound Warning Document',
      content: 'Original compound body',
      tags: ['phase146'],
    });
    const created = parseJsonResult(createResult);

    const insertResult = await getHandler('insert_in_doc')({
      identifier: 'phase-146/compound-warning.md',
      position: 'bottom',
      content: 'Appended compound content',
    });
    const payload = parseJsonResult(insertResult);

    expect(payload).toMatchObject({
      path: 'phase-146/compound-warning.md',
      fq_id: created.fq_id,
      warnings: [EMBEDDING_DEFERRED_WARNING],
    });

    const { rows } = await client.query(
      `
      SELECT target_kind, target_table, target_id, target_label, embed_text, last_error, status
      FROM fqc_pending_embeds
      WHERE instance_id = $1
        AND target_kind = 'document'
        AND target_id = $2
      `,
      [TEST_INSTANCE_ID, created.fq_id]
    );
    expect(rows).toEqual([
      expect.objectContaining({
        target_kind: 'document',
        target_table: 'fqc_documents',
        target_id: created.fq_id,
        target_label: 'phase-146/compound-warning.md',
        embed_text: expect.stringContaining('Appended compound content'),
        last_error: 'forced provider failure',
        status: 'pending',
      }),
    ]);
  });

  it('write_record remains successful and returns embedding_deferred when embedding fails', async () => {
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);
    await getHandler('register_plugin')({ schema_yaml: TEST_PLUGIN_SCHEMA });

    const result = await getHandler('write_record')({
      mode: 'create',
      plugin_id: TEST_PLUGIN_ID,
      table: 'contacts',
      data: {
        name: 'Embedding Warning Contact',
        notes: 'Record notes that force a deferred embedding warning',
      },
    });
    const payload = parseJsonResult(result);

    expect(payload).toMatchObject({
      id: expect.any(String),
      plugin_id: TEST_PLUGIN_ID,
      table: 'contacts',
      warnings: [EMBEDDING_DEFERRED_WARNING],
    });

    const { rows } = await client.query(
      `
      SELECT target_kind, target_table, target_id, embed_text, last_error, status
      FROM fqc_pending_embeds
      WHERE instance_id = $1
        AND target_kind = 'record'
        AND target_table = $2
        AND target_id = $3
      `,
      [TEST_INSTANCE_ID, TEST_PLUGIN_TABLE, payload.id]
    );
    expect(rows).toEqual([
      expect.objectContaining({
        target_kind: 'record',
        target_table: TEST_PLUGIN_TABLE,
        target_id: payload.id,
        embed_text: 'Record notes that force a deferred embedding warning',
        last_error: 'forced provider failure',
        status: 'pending',
      }),
    ]);
  });
});
