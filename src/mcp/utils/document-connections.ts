import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../../config/types.js';
import type { ActiveEmbeddingEntry } from '../../embedding/background-embed.js';
import type { ErrorEnvelope } from './response-formats.js';

export interface DocumentConnectionTarget {
  chunk_id: string;
  document_id: string;
  path: string;
  title: string;
  heading_path?: string;
  content?: string;
}

export interface DocumentConnection {
  id: string;
  score: number;
  target: DocumentConnectionTarget;
}

export interface SourceChunkConnectionBucket {
  chunk_id: string;
  heading_path?: string;
  breadcrumb?: string;
  connections: DocumentConnection[];
}

export interface DocumentConnectionsResult {
  overall: DocumentConnection[];
  source_chunks: SourceChunkConnectionBucket[];
}

export interface DocumentConnectionsOptions {
  limit?: number;
  limit_per_chunk?: number;
  embedding_names?: string[];
}

type EmbeddingCatalogEntry = ActiveEmbeddingEntry | {
  name: string;
  dimensions: number;
  endpoints: unknown[];
  status: 'deactivated';
};

interface EmbeddingRow {
  name: string;
  dimensions: number;
  endpoints: unknown;
  status: 'active' | 'deactivated';
}

interface EmbeddingSelection {
  selected: ActiveEmbeddingEntry[];
}

function embeddingColumnName(entryName: string): string {
  return `embedding_${entryName}`;
}

function vectorRpcArgument(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function normalizeEmbeddingRow(row: EmbeddingRow): EmbeddingCatalogEntry {
  return {
    name: row.name,
    dimensions: row.dimensions,
    endpoints: Array.isArray(row.endpoints) ? row.endpoints : [],
    status: row.status,
  };
}

function embeddingOrder(config: FlashQueryConfig): Map<string, number> {
  return new Map((config.embeddings ?? []).map((entry, index) => [entry.name, index]));
}

function isActiveEntry(entry: EmbeddingCatalogEntry): entry is ActiveEmbeddingEntry {
  return entry.status === 'active';
}

async function selectEmbeddingEntries(
  supabase: SupabaseClient,
  config: FlashQueryConfig
): Promise<EmbeddingCatalogEntry[]> {
  const { data, error } = await supabase
    .from('fqc_embeddings')
    .select('name, dimensions, endpoints, status')
    .eq('instance_id', config.instance.id) as {
      data: EmbeddingRow[] | EmbeddingRow | null;
      error: { message: string } | null;
    };

  if (error) throw new Error(`Embedding catalog query failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const order = embeddingOrder(config);
  return rows
    .map(normalizeEmbeddingRow)
    .sort((left, right) => {
      const leftOrder = order.get(left.name) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.name) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name);
    });
}

function resolveEmbeddingSelection(input: {
  entries: EmbeddingCatalogEntry[];
  requestedNames?: string[];
}): { selection?: EmbeddingSelection; error?: ErrorEnvelope } {
  const requestedNames = input.requestedNames;
  if (requestedNames !== undefined && requestedNames.length === 0) {
    return {
      error: {
        error: 'invalid_input',
        message: 'embedding_names must contain at least one embedding name when provided',
        identifier: 'embedding_names',
        details: { field: 'embedding_names' },
      },
    };
  }

  if (requestedNames === undefined) {
    return { selection: { selected: input.entries.filter(isActiveEntry) } };
  }

  const selected: ActiveEmbeddingEntry[] = [];
  const byName = new Map(input.entries.map((entry) => [entry.name, entry]));
  for (const name of [...new Set(requestedNames)]) {
    const entry = byName.get(name);
    if (!entry) {
      return {
        error: {
          error: 'not_found',
          message: `Embedding catalog entry '${name}' was not found`,
          identifier: name,
          details: { field: 'embedding_names' },
        },
      };
    }
    if (entry.status === 'deactivated') {
      return {
        error: {
          error: 'unsupported',
          message: `Embedding catalog entry '${name}' is deactivated and cannot be used for document connections`,
          identifier: name,
          details: { field: 'embedding_names', status: 'deactivated' },
        },
      };
    }
    selected.push(entry);
  }

  return { selection: { selected } };
}

function zeroActiveEmbeddings(): ErrorEnvelope {
  return {
    error: 'unsupported',
    message: 'Document connections are unavailable because no active embedding catalog entries exist',
    identifier: 'connections',
    details: { reason: 'zero_active_embeddings' },
  };
}

function mergeBestConnection(
  map: Map<string, DocumentConnection>,
  connection: DocumentConnection
): void {
  const existing = map.get(connection.id);
  if (!existing || connection.score > existing.score) map.set(connection.id, connection);
}

function sortedConnections(map: Map<string, DocumentConnection>, limit?: number): DocumentConnection[] {
  const sorted = [...map.values()].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) return scoreDelta;
    return left.id.localeCompare(right.id);
  });
  return limit === undefined ? sorted : sorted.slice(0, limit);
}

async function connectionsForEntry(input: {
  supabase: SupabaseClient;
  config: FlashQueryConfig;
  entry: ActiveEmbeddingEntry;
  sourceDocumentId: string;
  limitPerChunk: number;
}): Promise<SourceChunkConnectionBucket[]> {
  const embeddingColumn = embeddingColumnName(input.entry.name);
  const { data: sourceRows, error: sourceError } = await input.supabase
    .from('fqc_chunks')
    .select(`id, heading_path, breadcrumb, ${embeddingColumn}`)
    .eq('document_id', input.sourceDocumentId)
    .eq('instance_id', input.config.instance.id)
    .not(embeddingColumn, 'is', null) as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

  if (sourceError) throw new Error(sourceError.message);

  const buckets: SourceChunkConnectionBucket[] = [];
  for (const sourceRow of sourceRows ?? []) {
    const sourceChunkId = String(sourceRow.id ?? '');
    const sourceVector = sourceRow[embeddingColumn];
    if (!sourceChunkId || sourceVector === undefined || sourceVector === null) continue;

    const { data, error } = await input.supabase.rpc(`match_chunks_${input.entry.name}`, {
      query_embedding: vectorRpcArgument(sourceVector),
      match_threshold: 0.4,
      match_count: Math.max(input.limitPerChunk + 50, input.limitPerChunk * 8),
      filter_instance_id: input.config.instance.id,
      filter_tags: null,
      filter_tag_match: 'any',
      include_archived: false,
    }) as { data: unknown; error: { message: string } | null };

    if (error) throw new Error(error.message);

    const byTarget = new Map<string, DocumentConnection>();
    for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
      const targetDocumentId = String(row.document_id ?? '');
      const targetChunkId = String(row.chunk_id ?? '');
      if (!targetDocumentId || !targetChunkId || targetDocumentId === input.sourceDocumentId) continue;
      const path = String(row.path ?? '');
      const title = String(row.title ?? path);
      const score = typeof row.similarity === 'number' ? row.similarity : Number(row.similarity ?? 0);
      if (!path || !Number.isFinite(score)) continue;
      mergeBestConnection(byTarget, {
        id: `${path}#${targetChunkId}`,
        score,
        target: {
          chunk_id: targetChunkId,
          document_id: targetDocumentId,
          path,
          title,
          ...(typeof row.heading_path === 'string' ? { heading_path: row.heading_path } : {}),
          ...(typeof row.content === 'string' ? { content: row.content } : {}),
        },
      });
    }

    buckets.push({
      chunk_id: sourceChunkId,
      ...(typeof sourceRow.heading_path === 'string' ? { heading_path: sourceRow.heading_path } : {}),
      ...(typeof sourceRow.breadcrumb === 'string' ? { breadcrumb: sourceRow.breadcrumb } : {}),
      connections: sortedConnections(byTarget, input.limitPerChunk),
    });
  }

  return buckets;
}

function mergeSourceBuckets(
  buckets: SourceChunkConnectionBucket[],
  limitPerChunk: number
): SourceChunkConnectionBucket[] {
  const bySource = new Map<string, {
    heading_path?: string;
    breadcrumb?: string;
    connections: Map<string, DocumentConnection>;
  }>();

  for (const bucket of buckets) {
    const existing = bySource.get(bucket.chunk_id) ?? {
      heading_path: bucket.heading_path,
      breadcrumb: bucket.breadcrumb,
      connections: new Map<string, DocumentConnection>(),
    };
    for (const connection of bucket.connections) mergeBestConnection(existing.connections, connection);
    bySource.set(bucket.chunk_id, existing);
  }

  return [...bySource.entries()].map(([chunkId, bucket]) => ({
    chunk_id: chunkId,
    ...(bucket.heading_path ? { heading_path: bucket.heading_path } : {}),
    ...(bucket.breadcrumb ? { breadcrumb: bucket.breadcrumb } : {}),
    connections: sortedConnections(bucket.connections, limitPerChunk),
  }));
}

export async function buildDocumentConnections(input: {
  supabase: SupabaseClient;
  config: FlashQueryConfig;
  sourceDocumentId: string;
  options?: DocumentConnectionsOptions;
}): Promise<{ result?: DocumentConnectionsResult; error?: ErrorEnvelope }> {
  const limit = input.options?.limit ?? 50;
  const limitPerChunk = input.options?.limit_per_chunk ?? 5;
  const entries = await selectEmbeddingEntries(input.supabase, input.config);
  const selectionResult = resolveEmbeddingSelection({
    entries,
    requestedNames: input.options?.embedding_names,
  });
  if (selectionResult.error) return { error: selectionResult.error };
  const selected = selectionResult.selection?.selected ?? [];
  if (selected.length === 0) return { error: zeroActiveEmbeddings() };

  const sourceBuckets = (await Promise.all(selected.map((entry) =>
    connectionsForEntry({
      supabase: input.supabase,
      config: input.config,
      entry,
      sourceDocumentId: input.sourceDocumentId,
      limitPerChunk,
    })
  ))).flat();
  const sourceChunks = mergeSourceBuckets(sourceBuckets, limitPerChunk);
  const overallByTarget = new Map<string, DocumentConnection>();
  for (const bucket of sourceChunks) {
    for (const connection of bucket.connections) mergeBestConnection(overallByTarget, connection);
  }

  return {
    result: {
      overall: sortedConnections(overallByTarget, limit),
      source_chunks: sourceChunks,
    },
  };
}
