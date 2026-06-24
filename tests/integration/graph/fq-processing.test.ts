import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { FM } from '../../../src/constants/frontmatter-fields.js';
import { scheduleChangedDocumentChunks } from '../../../src/embedding/chunks/scheduler.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-fq-processing-test';

function configForTest(graphEnabled: boolean): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.embeddings = [];
  config.graph = { enabled: graphEnabled };
  return config;
}

function longText(label: string): string {
  return Array.from({ length: 130 }, (_, index) => `${label}-${index}`).join(' ');
}

function graphBody(version: string): string {
  return [
    '# Processing Root',
    '',
    longText(`root-${version}`),
    '',
    '## Processing Child',
    '',
    longText(`child-${version}`),
  ].join('\n');
}

async function insertDocument(client: pg.Client, path: string): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags)
    VALUES (gen_random_uuid(), $1, $2, 'Processing Doc', ARRAY['graph'])
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, path]
  );
  return inserted.rows[0]!.id;
}

async function counts(client: pg.Client, documentId: string): Promise<{
  chunks: number;
  nodes: number;
  edges: number;
}> {
  const result = await client.query<{ chunks: string; nodes: string; edges: string }>(
    `
    SELECT
      (SELECT count(*)::text FROM fqc_chunks WHERE instance_id = $1 AND document_id = $2) AS chunks,
      (
        SELECT count(*)::text
        FROM fqc_graph_nodes n
        JOIN fqc_chunks c ON c.id = n.chunk_id
        WHERE n.instance_id = $1 AND c.document_id = $2
      ) AS nodes,
      (
        SELECT count(*)::text
        FROM fqc_graph_edges e
        JOIN fqc_chunks c ON c.id = e.source_chunk_id
        WHERE e.instance_id = $1 AND c.document_id = $2
      ) AS edges
    `,
    [TEST_INSTANCE_ID, documentId]
  );
  const row = result.rows[0]!;
  return {
    chunks: Number(row.chunks),
    nodes: Number(row.nodes),
    edges: Number(row.edges),
  };
}

describe.skipIf(!HAS_SUPABASE).sequential('fq_processing graph gates', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    config = configForTest(true);
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

  it('T-I-007 full writes structural graph state, embedded removes graph state, and none removes chunks', async () => {
    const documentId = await insertDocument(client, '/fq-processing.md');

    await scheduleChangedDocumentChunks({
      config,
      supabase: supabaseManager.getClient(),
      documentId,
      documentPath: '/fq-processing.md',
      title: 'Processing Doc',
      body: graphBody('full'),
      frontmatter: { [FM.PROCESSING]: 'full' },
    });
    const full = await counts(client, documentId);
    expect(full.chunks).toBeGreaterThan(1);
    expect(full.nodes).toBe(full.chunks);
    expect(full.edges).toBeGreaterThan(0);

    await scheduleChangedDocumentChunks({
      config,
      supabase: supabaseManager.getClient(),
      documentId,
      documentPath: '/fq-processing.md',
      title: 'Processing Doc',
      body: graphBody('embedded'),
      frontmatter: { [FM.PROCESSING]: 'embedded' },
    });
    const embedded = await counts(client, documentId);
    expect(embedded.chunks).toBeGreaterThan(1);
    expect(embedded.nodes).toBe(0);
    expect(embedded.edges).toBe(0);

    await scheduleChangedDocumentChunks({
      config,
      supabase: supabaseManager.getClient(),
      documentId,
      documentPath: '/fq-processing.md',
      title: 'Processing Doc',
      body: graphBody('none'),
      frontmatter: { [FM.PROCESSING]: 'none' },
    });
    const none = await counts(client, documentId);
    expect(none).toEqual({ chunks: 0, nodes: 0, edges: 0 });
  });

  it('disabled graph mode short-circuits graph mutation even when fq_processing is full', async () => {
    const documentId = await insertDocument(client, '/fq-processing-disabled.md');
    const disabledConfig = configForTest(false);

    await scheduleChangedDocumentChunks({
      config: disabledConfig,
      supabase: supabaseManager.getClient(),
      documentId,
      documentPath: '/fq-processing-disabled.md',
      title: 'Processing Doc',
      body: graphBody('disabled'),
      frontmatter: { [FM.PROCESSING]: 'full' },
    });

    const disabled = await counts(client, documentId);
    expect(disabled.chunks).toBeGreaterThan(1);
    expect(disabled.nodes).toBe(0);
    expect(disabled.edges).toBe(0);
  });
});
