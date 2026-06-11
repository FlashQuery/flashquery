import type { FlashQueryConfig } from '../../config/loader.js';
import type { MaintenanceLifecycleActionResult } from '../../mcp/utils/response-formats.js';
import type { LifecycleJobRef } from './jobs.js';
import type { LifecycleBaseInput, LifecycleScope, RebuildLifecycleCounts } from './types.js';
import { runCoreLifecycle, type CoreLifecycleResult } from './core-processor.js';
import {
  estimateRecordLifecycleRows,
  executeRecordLifecycleWorkUnits,
  reindexRecordTables,
  resolveRecordLifecycleWorkUnits,
} from './records-scope.js';
import { resolveRebuildConfirmFromResolvedWorkUnits } from './scope.js';

const RECORDS_ONLY = ['records'];

export async function runRebuildEmbeddings(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'rebuild_embeddings' },
  backgroundJob?: LifecycleJobRef
): Promise<CoreLifecycleResult> {
  if (hasRecordsScope(input.scope)) {
    const startedAt = new Date().toISOString();
    const resolved = await resolveRecordLifecycleWorkUnits(config, input, 'rebuild_embeddings');
    if (!resolved.ok) return resolved;

    if (isPureRecordsScope(input.scope)) {
      const confirm = resolveRebuildConfirmFromResolvedWorkUnits({
        action: 'rebuild_embeddings',
        confirm: input.confirm,
        scope: input.scope,
        resolved_embedding_names: resolved.payload.resolved_embedding_names,
      });
      if (!confirm.ok) return { ok: false, error: confirm.error };

      if (input.dry_run === true) {
        return {
          ok: true,
          payload: {
            action: 'rebuild_embeddings',
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            dry_run: true,
            ...(confirm.payload.expected_confirm === null ? {} : { embedding_name: confirm.payload.expected_confirm }),
            counts: {
              rows_examined: resolved.payload.rows_in_scope,
              rows_embedded: 0,
              rows_failed: 0,
              rows_skipped_no_embedding: resolved.payload.rows_skipped_no_embedding,
            },
            would_process: resolved.payload.rows_in_scope,
            estimated: estimateRecordLifecycleRows(resolved.payload.work_units),
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
          } as MaintenanceLifecycleActionResult,
        };
      }

      const records = await executeRecordLifecycleWorkUnits({ config, workUnits: resolved.payload.work_units });
      if (records.affected_tables.size > 0) {
        await reindexRecordTables(config, resolved.payload.work_units, records.affected_tables);
      }
      return {
        ok: true,
        payload: {
          action: 'rebuild_embeddings',
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          dry_run: false,
          ...(confirm.payload.expected_confirm === null ? {} : { embedding_name: confirm.payload.expected_confirm }),
          counts: {
            rows_examined: records.rows_examined,
            rows_embedded: records.rows_embedded,
            rows_failed: records.rows_failed,
            rows_skipped_no_embedding: records.rows_skipped_no_embedding,
          },
          ...(records.failures.length === 0 ? {} : { failures: records.failures }),
          ...(records.warnings.length === 0 ? {} : { warnings: records.warnings }),
          plugin_breakdown: records.plugin_breakdown,
        } as MaintenanceLifecycleActionResult,
      };
    }

    const coreInput = { ...input, scope: withoutRecordsScope(input.scope) };
    const core = await runCoreLifecycle({
      config,
      input: coreInput,
      mode: 'rebuild_embeddings',
      ...(backgroundJob === undefined ? {} : { backgroundJob }),
    });
    if (!core.ok) return core;
    if (input.dry_run === true) {
      const coreCounts = asRebuildCounts(core.payload.counts);
      return {
        ok: true,
        payload: {
          ...core.payload,
          finished_at: new Date().toISOString(),
          counts: {
            rows_examined: coreCounts.rows_examined + resolved.payload.rows_in_scope,
            rows_embedded: coreCounts.rows_embedded,
            rows_failed: coreCounts.rows_failed,
            rows_skipped_no_embedding: resolved.payload.rows_skipped_no_embedding,
          },
          would_process: (core.payload.would_process ?? 0) + resolved.payload.rows_in_scope,
          estimated: mergeEstimates(core.payload.estimated, estimateRecordLifecycleRows(resolved.payload.work_units)),
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
        } as MaintenanceLifecycleActionResult,
        aborted: core.aborted,
      };
    }

    const records = await executeRecordLifecycleWorkUnits({ config, workUnits: resolved.payload.work_units });
    if (records.affected_tables.size > 0) {
      await reindexRecordTables(config, resolved.payload.work_units, records.affected_tables);
    }
    const coreCounts = asRebuildCounts(core.payload.counts);
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
          rows_skipped_no_embedding: records.rows_skipped_no_embedding,
        },
        ...(failures.length === 0 ? {} : { failures }),
        ...(warnings.length === 0 ? {} : { warnings }),
        plugin_breakdown: records.plugin_breakdown,
      } as MaintenanceLifecycleActionResult,
      aborted: core.aborted,
    };
  }

  return await runCoreLifecycle({
    config,
    input,
    mode: 'rebuild_embeddings',
    ...(backgroundJob === undefined ? {} : { backgroundJob }),
  });
}

export type RebuildEmbeddingsResult = MaintenanceLifecycleActionResult;

function isPureRecordsScope(scope: LifecycleBaseInput['scope']): boolean {
  return JSON.stringify(scope?.entity_types ?? []) === JSON.stringify(RECORDS_ONLY);
}

function hasRecordsScope(scope: LifecycleBaseInput['scope']): boolean {
  return scope?.entity_types?.includes('records') === true;
}

function withoutRecordsScope(scope: LifecycleScope | undefined): LifecycleScope {
  return {
    ...(scope ?? {}),
    entity_types: scope?.entity_types?.filter((entity) => entity !== 'records') ?? ['documents', 'memory'],
  };
}

function asRebuildCounts(counts: MaintenanceLifecycleActionResult['counts']): RebuildLifecycleCounts {
  if ('rows_examined' in counts) {
    return {
      rows_examined: counts.rows_examined,
      rows_embedded: counts.rows_embedded,
      rows_failed: counts.rows_failed,
      rows_skipped_no_embedding: counts.rows_skipped_no_embedding,
    };
  }
  return {
    rows_examined: 0,
    rows_embedded: 0,
    rows_failed: 0,
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
