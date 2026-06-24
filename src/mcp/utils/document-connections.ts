import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../../config/types.js';
import type { ActiveEmbeddingEntry } from '../../embedding/background-embed.js';
import type { ErrorEnvelope } from './response-formats.js';

interface DocumentConnectionTarget {
  chunk_id: string;
  document_id: string;
  path: string;
  title: string;
  heading_path?: string;
  content?: string;
  document_status?: string;
}

interface DocumentConnection {
  id: string;
  score: number;
  target: DocumentConnectionTarget;
  basis?: 'embedding' | 'graph';
  direction?: 'in' | 'out';
  relation?: string;
  confidence_score?: number;
  reasoning?: string | null;
  stale?: boolean;
  question_status?: string | null;
  community_label?: string | null;
}

interface SourceChunkConnectionBucket {
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
  graph_limit_per_chunk?: number;
  embedding_limit_per_chunk?: number;
  include_embedding_only?: boolean;
  include_inactive_targets?: boolean;
  relations?: string[];
  include_stale?: boolean;
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

interface GraphEdgeForConnection {
  id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  relation: string;
  confidence_score: number;
  reasoning: string | null;
  status: string;
}

interface GraphTargetForConnection extends DocumentConnectionTarget {
  document_status: string;
  question_status: string | null;
  community_label: string | null;
}

type SourceChunkMetadata = {
  heading_path?: string;
  breadcrumb?: string;
};

function embeddingColumnName(entryName: string): string {
  return `embedding_${entryName}`;
}

function vectorRpcArgument(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function stringScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
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

function embeddingsNotConfigured(): ErrorEnvelope {
  return {
    error: 'unsupported',
    message: 'Document connections are unavailable because no embeddings are configured in flashquery.yml',
    identifier: 'connections',
    details: { reason: 'embeddings_not_configured' },
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

function isGraphAwareConnectionsOptions(options?: DocumentConnectionsOptions): boolean {
  return options?.graph_limit_per_chunk !== undefined ||
    options?.embedding_limit_per_chunk !== undefined ||
    options?.include_embedding_only !== undefined ||
    options?.include_inactive_targets !== undefined ||
    options?.relations !== undefined ||
    options?.include_stale !== undefined;
}

function embeddingOnlyConnection(connection: DocumentConnection): DocumentConnection {
  return {
    ...connection,
    basis: 'embedding',
  };
}

export function buildGraphPrimaryConnections(input: {
  sourceChunkIds: string[];
  sourceChunkMetadata: Map<string, SourceChunkMetadata>;
  edges: GraphEdgeForConnection[];
  targets: Map<string, GraphTargetForConnection>;
  embeddingOnly?: DocumentConnectionsResult;
  options?: DocumentConnectionsOptions;
}): DocumentConnectionsResult {
  const limit = input.options?.limit ?? 50;
  const graphLimitPerChunk = input.options?.graph_limit_per_chunk ?? 5;
  const includeInactiveTargets = input.options?.include_inactive_targets === true;
  const includeStale = input.options?.include_stale === true;
  const relationFilter = input.options?.relations && input.options.relations.length > 0
    ? new Set(input.options.relations)
    : null;
  const sourceSet = new Set(input.sourceChunkIds);
  const sourceBuckets = new Map<string, SourceChunkConnectionBucket>();
  const overallByTarget = new Map<string, DocumentConnection>();

  for (const sourceChunkId of input.sourceChunkIds) {
    const metadata = input.sourceChunkMetadata.get(sourceChunkId);
    sourceBuckets.set(sourceChunkId, {
      chunk_id: sourceChunkId,
      ...(metadata?.heading_path ? { heading_path: metadata.heading_path } : {}),
      ...(metadata?.breadcrumb ? { breadcrumb: metadata.breadcrumb } : {}),
      connections: [],
    });
  }

  for (const edge of input.edges) {
    if (relationFilter && !relationFilter.has(edge.relation)) continue;
    const stale = edge.status === 'stale';
    if (stale && !includeStale) continue;

    const sourceChunkId = sourceSet.has(edge.source_chunk_id)
      ? edge.source_chunk_id
      : sourceSet.has(edge.target_chunk_id)
        ? edge.target_chunk_id
        : null;
    if (!sourceChunkId) continue;

    const targetChunkId = sourceChunkId === edge.source_chunk_id ? edge.target_chunk_id : edge.source_chunk_id;
    if (sourceSet.has(targetChunkId)) continue;
    const target = input.targets.get(targetChunkId);
    if (!target) continue;
    if (!includeInactiveTargets && target.document_status !== 'active') continue;

    const direction = sourceChunkId === edge.source_chunk_id ? 'out' : 'in';
    const connection: DocumentConnection = {
      id: edge.id,
      score: edge.confidence_score,
      basis: 'graph',
      direction,
      relation: edge.relation,
      confidence_score: edge.confidence_score,
      reasoning: edge.reasoning,
      stale,
      question_status: target.question_status,
      community_label: target.community_label,
      target: {
        chunk_id: target.chunk_id,
        document_id: target.document_id,
        path: target.path,
        title: target.title,
        document_status: target.document_status,
        ...(target.heading_path ? { heading_path: target.heading_path } : {}),
        ...(target.content ? { content: target.content } : {}),
      },
    };

    const bucket = sourceBuckets.get(sourceChunkId);
    if (bucket) {
      bucket.connections.push(connection);
    }
    mergeBestConnection(overallByTarget, connection);
  }

  for (const bucket of sourceBuckets.values()) {
    bucket.connections = bucket.connections
      .sort((left, right) => right.score - left.score || left.target.path.localeCompare(right.target.path))
      .slice(0, graphLimitPerChunk);
  }

  if (input.options?.include_embedding_only === true && input.embeddingOnly) {
    const graphTargetIds = new Set([...overallByTarget.values()].map((connection) => connection.target.chunk_id));
    for (const embeddingConnection of input.embeddingOnly.overall) {
      if (graphTargetIds.has(embeddingConnection.target.chunk_id)) continue;
      mergeBestConnection(overallByTarget, embeddingOnlyConnection(embeddingConnection));
    }

    const bucketByChunk = new Map([...sourceBuckets.values()].map((bucket) => [bucket.chunk_id, bucket]));
    for (const embeddingBucket of input.embeddingOnly.source_chunks) {
      const bucket = bucketByChunk.get(embeddingBucket.chunk_id);
      if (!bucket) continue;
      const bucketGraphTargets = new Set(bucket.connections.map((connection) => connection.target.chunk_id));
      for (const embeddingConnection of embeddingBucket.connections) {
        if (bucketGraphTargets.has(embeddingConnection.target.chunk_id)) continue;
        bucket.connections.push(embeddingOnlyConnection(embeddingConnection));
      }
    }
  }

  const sourceChunks = [...sourceBuckets.values()].map((bucket) => ({
    ...bucket,
    connections: bucket.connections
      .sort((left, right) => {
        if (left.basis !== right.basis) return left.basis === 'graph' ? -1 : 1;
        return right.score - left.score || left.target.path.localeCompare(right.target.path);
      })
      .slice(0, graphLimitPerChunk + (input.options?.include_embedding_only ? (input.options.embedding_limit_per_chunk ?? 5) : 0)),
  }));

  return {
    overall: [...overallByTarget.values()]
      .sort((left, right) => {
        if (left.basis !== right.basis) return left.basis === 'graph' ? -1 : 1;
        return right.score - left.score || left.target.path.localeCompare(right.target.path);
      })
      .slice(0, limit),
    source_chunks: sourceChunks,
  };
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
    const sourceChunkId = stringScalar(sourceRow.id);
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
      const targetDocumentId = stringScalar(row.document_id);
      const targetChunkId = stringScalar(row.chunk_id);
      if (!targetDocumentId || !targetChunkId || targetDocumentId === input.sourceDocumentId) continue;
      const path = stringScalar(row.path);
      const title = stringScalar(row.title) || path;
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

async function buildEmbeddingDocumentConnections(input: {
  supabase: SupabaseClient;
  config: FlashQueryConfig;
  sourceDocumentId: string;
  options?: DocumentConnectionsOptions;
}): Promise<{ result?: DocumentConnectionsResult; error?: ErrorEnvelope }> {
  const limit = input.options?.limit ?? 50;
  const limitPerChunk = input.options?.limit_per_chunk ?? input.options?.embedding_limit_per_chunk ?? 5;
  if ((input.config.embeddings ?? []).length === 0) return { error: embeddingsNotConfigured() };
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

async function buildGraphDocumentConnections(input: {
  supabase: SupabaseClient;
  config: FlashQueryConfig;
  sourceDocumentId: string;
  options?: DocumentConnectionsOptions;
}): Promise<{ result?: DocumentConnectionsResult; error?: ErrorEnvelope }> {
  const { data: sourceRows, error: sourceError } = await input.supabase
    .from('fqc_chunks')
    .select('id, heading_path, breadcrumb')
    .eq('document_id', input.sourceDocumentId)
    .eq('instance_id', input.config.instance.id) as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

  if (sourceError) throw new Error(`Graph connection source chunk query failed: ${sourceError.message}`);
  const sourceChunkIds = (sourceRows ?? []).map((row) => stringScalar(row.id)).filter(Boolean);
  const sourceChunkMetadata = new Map<string, SourceChunkMetadata>();
  for (const row of sourceRows ?? []) {
    const id = stringScalar(row.id);
    if (!id) continue;
    sourceChunkMetadata.set(id, {
      ...(typeof row.heading_path === 'string' ? { heading_path: row.heading_path } : {}),
      ...(typeof row.breadcrumb === 'string' ? { breadcrumb: row.breadcrumb } : {}),
    });
  }

  if (sourceChunkIds.length === 0) {
    return {
      result: {
        overall: [],
        source_chunks: [],
      },
    };
  }

  const { data: edgeRows, error: edgeError } = await input.supabase
    .from('fqc_graph_edges')
    .select('id, source_chunk_id, target_chunk_id, relation, confidence_score, reasoning, status')
    .eq('instance_id', input.config.instance.id)
    .or(`source_chunk_id.in.(${sourceChunkIds.join(',')}),target_chunk_id.in.(${sourceChunkIds.join(',')})`) as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

  if (edgeError) throw new Error(`Graph connection edge query failed: ${edgeError.message}`);
  const edges: GraphEdgeForConnection[] = (edgeRows ?? []).map((row) => ({
    id: stringScalar(row.id),
    source_chunk_id: stringScalar(row.source_chunk_id),
    target_chunk_id: stringScalar(row.target_chunk_id),
    relation: stringScalar(row.relation),
    confidence_score: typeof row.confidence_score === 'number' ? row.confidence_score : Number(row.confidence_score ?? 0),
    reasoning: typeof row.reasoning === 'string' ? row.reasoning : null,
    status: stringScalar(row.status) || 'active',
  })).filter((edge) =>
    edge.id &&
    edge.source_chunk_id &&
    edge.target_chunk_id &&
    edge.relation &&
    Number.isFinite(edge.confidence_score)
  );

  const targetChunkIds = [...new Set(edges.flatMap((edge) => {
    const ids: string[] = [];
    if (sourceChunkIds.includes(edge.source_chunk_id)) ids.push(edge.target_chunk_id);
    if (sourceChunkIds.includes(edge.target_chunk_id)) ids.push(edge.source_chunk_id);
    return ids;
  }).filter((id) => !sourceChunkIds.includes(id)))];

  const targets = new Map<string, GraphTargetForConnection>();
  if (targetChunkIds.length > 0) {
    const { data: targetRows, error: targetError } = await input.supabase
      .from('fqc_chunks')
      .select('id, document_id, heading_path, content')
      .eq('instance_id', input.config.instance.id)
      .in('id', targetChunkIds) as {
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      };

    if (targetError) throw new Error(`Graph connection target chunk query failed: ${targetError.message}`);
    const documentIds = [...new Set((targetRows ?? []).map((row) => stringScalar(row.document_id)).filter(Boolean))];
    const docs = new Map<string, { path: string; title: string; status: string }>();
    if (documentIds.length > 0) {
      const { data: docRows, error: docError } = await input.supabase
        .from('fqc_documents')
        .select('id, path, title, status')
        .eq('instance_id', input.config.instance.id)
        .in('id', documentIds) as {
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        };

      if (docError) throw new Error(`Graph connection target document query failed: ${docError.message}`);
      for (const row of docRows ?? []) {
        const id = stringScalar(row.id);
        if (!id) continue;
        const path = stringScalar(row.path);
        docs.set(id, {
          path,
          title: stringScalar(row.title) || path,
          status: stringScalar(row.status) || 'active',
        });
      }
    }

    const nodeMetadata = new Map<string, { question_status: string | null; community_label: string | null }>();
    const { data: nodeRows, error: nodeError } = await input.supabase
      .from('fqc_graph_nodes')
      .select('chunk_id, question_status, community_label')
      .eq('instance_id', input.config.instance.id)
      .in('chunk_id', targetChunkIds) as {
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      };

    if (nodeError) throw new Error(`Graph connection target node query failed: ${nodeError.message}`);
    for (const row of nodeRows ?? []) {
      const chunkId = stringScalar(row.chunk_id);
      if (!chunkId) continue;
      nodeMetadata.set(chunkId, {
        question_status: typeof row.question_status === 'string' ? row.question_status : null,
        community_label: typeof row.community_label === 'string' ? row.community_label : null,
      });
    }

    for (const row of targetRows ?? []) {
      const chunkId = stringScalar(row.id);
      const documentId = stringScalar(row.document_id);
      const document = docs.get(documentId);
      if (!chunkId || !documentId || !document) continue;
      const metadata = nodeMetadata.get(chunkId);
      targets.set(chunkId, {
        chunk_id: chunkId,
        document_id: documentId,
        path: document.path,
        title: document.title,
        document_status: document.status,
        question_status: metadata?.question_status ?? null,
        community_label: metadata?.community_label ?? null,
        ...(typeof row.heading_path === 'string' ? { heading_path: row.heading_path } : {}),
        ...(typeof row.content === 'string' ? { content: row.content } : {}),
      });
    }
  }

  let embeddingOnly: DocumentConnectionsResult | undefined;
  if (input.options?.include_embedding_only === true) {
    const embeddingResult = await buildEmbeddingDocumentConnections({
      ...input,
      options: {
        ...input.options,
        limit_per_chunk: input.options.embedding_limit_per_chunk,
      },
    });
    if (embeddingResult.error) return { error: embeddingResult.error };
    embeddingOnly = embeddingResult.result;
  }

  return {
    result: buildGraphPrimaryConnections({
      sourceChunkIds,
      sourceChunkMetadata,
      edges,
      targets,
      embeddingOnly,
      options: input.options,
    }),
  };
}

export async function buildDocumentConnections(input: {
  supabase: SupabaseClient;
  config: FlashQueryConfig;
  sourceDocumentId: string;
  options?: DocumentConnectionsOptions;
}): Promise<{ result?: DocumentConnectionsResult; error?: ErrorEnvelope }> {
  if (isGraphAwareConnectionsOptions(input.options)) {
    return buildGraphDocumentConnections(input);
  }
  return buildEmbeddingDocumentConnections(input);
}
