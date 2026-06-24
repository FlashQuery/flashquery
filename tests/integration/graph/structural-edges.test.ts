import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { parseDocumentChunks } from '../../../src/embedding/chunks/parser.js';
import {
  refreshStructuralGraphEdges,
  upsertGraphNodesForChunks,
  type StructuralGraphDocument,
} from '../../../src/graph/structural.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-structural-edges-test';

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

async function insertDocumentWithChunks(
  client: pg.Client,
  path: string,
  title: string,
  body: string
): Promise<StructuralGraphDocument> {
  const document = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags)
    VALUES (gen_random_uuid(), $1, $2, $3, ARRAY['graph'])
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, path, title]
  );
  const chunks = parseDocumentChunks({
    instanceId: TEST_INSTANCE_ID,
    documentId: document.rows[0]!.id,
    title,
    body,
    params: { minChunkTokens: 1, maxChunkTokens: 100, overlapRatio: 0 },
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
  return { documentId: document.rows[0]!.id, path, title, chunks };
}

describe.skipIf(!HAS_SUPABASE).sequential('structural graph edge integration', () => {
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

  it('T-I-006 persists contains and references edges filtered by instance_id', async () => {
    const source = await insertDocumentWithChunks(
      client,
      '/source.md',
      'Source',
      '# Source Root\n\nSee [[target#Target Child]].\n\n## Source Child\n\nchild body'
    );
    const target = await insertDocumentWithChunks(
      client,
      '/target.md',
      'Target',
      '# Target Root\n\nroot body\n\n## Target Child\n\ntarget child body'
    );

    await refreshStructuralGraphEdges(client, {
      instanceId: TEST_INSTANCE_ID,
      document: source,
      documents: [source, target],
    });

    const edges = await client.query<{
      source_chunk_id: string;
      target_chunk_id: string;
      relation: string;
      confidence: string;
      confidence_score: number;
      status: string;
    }>(
      `
      SELECT source_chunk_id::text, target_chunk_id::text, relation, confidence, confidence_score, status
      FROM fqc_graph_edges
      WHERE instance_id = $1
      ORDER BY relation, source_chunk_id, target_chunk_id
      `,
      [TEST_INSTANCE_ID]
    );

    expect(edges.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_chunk_id: source.chunks[0]!.id,
          target_chunk_id: source.chunks[1]!.id,
          relation: 'contains',
          confidence: 'EXTRACTED',
          confidence_score: 1,
          status: 'active',
        }),
        expect.objectContaining({
          source_chunk_id: source.chunks[0]!.id,
          target_chunk_id: target.chunks[1]!.id,
          relation: 'references',
          confidence: 'EXTRACTED',
          confidence_score: 1,
          status: 'active',
        }),
      ])
    );

    const otherInstance = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM fqc_graph_edges WHERE instance_id = $1',
      ['another-instance']
    );
    expect(otherInstance.rows[0]!.count).toBe('0');
  });
});
