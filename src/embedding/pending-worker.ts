import type { EmbeddingCatalogEndpoint, EmbeddingProvider } from './provider.js';
import { createEmbeddingProviderForCatalogEntry } from './provider.js';
import {
  type ActiveEmbeddingEntry,
  type BackgroundEmbeddingTarget,
  type BackgroundEmbeddingTargetKind,
  documentChunkEmbeddingTarget,
  documentEmbeddingTarget,
  memoryEmbeddingTarget,
  recordEmbeddingTarget,
  updateTargetEmbedding,
} from './background-embed.js';
import { chunkEmbedText } from './chunks/normalize.js';
import { logger as defaultLogger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/types.js';

export interface ProcessPendingEmbeddingsOptions {
  supabase: SupabaseLike;
  provider?: EmbeddingProvider;
  config?: FlashQueryConfig;
  instanceId: string;
  limit?: number;
  databaseUrl?: string;
  logger?: StructuredLogger;
  now?: () => Date;
  retryBackoffMs?: number;
  embeddingName?: string;
  truncated?: boolean;
  providerFactory?: (entry: ActiveEmbeddingEntry) => EmbeddingProvider;
}

export interface ProcessPendingEmbeddingsResult {
  selected: number;
  processed: number;
  succeeded: number;
  failed: number;
}

interface PendingEmbedRow {
  id: string;
  instance_id: string;
  target_kind: string;
  target_table: string;
  target_id: string;
  target_label: string | null;
  embed_text: string | null;
  attempt_count: number | null;
  embedding_name?: string | null;
}

interface StructuredLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function isEmbeddingCatalogEndpoint(value: unknown): value is EmbeddingCatalogEndpoint {
  return typeof value === 'object' && value !== null && typeof (value as { model?: unknown }).model === 'string';
}

interface QueryResult<Row = Record<string, unknown>> {
  data?: Row[] | Row | null;
  error?: { message: string } | null;
}

interface QueryBuilder<Row = Record<string, unknown>> extends PromiseLike<QueryResult<Row>> {
  eq(column: string, value: unknown): QueryBuilder<Row>;
  or?(filter: string): QueryBuilder<Row>;
  order?(column: string, options?: Record<string, unknown>): QueryBuilder<Row>;
  limit?(count: number): QueryBuilder<Row>;
  single(): PromiseLike<QueryResult<Row>>;
}

interface TableQuery {
  select<Row = Record<string, unknown>>(columns: string): QueryBuilder<Row>;
  update(payload: Record<string, unknown>): QueryBuilder;
  upsert(payload: Record<string, unknown>, options?: Record<string, unknown>): PromiseLike<QueryResult>;
  delete(): QueryBuilder;
}

interface SupabaseLike {
  from(table: string): unknown;
}

const DEFAULT_LIMIT = 25;
const DEFAULT_RETRY_BACKOFF_MS = 60_000;

export async function processPendingEmbeddings(
  options: ProcessPendingEmbeddingsOptions
): Promise<ProcessPendingEmbeddingsResult> {
  const log = options.logger ?? makeDefaultStructuredLogger();
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? DEFAULT_LIMIT;

  const rows = await selectEligiblePendingRows(options.supabase, options.instanceId, limit, now());
  const result: ProcessPendingEmbeddingsResult = {
    selected: rows.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const row of rows) {
    result.processed++;
    try {
      const target = targetFromPendingRow(row, options.instanceId);
      const entry = await resolvePendingEmbeddingEntry(options.supabase, row, options.instanceId);
      if (entry === 'retired') {
        await clearPendingRow(options.supabase, row.id, options.instanceId);
        result.processed--;
        continue;
      }
      if (entry === 'deactivated') {
        result.processed--;
        continue;
      }
      const embedText = await resolveEmbedText(options.supabase, row, target);
      const provider =
        entry
          ? (options.providerFactory ?? ((activeEntry: ActiveEmbeddingEntry) => {
              if (!options.config) {
                throw new Error('pending embedding retry requires config to build catalog provider');
              }
              return createEmbeddingProviderForCatalogEntry(options.config, activeEntry);
            }))(entry)
          : options.provider;
      if (!provider) {
        throw new Error('pending embedding retry has no provider');
      }
      const vector = await provider.embed(embedText);
      const providerInfo = provider.getProviderInfo?.();
      const metadata = provider.getLastEmbeddingMetadata?.();
      const embeddingName = entry?.name ?? row.embedding_name ?? options.embeddingName;
      await updateTargetEmbedding(
        target,
        vector,
        options.supabase,
        options.databaseUrl,
        embeddingName
          ? {
              embeddingName,
              model: providerInfo?.model ?? 'unknown',
              provider: providerInfo?.provider ?? 'unknown',
              truncated: options.truncated ?? metadata?.truncated ?? false,
            }
          : undefined
      );
      await clearPendingRow(options.supabase, row.id, options.instanceId);
      result.succeeded++;
    } catch (err) {
      result.failed++;
      const message = errorMessage(err);
      await recordRetryFailure(options.supabase, row, options.instanceId, message, now(), options.retryBackoffMs);
      log.warn('pending_embedding_retry_failed', {
        pending_id: row.id,
        target_kind: row.target_kind,
        target_table: row.target_table,
        target_id: row.target_id,
        error: message,
      });
    }
  }

  return result;
}

async function selectEligiblePendingRows(
  supabase: SupabaseLike,
  instanceId: string,
  limit: number,
  now: Date
): Promise<PendingEmbedRow[]> {
  let query = (supabase.from('fqc_pending_embeds') as TableQuery)
    .select<PendingEmbedRow>(
      'id, instance_id, target_kind, target_table, target_id, embedding_name, target_label, embed_text, attempt_count'
    )
    .eq('instance_id', instanceId)
    .eq('status', 'pending');

  if (query.or) {
    query = query.or(`next_retry_at.is.null,next_retry_at.lte.${now.toISOString()}`);
  }
  if (query.order) {
    query = query.order('next_retry_at', { ascending: true, nullsFirst: true });
  }
  if (query.limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`pending embedding query failed: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.slice(0, limit);
}

async function resolvePendingEmbeddingEntry(
  supabase: SupabaseLike,
  row: PendingEmbedRow,
  instanceId: string
): Promise<ActiveEmbeddingEntry | 'deactivated' | 'retired' | null> {
  if (!row.embedding_name) {
    return null;
  }

  const { data, error } = await (supabase.from('fqc_embeddings') as TableQuery)
    .select<{ name: string; dimensions: number; endpoints: unknown; status: 'active' | 'deactivated' }>(
      'name, dimensions, endpoints, status'
    )
    .eq('instance_id', instanceId)
    .eq('name', row.embedding_name);

  if (error) {
    throw new Error(`pending embedding catalog lookup failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const entry = rows[0];
  if (!entry) {
    return 'retired';
  }
  if (entry.status === 'deactivated') {
    return 'deactivated';
  }
  return {
    name: entry.name,
    dimensions: entry.dimensions,
    endpoints: Array.isArray(entry.endpoints) ? entry.endpoints.filter(isEmbeddingCatalogEndpoint) : [],
    status: 'active',
  };
}

function targetFromPendingRow(row: PendingEmbedRow, instanceId: string): BackgroundEmbeddingTarget {
  if (row.instance_id !== instanceId) {
    throw new Error('pending embedding row instance mismatch');
  }

  const kind = row.target_kind as BackgroundEmbeddingTargetKind;
  if (kind === 'document') {
    return documentEmbeddingTarget({
      instanceId,
      id: row.target_id,
      label: row.target_label ?? undefined,
    });
  }
  if (kind === 'document_chunk') {
    return documentChunkEmbeddingTarget({
      instanceId,
      id: row.target_id,
      label: row.target_label ?? undefined,
    });
  }
  if (kind === 'memory') {
    return memoryEmbeddingTarget({
      instanceId,
      id: row.target_id,
      label: row.target_label ?? undefined,
    });
  }
  if (kind === 'record') {
    return recordEmbeddingTarget({
      instanceId,
      targetTable: row.target_table,
      id: row.target_id,
      label: row.target_label ?? undefined,
    });
  }

  throw new Error(`Unsupported pending embedding target kind: ${row.target_kind}`);
}

async function resolveEmbedText(
  supabase: SupabaseLike,
  row: PendingEmbedRow,
  target: BackgroundEmbeddingTarget
): Promise<string> {
  if (row.embed_text && row.embed_text.trim().length > 0) {
    return row.embed_text;
  }

  if (target.kind === 'memory') {
    const { data, error } = await (supabase.from('fqc_memory') as TableQuery)
      .select<{ content?: string }>('content')
      .eq('instance_id', target.instanceId)
      .eq('id', target.targetId)
      .single();

    if (error) {
      throw new Error(`memory embed text lookup failed: ${error.message}`);
    }
    if (data && !Array.isArray(data) && typeof data.content === 'string') {
      return data.content;
    }
  }

  if (target.kind === 'document') {
    const { data, error } = await (supabase.from('fqc_documents') as TableQuery)
      .select<{ title?: string; path?: string }>('title, path')
      .eq('instance_id', target.instanceId)
      .eq('id', target.targetId)
      .single();

    if (error) {
      throw new Error(`document embed text lookup failed: ${error.message}`);
    }
    if (data && !Array.isArray(data)) {
      const title = typeof data.title === 'string' ? data.title : '';
      const path = typeof data.path === 'string' ? data.path : '';
      const text = [title, path].filter(Boolean).join('\n\n');
      if (text.length > 0) {
        return text;
      }
    }
  }

  if (target.kind === 'document_chunk') {
    const { data, error } = await (supabase.from('fqc_chunks') as TableQuery)
      .select<{ breadcrumb?: string; content?: string }>('breadcrumb, content')
      .eq('instance_id', target.instanceId)
      .eq('id', target.targetId)
      .single();

    if (error) {
      throw new Error(`document chunk embed text lookup failed: ${error.message}`);
    }
    if (data && !Array.isArray(data) && typeof data.breadcrumb === 'string' && typeof data.content === 'string') {
      return chunkEmbedText(data.breadcrumb, data.content);
    }
  }

  if (target.targetLabel && target.targetLabel.trim().length > 0) {
    return target.targetLabel;
  }

  throw new Error(`No embed text available for pending embedding ${row.id}`);
}

async function clearPendingRow(
  supabase: SupabaseLike,
  pendingId: string,
  instanceId: string
): Promise<void> {
  const { error } = await (supabase.from('fqc_pending_embeds') as TableQuery)
    .delete()
    .eq('id', pendingId)
    .eq('instance_id', instanceId);
  if (error) {
    throw new Error(`pending embedding clear failed: ${error.message}`);
  }
}

async function recordRetryFailure(
  supabase: SupabaseLike,
  row: PendingEmbedRow,
  instanceId: string,
  lastError: string,
  now: Date,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS
): Promise<void> {
  const { error } = await (supabase.from('fqc_pending_embeds') as TableQuery)
    .update({
      attempt_count: (row.attempt_count ?? 0) + 1,
      last_error: lastError,
      last_attempt_at: now.toISOString(),
      next_retry_at: new Date(now.getTime() + retryBackoffMs).toISOString(),
      status: 'pending',
      updated_at: now.toISOString(),
    })
    .eq('id', row.id)
    .eq('instance_id', instanceId);

  if (error) {
    throw new Error(`pending embedding failure update failed: ${error.message}`);
  }
}

function makeDefaultStructuredLogger(): StructuredLogger {
  return {
    warn: (message, fields) => defaultLogger?.warn?.(`${message}: ${JSON.stringify(fields ?? {})}`),
    error: (message, fields) => defaultLogger?.error?.(`${message}: ${JSON.stringify(fields ?? {})}`),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
