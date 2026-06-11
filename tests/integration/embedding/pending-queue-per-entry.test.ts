import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildSchemaDDL, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import {
  documentEmbeddingTarget,
  scheduleBackgroundEmbedding,
} from '../../../src/embedding/background-embed.js';
import type { EmbeddingProvider } from '../../../src/embedding/provider.js';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import { initLogger } from '../../../src/logging/logger.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-166-pending-queue';

const failingProvider = (message: string): EmbeddingProvider => ({
  embed: async () => {
    throw new Error(message);
  },
  getDimensions: () => 3,
  getProviderInfo: () => ({ provider: 'test-provider', model: 'test-model' }),
});

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-166-pending-queue', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

describe('per-entry pending embedding queue DDL', () => {
  it('T-I-037 declares embedding_name and extends the pending-row unique key', () => {
    const ddl = buildSchemaDDL(3);

    expect(ddl).toContain('embedding_name TEXT NOT NULL');
    expect(ddl).toContain('DROP INDEX IF EXISTS idx_fqc_pending_embeds_target_unique');
    expect(ddl).toMatch(
      /UNIQUE INDEX IF NOT EXISTS idx_fqc_pending_embeds_target_entry_unique\s+ON fqc_pending_embeds\(instance_id, target_kind, target_table, target_id, embedding_name\)/s
    );
  });
});

describe.skipIf(!HAS_SUPABASE)('per-entry pending embedding queue (integration)', () => {
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

  it('T-I-037 creates embedding_name and an extended unique index in the database', async () => {
    const columns = await client.query<{ column_name: string; is_nullable: string }>(
      `
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqc_pending_embeds'
        AND column_name = 'embedding_name'
      `
    );
    expect(columns.rows).toEqual([{ column_name: 'embedding_name', is_nullable: 'NO' }]);

    const indexes = await client.query<{ indexdef: string }>(
      `
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'fqc_pending_embeds'
        AND indexname = 'idx_fqc_pending_embeds_target_entry_unique'
      `
    );
    expect(indexes.rows[0]?.indexdef).toContain('(instance_id, target_kind, target_table, target_id, embedding_name)');
  });

  it('T-I-038 failed embed for entry X upserts a pending row with embedding_name X', async () => {
    await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);

    const result = await scheduleBackgroundEmbedding({
      target: documentEmbeddingTarget({
        instanceId: TEST_INSTANCE_ID,
        id: '00000000-0000-4000-8000-000000016601',
        label: 'entry-x.md',
      }),
      embedText: 'entry X text',
      provider: failingProvider('entry X unavailable'),
      supabase: supabaseManager.getClient(),
      embeddingName: 'entry_x',
    });

    expect(result.warnings).toEqual(['embedding_deferred:entry_x']);
    const pending = await client.query(
      `
      SELECT target_id, embedding_name, attempt_count, last_error, status
      FROM fqc_pending_embeds
      WHERE instance_id = $1
      `,
      [TEST_INSTANCE_ID]
    );
    expect(pending.rows).toEqual([
      expect.objectContaining({
        target_id: '00000000-0000-4000-8000-000000016601',
        embedding_name: 'entry_x',
        attempt_count: 1,
        last_error: 'entry X unavailable',
        status: 'pending',
      }),
    ]);
  });

  it('T-I-039 two entries can hold pending rows for the same target independently', async () => {
    await client.query('DELETE FROM fqc_pending_embeds WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    const target = documentEmbeddingTarget({
      instanceId: TEST_INSTANCE_ID,
      id: '00000000-0000-4000-8000-000000016602',
      label: 'same-target.md',
    });

    await Promise.all([
      scheduleBackgroundEmbedding({
        target,
        embedText: 'same target primary',
        provider: failingProvider('primary failed'),
        supabase: supabaseManager.getClient(),
        embeddingName: 'primary',
      }),
      scheduleBackgroundEmbedding({
        target,
        embedText: 'same target analysis',
        provider: failingProvider('analysis failed'),
        supabase: supabaseManager.getClient(),
        embeddingName: 'analysis',
      }),
    ]);

    const pending = await client.query(
      `
      SELECT embedding_name, embed_text, attempt_count, last_error
      FROM fqc_pending_embeds
      WHERE instance_id = $1
        AND target_id = $2
      ORDER BY embedding_name
      `,
      [TEST_INSTANCE_ID, target.targetId]
    );
    expect(pending.rows).toEqual([
      expect.objectContaining({
        embedding_name: 'analysis',
        embed_text: 'same target analysis',
        attempt_count: 1,
        last_error: 'analysis failed',
      }),
      expect.objectContaining({
        embedding_name: 'primary',
        embed_text: 'same target primary',
        attempt_count: 1,
        last_error: 'primary failed',
      }),
    ]);
  });
});
