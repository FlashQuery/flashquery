import { classifyGraphEdgeCandidate, type AnalyzedGraphNodeRef } from './edge-analysis.js';
import type { GraphRuntimeConfig } from './config.js';
import type { GraphRelationDefinition } from './vocabulary.js';
import type { ClassifiedGraphEdgeDraft, ClassifyGraphEdgeCandidateResult } from './edge-analysis.js';
import { completeStaleGraphEdgeReanalysis } from './staleness.js';
import type { GraphPgClient } from './structural.js';
import type { LlmClient } from '../llm/runtime-types.js';
import { logger as defaultLogger } from '../logging/logger.js';
import { getIsShuttingDown as defaultGetIsShuttingDown } from '../server/shutdown-state.js';

export type PendingGraphEdgeStatus = 'pending' | 'processing' | 'complete' | 'failed' | 'dead_letter';

export interface PendingGraphEdgeRow {
  id: string;
  instance_id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  relation_hint: string | null;
  status: PendingGraphEdgeStatus;
  attempt_count: number | null;
  max_attempts: number | null;
  result: Record<string, unknown> | null;
  last_error: string | null;
  next_retry_at: string | null;
}

export interface ProcessPendingGraphEdgesResult {
  selected: number;
  processed: number;
  succeeded: number;
  failed: number;
  dead_letter: number;
  skipped: number;
  warnings: string[];
}

export interface GraphDeadLetterJob {
  id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  remediation: string;
  result: Record<string, unknown> | null;
}

export interface ProcessPendingGraphEdgesOptions {
  supabase: SupabaseLike;
  instanceId: string;
  limit?: number;
  now?: () => Date;
  retryBackoffMs?: number;
  logger?: StructuredLogger;
  getIsShuttingDown?: () => boolean;
  classifyCandidate?: (row: PendingGraphEdgeRow, nodes: PendingGraphEdgeNodes) => Promise<WorkerClassifyResult>;
  llmClient?: LlmClient;
  graphConfig?: GraphRuntimeConfig;
  relations?: GraphRelationDefinition[];
  promptVersion?: string;
  graphClient?: GraphPgClient;
}

interface PendingGraphEdgeNodes {
  sourceNode: AnalyzedGraphNodeRef | null;
  targetNode: AnalyzedGraphNodeRef | null;
}

type WorkerClassifyResult =
  | Pick<Extract<ClassifyGraphEdgeCandidateResult, { status: 'classified' }>, 'status' | 'edges' | 'written'>
  | Exclude<ClassifyGraphEdgeCandidateResult, { status: 'classified' }>;

interface StructuredLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

interface QueryResult<Row = Record<string, unknown>> {
  data?: Row[] | Row | null;
  error?: { message?: string } | null;
}

interface QueryBuilder<Row = Record<string, unknown>> extends PromiseLike<QueryResult<Row>> {
  eq(column: string, value: unknown): QueryBuilder<Row>;
  or?(filter: string): QueryBuilder<Row>;
  order?(column: string, options?: Record<string, unknown>): QueryBuilder<Row>;
  limit?(count: number): QueryBuilder<Row>;
  single?(): PromiseLike<QueryResult<Row>>;
  select?(columns?: string): QueryBuilder<Row> | PromiseLike<QueryResult<Row>>;
}

interface TableQuery {
  select<Row = Record<string, unknown>>(columns?: string): QueryBuilder<Row>;
  update(payload: Record<string, unknown>): QueryBuilder;
  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>): QueryBuilder | { select(columns?: string): PromiseLike<QueryResult> };
  delete(): QueryBuilder;
}

interface SupabaseLike {
  from(table: string): unknown;
}

const DEFAULT_LIMIT = 25;
const DEFAULT_RETRY_BACKOFF_MS = 60_000;
const MAX_ERROR_LENGTH = 500;

export async function processPendingGraphEdges(
  options: ProcessPendingGraphEdgesOptions
): Promise<ProcessPendingGraphEdgesResult> {
  const log = options.logger ?? makeDefaultStructuredLogger();
  const now = options.now ?? (() => new Date());
  const getIsShuttingDown = options.getIsShuttingDown ?? defaultGetIsShuttingDown;
  const limit = Math.max(0, options.limit ?? DEFAULT_LIMIT);
  const result: ProcessPendingGraphEdgesResult = {
    selected: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    dead_letter: 0,
    skipped: 0,
    warnings: [],
  };

  if (limit === 0 || getIsShuttingDown()) {
    return result;
  }

  const rows = await selectEligiblePendingGraphEdges(options.supabase, options.instanceId, limit, now());
  result.selected = rows.length;

  for (const row of rows) {
    if (getIsShuttingDown()) {
      result.warnings.push('graph_pending_worker_shutdown');
      break;
    }

    result.processed++;
    try {
      assertInstance(row, options.instanceId);
      await markProcessing(options.supabase, row, options.instanceId, now());
      const nodes = await loadAnalyzedNodes(options.supabase, options.instanceId, row);
      const classified = await classifyPendingRow(options, row, nodes);

      if (classified.status === 'classified') {
        const staleCompletion = options.graphClient
          ? await completeStaleGraphEdgeReanalysis(options.graphClient, {
              instanceId: options.instanceId,
              sourceChunkId: row.source_chunk_id,
              targetChunkId: row.target_chunk_id,
              edges: classified.edges.map((edge) => ({
                sourceChunkId: edge.sourceChunkId,
                targetChunkId: edge.targetChunkId,
                relation: edge.relation,
                confidence: 'INFERRED',
                confidenceScore: edge.confidenceScore,
                reasoning: edge.reasoning,
                model: edge.model,
                metadata: edge.metadata,
              })),
            })
          : undefined;
        if (!options.graphClient && classified.edges.length > 0 && classified.written === 0) {
          await writeClassifiedEdges(options.supabase, options.instanceId, classified.edges);
        }
        await markComplete(options.supabase, row, options.instanceId, classified, now(), staleCompletion);
        result.succeeded++;
        continue;
      }

      if (classified.status === 'missing_resolver') {
        result.skipped++;
        result.warnings.push('graph_classification_skipped_missing_resolver');
      }

      throw classifyFailureError(classified);
    } catch (err) {
      result.failed++;
      const message = boundedErrorMessage(err);
      const deadLettered = await recordGraphFailure(options.supabase, {
        row,
        instanceId: options.instanceId,
        lastError: message,
        now: now(),
        retryBackoffMs: options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
      });
      if (deadLettered) {
        result.dead_letter++;
      }
      log.warn('pending_graph_edge_failed', {
        pending_id: row.id,
        source_chunk_id: row.source_chunk_id,
        target_chunk_id: row.target_chunk_id,
        dead_letter: deadLettered,
        error: message,
      });
    }
  }

  return result;
}

export async function listGraphDeadLetterJobs(options: {
  supabase: SupabaseLike;
  instanceId: string;
  limit?: number;
}): Promise<GraphDeadLetterJob[]> {
  let query = (options.supabase.from('fqc_pending_edges') as TableQuery)
    .select<PendingGraphEdgeRow>(
      'id, instance_id, source_chunk_id, target_chunk_id, relation_hint, status, attempt_count, max_attempts, result, last_error, next_retry_at'
    )
    .eq('instance_id', options.instanceId)
    .eq('status', 'dead_letter');

  if (query.order) {
    query = query.order('updated_at', { ascending: false });
  }
  if (query.limit) {
    query = query.limit(options.limit ?? DEFAULT_LIMIT);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`graph dead-letter query failed: ${error.message ?? 'unknown error'}`);
  }

  return rowsFrom<PendingGraphEdgeRow>(data).map((row) => ({
    id: row.id,
    source_chunk_id: row.source_chunk_id,
    target_chunk_id: row.target_chunk_id,
    attempt_count: row.attempt_count ?? 0,
    max_attempts: row.max_attempts ?? 1,
    last_error: row.last_error,
    remediation: remediationFromResult(row.result),
    result: row.result,
  }));
}

async function selectEligiblePendingGraphEdges(
  supabase: SupabaseLike,
  instanceId: string,
  limit: number,
  now: Date
): Promise<PendingGraphEdgeRow[]> {
  let query = (supabase.from('fqc_pending_edges') as TableQuery)
    .select<PendingGraphEdgeRow>(
      'id, instance_id, source_chunk_id, target_chunk_id, relation_hint, status, attempt_count, max_attempts, result, last_error, next_retry_at'
    )
    .eq('instance_id', instanceId);

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
    throw new Error(`graph pending edge query failed: ${error.message ?? 'unknown error'}`);
  }

  return rowsFrom<PendingGraphEdgeRow>(data)
    .filter((row) => row.instance_id === instanceId)
    .filter((row) => row.status === 'pending' || row.status === 'failed')
    .filter((row) => retryDue(row, now))
    .slice(0, limit);
}

async function loadAnalyzedNodes(
  supabase: SupabaseLike,
  instanceId: string,
  row: PendingGraphEdgeRow
): Promise<PendingGraphEdgeNodes> {
  const { data, error } = await (supabase.from('fqc_graph_nodes') as TableQuery)
    .select<AnalyzedGraphNodeRef>('chunk_id, key_claims, analyzed_at, analyzed_by_model')
    .eq('instance_id', instanceId);

  if (error) {
    throw new Error(`graph node dependency query failed: ${error.message ?? 'unknown error'}`);
  }

  const nodes = rowsFrom<AnalyzedGraphNodeRef>(data);
  return {
    sourceNode: nodes.find((node) => node.chunk_id === row.source_chunk_id) ?? null,
    targetNode: nodes.find((node) => node.chunk_id === row.target_chunk_id) ?? null,
  };
}

async function classifyPendingRow(
  options: ProcessPendingGraphEdgesOptions,
  row: PendingGraphEdgeRow,
  nodes: PendingGraphEdgeNodes
): Promise<WorkerClassifyResult> {
  if (options.classifyCandidate) {
    return await options.classifyCandidate(row, nodes);
  }

  if (!options.llmClient || !options.graphConfig || !options.relations || !options.promptVersion) {
    return {
      status: 'missing_resolver',
      error: {
        error: 'missing_graph_worker_dependencies',
        message: 'Graph pending worker requires LLM client, graph config, relations, and prompt version.',
        details: { retryable: false },
      },
    };
  }

  return await classifyGraphEdgeCandidate({
    instanceId: options.instanceId,
    sourceChunkId: row.source_chunk_id,
    targetChunkId: row.target_chunk_id,
    sourceNode: nodes.sourceNode,
    targetNode: nodes.targetNode,
    llmClient: options.llmClient,
    graphConfig: options.graphConfig,
    relations: options.relations,
    promptVersion: options.promptVersion,
    supabase: options.graphClient
      ? undefined
      : (options.supabase as Parameters<typeof classifyGraphEdgeCandidate>[0]['supabase']),
  });
}

async function markProcessing(
  supabase: SupabaseLike,
  row: PendingGraphEdgeRow,
  instanceId: string,
  now: Date
): Promise<void> {
  const { error } = await (supabase.from('fqc_pending_edges') as TableQuery)
    .update({ status: 'processing', updated_at: now.toISOString() })
    .eq('id', row.id)
    .eq('instance_id', instanceId);
  if (error) {
    throw new Error(`graph pending edge processing update failed: ${error.message ?? 'unknown error'}`);
  }
}

async function markComplete(
  supabase: SupabaseLike,
  row: PendingGraphEdgeRow,
  instanceId: string,
  classified: Extract<WorkerClassifyResult, { status: 'classified' }>,
  now: Date,
  staleCompletion?: Awaited<ReturnType<typeof completeStaleGraphEdgeReanalysis>>
): Promise<void> {
  const { error } = await (supabase.from('fqc_pending_edges') as TableQuery)
    .update({
      status: 'complete',
      result: {
        status: 'classified',
        edge_count: classified.edges.length,
        written: classified.written,
        stale_completion: staleCompletion ?? null,
      },
      last_error: null,
      next_retry_at: null,
      updated_at: now.toISOString(),
    })
    .eq('id', row.id)
    .eq('instance_id', instanceId);
  if (error) {
    throw new Error(`graph pending edge completion update failed: ${error.message ?? 'unknown error'}`);
  }
}

async function writeClassifiedEdges(
  supabase: SupabaseLike,
  instanceId: string,
  edges: ClassifiedGraphEdgeDraft[]
): Promise<void> {
  const rows = edges.map((edge) => ({
    instance_id: instanceId,
    source_chunk_id: edge.sourceChunkId,
    target_chunk_id: edge.targetChunkId,
    relation: edge.relation,
    confidence: 'INFERRED',
    confidence_score: edge.confidenceScore,
    reasoning: edge.reasoning ?? null,
    model: edge.model,
    status: 'active',
    metadata: edge.metadata,
  }));
  const insert = (supabase.from('fqc_graph_edges') as TableQuery).insert(rows);
  const result = 'select' in insert ? await insert.select('id') : await insert;
  if (result.error) {
    throw new Error(`graph edge insert failed: ${result.error.message ?? 'unknown error'}`);
  }
}

async function recordGraphFailure(
  supabase: SupabaseLike,
  options: {
    row: PendingGraphEdgeRow;
    instanceId: string;
    lastError: string;
    now: Date;
    retryBackoffMs: number;
  }
): Promise<boolean> {
  const nextAttemptCount = (options.row.attempt_count ?? 0) + 1;
  const maxAttempts = Math.max(1, options.row.max_attempts ?? 1);
  const deadLetter = nextAttemptCount >= maxAttempts;
  const payload = deadLetter
    ? {
        status: 'dead_letter',
        attempt_count: nextAttemptCount,
        last_error: options.lastError,
        next_retry_at: null,
        result: {
          status: 'dead_letter',
          remediation: 'Review graph configuration, source/target node analysis, and relation vocabulary before retrying manually.',
          last_error: options.lastError,
        },
        updated_at: options.now.toISOString(),
      }
    : {
        status: 'pending',
        attempt_count: nextAttemptCount,
        last_error: options.lastError,
        next_retry_at: new Date(options.now.getTime() + options.retryBackoffMs).toISOString(),
        result: {
          status: 'retry_scheduled',
          last_error: options.lastError,
        },
        updated_at: options.now.toISOString(),
      };

  const { error } = await (supabase.from('fqc_pending_edges') as TableQuery)
    .update(payload)
    .eq('id', options.row.id)
    .eq('instance_id', options.instanceId);
  if (error) {
    throw new Error(`graph pending edge failure update failed: ${error.message ?? 'unknown error'}`);
  }
  return deadLetter;
}

function classifyFailureError(result: Exclude<WorkerClassifyResult, { status: 'classified' }>): Error {
  if ('error' in result) {
    if (result.error instanceof Error) return result.error;
    return new Error(result.error.message);
  }
  return new Error(result.failure.message);
}

function retryDue(row: PendingGraphEdgeRow, now: Date): boolean {
  if (!row.next_retry_at) return true;
  return new Date(row.next_retry_at).getTime() <= now.getTime();
}

function rowsFrom<Row>(data: Row[] | Row | null | undefined): Row[] {
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

function assertInstance(row: PendingGraphEdgeRow, instanceId: string): void {
  if (row.instance_id !== instanceId) {
    throw new Error('graph pending edge row instance mismatch');
  }
}

function remediationFromResult(result: Record<string, unknown> | null): string {
  const remediation = result?.remediation;
  return typeof remediation === 'string' && remediation.trim().length > 0
    ? remediation
    : 'Review graph configuration, source/target node analysis, and relation vocabulary before retrying manually.';
}

function boundedErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

function makeDefaultStructuredLogger(): StructuredLogger {
  return {
    warn: (message, fields) => defaultLogger?.warn?.(`${message}: ${JSON.stringify(fields ?? {})}`),
    error: (message, fields) => defaultLogger?.error?.(`${message}: ${JSON.stringify(fields ?? {})}`),
  };
}
