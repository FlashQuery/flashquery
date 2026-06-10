import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { logger } from '../../../src/logging/logger.js';
import { initLogger } from '../../../src/logging/logger.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-config-sync-delete-test';

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

async function seedPrimary(client: pg.Client, status: 'active' | 'deactivated' = 'active'): Promise<void> {
  await client.query(
    `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
     VALUES ($1, 'primary', 1536, $2::jsonb, 'yaml', $3)`,
    [TEST_INSTANCE_ID, JSON.stringify([{ provider_name: 'openai', model: 'text-embedding-3-small' }]), status]
  );
}

describe.skipIf(!HAS_SUPABASE)('embedding-config-sync YAML deletion deactivation', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 30000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-014 removes YAML entry by setting status=deactivated without deleting row', async () => {
    await seedPrimary(client);
    await syncEmbeddingCatalog(configWithEmbeddings([]));

    const result = await client.query(
      `SELECT status, endpoints FROM fqc_embeddings WHERE instance_id = $1 AND name = 'primary'`,
      [TEST_INSTANCE_ID]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('deactivated');
    expect(result.rows[0].endpoints).toEqual([{ provider_name: 'openai', model: 'text-embedding-3-small' }]);
  });

  it('T-I-015 emits repeated ERROR log for each deactivated entry', async () => {
    await seedPrimary(client, 'deactivated');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    await syncEmbeddingCatalog(configWithEmbeddings([]));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("entry 'primary' is deactivated"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Option A'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Option B'));
  });

  it('T-I-016 re-adding YAML with the same shape reactivates the row', async () => {
    await seedPrimary(client, 'deactivated');
    await syncEmbeddingCatalog(configWithEmbeddings([
      { name: 'primary', dimensions: 1536, endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }] },
    ]));

    const result = await client.query(`SELECT status FROM fqc_embeddings WHERE instance_id = $1 AND name = 'primary'`, [TEST_INSTANCE_ID]);
    expect(result.rows[0].status).toBe('active');
  });

  it('T-I-017 re-adding YAML with different shape routes through identity refusal', async () => {
    await seedPrimary(client, 'deactivated');

    await expect(syncEmbeddingCatalog(configWithEmbeddings([
      { name: 'primary', dimensions: 3072, endpoints: [{ providerName: 'openai', model: 'text-embedding-3-large' }] },
    ]))).rejects.toThrow(/Embedding catalog change refused/i);
  });
});
