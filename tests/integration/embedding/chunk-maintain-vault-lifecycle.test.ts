import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { runBackfillEmbeddings } from '../../../src/embedding/lifecycle/backfill.js';
import { runRebuildEmbeddings } from '../../../src/embedding/lifecycle/rebuild.js';
import { initLogger } from '../../../src/logging/logger.js';
import { createCoreEmbeddingColumnSet, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const providerState = vi.hoisted(() => ({
  failOn: '',
}));

vi.mock('../../../src/embedding/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/embedding/provider.js')>();
  return {
    ...actual,
    createEmbeddingProviderForCatalogEntry: vi.fn((_config: unknown, entry: { name: string; dimensions: number }) => ({
      embed: vi.fn(async (text: string) => {
        if (providerState.failOn && text.includes(providerState.failOn)) {
          throw new Error(`forced chunk lifecycle failure for ${providerState.failOn}`);
        }
        return Array.from({ length: entry.dimensions }, (_, index) => (index + 1) / 10);
      }),
      getDimensions: () => entry.dimensions,
      getProviderInfo: () => ({ provider: 'mock-provider', model: 'mock-current' }),
    })),
  };
});

const TEST_INSTANCE_ID = 'embedding-chunk-lifecycle-test';
const LONG_BODY = Array.from({ length: 140 }, (_, index) => `chunk-life-${index}`).join(' ');

function makeConfig(vaultPath: string): FlashQueryConfig {
  const config = loadConfig('tests/fixtures/flashquery.test.yml');
  config.instance.id = TEST_INSTANCE_ID;
  config.instance.name = TEST_INSTANCE_ID;
  config.instance.vault.path = vaultPath;
  config.supabase.url = TEST_SUPABASE_URL;
  config.supabase.serviceRoleKey = TEST_SUPABASE_KEY;
  config.supabase.databaseUrl = TEST_DATABASE_URL;
  config.supabase.skipDdl = false;
  config.locking = { enabled: false };
  config.embeddingLifecycle = { lockStaleMs: 5 * 60 * 1000 };
  config.embeddings = [
    {
      name: 'primary',
      dimensions: 3,
      endpoints: [{ providerName: 'mock-provider', model: 'mock-current' }],
    },
  ];
  return config;
}

async function cleanup(client: pg.Client): Promise<void> {
  await client.query('DELETE FROM fqc_maintenance_jobs WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_documents WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
}

async function insertCatalog(client: pg.Client): Promise<void> {
  await client.query(
    `INSERT INTO fqc_embeddings (instance_id, name, dimensions, endpoints, source, status)
     VALUES ($1, 'primary', 3, $2::jsonb, 'yaml', 'active')`,
    [TEST_INSTANCE_ID, JSON.stringify([{ provider_name: 'mock-provider', model: 'mock-current' }])]
  );
}

async function insertDocument(client: pg.Client, vaultPath: string, path: string, body: string): Promise<string> {
  await mkdir(join(vaultPath, path, '..'), { recursive: true });
  await writeFile(join(vaultPath, path), body, 'utf-8');
  const id = randomUUID();
  const result = await client.query<{ id: string }>(
    `INSERT INTO fqc_documents (id, instance_id, path, title, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING id::text`,
    [id, TEST_INSTANCE_ID, path, path]
  );
  return result.rows[0].id;
}

async function chunks(client: pg.Client, documentId: string): Promise<Array<Record<string, unknown>>> {
  const result = await client.query(
    `SELECT id::text, heading_path, content, embedding_primary::text AS vector,
            embedding_primary_model AS model, embedding_primary_indexed_at AS indexed_at
     FROM fqc_chunks
     WHERE instance_id = $1 AND document_id = $2
     ORDER BY heading_path, chunk_index`,
    [TEST_INSTANCE_ID, documentId]
  );
  return result.rows;
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk maintain_vault lifecycle integration', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;
  let vaultPath: string;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'chunk-lifecycle-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    await createCoreEmbeddingColumnSet(config, config.embeddings![0]);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
  }, 90_000);

  beforeEach(async () => {
    providerState.failOn = '';
    await cleanup(client);
    await insertCatalog(client);
  });

  afterAll(async () => {
    await cleanup(client).catch(() => undefined);
    await client?.end().catch(() => undefined);
    await supabaseManager.close().catch(() => undefined);
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('T-I-020 backfill creates missing chunks and embeds missing per-entry chunk vectors', async () => {
    const documentId = await insertDocument(
      client,
      vaultPath,
      'chunks/lifecycle-backfill.md',
      `# Lifecycle Backfill\n\n## Alpha\n\n${LONG_BODY}`
    );

    const result = await runBackfillEmbeddings(config, {
      action: 'backfill_embeddings',
      embedding_name: 'primary',
      scope: { entity_types: ['documents'] },
      max_rows: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.payload.counts.rows_examined).toBeGreaterThan(0);
    expect(result.payload.counts.rows_embedded).toBe(result.payload.counts.rows_examined);
    expect(result.payload.by_document).toEqual([
      expect.objectContaining({ document_id: documentId, chunks_examined: result.payload.counts.rows_examined }),
    ]);
    expect((await chunks(client, documentId)).every((chunk) => chunk.vector !== null)).toBe(true);
  });

  it('T-I-021 rebuild regenerates chunks, deletes orphans, and re-embeds scoped chunks', async () => {
    const documentId = await insertDocument(
      client,
      vaultPath,
      'chunks/lifecycle-rebuild.md',
      `# Lifecycle Rebuild\n\n## Old\n\n${LONG_BODY}`
    );
    await runBackfillEmbeddings(config, {
      action: 'backfill_embeddings',
      embedding_name: 'primary',
      scope: { entity_types: ['documents'] },
      max_rows: 0,
    });

    await writeFile(
      join(vaultPath, 'chunks/lifecycle-rebuild.md'),
      `# Lifecycle Rebuild\n\n## New\n\n${LONG_BODY}`,
      'utf-8'
    );
    const result = await runRebuildEmbeddings(config, {
      action: 'rebuild_embeddings',
      embedding_name: 'primary',
      confirm: 'primary',
      scope: { entity_types: ['documents'], path_prefix: 'chunks/lifecycle-rebuild.md' },
      max_rows: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const rows = await chunks(client, documentId);
    expect(rows.some((chunk) => String(chunk.heading_path).includes('Old'))).toBe(false);
    expect(rows.some((chunk) => String(chunk.heading_path).includes('New'))).toBe(true);
    expect(rows.every((chunk) => chunk.model === 'mock-current')).toBe(true);
  });

  it('T-I-022 stale_only filters by chunk model stamp', async () => {
    const documentId = await insertDocument(
      client,
      vaultPath,
      'chunks/lifecycle-stale.md',
      `# Lifecycle Stale\n\n## Alpha\n\n${LONG_BODY}\n\n## Beta\n\n${LONG_BODY}`
    );
    await runBackfillEmbeddings(config, {
      action: 'backfill_embeddings',
      embedding_name: 'primary',
      scope: { entity_types: ['documents'] },
      max_rows: 0,
    });
    await client.query(
      `UPDATE fqc_chunks
       SET embedding_primary_model = 'mock-current'
       WHERE instance_id = $1 AND document_id = $2 AND heading_path LIKE '%Alpha%'`,
      [TEST_INSTANCE_ID, documentId]
    );
    await client.query(
      `UPDATE fqc_chunks
       SET embedding_primary_model = 'mock-old'
       WHERE instance_id = $1 AND document_id = $2 AND heading_path LIKE '%Beta%'`,
      [TEST_INSTANCE_ID, documentId]
    );

    const result = await runRebuildEmbeddings(config, {
      action: 'rebuild_embeddings',
      embedding_name: 'primary',
      confirm: 'primary',
      scope: { entity_types: ['documents'], path_prefix: 'chunks/lifecycle-stale.md' },
      max_rows: 0,
      stale_only: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.payload.counts.rows_examined).toBe(1);
  });

  it('T-I-023 per-chunk failures include document id, chunk id, heading path, and error', async () => {
    const documentId = await insertDocument(
      client,
      vaultPath,
      'chunks/lifecycle-failure.md',
      `# Lifecycle Failure\n\n## FailMe\n\n${LONG_BODY}`
    );
    providerState.failOn = 'FailMe';

    const result = await runBackfillEmbeddings(config, {
      action: 'backfill_embeddings',
      embedding_name: 'primary',
      scope: { entity_types: ['documents'] },
      max_rows: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.payload.failures).toEqual([
      expect.objectContaining({
        entity_type: 'document_chunk',
        document_id: documentId,
        chunk_id: expect.any(String),
        heading_path: expect.stringContaining('FailMe'),
        error: expect.stringContaining('forced chunk lifecycle failure'),
      }),
    ]);
  });
});
