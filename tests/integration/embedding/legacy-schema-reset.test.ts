import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { maintainVault } from '../../../src/services/maintenance.js';
import { verifyStartupEmbeddingCatalog } from '../../../src/embedding/startup-validation.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_EMBEDDING_DIMENSIONS } from '../../helpers/test-env.js';
import {
  createPluginRecordHarness,
  destroyPluginRecordHarness,
  pluginRecordYaml,
  textOf,
  type PluginRecordHarness,
} from '../plugin-record-embedding-helpers.js';

const SKIP = !HAS_SUPABASE;
const STARTUP_INSTANCE_ID = `legacy-startup-reset-${randomUUID().slice(0, 8)}`;

function legacyStartupConfig(): FlashQueryConfig {
  return {
    instance: {
      name: STARTUP_INSTANCE_ID,
      id: STARTUP_INSTANCE_ID,
      vault: { path: '/tmp/fqc-legacy-startup-reset', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: process.env.SUPABASE_URL ?? '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    llm: {
      providers: [{ name: 'legacy_provider', type: 'openai', endpoint: 'https://embedding.test', apiKey: 'sk-test' }],
      models: [{ name: 'legacy_embedding_model', providerName: 'legacy_provider', model: 'legacy-model', type: 'embedding' }],
      purposes: [{ name: 'embedding', description: 'Legacy embedding purpose', models: ['legacy_embedding_model'] }],
    },
    embeddings: [],
    embedding: { provider: 'none', model: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

async function ensureLegacyColumns(client: pg.Client): Promise<void> {
  for (const table of ['fqc_documents', 'fqc_memory']) {
    await ensureLegacyEmbeddingColumn(client, table);
  }
}

async function ensureLegacyEmbeddingColumn(client: pg.Client, table: 'fqc_documents' | 'fqc_memory'): Promise<void> {
  await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS embedding vector(${TEST_EMBEDDING_DIMENSIONS})`);
}

function testVector(): string {
  return `[${Array.from({ length: TEST_EMBEDDING_DIMENSIONS }, () => '0.1').join(',')}]`;
}

async function dropLegacyColumns(client: pg.Client): Promise<void> {
  for (const table of ['fqc_documents', 'fqc_memory']) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding`);
    await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding`);
    await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding_model`);
  }
}

async function legacyColumns(client: pg.Client): Promise<string[]> {
  const result = await client.query(
    `
    SELECT table_name || '.' || column_name AS column_ref
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
      AND column_name IN ('embedding', 'embedding_model')
    ORDER BY table_name, column_name
    `,
    [['fqc_documents', 'fqc_memory']]
  );
  return result.rows.map((row: { column_ref: string }) => row.column_ref);
}

describe.skipIf(SKIP).sequential('REQ-043 legacy schema reset coverage', () => {
  let startupClient: pg.Client;

  beforeAll(async () => {
    const config = legacyStartupConfig();
    initLogger(config);
    await initSupabase(config);
    startupClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await startupClient.connect();
  }, 90_000);

  beforeEach(async () => {
    await startupClient.query('DELETE FROM fqc_documents WHERE instance_id = $1', [STARTUP_INSTANCE_ID]);
    await startupClient.query('DELETE FROM fqc_memory WHERE instance_id = $1', [STARTUP_INSTANCE_ID]);
    await ensureLegacyColumns(startupClient);
  }, 60_000);

  afterAll(async () => {
    await startupClient?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [STARTUP_INSTANCE_ID]).catch(() => undefined);
    await startupClient?.query('DELETE FROM fqc_memory WHERE instance_id = $1', [STARTUP_INSTANCE_ID]).catch(() => undefined);
    await startupClient?.end().catch(() => undefined);
    await supabaseManager.close();
  }, 60_000);

  it('REQ-043 cr1 refuses startup when a legacy embedding purpose has populated singular vectors', async () => {
    await startupClient.query(
      `
      INSERT INTO fqc_documents(id, instance_id, path, title, embedding)
      VALUES (gen_random_uuid(), $1, 'legacy/reset.md', 'Legacy Reset', $2::vector)
      `,
      [STARTUP_INSTANCE_ID, testVector()]
    );

    await expect(verifyStartupEmbeddingCatalog(legacyStartupConfig())).rejects.toThrow(
      /legacy embedding.*reset.*embedding purpose.*fqc_documents\.embedding/i
    );
  }, 90_000);

  it('REQ-043 cr3/cr4 verifies plugin records after reset and leaves no legacy columns restored', async () => {
    const harness: PluginRecordHarness = await createPluginRecordHarness();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await dropLegacyColumns(harness.client);
      await expect(legacyColumns(harness.client)).resolves.toEqual([]);

      await ensureLegacyEmbeddingColumn(harness.client, 'fqc_memory');
      const memoryIdResult = await harness.client.query<{ id: string }>(
        `
        INSERT INTO fqc_memory(instance_id, content, tags, status, embedding)
        VALUES ($1, 'Legacy reset memory row for post-reset backfill.', ARRAY['legacy-reset-memory'], 'active', $2::vector)
        RETURNING id
        `,
        [harness.instanceId, testVector()]
      );
      const memoryId = memoryIdResult.rows[0]!.id;
      await dropLegacyColumns(harness.client);
      await expect(legacyColumns(harness.client)).resolves.toEqual([]);

      const pluginId = `legacy_reset_plugin_${randomUUID().slice(0, 8)}`;
      const tableName = `fqcp_${pluginId}_default_notes`;
      harness.tablesToDrop.add(tableName);

      const registered = await harness.registerPlugin({
        schema_yaml: pluginRecordYaml(pluginId, '*'),
        embedding_name: 'primary',
      });
      expect(textOf(registered)).toContain('"embedding_name":"primary"');

      const written = await harness.writeRecord({
        mode: 'create',
        plugin_id: pluginId,
        plugin_instance: 'default',
        table: 'notes',
        data: { title: 'Legacy reset plugin row', body: 'Backfilled after legacy reset.' },
        include: ['data'],
      });
      const record = JSON.parse(textOf(written));
      const recordId = record.id as string;

      await harness.client.query(
        `
        UPDATE ${pg.escapeIdentifier(tableName)}
        SET embedding_primary = NULL,
            embedding_primary_model = NULL,
            embedding_primary_dimensions = NULL,
            embedding_primary_provider = NULL,
            embedding_primary_truncated = NULL
        WHERE id = $1
        `,
        [recordId]
      );

      const memoryBackfilled = await maintainVault(harness.config, {
        action: 'backfill_embeddings',
        embedding_name: 'primary',
        scope: { entity_types: ['memory'] },
        max_rows: 0,
      });
      expect(memoryBackfilled.ok).toBe(true);

      const backfilled = await maintainVault(harness.config, {
        action: 'backfill_embeddings',
        scope: { entity_types: ['records'], records: { plugin: pluginId } },
        max_rows: 0,
      });
      expect(backfilled.ok).toBe(true);

      const memoryStamp = await harness.client.query(
        `SELECT embedding_primary IS NOT NULL AS has_embedding_primary,
                embedding_primary_model,
                embedding_primary_dimensions,
                embedding_primary_provider
         FROM fqc_memory
         WHERE id = $1`,
        [memoryId]
      );
      expect(memoryStamp.rows[0]).toMatchObject({
        has_embedding_primary: true,
        embedding_primary_model: 'primary-model',
        embedding_primary_dimensions: 3,
        embedding_primary_provider: 'catalog_provider',
      });

      const stamp = await harness.client.query(
        `SELECT embedding_primary_model, embedding_primary_dimensions, embedding_primary_provider
         FROM ${pg.escapeIdentifier(tableName)}
         WHERE id = $1`,
        [recordId]
      );
      expect(stamp.rows[0]).toMatchObject({
        embedding_primary_model: 'primary-model',
        embedding_primary_dimensions: 3,
        embedding_primary_provider: 'catalog_provider',
      });
      await expect(legacyColumns(harness.client)).resolves.toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      await destroyPluginRecordHarness(harness);
    }
  }, 120_000);
});
