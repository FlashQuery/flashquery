import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const INSTANCE_A = 'embedding-config-sync-tenant-a';
const INSTANCE_B = 'embedding-config-sync-tenant-b';

function configWithInstance(instanceId: string, embeddings: FlashQueryConfig['embeddings']): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = instanceId;
  config.embeddings = embeddings;
  return config;
}

describe.skipIf(!HAS_SUPABASE)('embedding-config-sync multi-tenancy', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithInstance(INSTANCE_A, []);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = ANY($1::text[])', [[INSTANCE_A, INSTANCE_B]]);
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = ANY($1::text[])', [[INSTANCE_A, INSTANCE_B]]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-022 scopes catalog operations by instance_id', async () => {
    await syncEmbeddingCatalog(configWithInstance(INSTANCE_A, [
      { name: 'primary', dimensions: 1536, endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }] },
    ]));
    await syncEmbeddingCatalog(configWithInstance(INSTANCE_B, [
      { name: 'primary', dimensions: 768, endpoints: [{ providerName: 'local', model: 'nomic-embed-text' }] },
    ]));
    await syncEmbeddingCatalog(configWithInstance(INSTANCE_A, []));

    const result = await client.query(
      `SELECT instance_id, name, dimensions, status
       FROM fqc_embeddings
       WHERE instance_id = ANY($1::text[])
       ORDER BY instance_id`,
      [[INSTANCE_A, INSTANCE_B]]
    );

    expect(result.rows).toEqual([
      { instance_id: INSTANCE_A, name: 'primary', dimensions: 1536, status: 'deactivated' },
      { instance_id: INSTANCE_B, name: 'primary', dimensions: 768, status: 'active' },
    ]);
  });
});
