import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { FM } from '../../constants/frontmatter-fields.js';
import {
  evaluateProgram,
  MacroCancellationError,
  MacroExpectedError,
  type MacroValue,
} from '../../macro/evaluator.js';
import { parseMacroSource } from '../../macro/parser.js';
import { runDryRun } from '../../macro/dry-run.js';
import { buildToolRegistry, type BrokerToolServerConfig, type BuildToolRegistryResult } from '../../macro/registry.js';
import { extractMacroFences } from '../../macro/fence-extractor.js';
import { selectMacroSourceBlock, splitMacroSourceRef } from '../../macro/source-ref.js';
import type { MacroCallerContext } from '../../macro/types.js';
import type { NativeToolDefinition, NativeToolDispatchContext } from '../../llm/tool-registry.js';
import type { BrokeredTool, McpBroker } from '../../services/mcp-broker.js';
import { NullMcpBroker } from '../../services/mcp-broker.js';
import type { SchemaDriftDecisionInput } from '../../services/mcp-broker.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError, type ToolResult } from '../utils/response-formats.js';
import {
  AmbiguousDocumentIdentifierError,
  DocumentNotFoundError,
  DocumentReadError,
  resolveDocumentIdentifier,
} from '../utils/resolve-document.js';
import type { TemplateToolReverseMap } from '../../llm/template-tools.js';
import { logger } from '../../logging/logger.js';
import { supabaseManager } from '../../storage/supabase.js';
import {
  MacroTaskRegistry,
  type MacroTaskRecord,
  type MacroTaskTransitionListener,
} from '../../macro/task-registry.js';

export const callMacroInputSchema = z.object({
  source: z.string().optional(),
  source_ref: z.string().optional(),
  input_vars: z.record(z.string(), z.unknown()).optional(),
  budget: z.object({
    max_total_tokens: z.number().optional(),
    max_model_calls: z.number().optional(),
    max_external_tool_calls: z.number().optional(),
    timeout_ms: z.number().optional(),
  }).optional(),
  dry_run: z.boolean().optional(),
  trace: z.enum(['full', 'summary', 'none']).optional(),
  progress: z.enum(['full', 'milestones', 'silent']).optional(),
}).strict();

export interface RunMacroSourceOptions {
  source: string;
  sourceIdentifier?: string;
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
  budget?: {
    max_total_tokens?: number;
    max_model_calls?: number;
    max_external_tool_calls?: number;
    timeout_ms?: number;
  };
  dry_run?: boolean;
  trace?: 'full' | 'summary' | 'none';
  progress?: 'full' | 'milestones' | 'silent';
  progressToken?: string | number;
  progressNotificationSink?: (notification: {
    progressToken: string | number;
    progress: number;
    total?: number;
    message?: string;
  }) => void | Promise<void>;
}

export interface RegisterMacroToolsOptions {
  broker?: McpBroker;
  brokerTools?: BrokerToolServerConfig[];
  taskRegistry?: MacroTaskRegistry;
  sessionId?: string;
  sessionIdProvider?: (extra: unknown) => string | undefined;
}

export interface RegisterMacroToolsResult {
  registrationSessionId: string;
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

export type ResolveMacroSourceForRequestResult =
  | { ok: true; source: string; identifier: string }
  | { ok: false; result: ToolResult };

export interface ResolveMacroSourceForRequestOptions {
  source?: string;
  source_ref?: string;
  config: FlashQueryConfig;
  supabase?: SupabaseClient;
  getSupabase?: () => SupabaseClient;
  log?: typeof logger;
  readDocument?: (absPath: string) => Promise<string>;
}

export async function resolveMacroSourceForRequest(
  options: ResolveMacroSourceForRequestOptions
): Promise<ResolveMacroSourceForRequestResult> {
  const source = options.source;
  const sourceRef = options.source_ref;
  const hasSource = source !== undefined;
  const hasSourceRef = sourceRef !== undefined;

  if (hasSource === hasSourceRef) {
    return {
      ok: false,
      result: jsonExpectedError({
        error: 'invalid_input',
        message: 'Exactly one of source or source_ref is required.',
        details: { reason: 'exactly_one_required' },
      }),
    };
  }

  if (source === '') {
    return {
      ok: false,
      result: jsonExpectedError({
        error: 'invalid_input',
        message: 'Macro source cannot be empty.',
        details: { reason: 'empty_source' },
      }),
    };
  }

  if (sourceRef === '') {
    return {
      ok: false,
      result: jsonExpectedError({
        error: 'invalid_input',
        message: 'Macro source_ref cannot be empty.',
        details: { reason: 'empty_source_ref' },
      }),
    };
  }

  if (source !== undefined) {
    return { ok: true, source, identifier: 'inline' };
  }

  const sourceRefValue = sourceRef as string;
  const split = splitMacroSourceRef(sourceRefValue);
  if (!split.valid) {
    return { ok: false, result: jsonExpectedError(split.error) };
  }

  try {
    const supabase = options.supabase ?? options.getSupabase?.();
    if (supabase === undefined) {
      return {
        ok: false,
        result: jsonRuntimeError({
          error: 'runtime_error',
          message: 'Supabase client is required to resolve source_ref.',
          identifier: sourceRefValue,
        }),
      };
    }
    const resolved = await resolveDocumentIdentifier(
      options.config,
      supabase,
      split.docRef,
      options.log ?? logger
    );
    const raw = await (options.readDocument ?? ((absPath) => readFile(absPath, 'utf-8')))(resolved.absPath);
    const parsed = matter(raw);
    if (parsed.data['status'] === 'archived' || parsed.data[FM.STATUS] === 'archived') {
      return {
        ok: false,
        result: jsonExpectedError({
          error: 'not_found',
          message: `No document found for source_ref: ${sourceRefValue}`,
          identifier: sourceRefValue,
        }),
      };
    }

    const extracted = extractMacroFences(raw, sourceRefValue);
    if (!extracted.ok) {
      return { ok: false, result: jsonExpectedError(extracted.error) };
    }

    const selected = selectMacroSourceBlock(extracted.blocks, split.blockName, sourceRefValue);
    if (!selected.ok) {
      return { ok: false, result: jsonExpectedError(selected.error) };
    }

    return {
      ok: true,
      source: selected.block.source,
      identifier: sourceRefValue,
    };
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return {
        ok: false,
        result: jsonExpectedError({
          error: 'not_found',
          message: `No document found for source_ref: ${sourceRefValue}`,
          identifier: sourceRefValue,
        }),
      };
    }

    if (error instanceof AmbiguousDocumentIdentifierError) {
      return {
        ok: false,
        result: jsonExpectedError({
          error: 'invalid_input',
          message: error.message,
          identifier: sourceRefValue,
          details: {
            reason: 'ambiguous_source_ref',
            matches: error.matches,
          },
        }),
      };
    }

    if (error instanceof DocumentReadError) {
      return {
        ok: false,
        result: jsonRuntimeError({
          error: 'runtime_error',
          message: error.message,
          identifier: sourceRefValue,
        }),
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      result: jsonRuntimeError({
        error: 'runtime_error',
        message: `Error resolving source_ref: ${message}`,
        identifier: sourceRefValue,
      }),
    };
  }
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
  const parseResult = parseMacroSource(options.source, options.sourceIdentifier ?? 'inline');
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

  const inputVars = options.inputVars ?? options.input_vars ?? {};
  const warnings: string[] = [];
  const taskId = options.taskId ?? randomUUID();
  if (options.dry_run === true) {
    try {
      return {
        result: runDryRun({
          program: parseResult.program,
          inputVars,
          taskId,
          registry: toolRegistry.registry,
          allowlist: new Set(toolRegistry.allowedToolNames),
          templateToolNames: toolRegistry.templateToolNames,
          hardExcludedReasons: toolRegistry.hardExcludedReasons,
          callerContext,
          warnings,
        }),
        registryBuild: {
          callerContext,
          allowlistSource: callerContext.origin === 'host' ? 'resolveHostToolExposure' : 'assembleNativeToolRegistry',
          allowedToolNames: toolRegistry.allowedToolNames,
          toolRegistry,
        },
      };
    } catch (error) {
      return {
        result: expectedMacroErrorResult(error),
        registryBuild: {
          callerContext,
          allowlistSource: callerContext.origin === 'host' ? 'resolveHostToolExposure' : 'assembleNativeToolRegistry',
          allowedToolNames: toolRegistry.allowedToolNames,
          toolRegistry,
        },
      };
    }
  }

  const taskRegistry = options.taskRegistry ?? new MacroTaskRegistry();
  const task = taskRegistry.create({
    taskId,
    sessionId: options.sessionId,
    source: options.sourceIdentifier ?? options.source,
  });
  const registryBuild = {
    callerContext,
    allowlistSource: callerContext.origin === 'host' ? 'resolveHostToolExposure' as const : 'assembleNativeToolRegistry' as const,
    allowedToolNames: toolRegistry.allowedToolNames,
    toolRegistry,
  };

  try {
    options.onTaskTransition?.(task);
    const result = await evaluateProgram(parseResult.program, {
      inputVars,
      taskId: task.task_id,
      sessionId: options.sessionId,
      vaultRoot: options.config.instance.vault.path,
      broker: options.broker,
      toolRegistry: toolRegistry.registry,
      allowedToolNames: toolRegistry.allowedToolNames,
      templateToolNames: toolRegistry.templateToolNames,
      hardExcludedReasons: toolRegistry.hardExcludedReasons,
      callerContext,
      traceMode: options.trace ?? 'summary',
      progressMode: options.progress ?? 'milestones',
      progressToken: options.progressToken,
      progressNotificationSink: options.progressNotificationSink,
      budgetLimits: {
        ...(options.budget ?? {}),
        timeout_ms: options.budget?.timeout_ms ?? options.config.macro?.defaultTimeoutMs ?? 60000,
      },
      listTasks: (context) => taskRegistry.list(context.sessionId),
      checkCancelled: (where) => {
        if (taskRegistry.isCancellationRequested(task.task_id)) {
          throw new MacroCancellationError(task.task_id, where);
        }
      },
    });
    try {
      transitionTaskFromResult(taskRegistry, task, result, options.onTaskTransition);
    } catch (error) {
      taskRegistry.fail(task.task_id);
      throw error;
    }
    return { result, registryBuild };
  } catch (error) {
    taskRegistry.fail(task.task_id);
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: jsonRuntimeError({
        error: 'runtime_error',
        message: `Error running macro: ${message}`,
      }),
      registryBuild,
    };
  }
}

function createNativeDispatchContext(config: FlashQueryConfig, signal?: AbortSignal, traceId?: string): NativeToolDispatchContext {
  return {
    signal: signal ?? new AbortController().signal,
    instanceId: config.instance.id,
    ...(traceId === undefined ? {} : { traceId }),
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
): RegisterMacroToolsResult {
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
    async (params, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      try {
        if (getIsShuttingDown()) {
          return jsonRuntimeError('Server is shutting down; new requests cannot be processed.');
        }

        const requestSource = typeof params.source === 'string' ? params.source : undefined;
        const requestSourceRef = typeof params.source_ref === 'string' ? params.source_ref : undefined;
        const resolvedSource = await resolveMacroSourceForRequest({
          source: requestSource,
          source_ref: requestSourceRef,
          config,
          getSupabase: () => supabaseManager.getClient(),
        });
        if (!resolvedSource.ok) {
          return resolvedSource.result;
        }

        const callerContext: MacroCallerContext = { origin: 'host' };
        const currentSessionId = options.sessionIdProvider?.(extra) ?? resolveSessionId(extra) ?? registrationSessionId;
        const consumerContext = { kind: 'host' as const, traceId: currentSessionId };
        applyTofuDecisionsFromInputVars(broker, params.input_vars, currentSessionId);
        await broker.listToolsForConsumer(consumerContext);
        applyTofuDecisionsFromInputVars(broker, params.input_vars, currentSessionId);
        const visibleBrokerTools = await broker.listToolsForConsumer(consumerContext);
        const pendingBrokerTools = broker.getPendingSchemaDrift(consumerContext).map((drift) => ({
          serverId: drift.server,
          toolName: drift.tool,
        }));
        const { getNativeToolCatalog } = await import('../tool-catalog.js');
        const catalog = getNativeToolCatalog(server);
        const templateMetadata = await assembleMacroTemplateMetadata({
          config,
          callerContext,
          catalog,
        });
        const { result } = await runMacroSource({
          source: resolvedSource.source,
          sourceIdentifier: resolvedSource.identifier,
          input_vars: params.input_vars as Record<string, MacroValue> | undefined,
          callerContext,
          config,
          catalog,
          broker,
          taskRegistry,
          sessionId: currentSessionId,
          nativeDispatchContext: createNativeDispatchContext(config, extra?.signal, currentSessionId),
          brokerTools: options.brokerTools ?? groupBrokerToolsForMacro([...visibleBrokerTools, ...pendingBrokerTools]),
          templateReverseMap: templateMetadata.templateReverseMap,
          templateToolNames: templateMetadata.templateToolNames,
          budget: params.budget,
          dry_run: params.dry_run,
          trace: params.trace,
          progress: params.progress,
          progressToken: extra._meta?.progressToken,
          progressNotificationSink: async (notification) => {
            await extra.sendNotification?.({
              method: 'notifications/progress',
              params: notification,
            });
          },
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonRuntimeError({
          error: 'runtime_error',
          message: `Error running call_macro: ${message}`,
        });
      }
    }
  );

  return { registrationSessionId };
}

function groupBrokerToolsForMacro(tools: Array<Pick<BrokeredTool, 'serverId' | 'toolName'>>): BrokerToolServerConfig[] {
  const byServer = new Map<string, { label: string; tools: string[] }>();
  for (const tool of tools) {
    const existing = byServer.get(tool.serverId) ?? { label: tool.serverId, tools: [] };
    existing.tools.push(tool.toolName);
    byServer.set(tool.serverId, existing);
  }
  return [...byServer.entries()].map(([server, value]) => ({
    server,
    label: value.label,
    tools: value.tools,
  }));
}

function applyTofuDecisionsFromInputVars(
  broker: McpBroker,
  inputVars: unknown,
  traceId: string
): void {
  const root = asRecord(inputVars);
  const frontmatter = asRecord(root?.['frontmatter']);
  const userDecisions = asRecord(frontmatter?.['user_decisions']);
  if (userDecisions === undefined) return;

  const decisions: SchemaDriftDecisionInput[] = [];
  for (const [key, value] of Object.entries(userDecisions)) {
    const decisionRecord = asRecord(value);
    const decision = decisionRecord?.['tofu_decision'];
    if (decision !== 'approve' && decision !== 'reject') continue;
    const delimiter = key.indexOf('__');
    if (delimiter <= 0 || delimiter === key.length - 2) continue;
    decisions.push({
      server: key.slice(0, delimiter),
      tool: key.slice(delimiter + 2),
      decision,
    });
  }

  if (decisions.length > 0) {
    broker.resolveSchemaDrift(decisions, { traceId });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function expectedMacroErrorResult(error: unknown): ToolResult {
  if (error instanceof MacroExpectedError) {
    return jsonExpectedError({
      error: error.error,
      message: error.message,
      details: error.details,
    });
  }
  if (error && typeof error === 'object' && 'error' in error && 'message' in error) {
    const envelope = error as { error: string; message: string; details?: Record<string, unknown> };
    return jsonExpectedError(envelope);
  }
  return jsonRuntimeError({
    error: 'tool_call_failed',
    message: error instanceof Error ? error.message : String(error),
  });
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
    taskRegistry.clearCancellationRequest(task.task_id);
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
