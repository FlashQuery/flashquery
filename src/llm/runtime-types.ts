import type { FlashQueryConfig } from '../config/types.js';
import type { LlmChatMessage, LlmChatResult } from './types.js';

export type ChatMessage = LlmChatMessage;

export interface LlmCompletionResult {
  text: string;
  modelName: string;
  providerName: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LlmClient {
  chat(
    modelName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmChatResult>;

  complete(
    modelName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmCompletionResult>;

  completeByPurpose(
    purposeName: string,
    messages: ChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmCompletionResult & { purposeName: string; fallbackPosition: number }>;

  chatByPurpose(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>,
    traceId?: string | null
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }>;

  chatByPurposeUnrecorded(
    purposeName: string,
    messages: LlmChatMessage[],
    parameters?: Record<string, unknown>
  ): Promise<LlmChatResult & { purposeName: string; fallbackPosition: number }>;

  getModelForPurpose(
    purposeName: string
  ): {
    modelName: string;
    providerName: string;
    config: NonNullable<FlashQueryConfig['llm']>['models'][number];
  } | null;
}
