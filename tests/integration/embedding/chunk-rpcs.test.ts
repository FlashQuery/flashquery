import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { syncEmbeddingCatalog } from '../../../src/embedding/embedding-config-sync.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'embedding-chunk-rpc-test';

const managedColumns = [
  'embedding_primary',
  'embedding_primary_model',
  'embedding_primary_dimensions',
  'embedding_primary_provider',
  'embedding_primary_truncated',
  'embedding_primary_indexed_at',
] as const;

function vectorLiteral(dimensions: number, value = '0'): string {
  return `[${Array.from({ length: dimensions }, () => value).join(',')}]`;
}

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

async function cleanupPrimarySchema(client: pg.Client): Promise<void> {
  await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_maintenance_jobs WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DROP FUNCTION IF EXISTS match_memories_primary(vector, double precision, integer, text[], text, text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS match_chunks_primary(vector, double precision, integer, text, text[], text, boolean)');
  await client.query('DROP FUNCTION IF EXISTS match_documents_primary(vector, double precision, integer, text, text[], text, boolean)');
  for (const table of ['fqc_chunks', 'fqc_memory', 'fqc_documents'] as const) {
    await client.query(`DROP INDEX IF EXISTS idx_${table}_embedding_primary`);
    for (const column of managedColumns) {
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column} CASCADE`);
    }
  }
}

async function getFunctionDefinition(client: pg.Client, functionName: string): Promise<string | undefined> {
  const result = await client.query(
    `
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = $1
    `,
    [functionName]
  );
  return result.rows[0]?.definition;
}

async function vectorColumnType(client: pg.Client, tableName: string, columnName: string): Promise<string | undefined> {
  const result = await client.query(
    `
    SELECT format_type(a.atttypid, a.atttypmod) AS formatted_type
    FROM information_schema.columns c
    JOIN pg_class cl ON cl.relname = c.table_name
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = c.table_schema
    JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name = $1
      AND c.column_name = $2
    `,
    [tableName, columnName]
  );
  return result.rows[0]?.formatted_type;
}

async function insertChunkWithVector(client: pg.Client, dimensions: number, vector = vectorLiteral(dimensions, '1')): Promise<void> {
  const document = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags)
    VALUES (gen_random_uuid(), $1, '/rpc/chunks.md', 'Chunk RPCs', ARRAY['rpc'])
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID]
  );
  await client.query(
    `
    INSERT INTO fqc_chunks (
      id, instance_id, document_id, heading_path, heading_level, breadcrumb,
      content, content_hash, chunk_index, embedding_primary, embedding_primary_model,
      embedding_primary_dimensions, embedding_primary_provider, embedding_primary_truncated,
      embedding_primary_indexed_at
    )
    VALUES (
      gen_random_uuid(), $1, $2, 'Root > Child', 2, 'Root > Child',
      'chunk rpc content', 'hash-rpc', 0, $3::vector, 'text-embedding-3-small',
      $4, 'openai', false, now()
    )
    `,
    [TEST_INSTANCE_ID, document.rows[0].id, vector, dimensions]
  );
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk per-entry RPCs', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = configWithEmbeddings([]);
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
  }, 90000);

  beforeEach(async () => {
    await cleanupPrimarySchema(client);
    await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  }, 60000);

  afterAll(async () => {
    await cleanupPrimarySchema(client).catch(() => undefined);
    await client?.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager?.close();
  }, 60000);

  it('T-I-008 config sync creates match_chunks_primary with configured vector width', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    await expect(getFunctionDefinition(client, 'match_chunks_primary')).resolves.toContain('match_chunks_primary');
    await expect(vectorColumnType(client, 'fqc_chunks', 'embedding_primary')).resolves.toBe('vector(96)');
  });

  it('T-I-009 fresh config sync does not create match_documents_primary', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));

    await expect(getFunctionDefinition(client, 'match_documents_primary')).resolves.toBeUndefined();
  });

  it('T-I-010 match_chunks_primary returns chunk and parent document metadata with similarity', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 3,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));
    const document = await client.query<{ id: string }>(
      `
      INSERT INTO fqc_documents (id, instance_id, path, title, tags)
      VALUES (gen_random_uuid(), $1, '/rpc/chunks.md', 'Chunk RPCs', ARRAY['rpc'])
      RETURNING id::text AS id
      `,
      [TEST_INSTANCE_ID]
    );
    const chunk = await client.query<{ id: string }>(
      `
      INSERT INTO fqc_chunks (
        id, instance_id, document_id, heading_path, heading_level, breadcrumb,
        content, content_hash, chunk_index, embedding_primary, embedding_primary_model,
        embedding_primary_dimensions, embedding_primary_provider, embedding_primary_truncated,
        embedding_primary_indexed_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, 'Root > Child', 2, 'Root > Child',
        'chunk rpc content', 'hash-rpc', 0, $3::vector, 'text-embedding-3-small',
        3, 'openai', false, now()
      )
      RETURNING id::text AS id
      `,
      [TEST_INSTANCE_ID, document.rows[0].id, vectorLiteral(3, '1')]
    );

    const result = await client.query(
      `SELECT * FROM match_chunks_primary($1::vector, 0, 5, $2, ARRAY['rpc'], 'any', false)`,
      [vectorLiteral(3, '1'), TEST_INSTANCE_ID]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      chunk_id: chunk.rows[0].id,
      document_id: document.rows[0].id,
      path: '/rpc/chunks.md',
      title: 'Chunk RPCs',
      heading_path: 'Root > Child',
      heading_level: 2,
      breadcrumb: 'Root > Child',
      content: 'chunk rpc content',
      embedding_model: 'text-embedding-3-small',
      embedding_dimensions: 3,
      embedding_provider: 'openai',
      embedding_truncated: false,
    });
    expect(Number(result.rows[0].similarity)).toBeCloseTo(1);
    const indexedAt = result.rows[0].embedding_indexed_at;
    expect(typeof indexedAt === 'string' || indexedAt instanceof Date).toBe(true);
    const indexedAtText = indexedAt instanceof Date ? indexedAt.toISOString() : indexedAt;
    expect(Number.isNaN(Date.parse(indexedAtText))).toBe(false);
  });

  it('T-I-011 wrong-width query vector is rejected by Postgres', async () => {
    await syncEmbeddingCatalog(configWithEmbeddings([
      {
        name: 'primary',
        dimensions: 96,
        endpoints: [{ providerName: 'openai', model: 'text-embedding-3-small' }],
      },
    ]));
    await insertChunkWithVector(client, 96);

    await expect(
      client.query(`SELECT * FROM match_chunks_primary($1::vector, 0, 1)`, [vectorLiteral(95)])
    ).rejects.toThrow(/different vector dimensions|expected 96 dimensions/i);
  });
});
