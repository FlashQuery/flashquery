import type { GraphRuntimeConfig } from './config.js';
import type { GraphRelationDefinition } from './vocabulary.js';

type SimilarityMode = 'threshold' | 'percentile';

export type GraphCandidateSkippedReason =
  | 'graph_disabled'
  | 'missing_embedding_name'
  | 'missing_classification_resolver'
  | 'missing_source_embedding'
  | 'same_document_excluded'
  | 'cap_exceeded'
  | 'instance_mismatch';

export interface GraphCandidate {
  sourceChunkId: string;
  targetChunkId: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  similarity: number;
  selectionMode: SimilarityMode;
}

export interface SelectGraphEdgeCandidatesResult {
  candidates: GraphCandidate[];
  skippedReasons: GraphCandidateSkippedReason[];
  warnings: string[];
  capExceededCount: number;
}

export interface SelectGraphEdgeCandidatesOptions {
  supabase: SupabaseLike;
  instanceId: string;
  changedChunkIds: string[];
  graph?: GraphRuntimeConfig;
  embeddingName?: string;
  relations?: GraphRelationDefinition[];
}

interface SourceChunkRow {
  id?: unknown;
  document_id?: unknown;
  instance_id?: unknown;
  [key: string]: unknown;
}

interface MatchChunkRow {
  chunk_id?: unknown;
  document_id?: unknown;
  instance_id?: unknown;
  similarity?: unknown;
}

interface QueryResult<Row = Record<string, unknown>> {
  data?: Row[] | Row | null;
  error?: { message: string } | null;
}

interface QueryBuilder<Row = Record<string, unknown>> extends PromiseLike<QueryResult<Row>> {
  eq(column: string, value: unknown): QueryBuilder<Row>;
  in?(column: string, values: unknown[]): QueryBuilder<Row>;
  not?(column: string, operator: string, value: unknown): QueryBuilder<Row>;
}

interface TableQuery {
  select<Row = Record<string, unknown>>(columns: string): QueryBuilder<Row>;
}

interface SupabaseLike {
  from(table: string): unknown;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

const DEFAULT_MATCH_COUNT = 50;

export async function selectGraphEdgeCandidates(
  options: SelectGraphEdgeCandidatesOptions
): Promise<SelectGraphEdgeCandidatesResult> {
  const graph = options.graph;
  const skippedReasons = new Set<GraphCandidateSkippedReason>();
  const warnings = new Set<string>();
  const embeddingName = options.embeddingName ?? graph?.embeddingName;

  if (graph?.enabled !== true) {
    skippedReasons.add('graph_disabled');
    warnings.add('graph classification skipped: graph disabled');
    return emptyResult(skippedReasons, warnings);
  }
  if (!embeddingName) {
    skippedReasons.add('missing_embedding_name');
    warnings.add('graph classification skipped: missing graph embedding');
    return emptyResult(skippedReasons, warnings);
  }
  if (!hasClassificationResolver(graph)) {
    skippedReasons.add('missing_classification_resolver');
    warnings.add('graph classification skipped: missing classification resolver');
    return emptyResult(skippedReasons, warnings);
  }

  const changedChunkIds = [...new Set(options.changedChunkIds)].sort();
  if (changedChunkIds.length === 0) {
    return emptyResult(skippedReasons, warnings);
  }

  const sourceRows = await loadSourceChunksWithEmbeddings(
    options.supabase,
    options.instanceId,
    embeddingName,
    changedChunkIds
  );
  const sourceById = new Map(sourceRows.map((row) => [stringScalar(row.id), row]));
  const candidates: GraphCandidate[] = [];
  const allowsSameDocument = relationVocabularyAllowsSameDocument(options.relations ?? []);
  const mode = graph.similarityMode ?? 'threshold';
  const threshold = graph.similarityThreshold ?? 0.7;
  const maxJobs = Math.max(0, graph.maxClassificationJobsPerSave ?? 25);

  for (const sourceChunkId of changedChunkIds) {
    const sourceRow = sourceById.get(sourceChunkId);
    const sourceDocumentId = stringScalar(sourceRow?.document_id);
    const sourceVector = sourceRow?.[embeddingColumnName(embeddingName)];
    if (!sourceRow || !sourceDocumentId || sourceVector === undefined || sourceVector === null) {
      skippedReasons.add('missing_source_embedding');
      warnings.add('graph classification skipped: missing chunk embeddings');
      continue;
    }

    const rows = await callChunkMatchRpc(options.supabase, {
      embeddingName,
      instanceId: options.instanceId,
      sourceVector,
      threshold,
      matchCount: Math.max(maxJobs + DEFAULT_MATCH_COUNT, DEFAULT_MATCH_COUNT),
    });

    const eligibleRows = rows
      .flatMap((row): GraphCandidate[] => {
        const targetChunkId = stringScalar(row.chunk_id);
        const targetDocumentId = stringScalar(row.document_id);
        const rowInstanceId = stringScalar(row.instance_id);
        const similarity = numericScalar(row.similarity);

        if (rowInstanceId && rowInstanceId !== options.instanceId) {
          skippedReasons.add('instance_mismatch');
          return [];
        }
        if (!targetChunkId || !targetDocumentId || !Number.isFinite(similarity)) {
          return [];
        }
        if (targetChunkId === sourceChunkId) {
          skippedReasons.add('same_document_excluded');
          return [];
        }
        if (targetDocumentId === sourceDocumentId && !allowsSameDocument) {
          skippedReasons.add('same_document_excluded');
          return [];
        }
        if (mode === 'threshold' && similarity < threshold) {
          return [];
        }
        return [
          {
            sourceChunkId,
            targetChunkId,
            sourceDocumentId,
            targetDocumentId,
            similarity,
            selectionMode: mode,
          },
        ];
      });

    candidates.push(...selectByMode(eligibleRows, graph));
  }

  const sorted = sortCandidates(dedupeCandidates(candidates));
  const capped = sorted.slice(0, maxJobs);
  const capExceededCount = Math.max(0, sorted.length - capped.length);
  if (capExceededCount > 0) {
    skippedReasons.add('cap_exceeded');
    warnings.add(
      `graph classification candidate cap exceeded: skipped ${capExceededCount} ${capExceededCount === 1 ? 'candidate' : 'candidates'}`
    );
  }

  return {
    candidates: capped,
    skippedReasons: [...skippedReasons],
    warnings: [...warnings],
    capExceededCount,
  };
}

function emptyResult(
  skippedReasons: Set<GraphCandidateSkippedReason>,
  warnings: Set<string>
): SelectGraphEdgeCandidatesResult {
  return {
    candidates: [],
    skippedReasons: [...skippedReasons],
    warnings: [...warnings],
    capExceededCount: 0,
  };
}

async function loadSourceChunksWithEmbeddings(
  supabase: SupabaseLike,
  instanceId: string,
  embeddingName: string,
  changedChunkIds: string[]
): Promise<SourceChunkRow[]> {
  const embeddingColumn = embeddingColumnName(embeddingName);
  let query = (supabase.from('fqc_chunks') as TableQuery)
    .select<SourceChunkRow>(`id, document_id, instance_id, ${embeddingColumn}`)
    .eq('instance_id', instanceId);

  if (query.in) {
    query = query.in('id', changedChunkIds);
  }
  if (query.not) {
    query = query.not(embeddingColumn, 'is', null);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`graph candidate source chunk query failed: ${error.message}`);
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const changed = new Set(changedChunkIds);
  return rows.filter((row) => changed.has(stringScalar(row.id)));
}

async function callChunkMatchRpc(
  supabase: SupabaseLike,
  input: {
    embeddingName: string;
    instanceId: string;
    sourceVector: unknown;
    threshold: number;
    matchCount: number;
  }
): Promise<MatchChunkRow[]> {
  const { data, error } = await supabase.rpc(`match_chunks_${input.embeddingName}`, {
    query_embedding: vectorRpcArgument(input.sourceVector),
    match_threshold: input.threshold,
    match_count: input.matchCount,
    filter_instance_id: input.instanceId,
    filter_tags: null,
    filter_tag_match: 'any',
    include_archived: false,
  });
  if (error) {
    throw new Error(`graph candidate chunk match failed: ${error.message}`);
  }
  return (Array.isArray(data) ? data : data ? [data] : []) as MatchChunkRow[];
}

function selectByMode(candidates: GraphCandidate[], graph: GraphRuntimeConfig): GraphCandidate[] {
  const mode = graph.similarityMode ?? 'threshold';
  if (mode !== 'percentile') {
    return candidates;
  }

  const sorted = sortCandidates(candidates);
  if (sorted.length === 0) return [];
  const percentile = clampPercentile(graph.similarityPercentile ?? 10);
  const targetCount = Math.max(1, Math.ceil(sorted.length * (percentile / 100)));
  const boundary = sorted[Math.min(targetCount, sorted.length) - 1]?.similarity;
  if (boundary === undefined) return [];
  return sorted.filter((candidate) => candidate.similarity >= boundary);
}

function dedupeCandidates(candidates: GraphCandidate[]): GraphCandidate[] {
  const byPair = new Map<string, GraphCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.sourceChunkId}:${candidate.targetChunkId}`;
    const existing = byPair.get(key);
    if (!existing || sortCandidates([candidate, existing])[0] === candidate) {
      byPair.set(key, candidate);
    }
  }
  return [...byPair.values()];
}

function sortCandidates(candidates: GraphCandidate[]): GraphCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.similarity !== left.similarity) return right.similarity - left.similarity;
    if (left.sourceChunkId !== right.sourceChunkId) return left.sourceChunkId.localeCompare(right.sourceChunkId);
    return left.targetChunkId.localeCompare(right.targetChunkId);
  });
}

function hasClassificationResolver(graph: GraphRuntimeConfig): boolean {
  return Boolean(graph.classificationPurpose || graph.classificationModel);
}

function relationVocabularyAllowsSameDocument(relations: GraphRelationDefinition[]): boolean {
  return relations.some(
    (relation) =>
      relation.category === 'classified' &&
      relation.detectionMethod === 'classified' &&
      metadataAllowsSameDocument(relation.metadataSchema)
  );
}

function metadataAllowsSameDocument(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return metadata.allow_same_document === true || metadata.allowSameDocument === true;
}

function embeddingColumnName(entryName: string): string {
  return `embedding_${entryName}`;
}

function vectorRpcArgument(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function stringScalar(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numericScalar(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function clampPercentile(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(100, Math.max(0, value));
}
