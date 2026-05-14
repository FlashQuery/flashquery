import { z } from 'zod';
import type { FlashQueryConfig } from '../config/loader.js';
import { resolveHostToolExposure } from '../mcp/tool-exposure.js';
import type { McpBroker } from '../services/mcp-broker.js';
import {
  assembleNativeToolRegistry,
  type NativeToolDefinition,
  type NativeToolDispatchContext,
  type NativeToolResponse,
} from '../llm/tool-registry.js';
import { MacroExpectedError, type MacroInvocationContext, type MacroValue } from './evaluator.js';
import type { MacroCallerContext, ToolFn, ToolRegistry } from './types.js';

const FQ_SERVER = 'fq';
const RECURSIVE_MODEL_EXCLUDED_FROM_DELEGATED_MACROS = 'recursive_model_excluded_from_delegated_macros';

export interface BrokerToolServerConfig {
  server: string;
  label: string;
  tools: string[];
}

export interface BuildToolRegistryOptions {
  config: FlashQueryConfig;
  callerContext: MacroCallerContext;
  broker: McpBroker;
  catalog: NativeToolDefinition[];
  nativeDispatchContext: NativeToolDispatchContext;
  brokerTools?: BrokerToolServerConfig[];
  templateToolNames?: string[];
  templateReverseMap?: Map<string, string>;
}

export interface BuildToolRegistryResult {
  registry: ToolRegistry;
  allowedToolNames: string[];
  templateToolNames: string[];
  templateReverseMap?: Map<string, string>;
  hardExcludedReasons: Map<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toZodObjectSchema(inputSchema: unknown): z.ZodObject<z.ZodRawShape> {
  if (inputSchema instanceof z.ZodObject) return inputSchema;
  if (inputSchema instanceof z.ZodType) {
    throw new Error('Tool inputSchema must be a Zod object schema.');
  }
  if (isRecord(inputSchema)) return z.object(inputSchema as z.ZodRawShape);
  throw new Error('Tool inputSchema must be a raw Zod shape object or Zod object schema.');
}

function parseNativeToolResponse(response: NativeToolResponse | MacroValue): MacroValue {
  if (!isNativeToolResponse(response)) {
    return toMacroValue(response);
  }

  const text = response.content[0]?.text ?? '';
  try {
    const parsed = JSON.parse(text) as unknown;
    return toMacroValue(parsed);
  } catch {
    return text;
  }
}

function toMacroValue(value: unknown): MacroValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toMacroValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toMacroValue(entry)]));
  }
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? '';
  if (typeof value === 'function') return value.name === '' ? '[function]' : value.name;
  return null;
}

function isNativeToolResponse(value: NativeToolResponse | MacroValue): value is NativeToolResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.content) &&
    value.content.every(
      (item): item is { type: 'text'; text: string } =>
        isRecord(item) && item.type === 'text' && typeof item.text === 'string'
    )
  );
}

function wrapNativeTool(tool: NativeToolDefinition, dispatchContext: NativeToolDispatchContext): ToolFn {
  const schema = toZodObjectSchema(tool.inputSchema);

  return async (arg: Record<string, MacroValue>) => {
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = schema.parse(arg);
    } catch (error: unknown) {
      throw new MacroExpectedError(
        'invalid_tool_arguments',
        `Arguments for native tool '${tool.name}' failed validation.`,
        {
          tool: tool.name,
          validation: error instanceof z.ZodError ? z.treeifyError(error) : String(error),
        }
      );
    }

    const response = await tool.handler(parsedArgs, dispatchContext);
    if (response.isError === true) {
      throw new MacroExpectedError('tool_call_failed', `Native tool '${tool.name}' returned an error response.`, {
        tool: tool.name,
        response,
      });
    }
    return parseNativeToolResponse(response);
  };
}

function wrapBrokerTool(input: {
  broker: McpBroker;
  server: string;
  tool: string;
  nativeDispatchContext: NativeToolDispatchContext;
}): ToolFn {
  return async (arg: Record<string, MacroValue>, context: MacroInvocationContext) => {
    const handler = input.broker.getToolHandler(input.server, input.tool);
    if (!handler) {
      throw new MacroExpectedError('unknown_tool', `Brokered tool '${input.server}.${input.tool}' is not connected.`, {
        server: input.server,
        tool: input.tool,
      });
    }

    const response = await handler(arg, {
      ...input.nativeDispatchContext,
      server: input.server,
      tool: input.tool,
      macroContext: context,
    } as NativeToolDispatchContext);
    return parseNativeToolResponse(response);
  };
}

function deriveNativeToolNames(options: BuildToolRegistryOptions): {
  nativeToolNames: string[];
  hardExcludedReasons: Map<string, string>;
} {
  const catalogNames = new Set(options.catalog.map((tool) => tool.name));
  const hardExcludedReasons = new Map<string, string>();

  if (options.callerContext.origin === 'host') {
    const hostEnabledToolNames = resolveHostToolExposure(options.config.hostMcpTools).hostEnabledToolNames;
    return {
      nativeToolNames: hostEnabledToolNames.filter((toolName) => catalogNames.has(toolName)),
      hardExcludedReasons,
    };
  }

  const assembly = assembleNativeToolRegistry(
    options.config,
    options.callerContext.purposeName ?? '',
    options.catalog
  );
  for (const excluded of assembly.diagnostics.hardExcluded) {
    if (excluded.tool === 'call_macro') continue;
    hardExcludedReasons.set(
      `${FQ_SERVER}.${excluded.tool}`,
      excluded.tool === 'call_model'
        ? RECURSIVE_MODEL_EXCLUDED_FROM_DELEGATED_MACROS
        : excluded.reason
    );
  }
  return {
    nativeToolNames: assembly.nativeToolNames,
    hardExcludedReasons,
  };
}

function deriveTemplateToolNames(options: BuildToolRegistryOptions): string[] {
  return options.templateToolNames ?? [...(options.templateReverseMap?.keys() ?? [])];
}

export function buildToolRegistry(options: BuildToolRegistryOptions): BuildToolRegistryResult {
  const { nativeToolNames, hardExcludedReasons } = deriveNativeToolNames(options);
  const allowedNativeNames = nativeToolNames.filter((toolName) => toolName !== 'call_macro');
  const fqTools: Record<string, ToolFn> = {};

  for (const tool of options.catalog) {
    if (tool.name === 'call_macro') continue;
    if (hardExcludedReasons.has(`${FQ_SERVER}.${tool.name}`)) continue;
    const toolName = tool.name;
    fqTools[toolName] = wrapNativeTool(tool, options.nativeDispatchContext);
  }

  const registry: ToolRegistry = {
    [FQ_SERVER]: {
      label: 'FlashQuery',
      tools: fqTools,
    },
  };
  const allowedToolNames = allowedNativeNames.map((toolName) => `${FQ_SERVER}.${toolName}`);

  for (const brokerServer of options.brokerTools ?? []) {
    const tools: Record<string, ToolFn> = {};
    for (const tool of brokerServer.tools) {
      const handler = options.broker.getToolHandler(brokerServer.server, tool);
      if (!handler) continue;
      tools[tool] = wrapBrokerTool({
        broker: options.broker,
        server: brokerServer.server,
        tool,
        nativeDispatchContext: options.nativeDispatchContext,
      });
      allowedToolNames.push(`${brokerServer.server}.${tool}`);
    }
    if (Object.keys(tools).length === 0) continue;
    registry[brokerServer.server] = {
      label: brokerServer.label,
      tools,
    };
  }

  const templateToolNames = deriveTemplateToolNames(options);
  return {
    registry,
    allowedToolNames,
    templateToolNames,
    ...(options.templateReverseMap === undefined ? {} : { templateReverseMap: options.templateReverseMap }),
    hardExcludedReasons,
  };
}
