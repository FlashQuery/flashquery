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

export interface CompletedGraphEdgeAnalysis {
  sourceChunkId: string;
  targetChunkId: string;
  relation: string;
  confidence: 'INFERRED';
  confidenceScore: number;
  reasoning?: string | null;
  model?: string | null;
  metadata: Record<string, unknown>;
}

export interface StaleGraphEdgeCompletionResult {
  updated: number;
  replaced: number;
  deleted: number;
  inserted: number;
}

interface StaleGraphEdgeRow {
  id: string;
  relation: string;
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

export async function completeStaleGraphEdgeReanalysis(
  client: GraphPgClient,
  options: {
    instanceId: string;
    sourceChunkId: string;
    targetChunkId: string;
    edges: CompletedGraphEdgeAnalysis[];
  }
): Promise<StaleGraphEdgeCompletionResult> {
  const staleRows = await selectStaleRows(client, options);
  if (staleRows.length === 0 && options.edges.length === 0) {
    return { updated: 0, replaced: 0, deleted: 0, inserted: 0 };
  }

  if (options.edges.length === 0) {
    await deleteStaleRows(client, options);
    const deleted = staleRows.length;
    return { updated: 0, replaced: 0, deleted, inserted: 0 };
  }

  const matchingUpdates = options.edges.filter((edge) =>
    staleRows.some((row) => row.relation === edge.relation)
  );
  if (matchingUpdates.length > 0) {
    let updated = 0;
    for (const edge of matchingUpdates) {
      const stale = staleRows.find((row) => row.relation === edge.relation);
      if (!stale) continue;
      await updateStaleRowInPlace(client, options.instanceId, stale.id, edge);
      updated++;
    }
    return { updated, replaced: 0, deleted: 0, inserted: 0 };
  }

  const deleted = staleRows.length;
  if (deleted > 0) {
    await deleteStaleRows(client, options);
  }
  const inserted = await insertActiveRows(client, options.instanceId, options.edges);
  return {
    updated: 0,
    replaced: deleted > 0 ? inserted : 0,
    deleted,
    inserted,
  };
}

function uniqueChunkIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function selectStaleRows(
  client: GraphPgClient,
  options: { instanceId: string; sourceChunkId: string; targetChunkId: string }
): Promise<StaleGraphEdgeRow[]> {
  const result = await client.query<StaleGraphEdgeRow>(
    `
    SELECT id, relation
    FROM fqc_graph_edges
    WHERE instance_id = $1
      AND source_chunk_id = $2
      AND target_chunk_id = $3
      AND status = 'stale'
    `,
    [options.instanceId, options.sourceChunkId, options.targetChunkId]
  );
  return result.rows;
}

async function updateStaleRowInPlace(
  client: GraphPgClient,
  instanceId: string,
  staleEdgeId: string,
  edge: CompletedGraphEdgeAnalysis
): Promise<void> {
  await client.query(
    `
    UPDATE fqc_graph_edges
    SET status = 'active',
        relation = $2,
        confidence = 'INFERRED',
        confidence_score = $3,
        reasoning = $4,
        model = $5,
        metadata = $6::jsonb,
        updated_at = now()
    WHERE id = $7
      AND instance_id = $1
    `,
    [
      instanceId,
      edge.relation,
      edge.confidenceScore,
      edge.reasoning ?? null,
      edge.model ?? null,
      edge.metadata,
      staleEdgeId,
    ]
  );
}

async function deleteStaleRows(
  client: GraphPgClient,
  options: { instanceId: string; sourceChunkId: string; targetChunkId: string }
): Promise<void> {
  await client.query(
    `
    DELETE FROM fqc_graph_edges
    WHERE instance_id = $1
      AND source_chunk_id = $2
      AND target_chunk_id = $3
      AND status = 'stale'
    `,
    [options.instanceId, options.sourceChunkId, options.targetChunkId]
  );
}

async function insertActiveRows(
  client: GraphPgClient,
  instanceId: string,
  edges: CompletedGraphEdgeAnalysis[]
): Promise<number> {
  for (const edge of edges) {
    await client.query(
      `
      INSERT INTO fqc_graph_edges (
        instance_id,
        source_chunk_id,
        target_chunk_id,
        relation,
        confidence,
        confidence_score,
        reasoning,
        model,
        status,
        metadata,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'INFERRED', $5, $6, $7, 'active', $8::jsonb, now())
      `,
      [
        instanceId,
        edge.sourceChunkId,
        edge.targetChunkId,
        edge.relation,
        edge.confidenceScore,
        edge.reasoning ?? null,
        edge.model ?? null,
        edge.metadata,
      ]
    );
  }
  return edges.length;
}
