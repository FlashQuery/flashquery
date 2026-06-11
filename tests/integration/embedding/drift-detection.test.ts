import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { initLogger } from '../../../src/logging/logger.js';
import { verifySchema } from '../../../src/storage/schema-verify.js';
import { createCoreEmbeddingColumnSet } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE, TEST_EMBEDDING_DIMENSIONS } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-drift-detection-test';

const coreTables = ['fqc_documents', 'fqc_memory'] as const;
const managedColumns = [
  'embedding_primary',
  'embedding_primary_model',
  'embedding_primary_dimensions',
  'embedding_primary_provider',
  'embedding_primary_truncated',
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
  await client.query('DROP FUNCTION IF EXISTS match_documents_primary(vector, double precision, integer, text, text[], text, boolean)');
  for (const table of coreTables) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_primary`);
    for (const column of managedColumns) {
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column}`);
    }
  }
}

async function restoreLegacyEmbeddingColumns(client: pg.Client): Promise<void> {
  for (const table of coreTables) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding`);
    await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN embedding vector(${TEST_EMBEDDING_DIMENSIONS})`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${table}_embedding ON ${table} USING hnsw (embedding vector_cosine_ops)`);
  }
}

async function createPrimaryEntry(client: pg.Client, configuredDimensions = 96): Promise<void> {
  const config = configWithEmbeddings([
    {
      name: 'primary',
      dimensions: configuredDimensions,
      endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
    },
  ]);
  await createCoreEmbeddingColumnSet(config, { name: 'primary', dimensions: configuredDimensions });
  await client.query(
    `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
     VALUES ($1, 'primary', $2, $3::jsonb, 'yaml', 'active')`,
    [TEST_INSTANCE_ID, configuredDimensions, JSON.stringify([{ provider_name: 'openai', model: 'text-embedding-3-small' }])]
  );
}

async function resizeColumnOnly(client: pg.Client, table: string, width: number): Promise<void> {
  await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_primary`);
  await client.query(`ALTER TABLE ${table} DROP COLUMN embedding_primary`);
  await client.query(`ALTER TABLE ${table} ADD COLUMN embedding_primary vector(${width})`);
}

describe.skipIf(!HAS_SUPABASE).sequential('drift-detection catalog verification', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await cleanupPrimarySchema(client);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  }, 60000);

  afterAll(async () => {
    await cleanupPrimarySchema(client).catch(() => undefined);
    await restoreLegacyEmbeddingColumns(client).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
  }, 60000);

  it('T-I-026 fails startup when an active core vector column width drifts', async () => {
    await createPrimaryEntry(client, 96);
    await resizeColumnOnly(client, 'fqc_documents', 64);

    await expect(verifySchema(client, { instanceId: TEST_INSTANCE_ID })).rejects.toThrow(
      /entry primary.*fqc_documents.*embedding_primary.*configured width 96.*actual width 64/i
    );
  });

  it('T-I-027 checks both core tables for active catalog entries', async () => {
    await createPrimaryEntry(client, 96);
    await resizeColumnOnly(client, 'fqc_memory', 32);

    await expect(verifySchema(client, { instanceId: TEST_INSTANCE_ID })).rejects.toThrow(
      /entry primary.*fqc_memory.*embedding_primary.*configured width 96.*actual width 32/i
    );
  });

  it('T-I-028 ignores legacy singular embedding columns', async () => {
    await createPrimaryEntry(client, 96);

    await expect(verifySchema(client, { instanceId: TEST_INSTANCE_ID })).resolves.toBeUndefined();
  });
});
