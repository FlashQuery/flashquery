import { z } from 'zod';
import { loadToolMeta, type ToolMeta } from '../services/tool-search/tool-meta.js';
import type { NativeToolDefinition, NativeToolDispatchContext, NativeToolResponse } from './tool-registry.js';

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

export type NativeToolCorePayload = ToolSuccessPayload | ToolErrorPayload;

export interface NativeToolCoreResult {
  payload: NativeToolCorePayload;
  args: Record<string, unknown>;
}

export interface DispatchNativeToolCoreOptions {
  toolName: string;
  args: Record<string, unknown>;
  catalog: NativeToolDefinition[] | Map<string, NativeToolDefinition>;
  nativeToolNames: readonly string[];
  dispatchContext: NativeToolDispatchContext;
  wrapHandlerErrors?: boolean;
}

let toolMetaCache: Promise<Map<string, ToolMeta>> | null = null;

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

function getAbortCode(signal: AbortSignal): string {
  const reason = signal.reason as unknown;
  if (reason === 'timeout' || reason === 'shutdown') return reason;
  if (reason instanceof Error && /timeout/i.test(reason.message)) return 'timeout';
  if (reason instanceof Error && /shutdown/i.test(reason.message)) return 'shutdown';
  return 'shutdown';
}

async function getLoadedToolMeta(): Promise<Map<string, ToolMeta>> {
  toolMetaCache ??= loadToolMeta();
  return await toolMetaCache;
}

function isNativeHelpRequest(args: Record<string, unknown>): boolean {
  return args.help === true;
}

export function nativeHelpFooter(toolName: string): string {
  return `For full documentation, examples, and parameter details, call \`${toolName}\` with \`help: true\`.`;
}

export function appendNativeHelpFooter(message: string, toolName: string): string {
  const footer = nativeHelpFooter(toolName);
  if (message.includes(footer)) return message;
  return `${message}\n\n${footer}`;
}

function appendHelpFooterToResult(result: NativeToolResponse, toolName: string): NativeToolResponse {
  const content = [...result.content];
  if (content.length > 0) {
    const last = content[content.length - 1];
    content[content.length - 1] = { ...last, text: appendNativeHelpFooter(last.text, toolName) };
  } else {
    content.push({ type: 'text', text: nativeHelpFooter(toolName) });
  }
  return { ...result, content };
}

function errorPayload(toolName: string, code: string, message: string, details?: unknown): ToolErrorPayload {
  return {
    ok: false,
    error: {
      code,
      message: appendNativeHelpFooter(message, toolName),
      recoverable: true,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export async function dispatchNativeToolCore(options: DispatchNativeToolCoreOptions): Promise<NativeToolCoreResult> {
  const { toolName, args, dispatchContext } = options;
  const nativeToolNames = new Set(options.nativeToolNames);
  const catalogByName = toCatalogMap(options.catalog);

  if (dispatchContext.signal.aborted) {
    const code = getAbortCode(dispatchContext.signal);
    return {
      args,
      payload: errorPayload(toolName, code, `Native tool dispatch aborted before invoking '${toolName}'.`),
    };
  }

  if (!nativeToolNames.has(toolName)) {
    return {
      args,
      payload: errorPayload(toolName, 'tool_not_in_registry', `Tool '${toolName}' is not available in the immutable native tool registry snapshot.`),
    };
  }

  const tool = catalogByName.get(toolName);
  if (!tool) {
    return {
      args,
      payload: errorPayload(toolName, 'tool_not_in_registry', `Tool '${toolName}' is not in the native catalog.`),
    };
  }

  if (isNativeHelpRequest(args)) {
    const toolMeta = await getLoadedToolMeta();
    const meta = toolMeta.get(toolName);
    if (meta) {
      return {
        args,
        payload: { ok: true, result: { content: [{ type: 'text', text: meta.helpPageBody }] } },
      };
    }
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = toZodObjectSchema(tool.inputSchema).parse(args);
  } catch (error: unknown) {
    return {
      args,
      payload: errorPayload(
        toolName,
        'invalid_tool_arguments',
        `Arguments for native tool '${toolName}' failed validation.`,
        error instanceof z.ZodError ? z.treeifyError(error) : String(error)
      ),
    };
  }

  if (dispatchContext.signal.aborted) {
    const code = getAbortCode(dispatchContext.signal);
    return {
      args: parsedArgs,
      payload: errorPayload(toolName, code, `Native tool dispatch aborted before invoking '${toolName}'.`),
    };
  }

  try {
    const result = await tool.handler(parsedArgs, dispatchContext);
    if (dispatchContext.signal.aborted) {
      const code = getAbortCode(dispatchContext.signal);
      return {
        args: parsedArgs,
        payload: errorPayload(toolName, code, `Native tool dispatch aborted while invoking '${toolName}'.`),
      };
    }
    if (result.isError === true) {
      if (options.wrapHandlerErrors !== false) {
        return {
          args: parsedArgs,
          payload: errorPayload(toolName, 'handler_error', `Native tool '${toolName}' returned an error response.`, result),
        };
      }
      // wrapHandlerErrors === false (host path): preserve the handler's MCP
      // result shape, but still append the help footer per REQ-005 condition (c).
      return {
        args: parsedArgs,
        payload: { ok: true, result: appendHelpFooterToResult(result, toolName) },
      };
    }

    return { args: parsedArgs, payload: { ok: true, result } };
  } catch (error: unknown) {
    return {
      args: parsedArgs,
      payload: errorPayload(
        toolName,
        'handler_error',
        error instanceof Error ? error.message : String(error)
      ),
    };
  }
}
