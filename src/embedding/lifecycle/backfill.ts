import type { FlashQueryConfig } from '../../config/loader.js';
import type {
  ErrorEnvelope,
  MaintenanceLifecycleActionResult,
} from '../../mcp/utils/response-formats.js';
import type { BackfillLifecycleCounts, LifecycleBaseInput, LifecycleScope } from './types.js';
import type { LifecycleJobRef } from './jobs.js';
import {
  resolveCoreLifecycleWorkPlan,
  runCoreLifecycle,
  type CoreLifecycleResult,
} from './core-processor.js';
import { acquireLifecycleJob, completeLifecycleJob, failLifecycleJob } from './jobs.js';
import {
  estimateRecordLifecycleRows,
  executeRecordLifecycleWorkUnits,
  type RecordLifecycleExecutionResult,
  type RecordLifecycleResolution,
  reindexRecordTables,
  resolveRecordLifecycleWorkUnits,
  resolveSingleRecordLifecycleEmbeddingName,
} from './records-scope.js';
import { validateMaxRows } from './scope.js';

const RECORDS_ONLY = ['records'];
type RecordExecutionOrError =
  | { ok: true; payload: RecordLifecycleExecutionResult }
  | { ok: false; error: ErrorEnvelope };

export async function runBackfillEmbeddings(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'backfill_embeddings' },
  backgroundJob?: LifecycleJobRef
): Promise<CoreLifecycleResult> {
  if (hasRecordsScope(input.scope) && !isPureRecordsScope(input.scope)) {
    const startedAt = new Date().toISOString();
    const coreInput = { ...input, scope: withoutRecordsScope(input.scope) };
    const corePlan = await resolveCoreLifecycleWorkPlan(config, coreInput, 'backfill_embeddings');
    if (!corePlan.ok) return corePlan;
    const resolved = await resolveRecordLifecycleWorkUnits(config, input, 'backfill_embeddings');
    if (!resolved.ok) return resolved;
    const combinedCap = validateMaxRows(
      'backfill_embeddings',
      corePlan.payload.rows.length + resolved.payload.rows_in_scope,
      input.max_rows
    );
    if (!combinedCap.ok) return { ok: false, error: combinedCap.error };

    const core = await runCoreLifecycle({
      config,
      input: coreInput,
      mode: 'backfill_embeddings',
      ...(backgroundJob === undefined ? {} : { backgroundJob }),
    });
    if (!core.ok) return core;

    if (input.dry_run === true) {
      const coreCounts = asBackfillCounts(core.payload.counts);
      const recordEstimate = estimateRecordLifecycleRows(resolved.payload.work_units);
      return {
        ok: true,
        payload: {
          ...core.payload,
          started_at: core.payload.started_at ?? startedAt,
          finished_at: new Date().toISOString(),
          counts: {
            rows_examined: coreCounts.rows_examined + resolved.payload.rows_in_scope,
            rows_embedded: coreCounts.rows_embedded,
            rows_failed: coreCounts.rows_failed,
            rows_skipped_already_present: coreCounts.rows_skipped_already_present,
            rows_skipped_no_embedding: resolved.payload.rows_skipped_no_embedding,
          },
          would_process: (core.payload.would_process ?? 0) + resolved.payload.rows_in_scope,
          estimated: mergeEstimates(core.payload.estimated, recordEstimate),
          plugin_breakdown: resolved.payload.work_units.map((unit) => ({
            plugin_id: unit.plugin_id,
            plugin_instance: unit.plugin_instance,
            table_name: unit.table_name,
            embedding_name: unit.embedding_name,
            rows_examined: unit.rows.length,
            rows_embedded: 0,
            rows_failed: 0,
            rows_skipped_no_embedding: unit.rows_skipped_no_embedding,
          })),
        },
      };
    }

    const recordsResult = await executeBackfillRecordsWithOptionalJob(config, resolved.payload);
    if (!recordsResult.ok) return { ok: false, error: recordsResult.error };
    const records = recordsResult.payload;
    if (records.affected_tables.size > 0) {
      await reindexRecordTables(config, resolved.payload.work_units, records.affected_tables);
    }
    const coreCounts = asBackfillCounts(core.payload.counts);
    const failures = [...(core.payload.failures ?? []), ...records.failures];
    const warnings = [...new Set([...(core.payload.warnings ?? []), ...records.warnings])];
    return {
      ok: true,
      payload: {
        ...core.payload,
        finished_at: new Date().toISOString(),
        counts: {
          rows_examined: coreCounts.rows_examined + records.rows_examined,
          rows_embedded: coreCounts.rows_embedded + records.rows_embedded,
          rows_failed: coreCounts.rows_failed + records.rows_failed,
          rows_skipped_already_present: coreCounts.rows_skipped_already_present,
          rows_skipped_no_embedding: records.rows_skipped_no_embedding,
        },
        ...(failures.length === 0 ? { failures: undefined } : { failures }),
        ...(warnings.length === 0 ? { warnings: undefined } : { warnings }),
        plugin_breakdown: records.plugin_breakdown,
      },
      aborted: core.aborted || records.aborted,
    };
  }

  if (isPureRecordsScope(input.scope)) {
    const startedAt = new Date().toISOString();
    const resolved = await resolveRecordLifecycleWorkUnits(config, input, 'backfill_embeddings');
    if (!resolved.ok) return resolved;
    const estimate = estimateRecordLifecycleRows(resolved.payload.work_units);
    if (input.dry_run === true) {
      return {
        ok: true,
        payload: {
          action: 'backfill_embeddings',
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          dry_run: true,
          counts: {
            rows_examined: resolved.payload.rows_in_scope,
            rows_embedded: 0,
            rows_failed: 0,
            rows_skipped_already_present: 0,
            rows_skipped_no_embedding: resolved.payload.rows_skipped_no_embedding,
          },
          would_process: resolved.payload.rows_in_scope,
          estimated: estimate,
          plugin_breakdown: resolved.payload.work_units.map((unit) => ({
            plugin_id: unit.plugin_id,
            plugin_instance: unit.plugin_instance,
            table_name: unit.table_name,
            embedding_name: unit.embedding_name,
            rows_examined: unit.rows.length,
            rows_embedded: 0,
            rows_failed: 0,
            rows_skipped_no_embedding: unit.rows_skipped_no_embedding,
          })),
        },
      };
    }

    const recordsResult = await executeBackfillRecordsWithOptionalJob(
      config,
      resolved.payload,
      backgroundJob
    );
    if (!recordsResult.ok) return { ok: false, error: recordsResult.error };
    const records = recordsResult.payload;
    if (records.affected_tables.size > 0) {
      await reindexRecordTables(config, resolved.payload.work_units, records.affected_tables);
    }
    return {
      ok: true,
      payload: {
        action: 'backfill_embeddings',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        dry_run: false,
        counts: {
          rows_examined: records.rows_examined,
          rows_embedded: records.rows_embedded,
          rows_failed: records.rows_failed,
          rows_skipped_already_present: 0,
          rows_skipped_no_embedding: records.rows_skipped_no_embedding,
        },
        ...(records.failures.length === 0 ? {} : { failures: records.failures }),
        ...(records.warnings.length === 0 ? {} : { warnings: records.warnings }),
        plugin_breakdown: records.plugin_breakdown,
      },
      aborted: records.aborted,
    };
  }

  return await runCoreLifecycle({
    config,
    input,
    mode: 'backfill_embeddings',
    ...(backgroundJob === undefined ? {} : { backgroundJob }),
  });
}

export type BackfillEmbeddingsResult = MaintenanceLifecycleActionResult;

async function executeBackfillRecordsWithOptionalJob(
  config: FlashQueryConfig,
  resolution: RecordLifecycleResolution,
  backgroundJob?: LifecycleJobRef
): Promise<RecordExecutionOrError> {
  const jobName = resolveSingleRecordLifecycleEmbeddingName(resolution, 'backfill_embeddings');
  if (!jobName.ok) return jobName;

  if (jobName.payload === null) {
    return {
      ok: true,
      payload: await executeRecordLifecycleWorkUnits({ config, workUnits: resolution.work_units }),
    };
  }

  const initialCounts = {
    rows_examined: resolution.rows_in_scope,
    rows_embedded: 0,
    rows_failed: 0,
    rows_skipped_already_present: 0,
    rows_skipped_no_embedding: resolution.rows_skipped_no_embedding,
  };
  const job =
    backgroundJob ??
    (await acquireLifecycleJob(config, {
      action: 'backfill_embeddings',
      embedding_name: jobName.payload,
      counts: initialCounts,
      metadata: { dry_run: false, scope: 'records' },
    }));
  if (!('job_id' in job) && !job.ok) return job;
  const jobRef = 'job_id' in job ? job : job.payload;

  try {
    const records = await executeRecordLifecycleWorkUnits({
      config,
      workUnits: resolution.work_units,
      job: jobRef,
    });
    if (!records.aborted) {
      await completeLifecycleJob(
        config,
        jobRef.job_id,
        {
          rows_examined: records.rows_examined,
          rows_embedded: records.rows_embedded,
          rows_failed: records.rows_failed,
          rows_skipped_already_present: 0,
          rows_skipped_no_embedding: records.rows_skipped_no_embedding,
        },
        records.failures
      );
    }
    return { ok: true, payload: records };
  } catch (err) {
    await failLifecycleJob(config, jobRef.job_id, {
      error: 'runtime_error',
      message: err instanceof Error ? err.message : String(err),
      identifier: jobName.payload,
    }).catch(() => undefined);
    throw err;
  }
}

function isPureRecordsScope(scope: LifecycleBaseInput['scope']): boolean {
  return JSON.stringify(scope?.entity_types ?? []) === JSON.stringify(RECORDS_ONLY);
}

function hasRecordsScope(scope: LifecycleBaseInput['scope']): boolean {
  return scope?.entity_types?.includes('records') === true;
}

function withoutRecordsScope(scope: LifecycleScope | undefined): LifecycleScope {
  return {
    ...(scope ?? {}),
    entity_types: scope?.entity_types?.filter((entity) => entity !== 'records') ?? [
      'documents',
      'memory',
    ],
  };
}

function asBackfillCounts(
  counts: MaintenanceLifecycleActionResult['counts']
): BackfillLifecycleCounts {
  if ('rows_examined' in counts) {
    return {
      rows_examined: counts.rows_examined,
      rows_embedded: counts.rows_embedded,
      rows_failed: counts.rows_failed,
      rows_skipped_already_present: counts.rows_skipped_already_present ?? 0,
      rows_skipped_no_embedding: counts.rows_skipped_no_embedding,
    };
  }
  return {
    rows_examined: 0,
    rows_embedded: 0,
    rows_failed: 0,
    rows_skipped_already_present: 0,
  };
}

function mergeEstimates(
  left: MaintenanceLifecycleActionResult['estimated'],
  right: MaintenanceLifecycleActionResult['estimated']
): MaintenanceLifecycleActionResult['estimated'] {
  return {
    input_tokens: (left?.input_tokens ?? 0) + (right?.input_tokens ?? 0),
    cost_usd: null,
    wall_time_seconds: (left?.wall_time_seconds ?? 0) + (right?.wall_time_seconds ?? 0),
    cost_basis: left?.cost_basis ?? right?.cost_basis,
  };
}
