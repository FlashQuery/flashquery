import pg from 'pg';
import {
  createEmbeddingProviderForCatalogEntry,
  type EmbeddingCatalogProviderEntry,
  type EmbeddingProvider,
} from './provider.js';
import type { FlashQueryConfig } from '../config/types.js';
import { logger as defaultLogger } from '../logging/logger.js';
import { queryPgPool } from '../utils/pg-client.js';

export const EMBEDDING_DEFERRED_WARNING = 'embedding_deferred' as const;

export type EmbeddingWarning = typeof EMBEDDING_DEFERRED_WARNING | `embedding_deferred:${string}`;
export type BackgroundEmbeddingTargetKind = 'document' | 'memory' | 'record';

export interface BackgroundEmbeddingTarget {
  kind: BackgroundEmbeddingTargetKind;
  instanceId: string;
  targetTable: string;
  targetId: string;
  targetLabel?: string;
}

export interface ScheduleBackgroundEmbeddingOptions {
  target: BackgroundEmbeddingTarget;
  embedText: string;
  provider: EmbeddingProvider;
  supabase: SupabaseLike;
  logger?: StructuredLogger;
  databaseUrl?: string;
  embeddingName?: string;
  truncated?: boolean;
}

export interface ScheduleBackgroundEmbeddingResult {
  warnings: EmbeddingWarning[];
}

export interface ActiveEmbeddingEntry extends EmbeddingCatalogProviderEntry {
  status: 'active';
}

export interface ScheduleActiveCatalogEmbeddingsOptions {
  config: FlashQueryConfig;
  target: BackgroundEmbeddingTarget;
  embedText: string;
  supabase: SupabaseLike;
  logger?: StructuredLogger;
  databaseUrl?: string;
  providerFactory?: (entry: ActiveEmbeddingEntry) => EmbeddingProvider;
  legacyProvider?: EmbeddingProvider;
}

export interface EmbeddingWriteStamp {
  embeddingName: string;
  model: string;
  provider: string;
  truncated?: boolean;
}

interface StructuredLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

interface QueryResult<Row = Record<string, unknown>> {
  data?: Row[] | Row | null;
  error?: { message: string } | null;
}

interface QueryBuilder<Row = Record<string, unknown>> extends PromiseLike<QueryResult<Row>> {
  eq(column: string, value: unknown): QueryBuilder<Row>;
}

interface TableQuery {
  update(payload: Record<string, unknown>): QueryBuilder;
  upsert(payload: Record<string, unknown>, options?: Record<string, unknown>): PromiseLike<QueryResult>;
  select<Row = { attempt_count?: number }>(columns: string): QueryBuilder<Row>;
  delete(): QueryBuilder;
}

interface SupabaseLike {
  from(table: string): unknown;
}

interface ActiveEmbeddingEntryRow {
  name: string;
  dimensions: number;
  endpoints: unknown;
  status: 'active';
}

const TARGET_TABLES = {
  document: 'fqc_documents',
  memory: 'fqc_memory',
} as const;

async function selectActiveEmbeddingEntries(
  supabase: SupabaseLike,
  config: FlashQueryConfig
): Promise<ActiveEmbeddingEntry[]> {
  const { data, error } = await (supabase.from('fqc_embeddings') as TableQuery)
    .select<ActiveEmbeddingEntryRow>('name, dimensions, endpoints, status')
    .eq('instance_id', config.instance.id)
    .eq('status', 'active');

  if (error) {
    throw new Error(`Embedding catalog query failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const order = new Map((config.embeddings ?? []).map((entry, index) => [entry.name, index]));
  return rows
    .map((row) => ({
      name: row.name,
      dimensions: row.dimensions,
      endpoints: Array.isArray(row.endpoints) ? row.endpoints : [],
      status: 'active' as const,
    }))
    .sort((left, right) => {
      const leftOrder = order.get(left.name) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.name) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name);
    });
}

export function documentEmbeddingTarget(input: {
  instanceId: string;
  id: string;
  label?: string;
}): BackgroundEmbeddingTarget {
  return {
    kind: 'document',
    instanceId: input.instanceId,
    targetTable: TARGET_TABLES.document,
    targetId: input.id,
    targetLabel: input.label,
  };
}

export function memoryEmbeddingTarget(input: {
  instanceId: string;
  id: string;
  label?: string;
}): BackgroundEmbeddingTarget {
  return {
    kind: 'memory',
    instanceId: input.instanceId,
    targetTable: TARGET_TABLES.memory,
    targetId: input.id,
    targetLabel: input.label,
  };
}

export function recordEmbeddingTarget(input: {
  instanceId: string;
  targetTable: string;
  id: string;
  label?: string;
}): BackgroundEmbeddingTarget {
  assertSafeRecordTable(input.targetTable);
  return {
    kind: 'record',
    instanceId: input.instanceId,
    targetTable: input.targetTable,
    targetId: input.id,
    targetLabel: input.label,
  };
}

export async function scheduleBackgroundEmbedding(
  options: ScheduleBackgroundEmbeddingOptions
): Promise<ScheduleBackgroundEmbeddingResult> {
  const log = options.logger ?? makeDefaultStructuredLogger();

  try {
    const vector = await options.provider.embed(options.embedText);
    const providerInfo = options.provider.getProviderInfo?.();
    await updateTargetEmbedding(
      options.target,
      vector,
      options.supabase,
      options.databaseUrl,
      options.embeddingName
        ? {
            embeddingName: options.embeddingName,
            model: providerInfo?.model ?? 'unknown',
            provider: providerInfo?.provider ?? 'unknown',
            truncated: options.truncated ?? false,
          }
        : undefined
    );
    await clearPendingEmbedding(options.supabase, options.target, options.embeddingName);
    return { warnings: [] };
  } catch (err) {
    const message = errorMessage(err);
    try {
      await upsertPendingEmbedding(options, message);
    } catch (pendingErr) {
      logPendingEmbeddingLost(log, options.target, message, errorMessage(pendingErr));
    }
    logBackgroundEmbedFailure(log, options.target, options.provider, options.embedText, message);
    return { warnings: [deferredEmbeddingWarning(options.embeddingName)] };
  }
}

export function deferredEmbeddingWarning(embeddingName?: string): EmbeddingWarning {
  return embeddingName ? `embedding_deferred:${embeddingName}` : EMBEDDING_DEFERRED_WARNING;
}

export async function scheduleBackgroundEmbeddingsForActiveEntries(
  options: ScheduleActiveCatalogEmbeddingsOptions
): Promise<ScheduleBackgroundEmbeddingResult> {
  const entries = await selectActiveEmbeddingEntries(options.supabase, options.config);
  if (entries.length === 0) {
    if ((options.config.embeddings?.length ?? 0) === 0 && options.legacyProvider) {
      return scheduleBackgroundEmbedding({
        target: options.target,
        embedText: options.embedText,
        provider: options.legacyProvider,
        supabase: options.supabase,
        logger: options.logger,
        databaseUrl: options.databaseUrl,
      });
    }
    return { warnings: [] };
  }

  const providerFactory =
    options.providerFactory ??
    ((entry: ActiveEmbeddingEntry) => createEmbeddingProviderForCatalogEntry(options.config, entry));

  const results = await Promise.all(
    entries.map((entry) =>
      scheduleBackgroundEmbedding({
        target: options.target,
        embedText: options.embedText,
        provider: providerFactory(entry),
        supabase: options.supabase,
        logger: options.logger,
        databaseUrl: options.databaseUrl,
        embeddingName: entry.name,
      })
    )
  );

  return { warnings: [...new Set(results.flatMap((result) => result.warnings))] };
}

export async function updateTargetEmbedding(
  target: BackgroundEmbeddingTarget,
  vector: number[],
  supabase: SupabaseLike,
  databaseUrl?: string,
  stamp?: EmbeddingWriteStamp
): Promise<void> {
  if (stamp) {
    assertSafeEmbeddingName(stamp.embeddingName);
  }

  if ((target.kind === 'record' || stamp) && databaseUrl) {
    await updateTargetEmbeddingWithPg(target, vector, databaseUrl, stamp);
    return;
  }

  const payload = stamp
    ? buildStampedEmbeddingPayload(vector, stamp, target.kind === 'record')
    : {
        embedding: JSON.stringify(vector),
        ...(target.kind === 'record'
          ? { embedding_updated_at: new Date().toISOString() }
          : { updated_at: new Date().toISOString() }),
      };

  const { error } = await (supabase.from(target.targetTable) as TableQuery)
    .update(payload)
    .eq('instance_id', target.instanceId)
    .eq('id', target.targetId);

  if (error) {
    throw new Error(error.message);
  }
}

async function updateTargetEmbeddingWithPg(
  target: BackgroundEmbeddingTarget,
  vector: number[],
  databaseUrl: string,
  stamp?: EmbeddingWriteStamp
): Promise<void> {
  assertSafeTargetTable(target);
  const baseColumn = stamp ? `embedding_${stamp.embeddingName}` : 'embedding';
  const timestampColumn = target.kind === 'record' ? 'embedding_updated_at' : 'updated_at';

  if (!stamp) {
    await queryPgPool(
      databaseUrl,
      `UPDATE ${pg.escapeIdentifier(target.targetTable)}
       SET embedding = $1::vector, ${pg.escapeIdentifier(timestampColumn)} = now()
       WHERE instance_id = $2 AND id = $3`,
      [`[${vector.join(',')}]`, target.instanceId, target.targetId]
    );
    return;
  }

  await queryPgPool(
    databaseUrl,
    `UPDATE ${pg.escapeIdentifier(target.targetTable)}
     SET ${pg.escapeIdentifier(baseColumn)} = $1::vector,
         ${pg.escapeIdentifier(`${baseColumn}_model`)} = $2,
         ${pg.escapeIdentifier(`${baseColumn}_dimensions`)} = $3,
         ${pg.escapeIdentifier(`${baseColumn}_provider`)} = $4,
         ${pg.escapeIdentifier(`${baseColumn}_truncated`)} = $5,
         ${pg.escapeIdentifier(timestampColumn)} = now()
     WHERE instance_id = $6 AND id = $7`,
    [
      `[${vector.join(',')}]`,
      stamp.model,
      vector.length,
      stamp.provider,
      stamp.truncated ?? false,
      target.instanceId,
      target.targetId,
    ]
  );
}

function buildStampedEmbeddingPayload(
  vector: number[],
  stamp: EmbeddingWriteStamp,
  isRecord: boolean
): Record<string, unknown> {
  const baseColumn = `embedding_${stamp.embeddingName}`;
  return {
    [baseColumn]: JSON.stringify(vector),
    [`${baseColumn}_model`]: stamp.model,
    [`${baseColumn}_dimensions`]: vector.length,
    [`${baseColumn}_provider`]: stamp.provider,
    [`${baseColumn}_truncated`]: stamp.truncated ?? false,
    ...(isRecord
      ? { embedding_updated_at: new Date().toISOString() }
      : { updated_at: new Date().toISOString() }),
  };
}

async function upsertPendingEmbedding(
  options: ScheduleBackgroundEmbeddingOptions,
  lastError: string
): Promise<void> {
  const attemptCount = await nextAttemptCount(options.supabase, options.target, options.embeddingName);
  const now = new Date();
  const nextRetryAt = new Date(now.getTime() + 60_000).toISOString();

  const { error } = await (options.supabase.from('fqc_pending_embeds') as TableQuery).upsert(
    {
      instance_id: options.target.instanceId,
      target_kind: options.target.kind,
      target_table: options.target.targetTable,
      target_id: options.target.targetId,
      embedding_name: options.embeddingName ?? 'legacy',
      target_label: options.target.targetLabel ?? null,
      embed_text: options.embedText,
      attempt_count: attemptCount,
      last_error: lastError,
      last_attempt_at: now.toISOString(),
      next_retry_at: nextRetryAt,
      status: 'pending',
      updated_at: now.toISOString(),
    },
    { onConflict: 'instance_id,target_kind,target_table,target_id,embedding_name' }
  );

  if (error) {
    throw new Error(`Failed to record pending embedding: ${error.message}`);
  }
}

async function clearPendingEmbedding(
  supabase: SupabaseLike,
  target: BackgroundEmbeddingTarget,
  embeddingName?: string
): Promise<void> {
  let query = (supabase.from('fqc_pending_embeds') as TableQuery)
    .delete()
    .eq('instance_id', target.instanceId)
    .eq('target_kind', target.kind)
    .eq('target_table', target.targetTable)
    .eq('target_id', target.targetId);

  if (embeddingName) {
    query = query.eq('embedding_name', embeddingName);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to clear pending embedding: ${error.message}`);
  }
}

async function nextAttemptCount(
  supabase: SupabaseLike,
  target: BackgroundEmbeddingTarget,
  embeddingName?: string
): Promise<number> {
  let query = (supabase.from('fqc_pending_embeds') as TableQuery)
    .select('attempt_count')
    .eq('instance_id', target.instanceId)
    .eq('target_kind', target.kind)
    .eq('target_table', target.targetTable)
    .eq('target_id', target.targetId);

  if (embeddingName) {
    query = query.eq('embedding_name', embeddingName);
  }

  const { data, error } = await query;

  if (error) {
    return 1;
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const existing = rows[0]?.attempt_count;
  return typeof existing === 'number' ? existing + 1 : 1;
}

function logBackgroundEmbedFailure(
  log: StructuredLogger,
  target: BackgroundEmbeddingTarget,
  provider: EmbeddingProvider,
  embedText: string,
  message: string
): void {
  const providerInfo = provider.getProviderInfo?.();
  const humanMessage = formatBackgroundEmbedFailureMessage({
    target,
    providerName: providerInfo?.provider,
    model: providerInfo?.model,
    inputChars: embedText.length,
    error: message,
  });

  log.error(humanMessage, {
    target_kind: target.kind,
    target_table: target.targetTable,
    target_id: target.targetId,
    target_label: target.targetLabel,
    provider: providerInfo?.provider,
    model: providerInfo?.model,
    input_chars: embedText.length,
    error: message,
  });
}

function formatBackgroundEmbedFailureMessage(input: {
  target: BackgroundEmbeddingTarget;
  providerName?: string;
  model?: string;
  inputChars: number;
  error: string;
}): string {
  const label = input.target.targetLabel ?? input.target.targetId;
  const targetKind = input.target.kind;
  const providerClause =
    input.providerName && input.model
      ? ` with ${input.providerName} model "${input.model}"`
      : ' with the configured embedding model';
  const explanation = humanEmbeddingError(input.error, input.providerName);
  return `Failed to embed ${targetKind} "${label}"${providerClause} after sending ${formatCount(input.inputChars, 'character')}. ${explanation} The ${targetKind} was saved and embedding will be retried later.`;
}

function humanEmbeddingError(error: string, providerName?: string): string {
  const dimensionMismatch = error.match(/expected\s+(\d+)\s+dimensions,\s+not\s+(\d+)/i);
  if (dimensionMismatch) {
    return `The database expected a ${formatNumber(Number(dimensionMismatch[1]))}-dimensional vector but the model returned ${formatNumber(Number(dimensionMismatch[2]))} dimensions.`;
  }

  const contextLength = error.match(/input length exceeds (?:the )?context length/i);
  if (contextLength) {
    const speaker = providerName ? `${providerName} said` : 'The embedding provider said';
    return `${speaker}: the input length exceeds the context length.`;
  }

  const ollamaError = error.match(/Ollama API returned \d+(?::\s*(.+?))?\.?$/i);
  if (ollamaError?.[1]) {
    return `Ollama said: ${trimTrailingPeriod(ollamaError[1])}.`;
  }

  return `The embedding provider said: ${trimTrailingPeriod(error)}.`;
}

function formatCount(value: number, singular: string): string {
  return `${formatNumber(value)} ${value === 1 ? singular : `${singular}s`}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function trimTrailingPeriod(value: string): string {
  return value.trim().replace(/\.+$/, '');
}

function logPendingEmbeddingLost(
  log: StructuredLogger,
  target: BackgroundEmbeddingTarget,
  originalError: string,
  pendingError: string
): void {
  log.error(formatPendingEmbeddingLostMessage(target, originalError, pendingError), {
    target_kind: target.kind,
    target_table: target.targetTable,
    target_id: target.targetId,
    target_label: target.targetLabel,
    error: originalError,
    pending_error: pendingError,
  });
}

function formatPendingEmbeddingLostMessage(
  target: BackgroundEmbeddingTarget,
  originalError: string,
  pendingError: string
): string {
  const label = target.targetLabel ?? target.targetId;
  return `Could not save embedding retry state for ${target.kind} "${label}". Original embedding error: ${trimTrailingPeriod(originalError)}. Retry-state error: ${trimTrailingPeriod(pendingError)}. The ${target.kind} was saved, but automatic embedding retry may not happen.`;
}

function makeDefaultStructuredLogger(): StructuredLogger {
  return {
    error: (message, fields) => {
      defaultLogger?.error(`${message}: ${JSON.stringify(fields ?? {})}`);
    },
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function assertSafeRecordTable(tableName: string): void {
  if (!/^fqcp_[A-Za-z0-9_]+$/.test(tableName)) {
    throw new Error(`Invalid record target table: ${tableName}`);
  }
}

function assertSafeTargetTable(target: BackgroundEmbeddingTarget): void {
  if (target.kind === 'document' && target.targetTable === TARGET_TABLES.document) return;
  if (target.kind === 'memory' && target.targetTable === TARGET_TABLES.memory) return;
  if (target.kind === 'record') {
    assertSafeRecordTable(target.targetTable);
    return;
  }
  throw new Error(`Invalid ${target.kind} target table: ${target.targetTable}`);
}

function assertSafeEmbeddingName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid embedding name: ${name}`);
  }
}
