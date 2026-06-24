import type { GraphRuntimeConfig } from './config.js';
import { validateGraphEdgeDraft, type GraphEdgeDraft } from './edge-validation.js';
import {
  analyzedByModel,
  buildGraphLlmErrorEnvelope,
  graphEdgeTraceId,
  parseGraphEdgeClassificationPayload,
  resolveGraphLlmCompletion,
  type GraphLlmCompletionSuccess,
} from './llm-analysis.js';
import type { GraphEdgeClassificationDraft } from './schemas.js';
import type { GraphRelationDefinition } from './vocabulary.js';
import type { LlmClient } from '../llm/runtime-types.js';
import type { ErrorEnvelope } from '../mcp/utils/response-formats.js';

export interface AnalyzedGraphNodeRef {
  chunk_id: string;
  key_claims: string[] | null;
  analyzed_at: string | null;
  analyzed_by_model?: string | null;
}

export interface ClassifiedGraphEdgeDraft extends GraphEdgeDraft {
  sourceChunkId: string;
  targetChunkId: string;
  sourceClaimsReferenced: number[];
  targetClaimsReferenced: number[];
  model: string;
  metadata: NonNullable<GraphEdgeDraft['metadata']>;
}

interface EdgeInsertBuilder {
  select(columns?: string): PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>;
}

interface EdgeTable {
  insert(rows: GraphEdgeInsertRow[]): EdgeInsertBuilder;
}

interface EdgeSupabaseClient {
  from(table: 'fqc_graph_edges'): EdgeTable;
}

export interface GraphEdgeInsertRow {
  instance_id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  relation: string;
  confidence: 'INFERRED';
  confidence_score: number;
  reasoning: string | null;
  model: string;
  status: 'active';
  metadata: NonNullable<GraphEdgeDraft['metadata']>;
}

export type ClassifyGraphEdgeCandidateResult =
  | {
      status: 'classified';
      edges: ClassifiedGraphEdgeDraft[];
      llm: GraphLlmCompletionSuccess;
      written: number;
    }
  | {
      status: 'dependency_failed';
      failure: {
        code: 'graph_node_analysis_required';
        retryable: true;
        source_ready: boolean;
        target_ready: boolean;
        message: string;
      };
    }
  | { status: 'missing_resolver'; error: ErrorEnvelope }
  | { status: 'parse_failed'; error: ErrorEnvelope }
  | { status: 'validation_failed'; error: Error };

export async function classifyGraphEdgeCandidate(options: {
  instanceId: string;
  sourceChunkId: string;
  targetChunkId: string;
  sourceNode: AnalyzedGraphNodeRef | null;
  targetNode: AnalyzedGraphNodeRef | null;
  llmClient: LlmClient;
  graphConfig: GraphRuntimeConfig;
  relations: GraphRelationDefinition[];
  promptVersion: string;
  supabase?: EdgeSupabaseClient;
}): Promise<ClassifyGraphEdgeCandidateResult> {
  const sourceReady = isNodeAnalysisReady(options.sourceNode);
  const targetReady = isNodeAnalysisReady(options.targetNode);
  if (!sourceReady || !targetReady) {
    return {
      status: 'dependency_failed',
      failure: {
        code: 'graph_node_analysis_required',
        retryable: true,
        source_ready: sourceReady,
        target_ready: targetReady,
        message: 'Source and target graph node analysis must succeed before edge classification.',
      },
    };
  }

  const traceId = graphEdgeTraceId(options.sourceChunkId, options.targetChunkId);
  const llm = await resolveGraphLlmCompletion({
    llmClient: options.llmClient,
    graphConfig: options.graphConfig,
    traceId,
    messages: [
      {
        role: 'system',
        content:
          'Classify candidate graph relationships. Return only JSON matching the graph edge classification schema.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          source_chunk_id: options.sourceChunkId,
          target_chunk_id: options.targetChunkId,
          source_key_claims: options.sourceNode!.key_claims,
          target_key_claims: options.targetNode!.key_claims,
        }),
      },
    ],
  });

  if (!llm.ok) {
    return {
      status: 'missing_resolver',
      error: {
        error: llm.error,
        message: llm.message,
        details: { trace_id: llm.traceId, retryable: llm.retryable },
      },
    };
  }

  const parsed = parseGraphEdgeClassificationPayload(llm.text);
  if (!parsed.ok) {
    return {
      status: 'parse_failed',
      error: buildGraphLlmErrorEnvelope(parsed, {
        operation: 'graph_edge_classification',
        traceId,
      }),
    };
  }

  try {
    const edges = parsed.data.edges.map((edge) =>
      buildClassifiedEdge({
        edge,
        sourceChunkId: options.sourceChunkId,
        targetChunkId: options.targetChunkId,
        sourceClaimCount: options.sourceNode!.key_claims!.length,
        targetClaimCount: options.targetNode!.key_claims!.length,
        relations: options.relations,
        model: analyzedByModel(llm.modelName, options.promptVersion),
      })
    );
    if (!options.supabase || edges.length === 0) {
      return { status: 'classified', edges, llm, written: 0 };
    }

    const rows = edges.map((edge) => toGraphEdgeInsertRow(options.instanceId, edge));
    const { error } = await options.supabase.from('fqc_graph_edges').insert(rows).select('id');
    if (error) {
      return {
        status: 'validation_failed',
        error: new Error(error.message ?? 'Graph edge insert failed'),
      };
    }
    return { status: 'classified', edges, llm, written: rows.length };
  } catch (error: unknown) {
    return {
      status: 'validation_failed',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function toGraphEdgeInsertRow(
  instanceId: string,
  edge: ClassifiedGraphEdgeDraft
): GraphEdgeInsertRow {
  return {
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
  };
}

export function isNodeAnalysisReady(node: AnalyzedGraphNodeRef | null): node is AnalyzedGraphNodeRef & {
  key_claims: string[];
  analyzed_at: string;
} {
  return (
    node !== null &&
    typeof node.analyzed_at === 'string' &&
    node.analyzed_at.length > 0 &&
    Array.isArray(node.key_claims)
  );
}

function buildClassifiedEdge(options: {
  edge: GraphEdgeClassificationDraft;
  sourceChunkId: string;
  targetChunkId: string;
  sourceClaimCount: number;
  targetClaimCount: number;
  relations: GraphRelationDefinition[];
  model: string;
}): ClassifiedGraphEdgeDraft {
  const errors = [
    ...claimReferenceErrors(
      'source_claims_referenced',
      options.edge.source_claims_referenced,
      options.sourceClaimCount
    ),
    ...claimReferenceErrors(
      'target_claims_referenced',
      options.edge.target_claims_referenced,
      options.targetClaimCount
    ),
  ];

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const metadata = {
    ...options.edge.metadata,
    source_claims_referenced: options.edge.source_claims_referenced,
    target_claims_referenced: options.edge.target_claims_referenced,
  };
  const draft: GraphEdgeDraft = {
    relation: options.edge.relation,
    confidence: 'INFERRED',
    confidenceScore: options.edge.confidence_score,
    reasoning: options.edge.reasoning,
    metadata,
  };
  validateGraphEdgeDraft(draft, options.relations);

  return {
    ...draft,
    sourceChunkId: options.sourceChunkId,
    targetChunkId: options.targetChunkId,
    sourceClaimsReferenced: options.edge.source_claims_referenced,
    targetClaimsReferenced: options.edge.target_claims_referenced,
    model: options.model,
    metadata,
  };
}

function claimReferenceErrors(field: string, refs: number[], claimCount: number): string[] {
  const errors: string[] = [];
  if (refs.length === 0) {
    errors.push(`${field} must reference at least one key claim`);
  }
  for (const ref of refs) {
    if (ref >= claimCount) {
      errors.push(`${field} contains out-of-bounds claim index ${ref}`);
    }
  }
  return errors;
}
