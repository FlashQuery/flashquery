import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../config/types.js';

export interface GraphSummaryNodeInput {
  chunk_id: string;
  community_label: string | null;
  question_status: string | null;
}

export interface GraphSummaryEdgeInput {
  id: string;
  relation: string;
  status: string;
}

export interface GraphDocumentSummary {
  edge_count: number;
  edge_counts_by_relation: Record<string, number>;
  stale_edge_count: number;
  community_labels: string[];
  has_contradictions: boolean;
  has_open_questions: boolean;
  open_question_count: number;
}

function stringScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

export function buildGraphDocumentSummary(input: {
  nodes: GraphSummaryNodeInput[];
  edges: GraphSummaryEdgeInput[];
}): GraphDocumentSummary {
  const edgeCounts = new Map<string, number>();
  let staleEdgeCount = 0;
  for (const edge of input.edges) {
    edgeCounts.set(edge.relation, (edgeCounts.get(edge.relation) ?? 0) + 1);
    if (edge.status === 'stale') staleEdgeCount += 1;
  }

  const communityLabels = [...new Set(input.nodes
    .map((node) => node.community_label)
    .filter((label): label is string => typeof label === 'string' && label.length > 0))]
    .sort((left, right) => left.localeCompare(right));
  const openQuestionCount = input.nodes.filter((node) => node.question_status === 'open').length;
  const edgeCountsByRelation = Object.fromEntries(
    [...edgeCounts.entries()].sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    edge_count: input.edges.length,
    edge_counts_by_relation: edgeCountsByRelation,
    stale_edge_count: staleEdgeCount,
    community_labels: communityLabels,
    has_contradictions: edgeCounts.has('contradicts'),
    has_open_questions: openQuestionCount > 0,
    open_question_count: openQuestionCount,
  };
}

export async function buildGraphDocumentSummaryForDocument(input: {
  supabase: SupabaseClient;
  config: FlashQueryConfig;
  documentId: string;
}): Promise<GraphDocumentSummary> {
  const { data: chunkRows, error: chunkError } = await input.supabase
    .from('fqc_chunks')
    .select('id')
    .eq('instance_id', input.config.instance.id)
    .eq('document_id', input.documentId) as {
      data: Array<{ id: unknown }> | null;
      error: { message: string } | null;
    };

  if (chunkError) throw new Error(`Graph summary chunk query failed: ${chunkError.message}`);
  const chunkIds = (chunkRows ?? []).map((row) => stringScalar(row.id)).filter(Boolean);
  if (chunkIds.length === 0) {
    return buildGraphDocumentSummary({ nodes: [], edges: [] });
  }

  const { data: nodeRows, error: nodeError } = await input.supabase
    .from('fqc_graph_nodes')
    .select('chunk_id, community_label, question_status')
    .eq('instance_id', input.config.instance.id)
    .in('chunk_id', chunkIds) as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

  if (nodeError) throw new Error(`Graph summary node query failed: ${nodeError.message}`);

  const { data: edgeRows, error: edgeError } = await input.supabase
    .from('fqc_graph_edges')
    .select('id, relation, status')
    .eq('instance_id', input.config.instance.id)
    .or(`source_chunk_id.in.(${chunkIds.join(',')}),target_chunk_id.in.(${chunkIds.join(',')})`) as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

  if (edgeError) throw new Error(`Graph summary edge query failed: ${edgeError.message}`);

  return buildGraphDocumentSummary({
    nodes: (nodeRows ?? []).map((row) => ({
      chunk_id: stringScalar(row.chunk_id),
      community_label: typeof row.community_label === 'string' ? row.community_label : null,
      question_status: typeof row.question_status === 'string' ? row.question_status : null,
    })),
    edges: (edgeRows ?? []).map((row) => ({
      id: stringScalar(row.id),
      relation: stringScalar(row.relation),
      status: stringScalar(row.status) || 'active',
    })).filter((edge) => edge.id && edge.relation),
  });
}
