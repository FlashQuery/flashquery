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
const TEST_INSTANCE_ID = 'embedding-config-sync-refusal-test';

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

async function seedPrimary(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
     VALUES ($1, 'primary', 1536, $2::jsonb, 'yaml', 'active')`,
    [TEST_INSTANCE_ID, JSON.stringify([{ provider_name: 'openai', model: 'text-embedding-3-small' }])]
  );
}

describe.skipIf(!HAS_SUPABASE)('embedding-config-sync in-place YAML refusal', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await seedPrimary(client);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it.each([
    ['T-I-008 dimensions change', 3072, [{ providerName: 'openai', model: 'text-embedding-3-small' }], /dimensions changed from 1536 to 3072/i],
    ['T-I-009 model swap', 1536, [{ providerName: 'openai', model: 'text-embedding-3-large' }], /model set changed/i],
    ['T-I-010 new model added', 1536, [
      { providerName: 'openai', model: 'text-embedding-3-small' },
      { providerName: 'openai', model: 'text-embedding-3-large' },
    ], /model set changed/i],
  ])('%s refuses startup and leaves row unchanged', async (_name, dimensions, endpoints, messagePattern) => {
    await expect(syncEmbeddingCatalog(configWithEmbeddings([
      { name: 'primary', dimensions, endpoints },
    ]))).rejects.toThrow(messagePattern);

    const result = await client.query(
      `SELECT dimensions, endpoints, status FROM fqc_embeddings WHERE instance_id = $1 AND name = 'primary'`,
      [TEST_INSTANCE_ID]
    );
    expect(result.rows[0].dimensions).toBe(1536);
    expect(result.rows[0].endpoints).toEqual([{ provider_name: 'openai', model: 'text-embedding-3-small' }]);
    expect(result.rows[0].status).toBe('active');
  });

  it('identity-refusal error names affected tables and remediation paths', async () => {
    await expect(syncEmbeddingCatalog(configWithEmbeddings([
      { name: 'primary', dimensions: 3072, endpoints: [{ providerName: 'openai', model: 'text-embedding-3-large' }] },
    ]))).rejects.toThrow(/fqc_documents, fqc_memory[\s\S]*Option A[\s\S]*Option B/i);
  });

  it('T-I-011 applies rate_limit changes with INFO audit log', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 1536,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small', rateLimit: { minDelayMs: 50 } }],
      },
    ]));

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("applied changes to embedding entry 'primary'"));
  });

  it('T-I-012 applies provider_name changes with same model', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      { name: 'primary', dimensions: 1536, endpoints: [{ providerName: 'openrouter', model: 'text-embedding-3-small' }] },
    ]));

    const result = await client.query(`SELECT endpoints FROM fqc_embeddings WHERE instance_id = $1 AND name = 'primary'`, [TEST_INSTANCE_ID]);
    expect(result.rows[0].endpoints).toEqual([{ provider_name: 'openrouter', model: 'text-embedding-3-small' }]);
  });

  it('T-I-013 applies endpoint reorder when model set is unchanged', async () => {
    await client.query(
      `UPDATE fqc_embeddings SET endpoints = $2::jsonb WHERE instance_id = $1 AND name = 'primary'`,
      [TEST_INSTANCE_ID, JSON.stringify([
        { provider_name: 'openai', model: 'text-embedding-3-small' },
        { provider_name: 'backup', model: 'text-embedding-3-small' },
      ])]
    );

    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 1536,
        endpoints: [
          { providerName: 'backup', model: 'text-embedding-3-small' },
          { providerName: 'openai', model: 'text-embedding-3-small' },
        ],
      },
    ]));

    const result = await client.query(`SELECT endpoints FROM fqc_embeddings WHERE instance_id = $1 AND name = 'primary'`, [TEST_INSTANCE_ID]);
    expect(result.rows[0].endpoints.map((endpoint: { provider_name: string }) => endpoint.provider_name)).toEqual(['backup', 'openai']);
  });
});
