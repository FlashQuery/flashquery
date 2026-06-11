import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../../config/loader.js';
import {
  documentEmbeddingTarget,
  memoryEmbeddingTarget,
  updateTargetEmbedding,
  type EmbeddingWriteStamp,
} from '../background-embed.js';
import {
  createEmbeddingProviderForCatalogEntry,
  type EmbeddingCatalogEndpoint,
  type EmbeddingCatalogProviderEntry,
  type EmbeddingProvider,
} from '../provider.js';
import type {
  BackfillLifecycleCounts,
  LifecycleBaseInput,
  LifecycleEstimate,
  LifecycleFailure,
  LifecycleScope,
  RebuildLifecycleCounts,
} from './types.js';
import { validateEmbeddingSqlName } from '../../storage/supabase.js';
import { withPgClient } from '../../utils/pg-client.js';
import type {
  ErrorEnvelope,
  MaintenanceLifecycleActionResult,
} from '../../mcp/utils/response-formats.js';
import {
  acquireLifecycleJob,
  completeLifecycleJob,
  failLifecycleJob,
  heartbeatLifecycleJob,
  isLifecycleAbortRequested,
  type LifecycleJobRef,
} from './jobs.js';
import { validateMaxRows } from './scope.js';

export type CoreLifecycleKind = 'backfill_embeddings' | 'rebuild_embeddings';

export interface CoreLifecycleOptions {
  config: FlashQueryConfig;
  input: LifecycleBaseInput & { action: CoreLifecycleKind };
  mode: CoreLifecycleKind;
  backgroundJob?: LifecycleJobRef;
}

export type CoreLifecycleResult =
  | { ok: true; payload: MaintenanceLifecycleActionResult; aborted?: boolean }
  | { ok: false; error: ErrorEnvelope };

export type CoreLifecycleJobPrepareResult =
  | { ok: true; payload: LifecycleJobRef }
  | { ok: false; error: ErrorEnvelope };

export interface CoreLifecycleWorkPlan {
  embeddingName: string;
  catalog: CatalogRow;
  rows: CoreWorkRow[];
  skippedAlreadyPresent: number;
}

interface CatalogRow extends EmbeddingCatalogProviderEntry {
  status: 'active' | 'deactivated';
}

interface CoreWorkRow {
  entity_type: 'documents' | 'memory';
  id: string;
  label: string;
  title?: string;
  path?: string;
  content?: string;
  model?: string | null;
  dimensions?: number | null;
  has_embedding: boolean;
}

type LifecycleCounts = BackfillLifecycleCounts | RebuildLifecycleCounts;

const COST_BASIS = 'unavailable_provider_pricing_metadata';

export async function prepareCoreLifecycleJob(
  options: CoreLifecycleOptions
): Promise<CoreLifecycleJobPrepareResult> {
  const { config, input, mode } = options;
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const plan = await resolveCoreLifecycleWorkPlan(config, input, mode);
  if (!plan.ok) return plan;
  const cap = validateMaxRows(mode, plan.payload.rows.length, input.max_rows);
  if (!cap.ok) return { ok: false, error: cap.error };

  return await acquireLifecycleJob(config, {
    action: mode,
    embedding_name: plan.payload.embeddingName,
    counts: countsRecord(
      initialCounts(mode, plan.payload.rows.length, plan.payload.skippedAlreadyPresent)
    ),
    metadata: { dry_run: false, background: true },
  });
}

export async function runCoreLifecycle(
  options: CoreLifecycleOptions
): Promise<CoreLifecycleResult> {
  const { config, input, mode } = options;
  const startedAt = new Date().toISOString();
  const databaseUrl = requireDatabaseUrl(config);
  if (!databaseUrl.ok) return databaseUrl;

  const plan = await resolveCoreLifecycleWorkPlan(config, input, mode);
  if (!plan.ok) return plan;
  const { embeddingName, catalog, rows, skippedAlreadyPresent } = plan.payload;
  const cap = validateMaxRows(mode, rows.length, input.max_rows);
  if (!cap.ok) return { ok: false, error: cap.error };

  const estimate = estimateRows(rows, catalog);
  if (input.dry_run === true) {
    return {
      ok: true,
      payload: {
        action: mode,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        dry_run: true,
        embedding_name: embeddingName,
        counts: initialCounts(mode, rows.length, skippedAlreadyPresent),
        would_process: rows.length,
        estimated: estimate,
      },
    };
  }

  const acquired =
    options.backgroundJob ??
    (await acquireLifecycleJob(config, {
      action: mode,
      embedding_name: embeddingName,
      counts: countsRecord(initialCounts(mode, rows.length, skippedAlreadyPresent)),
      metadata: { dry_run: false },
    }));
  if (!('job_id' in acquired)) {
    if (!acquired.ok) return acquired;
  }
  const job = 'job_id' in acquired ? acquired : acquired.payload;
  const provider = createEmbeddingProviderForCatalogEntry(config, catalog);
  const counts = initialCounts(mode, rows.length, skippedAlreadyPresent);
  const failures: LifecycleFailure[] = [];
  const warnings = new Set<string>();
  const affectedTables = new Set<string>();

  try {
    for (const row of rows) {
      const abort = await isLifecycleAbortRequested(config, job.job_id);
      if (!abort.ok) return abort;
      if (abort.payload) {
        await heartbeatLifecycleJob(config, job.job_id, countsRecord(counts), failures);
        return {
          ok: true,
          aborted: true,
          payload: {
            action: mode,
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            dry_run: false,
            embedding_name: embeddingName,
            counts,
            ...(failures.length === 0 ? {} : { failures }),
            ...(warnings.size === 0 ? {} : { warnings: [...warnings] }),
          },
        };
      }

      try {
        const embedText = await buildEmbedText(config, row);
        const vector = await provider.embed(embedText);
        collectProviderWarnings(provider, warnings);
        const providerInfo = provider.getProviderInfo?.();
        const metadata = provider.getLastEmbeddingMetadata?.();
        await updateTargetEmbedding(
          targetForRow(config, row),
          vector,
          createClient(config.supabase.url, config.supabase.serviceRoleKey),
          config.supabase.databaseUrl,
          {
            embeddingName,
            model: providerInfo?.model ?? 'unknown',
            provider: providerInfo?.provider ?? 'unknown',
            truncated: metadata?.truncated ?? false,
          } satisfies EmbeddingWriteStamp
        );
        counts.rows_embedded += 1;
        affectedTables.add(tableForEntity(row.entity_type));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({
          entity_type: row.entity_type,
          identifier: row.label,
          message,
          error: message,
        });
        counts.rows_failed += 1;
      }

      await heartbeatLifecycleJob(config, job.job_id, countsRecord(counts), failures);
    }

    if (affectedTables.size > 0) {
      await reindexAffectedTables(config, embeddingName, affectedTables);
    }

    await completeLifecycleJob(config, job.job_id, countsRecord(counts), failures);
    return {
      ok: true,
      payload: {
        action: mode,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        dry_run: false,
        embedding_name: embeddingName,
        counts,
        ...(failures.length === 0 ? {} : { failures }),
        ...(warnings.size === 0 ? {} : { warnings: [...warnings] }),
      },
    };
  } catch (err) {
    const error: ErrorEnvelope = {
      error: 'runtime_error',
      message: err instanceof Error ? err.message : String(err),
      identifier: embeddingName,
    };
    await failLifecycleJob(config, job.job_id, error, countsRecord(counts), failures).catch(
      () => undefined
    );
    return { ok: false, error };
  }
}

export async function resolveCoreLifecycleWorkPlan(
  config: FlashQueryConfig,
  input: LifecycleBaseInput & { action: CoreLifecycleKind },
  mode: CoreLifecycleKind
): Promise<{ ok: true; payload: CoreLifecycleWorkPlan } | { ok: false; error: ErrorEnvelope }> {
  const embeddingName = await resolveCoreEmbeddingName(config, input.embedding_name);
  if (!embeddingName.ok) return embeddingName;

  if (mode === 'rebuild_embeddings' && input.confirm !== embeddingName.payload) {
    return invalidInput('confirm must match embedding_name for rebuild_embeddings', 'confirm', {
      expected_confirm: embeddingName.payload,
      received_confirm: input.confirm,
    });
  }

  try {
    validateEmbeddingSqlName(embeddingName.payload);
  } catch (err) {
    return invalidInput(err instanceof Error ? err.message : String(err), 'embedding_name', {
      embedding_name: embeddingName.payload,
    });
  }

  const catalog = await loadCatalogEntry(config, embeddingName.payload);
  if (!catalog.ok) return catalog;
  if (catalog.payload.status !== 'active') {
    return unsupported(
      `Embedding catalog entry '${embeddingName.payload}' is deactivated`,
      embeddingName.payload,
      {
        status: catalog.payload.status,
      }
    );
  }

  const rows = await selectRows(config, input.scope, catalog.payload, mode, {
    staleOnly: input.stale_only === true,
    mismatchedWidthOnly: input.mismatched_width_only === true,
  });
  const skippedAlreadyPresent =
    mode === 'backfill_embeddings'
      ? await countAlreadyPresent(config, input.scope, embeddingName.payload)
      : 0;

  return {
    ok: true,
    payload: {
      embeddingName: embeddingName.payload,
      catalog: catalog.payload,
      rows,
      skippedAlreadyPresent,
    },
  };
}

async function resolveCoreEmbeddingName(
  config: FlashQueryConfig,
  requested: string | undefined
): Promise<{ ok: true; payload: string } | { ok: false; error: ErrorEnvelope }> {
  if (requested !== undefined && requested.length > 0) {
    return { ok: true, payload: requested };
  }

  const active = await loadActiveCatalogEntries(config);
  if (!active.ok) return active;
  if (active.payload.length === 1) {
    const [entry] = active.payload;
    return { ok: true, payload: entry.name };
  }

  return {
    ok: false,
    error: {
      error: active.payload.length === 0 ? 'invalid_input' : 'ambiguous_identifier',
      message:
        active.payload.length === 0
          ? 'No active embedding catalog entries are available for core lifecycle actions'
          : 'embedding_name is required when multiple active embedding catalog entries exist',
      identifier: 'embedding_name',
      details: {
        active_embeddings: active.payload.map((entry) => entry.name),
      },
    },
  };
}

async function loadActiveCatalogEntries(
  config: FlashQueryConfig
): Promise<{ ok: true; payload: CatalogRow[] } | { ok: false; error: ErrorEnvelope }> {
  const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
    client.query<CatalogRow>(
      `
      SELECT name, dimensions, endpoints, status
      FROM fqc_embeddings
      WHERE instance_id = $1 AND status = 'active'
      ORDER BY name ASC
      `,
      [config.instance.id]
    )
  );
  return {
    ok: true,
    payload: result.rows.map((row) => ({
      name: row.name,
      dimensions: row.dimensions,
      endpoints: Array.isArray(row.endpoints) ? row.endpoints : [],
      status: row.status,
    })),
  };
}

async function loadCatalogEntry(
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

async function selectRows(
  config: FlashQueryConfig,
  scope: LifecycleScope | undefined,
  entry: CatalogRow,
  mode: CoreLifecycleKind,
  filters: { staleOnly: boolean; mismatchedWidthOnly: boolean }
): Promise<CoreWorkRow[]> {
  const entities = coreEntityTypes(scope);
  const rows: CoreWorkRow[] = [];
  for (const entity of entities) {
    const table = tableForEntity(entity);
    const baseColumn = `embedding_${entry.name}`;
    const predicates = [`instance_id = $1`, `status = 'active'`];
    const values: unknown[] = [config.instance.id];
    if (entity === 'memory') {
      predicates.push(`is_latest = true`);
    }
    if (scope?.path_prefix && entity === 'documents') {
      values.push(`${scope.path_prefix}%`);
      predicates.push(`path LIKE $${values.length}`);
    }
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

    const selected = await withPgClient(config.supabase.databaseUrl, async (client) =>
      client.query<Record<string, unknown>>(
        `
        SELECT id, ${entity === 'documents' ? 'path, title,' : 'content,'}
               ${pg.escapeIdentifier(baseColumn)} IS NOT NULL AS has_embedding,
               ${pg.escapeIdentifier(`${baseColumn}_model`)} AS model,
               ${pg.escapeIdentifier(`${baseColumn}_dimensions`)} AS dimensions
        FROM ${pg.escapeIdentifier(table)}
        WHERE ${predicates.join(' AND ')}
        ORDER BY updated_at ASC, id ASC
        `,
        values
      )
    );
    for (const row of selected.rows) {
      const id = String(row.id);
      rows.push({
        entity_type: entity,
        id,
        label: entity === 'documents' && typeof row.path === 'string' ? row.path : id,
        title: typeof row.title === 'string' ? row.title : undefined,
        path: typeof row.path === 'string' ? row.path : undefined,
        content: typeof row.content === 'string' ? row.content : undefined,
        model: typeof row.model === 'string' ? row.model : null,
        dimensions: typeof row.dimensions === 'number' ? row.dimensions : null,
        has_embedding: row.has_embedding === true,
      });
    }
  }
  return rows;
}

async function countAlreadyPresent(
  config: FlashQueryConfig,
  scope: LifecycleScope | undefined,
  embeddingName: string
): Promise<number> {
  let total = 0;
  for (const entity of coreEntityTypes(scope)) {
    const table = tableForEntity(entity);
    const predicates = [
      `instance_id = $1`,
      `status = 'active'`,
      `${pg.escapeIdentifier(`embedding_${embeddingName}`)} IS NOT NULL`,
    ];
    const values: unknown[] = [config.instance.id];
    if (entity === 'memory') predicates.push(`is_latest = true`);
    if (scope?.path_prefix && entity === 'documents') {
      values.push(`${scope.path_prefix}%`);
      predicates.push(`path LIKE $${values.length}`);
    }
    const result = await withPgClient(config.supabase.databaseUrl, async (client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${pg.escapeIdentifier(table)} WHERE ${predicates.join(' AND ')}`,
        values
      )
    );
    total += Number(result.rows[0]?.count ?? 0);
  }
  return total;
}

function coreEntityTypes(scope: LifecycleScope | undefined): Array<'documents' | 'memory'> {
  const requested = scope?.entity_types?.filter(
    (entity): entity is 'documents' | 'memory' => entity === 'documents' || entity === 'memory'
  );
  return requested && requested.length > 0 ? [...new Set(requested)] : ['documents', 'memory'];
}

function initialCounts(
  mode: CoreLifecycleKind,
  rowsExamined: number,
  skippedAlreadyPresent: number
): LifecycleCounts {
  if (mode === 'backfill_embeddings') {
    return {
      rows_examined: rowsExamined,
      rows_embedded: 0,
      rows_failed: 0,
      rows_skipped_already_present: skippedAlreadyPresent,
    };
  }
  return {
    rows_examined: rowsExamined,
    rows_embedded: 0,
    rows_failed: 0,
  };
}

function countsRecord(counts: LifecycleCounts): Record<string, unknown> {
  return { ...counts };
}

async function buildEmbedText(config: FlashQueryConfig, row: CoreWorkRow): Promise<string> {
  if (row.entity_type === 'memory') {
    return row.content ?? row.label;
  }
  const title = row.title ?? row.path ?? row.label;
  if (!row.path) return title;
  try {
    const raw = await readFile(join(config.instance.vault.path, row.path), 'utf-8');
    const parsed = matter(raw);
    return `${title}\n\n${parsed.content}`;
  } catch {
    return title;
  }
}

function estimateRows(rows: CoreWorkRow[], entry: CatalogRow): LifecycleEstimate {
  const totalChars = rows.reduce((sum, row) => {
    const approx =
      row.entity_type === 'documents'
        ? `${row.title ?? ''}\n\n${row.path ?? ''}`.length
        : (row.content ?? '').length;
    return sum + approx;
  }, 0);
  const maxDelayMs = entry.endpoints.reduce(
    (max, endpoint) => Math.max(max, endpointMinDelayMs(endpoint)),
    0
  );
  return {
    input_tokens: Math.ceil(totalChars / 4),
    cost_usd: null,
    wall_time_seconds: Math.ceil((rows.length * maxDelayMs) / 1000),
    cost_basis: COST_BASIS,
  };
}

function endpointMinDelayMs(endpoint: EmbeddingCatalogEndpoint): number {
  return endpoint.rate_limit?.min_delay_ms ?? endpoint.rateLimit?.minDelayMs ?? 0;
}

function collectProviderWarnings(provider: EmbeddingProvider, warnings: Set<string>): void {
  for (const warning of provider.getLastEmbeddingMetadata?.().warnings ?? []) {
    if (warning === 'truncated_inputs' || warning === 'rate_limit_events') {
      warnings.add(warning);
    }
  }
}

function targetForRow(config: FlashQueryConfig, row: CoreWorkRow) {
  if (row.entity_type === 'documents') {
    return documentEmbeddingTarget({
      instanceId: config.instance.id,
      id: row.id,
      label: row.label,
    });
  }
  return memoryEmbeddingTarget({ instanceId: config.instance.id, id: row.id, label: row.label });
}

function tableForEntity(entity: 'documents' | 'memory'): 'fqc_documents' | 'fqc_memory' {
  return entity === 'documents' ? 'fqc_documents' : 'fqc_memory';
}

async function reindexAffectedTables(
  config: FlashQueryConfig,
  embeddingName: string,
  tables: Set<string>
): Promise<void> {
  await withPgClient(config.supabase.databaseUrl, async (client) => {
    for (const table of tables) {
      await client.query(
        `REINDEX INDEX ${pg.escapeIdentifier(`idx_${table}_embedding_${embeddingName}`)}`
      );
    }
  });
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

function invalidInput(
  message: string,
  identifier: string,
  details: Record<string, unknown>
): { ok: false; error: ErrorEnvelope } {
  return { ok: false, error: { error: 'invalid_input', message, identifier, details } };
}

function unsupported(
  message: string,
  identifier: string,
  details: Record<string, unknown>
): { ok: false; error: ErrorEnvelope } {
  return { ok: false, error: { error: 'unsupported', message, identifier, details } };
}
