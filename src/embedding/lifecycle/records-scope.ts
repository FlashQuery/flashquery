import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../../config/loader.js';
import {
  recordEmbeddingTarget,
  updateTargetEmbedding,
  type EmbeddingWriteStamp,
} from '../background-embed.js';
import {
  createEmbeddingProviderForCatalogEntry,
  type EmbeddingCatalogProviderEntry,
  type EmbeddingProvider,
} from '../provider.js';
import type {
  LifecycleBaseInput,
  LifecycleEstimate,
  LifecycleFailure,
  LifecycleScope,
} from './types.js';
import type { ErrorEnvelope } from '../../mcp/utils/response-formats.js';
import { parsePluginSchema, resolveTableName } from '../../plugins/manager.js';
import type { PluginTableSpec } from '../../plugins/manager.js';
import { validateMaxRows } from './scope.js';
import { withPgClient } from '../../utils/pg-client.js';
import { heartbeatLifecycleJob, isLifecycleAbortRequested, type LifecycleJobRef } from './jobs.js';

export type RecordLifecycleKind = 'backfill_embeddings' | 'rebuild_embeddings';

interface RecordLifecycleWorkRow {
  id: string;
  fields: Record<string, unknown>;
}

export interface RecordLifecycleWorkUnit {
  plugin_id: string;
  plugin_instance: string;
  table_name: string;
  full_table_name: string;
  embed_fields: string[];
  embedding_name: string | null;
  embedding_entry: EmbeddingCatalogProviderEntry | null;
  rows: RecordLifecycleWorkRow[];
  rows_skipped_no_embedding: number;
}

export interface RecordLifecycleResolution {
  work_units: RecordLifecycleWorkUnit[];
  rows_in_scope: number;
  rows_skipped_no_embedding: number;
  resolved_embedding_names: string[];
}

export interface RecordLifecycleExecutionResult {
  aborted: boolean;
  rows_examined: number;
  rows_embedded: number;
  rows_failed: number;
  rows_skipped_no_embedding: number;
  failures: LifecycleFailure[];
  warnings: string[];
  affected_tables: Set<string>;
  plugin_breakdown: Array<{
    plugin_id: string;
    plugin_instance: string;
    table_name: string;
    embedding_name: string | null;
    rows_examined: number;
    rows_embedded: number;
    rows_failed: number;
    rows_skipped_no_embedding: number;
  }>;
}

interface RegistryRow {
  plugin_id: string;
  plugin_instance: string;
  schema_yaml: string;
  embedding_name: string | null;
}

interface CatalogRow extends EmbeddingCatalogProviderEntry {
  status: 'active' | 'deactivated';
}

const COST_BASIS = 'unavailable_provider_pricing_metadata';

export async function resolveRecordLifecycleWorkUnits(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: RecordLifecycleKind },
  mode: RecordLifecycleKind
): Promise<{ ok: true; payload: RecordLifecycleResolution } | { ok: false; error: ErrorEnvelope }> {
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const registry = await loadRegistryRows(config);
  const rows = registry.filter((row) => pluginInScope(row, input.scope));
  const workUnits: RecordLifecycleWorkUnit[] = [];
  let skippedNoEmbedding = 0;

  for (const row of rows) {
    const schema = parsePluginSchema(row.schema_yaml);
    const tables = schema.tables.filter((table) => tableInScope(row, table, input.scope));
    for (const table of tables) {
      if (!table.embed_fields || table.embed_fields.length === 0) continue;

      const fullTableName = resolveTableName(row.plugin_id, row.plugin_instance, table.name);
      if (!row.embedding_name) {
        const skipped = await countActiveRows(config, fullTableName);
        skippedNoEmbedding += skipped;
        workUnits.push({
          plugin_id: row.plugin_id,
          plugin_instance: row.plugin_instance,
          table_name: table.name,
          full_table_name: fullTableName,
          embed_fields: table.embed_fields,
          embedding_name: null,
          embedding_entry: null,
          rows: [],
          rows_skipped_no_embedding: skipped,
        });
        continue;
      }

      const entry = await loadActiveCatalogEntry(config, row.embedding_name);
      if (!entry.ok) return entry;
      const selected = await selectRecordRows(
        config,
        fullTableName,
        table.embed_fields,
        entry.payload,
        mode,
        {
          staleOnly: input.stale_only === true,
          mismatchedWidthOnly: input.mismatched_width_only === true,
        }
      );
      workUnits.push({
        plugin_id: row.plugin_id,
        plugin_instance: row.plugin_instance,
        table_name: table.name,
        full_table_name: fullTableName,
        embed_fields: table.embed_fields,
        embedding_name: row.embedding_name,
        embedding_entry: entry.payload,
        rows: selected,
        rows_skipped_no_embedding: 0,
      });
    }
  }

  const rowsInScope = workUnits.reduce((sum, unit) => sum + unit.rows.length, 0);
  const cap = validateMaxRows(mode, rowsInScope, input.max_rows);
  if (!cap.ok) return { ok: false, error: cap.error };

  const resolvedNames = [
    ...new Set(
      workUnits
        .map((unit) => unit.embedding_name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    ),
  ].sort();

  return {
    ok: true,
    payload: {
      work_units: workUnits,
      rows_in_scope: rowsInScope,
      rows_skipped_no_embedding: skippedNoEmbedding,
      resolved_embedding_names: resolvedNames,
    },
  };
}

export async function executeRecordLifecycleWorkUnits(input: {
  config: FlashQueryConfig;
  workUnits: RecordLifecycleWorkUnit[];
  job?: LifecycleJobRef;
  counts?: Record<string, unknown>;
}): Promise<RecordLifecycleExecutionResult> {
  const supabase = createClient(input.config.supabase.url, input.config.supabase.serviceRoleKey);
  const failures: LifecycleFailure[] = [];
  const warnings = new Set<string>();
  const affectedTables = new Set<string>();
  const pluginBreakdown: RecordLifecycleExecutionResult['plugin_breakdown'] = [];
  let rowsEmbedded = 0;
  let rowsFailed = 0;
  let rowsSkippedNoEmbedding = 0;

  for (const unit of input.workUnits) {
    const breakdown = {
      plugin_id: unit.plugin_id,
      plugin_instance: unit.plugin_instance,
      table_name: unit.table_name,
      embedding_name: unit.embedding_name,
      rows_examined: unit.rows.length,
      rows_embedded: 0,
      rows_failed: 0,
      rows_skipped_no_embedding: unit.rows_skipped_no_embedding,
    };
    rowsSkippedNoEmbedding += unit.rows_skipped_no_embedding;

    if (!unit.embedding_entry) {
      pluginBreakdown.push(breakdown);
      continue;
    }

    const provider = createEmbeddingProviderForCatalogEntry(input.config, unit.embedding_entry);
    for (const row of unit.rows) {
      if (input.job) {
        const abort = await isLifecycleAbortRequested(input.config, input.job.job_id);
        if (!abort.ok) {
          failures.push({
            entity_type: 'records',
            identifier: `${unit.plugin_id}.${unit.table_name}:${row.id}`,
            message: abort.error.message,
            error: abort.error.message,
          });
          rowsFailed += 1;
          breakdown.rows_failed += 1;
          continue;
        }
        if (abort.payload) {
          pluginBreakdown.push(breakdown);
          return {
            aborted: true,
            rows_examined: input.workUnits.reduce((sum, workUnit) => sum + workUnit.rows.length, 0),
            rows_embedded: rowsEmbedded,
            rows_failed: rowsFailed,
            rows_skipped_no_embedding: rowsSkippedNoEmbedding,
            failures,
            warnings: [...warnings],
            affected_tables: affectedTables,
            plugin_breakdown: pluginBreakdown,
          };
        }
      }

      try {
        const embedText = buildRecordEmbedText(row.fields, unit.embed_fields);
        if (!embedText.trim()) {
          breakdown.rows_skipped_no_embedding += 1;
          rowsSkippedNoEmbedding += 1;
          continue;
        }
        const vector = await provider.embed(embedText);
        collectProviderWarnings(provider, warnings);
        const providerInfo = provider.getProviderInfo?.();
        const metadata = provider.getLastEmbeddingMetadata?.();
        await updateTargetEmbedding(
          recordEmbeddingTarget({
            instanceId: input.config.instance.id,
            targetTable: unit.full_table_name,
            id: row.id,
            label: unit.full_table_name,
          }),
          vector,
          supabase,
          input.config.supabase.databaseUrl,
          {
            embeddingName: unit.embedding_entry.name,
            model: providerInfo?.model ?? 'unknown',
            provider: providerInfo?.provider ?? 'unknown',
            truncated: metadata?.truncated ?? false,
          } satisfies EmbeddingWriteStamp
        );
        rowsEmbedded += 1;
        breakdown.rows_embedded += 1;
        affectedTables.add(unit.full_table_name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({
          entity_type: 'records',
          identifier: `${unit.plugin_id}.${unit.table_name}:${row.id}`,
          message,
          error: message,
        });
        rowsFailed += 1;
        breakdown.rows_failed += 1;
      }

      if (input.job) {
        const heartbeat = await heartbeatLifecycleJob(
          input.config,
          input.job.job_id,
          input.counts ?? {
            rows_examined: input.workUnits.reduce((sum, workUnit) => sum + workUnit.rows.length, 0),
            rows_embedded: rowsEmbedded,
            rows_failed: rowsFailed,
            rows_skipped_no_embedding: rowsSkippedNoEmbedding,
          },
          failures
        );
        if (!heartbeat.ok) {
          failures.push({
            entity_type: 'records',
            identifier: `${unit.plugin_id}.${unit.table_name}:${row.id}`,
            message: heartbeat.error.message,
            error: heartbeat.error.message,
          });
        }
      }
    }
    pluginBreakdown.push(breakdown);
  }

  return {
    aborted: false,
    rows_examined: input.workUnits.reduce((sum, unit) => sum + unit.rows.length, 0),
    rows_embedded: rowsEmbedded,
    rows_failed: rowsFailed,
    rows_skipped_no_embedding: rowsSkippedNoEmbedding,
    failures,
    warnings: [...warnings],
    affected_tables: affectedTables,
    plugin_breakdown: pluginBreakdown,
  };
}

export function estimateRecordLifecycleRows(
  workUnits: RecordLifecycleWorkUnit[]
): LifecycleEstimate {
  const totalChars = workUnits.reduce((sum, unit) => {
    return (
      sum +
      unit.rows.reduce(
        (rowSum, row) => rowSum + buildRecordEmbedText(row.fields, unit.embed_fields).length,
        0
      )
    );
  }, 0);
  const maxDelayMs = workUnits.reduce((max, unit) => {
    const entryMax =
      unit.embedding_entry?.endpoints.reduce((entryDelay, endpoint) => {
        return Math.max(
          entryDelay,
          endpoint.rate_limit?.min_delay_ms ?? endpoint.rateLimit?.minDelayMs ?? 0
        );
      }, 0) ?? 0;
    return Math.max(max, entryMax);
  }, 0);
  return {
    input_tokens: Math.ceil(totalChars / 4),
    cost_usd: null,
    wall_time_seconds: Math.ceil(
      (workUnits.reduce((sum, unit) => sum + unit.rows.length, 0) * maxDelayMs) / 1000
    ),
    cost_basis: COST_BASIS,
  };
}

export function resolveSingleRecordLifecycleEmbeddingName(
  resolution: RecordLifecycleResolution,
  action: RecordLifecycleKind
): { ok: true; payload: string | null } | { ok: false; error: ErrorEnvelope } {
  if (resolution.resolved_embedding_names.length <= 1) {
    return { ok: true, payload: resolution.resolved_embedding_names[0] ?? null };
  }

  return {
    ok: false,
    error: {
      error: 'ambiguous_identifier',
      message: `records ${action} spans multiple embedding entries; narrow scope.records.plugin or scope.records.targets so one embedding entry is processed per lifecycle job`,
      identifier: 'embedding_name',
      details: {
        active_embeddings: resolution.resolved_embedding_names,
      },
    },
  };
}

export async function reindexRecordTables(
  config: FlashQueryConfig,
  units: RecordLifecycleWorkUnit[],
  affectedTables: Set<string>
): Promise<void> {
  const byTable = new Map(units.map((unit) => [unit.full_table_name, unit.embedding_name]));
  await withPgClient(config.supabase.databaseUrl, async (client) => {
    for (const table of affectedTables) {
      const embeddingName = byTable.get(table);
      if (!embeddingName) continue;
      await client.query(
        `REINDEX INDEX ${pg.escapeIdentifier(`idx_${table}_embedding_${embeddingName}`)}`
      );
    }
  });
}

function buildRecordEmbedText(fields: Record<string, unknown>, embedFields: string[]): string {
  return embedFields
    .map((field) => {
      const value = fields[field];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
      }
      return JSON.stringify(value);
    })
    .join('\n');
}

async function loadRegistryRows(config: FlashQueryConfig): Promise<RegistryRow[]> {
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<RegistryRow>(
      `
      SELECT plugin_id, plugin_instance, schema_yaml, embedding_name
      FROM fqc_plugin_registry
      WHERE instance_id = $1 AND status = 'active'
      ORDER BY plugin_id ASC, plugin_instance ASC
      `,
      [config.instance.id]
    )
  );
  return result.rows;
}

async function loadActiveCatalogEntry(
  config: FlashQueryConfig,
  embeddingName: string
): Promise<{ ok: true; payload: CatalogRow } | { ok: false; error: ErrorEnvelope }> {
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<CatalogRow>(
      `
      SELECT name, dimensions, endpoints, status
      FROM fqc_embeddings
      WHERE instance_id = $1 AND name = $2
      LIMIT 1
      `,
      [config.instance.id, embeddingName]
    )
  );
  const row = result.rows[0];
  if (!row) {
    return {
      ok: false,
      error: {
        error: 'not_found',
        message: `Embedding catalog entry '${embeddingName}' was not found`,
        identifier: embeddingName,
      },
    };
  }
  if (row.status !== 'active') {
    return {
      ok: false,
      error: {
        error: 'unsupported',
        message: `Embedding catalog entry '${embeddingName}' is deactivated`,
        identifier: embeddingName,
        details: { status: row.status },
      },
    };
  }
  return {
    ok: true,
    payload: {
      name: row.name,
      dimensions: row.dimensions,
      endpoints: Array.isArray(row.endpoints) ? row.endpoints : [],
      status: row.status,
    },
  };
}

async function selectRecordRows(
  config: FlashQueryConfig,
  tableName: string,
  embedFields: string[],
  entry: EmbeddingCatalogProviderEntry,
  mode: RecordLifecycleKind,
  filters: { staleOnly: boolean; mismatchedWidthOnly: boolean }
): Promise<RecordLifecycleWorkRow[]> {
  const baseColumn = `embedding_${entry.name}`;
  const predicates = [`instance_id = $1`, `status = 'active'`];
  const values: unknown[] = [config.instance.id];
  if (mode === 'backfill_embeddings') {
    predicates.push(`${pg.escapeIdentifier(baseColumn)} IS NULL`);
  } else {
    if (filters.staleOnly) {
      const models = [
        ...new Set(entry.endpoints.map((endpoint) => endpoint.model).filter(Boolean)),
      ];
      if (models.length === 0) {
        predicates.push(`${pg.escapeIdentifier(`${baseColumn}_model`)} IS NULL`);
      } else {
        values.push(models);
        predicates.push(
          `(${pg.escapeIdentifier(`${baseColumn}_model`)} IS NULL OR ${pg.escapeIdentifier(`${baseColumn}_model`)} <> ALL($${values.length}::text[]))`
        );
      }
    }
    if (filters.mismatchedWidthOnly) {
      values.push(entry.dimensions);
      predicates.push(
        `(${pg.escapeIdentifier(`${baseColumn}_dimensions`)} IS NULL OR ${pg.escapeIdentifier(`${baseColumn}_dimensions`)} <> $${values.length})`
      );
    }
  }

  const selectedColumns = ['id', ...embedFields]
    .map((field) => pg.escapeIdentifier(field))
    .join(', ');
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<Record<string, unknown>>(
      `
      SELECT ${selectedColumns}
      FROM ${pg.escapeIdentifier(tableName)}
      WHERE ${predicates.join(' AND ')}
      ORDER BY updated_at ASC, id ASC
      `,
      values
    )
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    fields: row,
  }));
}

async function countActiveRows(config: FlashQueryConfig, tableName: string): Promise<number> {
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<{ count: string }>(
      `
      SELECT count(*)::text AS count
      FROM ${pg.escapeIdentifier(tableName)}
      WHERE instance_id = $1 AND status = 'active'
      `,
      [config.instance.id]
    )
  );
  return Number(result.rows[0]?.count ?? 0);
}

function pluginInScope(row: RegistryRow, scope: LifecycleScope | undefined): boolean {
  const plugin = scope?.records?.plugin;
  if (plugin === undefined) return true;
  const requested = Array.isArray(plugin) ? plugin : [plugin];
  return requested.some(
    (item) =>
      item === row.plugin_id ||
      item === `${row.plugin_id}:${row.plugin_instance}` ||
      item === `${row.plugin_id}.${row.plugin_instance}`
  );
}

function tableInScope(
  row: RegistryRow,
  table: PluginTableSpec,
  scope: LifecycleScope | undefined
): boolean {
  const targets = scope?.records?.targets;
  if (!targets || targets.length === 0) return true;
  const fullTableName = resolveTableName(row.plugin_id, row.plugin_instance, table.name);
  return targets.some(
    (target) =>
      target === table.name ||
      target === fullTableName ||
      target === `${row.plugin_id}.${table.name}` ||
      target === `${row.plugin_id}.${row.plugin_instance}.${table.name}`
  );
}

function collectProviderWarnings(provider: EmbeddingProvider, warnings: Set<string>): void {
  for (const warning of provider.getLastEmbeddingMetadata?.().warnings ?? []) {
    if (warning === 'truncated_inputs' || warning === 'rate_limit_events') {
      warnings.add(warning);
    }
  }
}

function requireDatabaseUrl(
  config: FlashQueryConfig
): { ok: true; payload: string } | { ok: false; error: ErrorEnvelope } {
  if (!config.supabase.databaseUrl) {
    return {
      ok: false,
      error: {
        error: 'invalid_input',
        message:
          'Embedding lifecycle actions require supabase.databaseUrl for direct PostgreSQL access',
        identifier: 'supabase.databaseUrl',
        details: { reason: 'direct_postgresql_required' },
      },
    };
  }
  return { ok: true, payload: config.supabase.databaseUrl };
}
