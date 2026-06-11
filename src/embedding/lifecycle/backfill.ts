import type { FlashQueryConfig } from '../../config/loader.js';
import type { MaintenanceLifecycleActionResult } from '../../mcp/utils/response-formats.js';
import type { LifecycleBaseInput } from './types.js';
import type { LifecycleJobRef } from './jobs.js';
import { runCoreLifecycle, type CoreLifecycleResult } from './core-processor.js';
import {
  estimateRecordLifecycleRows,
  executeRecordLifecycleWorkUnits,
  reindexRecordTables,
  resolveRecordLifecycleWorkUnits,
} from './records-scope.js';

const RECORDS_ONLY = ['records'];

export async function runBackfillEmbeddings(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: 'backfill_embeddings' },
  backgroundJob?: LifecycleJobRef
): Promise<CoreLifecycleResult> {
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
      } as MaintenanceLifecycleActionResult,
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

function isPureRecordsScope(scope: LifecycleBaseInput['scope']): boolean {
  return JSON.stringify(scope?.entity_types ?? []) === JSON.stringify(RECORDS_ONLY);
}
