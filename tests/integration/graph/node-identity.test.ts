import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { parseDocumentChunks } from '../../../src/embedding/chunks/parser.js';
import { upsertGraphNodesForChunks } from '../../../src/graph/structural.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-node-identity-test';

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

describe.skipIf(!HAS_SUPABASE).sequential('graph node identity integration', () => {
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

  it('T-I-005 chunk deletion cascades graph node and touching edges', async () => {
    const document = await client.query<{ id: string }>(
      `
      INSERT INTO fqc_documents (id, instance_id, path, title, tags)
      VALUES (gen_random_uuid(), $1, '/graph-node-identity.md', 'Graph Node Identity', ARRAY['graph'])
      RETURNING id::text AS id
      `,
      [TEST_INSTANCE_ID]
    );
    const chunks = parseDocumentChunks({
      instanceId: TEST_INSTANCE_ID,
      documentId: document.rows[0]!.id,
      title: 'Graph Node Identity',
      body: '# Root\n\nroot body words\n\n## Child\n\nchild body words',
      params: { minChunkTokens: 1, maxChunkTokens: 80, overlapRatio: 0 },
    });
    for (const chunk of chunks) {
      await client.query(
        `
        INSERT INTO fqc_chunks (
          id, instance_id, document_id, heading_path, heading_level, breadcrumb,
          content, content_hash, chunk_index, parent_chunk_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          chunk.id,
          TEST_INSTANCE_ID,
          chunk.document_id,
          chunk.heading_path,
          chunk.heading_level,
          chunk.breadcrumb,
          chunk.content,
          chunk.content_hash,
          chunk.chunk_index,
          chunk.parent_chunk_id,
        ]
      );
    }

    await upsertGraphNodesForChunks(client, { instanceId: TEST_INSTANCE_ID, chunks });
    await client.query(
      `
      INSERT INTO fqc_graph_edges (
        instance_id, source_chunk_id, target_chunk_id, relation, confidence, confidence_score
      )
      VALUES ($1, $2, $3, 'contains', 'EXTRACTED', 1.0)
      `,
      [TEST_INSTANCE_ID, chunks[0]!.id, chunks[1]!.id]
    );

    await client.query('DELETE FROM fqc_chunks WHERE instance_id = $1 AND id = $2', [
      TEST_INSTANCE_ID,
      chunks[1]!.id,
    ]);

    const nodes = await client.query<{ chunk_id: string }>(
      'SELECT chunk_id::text FROM fqc_graph_nodes WHERE instance_id = $1 ORDER BY chunk_id',
      [TEST_INSTANCE_ID]
    );
    const edges = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM fqc_graph_edges WHERE instance_id = $1',
      [TEST_INSTANCE_ID]
    );

    expect(nodes.rows.map((row) => row.chunk_id)).toEqual([chunks[0]!.id]);
    expect(edges.rows[0]!.count).toBe('0');
  });
});
