import { z } from 'zod';
import type { LlmChatToolCall, LlmToolMessage } from './types.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { dispatchTemplateToolCall, type TemplateToolReverseMap } from './template-tools.js';
import type {
  NativeToolDefinition,
  NativeToolDispatchContext,
  NativeToolResponse,
} from './tool-registry.js';

export type { NativeToolDispatchContext } from './tool-registry.js';

export interface NativeToolCallLogEntry {
  kind: 'native';
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
}

export interface DispatchToolCallsResult {
  messages: LlmToolMessage[];
  logEntries: Array<NativeToolCallLogEntry | Awaited<ReturnType<typeof dispatchTemplateToolCall>>['logEntry']>;
}

interface ToolErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    recoverable: true;
    details?: unknown;
  };
}

interface ToolSuccessPayload {
  ok: true;
  result: NativeToolResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCatalogMap(catalog: NativeToolDefinition[] | Map<string, NativeToolDefinition>): Map<string, NativeToolDefinition> {
  if (catalog instanceof Map) return catalog;
  return new Map(catalog.map((tool) => [tool.name, tool]));
}

function toZodObjectSchema(inputSchema: unknown): z.ZodObject<z.ZodRawShape> {
  if (inputSchema instanceof z.ZodObject) return inputSchema;
  if (inputSchema instanceof z.ZodType) {
    throw new Error('Tool inputSchema must be a Zod object schema.');
  }
  if (isRecord(inputSchema)) return z.object(inputSchema as z.ZodRawShape);
  throw new Error('Tool inputSchema must be a raw Zod shape object or Zod object schema.');
}

function stringifyPayload(payload: ToolSuccessPayload | ToolErrorPayload): string {
  return JSON.stringify(payload);
}

function summarize(content: string): string {
  return content.length > 500 ? `${content.slice(0, 500)}...` : content;
}

function getAbortCode(signal: AbortSignal): string {
  const reason = signal.reason as unknown;
  if (reason === 'timeout' || reason === 'shutdown') return reason;
  if (reason instanceof Error && /timeout/i.test(reason.message)) return 'timeout';
  if (reason instanceof Error && /shutdown/i.test(reason.message)) return 'shutdown';
  return 'shutdown';
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
  payload: ToolSuccessPayload | ToolErrorPayload,
  content: string
): NativeToolCallLogEntry {
  const ok = payload.ok;
  const errorCode = ok ? undefined : payload.error.code;
  return {
    kind: 'native',
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

function isGeneratedTemplateToolName(toolName: string): boolean {
  return toolName.startsWith('flashquery_');
}

async function dispatchOneToolCall(
  options: DispatchToolCallsOptions,
  toolCall: LlmChatToolCall
): Promise<NativeToolDispatchResult | Awaited<ReturnType<typeof dispatchTemplateToolCall>>> {
  const templateReverseMap = makeTemplateReverseMap(options);
  const toolName = toolCall.function.name;
  if (templateReverseMap.has(toolName) || isGeneratedTemplateToolName(toolName)) {
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
  return await dispatchNativeToolCall({
    toolCall,
    catalog: options.catalog,
    nativeToolNames: options.nativeToolNames,
    dispatchContext: resolveContext(options),
  });
}

function errorPayload(code: string, message: string, details?: unknown): ToolErrorPayload {
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
  details?: unknown
): NativeToolDispatchResult {
  const payload = errorPayload(code, message, details);
  const content = stringifyPayload(payload);
  return {
    message: makeToolMessage(toolCall, content),
    logEntry: makeLogEntry(toolCall, args, payload, content),
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
  const nativeToolNames = new Set(options.nativeToolNames);
  const catalogByName = toCatalogMap(options.catalog);

  if (dispatchContext.signal.aborted) {
    const code = getAbortCode(dispatchContext.signal);
    return dispatchError(options.toolCall, args, code, `Native tool dispatch aborted before invoking '${toolName}'.`);
  }

  if (!nativeToolNames.has(toolName)) {
    return dispatchError(
      options.toolCall,
      args,
      'tool_not_in_registry',
      `Tool '${toolName}' is not available in the immutable native tool registry snapshot.`
    );
  }

  const tool = catalogByName.get(toolName);
  if (!tool) {
    return dispatchError(options.toolCall, args, 'tool_not_in_registry', `Tool '${toolName}' is not in the native catalog.`);
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = toZodObjectSchema(tool.inputSchema).parse(args);
  } catch (error: unknown) {
    return dispatchError(
      options.toolCall,
      args,
      'invalid_tool_arguments',
      `Arguments for native tool '${toolName}' failed validation.`,
      error instanceof z.ZodError ? z.treeifyError(error) : String(error)
    );
  }

  if (dispatchContext.signal.aborted) {
    const code = getAbortCode(dispatchContext.signal);
    return dispatchError(options.toolCall, parsedArgs, code, `Native tool dispatch aborted before invoking '${toolName}'.`);
  }

  try {
    const result = await tool.handler(parsedArgs, dispatchContext);
    if (dispatchContext.signal.aborted) {
      const code = getAbortCode(dispatchContext.signal);
      return dispatchError(options.toolCall, parsedArgs, code, `Native tool dispatch aborted while invoking '${toolName}'.`);
    }
    if (result.isError === true) {
      return dispatchError(options.toolCall, parsedArgs, 'handler_error', `Native tool '${toolName}' returned an error response.`, result);
    }

    const payload: ToolSuccessPayload = { ok: true, result };
    const content = stringifyPayload(payload);
    return {
      message: makeToolMessage(options.toolCall, content),
      logEntry: makeLogEntry(options.toolCall, parsedArgs, payload, content),
    };
  } catch (error: unknown) {
    return dispatchError(
      options.toolCall,
      parsedArgs,
      'handler_error',
      error instanceof Error ? error.message : String(error)
    );
  }
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
