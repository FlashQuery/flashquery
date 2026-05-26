import type { AgentLoopStopReason, FinishReason } from '../constants/llm.js';
import type { InjectedReferenceMetadata } from './reference-metadata.js';

export interface LlmChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LlmSystemMessage {
  role: 'system';
  content?: string;
  name?: string;
  tool_call_id?: never;
  tool_calls?: never;
}

export interface LlmUserMessage {
  role: 'user';
  content?: string;
  name?: string;
  tool_call_id?: never;
  tool_calls?: never;
}

export interface LlmAssistantMessage {
  role: 'assistant';
  content?: string | null;
  name?: string;
  tool_call_id?: never;
  tool_calls?: LlmChatToolCall[];
}

export interface LlmToolMessage {
  role: 'tool';
  content?: string;
  name?: never;
  tool_call_id: string;
  tool_calls?: never;
}

export type LlmChatMessage = LlmSystemMessage | LlmUserMessage | LlmAssistantMessage | LlmToolMessage;

export interface LlmChatResult {
  message: LlmAssistantMessage;
  modelName: string;
  providerName: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  finishReason: FinishReason;
}

export type CallModelMessage = LlmChatMessage;

interface TraceCumulative {
  total_calls: number;
  total_tokens: { input: number; output: number };
  total_cost_usd: number;
  total_latency_ms: number;
}

export interface BrokeredToolCallTraceEntry {
  server: string;
  tool: string;
  count: number;
  cost: number;
}

export interface AgentLoopToolCallLogEntry {
  kind?: 'native' | 'template' | 'brokered';
  tool_call_id: string;
  tool_name: string;
  arguments?: Record<string, unknown>;
  status?: string;
  ok?: boolean;
  error_code?: string;
  result_summary?: string;
  tokens?: { input: number; output: number };
}

export interface AgentLoopCallLogEntry {
  iteration: number;
  model_name: string;
  provider_name: string;
  fallback_position: number;
  finish_reason: FinishReason;
  tokens: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
  assistant: {
    content: string | null;
  };
  tool_calls: AgentLoopToolCallLogEntry[];
  tool_call_id?: string;
  tool_name?: string;
  status?: string;
}

export interface AgentLoopAggregateUsage {
  tokens: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
}

export interface AgentLoopErrorDetail {
  type: string;
  message: string;
  status?: number;
  retry_after_ms?: number;
  purpose_name?: string;
  attempts?: Array<{
    model_name: string;
    provider_name: string;
    error_type: string;
    message: string;
    status?: number;
    retry_after_ms?: number;
  }>;
}

export interface AgentLoopMetadataTools {
  native_tool_names: string[];
  template_tool_names?: string[];
  diagnostics: Record<string, unknown>;
  stop_reason?: AgentLoopStopReason;
  error_detail?: AgentLoopErrorDetail;
  iterations?: number;
  calls_log?: AgentLoopCallLogEntry[];
  aggregate_usage?: AgentLoopAggregateUsage;
  estimate_ladder?: {
    input: string[];
    output: string[];
  };
}

export interface CallModelMetadata {
  resolver: 'model' | 'purpose';
  name: string;
  resolved_model_name: string;
  provider_name: string;
  fallback_position: number | null;
  tokens: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
  trace_id?: string;
  trace_cumulative?: TraceCumulative;
  tool_calls?: BrokeredToolCallTraceEntry[];
  injected_references?: InjectedReferenceMetadata[];
  prompt_chars?: number;
  tools?: AgentLoopMetadataTools;
}

export interface CallModelEnvelope {
  response: string;
  messages: CallModelMessage[];
  metadata: CallModelMetadata;
}
