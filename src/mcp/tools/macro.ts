import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { evaluateProgram, MacroCancellationError, type MacroValue } from '../../macro/evaluator.js';
import { parseMacroSource } from '../../macro/parser.js';
import { buildToolRegistry, type BrokerToolServerConfig, type BuildToolRegistryResult } from '../../macro/registry.js';
import type { MacroCallerContext } from '../../macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../llm/tool-registry.js';
import type { McpBroker } from '../../services/mcp-broker.js';
import { NullMcpBroker } from '../../services/mcp-broker.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError } from '../utils/response-formats.js';
import type { TemplateToolReverseMap } from '../../llm/template-tools.js';
import {
  MacroTaskRegistry,
  type MacroTaskRecord,
  type MacroTaskTransitionListener,
} from '../../macro/task-registry.js';

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
  templateReverseMap?: TemplateToolReverseMap;
  templateToolNames?: string[];
  taskId?: string;
  sessionId?: string;
  taskRegistry?: MacroTaskRegistry;
  onTaskTransition?: MacroTaskTransitionListener;
}

export interface RegisterMacroToolsOptions {
  broker?: McpBroker;
  brokerTools?: BrokerToolServerConfig[];
  taskRegistry?: MacroTaskRegistry;
  sessionId?: string;
  sessionIdProvider?: (extra: unknown) => string | undefined;
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
    templateReverseMap: options.templateReverseMap,
    templateToolNames: options.templateToolNames,
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

  const taskRegistry = options.taskRegistry ?? new MacroTaskRegistry();
  const task = taskRegistry.create({
    taskId: options.taskId,
    sessionId: options.sessionId,
    source: options.source,
  });
  options.onTaskTransition?.(task);

  const result = await evaluateProgram(parseResult.program, {
    inputVars: options.inputVars ?? options.input_vars,
    taskId: task.task_id,
    sessionId: options.sessionId,
    vaultRoot: options.config.instance.vault.path,
    broker: options.broker,
    toolRegistry: toolRegistry.registry,
    allowedToolNames: toolRegistry.allowedToolNames,
    templateToolNames: toolRegistry.templateToolNames,
    hardExcludedReasons: toolRegistry.hardExcludedReasons,
    callerContext,
    listTasks: (context) => taskRegistry.list(context.sessionId),
    checkCancelled: (where) => {
      if (taskRegistry.isCancellationRequested(task.task_id)) {
        throw new MacroCancellationError(task.task_id, where);
      }
    },
  });
  transitionTaskFromResult(taskRegistry, task, result, options.onTaskTransition);

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

function createNativeDispatchContext(config: FlashQueryConfig, signal?: AbortSignal): NativeToolDispatchContext {
  return {
    signal: signal ?? new AbortController().signal,
    instanceId: config.instance.id,
    logContext: { tool: 'call_macro' },
  };
}

async function loadRuntimeTemplateBindings(config: FlashQueryConfig) {
  if (config.llm === undefined) return [];
  const { loadPurposeTemplateRuntimeBindings } = await import('../../llm/purpose-template-bindings.js');
  return await loadPurposeTemplateRuntimeBindings(config.instance.id);
}

async function assembleMacroTemplateMetadata(input: {
  config: FlashQueryConfig;
  callerContext: MacroCallerContext;
  catalog: NativeToolDefinition[];
}): Promise<{ templateReverseMap: TemplateToolReverseMap; templateToolNames: string[] }> {
  const { assembleTemplateToolRegistry } = await import('../../llm/template-tools.js');
  const purposeName = input.callerContext.origin === 'delegated'
    ? input.callerContext.purposeName
    : '';
  const runtimeBindings = await loadRuntimeTemplateBindings(input.config);
  const templateRegistry = await assembleTemplateToolRegistry({
    config: input.config,
    purposeName,
    runtimeBindings,
    nativeToolNames: input.catalog.map((tool) => tool.name),
  });
  return {
    templateReverseMap: templateRegistry.templateReverseMap,
    templateToolNames: [...templateRegistry.templateReverseMap.keys()],
  };
}

export function registerMacroTools(
  server: McpServer,
  config: FlashQueryConfig,
  options: RegisterMacroToolsOptions = {}
): void {
  const broker = options.broker ?? new NullMcpBroker();
  const taskRegistry = options.taskRegistry ?? new MacroTaskRegistry();
  const registrationSessionId = options.sessionId ?? randomUUID();

  server.registerTool(
    'call_macro',
    {
      description:
        'Run a FlashQuery macro as one structured orchestration request. Supports inline macro source execution through the production parser and evaluator.',
      inputSchema: callMacroInputSchema.shape,
    },
    async (params, extra: { signal?: AbortSignal }) => {
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
        const callerContext: MacroCallerContext = { origin: 'host' };
        const { getNativeToolCatalog } = await import('../tool-catalog.js');
        const catalog = getNativeToolCatalog(server);
        const templateMetadata = await assembleMacroTemplateMetadata({
          config,
          callerContext,
          catalog,
        });
        const { result } = await runMacroSource({
          source: params.source as string,
          input_vars: params.input_vars as Record<string, MacroValue> | undefined,
          callerContext,
          config,
          catalog,
          broker,
          taskRegistry,
          sessionId: options.sessionIdProvider?.(extra) ?? resolveSessionId(extra) ?? registrationSessionId,
          nativeDispatchContext: createNativeDispatchContext(config, extra?.signal),
          brokerTools: options.brokerTools,
          templateReverseMap: templateMetadata.templateReverseMap,
          templateToolNames: templateMetadata.templateToolNames,
        });
        return result;
      }
    }
  );
}

function transitionTaskFromResult(
  taskRegistry: MacroTaskRegistry,
  task: MacroTaskRecord,
  result: Awaited<ReturnType<typeof evaluateProgram>>,
  onTransition: MacroTaskTransitionListener | undefined
): void {
  const payload = parseResultPayload(result);
  if (isCancelledPayload(payload)) {
    taskRegistry.cancel(task.task_id, task.session_id, onTransition);
    return;
  }
  if (result.isError === true || isExpectedFailurePayload(payload)) {
    taskRegistry.fail(task.task_id, onTransition);
    return;
  }
  taskRegistry.complete(task.task_id, onTransition);
}

function parseResultPayload(result: Awaited<ReturnType<typeof evaluateProgram>>): unknown {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isCancelledPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (payload['error'] === 'cancelled') return true;
  const details = payload['details'];
  return isRecord(details) && details['reason'] === 'cancelled';
}

function isExpectedFailurePayload(payload: unknown): boolean {
  return isRecord(payload) && payload['error'] === 'macro_aborted';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveSessionId(extra: unknown): string | undefined {
  if (!isRecord(extra)) return undefined;
  for (const key of ['sessionId', 'session_id', 'transportSessionId']) {
    const value = extra[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const key of ['session', 'transport', 'requestInfo']) {
    const nested = extra[key];
    if (!isRecord(nested)) continue;
    const value = nested['id'] ?? nested['sessionId'] ?? nested['session_id'];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
