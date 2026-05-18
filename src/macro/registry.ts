import { z } from 'zod';
import type { FlashQueryConfig } from '../config/loader.js';
import { resolveHostToolExposure } from '../mcp/tool-exposure.js';
import {
  formatToolError,
  recordBrokeredToolCall,
  SchemaDriftNeedsUserInputError,
  type Broker,
  type ConsumerContext,
} from '../services/mcp-broker.js';
import {
  assembleNativeToolRegistry,
  type NativeToolDefinition,
  type NativeToolDispatchContext,
  type NativeToolResponse,
} from '../llm/tool-registry.js';
import {
  MacroExpectedError,
  MacroNeedsUserInputError,
  type MacroInvocationContext,
  type MacroValue,
} from './evaluator.js';
import { coerceBrokerToolArguments, coerceCallToolResult, isCallToolErrorResult } from './coerce.js';
import type { MacroCallerContext, ToolFn, ToolRegistry } from './types.js';

const FQ_SERVER = 'fq';
const RECURSIVE_MODEL_EXCLUDED_FROM_DELEGATED_MACROS = 'recursive_model_excluded_from_delegated_macros';

export interface BrokerToolServerConfig {
  server: string;
  label: string;
  tools: string[];
  toolCosts?: Record<string, number>;
}

export interface BuildToolRegistryOptions {
  config: FlashQueryConfig;
  callerContext: MacroCallerContext;
  broker: Broker;
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
  broker: Broker;
  server: string;
  tool: string;
  costPerCall?: number;
  nativeDispatchContext: NativeToolDispatchContext;
  callerContext: MacroCallerContext;
}): ToolFn {
  return async (arg: Record<string, MacroValue>, context: MacroInvocationContext) => {
    void context;
    const ref = { serverId: input.server, toolName: input.tool };
    const consumerContext = makeBrokerConsumerContext(input.callerContext, input.nativeDispatchContext);
    const visibleTools = await input.broker.listToolsForConsumer(consumerContext);
    let visibleTool = visibleTools.find((tool) => tool.serverId === input.server && tool.toolName === input.tool);
    if (visibleTool === undefined) {
      const pendingDrifts = input.broker
        .getPendingSchemaDrift(consumerContext)
        .filter((drift) => drift.server === input.server);
      const pendingDrift = pendingDrifts.find((drift) => drift.tool === input.tool);
      if (pendingDrift !== undefined) {
        if (consumerContext.interactive === false) {
          throw new MacroExpectedError(
            'tool_unavailable_pending_user_decision',
            `Brokered tool '${input.server}.${input.tool}' is blocked pending user approval of a schema change.`,
            { server: input.server, tool: input.tool, drift: pendingDrift }
          );
        }
        throw new MacroNeedsUserInputError(
          pendingDrifts.length > 1
            ? { event: 'schema_drift_detected', server: input.server, changes: pendingDrifts }
            : pendingDrift
        );
      }
      if (input.callerContext.consumerContext !== undefined) {
        visibleTool = {
          serverId: input.server,
          toolName: input.tool,
          registryKey: `${input.server}__${input.tool}`,
          inputSchema: {},
          tofuHash: '',
          costPerCall: input.costPerCall ?? 0,
        };
      } else {
      throw new MacroExpectedError('unknown_tool', `Brokered tool '${input.server}.${input.tool}' is not available.`, {
        server: input.server,
        tool: input.tool,
      });
      }
    }
    try {
      const result = await input.broker.callTool(ref, coerceBrokerToolArguments(arg), consumerContext);
      recordBrokeredToolCall({
        traceId: consumerContext.traceId,
        serverId: input.server,
        toolName: input.tool,
        costPerCall: visibleTool.costPerCall,
        consumerContext,
      });
      if (isCallToolErrorResult(result)) {
        const normalized = formatToolError(result, ref);
        throw new MacroExpectedError('tool_call_failed', normalized.message, normalized);
      }
      return coerceCallToolResult(result);
    } catch (error: unknown) {
      if (error instanceof MacroExpectedError) throw error;
      if (error instanceof SchemaDriftNeedsUserInputError) {
        throw new MacroNeedsUserInputError(error.payload);
      }
      const normalized = formatToolError(error, ref);
      throw new MacroExpectedError('tool_call_failed', normalized.message, normalized);
    }
  };
}

function makeBrokerConsumerContext(
  callerContext: MacroCallerContext,
  dispatchContext: NativeToolDispatchContext
): ConsumerContext {
  if (callerContext.consumerContext !== undefined) {
    return callerContext.consumerContext;
  }
  const traceId = dispatchContext.traceId ?? '';
  if (callerContext.origin === 'delegated') {
    return {
      kind: 'purpose',
      purposeId: callerContext.purposeName ?? '',
      traceId,
      ...(callerContext.interactive === undefined ? {} : { interactive: callerContext.interactive }),
    };
  }
  return {
    kind: 'host',
    traceId,
    ...(callerContext.interactive === undefined ? {} : { interactive: callerContext.interactive }),
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
  const purposeRequestedCallMacro = options.callerContext.origin === 'delegated' &&
    (options.config.llm?.purposes.find((purpose) =>
      purpose.name.toLowerCase() === (options.callerContext.purposeName ?? '').toLowerCase()
    )?.tools ?? []).includes('call_macro');
  const allowedNativeNames = [
    ...nativeToolNames,
    ...(purposeRequestedCallMacro && options.catalog.some((tool) => tool.name === 'call_macro') ? ['call_macro'] : []),
  ];
  const fqTools: Record<string, ToolFn> = {};

  for (const tool of options.catalog) {
    if (tool.name === 'call_macro' && !allowedNativeNames.includes('call_macro')) continue;
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
      tools[tool] = wrapBrokerTool({
        broker: options.broker,
        server: brokerServer.server,
        tool,
        costPerCall: brokerServer.toolCosts?.[tool],
        nativeDispatchContext: options.nativeDispatchContext,
        callerContext: options.callerContext,
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
