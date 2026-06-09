import pg from 'pg';
import type { EmbeddingProvider } from './provider.js';
import { logger as defaultLogger } from '../logging/logger.js';
import { queryPgPool } from '../utils/pg-client.js';

export const EMBEDDING_DEFERRED_WARNING = 'embedding_deferred' as const;

export type EmbeddingWarning = typeof EMBEDDING_DEFERRED_WARNING;
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
}

export interface ScheduleBackgroundEmbeddingResult {
  warnings: EmbeddingWarning[];
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
  select(columns: string): QueryBuilder<{ attempt_count?: number }>;
  delete(): QueryBuilder;
}

interface SupabaseLike {
  from(table: string): unknown;
}

const TARGET_TABLES = {
  document: 'fqc_documents',
  memory: 'fqc_memory',
} as const;

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
    await updateTargetEmbedding(options.target, vector, options.supabase, options.databaseUrl);
    await clearPendingEmbedding(options.supabase, options.target);
    return { warnings: [] };
  } catch (err) {
    const message = errorMessage(err);
    try {
      await upsertPendingEmbedding(options, message);
    } catch (pendingErr) {
      logPendingEmbeddingLost(log, options.target, message, errorMessage(pendingErr));
    }
    logBackgroundEmbedFailure(log, options.target, options.provider, options.embedText, message);
    return { warnings: [EMBEDDING_DEFERRED_WARNING] };
  }
}

export async function updateTargetEmbedding(
  target: BackgroundEmbeddingTarget,
  vector: number[],
  supabase: SupabaseLike,
  databaseUrl?: string
): Promise<void> {
  if (target.kind === 'record' && databaseUrl) {
    await updateRecordEmbeddingWithPg(target, vector, databaseUrl);
    return;
  }

  const { error } = await (supabase.from(target.targetTable) as TableQuery)
    .update({
      embedding: JSON.stringify(vector),
      ...(target.kind === 'record'
        ? { embedding_updated_at: new Date().toISOString() }
        : { updated_at: new Date().toISOString() }),
    })
    .eq('instance_id', target.instanceId)
    .eq('id', target.targetId);

  if (error) {
    throw new Error(error.message);
  }
}

async function updateRecordEmbeddingWithPg(
  target: BackgroundEmbeddingTarget,
  vector: number[],
  databaseUrl: string
): Promise<void> {
  assertSafeRecordTable(target.targetTable);
  await queryPgPool(
    databaseUrl,
    `UPDATE ${pg.escapeIdentifier(target.targetTable)}
     SET embedding = $1::vector, embedding_updated_at = now()
     WHERE instance_id = $2 AND id = $3`,
    [`[${vector.join(',')}]`, target.instanceId, target.targetId]
  );
}

async function upsertPendingEmbedding(
  options: ScheduleBackgroundEmbeddingOptions,
  lastError: string
): Promise<void> {
  const attemptCount = await nextAttemptCount(options.supabase, options.target);
  const now = new Date();
  const nextRetryAt = new Date(now.getTime() + 60_000).toISOString();

  const { error } = await (options.supabase.from('fqc_pending_embeds') as TableQuery).upsert(
    {
      instance_id: options.target.instanceId,
      target_kind: options.target.kind,
      target_table: options.target.targetTable,
      target_id: options.target.targetId,
      target_label: options.target.targetLabel ?? null,
      embed_text: options.embedText,
      attempt_count: attemptCount,
      last_error: lastError,
      last_attempt_at: now.toISOString(),
      next_retry_at: nextRetryAt,
      status: 'pending',
      updated_at: now.toISOString(),
    },
    { onConflict: 'instance_id,target_kind,target_table,target_id' }
  );

  if (error) {
    throw new Error(`Failed to record pending embedding: ${error.message}`);
  }
}

async function clearPendingEmbedding(
  supabase: SupabaseLike,
  target: BackgroundEmbeddingTarget
): Promise<void> {
  const { error } = await (supabase.from('fqc_pending_embeds') as TableQuery)
    .delete()
    .eq('instance_id', target.instanceId)
    .eq('target_kind', target.kind)
    .eq('target_table', target.targetTable)
    .eq('target_id', target.targetId);

  if (error) {
    throw new Error(`Failed to clear pending embedding: ${error.message}`);
  }
}

async function nextAttemptCount(
  supabase: SupabaseLike,
  target: BackgroundEmbeddingTarget
): Promise<number> {
  const { data, error } = await (supabase.from('fqc_pending_embeds') as TableQuery)
    .select('attempt_count')
    .eq('instance_id', target.instanceId)
    .eq('target_kind', target.kind)
    .eq('target_table', target.targetTable)
    .eq('target_id', target.targetId);

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
