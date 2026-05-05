import type { FinishReason } from '../constants/llm.js';

export interface LlmChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: LlmChatToolCall[];
}

export interface LlmChatResult {
  message: LlmChatMessage & { role: 'assistant' };
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
  injected_references?: Array<{ ref: string; chars: number; identifier?: string; resolved_to?: string }>;
  prompt_chars?: number;
}

export interface CallModelEnvelope {
  response: string;
  messages: CallModelMessage[];
  metadata: CallModelMetadata;
}
