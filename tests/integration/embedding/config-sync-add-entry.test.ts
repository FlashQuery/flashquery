import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { logger } from '../../../src/logging/logger.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-config-sync-add-test';

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

describe.skipIf(!HAS_SUPABASE)('embedding-config-sync add entry', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-005 inserts a new YAML entry as active source=yaml', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 1536,
        endpoints: [
          { providerName: 'openai', model: 'text-embedding-3-small' },
          { providerName: 'local', model: 'text-embedding-3-small' },
        ],
      },
    ]));

    const result = await client.query(
      `SELECT name, dimensions, endpoints, source, status
       FROM fqc_embeddings
       WHERE instance_id = $1 AND name = $2`,
      [TEST_INSTANCE_ID, 'primary']
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      name: 'primary',
      dimensions: 1536,
      source: 'yaml',
      status: 'active',
    });
    expect(result.rows[0].endpoints.map((endpoint: { provider_name: string }) => endpoint.provider_name)).toEqual([
      'openai',
      'local',
    ]);
  });

  it.skip('T-I-006 creates per-entry core column set and HNSW indexes (Phase 165-02)', () => {
    // Phase 165-01 owns the catalog row. Phase 165-02 owns core table columns and indexes.
  });

  it('T-I-007 emits an INFO audit log naming added entry and affected tables', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 1536,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Embedding catalog: added entry 'primary'")
    );
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('fqc_documents, fqc_memory'));
  });
});
