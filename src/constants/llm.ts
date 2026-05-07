export const FINISH_REASONS = ['stop', 'tool_calls', 'length', 'content_filter', 'unknown'] as const;
export type FinishReason = typeof FINISH_REASONS[number];

export const AGENT_LOOP_STOP_REASONS = [
  'final_response',
  'max_iterations',
  'timeout',
  'max_cost',
  'max_tokens',
  'shutdown',
  'error',
] as const;
export type AgentLoopStopReason = typeof AGENT_LOOP_STOP_REASONS[number];

export const LLM_PARTICIPANT_NAMES = {
  host: 'host',
} as const;

export function isFinishReason(value: string): value is FinishReason {
  return FINISH_REASONS.includes(value as FinishReason);
}
