import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { initLogger } from '../../../src/logging/logger.js';
import {
  buildPluginEmbeddingColumnSetDDL,
  initSupabase,
  supabaseManager,
} from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-chunk-column-set-test';
const PLUGIN_TABLE = 'fqcp_chunk_column_probe';

const chunkColumns = [
  'embedding_primary',
  'embedding_primary_model',
  'embedding_primary_dimensions',
  'embedding_primary_provider',
  'embedding_primary_truncated',
  'embedding_primary_indexed_at',
] as const;
const memoryColumns = chunkColumns.filter((column) => column !== 'embedding_primary_indexed_at');

function configWithEmbeddings(embeddings: FlashQueryConfig['embeddings']): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = embeddings;
  return config;
}

async function cleanupPrimarySchema(client: pg.Client): Promise<void> {
  await client.query('DROP FUNCTION IF EXISTS match_memories_primary(vector, double precision, integer, text[], text, text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS match_chunks_primary(vector, double precision, integer, text, text[], text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS match_documents_primary(vector, double precision, integer, text, text[], text, boolean)');
  await client.query(`DROP FUNCTION IF EXISTS match_records_${PLUGIN_TABLE}_primary(vector, double precision, integer, text)`);
  for (const table of ['fqc_chunks', 'fqc_memory', 'fqc_documents', PLUGIN_TABLE]) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_primary`);
    for (const column of chunkColumns) {
      await client.query(`ALTER TABLE IF EXISTS ${table} DROP COLUMN IF EXISTS ${column} CASCADE`);
    }
    await client.query(`ALTER TABLE IF EXISTS ${table} DROP COLUMN IF EXISTS embedding_updated_at CASCADE`);
  }
  await client.query(`DROP TABLE IF EXISTS ${PLUGIN_TABLE}`);
}

async function getColumnMetadata(client: pg.Client, tableName: string): Promise<Map<string, string>> {
  const result = await client.query(
    `
    SELECT c.column_name, format_type(a.atttypid, a.atttypmod) AS formatted_type
    FROM information_schema.columns c
    JOIN pg_class cl ON cl.relname = c.table_name
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = c.table_schema
    JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name = $1
      AND c.column_name = ANY($2::text[])
    ORDER BY c.column_name
    `,
    [tableName, [...chunkColumns, 'embedding_updated_at']]
  );
  return new Map(result.rows.map((row: { column_name: string; formatted_type: string }) => [row.column_name, row.formatted_type]));
}

async function indexExists(client: pg.Client, indexName: string): Promise<boolean> {
  const result = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1) AS exists`,
    [indexName]
  );
  return result.rows[0].exists === true;
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk embedding column set creation', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await cleanupPrimarySchema(client);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    vi.restoreAllMocks();
  }, 60000);

  afterAll(async () => {
    await cleanupPrimarySchema(client).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  }, 60000);

  it('T-I-004 config sync creates six per-entry columns and an HNSW index on fqc_chunks', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    const columns = await getColumnMetadata(client, 'fqc_chunks');
    expect(columns.get('embedding_primary')).toBe('vector(96)');
    expect(columns.get('embedding_primary_model')).toBe('text');
    expect(columns.get('embedding_primary_dimensions')).toBe('integer');
    expect(columns.get('embedding_primary_provider')).toBe('text');
    expect(columns.get('embedding_primary_truncated')).toBe('boolean');
    expect(columns.get('embedding_primary_indexed_at')).toBe('timestamp with time zone');
    expect(await indexExists(client, 'idx_fqc_chunks_embedding_primary')).toBe(true);
  });

  it('T-I-005 config sync does not create per-entry document columns on fqc_documents', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    const documentColumns = await getColumnMetadata(client, 'fqc_documents');
    for (const column of chunkColumns) {
      expect(documentColumns.has(column)).toBe(false);
    }
    expect(await indexExists(client, 'idx_fqc_documents_embedding_primary')).toBe(false);
  });

  it('T-I-006 memory and plugin tables preserve AS-BUILT column-set behavior', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    const memory = await getColumnMetadata(client, 'fqc_memory');
    for (const column of memoryColumns) {
      expect(memory.has(column)).toBe(true);
    }
    expect(memory.has('embedding_primary_indexed_at')).toBe(false);

    await client.query(`
      CREATE TABLE ${PLUGIN_TABLE} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instance_id TEXT NOT NULL,
        status TEXT DEFAULT 'active'
      )
    `);
    await client.query(buildPluginEmbeddingColumnSetDDL(PLUGIN_TABLE, { name: 'primary', dimensions: 96 }));
    const plugin = await getColumnMetadata(client, PLUGIN_TABLE);
    for (const column of memoryColumns) {
      expect(plugin.has(column)).toBe(true);
    }
    expect(plugin.has('embedding_primary_indexed_at')).toBe(false);
    expect(plugin.has('embedding_updated_at')).toBe(true);
  });

  it('T-I-007 orphaned partial chunk column set refuses startup transactionally', async () => {
    await client.query(`ALTER TABLE fqc_chunks ADD COLUMN embedding_primary vector(96)`);

    await expect(syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]))).rejects.toThrow(/orphaned embedding column.*fqc_chunks\.embedding_primary/i);

    const memory = await getColumnMetadata(client, 'fqc_memory');
    for (const column of memoryColumns) {
      expect(memory.has(column)).toBe(false);
    }
  });
});
