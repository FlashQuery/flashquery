import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { evaluateProgram, type MacroValue } from '../../macro/evaluator.js';
import { parseMacroSource } from '../../macro/parser.js';
import { buildToolRegistry, type BrokerToolServerConfig, type BuildToolRegistryResult } from '../../macro/registry.js';
import type { MacroCallerContext } from '../../macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../llm/tool-registry.js';
import { getNativeToolCatalog } from '../tool-catalog.js';
import type { McpBroker } from '../../services/mcp-broker.js';
import { NullMcpBroker } from '../../services/mcp-broker.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError } from '../utils/response-formats.js';

export const callMacroInputSchema = z.object({
  source: z.string().optional(),
  source_ref: z.string().optional(),
  input_vars: z.record(z.string(), z.unknown()).optional(),
  budget: z.record(z.string(), z.unknown()).optional(), // inputSchema only; runtime budgets are later-phase work.
  dry_run: z.boolean().optional(), // inputSchema only; dry-run execution is later-phase work.
  trace: z.enum(['full', 'summary', 'none']).optional(),
  progress: z.enum(['full', 'milestones', 'silent']).optional(), // inputSchema only.
});

export interface RunMacroSourceOptions {
  source: string;
  inputVars?: Record<string, MacroValue>;
  input_vars?: Record<string, MacroValue>;
  callerContext?: MacroCallerContext;
  config: FlashQueryConfig;
  catalog: NativeToolDefinition[];
  broker: McpBroker;
  nativeDispatchContext: NativeToolDispatchContext;
  brokerTools?: BrokerToolServerConfig[];
}

export interface RegisterMacroToolsOptions {
  broker?: McpBroker;
  brokerTools?: BrokerToolServerConfig[];
}

export interface RunMacroSourceResult {
  result: Awaited<ReturnType<typeof evaluateProgram>>;
  registryBuild: {
    callerContext: MacroCallerContext;
    allowlistSource: 'resolveHostToolExposure' | 'assembleNativeToolRegistry';
    allowedToolNames: string[];
    toolRegistry: BuildToolRegistryResult;
  };
}

export async function runMacroSource(options: RunMacroSourceOptions): Promise<RunMacroSourceResult> {
  const callerContext = options.callerContext ?? { origin: 'host' as const };
  const toolRegistry = buildToolRegistry({
    config: options.config,
    callerContext,
    broker: options.broker,
    catalog: options.catalog,
    nativeDispatchContext: options.nativeDispatchContext,
    brokerTools: options.brokerTools,
  });
  const parseResult = parseMacroSource(options.source, 'inline');
  if (!parseResult.ok) {
    return {
      result: jsonExpectedError(parseResult.error),
      registryBuild: {
        callerContext,
        allowlistSource: callerContext.origin === 'host' ? 'resolveHostToolExposure' : 'assembleNativeToolRegistry',
        allowedToolNames: toolRegistry.allowedToolNames,
        toolRegistry,
      },
    };
  }

  const result = await evaluateProgram(parseResult.program, {
    inputVars: options.inputVars ?? options.input_vars,
    vaultRoot: options.config.instance.vault.path,
    broker: options.broker,
    toolRegistry: toolRegistry.registry,
    allowedToolNames: toolRegistry.allowedToolNames,
    templateToolNames: toolRegistry.templateToolNames,
    hardExcludedReasons: toolRegistry.hardExcludedReasons,
    callerContext,
  });

  return {
    result,
    registryBuild: {
      callerContext,
      allowlistSource: callerContext.origin === 'host' ? 'resolveHostToolExposure' : 'assembleNativeToolRegistry',
      allowedToolNames: toolRegistry.allowedToolNames,
      toolRegistry,
    },
  };
}

function createNativeDispatchContext(config: FlashQueryConfig): NativeToolDispatchContext {
  return {
    signal: new AbortController().signal,
    instanceId: config.instance.id,
    logContext: { tool: 'call_macro' },
  };
}

export function registerMacroTools(
  server: McpServer,
  config: FlashQueryConfig,
  options: RegisterMacroToolsOptions = {}
): void {
  const broker = options.broker ?? new NullMcpBroker();

  server.registerTool(
    'call_macro',
    {
      description:
        'Run a FlashQuery macro as one structured orchestration request. Supports inline macro source execution through the production parser and evaluator.',
      inputSchema: callMacroInputSchema.shape,
    },
    async (params) => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed.');
      }

      const hasSource = typeof params.source === 'string' && params.source.length > 0;
      const hasSourceRef = typeof params.source_ref === 'string' && params.source_ref.trim().length > 0;

      if (hasSource === hasSourceRef) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'Exactly one of source or source_ref is required.',
          details: { reason: 'exactly_one_required' },
        });
      }

      if (hasSourceRef) {
        return jsonExpectedError({
          error: 'unsupported',
          message: 'call_macro source_ref execution is not implemented yet.',
          details: { reason: 'source_ref_not_implemented' },
        });
      }

      if (hasSource) {
        const { result } = await runMacroSource({
          source: params.source as string,
          input_vars: params.input_vars as Record<string, MacroValue> | undefined,
          config,
          catalog: getNativeToolCatalog(server),
          broker,
          nativeDispatchContext: createNativeDispatchContext(config),
          brokerTools: options.brokerTools,
        });
        return result;
      }
    }
  );
}
