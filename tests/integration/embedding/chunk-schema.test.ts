import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-chunk-schema-test';

function configForTest(): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = [];
  return config;
}

async function insertDocument(client: pg.Client): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags)
    VALUES (gen_random_uuid(), $1, '/chunk-schema.md', 'Chunk Schema', ARRAY['chunks'])
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID]
  );
  return result.rows[0].id;
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk schema DDL', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configForTest();
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-001 fresh schema creates fqc_chunks with required columns, constraints, and indexes', async () => {
    const columns = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_chunks'
      ORDER BY column_name
      `
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'id',
        'instance_id',
        'document_id',
        'heading_path',
        'heading_level',
        'breadcrumb',
        'content',
        'content_hash',
        'chunk_index',
        'parent_chunk_id',
        'created_at',
        'updated_at',
      ])
    );

    const constraints = await client.query<{ conname: string; contype: string; definition: string }>(
      `
      SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.fqc_chunks'::regclass
      ORDER BY conname
      `
    );
    expect(constraints.rows.some((row) => row.contype === 'u' && row.definition.includes('instance_id, document_id, heading_path, chunk_index'))).toBe(true);
    expect(constraints.rows.some((row) => row.definition.includes('REFERENCES fqc_documents(id) ON DELETE CASCADE'))).toBe(true);
    expect(constraints.rows.some((row) => row.definition.includes('REFERENCES fqc_chunks(id) ON DELETE CASCADE'))).toBe(true);

    const indexes = await client.query<{ indexname: string }>(
      `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'fqc_chunks'
      `
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'idx_fqc_chunks_document_id',
        'idx_fqc_chunks_instance_id',
        'idx_fqc_chunks_heading_level',
      ])
    );
  });

  it('T-I-002 deleting a parent document cascades chunk rows', async () => {
    const documentId = await insertDocument(client);
    await client.query(
      `
      INSERT INTO fqc_chunks (
        id, instance_id, document_id, heading_path, heading_level, breadcrumb,
        content, content_hash, chunk_index
      )
      VALUES (gen_random_uuid(), $1, $2, ARRAY['Root'], 1, 'Root', 'content', 'hash-a', 0)
      `,
      [TEST_INSTANCE_ID, documentId]
    );

    await client.query('DELETE FROM fqc_documents WHERE id = $1', [documentId]);

    const remaining = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM fqc_chunks WHERE document_id = $1',
      [documentId]
    );
    expect(remaining.rows[0].count).toBe('0');
  });

  it('T-I-003 duplicate instance/document/heading/index chunks are rejected', async () => {
    const documentId = await insertDocument(client);
    const insert = `
      INSERT INTO fqc_chunks (
        id, instance_id, document_id, heading_path, heading_level, breadcrumb,
        content, content_hash, chunk_index
      )
      VALUES (gen_random_uuid(), $1, $2, ARRAY['Root'], 1, 'Root', $3, $4, 0)
    `;
    await client.query(insert, [TEST_INSTANCE_ID, documentId, 'content a', 'hash-a']);
    await expect(client.query(insert, [TEST_INSTANCE_ID, documentId, 'content b', 'hash-b'])).rejects.toThrow(
      /duplicate key value|unique constraint/i
    );
  });
});
