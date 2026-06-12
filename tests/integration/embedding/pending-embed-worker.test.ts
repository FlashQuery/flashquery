import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initLogger } from '../../../src/logging/logger.js';
import { processPendingEmbeddings } from '../../../src/embedding/pending-worker.js';
import { runScanOnce } from '../../../src/services/scanner.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import {
  HAS_SUPABASE,
  TEST_EMBEDDING_DIMENSIONS,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-146-pending-worker';
const ENTRY_NAME = 'primary';
let embeddingDimensions = Math.min(TEST_EMBEDDING_DIMENSIONS, 3);
let vector = makeVector(embeddingDimensions);

vi.mock('../../../src/embedding/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/embedding/provider.js')>();
  return {
    ...actual,
    createEmbeddingProviderForCatalogEntry: vi.fn(() => provider),
    embeddingProvider: {
      embed: vi.fn(async () => vector),
      getDimensions: () => embeddingDimensions,
    },
  };
});

const provider: EmbeddingProvider = {
  embed: async () => vector,
  getDimensions: () => embeddingDimensions,
  getProviderInfo: () => ({ provider: 'mock-provider', model: 'mock-model' }),
};

function makeVector(dimensions: number): number[] {
  return Array.from({ length: dimensions }, (_, index) => (index === 0 ? 0.5 : 0));
}

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
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: embeddingDimensions },
    llm: { providers: [], models: [], purposes: [] },
    embeddings: [
      {
        name: ENTRY_NAME,
        dimensions: embeddingDimensions,
        endpoints: [{ providerName: 'mock-provider', model: 'mock-model' }],
      },
    ],
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

describe.skipIf(!HAS_SUPABASE)('pending embedding retry worker (integration)', () => {
  let client: pg.Client;
  let vaultPath: string;

  beforeAll(async () => {
    const config = makeConfig();
    vaultPath = await mkdtemp(join(tmpdir(), 'phase-146-pending-worker-'));
    config.instance.vault.path = vaultPath;
    initLogger(config);
    await initSupabase(config);
    await createCoreEmbeddingColumnSet(config, { name: ENTRY_NAME, dimensions: embeddingDimensions });
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    vector = makeVector(embeddingDimensions);
    await client.query('DROP TABLE IF EXISTS fqcp_phase146_worker_records');
    await client.query(`
      CREATE TABLE IF NOT EXISTS fqcp_phase146_worker_records (
        id UUID PRIMARY KEY,
        instance_id TEXT NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'active',
        embedding_${ENTRY_NAME} vector(${embeddingDimensions}),
        embedding_${ENTRY_NAME}_model TEXT,
        embedding_${ENTRY_NAME}_dimensions INTEGER,
        embedding_${ENTRY_NAME}_provider TEXT,
        embedding_${ENTRY_NAME}_truncated BOOLEAN,
        embedding_updated_at TIMESTAMPTZ
      )
    `);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query(
      `
      INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
      VALUES ($1, $2, $3, $4::jsonb, 'yaml', 'active')
      `,
      [
        TEST_INSTANCE_ID,
        ENTRY_NAME,
        embeddingDimensions,
        JSON.stringify([{ provider_name: 'mock-provider', model: 'mock-model' }]),
      ]
    );
  }, 60_000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqcp_phase146_worker_records WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end();
    await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
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
    const targetIds = [docId, memoryId, recordId];

    await client.query('DELETE FROM fqc_pending_embeds WHERE target_id = ANY($1::text[])', [targetIds]);
    await client.query('DELETE FROM fqc_documents WHERE id = ANY($1::uuid[])', [targetIds]);
    await client.query('DELETE FROM fqc_memory WHERE id = ANY($1::uuid[])', [targetIds]);
    await client.query('DELETE FROM fqcp_phase146_worker_records WHERE id = ANY($1::uuid[])', [targetIds]);

    await client.query(
      `
      INSERT INTO fqc_documents (id, instance_id, path, title, status, embedding_${ENTRY_NAME})
      VALUES ($1, $2, 'pending-worker.md', 'Pending Worker', 'active', NULL)
      `,
      [docId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_memory (id, instance_id, content, status, embedding_${ENTRY_NAME})
      VALUES ($1, $2, 'pending worker memory', 'active', NULL)
      `,
      [memoryId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqcp_phase146_worker_records (id, instance_id, name, status, embedding_${ENTRY_NAME})
      VALUES ($1, $2, 'pending worker record', 'active', NULL)
      `,
      [recordId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_pending_embeds
        (instance_id, target_kind, target_table, target_id, embedding_name, target_label, embed_text, attempt_count, status, next_retry_at)
      VALUES
        ($1, 'document', 'fqc_documents', $2, $5, 'Doc', 'document text', 1, 'pending', now() - interval '1 minute'),
        ($1, 'memory', 'fqc_memory', $3, $5, 'Memory', 'memory text', 1, 'pending', now() - interval '1 minute'),
        ($1, 'record', 'fqcp_phase146_worker_records', $4, $5, 'Record', 'record text', 1, 'pending', now() - interval '1 minute')
      `,
      [TEST_INSTANCE_ID, docId, memoryId, recordId, ENTRY_NAME]
    );

    const result = await processPendingEmbeddings({
      supabase: supabaseManager.getClient(),
      providerFactory: () => provider,
      instanceId: TEST_INSTANCE_ID,
      databaseUrl: TEST_DATABASE_URL,
      limit: 10,
    });

    if (result.failed > 0) {
      const pendingRows = await client.query(
        `
        SELECT target_kind, target_table, target_id, last_error
        FROM fqc_pending_embeds
        WHERE instance_id = $1
        ORDER BY target_kind
        `,
        [TEST_INSTANCE_ID]
      );
      throw new Error(`pending embedding retry failed: ${JSON.stringify(pendingRows.rows)}`);
    }

    expect(result).toEqual({ selected: 3, processed: 3, succeeded: 3, failed: 0 });

    const targetRows = await client.query(
      `
      SELECT 'document' AS kind, embedding_${ENTRY_NAME} IS NOT NULL AS has_embedding FROM fqc_documents WHERE id = $1
      UNION ALL
      SELECT 'memory' AS kind, embedding_${ENTRY_NAME} IS NOT NULL AS has_embedding FROM fqc_memory WHERE id = $2
      UNION ALL
      SELECT 'record' AS kind, embedding_${ENTRY_NAME} IS NOT NULL AS has_embedding FROM fqcp_phase146_worker_records WHERE id = $3
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

  it('T-I-005 can trigger pending retry through runScanOnce maintenance path', async () => {
    await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);

    const docId = '00000000-0000-4000-8000-000000000504';
    await client.query(
      `
      INSERT INTO fqc_documents (id, instance_id, path, title, status, embedding_${ENTRY_NAME})
      VALUES ($1, $2, 'scanner-worker.md', 'Scanner Worker', 'active', NULL)
      `,
      [docId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_pending_embeds
        (instance_id, target_kind, target_table, target_id, embedding_name, target_label, embed_text, attempt_count, status, next_retry_at)
      VALUES ($1, 'document', 'fqc_documents', $2, $3, 'Doc', 'scanner document text', 1, 'pending', now() - interval '1 minute')
      `,
      [TEST_INSTANCE_ID, docId, ENTRY_NAME]
    );

    const config = makeConfig();
    config.instance.vault.path = vaultPath;
    const result = await runScanOnce(config);

    expect(result.embeddingStatus).toBe('complete');
    const target = await client.query(
      `SELECT embedding_${ENTRY_NAME} IS NOT NULL AS has_embedding FROM fqc_documents WHERE id = $1`,
      [docId]
    );
    expect(target.rows[0]).toEqual({ has_embedding: true });
    const pendingRows = await client.query(
      'SELECT target_kind FROM fqc_pending_embeds WHERE instance_id = $1 AND target_id = $2',
      [TEST_INSTANCE_ID, docId]
    );
    expect(pendingRows.rows).toEqual([]);
  });
});
