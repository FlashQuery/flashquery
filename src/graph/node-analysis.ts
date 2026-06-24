import type { GraphRuntimeConfig } from './config.js';
import {
  analyzedByModel,
  buildGraphLlmErrorEnvelope,
  graphNodeTraceId,
  parseGraphNodeAnalysisPayload,
  resolveGraphLlmCompletion,
  type GraphLlmCompletionSuccess,
} from './llm-analysis.js';
import type { GraphNodeAnalysisPayload } from './schemas.js';
import type { LlmClient } from '../llm/runtime-types.js';
import type { ErrorEnvelope } from '../mcp/utils/response-formats.js';

export interface GraphNodeAnalysisRow {
  chunk_id: string;
  instance_id: string;
  provenance_basis: string | null;
  question_status: string | null;
  question_resolution: string | null;
  key_claims: string[];
  chunk_summary: string;
  certainty_level: string;
  staleness_risk: string;
  external_refs: string[];
  temporal_markers: string[];
  analyzed_content_hash: string;
  analyzed_by_model: string;
  analyzed_at: string;
  updated_at: string;
}

interface NodeUpsertBuilder {
  select(columns?: string): {
    single(): Promise<{ data: unknown; error: { message?: string } | null }>;
  };
}

interface NodeTable {
  upsert(row: GraphNodeAnalysisRow, options?: { onConflict?: string }): NodeUpsertBuilder;
}

interface NodeSupabaseClient {
  from(table: 'fqc_graph_nodes'): NodeTable;
}

export type AnalyzeGraphNodeResult =
  | { status: 'analyzed'; node: GraphNodeAnalysisRow; llm: GraphLlmCompletionSuccess }
  | { status: 'missing_resolver'; error: ErrorEnvelope }
  | { status: 'parse_failed'; error: ErrorEnvelope }
  | { status: 'write_failed'; error: ErrorEnvelope };

export async function analyzeGraphNode(options: {
  supabase: NodeSupabaseClient;
  instanceId: string;
  chunk: { id: string; content: string; contentHash: string };
  llmClient: LlmClient;
  graphConfig: GraphRuntimeConfig;
  promptVersion: string;
  analyzedAt?: Date;
}): Promise<AnalyzeGraphNodeResult> {
  const traceId = graphNodeTraceId(options.chunk.id);
  const llm = await resolveGraphLlmCompletion({
    llmClient: options.llmClient,
    graphConfig: options.graphConfig,
    traceId,
    messages: [
      {
        role: 'system',
        content:
          'Analyze one graph chunk. Return only JSON matching the graph node analysis schema.',
      },
      {
        role: 'user',
        content: options.chunk.content,
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

  const parsed = parseGraphNodeAnalysisPayload(llm.text);
  if (!parsed.ok) {
    return {
      status: 'parse_failed',
      error: buildGraphLlmErrorEnvelope(parsed, {
        operation: 'graph_node_analysis',
        traceId,
      }),
    };
  }

  const node = buildGraphNodeAnalysisRow({
    instanceId: options.instanceId,
    chunkId: options.chunk.id,
    payload: parsed.data,
    modelName: llm.modelName,
    promptVersion: options.promptVersion,
    analyzedAt: options.analyzedAt ?? new Date(),
    fallbackContentHash: options.chunk.contentHash,
  });

  const { error } = await options.supabase
    .from('fqc_graph_nodes')
    .upsert(node, { onConflict: 'chunk_id' })
    .select()
    .single();

  if (error) {
    return {
      status: 'write_failed',
      error: {
        error: 'graph_node_write_failed',
        message: error.message ?? 'Graph node analysis could not be written.',
        details: { chunk_id: options.chunk.id, trace_id: traceId },
      },
    };
  }

  return { status: 'analyzed', node, llm };
}

export function buildGraphNodeAnalysisRow(options: {
  instanceId: string;
  chunkId: string;
  payload: GraphNodeAnalysisPayload;
  modelName: string;
  promptVersion: string;
  analyzedAt: Date;
  fallbackContentHash: string;
}): GraphNodeAnalysisRow {
  const analyzedAt = options.analyzedAt.toISOString();
  return {
    chunk_id: options.chunkId,
    instance_id: options.instanceId,
    provenance_basis: options.payload.provenance_basis,
    question_status: options.payload.question_status,
    question_resolution: options.payload.question_resolution,
    key_claims: options.payload.key_claims,
    chunk_summary: options.payload.chunk_summary,
    certainty_level: options.payload.certainty_level,
    staleness_risk: options.payload.staleness_risk,
    external_refs: options.payload.external_refs,
    temporal_markers: options.payload.temporal_markers,
    analyzed_content_hash: options.payload.analyzed_content_hash || options.fallbackContentHash,
    analyzed_by_model: analyzedByModel(options.modelName, options.promptVersion),
    analyzed_at: analyzedAt,
    updated_at: analyzedAt,
  };
}
