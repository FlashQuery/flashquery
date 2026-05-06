import { computeCost, recordLlmUsage as writeLlmUsage } from './cost-tracker.js';
import { dispatchToolCalls } from './tool-dispatcher.js';
import type { AgentLoopStopReason } from '../constants/llm.js';
import type { LlmUsageRecord } from './cost-tracker.js';
import type { LlmChatMessage, LlmChatResult, LlmChatToolCall, CallModelEnvelope, AgentLoopCallLogEntry } from './types.js';
import type { NativeToolCallLogEntry, NativeToolDispatchContext } from './tool-dispatcher.js';
import type { NativeToolDefinition, OpenAiToolDefinition, ToolRegistryAssembly } from './tool-registry.js';

export const DEFAULT_OUTPUT_TOKEN_ESTIMATE = 2048;

type ChatByPurpose = (
  purposeName: string,
  messages: LlmChatMessage[],
  parameters?: Record<string, unknown>
) => Promise<LlmChatResult & { purposeName?: string; fallbackPosition: number }>;

type LegacyChat = (
  messages: LlmChatMessage[],
  parameters?: Record<string, unknown>
) => Promise<LlmChatResult & { fallbackPosition?: number }>;

type ToolDispatcher = (options: {
  toolCalls: LlmChatToolCall[];
  catalog: NativeToolDefinition[] | Map<string, NativeToolDefinition>;
  nativeToolNames: readonly string[];
  dispatchContext: NativeToolDispatchContext;
  dispatchPolicy?: 'Promise.allSettled';
}) => Promise<{ messages: LlmChatMessage[]; logEntries: NativeToolCallLogEntry[] }>;

interface ModelCost {
  name: string;
  providerName?: string;
  costPerMillion?: { input: number; output: number };
}

interface LoggerLike {
  debug?: (message: string, context?: Record<string, unknown>) => void;
  warn?: (message: string, context?: Record<string, unknown>) => void;
  error?: (message: string, context?: Record<string, unknown>) => void;
}

export interface ExecuteAgentLoopOptions {
  instanceId?: string;
  purposeName: string;
  initialMessages: LlmChatMessage[];
  providerParameters?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  purposeDefaults?: Record<string, unknown>;
  toolRegistry?: ToolRegistryAssembly;
  nativeToolCatalog?: NativeToolDefinition[] | Map<string, NativeToolDefinition>;
  nativeToolNames?: string[];
  providerTools?: OpenAiToolDefinition[] | Array<Record<string, unknown>>;
  chatByPurpose?: ChatByPurpose;
  chat?: LegacyChat;
  toolDispatcher?: ToolDispatcher;
  traceId?: string | null;
  modelCostLookup?: (modelName: string) => ModelCost | undefined;
  models?: ModelCost[];
  initialModelName?: string | null;
  recordUsage?: (record: LlmUsageRecord) => void;
  now?: () => number;
  getIsShuttingDown?: () => boolean;
  shutdownSignal?: AbortSignal;
  logger?: LoggerLike;
  resultSummaryChars?: number;
  callerProvidedTools?: unknown[];
  templatesDefaultAccess?: string;
  forceStopBeforeFirstCall?: AgentLoopStopReason;
  forceStopBeforeNextCall?: AgentLoopStopReason;
  forceStopAfterDispatch?: AgentLoopStopReason;
  estimateProbe?: { input: string[]; output: string[] };
}

interface LoopTotals {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

function numberParameter(parameters: Record<string, unknown>, key: string, fallback?: number): number | undefined {
  const value = parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function loopParameter(
  parameters: Record<string, unknown>,
  purposeDefaults: Record<string, unknown>,
  key: string,
  fallback?: number
): number | undefined {
  return numberParameter(parameters, key) ?? numberParameter(purposeDefaults, key, fallback);
}

function hasVisibleTools(options: ExecuteAgentLoopOptions, nativeToolNames: string[], providerTools: unknown[]): boolean {
  return nativeToolNames.length > 0 || providerTools.length > 0 || options.templatesDefaultAccess === 'all';
}

function getNativeToolNames(options: ExecuteAgentLoopOptions): string[] {
  return options.toolRegistry?.nativeToolNames ?? options.nativeToolNames ?? [];
}

function getProviderTools(options: ExecuteAgentLoopOptions): Array<Record<string, unknown>> {
  return (options.toolRegistry?.providerTools ?? options.providerTools ?? []) as Array<Record<string, unknown>>;
}

function messageChars(messages: LlmChatMessage[]): number {
  return JSON.stringify(messages).length;
}

function estimateInputTokens(messages: LlmChatMessage[], completedIterations: number, totals: LoopTotals): number {
  if (messages.length > 0) return Math.ceil(messageChars(messages) / 4);
  if (completedIterations > 0) return Math.ceil(totals.inputTokens / completedIterations);
  return 0;
}

function estimateOutputTokens(parameters: Record<string, unknown>, purposeDefaults: Record<string, unknown>): number {
  const requested = numberParameter(parameters, 'max_tokens');
  if (requested !== undefined) return requested;
  const purposeDefault = numberParameter(purposeDefaults, 'max_tokens');
  if (purposeDefault !== undefined) return purposeDefault;
  return DEFAULT_OUTPUT_TOKEN_ESTIMATE;
}

function summarizeToolResult(entry: NativeToolCallLogEntry, maxChars: number): NativeToolCallLogEntry {
  if (!entry.result_summary || entry.result_summary.length <= maxChars) return entry;
  return { ...entry, result_summary: `${entry.result_summary.slice(0, maxChars)}...` };
}

function findModelCost(options: ExecuteAgentLoopOptions, modelName: string): ModelCost | undefined {
  return options.modelCostLookup?.(modelName) ?? options.models?.find((model) => model.name === modelName);
}

function costForResult(options: ExecuteAgentLoopOptions, result: LlmChatResult): number {
  const model = findModelCost(options, result.modelName);
  return model?.costPerMillion ? computeCost(result.inputTokens, result.outputTokens, model.costPerMillion) : 0;
}

function estimatedCost(options: ExecuteAgentLoopOptions, modelName: string | null, inputTokens: number, outputTokens: number): number {
  if (!modelName) return 0;
  const model = findModelCost(options, modelName);
  return model?.costPerMillion ? computeCost(inputTokens, outputTokens, model.costPerMillion) : 0;
}

function hasTimedOut(now: () => number, deadline: number): boolean {
  return now() >= deadline;
}

function getAbortStopReason(signal: AbortSignal): AgentLoopStopReason | null {
  if (!signal.aborted) return null;
  const reason = signal.reason as unknown;
  if (reason === 'timeout' || reason === 'shutdown') return reason;
  if (reason instanceof Error && /timeout/i.test(reason.message)) return 'timeout';
  if (reason instanceof Error && /shutdown/i.test(reason.message)) return 'shutdown';
  return 'shutdown';
}

function makeAbortController(options: ExecuteAgentLoopOptions, deadline: number): AbortController {
  const controller = new AbortController();
  const shutdownSignal = options.shutdownSignal;

  if (shutdownSignal?.aborted) {
    controller.abort('shutdown');
  } else {
    shutdownSignal?.addEventListener('abort', () => controller.abort('shutdown'), { once: true });
  }

  const remaining = deadline - (options.now?.() ?? Date.now());
  if (remaining <= 0) {
    controller.abort('timeout');
  } else {
    const timeout = setTimeout(() => controller.abort('timeout'), remaining);
    timeout.unref?.();
  }

  return controller;
}

function normalizeStopReason(value: unknown): AgentLoopStopReason | null {
  if (
    value === 'final_response' ||
    value === 'max_iterations' ||
    value === 'timeout' ||
    value === 'max_cost' ||
    value === 'max_tokens' ||
    value === 'shutdown' ||
    value === 'error'
  ) {
    return value;
  }
  return null;
}

function shouldStopBeforeCall(
  options: ExecuteAgentLoopOptions,
  messages: LlmChatMessage[],
  totals: LoopTotals,
  iterations: number,
  lastModelName: string | null,
  now: () => number,
  deadline: number,
  parameters: Record<string, unknown>,
  purposeDefaults: Record<string, unknown>,
  maxIterations: number,
  maxTokensBudget?: number,
  maxCostUsd?: number
): AgentLoopStopReason | null {
  const forcedFirst = iterations === 0 ? normalizeStopReason(options.forceStopBeforeFirstCall) : null;
  if (forcedFirst) return forcedFirst;
  const forcedNext = iterations > 0 ? normalizeStopReason(options.forceStopBeforeNextCall) : null;
  if (forcedNext) return forcedNext;
  if (options.getIsShuttingDown?.() === true || options.shutdownSignal?.aborted === true) return 'shutdown';
  if (hasTimedOut(now, deadline)) return 'timeout';
  if (iterations >= maxIterations) return 'max_iterations';

  const inputEstimate = estimateInputTokens(messages, iterations, totals);
  const outputEstimate = estimateOutputTokens(parameters, purposeDefaults);
  const tokenEstimate = inputEstimate + outputEstimate;
  if (maxTokensBudget !== undefined && totals.inputTokens + totals.outputTokens + tokenEstimate > maxTokensBudget) {
    return 'max_tokens';
  }

  const costEstimate = estimatedCost(options, lastModelName, inputEstimate, outputEstimate);
  if (maxCostUsd !== undefined && totals.costUsd + costEstimate > maxCostUsd) return 'max_cost';

  return null;
}

function makeEnvelope(
  options: ExecuteAgentLoopOptions,
  messages: LlmChatMessage[],
  callsLog: AgentLoopCallLogEntry[],
  stopReason: AgentLoopStopReason,
  totals: LoopTotals,
  latestAssistantText: string,
  resultForMetadata: (LlmChatResult & { fallbackPosition?: number }) | null
): CallModelEnvelope & { mode?: string; usageRow?: Partial<LlmUsageRecord> } {
  const resolvedModelName = resultForMetadata?.modelName ?? '';
  const providerName = resultForMetadata?.providerName ?? '';
  const fallbackPosition = resultForMetadata?.fallbackPosition ?? null;

  return {
    response: stopReason === 'final_response' ? latestAssistantText : latestAssistantText,
    messages,
    metadata: {
      resolver: 'purpose',
      name: options.purposeName,
      resolved_model_name: resolvedModelName,
      provider_name: providerName,
      fallback_position: fallbackPosition,
      tokens: { input: totals.inputTokens, output: totals.outputTokens },
      cost_usd: totals.costUsd,
      latency_ms: totals.latencyMs,
      ...(options.traceId ? { trace_id: options.traceId } : {}),
      tools: {
        native_tool_names: getNativeToolNames(options),
        diagnostics: options.toolRegistry?.diagnostics ?? {},
        stop_reason: stopReason,
        iterations: callsLog.length,
        calls_log: callsLog,
        aggregate_usage: {
          tokens: { input: totals.inputTokens, output: totals.outputTokens },
          cost_usd: totals.costUsd,
          latency_ms: totals.latencyMs,
        },
        ...(options.estimateProbe ? { estimate_ladder: options.estimateProbe } : {}),
      },
    },
    usageRow: {},
  };
}

function recordAggregateUsage(
  options: ExecuteAgentLoopOptions,
  resultForMetadata: (LlmChatResult & { fallbackPosition?: number }) | null,
  totals: LoopTotals
): Partial<LlmUsageRecord> {
  if (!resultForMetadata) return {};
  const record: LlmUsageRecord = {
    instanceId: options.instanceId ?? '',
    purposeName: options.purposeName,
    modelName: resultForMetadata.modelName,
    providerName: resultForMetadata.providerName,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costUsd: totals.costUsd,
    latencyMs: totals.latencyMs,
    fallbackPosition: resultForMetadata.fallbackPosition ?? null,
    traceId: options.traceId ?? null,
  };
  (options.recordUsage ?? writeLlmUsage)(record);
  return record;
}

function toAssistantText(result: LlmChatResult): string {
  return typeof result.message.content === 'string' ? result.message.content : '';
}

export async function executeAgentLoop(options: ExecuteAgentLoopOptions): Promise<CallModelEnvelope & { mode?: string; usageRow?: Partial<LlmUsageRecord> }> {
  if ((options.callerProvidedTools?.length ?? 0) > 0) {
    // Public calls reject Mode 3 at the MCP boundary; this is a defense-in-depth
    // guard for direct executor callers.
    throw Object.assign(new Error('Mode 3 caller-provided tools are deferred.'), {
      code: 'mode_3_deferred',
      message: 'Mode 3 caller-provided tools are deferred; remove caller-provided tools for FlashQuery-managed Mode 2.',
    });
  }

  const nativeToolNames = getNativeToolNames(options);
  const providerTools = getProviderTools(options);
  if (!hasVisibleTools(options, nativeToolNames, providerTools)) {
    return {
      mode: 'mode_1',
      response: '',
      messages: options.initialMessages,
      metadata: {
        resolver: 'purpose',
        name: options.purposeName,
        resolved_model_name: '',
        provider_name: '',
        fallback_position: null,
        tokens: { input: 0, output: 0 },
        cost_usd: 0,
        latency_ms: 0,
      },
    };
  }

  const parameters = options.providerParameters ?? options.parameters ?? {};
  const purposeDefaults = options.purposeDefaults ?? {};
  const timeoutMs = loopParameter(parameters, purposeDefaults, 'timeout_ms', 30_000) ?? 30_000;
  const maxIterations = loopParameter(parameters, purposeDefaults, 'max_iterations', 10) ?? 10;
  const maxTokensBudget = loopParameter(parameters, purposeDefaults, 'max_tokens_budget');
  const maxCostUsd = loopParameter(parameters, purposeDefaults, 'max_cost_usd');
  const resultSummaryChars = loopParameter(parameters, purposeDefaults, 'result_summary_chars', options.resultSummaryChars ?? 200) ?? 200;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  const abortController = makeAbortController(options, deadline);
  const messages: LlmChatMessage[] = [...options.initialMessages];
  const callsLog: AgentLoopCallLogEntry[] = [];
  const totals: LoopTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 };
  const chatByPurpose: ChatByPurpose = options.chatByPurpose ?? (async (_purposeName, loopMessages, loopParameters) => {
    if (!options.chat) throw new Error('Agent loop requires chatByPurpose or chat.');
    const result = await options.chat(loopMessages, loopParameters);
    return { ...result, fallbackPosition: result.fallbackPosition ?? 1 };
  });
  const dispatcher = options.toolDispatcher ?? dispatchToolCalls;
  let firstSuccessfulResult: (LlmChatResult & { fallbackPosition?: number }) | null = null;
  let latestAssistantText = '';
  let lastModelName: string | null = options.initialModelName ?? options.models?.[0]?.name ?? null;

  while (true) {
    const stopBefore = shouldStopBeforeCall(
      options,
      messages,
      totals,
      callsLog.length,
      lastModelName,
      now,
      deadline,
      parameters,
      purposeDefaults,
      maxIterations,
      maxTokensBudget,
      maxCostUsd
    );
    if (stopBefore) {
      const envelope = makeEnvelope(options, messages, callsLog, stopBefore, totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }

    let result: LlmChatResult & { fallbackPosition?: number };
    try {
      result = await chatByPurpose(options.purposeName, messages, {
        ...parameters,
        ...(providerTools.length > 0 ? { tools: providerTools } : {}),
        signal: abortController.signal,
      });
    } catch {
      const stopReason = getAbortStopReason(abortController.signal) ?? 'error';
      const envelope = makeEnvelope(options, messages, callsLog, stopReason, totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }

    if (firstSuccessfulResult === null) firstSuccessfulResult = result;
    lastModelName = result.modelName;
    const costUsd = costForResult(options, result);
    totals.inputTokens += result.inputTokens;
    totals.outputTokens += result.outputTokens;
    totals.costUsd += costUsd;
    totals.latencyMs += result.latencyMs;
    latestAssistantText = toAssistantText(result);

    const assistantMessage: LlmChatMessage = {
      ...result.message,
      name: result.message.name ?? options.purposeName,
    };
    messages.push(assistantMessage);
    const toolCalls = assistantMessage.tool_calls ?? [];
    callsLog.push({
      iteration: callsLog.length + 1,
      model_name: result.modelName,
      provider_name: result.providerName,
      fallback_position: result.fallbackPosition ?? 1,
      finish_reason: result.finishReason,
      tokens: { input: result.inputTokens, output: result.outputTokens },
      cost_usd: costUsd,
      latency_ms: result.latencyMs,
      assistant: { content: assistantMessage.content ?? null },
      tool_calls: toolCalls.map((toolCall) => ({
        tool_call_id: toolCall.id,
        tool_name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })),
    });

    if (maxCostUsd !== undefined && totals.costUsd > maxCostUsd) {
      const envelope = makeEnvelope(options, messages, callsLog, 'max_cost', totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }

    if (toolCalls.length === 0 || result.finishReason !== 'tool_calls') {
      const envelope = makeEnvelope(options, messages, callsLog, 'final_response', totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }

    if (options.getIsShuttingDown?.() === true || options.shutdownSignal?.aborted === true) {
      const envelope = makeEnvelope(options, messages, callsLog, 'shutdown', totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }
    if (hasTimedOut(now, deadline)) {
      const envelope = makeEnvelope(options, messages, callsLog, 'timeout', totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }

    const dispatchResult = await dispatcher({
      toolCalls,
      catalog: options.nativeToolCatalog ?? [],
      nativeToolNames,
      dispatchContext: {
        signal: abortController.signal,
        traceId: options.traceId ?? null,
        instanceId: options.instanceId ?? '',
        logger: options.logger,
      },
      dispatchPolicy: 'Promise.allSettled',
    });
    messages.push(...dispatchResult.messages.map((message) => (
      message.role === 'tool' ? { ...message, name: undefined } : message
    )));
    const summarizedEntries = dispatchResult.logEntries.map((entry) =>
      summarizeToolResult(entry, resultSummaryChars)
    );
    callsLog[callsLog.length - 1].tool_calls = summarizedEntries;
    const firstToolEntry = summarizedEntries[0];
    if (firstToolEntry) {
      callsLog[callsLog.length - 1].tool_call_id = firstToolEntry.tool_call_id;
      callsLog[callsLog.length - 1].tool_name = firstToolEntry.tool_name;
      callsLog[callsLog.length - 1].status = firstToolEntry.status;
    }

    const forcedAfterDispatch = normalizeStopReason(options.forceStopAfterDispatch);
    const dispatchTimedOut = dispatchResult.logEntries.some((entry) => entry.error_code === 'timeout' || entry.status === 'timeout');
    const abortStopReason = getAbortStopReason(abortController.signal);
    if (forcedAfterDispatch || dispatchTimedOut || abortStopReason === 'timeout') {
      const envelope = makeEnvelope(options, messages, callsLog, forcedAfterDispatch ?? 'timeout', totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }
    if (options.getIsShuttingDown?.() === true || options.shutdownSignal?.aborted === true || abortStopReason === 'shutdown') {
      const envelope = makeEnvelope(options, messages, callsLog, 'shutdown', totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }
    if (hasTimedOut(now, deadline)) {
      const envelope = makeEnvelope(options, messages, callsLog, 'timeout', totals, latestAssistantText, firstSuccessfulResult);
      envelope.usageRow = recordAggregateUsage(options, firstSuccessfulResult, totals);
      return envelope;
    }
  }
}
