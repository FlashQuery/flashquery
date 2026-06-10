import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import { logger } from '../../../src/logging/logger.js';
import { verifySchema } from '../../../src/storage/schema-verify.js';
import { repairEmbeddingDimensionDrift } from '../../../src/storage/test-dev-repair.js';
import { createCoreEmbeddingColumnSet } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-test-dev-repair-test';

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
  for (const table of ['fqc_documents', 'fqc_memory']) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_primary`);
    for (const column of managedColumns) {
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column}`);
    }
  }
}

async function createDrift(client: pg.Client): Promise<void> {
  const config = configWithEmbeddings([
    {
      name: 'primary',
      dimensions: 96,
      endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
    },
  ]);
  await createCoreEmbeddingColumnSet(config, { name: 'primary', dimensions: 96 });
  await client.query(
    `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
     VALUES ($1, 'primary', 96, $2::jsonb, 'yaml', 'active')`,
    [TEST_INSTANCE_ID, JSON.stringify([{ provider_name: 'openai', model: 'text-embedding-3-small' }])]
  );
  await client.query('DROP INDEX IF EXISTS idx_fqc_documents_embedding_primary');
  await client.query('ALTER TABLE fqc_documents DROP COLUMN embedding_primary');
  await client.query('ALTER TABLE fqc_documents ADD COLUMN embedding_primary vector(64)');
}

async function vectorType(client: pg.Client, table: string, column: string): Promise<string> {
  const result = await client.query(
    `
    SELECT format_type(a.atttypid, a.atttypmod) AS formatted_type
    FROM pg_class cl
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = cl.oid
    WHERE n.nspname = 'public'
      AND cl.relname = $1
      AND a.attname = $2
    `,
    [table, column]
  );
  return result.rows[0].formatted_type;
}

describe.skipIf(!HAS_SUPABASE).sequential('test-dev-repair gated embedding repair', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
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
  }, 60000);

  it('T-I-029 repairs drift only when the explicit destructive gate is enabled', async () => {
    await createDrift(client);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await repairEmbeddingDimensionDrift(client, { instanceId: TEST_INSTANCE_ID, enabled: true });

    await expect(vectorType(client, 'fqc_documents', 'embedding_primary')).resolves.toBe('vector(96)');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/destructive.*data loss.*primary.*fqc_documents/i));
    await expect(verifySchema(client, { instanceId: TEST_INSTANCE_ID })).resolves.toBeUndefined();
  }, 90000);

  it('T-I-030 refuses by default and does not alter drifted columns', async () => {
    await createDrift(client);

    await expect(verifySchema(client, { instanceId: TEST_INSTANCE_ID })).rejects.toThrow(/configured width 96.*actual width 64/i);
    await expect(vectorType(client, 'fqc_documents', 'embedding_primary')).resolves.toBe('vector(64)');
  }, 90000);
});
