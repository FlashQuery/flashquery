import type { DocumentChunkDiff } from '../embedding/chunks/store.js';
import type { GraphPgClient } from './structural.js';

const STRUCTURAL_RELATIONS = ['contains', 'references'] as const;

export interface ChangedChunkStalenessPlan {
  changedChunkIds: string[];
  markRelations: 'non_structural';
}

export interface SynchronousTier1RefreshPlan {
  refreshStructuralEdges: boolean;
  enqueueTier2Candidates: false;
  enqueueTier3Classification: false;
  changedChunkIds: string[];
}

export function buildChangedChunkStalenessPlan(diff: DocumentChunkDiff): ChangedChunkStalenessPlan {
  return {
    changedChunkIds: uniqueChunkIds(diff.changedChunks.map((chunk) => chunk.id)),
    markRelations: 'non_structural',
  };
}

export function planSynchronousTier1Refresh(diff: DocumentChunkDiff): SynchronousTier1RefreshPlan {
  const changedChunkIds = uniqueChunkIds(diff.changedChunks.map((chunk) => chunk.id));
  return {
    refreshStructuralEdges: diff.newChunks.length > 0 || changedChunkIds.length > 0 || diff.orphanChunks.length > 0,
    enqueueTier2Candidates: false,
    enqueueTier3Classification: false,
    changedChunkIds,
  };
}

export async function markChangedChunkGraphEdgesStale(
  client: GraphPgClient,
  options: { instanceId: string; diff: DocumentChunkDiff }
): Promise<ChangedChunkStalenessPlan> {
  const plan = buildChangedChunkStalenessPlan(options.diff);
  if (plan.changedChunkIds.length === 0) {
    return plan;
  }

  await client.query(
    `
    UPDATE fqc_graph_edges
    SET status = 'stale',
        updated_at = now()
    WHERE instance_id = $1
      AND status = 'active'
      AND (source_chunk_id = ANY($2::uuid[]) OR target_chunk_id = ANY($2::uuid[]))
      AND relation <> ALL($3::text[])
    `,
    [options.instanceId, plan.changedChunkIds, [...STRUCTURAL_RELATIONS]]
  );

  return plan;
}

function uniqueChunkIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
