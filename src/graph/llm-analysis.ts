import type { GraphRuntimeConfig } from './config.js';
import {
  GraphEdgeClassificationPayloadSchema,
  GraphNodeAnalysisPayloadSchema,
  type GraphEdgeClassificationPayload,
  type GraphNodeAnalysisPayload,
} from './schemas.js';
import { parseLlmJson } from '../llm/json-repair.js';
import type { ChatMessage, LlmClient, LlmCompletionResult } from '../llm/runtime-types.js';
import type { ErrorEnvelope } from '../mcp/utils/response-formats.js';

export type GraphLlmOperation =
  | 'graph_node_analysis'
  | 'graph_edge_classification';

export interface GraphLlmFailure {
  ok: false;
  retryable: true;
  failure: 'syntax' | 'schema';
  repaired: boolean;
  summary: string;
  issues?: Array<{ path: Array<string | number>; message: string }>;
}

export type GraphLlmParseResult<T> =
  | { ok: true; data: T; repaired: boolean }
  | GraphLlmFailure;

export interface GraphLlmCompletionSuccess {
  ok: true;
  text: string;
  modelName: string;
  providerName: string;
  purposeName: string;
  traceId: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export type GraphLlmCompletionResult =
  | GraphLlmCompletionSuccess
  | {
      ok: false;
      error: 'missing_graph_llm_resolver';
      message: string;
      retryable: false;
      traceId: string;
    };

export function parseGraphNodeAnalysisPayload(
  raw: string
): GraphLlmParseResult<GraphNodeAnalysisPayload> {
  return toGraphParseResult(parseLlmJson(raw, GraphNodeAnalysisPayloadSchema));
}

export function parseGraphEdgeClassificationPayload(
  raw: string
): GraphLlmParseResult<GraphEdgeClassificationPayload> {
  return toGraphParseResult(parseLlmJson(raw, GraphEdgeClassificationPayloadSchema));
}

export async function resolveGraphLlmCompletion(options: {
  llmClient: LlmClient;
  graphConfig: GraphRuntimeConfig;
  messages: ChatMessage[];
  traceId: string;
  parameters?: Record<string, unknown>;
}): Promise<GraphLlmCompletionResult> {
  const parameters = options.parameters ?? { temperature: 0 };
  const resolver = options.graphConfig.classificationPurpose ?? options.graphConfig.classificationModel;

  if (!resolver) {
    return {
      ok: false,
      error: 'missing_graph_llm_resolver',
      message: 'Graph classification requires graph.classification_purpose or graph.classification_model.',
      retryable: false,
      traceId: options.traceId,
    };
  }

  const completion = options.graphConfig.classificationPurpose
    ? await options.llmClient.completeByPurpose(
        options.graphConfig.classificationPurpose,
        options.messages,
        parameters,
        options.traceId
      )
    : await options.llmClient.complete(
        options.graphConfig.classificationModel!,
        options.messages,
        parameters,
        options.traceId
      );

  return {
    ok: true,
    ...completionFields(completion),
    purposeName: options.graphConfig.classificationPurpose ?? '_direct',
    traceId: options.traceId,
  };
}

export function graphNodeTraceId(chunkId: string): string {
  return `graph-node-analysis:${chunkId}`;
}

export function graphEdgeTraceId(sourceChunkId: string, targetChunkId: string): string {
  return `graph-edge-classification:${sourceChunkId}:${targetChunkId}`;
}

export function analyzedByModel(modelName: string, promptVersion: string): string {
  return `${modelName}@${promptVersion}`;
}

export function buildGraphLlmErrorEnvelope(
  failure: GraphLlmFailure,
  context: { operation: GraphLlmOperation; traceId?: string }
): ErrorEnvelope {
  return {
    error: 'invalid_graph_llm_json',
    message: 'Graph LLM response did not match the expected schema.',
    details: {
      operation: context.operation,
      failure: failure.failure,
      repaired: failure.repaired,
      summary: failure.summary,
      issues: failure.issues?.slice(0, 3),
      trace_id: context.traceId ?? null,
      retryable: failure.retryable,
    },
  };
}

function toGraphParseResult<T>(
  result: ReturnType<typeof parseLlmJson<T>>
): GraphLlmParseResult<T> {
  if (result.ok) {
    return { ok: true, data: result.data, repaired: result.repaired };
  }

  return {
    ok: false,
    retryable: true,
    failure: result.failure,
    repaired: result.repaired,
    summary: result.summary,
    ...(result.issues === undefined ? {} : { issues: result.issues }),
  };
}

function completionFields(completion: LlmCompletionResult): Omit<
  GraphLlmCompletionSuccess,
  'ok' | 'purposeName' | 'traceId'
> {
  return {
    text: completion.text,
    modelName: completion.modelName,
    providerName: completion.providerName,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    latencyMs: completion.latencyMs,
  };
}
