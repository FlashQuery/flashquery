import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { initLogger } from '../../../src/logging/logger.js';
import { checkEmbeddingRetryGaps } from '../../../src/cli/doctor.js';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-146-doctor-embedding-gaps';
const ENTRY_NAME = 'primary';
const EMBEDDING_DIMENSIONS = 3;

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-146-doctor-embedding-gaps', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: EMBEDDING_DIMENSIONS },
    llm: { providers: [], models: [], purposes: [] },
    embeddings: [
      {
        name: ENTRY_NAME,
        dimensions: EMBEDDING_DIMENSIONS,
        endpoints: [{ providerName: 'mock-provider', model: 'mock-model' }],
      },
    ],
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

describe.skipIf(!HAS_SUPABASE)('doctor embedding retry diagnostics', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    await createCoreEmbeddingColumnSet(config, { name: ENTRY_NAME, dimensions: EMBEDDING_DIMENSIONS });
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS fqcp_phase146_doctor_records (
        id UUID PRIMARY KEY,
        instance_id TEXT NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'active'
      )
    `);
    await client.query(
      `ALTER TABLE fqcp_phase146_doctor_records ADD COLUMN IF NOT EXISTS embedding_${ENTRY_NAME} vector(${EMBEDDING_DIMENSIONS})`
    );
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query(
      `
      INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
      VALUES ($1, $2, $3, $4::jsonb, 'yaml', 'active')
      `,
      [
        TEST_INSTANCE_ID,
        ENTRY_NAME,
        EMBEDDING_DIMENSIONS,
        JSON.stringify([{ provider_name: 'mock-provider', model: 'mock-model' }]),
      ]
    );
  }, 60_000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.query('DELETE FROM fqcp_phase146_doctor_records WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end();
    await supabaseManager.close();
  });

  it('T-I-006 reports embedding-null rows that lack pending retry state without raw embed text', async () => {
    await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqc_memory WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.query('DELETE FROM fqcp_phase146_doctor_records WHERE instance_id = $1', [TEST_INSTANCE_ID]);

    const docGapId = '00000000-0000-4000-8000-000000000601';
    const docTrackedId = '00000000-0000-4000-8000-000000000602';
    const memoryGapId = '00000000-0000-4000-8000-000000000603';
    const recordGapId = '00000000-0000-4000-8000-000000000604';
    const targetIds = [docGapId, docTrackedId, memoryGapId, recordGapId];

    await client.query('DELETE FROM fqc_pending_embeds WHERE target_id = ANY($1::text[])', [targetIds]);
    await client.query('DELETE FROM fqc_documents WHERE id = ANY($1::uuid[])', [targetIds]);
    await client.query('DELETE FROM fqc_memory WHERE id = ANY($1::uuid[])', [targetIds]);
    await client.query('DELETE FROM fqcp_phase146_doctor_records WHERE id = ANY($1::uuid[])', [targetIds]);

    await client.query(
      `
      INSERT INTO fqc_documents (id, instance_id, path, title, status, embedding_${ENTRY_NAME})
      VALUES
        ($1, $3, 'gap.md', 'Doctor Gap', 'active', NULL),
        ($2, $3, 'tracked.md', 'Tracked Gap', 'active', NULL)
      `,
      [docGapId, docTrackedId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_memory (id, instance_id, content, status, embedding_${ENTRY_NAME})
      VALUES ($1, $2, 'private memory content that must not appear', 'active', NULL)
      `,
      [memoryGapId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqcp_phase146_doctor_records (id, instance_id, name, status, embedding_${ENTRY_NAME})
      VALUES ($1, $2, 'private record name', 'active', NULL)
      `,
      [recordGapId, TEST_INSTANCE_ID]
    );
    await client.query(
      `
      INSERT INTO fqc_pending_embeds
        (instance_id, target_kind, target_table, target_id, embedding_name, target_label, embed_text, attempt_count, status)
      VALUES ($1, 'document', 'fqc_documents', $2, $3, 'Tracked Gap', 'raw pending embed text', 1, 'pending')
      `,
      [TEST_INSTANCE_ID, docTrackedId, ENTRY_NAME]
    );

    const result = await checkEmbeddingRetryGaps(makeConfig());

    expect(result.passed).toBe(false);
    expect(result.name).toBe('Embedding retry coverage');
    expect(result.issue).toContain('documents=1');
    expect(result.issue).toContain('memories=1');
    expect(result.issue).toContain('records=1');
    expect(result.issue).toContain(docGapId);
    expect(result.issue).toContain(memoryGapId);
    expect(result.issue).toContain('fqcp_phase146_doctor_records');
    expect(result.issue).not.toContain(docTrackedId);
    expect(result.issue).not.toContain('private memory content');
    expect(result.issue).not.toContain('private record name');
    expect(result.issue).not.toContain('raw pending embed text');
  });
});
