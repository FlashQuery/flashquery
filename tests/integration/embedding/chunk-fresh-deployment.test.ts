import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { initLogger } from '../../../src/logging/logger.js';
import { registerCompoundTools } from '../../../src/mcp/tools/compound.js';
import { registerDocumentTools } from '../../../src/mcp/tools/documents.js';
import { MAINTENANCE_ACTIONS } from '../../../src/mcp/tools/scan.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { initVault } from '../../../src/storage/vault.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-chunk-fresh-deployment-test';

const managedColumns = [
  'embedding_primary',
  'embedding_primary_model',
  'embedding_primary_dimensions',
  'embedding_primary_provider',
  'embedding_primary_truncated',
  'embedding_primary_indexed_at',
] as const;

function configWithEmbeddings(embeddings: FlashQueryConfig['embeddings'], vaultPath?: string): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  if (vaultPath) {
    config.instance.vault.path = vaultPath;
  }
  config.llm = {
    providers: [{ name: 'fresh_provider', type: 'openai', endpoint: 'https://embedding.test', apiKey: 'sk-test' }],
    models: [],
    purposes: [],
  };
  config.embeddings = embeddings;
  return config;
}

async function cleanupPrimarySchema(client: pg.Client): Promise<void> {
  await client.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_chunks WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DROP FUNCTION IF EXISTS match_memories_primary(vector, double precision, integer, text[], text, text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS match_chunks_primary(vector, double precision, integer, text, text[], text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS match_documents_primary(vector, double precision, integer, text, text[], text, boolean)');
  for (const table of ['fqc_chunks', 'fqc_memory', 'fqc_documents'] as const) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_primary`);
    for (const column of managedColumns) {
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column} CASCADE`);
    }
  }
}

async function functionExists(client: pg.Client, functionName: string): Promise<boolean> {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = $1
    ) AS exists
    `,
    [functionName]
  );
  return result.rows[0].exists === true;
}

function createMockServer(): {
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>;
  server: McpServer;
} {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _config: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name) => handlers[name]! };
}

function parseToolJson<T>(result: unknown): T {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text) as T;
}

async function columnExists(client: pg.Client, tableName: string, columnName: string): Promise<boolean> {
  const result = await client.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS exists
    `,
    [tableName, columnName]
  );
  return result.rows[0].exists === true;
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk fresh deployment guards', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanupPrimarySchema(client);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  }, 60000);

  afterAll(async () => {
    await cleanupPrimarySchema(client).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  }, 60000);

  it('T-I-028 fresh deployment writes documents into chunks and searches through matched_chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    } as Response);

    const vaultPath = await mkdtemp(join(tmpdir(), 'embedding-chunk-fresh-deployment-'));
    try {
      const config = configWithEmbeddings([
        {
          name: 'primary',
          dimensions: 3,
          endpoints: [{ providerName: 'fresh_provider', model: 'fresh-model' }],
        },
      ], vaultPath);
      initLogger(config);
      await initSupabase(config);
      await initVault(config);
      await syncEmbeddingCatalog(config);

      const { server, getHandler } = createMockServer();
      registerDocumentTools(server, config);
      registerCompoundTools(server, config);

      const writeResult = await getHandler('write_document')({
        mode: 'create',
        path: 'fresh-deployment/chunk-search.md',
        title: 'Fresh Deployment Chunk Search',
        content: 'Chunk search content proves first-time enablement uses chunk vectors.',
        tags: ['fresh-deployment'],
      });
      const written = parseToolJson<{ fq_id: string; path: string; warnings?: string[] }>(writeResult);
      expect(written).toMatchObject({
        fq_id: expect.any(String),
        path: 'fresh-deployment/chunk-search.md',
      });
      expect(written.warnings).toBeUndefined();

      const chunkRows = await client.query(
        `
        SELECT id, document_id, heading_path, content, embedding_primary IS NOT NULL AS has_embedding
        FROM fqc_chunks
        WHERE instance_id = $1
          AND document_id = $2
        ORDER BY chunk_index
        `,
        [TEST_INSTANCE_ID, written.fq_id]
      );
      expect(chunkRows.rows).toEqual([
        expect.objectContaining({
          document_id: written.fq_id,
          heading_path: 'Fresh Deployment Chunk Search',
          content: expect.stringContaining('first-time enablement'),
          has_embedding: true,
        }),
      ]);

      const searchResult = await getHandler('search')({
        query: 'first-time enablement chunk vectors',
        mode: 'semantic',
        entity_types: ['documents'],
        limit: 1,
      });
      const payload = parseToolJson<{
        results: Array<{ path: string; matched_chunks: Array<{ chunk_id: string; breadcrumb: string }> }>;
      }>(searchResult);
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0]).toMatchObject({
        path: 'fresh-deployment/chunk-search.md',
        matched_chunks: [
          expect.objectContaining({
            chunk_id: chunkRows.rows[0].id,
            breadcrumb: 'Fresh Deployment Chunk Search',
          }),
        ],
      });

      await expect(columnExists(client, 'fqc_documents', 'embedding_primary')).resolves.toBe(false);
      await expect(functionExists(client, 'match_documents_primary')).resolves.toBe(false);
    } finally {
      await rm(vaultPath, { recursive: true, force: true });
    }
  }, 90_000);

  it('T-I-012 fresh DDL exposes chunks as the only document semantic target', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    await expect(columnExists(client, 'fqc_chunks', 'embedding_primary')).resolves.toBe(true);
    await expect(columnExists(client, 'fqc_chunks', 'embedding_primary_indexed_at')).resolves.toBe(true);
    await expect(functionExists(client, 'match_chunks_primary')).resolves.toBe(true);
    await expect(columnExists(client, 'fqc_documents', 'embedding_primary')).resolves.toBe(false);
    await expect(columnExists(client, 'fqc_documents', 'embedding_primary_indexed_at')).resolves.toBe(false);
    await expect(functionExists(client, 'match_documents_primary')).resolves.toBe(false);
    await expect(columnExists(client, 'fqc_documents', 'embedding')).resolves.toBe(false);
    await expect(functionExists(client, 'match_documents')).resolves.toBe(false);
  });

  it('T-I-013 no maintain_vault cleanup action is registered for legacy document vectors', async () => {
    expect(MAINTENANCE_ACTIONS).toEqual(expect.arrayContaining([
      'sync',
      'repair',
      'status',
      'backfill_embeddings',
      'rebuild_embeddings',
      'retire_embedding',
      'abort',
    ]));
    expect(MAINTENANCE_ACTIONS).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/document.*vector|vector.*document|legacy/i),
    ]));
  });
});
