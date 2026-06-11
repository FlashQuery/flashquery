import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { FlashQueryConfig } from '../../../src/config/loader.js';
import {
  acquireLifecycleJob,
  completeLifecycleJob,
  getLifecycleJobStatus,
  requestLifecycleAbort,
} from '../../../src/embedding/lifecycle/jobs.js';
import { initLogger } from '../../../src/logging/logger.js';
import { maintainVault } from '../../../src/services/maintenance.js';
import { buildSchemaDDL, initSupabase, supabaseManager } from '../../../src/storage/supabase.js';
import {
  HAS_DIRECT_DATABASE_URL,
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-167-lifecycle-jobs';

function makeConfig(overrides: Partial<FlashQueryConfig['supabase']> = {}): FlashQueryConfig {
  return {
    instance: {
      name: TEST_INSTANCE_ID,
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/phase-167-lifecycle-jobs', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
      ...overrides,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 3 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false },
    embeddingLifecycle: { lockStaleMs: 5 * 60 * 1_000 },
  } as unknown as FlashQueryConfig;
}

describe('durable lifecycle job DDL', () => {
  it('REQ-038 declares maintenance jobs and a partial unique running lifecycle lock', () => {
    const ddl = buildSchemaDDL(3);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fqc_maintenance_jobs');
    expect(ddl).toContain('heartbeat_at TIMESTAMPTZ NOT NULL');
    expect(ddl).toContain("counts JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(ddl).toContain("failures JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_fqc_maintenance_jobs_running_entry\s+ON fqc_maintenance_jobs\(instance_id, embedding_name\)\s+WHERE status = 'running'\s+AND embedding_name IS NOT NULL\s+AND action IN \('backfill_embeddings', 'rebuild_embeddings', 'retire_embedding'\)/s
    );
  });

  it('REQ-038 returns an expected configuration error before mutation without direct PostgreSQL access', async () => {
    const result = await acquireLifecycleJob(makeConfig({ databaseUrl: undefined }), {
      action: 'backfill_embeddings',
      embedding_name: 'primary',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        error: 'invalid_input',
        identifier: 'supabase.databaseUrl',
        details: expect.objectContaining({ reason: 'direct_postgresql_required' }),
      }),
    });
  });

  it('REQ-039 wires maintain_vault abort to durable jobs after validation', async () => {
    const result = await maintainVault(makeConfig({ databaseUrl: undefined }), {
      action: 'abort',
      job_id: '00000000-0000-4000-8000-000000000167',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        error: 'invalid_input',
        identifier: 'supabase.databaseUrl',
        details: expect.objectContaining({ reason: 'direct_postgresql_required' }),
      }),
    });
  });

  it('REQ-039 rejects abort embedding-specific parameters before job lookup', async () => {
    const result = await maintainVault(makeConfig({ databaseUrl: undefined }), {
      action: 'abort',
      job_id: '00000000-0000-4000-8000-000000000167',
      embedding_name: 'primary',
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({
        error: 'invalid_input',
        identifier: 'embedding_name',
        details: expect.objectContaining({ parameter: 'embedding_name' }),
      }),
    });
  });
});

describe.skipIf(!HAS_SUPABASE || !HAS_DIRECT_DATABASE_URL)(
  'durable lifecycle job lock/status/abort helpers (integration)',
  () => {
    let client: pg.Client;

    beforeAll(async () => {
      const config = makeConfig();
      initLogger(config);
      await initSupabase(config);
      client = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await client.connect();
      await client.query('DELETE FROM fqc_maintenance_jobs WHERE instance_id = $1', [
        TEST_INSTANCE_ID,
      ]);
    }, 60_000);

    afterAll(async () => {
      await client
        ?.query('DELETE FROM fqc_maintenance_jobs WHERE instance_id = $1', [TEST_INSTANCE_ID])
        .catch(() => undefined);
      await client?.end();
      await supabaseManager.close();
    });

    it('REQ-038 returns conflict details for same-entry concurrency and allows different entries', async () => {
      const config = makeConfig();
      const first = await acquireLifecycleJob(config, {
        action: 'backfill_embeddings',
        embedding_name: 'primary',
      });
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(first.error.message);

      const conflict = await acquireLifecycleJob(config, {
        action: 'rebuild_embeddings',
        embedding_name: 'primary',
      });
      expect(conflict).toEqual({
        ok: false,
        error: expect.objectContaining({
          error: 'conflict',
          details: expect.objectContaining({
            in_flight_action: 'backfill_embeddings',
            in_flight_job_id: first.payload.job_id,
            started_at: expect.any(String),
            elapsed_ms: expect.any(Number),
          }),
        }),
      });

      const second = await acquireLifecycleJob(config, {
        action: 'backfill_embeddings',
        embedding_name: 'secondary',
      });
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(second.error.message);

      await completeLifecycleJob(config, first.payload.job_id, {
        rows_examined: 0,
        rows_embedded: 0,
        rows_failed: 0,
      });
      await completeLifecycleJob(config, second.payload.job_id, {
        rows_examined: 0,
        rows_embedded: 0,
        rows_failed: 0,
      });
    });

    it('REQ-038 marks stale heartbeat jobs terminal and lets the next caller acquire', async () => {
      const config = makeConfig();
      const stale = await acquireLifecycleJob(config, {
        action: 'backfill_embeddings',
        embedding_name: 'stale_entry',
      });
      expect(stale.ok).toBe(true);
      if (!stale.ok) throw new Error(stale.error.message);

      await client.query(
        "UPDATE fqc_maintenance_jobs SET heartbeat_at = now() - interval '10 minutes' WHERE id = $1",
        [stale.payload.job_id]
      );

      const recovered = await acquireLifecycleJob(
        config,
        {
          action: 'rebuild_embeddings',
          embedding_name: 'stale_entry',
        },
        { staleAfterMs: 1_000 }
      );
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) throw new Error(recovered.error.message);

      const oldStatus = await getLifecycleJobStatus(config, stale.payload.job_id);
      expect(oldStatus).toEqual({
        ok: true,
        payload: expect.objectContaining({
          status: 'failed',
          error: expect.objectContaining({
            error: 'runtime_error',
            details: expect.objectContaining({ reason: 'stale_heartbeat_recovered' }),
          }),
        }),
      });

      await completeLifecycleJob(config, recovered.payload.job_id, {
        rows_examined: 0,
        rows_embedded: 0,
        rows_failed: 0,
      });
    });

    it('REQ-038 honors the configured stale heartbeat threshold', async () => {
      const config = {
        ...makeConfig(),
        embeddingLifecycle: { lockStaleMs: 1 },
      } as FlashQueryConfig;
      const stale = await acquireLifecycleJob(config, {
        action: 'backfill_embeddings',
        embedding_name: 'configured_stale_entry',
      });
      expect(stale.ok).toBe(true);
      if (!stale.ok) throw new Error(stale.error.message);

      await client.query(
        "UPDATE fqc_maintenance_jobs SET heartbeat_at = now() - interval '1 second' WHERE id = $1",
        [stale.payload.job_id]
      );

      const recovered = await acquireLifecycleJob(config, {
        action: 'rebuild_embeddings',
        embedding_name: 'configured_stale_entry',
      });
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) throw new Error(recovered.error.message);

      await completeLifecycleJob(config, recovered.payload.job_id, {
        rows_examined: 0,
        rows_embedded: 0,
        rows_failed: 0,
      });
    });

    it('REQ-041 returns ambiguous_identifier with active entries when core embedding_name is omitted', async () => {
      const config = makeConfig();
      await client.query('DELETE FROM fqc_embeddings WHERE instance_id = $1', [TEST_INSTANCE_ID]);
      await client.query(
        `INSERT INTO fqc_embeddings(instance_id, name, dimensions, endpoints, source, status)
         VALUES
           ($1, 'analysis', 3, $2::jsonb, 'yaml', 'active'),
           ($1, 'primary', 3, $3::jsonb, 'yaml', 'active')`,
        [
          TEST_INSTANCE_ID,
          JSON.stringify([{ provider_name: 'test', model: 'analysis-model' }]),
          JSON.stringify([{ provider_name: 'test', model: 'primary-model' }]),
        ]
      );

      const result = await maintainVault(config, {
        action: 'backfill_embeddings',
        scope: { entity_types: ['documents'] },
        max_rows: 0,
      });

      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({
          error: 'ambiguous_identifier',
          identifier: 'embedding_name',
          details: expect.objectContaining({
            active_embeddings: ['analysis', 'primary'],
          }),
        }),
      });
    });

    it('REQ-039 aborts running lifecycle jobs, preserves partial counts, and releases the lock', async () => {
      const config = makeConfig();
      const running = await acquireLifecycleJob(config, {
        action: 'rebuild_embeddings',
        embedding_name: 'abortable',
        counts: { rows_examined: 4, rows_embedded: 2, rows_failed: 0 },
      });
      expect(running.ok).toBe(true);
      if (!running.ok) throw new Error(running.error.message);

      const aborted = await requestLifecycleAbort(config, running.payload.job_id);
      expect(aborted).toEqual({
        ok: true,
        payload: expect.objectContaining({
          status: 'aborted',
          actions: [
            expect.objectContaining({
              action: 'rebuild_embeddings',
              embedding_name: 'abortable',
              counts: expect.objectContaining({
                rows_examined: 4,
                rows_embedded: 2,
                rows_failed: 0,
              }),
            }),
          ],
        }),
      });

      const replacement = await acquireLifecycleJob(config, {
        action: 'backfill_embeddings',
        embedding_name: 'abortable',
      });
      expect(replacement.ok).toBe(true);
      if (!replacement.ok) throw new Error(replacement.error.message);
      await completeLifecycleJob(config, replacement.payload.job_id, {
        rows_examined: 0,
        rows_embedded: 0,
        rows_failed: 0,
      });
    });

    it('REQ-039 returns expected errors for unknown and non-running abort targets', async () => {
      const config = makeConfig();
      await expect(
        requestLifecycleAbort(config, '00000000-0000-4000-8000-000000000000')
      ).resolves.toEqual({
        ok: false,
        error: expect.objectContaining({ error: 'not_found' }),
      });

      const completed = await acquireLifecycleJob(config, {
        action: 'backfill_embeddings',
        embedding_name: 'completed',
      });
      expect(completed.ok).toBe(true);
      if (!completed.ok) throw new Error(completed.error.message);
      await completeLifecycleJob(config, completed.payload.job_id, {
        rows_examined: 1,
        rows_embedded: 1,
        rows_failed: 0,
      });

      await expect(requestLifecycleAbort(config, completed.payload.job_id)).resolves.toEqual({
        ok: false,
        error: expect.objectContaining({
          error: 'unsupported',
          details: expect.objectContaining({ status: 'completed' }),
        }),
      });
    });

    it('REQ-039 routes maintain_vault status and abort through durable lifecycle jobs', async () => {
      const config = makeConfig();
      const running = await acquireLifecycleJob(config, {
        action: 'rebuild_embeddings',
        embedding_name: 'service_abortable',
        counts: { rows_examined: 3, rows_embedded: 1, rows_failed: 0 },
      });
      expect(running.ok).toBe(true);
      if (!running.ok) throw new Error(running.error.message);

      await expect(
        maintainVault(config, { action: 'status', job_id: running.payload.job_id })
      ).resolves.toEqual({
        ok: true,
        payload: expect.objectContaining({
          job_id: running.payload.job_id,
          status: 'running',
          actions: [
            expect.objectContaining({
              action: 'rebuild_embeddings',
              embedding_name: 'service_abortable',
              counts: expect.objectContaining({
                rows_examined: 3,
                rows_embedded: 1,
                rows_failed: 0,
              }),
            }),
          ],
        }),
      });

      await expect(
        maintainVault(config, { action: 'abort', job_id: running.payload.job_id })
      ).resolves.toEqual({
        ok: true,
        payload: expect.objectContaining({
          job_id: running.payload.job_id,
          status: 'aborted',
          actions: [
            expect.objectContaining({
              action: 'rebuild_embeddings',
              counts: expect.objectContaining({
                rows_examined: 3,
                rows_embedded: 1,
                rows_failed: 0,
              }),
            }),
          ],
        }),
      });
    });
  }
);
