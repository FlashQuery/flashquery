import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { initLogger } from '../../../src/logging/logger.js';
import { processPendingEmbeddings } from '../../../src/embedding/pending-worker.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-146-pending-worker';
const VECTOR = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 0.5 : 0));

const provider: EmbeddingProvider = {
  embed: async () => VECTOR,
  getDimensions: () => 1536,
};

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-146-pending-worker', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

describe.skipIf(!HAS_SUPABASE)('pending embedding retry worker (integration)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS fqcp_phase146_worker_records (
        id UUID PRIMARY KEY,
        instance_id TEXT NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'active',
        embedding vector(1536),
        embedding_updated_at TIMESTAMPTZ
      )
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqcp_phase146_worker_records WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end();
    await supabaseManager.close();
  });

  it('T-I-005 successful retry populates document, memory, and record embeddings and clears pending rows', async () => {
    await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqcp_phase146_worker_records WHERE instance_id = $1', [TEST_INSTANCE_ID]);

    const docId = '00000000-0000-4000-8000-000000000501';
    const memoryId = '00000000-0000-4000-8000-000000000502';
    const recordId = '00000000-0000-4000-8000-000000000503';

    await client.query(
      `
      INSERT INTO fqc_documents (id, instance_id, path, title, status, embedding)
      VALUES ($1, $2, 'pending-worker.md', 'Pending Worker', 'active', NULL)
      `,
      [docId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_memory (id, instance_id, content, status, embedding)
      VALUES ($1, $2, 'pending worker memory', 'active', NULL)
      `,
      [memoryId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqcp_phase146_worker_records (id, instance_id, name, status, embedding)
      VALUES ($1, $2, 'pending worker record', 'active', NULL)
      `,
      [recordId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_pending_embeds
        (instance_id, target_kind, target_table, target_id, target_label, embed_text, attempt_count, status, next_retry_at)
      VALUES
        ($1, 'document', 'fqc_documents', $2, 'Doc', 'document text', 1, 'pending', now() - interval '1 minute'),
        ($1, 'memory', 'fqc_memory', $3, 'Memory', 'memory text', 1, 'pending', now() - interval '1 minute'),
        ($1, 'record', 'fqcp_phase146_worker_records', $4, 'Record', 'record text', 1, 'pending', now() - interval '1 minute')
      `,
      [TEST_INSTANCE_ID, docId, memoryId, recordId]
    );

    const result = await processPendingEmbeddings({
      supabase: supabaseManager.getClient(),
      provider,
      instanceId: TEST_INSTANCE_ID,
      databaseUrl: TEST_DATABASE_URL,
      limit: 10,
    });

    expect(result).toEqual({ selected: 3, processed: 3, succeeded: 3, failed: 0 });

    const targetRows = await client.query(
      `
      SELECT 'document' AS kind, embedding IS NOT NULL AS has_embedding FROM fqc_documents WHERE id = $1
      UNION ALL
      SELECT 'memory' AS kind, embedding IS NOT NULL AS has_embedding FROM fqc_memory WHERE id = $2
      UNION ALL
      SELECT 'record' AS kind, embedding IS NOT NULL AS has_embedding FROM fqcp_phase146_worker_records WHERE id = $3
      ORDER BY kind
      `,
      [docId, memoryId, recordId]
    );
    expect(targetRows.rows).toEqual([
      { kind: 'document', has_embedding: true },
      { kind: 'memory', has_embedding: true },
      { kind: 'record', has_embedding: true },
    ]);

    const pendingRows = await client.query(
      'SELECT target_kind FROM fqc_pending_embeds WHERE instance_id = $1',
      [TEST_INSTANCE_ID]
    );
    expect(pendingRows.rows).toEqual([]);
  });
});
