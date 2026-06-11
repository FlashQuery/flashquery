import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { processPendingEmbeddings } from '../../../src/embedding/pending-worker.js';
import type { ActiveEmbeddingEntry } from '../../../src/embedding/background-embed.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import type { FlashQueryConfig } from '../../../src/config/types.js';
import { initLogger } from '../../../src/logging/logger.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-166-pending-worker';
const ENTRY_NAMES = ['primary', 'analysis'] as const;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-166-pending-worker', markdownExtensions: ['.md'] },
    },
    server: { host: '127.0.0.1', port: 3100 },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, lockTimeoutSeconds: 10 },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 30_000 },
    llm: { providers: [], models: [], purposes: [] },
    embeddings: ENTRY_NAMES.map((name) => ({
      name,
      dimensions: 3,
      endpoints: [{ providerName: `provider-${name}`, model: `model-${name}` }],
    })),
    logging: { level: 'error', output: 'stdout' },
  };
}

function providerFor(entry: ActiveEmbeddingEntry): EmbeddingProvider {
  return {
    embed: vi.fn(async () => (entry.name === 'primary' ? [0.1, 0.2, 0.3] : [0.4, 0.5, 0.6])),
    getDimensions: () => entry.dimensions,
    getProviderInfo: () => ({
      provider: entry.endpoints[0]?.provider_name ?? `provider-${entry.name}`,
      model: entry.endpoints[0]?.model ?? `model-${entry.name}`,
    }),
  };
}

async function dropEntryColumns(client: pg.Client): Promise<void> {
  for (const name of ENTRY_NAMES) {
    for (const table of ['fqc_documents', 'fqc_memory']) {
      await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_${name}`);
      for (const suffix of ['', '_model', '_dimensions', '_provider', '_truncated']) {
        await client.query(
          `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${pg.escapeIdentifier(`embedding_${name}${suffix}`)} CASCADE`
        );
      }
    }
  }
}

async function insertCatalog(client: pg.Client, statuses: Record<string, 'active' | 'deactivated'>): Promise<void> {
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  for (const name of ENTRY_NAMES) {
    await client.query(
      `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
       VALUES ($1, $2, 3, $3::jsonb, 'yaml', $4)`,
      [
        TEST_INSTANCE_ID,
        name,
        JSON.stringify([{ provider_name: `provider-${name}`, model: `model-${name}` }]),
        statuses[name] ?? 'active',
      ]
    );
  }
}

describe.skipIf(!HAS_SUPABASE).sequential('pending worker per-entry retry', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await dropEntryColumns(client);
    for (const entry of config.embeddings ?? []) {
      await createCoreEmbeddingColumnSet(config, entry);
    }
  }, 60_000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await insertCatalog(client, { primary: 'active', analysis: 'active' });
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await dropEntryColumns(client).catch(() => undefined);
    await client?.end();
    await supabaseManager.close();
  }, 60_000);

  it('T-I-040 and T-I-043 retries per entry and writes vector plus stamping columns', async () => {
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title)
       VALUES ($1, $2, 'worker.md', 'Worker')`,
      [documentId, TEST_INSTANCE_ID]
    );
    await client.query(
      `INSERT INTO fqc_pending_embeds
        (instance_id, target_kind, target_table, target_id, embedding_name, target_label, embed_text, attempt_count, status, next_retry_at)
       VALUES
        ($1, 'document', 'fqc_documents', $2, 'primary', 'Worker', 'primary text', 0, 'pending', now() - interval '1 minute'),
        ($1, 'document', 'fqc_documents', $2, 'analysis', 'Worker', 'analysis text', 0, 'pending', now() - interval '1 minute')`,
      [TEST_INSTANCE_ID, documentId]
    );

    const result = await processPendingEmbeddings({
      supabase: supabaseManager.getClient(),
      instanceId: TEST_INSTANCE_ID,
      databaseUrl: TEST_DATABASE_URL,
      providerFactory: providerFor,
      limit: 10,
    });

    expect(result).toEqual({ selected: 2, processed: 2, succeeded: 2, failed: 0 });
    const rows = await client.query(
      `SELECT embedding_primary::text AS primary_vector,
              embedding_primary_model AS primary_model,
              embedding_primary_provider AS primary_provider,
              embedding_primary_dimensions AS primary_dimensions,
              embedding_primary_truncated AS primary_truncated,
              embedding_analysis::text AS analysis_vector,
              embedding_analysis_model AS analysis_model
       FROM fqc_documents
       WHERE id = $1`,
      [documentId]
    );
    expect(rows.rows[0]).toMatchObject({
      primary_vector: '[0.1,0.2,0.3]',
      primary_model: 'model-primary',
      primary_provider: 'provider-primary',
      primary_dimensions: 3,
      primary_truncated: false,
      analysis_vector: '[0.4,0.5,0.6]',
      analysis_model: 'model-analysis',
    });
    const pending = await client.query('SELECT * FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    expect(pending.rows).toEqual([]);
  });

  it('T-I-041 skips deactivated entries without deleting pending rows', async () => {
    await insertCatalog(client, { primary: 'deactivated', analysis: 'active' });
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title)
       VALUES ($1, $2, 'deactivated.md', 'Deactivated')`,
      [documentId, TEST_INSTANCE_ID]
    );
    await client.query(
      `INSERT INTO fqc_pending_embeds
        (instance_id, target_kind, target_table, target_id, embedding_name, target_label, embed_text, attempt_count, status, next_retry_at)
       VALUES ($1, 'document', 'fqc_documents', $2, 'primary', 'Deactivated', 'skip text', 0, 'pending', now() - interval '1 minute')`,
      [TEST_INSTANCE_ID, documentId]
    );

    const result = await processPendingEmbeddings({
      supabase: supabaseManager.getClient(),
      instanceId: TEST_INSTANCE_ID,
      databaseUrl: TEST_DATABASE_URL,
      providerFactory: providerFor,
      limit: 10,
    });

    expect(result).toEqual({ selected: 1, processed: 0, succeeded: 0, failed: 0 });
    const pending = await client.query(
      `SELECT embedding_name, status FROM fqc_pending_embeds WHERE instance_id = $1`,
      [TEST_INSTANCE_ID]
    );
    expect(pending.rows).toEqual([{ embedding_name: 'primary', status: 'pending' }]);
  });

  it('T-I-042 deletes pending rows for retired entries', async () => {
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1 AND name = $2', [TEST_INSTANCE_ID, 'analysis']);
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO fqc_documents (id, instance_id, path, title)
       VALUES ($1, $2, 'retired.md', 'Retired')`,
      [documentId, TEST_INSTANCE_ID]
    );
    await client.query(
      `INSERT INTO fqc_pending_embeds
        (instance_id, target_kind, target_table, target_id, embedding_name, target_label, embed_text, attempt_count, status, next_retry_at)
       VALUES ($1, 'document', 'fqc_documents', $2, 'analysis', 'Retired', 'retired text', 0, 'pending', now() - interval '1 minute')`,
      [TEST_INSTANCE_ID, documentId]
    );

    const result = await processPendingEmbeddings({
      supabase: supabaseManager.getClient(),
      instanceId: TEST_INSTANCE_ID,
      databaseUrl: TEST_DATABASE_URL,
      providerFactory: providerFor,
      limit: 10,
    });

    expect(result).toEqual({ selected: 1, processed: 0, succeeded: 0, failed: 0 });
    const pending = await client.query('SELECT * FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    expect(pending.rows).toEqual([]);
  });
});
