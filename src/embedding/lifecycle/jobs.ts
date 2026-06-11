import { randomUUID } from 'node:crypto';
import type { FlashQueryConfig } from '../../config/loader.js';
import type {
  ErrorEnvelope,
  MaintenanceActionResult,
  MaintenanceLifecycleActionResult,
} from '../../mcp/utils/response-formats.js';
import { withPgClient } from '../../utils/pg-client.js';
import type { LifecycleEmbeddingAction, LifecycleRunnableAction } from './types.js';

const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1_000;
const RUNNING_LIFECYCLE_ACTIONS = ['backfill_embeddings', 'rebuild_embeddings', 'retire_embedding'];

export interface LifecycleJobAcquireInput {
  action: LifecycleRunnableAction;
  embedding_name: string;
  counts?: Record<string, unknown>;
  failures?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface LifecycleJobAcquireOptions {
  staleAfterMs?: number;
}

export interface LifecycleJobRef {
  job_id: string;
  action: LifecycleRunnableAction;
  embedding_name: string;
  started_at: string;
}

export interface LifecycleJobStatusPayload {
  job_id: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  started_at: string;
  finished_at?: string;
  heartbeat_at: string;
  abort_requested_at?: string;
  actions: MaintenanceActionResult[];
  error?: ErrorEnvelope;
  metadata?: Record<string, unknown>;
}

export type LifecycleJobResult<T> = { ok: true; payload: T } | { ok: false; error: ErrorEnvelope };

interface LifecycleJobRow {
  id: string;
  instance_id: string;
  action: LifecycleRunnableAction;
  embedding_name: string | null;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  started_at: string;
  finished_at: string | null;
  heartbeat_at: string;
  abort_requested_at: string | null;
  counts: Record<string, unknown>;
  failures: Array<{ entity_type: string; identifier: string; message: string }>;
  error: ErrorEnvelope | null;
  metadata: Record<string, unknown>;
}

export async function acquireLifecycleJob(
  config: FlashQueryConfig,
  input: LifecycleJobAcquireInput,
  options: LifecycleJobAcquireOptions = {}
): Promise<LifecycleJobResult<LifecycleJobRef>> {
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const jobId = randomUUID();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  return await withPgClient(databaseUrl.payload, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `
        UPDATE fqc_maintenance_jobs
        SET status = 'failed',
            finished_at = now(),
            error = jsonb_build_object(
              'error', 'runtime_error',
              'message', 'Lifecycle job heartbeat became stale before completion',
              'details', jsonb_build_object('reason', 'stale_heartbeat_recovered')
            ),
            metadata = metadata || jsonb_build_object('stale_recovered_at', now())
        WHERE instance_id = $1
          AND embedding_name = $2
          AND status = 'running'
          AND action = ANY($3::text[])
          AND heartbeat_at < now() - ($4::int * interval '1 millisecond')
        `,
        [config.instance.id, input.embedding_name, RUNNING_LIFECYCLE_ACTIONS, staleAfterMs]
      );

      const existing = await client.query<LifecycleJobRow>(
        `
        SELECT id, instance_id, action, embedding_name, status, started_at, finished_at,
               heartbeat_at, abort_requested_at, counts, failures, error, metadata
        FROM fqc_maintenance_jobs
        WHERE instance_id = $1
          AND embedding_name = $2
          AND status = 'running'
          AND action = ANY($3::text[])
        ORDER BY started_at ASC
        LIMIT 1
        `,
        [config.instance.id, input.embedding_name, RUNNING_LIFECYCLE_ACTIONS]
      );

      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return lifecycleConflict(existing.rows[0]);
      }

      const inserted = await client.query<LifecycleJobRow>(
        `
        INSERT INTO fqc_maintenance_jobs (
          id, instance_id, action, embedding_name, status, started_at, heartbeat_at,
          counts, failures, metadata
        )
        VALUES ($1, $2, $3, $4, 'running', now(), now(), $5::jsonb, $6::jsonb, $7::jsonb)
        RETURNING id, action, embedding_name, started_at
        `,
        [
          jobId,
          config.instance.id,
          input.action,
          input.embedding_name,
          JSON.stringify(input.counts ?? {}),
          JSON.stringify(input.failures ?? []),
          JSON.stringify(input.metadata ?? {}),
        ]
      );
      await client.query('COMMIT');

      const row = inserted.rows[0];
      return {
        ok: true,
        payload: {
          job_id: row.id,
          action: row.action,
          embedding_name: row.embedding_name ?? input.embedding_name,
          started_at: row.started_at,
        },
      };
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((err as { code?: string }).code === '23505') {
        const conflict = await findRunningConflict(config, input.embedding_name);
        if (conflict.ok) return lifecycleConflict(conflict.payload);
      }
      throw err;
    }
  });
}

export async function heartbeatLifecycleJob(
  config: FlashQueryConfig,
  jobId: string,
  counts?: Record<string, unknown>,
  failures?: unknown[]
): Promise<LifecycleJobResult<LifecycleJobStatusPayload>> {
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const result = await withPgClient(databaseUrl.payload, async (client) =>
    client.query<LifecycleJobRow>(
      `
      UPDATE fqc_maintenance_jobs
      SET heartbeat_at = now(),
          counts = COALESCE($2::jsonb, counts),
          failures = COALESCE($3::jsonb, failures)
      WHERE id = $1
      RETURNING id, instance_id, action, embedding_name, status, started_at, finished_at,
                heartbeat_at, abort_requested_at, counts, failures, error, metadata
      `,
      [jobId, counts === undefined ? null : JSON.stringify(counts), failures === undefined ? null : JSON.stringify(failures)]
    )
  );

  const row = result.rows[0];
  if (!row) return jobNotFound(jobId);
  return { ok: true, payload: rowToStatus(row) };
}

export async function completeLifecycleJob(
  config: FlashQueryConfig,
  jobId: string,
  counts: Record<string, unknown>,
  failures: unknown[] = []
): Promise<LifecycleJobResult<LifecycleJobStatusPayload>> {
  return await finishLifecycleJob(config, jobId, 'completed', counts, failures);
}

export async function failLifecycleJob(
  config: FlashQueryConfig,
  jobId: string,
  error: ErrorEnvelope,
  counts: Record<string, unknown> = {},
  failures: unknown[] = []
): Promise<LifecycleJobResult<LifecycleJobStatusPayload>> {
  return await finishLifecycleJob(config, jobId, 'failed', counts, failures, error);
}

export async function requestLifecycleAbort(
  config: FlashQueryConfig,
  jobId: string
): Promise<LifecycleJobResult<LifecycleJobStatusPayload>> {
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  return await withPgClient(databaseUrl.payload, async (client) => {
    const existing = await client.query<LifecycleJobRow>(
      `
      SELECT id, instance_id, action, embedding_name, status, started_at, finished_at,
             heartbeat_at, abort_requested_at, counts, failures, error, metadata
      FROM fqc_maintenance_jobs
      WHERE id = $1
      `,
      [jobId]
    );
    const row = existing.rows[0];
    if (!row) return jobNotFound(jobId);
    if (row.status !== 'running') {
      return {
        ok: false,
        error: {
          error: 'unsupported',
          message: `Lifecycle job '${jobId}' is not running and cannot be aborted`,
          identifier: jobId,
          details: { status: row.status },
        },
      };
    }

    const aborted = await client.query<LifecycleJobRow>(
      `
      UPDATE fqc_maintenance_jobs
      SET status = 'aborted',
          abort_requested_at = COALESCE(abort_requested_at, now()),
          finished_at = now(),
          heartbeat_at = now()
      WHERE id = $1
      RETURNING id, instance_id, action, embedding_name, status, started_at, finished_at,
                heartbeat_at, abort_requested_at, counts, failures, error, metadata
      `,
      [jobId]
    );
    return { ok: true, payload: rowToStatus(aborted.rows[0]) };
  });
}

export async function getLifecycleJobStatus(
  config: FlashQueryConfig,
  jobId: string
): Promise<LifecycleJobResult<LifecycleJobStatusPayload>> {
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const result = await withPgClient(databaseUrl.payload, async (client) =>
    client.query<LifecycleJobRow>(
      `
      SELECT id, instance_id, action, embedding_name, status, started_at, finished_at,
             heartbeat_at, abort_requested_at, counts, failures, error, metadata
      FROM fqc_maintenance_jobs
      WHERE id = $1
      `,
      [jobId]
    )
  );

  const row = result.rows[0];
  if (!row) return jobNotFound(jobId);
  return { ok: true, payload: rowToStatus(row) };
}

export async function isLifecycleAbortRequested(
  config: FlashQueryConfig,
  jobId: string
): Promise<LifecycleJobResult<boolean>> {
  const status = await getLifecycleJobStatus(config, jobId);
  if (!status.ok) return status;
  return {
    ok: true,
    payload: status.payload.abort_requested_at !== undefined || status.payload.status === 'aborted',
  };
}

async function finishLifecycleJob(
  config: FlashQueryConfig,
  jobId: string,
  status: 'completed' | 'failed',
  counts: Record<string, unknown>,
  failures: unknown[],
  error?: ErrorEnvelope
): Promise<LifecycleJobResult<LifecycleJobStatusPayload>> {
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const result = await withPgClient(databaseUrl.payload, async (client) =>
    client.query<LifecycleJobRow>(
      `
      UPDATE fqc_maintenance_jobs
      SET status = $2,
          finished_at = now(),
          heartbeat_at = now(),
          counts = $3::jsonb,
          failures = $4::jsonb,
          error = $5::jsonb
      WHERE id = $1
      RETURNING id, instance_id, action, embedding_name, status, started_at, finished_at,
                heartbeat_at, abort_requested_at, counts, failures, error, metadata
      `,
      [
        jobId,
        status,
        JSON.stringify(counts),
        JSON.stringify(failures),
        error === undefined ? null : JSON.stringify(error),
      ]
    )
  );

  const row = result.rows[0];
  if (!row) return jobNotFound(jobId);
  return { ok: true, payload: rowToStatus(row) };
}

async function findRunningConflict(
  config: FlashQueryConfig,
  embeddingName: string
): Promise<LifecycleJobResult<LifecycleJobRow>> {
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const result = await withPgClient(databaseUrl.payload, async (client) =>
    client.query<LifecycleJobRow>(
      `
      SELECT id, instance_id, action, embedding_name, status, started_at, finished_at,
             heartbeat_at, abort_requested_at, counts, failures, error, metadata
      FROM fqc_maintenance_jobs
      WHERE instance_id = $1
        AND embedding_name = $2
        AND status = 'running'
        AND action = ANY($3::text[])
      ORDER BY started_at ASC
      LIMIT 1
      `,
      [config.instance.id, embeddingName, RUNNING_LIFECYCLE_ACTIONS]
    )
  );
  const row = result.rows[0];
  if (!row) return jobNotFound(embeddingName);
  return { ok: true, payload: row };
}

function rowToStatus(row: LifecycleJobRow): LifecycleJobStatusPayload {
  const action = rowToAction(row);
  return {
    job_id: row.id,
    status: row.status,
    started_at: row.started_at,
    ...(row.finished_at === null ? {} : { finished_at: row.finished_at }),
    heartbeat_at: row.heartbeat_at,
    ...(row.abort_requested_at === null ? {} : { abort_requested_at: row.abort_requested_at }),
    actions: [action],
    ...(row.error === null ? {} : { error: row.error }),
    metadata: row.metadata,
  };
}

function rowToAction(row: LifecycleJobRow): MaintenanceLifecycleActionResult {
  return {
    action: row.action as LifecycleEmbeddingAction,
    started_at: row.started_at,
    finished_at: row.finished_at ?? row.heartbeat_at,
    dry_run: Boolean(row.metadata?.dry_run),
    ...(row.embedding_name === null ? {} : { embedding_name: row.embedding_name }),
    counts: row.counts as MaintenanceLifecycleActionResult['counts'],
    ...(row.failures.length === 0 ? {} : { failures: row.failures }),
  };
}

function lifecycleConflict(row: LifecycleJobRow): LifecycleJobResult<never> {
  return {
    ok: false,
    error: {
      error: 'conflict',
      message: `Lifecycle job '${row.id}' is already running for embedding '${row.embedding_name ?? ''}'`,
      identifier: row.embedding_name ?? row.id,
      details: {
        in_flight_action: row.action,
        in_flight_job_id: row.id,
        started_at: row.started_at,
        elapsed_ms: Math.max(0, Date.now() - Date.parse(row.started_at)),
      },
    },
  };
}

function jobNotFound(jobId: string): LifecycleJobResult<never> {
  return {
    ok: false,
    error: {
      error: 'not_found',
      message: `No lifecycle maintenance job found for job_id '${jobId}'`,
      identifier: jobId,
    },
  };
}

function requireDatabaseUrl(config: FlashQueryConfig): LifecycleJobResult<string> {
  if (config.supabase.databaseUrl === undefined || config.supabase.databaseUrl.length === 0) {
    return {
      ok: false,
      error: {
        error: 'invalid_input',
        message: 'Lifecycle maintenance jobs require supabase.databaseUrl for direct PostgreSQL access',
        identifier: 'supabase.databaseUrl',
        details: { reason: 'direct_postgresql_required' },
      },
    };
  }
  return { ok: true, payload: config.supabase.databaseUrl };
}
