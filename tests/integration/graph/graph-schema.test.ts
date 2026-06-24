import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import { buildSchemaDDL, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { verifySchema } from '../../../src/storage/schema-verify.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-schema-test';

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

async function insertChunk(client: pg.Client, path: string): Promise<string> {
  const document = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags)
    VALUES (gen_random_uuid(), $1, $2, 'Graph Schema', ARRAY['graph'])
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, path]
  );
  const chunk = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_chunks (
      id, instance_id, document_id, heading_path, heading_level, breadcrumb,
      content, content_hash, chunk_index
    )
    VALUES (gen_random_uuid(), $1, $2, 'Root', 1, 'Root', 'content', md5($3), 0)
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, document.rows[0].id, path]
  );
  return chunk.rows[0].id;
}

describe.skipIf(!HAS_SUPABASE).sequential('graph schema DDL', () => {
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

  it('T-I-002 fresh schema creates graph tables, required columns, constraints, and indexes', async () => {
    await verifySchema(client);
    const columns = await client.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_graph_nodes'
      `
    );

    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        'chunk_id',
        'instance_id',
        'provenance_basis',
        'question_status',
        'question_resolution',
        'community_id',
        'community_label',
        'community_summary',
        'key_claims',
        'chunk_summary',
        'certainty_level',
        'staleness_risk',
        'external_refs',
        'temporal_markers',
        'analyzed_content_hash',
        'analyzed_by_model',
        'analyzed_at',
        'created_at',
        'updated_at',
      ])
    );

    const indexes = await client.query<{ indexname: string }>(
      `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('fqc_graph_nodes', 'fqc_graph_edges', 'fqc_pending_edges')
      `
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'idx_fqc_graph_nodes_instance_id',
        'idx_fqc_graph_edges_source',
        'idx_fqc_graph_edges_target',
        'idx_fqc_graph_edges_relation',
        'idx_fqc_pending_edges_retry',
      ])
    );
  });

  it('T-I-003 deleting a document cascades chunks, graph nodes, and graph edges', async () => {
    const sourceChunk = await insertChunk(client, '/graph-source.md');
    const targetChunk = await insertChunk(client, '/graph-target.md');
    await client.query('INSERT INTO fqc_graph_nodes (chunk_id, instance_id) VALUES ($1, $3), ($2, $3)', [
      sourceChunk,
      targetChunk,
      TEST_INSTANCE_ID,
    ]);
    await client.query(
      `
      INSERT INTO fqc_graph_edges (
        instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score
      )
      VALUES ($1, $2, $3, 'references', 'EXTRACTED', 1.0)
      `,
      [TEST_INSTANCE_ID, sourceChunk, targetChunk]
    );

    await client.query('DELETE FROM fqc_documents WHERE path = $1 AND instance_id = $2', [
      '/graph-source.md',
      TEST_INSTANCE_ID,
    ]);

    const remaining = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM fqc_graph_edges WHERE instance_id = $1',
      [TEST_INSTANCE_ID]
    );
    expect(remaining.rows[0].count).toBe('0');
  });

  it('T-I-004 duplicate graph node for same chunk is rejected', async () => {
    const chunkId = await insertChunk(client, '/graph-duplicate.md');
    const insert = 'INSERT INTO fqc_graph_nodes (chunk_id, instance_id) VALUES ($1, $2)';

    await client.query(insert, [chunkId, TEST_INSTANCE_ID]);
    await expect(client.query(insert, [chunkId, TEST_INSTANCE_ID])).rejects.toThrow(
      /duplicate key value|unique constraint/i
    );
  });

  it('T-I-025 buildSchemaDDL can rerun idempotently', async () => {
    await client.query(buildSchemaDDL(1536));

    await expect(client.query(buildSchemaDDL(1536))).resolves.toBeDefined();
  });

  it('T-I-044 initial fqc_graph_nodes DDL declares the full node inventory without ALTER migrations', () => {
    const ddl = buildSchemaDDL(1536);
    const nodeCreate = ddl.match(/CREATE TABLE IF NOT EXISTS fqc_graph_nodes \([\s\S]*?\n\);/)?.[0] ?? '';

    expect(nodeCreate).toContain('provenance_basis TEXT,');
    expect(nodeCreate).not.toMatch(/provenance_basis TEXT NOT NULL/i);
    expect(nodeCreate).toContain('community_summary TEXT');
    expect(nodeCreate).toContain('key_claims JSONB');
    expect(nodeCreate).toContain('temporal_markers JSONB');
    expect(nodeCreate).not.toMatch(/ALTER TABLE IF EXISTS fqc_graph_nodes/i);
  });

  it('T-I-044 initial fqc_pending_edges DDL declares durable queue contract columns and dedupe key', () => {
    const ddl = buildSchemaDDL(1536);
    const pendingCreate =
      ddl.match(/CREATE TABLE IF NOT EXISTS fqc_pending_edges \([\s\S]*?\n\);/)?.[0] ?? '';

    expect(pendingCreate).toContain('max_attempts INTEGER NOT NULL DEFAULT 3');
    expect(pendingCreate).toContain('result JSONB');
    expect(ddl).toMatch(
      /UNIQUE\s*\(\s*instance_id\s*,\s*source_chunk_id\s*,\s*target_chunk_id\s*\)/i
    );
  });
});
