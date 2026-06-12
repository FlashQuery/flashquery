import { describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { LifecycleJobRef } from '../../src/embedding/lifecycle/jobs.js';

const mocks = vi.hoisted(() => ({
  resolveCoreLifecycleWorkPlan: vi.fn(),
  runCoreLifecycle: vi.fn(),
  resolveRecordLifecycleWorkUnits: vi.fn(),
  executeRecordLifecycleWorkUnits: vi.fn(),
  resolveSingleRecordLifecycleEmbeddingName: vi.fn(),
  reindexRecordTables: vi.fn(),
  acquireLifecycleJob: vi.fn(),
  completeLifecycleJob: vi.fn(),
  failLifecycleJob: vi.fn(),
}));

vi.mock('../../src/embedding/lifecycle/core-processor.js', () => ({
  resolveCoreLifecycleWorkPlan: mocks.resolveCoreLifecycleWorkPlan,
  runCoreLifecycle: mocks.runCoreLifecycle,
}));

vi.mock('../../src/embedding/lifecycle/records-scope.js', () => ({
  estimateRecordLifecycleRows: vi.fn(() => ({ rows: 1 })),
  executeRecordLifecycleWorkUnits: mocks.executeRecordLifecycleWorkUnits,
  reindexRecordTables: mocks.reindexRecordTables,
  resolveRecordLifecycleWorkUnits: mocks.resolveRecordLifecycleWorkUnits,
  resolveSingleRecordLifecycleEmbeddingName: mocks.resolveSingleRecordLifecycleEmbeddingName,
}));

vi.mock('../../src/embedding/lifecycle/jobs.js', () => ({
  acquireLifecycleJob: mocks.acquireLifecycleJob,
  completeLifecycleJob: mocks.completeLifecycleJob,
  failLifecycleJob: mocks.failLifecycleJob,
}));

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      id: 'unit-mixed-background',
      name: 'unit-mixed-background',
      vault: { path: '/tmp/unit-mixed-background', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
      skipDdl: false,
    },
    logging: { level: 'error', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

const publicJob: LifecycleJobRef = {
  job_id: '00000000-0000-4000-8000-000000000167',
  started_at: '2026-06-12T17:30:00.000Z',
};

const hiddenJob: LifecycleJobRef = {
  job_id: '00000000-0000-4000-8000-000000000999',
  started_at: '2026-06-12T17:31:00.000Z',
};

function setupLifecycleMocks(): void {
  vi.clearAllMocks();
  mocks.resolveCoreLifecycleWorkPlan.mockResolvedValue({
    ok: true,
    payload: {
      embeddingName: 'primary',
      catalog: { name: 'primary', dimensions: 3, endpoints: [], status: 'active' },
      rows: [{ id: 'doc-1' }],
      skippedAlreadyPresent: 0,
    },
  });
  mocks.runCoreLifecycle.mockResolvedValue({
    ok: true,
    payload: {
      action: 'backfill_embeddings',
      started_at: '2026-06-12T17:30:00.000Z',
      finished_at: '2026-06-12T17:30:01.000Z',
      dry_run: false,
      embedding_name: 'primary',
      counts: {
        rows_examined: 1,
        rows_embedded: 1,
        rows_failed: 0,
        rows_skipped_already_present: 0,
      },
    },
  });
  mocks.resolveRecordLifecycleWorkUnits.mockResolvedValue({
    ok: true,
    payload: {
      work_units: [
        {
          plugin_id: 'notes',
          plugin_instance: 'default',
          table_name: 'notes',
          full_table_name: 'fqcp_notes_default_notes',
          embed_fields: ['body'],
          embedding_name: 'primary',
          embedding_entry: { name: 'primary', dimensions: 3, endpoints: [] },
          rows: [{ id: 'record-1', fields: { body: 'hello' } }],
          rows_skipped_no_embedding: 0,
        },
      ],
      rows_in_scope: 1,
      rows_skipped_no_embedding: 0,
      resolved_embedding_names: ['primary'],
    },
  });
  mocks.resolveSingleRecordLifecycleEmbeddingName.mockReturnValue({ ok: true, payload: 'primary' });
  mocks.acquireLifecycleJob.mockResolvedValue({ ok: true, payload: hiddenJob });
  mocks.executeRecordLifecycleWorkUnits.mockResolvedValue({
    aborted: false,
    rows_examined: 1,
    rows_embedded: 1,
    rows_failed: 0,
    rows_skipped_no_embedding: 0,
    failures: [],
    warnings: [],
    affected_tables: new Set<string>(),
    plugin_breakdown: [
      {
        plugin_id: 'notes',
        plugin_instance: 'default',
        table_name: 'notes',
        embedding_name: 'primary',
        rows_examined: 1,
        rows_embedded: 1,
        rows_failed: 0,
        rows_skipped_no_embedding: 0,
      },
    ],
  });
}

describe('mixed core+records background lifecycle job ownership', () => {
  it('REQ-035 keeps mixed backfill records work inside the returned public job boundary', async () => {
    setupLifecycleMocks();
    const { runBackfillEmbeddings } = await import('../../src/embedding/lifecycle/backfill.js');

    await runBackfillEmbeddings(
      makeConfig(),
      {
        action: 'backfill_embeddings',
        embedding_name: 'primary',
        scope: { entity_types: ['documents', 'records'] },
        max_rows: 0,
      },
      publicJob
    );

    expect(mocks.acquireLifecycleJob).not.toHaveBeenCalled();
    expect(mocks.executeRecordLifecycleWorkUnits).toHaveBeenCalledWith(
      expect.objectContaining({ job: publicJob })
    );
    expect(mocks.completeLifecycleJob).toHaveBeenCalledWith(
      expect.anything(),
      publicJob.job_id,
      expect.anything(),
      []
    );
  });

  it('REQ-036 keeps mixed rebuild records work inside the returned public job boundary', async () => {
    setupLifecycleMocks();
    mocks.runCoreLifecycle.mockResolvedValueOnce({
      ok: true,
      payload: {
        action: 'rebuild_embeddings',
        started_at: '2026-06-12T17:30:00.000Z',
        finished_at: '2026-06-12T17:30:01.000Z',
        dry_run: false,
        embedding_name: 'primary',
        counts: {
          rows_examined: 1,
          rows_embedded: 1,
          rows_failed: 0,
        },
      },
    });
    const { runRebuildEmbeddings } = await import('../../src/embedding/lifecycle/rebuild.js');

    await runRebuildEmbeddings(
      makeConfig(),
      {
        action: 'rebuild_embeddings',
        embedding_name: 'primary',
        confirm: 'primary',
        scope: { entity_types: ['documents', 'records'] },
        max_rows: 10,
      },
      publicJob
    );

    expect(mocks.acquireLifecycleJob).not.toHaveBeenCalled();
    expect(mocks.executeRecordLifecycleWorkUnits).toHaveBeenCalledWith(
      expect.objectContaining({ job: publicJob })
    );
    expect(mocks.completeLifecycleJob).toHaveBeenCalledWith(
      expect.anything(),
      publicJob.job_id,
      expect.anything(),
      []
    );
  });
});
