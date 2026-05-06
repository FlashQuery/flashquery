import type { FinishReason } from '../constants/llm.js';
import type { InjectedReferenceMetadata } from './reference-resolver.js';

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
  injected_references?: InjectedReferenceMetadata[];
  prompt_chars?: number;
}

export interface CallModelEnvelope {
  response: string;
  messages: CallModelMessage[];
  metadata: CallModelMetadata;
}
