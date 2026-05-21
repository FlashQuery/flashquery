import type { LlmChatToolCall, LlmToolMessage } from './types.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { dispatchTemplateToolCall, type TemplateToolReverseMap } from './template-tools.js';
import { appendNativeHelpFooter, dispatchNativeToolCore, type NativeToolCorePayload } from './native-tool-core.js';
import {
  formatToolError,
  parseRegistryKey,
  recordBrokeredToolCall,
  type Broker,
  type ConsumerContext,
} from '../services/mcp-broker/index.js';
import type {
  NativeToolDefinition,
  NativeToolDispatchContext,
} from './tool-registry.js';

export type { NativeToolDispatchContext } from './tool-registry.js';

export interface NativeToolCallLogEntry {
  kind: 'native' | 'brokered';
  id: string;
  name: string;
  ok: boolean;
  error_code?: string;
  result_summary: string;
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: 'success' | 'error';
}

export interface NativeToolDispatchResult {
  message: LlmToolMessage;
  logEntry: NativeToolCallLogEntry;
}

export interface DispatchNativeToolCallOptions {
  toolCall: LlmChatToolCall;
  catalog: NativeToolDefinition[] | Map<string, NativeToolDefinition>;
  nativeToolNames: readonly string[];
  dispatchContext?: NativeToolDispatchContext;
  context?: NativeToolDispatchContext;
  broker?: Broker;
  consumerContext?: ConsumerContext;
}

export interface DispatchToolCallsOptions {
  toolCalls: LlmChatToolCall[];
  catalog: NativeToolDefinition[] | Map<string, NativeToolDefinition>;
  nativeToolNames: readonly string[];
  templateReverseMap?: TemplateToolReverseMap;
  templateDispatchContext?: {
    config?: FlashQueryConfig;
    supabaseManager?: Parameters<typeof dispatchTemplateToolCall>[0]['supabaseManager'];
    embeddingProvider?: Parameters<typeof dispatchTemplateToolCall>[0]['embeddingProvider'];
    logger?: Parameters<typeof dispatchTemplateToolCall>[0]['logger'];
    templateDocuments?: Parameters<typeof dispatchTemplateToolCall>[0]['templateDocuments'];
  };
  config?: FlashQueryConfig;
  templateDocuments?: Parameters<typeof dispatchTemplateToolCall>[0]['templateDocuments'];
  templateTools?: Parameters<typeof dispatchTemplateToolCall>[0]['templateDocuments'];
  dispatchContext?: NativeToolDispatchContext;
  context?: NativeToolDispatchContext;
  broker?: Broker;
  consumerContext?: ConsumerContext;
}

export interface DispatchToolCallsResult {
  messages: LlmToolMessage[];
  logEntries: Array<NativeToolCallLogEntry | Awaited<ReturnType<typeof dispatchTemplateToolCall>>['logEntry']>;
}

function stringifyPayload(payload: NativeToolCorePayload): string {
  return JSON.stringify(payload);
}

function summarize(content: string): string {
  return content.length > 500 ? `${content.slice(0, 500)}...` : content;
}

function makeToolMessage(toolCall: LlmChatToolCall, content: string): LlmToolMessage {
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content,
  };
}

function makeLogEntry(
  toolCall: LlmChatToolCall,
  args: Record<string, unknown>,
  payload: NativeToolCorePayload,
  content: string,
  kind: NativeToolCallLogEntry['kind'] = 'native'
): NativeToolCallLogEntry {
  const ok = payload.ok;
  const errorCode = ok ? undefined : payload.error.code;
  return {
    kind,
    id: toolCall.id,
    name: toolCall.function.name,
    ok,
    ...(errorCode ? { error_code: errorCode } : {}),
    result_summary: summarize(content),
    tool_call_id: toolCall.id,
    tool_name: toolCall.function.name,
    arguments: args,
    status: ok ? 'success' : 'error',
  };
}

function makeTemplateReverseMap(options: DispatchToolCallsOptions): TemplateToolReverseMap {
  return options.templateReverseMap ?? new Map<string, string>();
}

async function dispatchOneToolCall(
  options: DispatchToolCallsOptions,
  toolCall: LlmChatToolCall
): Promise<NativeToolDispatchResult | Awaited<ReturnType<typeof dispatchTemplateToolCall>>> {
  const templateReverseMap = makeTemplateReverseMap(options);
  const toolName = toolCall.function.name;
  if (templateReverseMap.has(toolName)) {
    return await dispatchTemplateToolCall({
      toolCall,
      templateReverseMap,
      config: options.templateDispatchContext?.config ?? options.config,
      supabaseManager: options.templateDispatchContext?.supabaseManager,
      embeddingProvider: options.templateDispatchContext?.embeddingProvider,
      logger: options.templateDispatchContext?.logger,
      templateDocuments: options.templateDispatchContext?.templateDocuments ?? options.templateDocuments ?? options.templateTools,
    });
  }
  const brokeredResult = await dispatchBrokeredToolCall(options, toolCall);
  if (brokeredResult !== null) return brokeredResult;
  return await dispatchNativeToolCall({
    toolCall,
    catalog: options.catalog,
    nativeToolNames: options.nativeToolNames,
    dispatchContext: resolveContext(options),
  });
}

async function dispatchBrokeredToolCall(
  options: DispatchToolCallsOptions,
  toolCall: LlmChatToolCall
): Promise<NativeToolDispatchResult | null> {
  let ref: { serverId: string; toolName: string };
  try {
    ref = parseRegistryKey(toolCall.function.name);
  } catch {
    return null;
  }

  const args = toolCall.function.arguments;
  if (options.broker === undefined || options.consumerContext === undefined) {
    return dispatchError(
      toolCall,
      args,
      'tool_not_in_registry',
      `Tool '${toolCall.function.name}' is not available in the immutable native tool registry snapshot.`,
      undefined,
      'brokered'
    );
  }

  const visibleTools = await options.broker.listToolsForConsumer(options.consumerContext);
  const visibleTool = visibleTools.find((tool) => tool.registryKey === toolCall.function.name);
  if (visibleTool === undefined) {
    return dispatchError(
      toolCall,
      args,
      'tool_not_in_registry',
      `Tool '${toolCall.function.name}' is not available in the immutable native tool registry snapshot.`,
      undefined,
      'brokered'
    );
  }

  try {
    const result = await options.broker.callTool(ref, args, options.consumerContext);
    recordBrokeredToolCall({
      traceId: options.consumerContext.traceId,
      serverId: ref.serverId,
      toolName: ref.toolName,
      costPerCall: visibleTool.costPerCall,
      consumerContext: options.consumerContext,
    });
    if (result.isError === true) {
      const normalized = formatToolError(result, ref);
      return dispatchError(toolCall, args, normalized.kind, normalized.message, undefined, 'brokered');
    }

    const payload: NativeToolCorePayload = { ok: true, result: { content: result.content } };
    const content = stringifyPayload(payload);
    return {
      message: makeToolMessage(toolCall, content),
      logEntry: makeLogEntry(toolCall, args, payload, content, 'brokered'),
    };
  } catch (error: unknown) {
    const normalized = formatToolError(error, ref);
    return dispatchError(toolCall, args, normalized.kind, normalized.message, undefined, 'brokered');
  }
}

function errorPayload(code: string, message: string, details?: unknown): NativeToolCorePayload {
  return {
    ok: false,
    error: {
      code,
      message,
      recoverable: true,
      ...(details === undefined ? {} : { details }),
    },
  };
}

function dispatchError(
  toolCall: LlmChatToolCall,
  args: Record<string, unknown>,
  code: string,
  message: string,
  details?: unknown,
  kind: NativeToolCallLogEntry['kind'] = 'native'
): NativeToolDispatchResult {
  const payload = errorPayload(
    code,
    kind === 'native' ? appendNativeHelpFooter(message, toolCall.function.name) : message,
    details
  );
  const content = stringifyPayload(payload);
  return {
    message: makeToolMessage(toolCall, content),
    logEntry: makeLogEntry(toolCall, args, payload, content, kind),
  };
}

function resolveContext(options: DispatchNativeToolCallOptions | DispatchToolCallsOptions): NativeToolDispatchContext {
  const context = options.dispatchContext ?? options.context;
  if (!context) {
    throw new Error('Native tool dispatch requires a dispatch context.');
  }
  return context;
}

export async function dispatchNativeToolCall(options: DispatchNativeToolCallOptions): Promise<NativeToolDispatchResult> {
  const dispatchContext = resolveContext(options);
  const toolName = options.toolCall.function.name;
  const args = options.toolCall.function.arguments;
  const result = await dispatchNativeToolCore({
    toolName,
    args,
    catalog: options.catalog,
    nativeToolNames: options.nativeToolNames,
    dispatchContext,
  });
  const content = stringifyPayload(result.payload);
  return {
    message: makeToolMessage(options.toolCall, content),
    logEntry: makeLogEntry(options.toolCall, result.args, result.payload, content),
  };
}

export async function dispatchToolCalls(options: DispatchToolCallsOptions): Promise<DispatchToolCallsResult> {
  const settled = await Promise.allSettled(
    options.toolCalls.map((toolCall) => dispatchOneToolCall(options, toolCall))
  );

  const results = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    return dispatchError(
      options.toolCalls[index],
      options.toolCalls[index].function.arguments,
      'handler_error',
      result.reason instanceof Error ? result.reason.message : String(result.reason)
    );
  });

  return {
    messages: results.map((result) => result.message),
    logEntries: results.map((result) => result.logEntry),
  };
}
