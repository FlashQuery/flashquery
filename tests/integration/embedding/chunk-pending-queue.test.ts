import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import {
  documentChunkEmbeddingTarget,
  scheduleBackgroundEmbeddingsForActiveEntries,
} from '../../../src/embedding/background-embed.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { HAS_SUPABASE, TEST_DATABASE_URL } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-chunk-pending-queue-test';

function configWithEmbeddings(): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = [
    {
      name: 'primary',
      dimensions: 3,
      endpoints: [{ providerName: 'openai', model: 'model-primary' }],
    },
    {
      name: 'analysis',
      dimensions: 3,
      endpoints: [{ providerName: 'openai', model: 'model-analysis' }],
    },
  ];
  return config;
}

async function cleanup(client: pg.Client): Promise<void> {
  await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
}

async function dropEntryColumns(client: pg.Client): Promise<void> {
  for (const table of ['fqc_chunks', 'fqc_memory'] as const) {
    for (const entry of ['primary', 'analysis']) {
      await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_${entry}`);
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding_${entry} CASCADE`);
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding_${entry}_model CASCADE`);
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding_${entry}_dimensions CASCADE`);
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding_${entry}_provider CASCADE`);
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding_${entry}_truncated CASCADE`);
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS embedding_${entry}_indexed_at CASCADE`);
    }
  }
}

async function insertCatalog(client: pg.Client, config: FlashQueryConfig): Promise<void> {
  for (const entry of config.embeddings ?? []) {
    await client.query(
      `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
       VALUES ($1, $2, $3, $4::jsonb, 'yaml', 'active')`,
      [
        TEST_INSTANCE_ID,
        entry.name,
        entry.dimensions,
        JSON.stringify(entry.endpoints.map((endpoint) => ({
          provider_name: endpoint.providerName,
          model: endpoint.model,
        }))),
      ]
    );
  }
}

async function insertChunk(client: pg.Client): Promise<{ documentId: string; chunkId: string }> {
  const documentId = randomUUID();
  const chunkId = randomUUID();
  await client.query(
    `INSERT INTO fqc_documents (id, instance_id, path, title)
     VALUES ($1, $2, 'chunks/pending.md', 'Pending Chunks')`,
    [documentId, TEST_INSTANCE_ID]
  );
  await client.query(
    `INSERT INTO fqc_chunks (
       id, instance_id, document_id, heading_path, heading_level, breadcrumb,
       content, content_hash, chunk_index
     )
     VALUES ($1, $2, $3, 'Pending Chunks > Setup', 2, 'Pending Chunks > Setup',
       'chunk pending content', 'chunk-pending-hash', 0)`,
    [chunkId, TEST_INSTANCE_ID, documentId]
  );
  return { documentId, chunkId };
}

function providerFor(name: string, result: 'success' | 'failure'): EmbeddingProvider {
  return {
    embed: vi.fn(async () => {
      if (result === 'failure') {
        throw new Error(`provider ${name} unavailable`);
      }
      return name === 'primary' ? [0.1, 0.2, 0.3] : [0.4, 0.5, 0.6];
    }),
    getDimensions: () => 3,
    getProviderInfo: () => ({ provider: `provider-${name}`, model: `model-${name}` }),
  };
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk pending embedding queue', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = configWithEmbeddings();
    initLogger(config);
    await initSupabase(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await dropEntryColumns(client);
    for (const entry of config.embeddings ?? []) {
      await createCoreEmbeddingColumnSet(config, entry);
    }
  }, 90_000);

  beforeEach(async () => {
    await cleanup(client);
  });

  afterAll(async () => {
    await cleanup(client).catch(() => undefined);
    await dropEntryColumns(client).catch(() => undefined);
    await client?.end();
    await supabaseManager.close();
  }, 90_000);

  it('T-I-018 provider failure upserts document_chunk pending row keyed by embedding entry', async () => {
    await insertCatalog(client, { ...config, embeddings: config.embeddings?.filter((entry) => entry.name === 'primary') });
    const { chunkId } = await insertChunk(client);

    const result = await scheduleBackgroundEmbeddingsForActiveEntries({
      config: { ...config, embeddings: config.embeddings?.filter((entry) => entry.name === 'primary') },
      target: documentChunkEmbeddingTarget({
        instanceId: TEST_INSTANCE_ID,
        id: chunkId,
        documentPath: 'chunks/pending.md',
        headingPath: 'Pending Chunks > Setup',
      }),
      embedText: 'Pending Chunks > Setup\n\nchunk pending content',
      supabase: supabaseManager.getClient(),
      databaseUrl: TEST_DATABASE_URL,
      providerFactory: (entry) => providerFor(entry.name, 'failure'),
    });

    expect(result.warnings).toEqual(['embedding_deferred:primary']);
    const pending = await client.query(
      `SELECT target_kind, target_table, target_id, embedding_name, embed_text, attempt_count, status
       FROM fqc_pending_embeds
       WHERE instance_id = $1`,
      [TEST_INSTANCE_ID]
    );
    expect(pending.rows).toEqual([
      expect.objectContaining({
        target_kind: 'document_chunk',
        target_table: 'fqc_chunks',
        target_id: chunkId,
        embedding_name: 'primary',
        embed_text: 'Pending Chunks > Setup\n\nchunk pending content',
        attempt_count: 1,
        status: 'pending',
      }),
    ]);
  });

  it('T-I-019 multi-entry partial failure warns only for failed entry and preserves success', async () => {
    await insertCatalog(client, config);
    const { chunkId } = await insertChunk(client);

    const result = await scheduleBackgroundEmbeddingsForActiveEntries({
      config,
      target: documentChunkEmbeddingTarget({
        instanceId: TEST_INSTANCE_ID,
        id: chunkId,
        documentPath: 'chunks/pending.md',
        headingPath: 'Pending Chunks > Setup',
      }),
      embedText: 'Pending Chunks > Setup\n\nchunk pending content',
      supabase: supabaseManager.getClient(),
      databaseUrl: TEST_DATABASE_URL,
      providerFactory: (entry) => providerFor(entry.name, entry.name === 'analysis' ? 'failure' : 'success'),
    });

    expect(result.warnings).toEqual(['embedding_deferred:analysis']);
    const chunk = await client.query(
      `SELECT embedding_primary::text AS primary_vector,
              embedding_primary_model AS primary_model,
              embedding_primary_indexed_at AS primary_indexed_at,
              embedding_analysis::text AS analysis_vector,
              embedding_analysis_indexed_at AS analysis_indexed_at
       FROM fqc_chunks
       WHERE id = $1`,
      [chunkId]
    );
    expect(chunk.rows[0]).toMatchObject({
      primary_vector: '[0.1,0.2,0.3]',
      primary_model: 'model-primary',
      analysis_vector: null,
      analysis_indexed_at: null,
    });
    expect(chunk.rows[0].primary_indexed_at).toBeTruthy();

    const pending = await client.query(
      `SELECT target_kind, target_table, target_id, embedding_name, status
       FROM fqc_pending_embeds
       WHERE instance_id = $1`,
      [TEST_INSTANCE_ID]
    );
    expect(pending.rows).toEqual([
      expect.objectContaining({
        target_kind: 'document_chunk',
        target_table: 'fqc_chunks',
        target_id: chunkId,
        embedding_name: 'analysis',
        status: 'pending',
      }),
    ]);
  });
});
