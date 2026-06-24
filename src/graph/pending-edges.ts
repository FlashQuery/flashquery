import type { GraphCandidate } from './candidates.js';

export interface EnqueuePendingEdgeCandidatesOptions {
  supabase: SupabaseLike;
  instanceId: string;
  candidates: GraphCandidate[];
  maxAttempts?: number;
  now?: () => Date;
}

export interface EnqueuePendingEdgeCandidatesResult {
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

interface QueryResult<Row = Record<string, unknown>> {
  data?: Row[] | Row | null;
  error?: { message: string } | null;
}

interface QueryBuilder<Row = Record<string, unknown>> extends PromiseLike<QueryResult<Row>> {
  eq(column: string, value: unknown): QueryBuilder<Row>;
  limit?(count: number): QueryBuilder<Row>;
}

interface TableQuery {
  select<Row = Record<string, unknown>>(columns?: string): QueryBuilder<Row>;
  upsert(payload: Record<string, unknown>, options?: Record<string, unknown>): QueryBuilder;
}

interface SupabaseLike {
  from(table: string): unknown;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export async function enqueuePendingEdgeCandidates(
  options: EnqueuePendingEdgeCandidatesOptions
): Promise<EnqueuePendingEdgeCandidatesResult> {
  const now = options.now ?? (() => new Date());
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const warnings = new Set<string>();
  const uniqueCandidates = dedupeCandidates(options.candidates);
  let inserted = 0;
  let skipped = Math.max(0, options.candidates.length - uniqueCandidates.length);

  for (const candidate of uniqueCandidates) {
    if (!candidate.sourceChunkId || !candidate.targetChunkId) {
      skipped++;
      warnings.add('graph pending edge skipped: missing candidate chunk id');
      continue;
    }
    if (
      await hasExistingDeadLetterJob(options.supabase, {
        instanceId: options.instanceId,
        sourceChunkId: candidate.sourceChunkId,
        targetChunkId: candidate.targetChunkId,
      })
    ) {
      skipped++;
      warnings.add('graph pending edge skipped: existing dead-letter job');
      continue;
    }

    const timestamp = now().toISOString();
    const payload = {
      instance_id: options.instanceId,
      source_chunk_id: candidate.sourceChunkId,
      target_chunk_id: candidate.targetChunkId,
      relation_hint: null,
      status: 'pending',
      attempt_count: 0,
      max_attempts: maxAttempts,
      result: {
        candidate: {
          source_document_id: candidate.sourceDocumentId,
          target_document_id: candidate.targetDocumentId,
          similarity: candidate.similarity,
          selection_mode: candidate.selectionMode,
        },
      },
      last_error: null,
      next_retry_at: timestamp,
      updated_at: timestamp,
    };

    const query = (options.supabase.from('fqc_pending_edges') as TableQuery).upsert(payload, {
      onConflict: 'instance_id,source_chunk_id,target_chunk_id',
    });
    const { error } = await query;
    if (error) {
      throw new Error(`graph pending edge upsert failed for instance ${options.instanceId}: ${error.message}`);
    }
    inserted++;
  }

  return {
    inserted,
    updated: 0,
    skipped,
    warnings: [...warnings],
  };
}

async function hasExistingDeadLetterJob(
  supabase: SupabaseLike,
  input: { instanceId: string; sourceChunkId: string; targetChunkId: string }
): Promise<boolean> {
  let query = (supabase.from('fqc_pending_edges') as TableQuery)
    .select('id, status')
    .eq('instance_id', input.instanceId)
    .eq('source_chunk_id', input.sourceChunkId)
    .eq('target_chunk_id', input.targetChunkId)
    .eq('status', 'dead_letter');

  if (query.limit) {
    query = query.limit(1);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`graph pending edge dead-letter check failed for instance ${input.instanceId}: ${error.message}`);
  }
  return Array.isArray(data) ? data.length > 0 : Boolean(data);
}

function dedupeCandidates(candidates: GraphCandidate[]): GraphCandidate[] {
  const byPair = new Map<string, GraphCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.sourceChunkId}:${candidate.targetChunkId}`;
    const existing = byPair.get(key);
    if (!existing || candidate.similarity > existing.similarity) {
      byPair.set(key, candidate);
    }
  }
  return [...byPair.values()].sort((left, right) => {
    if (left.sourceChunkId !== right.sourceChunkId) {
      return left.sourceChunkId.localeCompare(right.sourceChunkId);
    }
    return left.targetChunkId.localeCompare(right.targetChunkId);
  });
}
