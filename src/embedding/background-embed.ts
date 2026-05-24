import pg from 'pg';
import type { EmbeddingProvider } from './provider.js';
import { logger as defaultLogger } from '../logging/logger.js';
import { createPgClientIPv4 } from '../utils/pg-client.js';

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
}

interface SupabaseLike {
  from(table: string): TableQuery;
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
    return { warnings: [] };
  } catch (err) {
    const message = errorMessage(err);
    await upsertPendingEmbedding(options, message);
    logBackgroundEmbedFailure(log, options.target, message);
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

  const { error } = await supabase
    .from(target.targetTable)
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
  const client = createPgClientIPv4(databaseUrl);
  try {
    await client.connect();
    await client.query(
      `UPDATE ${pg.escapeIdentifier(target.targetTable)}
       SET embedding = $1::vector, embedding_updated_at = now()
       WHERE instance_id = $2 AND id = $3`,
      [`[${vector.join(',')}]`, target.instanceId, target.targetId]
    );
  } finally {
    await client.end();
  }
}

async function upsertPendingEmbedding(
  options: ScheduleBackgroundEmbeddingOptions,
  lastError: string
): Promise<void> {
  const attemptCount = await nextAttemptCount(options.supabase, options.target);
  const now = new Date();
  const nextRetryAt = new Date(now.getTime() + 60_000).toISOString();

  const { error } = await options.supabase.from('fqc_pending_embeds').upsert(
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

async function nextAttemptCount(
  supabase: SupabaseLike,
  target: BackgroundEmbeddingTarget
): Promise<number> {
  const { data, error } = await supabase
    .from('fqc_pending_embeds')
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
  message: string
): void {
  log.error('background_embed_failed', {
    target_kind: target.kind,
    target_table: target.targetTable,
    target_id: target.targetId,
    target_label: target.targetLabel,
    error: message,
  });
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
