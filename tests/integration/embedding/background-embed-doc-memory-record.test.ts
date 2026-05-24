import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildSchemaDDL, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import { verifySchema } from '../../../src/storage/schema-verify.js';
import { initLogger } from '../../../src/logging/logger.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import {
  EMBEDDING_DEFERRED_WARNING,
  documentEmbeddingTarget,
  memoryEmbeddingTarget,
  recordEmbeddingTarget,
  scheduleBackgroundEmbedding,
} from '../../../src/embedding/background-embed.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-146-background-embed';

const REQUIRED_PENDING_COLUMNS = [
  'id',
  'instance_id',
  'target_kind',
  'target_table',
  'target_id',
  'target_label',
  'embed_text',
  'attempt_count',
  'last_error',
  'last_attempt_at',
  'next_retry_at',
  'status',
  'created_at',
  'updated_at',
] as const;

const failingProvider: EmbeddingProvider = {
  embed: async () => {
    throw new Error('forced provider failure');
  },
  getDimensions: () => 1536,
};

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-146-background-embed', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

describe('pending embedding schema foundation', () => {
  it('buildSchemaDDL creates fqc_pending_embeds with target metadata and retry indexes', () => {
    const ddl = buildSchemaDDL(1536);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_pending_embeds');
    for (const column of REQUIRED_PENDING_COLUMNS) {
      expect(ddl).toContain(column);
    }
    expect(ddl).toContain('target_kind');
    expect(ddl).toContain('attempt_count');
    expect(ddl).toContain('last_attempt_at');
    expect(ddl).toMatch(/UNIQUE INDEX IF NOT EXISTS .*fqc_pending_embeds.*instance_id.*target_kind.*target_table.*target_id/s);
    expect(ddl).toMatch(/INDEX IF NOT EXISTS .*fqc_pending_embeds.*instance_id.*status.*next_retry_at/s);
    expect(ddl).toMatch(/INDEX IF NOT EXISTS .*fqc_pending_embeds.*instance_id.*target_kind.*target_id/s);
  });
});

describe.skipIf(!HAS_SUPABASE)('pending embedding schema bootstrap (integration)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    const config = makeConfig();
    initLogger(config);
    await initSupabase(config);
    client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]).catch(() => undefined);
    await client?.end();
    await supabaseManager.close();
  });

  it('verifySchema accepts the bootstrapped pending embedding table and required columns', async () => {
    await expect(verifySchema(client)).resolves.toBeUndefined();

    const result = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_pending_embeds'
      `
    );
    const columns = new Set(result.rows.map((row: { column_name: string }) => row.column_name));
    for (const column of REQUIRED_PENDING_COLUMNS) {
      expect(columns.has(column)).toBe(true);
    }
  });

  it('forced provider failure creates pending rows for document, memory, and record targets', async () => {
    const supabase = supabaseManager.getClient();
    const targets = [
      documentEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: 'doc-target', label: 'Doc target' }),
      memoryEmbeddingTarget({ instanceId: TEST_INSTANCE_ID, id: 'memory-target', label: 'Memory target' }),
      recordEmbeddingTarget({
        instanceId: TEST_INSTANCE_ID,
        targetTable: 'fqcp_phase146_records',
        id: 'record-target',
        label: 'Record target',
      }),
    ];

    for (const target of targets) {
      const result = await scheduleBackgroundEmbedding({
        target,
        embedText: `${target.kind} retry text`,
        provider: failingProvider,
        supabase,
      });

      expect(result.warnings).toEqual([EMBEDDING_DEFERRED_WARNING]);
    }

    const { rows } = await client.query(
      `
      SELECT target_kind, target_table, target_id, target_label, embed_text, attempt_count, last_error, last_attempt_at, status
      FROM fqc_pending_embeds
      WHERE instance_id = $1
      ORDER BY target_kind
      `,
      [TEST_INSTANCE_ID]
    );

    expect(rows).toEqual([
      expect.objectContaining({
        target_kind: 'document',
        target_table: 'fqc_documents',
        target_id: 'doc-target',
        target_label: 'Doc target',
        embed_text: 'document retry text',
        attempt_count: 1,
        last_error: 'forced provider failure',
        status: 'pending',
      }),
      expect.objectContaining({
        target_kind: 'memory',
        target_table: 'fqc_memory',
        target_id: 'memory-target',
        target_label: 'Memory target',
        embed_text: 'memory retry text',
        attempt_count: 1,
        last_error: 'forced provider failure',
        status: 'pending',
      }),
      expect.objectContaining({
        target_kind: 'record',
        target_table: 'fqcp_phase146_records',
        target_id: 'record-target',
        target_label: 'Record target',
        embed_text: 'record retry text',
        attempt_count: 1,
        last_error: 'forced provider failure',
        status: 'pending',
      }),
    ]);
    for (const row of rows) {
      expect(row.last_attempt_at).toBeTruthy();
    }
  });
});
