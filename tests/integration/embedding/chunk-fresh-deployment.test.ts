import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
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
    await cleanupPrimarySchema(client);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  }, 60000);

  afterAll(async () => {
    await cleanupPrimarySchema(client).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  }, 60000);

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
    const scanSource = await readFile(resolve(__dirname, '../../../src/mcp/tools/scan.ts'), 'utf8');
    expect(scanSource).not.toContain('cleanup_document_vectors');
    expect(scanSource).not.toContain('legacy_document_vectors');
    expect(scanSource).not.toContain('document_vectors');
  });
});
