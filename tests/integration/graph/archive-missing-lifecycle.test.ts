import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { FM } from '../../../src/constants/frontmatter-fields.js';
import { initLogger } from '../../../src/logging/logger.js';
import { runScanOnce } from '../../../src/services/scanner.js';
import { computeHash } from '../../../src/storage/document-primitives.js';
import { initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { initVault } from '../../../src/storage/vault.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, '../../fixtures/flashquery.test.yml');
const TEST_INSTANCE_ID = 'graph-archive-missing-lifecycle-it';

function configForTest(vaultPath: string): FlashQueryConfig {
  const config = loadConfig(configPath);
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.instance.vault.path = vaultPath;
  config.embeddings = [];
  config.graph = { enabled: true };
  return config;
}

async function writeMarkdown(vaultPath: string, path: string, frontmatter: Record<string, unknown>, body: string) {
  const raw = matter.stringify(body, frontmatter);
  await mkdir(dirname(join(vaultPath, path)), { recursive: true });
  await writeFile(join(vaultPath, path), raw, 'utf-8');
  return raw;
}

async function insertDocumentWithGraph(
  client: pg.Client,
  input: { id: string; path: string; status: string; raw: string; title: string }
): Promise<{ rootChunkId: string; childChunkId: string }> {
  await client.query(
    `
    INSERT INTO fqc_documents (id, instance_id, path, title, tags, status, content_hash)
    VALUES ($1, $2, $3, $4, ARRAY['graph-lifecycle'], $5, $6)
    `,
    [input.id, TEST_INSTANCE_ID, input.path, input.title, input.status, computeHash(input.raw)]
  );
  const root = await insertChunk(client, input.id, 'Root', 'root body');
  const child = await insertChunk(client, input.id, 'Child', 'child body');
  await insertNode(client, root);
  await insertNode(client, child);
  await client.query(
    `
    INSERT INTO fqc_graph_edges (
      instance_id, source_chunk_id, target_chunk_id, relation,
      confidence, confidence_score, reasoning, status
    )
    VALUES ($1, $2, $3, 'supports', 'INFERRED', 0.91, 'seeded graph edge', 'active')
    `,
    [TEST_INSTANCE_ID, root, child]
  );
  await client.query(
    `
    INSERT INTO fqc_pending_edges (instance_id, source_chunk_id, target_chunk_id, status)
    VALUES ($1, $2, $3, 'pending')
    ON CONFLICT (instance_id, source_chunk_id, target_chunk_id) DO NOTHING
    `,
    [TEST_INSTANCE_ID, child, root]
  );
  return { rootChunkId: root, childChunkId: child };
}

async function insertChunk(client: pg.Client, documentId: string, heading: string, content: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
    INSERT INTO fqc_chunks (
      id, instance_id, document_id, heading_path, heading_level, breadcrumb,
      content, content_hash, chunk_index
    )
    VALUES (gen_random_uuid(), $1, $2, $3, 1, $3, $4, md5($4), 0)
    RETURNING id::text AS id
    `,
    [TEST_INSTANCE_ID, documentId, heading, content]
  );
  return result.rows[0]!.id;
}

async function insertNode(client: pg.Client, chunkId: string): Promise<void> {
  await client.query(
    `INSERT INTO fqc_graph_nodes (chunk_id, instance_id) VALUES ($1, $2)`,
    [chunkId, TEST_INSTANCE_ID]
  );
}

async function lifecycleCounts(client: pg.Client, documentId: string) {
  const result = await client.query<{
    chunks: string;
    nodes: string;
    active_edges: string;
    stale_edges: string;
    pending_edges: string;
    status: string | null;
  }>(
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
        WHERE e.instance_id = $1 AND c.document_id = $2 AND e.status = 'active'
      ) AS active_edges,
      (
        SELECT count(*)::text
        FROM fqc_graph_edges e
        JOIN fqc_chunks c ON c.id = e.source_chunk_id
        WHERE e.instance_id = $1 AND c.document_id = $2 AND e.status = 'stale'
      ) AS stale_edges,
      (
        SELECT count(*)::text
        FROM fqc_pending_edges p
        JOIN fqc_chunks c ON c.id = p.source_chunk_id
        WHERE p.instance_id = $1 AND c.document_id = $2
      ) AS pending_edges,
      (SELECT status FROM fqc_documents WHERE instance_id = $1 AND id = $2) AS status
    `,
    [TEST_INSTANCE_ID, documentId]
  );
  const row = result.rows[0]!;
  return {
    chunks: Number(row.chunks),
    nodes: Number(row.nodes),
    activeEdges: Number(row.active_edges),
    staleEdges: Number(row.stale_edges),
    pendingEdges: Number(row.pending_edges),
    status: row.status,
  };
}

describe.skipIf(!HAS_SUPABASE).sequential('archive and missing graph lifecycle', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;
  let vaultPath: string;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-graph-lifecycle-'));
    config = configForTest(vaultPath);
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    client = await setupTestSupabase();
  }, 90_000);

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await rm(vaultPath, { recursive: true, force: true });
    await mkdir(vaultPath, { recursive: true });
  });

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
    await supabaseManager?.close();
  });

  it('T-I-021/T-I-022 preserves archived graph state and marks drift stale without reprocessing', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const path = 'Archive/Drift.md';
    const originalRaw = await writeMarkdown(
      vaultPath,
      path,
      { [FM.ID]: documentId, [FM.TITLE]: 'Archived Drift', [FM.STATUS]: 'archived' },
      '# Original\n\nOld archived content.'
    );
    await insertDocumentWithGraph(client, {
      id: documentId,
      path,
      status: 'archived',
      raw: originalRaw,
      title: 'Archived Drift',
    });
    await writeMarkdown(
      vaultPath,
      path,
      { [FM.ID]: documentId, [FM.TITLE]: 'Archived Drift', [FM.STATUS]: 'archived' },
      '# Original\n\nChanged archived content.'
    );

    await runScanOnce(config);

    expect(await lifecycleCounts(client, documentId)).toMatchObject({
      chunks: 2,
      nodes: 2,
      activeEdges: 0,
      staleEdges: 1,
      pendingEdges: 1,
      status: 'archived',
    });
  }, 120_000);

  it('T-I-023 restores a missing document with hash drift and resumes chunk processing', async () => {
    const documentId = '22222222-2222-4222-8222-222222222222';
    const path = 'Missing/Restored.md';
    const oldRaw = matter.stringify('# Old\n\nOld missing content.', {
      [FM.ID]: documentId,
      [FM.TITLE]: 'Restored Missing',
      [FM.STATUS]: 'missing',
    });
    await client.query(
      `
      INSERT INTO fqc_documents (id, instance_id, path, title, tags, status, content_hash)
      VALUES ($1, $2, $3, 'Restored Missing', ARRAY['graph-lifecycle'], 'missing', $4)
      `,
      [documentId, TEST_INSTANCE_ID, path, computeHash(oldRaw)]
    );
    await writeMarkdown(
      vaultPath,
      path,
      { [FM.ID]: documentId, [FM.TITLE]: 'Restored Missing', [FM.STATUS]: 'active' },
      '# Restored\n\nRestored active content.\n\n## Child\n\nA child section creates structural graph work.'
    );

    await runScanOnce(config);

    const counts = await lifecycleCounts(client, documentId);
    expect(counts.status).toBe('active');
    expect(counts.chunks).toBeGreaterThan(0);
    expect(counts.nodes).toBe(counts.chunks);
  }, 120_000);

  it('hard deleting the document row cascades chunks, graph nodes, edges, and pending graph jobs', async () => {
    const documentId = '33333333-3333-4333-8333-333333333333';
    const path = 'Delete/Hard.md';
    const raw = await writeMarkdown(
      vaultPath,
      path,
      { [FM.ID]: documentId, [FM.TITLE]: 'Hard Delete', [FM.STATUS]: 'active' },
      '# Hard\n\nHard delete content.'
    );
    await insertDocumentWithGraph(client, {
      id: documentId,
      path,
      status: 'active',
      raw,
      title: 'Hard Delete',
    });

    await client.query('DELETE FROM fqc_documents WHERE instance_id = $1 AND id = $2', [TEST_INSTANCE_ID, documentId]);

    expect(await lifecycleCounts(client, documentId)).toEqual({
      chunks: 0,
      nodes: 0,
      activeEdges: 0,
      staleEdges: 0,
      pendingEdges: 0,
      status: null,
    });
  });
});
