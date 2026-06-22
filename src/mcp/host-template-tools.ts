import { createHash } from 'node:crypto';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { FlashQueryConfig } from '../config/loader.js';
import {
  assembleTemplateToolRegistry,
  dispatchTemplateToolCall,
  type TemplateToolDefinition,
} from '../llm/template-tools.js';
import { parseLlmJson } from '../llm/json-repair.js';
import type { NativeToolDefinition } from '../llm/tool-registry.js';
import { logger } from '../logging/logger.js';
import type { ToolSearchService } from '../services/tool-search/tool-search-service.js';
import { jsonRuntimeError, type HostTemplateRefreshSummary } from './utils/response-formats.js';
import { getRegisteredMcpServers } from './request-lifecycle-registry.js';
import { getNativeToolCatalog, registerUncatalogedTool } from './tool-catalog.js';

export interface RegisterHostTemplateToolsOptions {
  nativeToolCatalog: readonly NativeToolDefinition[];
}

interface HostTemplateToolRegistration {
  templatePath: string;
  fingerprint: string;
  handle: RegisteredTool;
}

interface HostTemplateToolState {
  toolsByName: Map<string, HostTemplateToolRegistration>;
}

export interface HostTemplateRegistryManagerOptions {
  nativeToolCatalog: readonly NativeToolDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function zodSchemaForJsonSchema(schema: unknown): z.ZodTypeAny {
  if (!isRecord(schema)) return z.unknown();
  const type = schema['type'];
  if (Array.isArray(type)) return z.unknown();
  if (type === 'string') return z.string();
  if (type === 'number') return z.number();
  if (type === 'integer') return z.number().int();
  if (type === 'boolean') return z.boolean();
  if (type === 'array') return z.array(zodSchemaForJsonSchema(schema['items']));
  if (type === 'object') {
    const shape = zodRawShapeForJsonSchema(schema);
    const objectSchema = z.object({
      ...shape,
      ...(Object.prototype.hasOwnProperty.call(shape, '_meta') ? {} : { _meta: z.record(z.string(), z.unknown()).optional() }),
    });
    if (schema['additionalProperties'] === false) {
      return objectSchema.strict();
    }
    return objectSchema.catchall(z.unknown());
  }
  return z.unknown();
}

function zodRawShapeForJsonSchema(schema: unknown): z.ZodRawShape {
  if (!isRecord(schema) || !isRecord(schema['properties'])) return {};
  const required = new Set(Array.isArray(schema['required']) ? schema['required'].filter((item) => typeof item === 'string') : []);
  return Object.fromEntries(
    Object.entries(schema['properties']).map(([key, value]) => {
      const propertySchema = zodSchemaForJsonSchema(value);
      return [key, required.has(key) ? propertySchema : propertySchema.optional()];
    })
  );
}

const templatePayloadSchema = z.object({ ok: z.boolean().optional() }).catchall(z.unknown());

function parseTemplateToolPayload(text: string):
  | { payload: Record<string, unknown> | undefined; isError: boolean; errorResult?: undefined }
  | { payload: undefined; isError: true; errorResult: CallToolResult } {
  const parsed = parseLlmJson(text, templatePayloadSchema);
  if (parsed.ok) {
    return { payload: parsed.data, isError: parsed.data.ok === false };
  }
  if (!isJsonLikeText(text)) {
    return { payload: undefined, isError: false };
  }
  const parsedJsonValue = parseLlmJson(text, z.unknown());
  if (parsedJsonValue.ok && !isRecord(parsedJsonValue.data)) {
    return {
      payload: undefined,
      isError: true,
      errorResult: jsonRuntimeError({
        error: 'invalid_json_payload',
        message: 'Structured JSON payload must be an object envelope.',
        details: {
          site: 'host_template_tool',
          reason: 'expected_object_envelope',
          failure: parsed.failure,
          summary: parsed.summary,
        },
      }),
    };
  }
  return {
    payload: undefined,
    isError: true,
    errorResult: jsonRuntimeError({
      error: 'invalid_json_payload',
      message: 'Structured JSON payload could not be parsed.',
      details: {
        site: 'host_template_tool',
        failure: parsed.failure,
        summary: parsed.summary,
      },
    }),
  };
}

export function callResultFromTemplateText(text: string): CallToolResult {
  const { payload, isError, errorResult } = parseTemplateToolPayload(text);
  if (errorResult !== undefined) return errorResult;
  return {
    content: [{ type: 'text', text }],
    ...(payload === undefined ? {} : { structuredContent: payload }),
    ...(isError ? { isError: true } : {}),
  };
}

function isJsonLikeText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```');
}

function emptySummary(sessions: number): HostTemplateRefreshSummary {
  return {
    attempted: true,
    sessions,
    added: [],
    removed: [],
    updated: [],
    unchanged: 0,
    skipped: [],
    warnings: [],
    conflicts: [],
  };
}

function mergeSummary(target: HostTemplateRefreshSummary, source: HostTemplateRefreshSummary): void {
  target.added.push(...source.added);
  target.removed.push(...source.removed);
  target.updated.push(...source.updated);
  target.unchanged += source.unchanged;
  target.skipped.push(...source.skipped);
  target.warnings.push(...source.warnings);
  target.conflicts.push(...source.conflicts);
  if (source.renames !== undefined && source.renames.length > 0) {
    target.renames = [...(target.renames ?? []), ...source.renames];
  }
  if (source.session_failures !== undefined && source.session_failures.length > 0) {
    target.session_failures = [...(target.session_failures ?? []), ...source.session_failures];
  }
}

function fingerprintTemplateTool(tool: TemplateToolDefinition): string {
  return createHash('sha256')
    .update(JSON.stringify({
      name: tool.name,
      templatePath: tool.templatePath,
      description: tool.description,
      parameters: tool.parameters,
      namespace: tool.namespace,
    }))
    .digest('hex');
}

function registerHostTemplateTool(
  server: McpServer,
  config: FlashQueryConfig,
  tool: TemplateToolDefinition
): RegisteredTool {
  return registerUncatalogedTool(
    server,
    tool.name,
    {
      description: tool.description,
      inputSchema: zodSchemaForJsonSchema(tool.parameters),
    },
    async (args: unknown) => {
      const result = await dispatchTemplateToolCall({
        config,
        toolCall: {
          id: `host_template_${tool.name}`,
          type: 'function',
          function: {
            name: tool.name,
            arguments: isRecord(args) ? args : {},
          },
        },
        templateReverseMap: new Map([[tool.name, tool.templatePath]]),
      });
      return callResultFromTemplateText(result.message.content ?? '');
    }
  ) as RegisteredTool;
}

export class HostTemplateRegistryManager {
  readonly #stateByServer = new WeakMap<McpServer, HostTemplateToolState>();
  readonly #nativeToolCatalog: readonly NativeToolDefinition[];

  constructor(options: HostTemplateRegistryManagerOptions) {
    this.#nativeToolCatalog = options.nativeToolCatalog;
  }

  releaseServer(server: McpServer): void {
    const state = this.#stateByServer.get(server);
    if (state !== undefined) {
      for (const registration of state.toolsByName.values()) {
        try {
          registration.handle.remove();
        } catch (err: unknown) {
          logger.warn(`host template tool cleanup failed for '${registration.templatePath}': ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    this.#stateByServer.delete(server);
  }

  async refreshServer(
    server: McpServer,
    config: FlashQueryConfig,
    options: { notify?: boolean } = {}
  ): Promise<HostTemplateRefreshSummary> {
    const summary = emptySummary(1);
    const state = this.#stateByServer.get(server) ?? { toolsByName: new Map<string, HostTemplateToolRegistration>() };
    this.#stateByServer.set(server, state);

    const fileBackedConfig = { ...config };
    delete (fileBackedConfig as Partial<FlashQueryConfig>).supabase;
    const registry = await assembleTemplateToolRegistry({
      config: fileBackedConfig,
      purposeName: '__host__',
      nativeToolNames: this.#nativeToolCatalog.map((tool) => tool.name),
    });

    for (const conflict of registry.diagnostics.template_tool_conflicts) {
      logger.warn(`host template tool conflict '${conflict.name}' suppressed`);
      summary.conflicts.push({ name: conflict.name, paths: conflict.template_paths });
    }
    for (const warning of registry.diagnostics.template_tool_warnings) {
      logger.warn(`host template tool warning for '${warning.template_path}': ${warning.message}`);
      const diagnostic = {
        path: warning.template_path,
        code: warning.code,
        message: warning.message,
      };
      if (warning.code === 'description_truncated') {
        summary.warnings.push(diagnostic);
      } else {
        summary.skipped.push(diagnostic);
      }
    }

    const desired = new Map(registry.templateTools.map((tool) => [tool.name, tool]));
    const removedSearchKeys: string[] = [];
    const changedSearchTools: TemplateToolDefinition[] = [];
    for (const [name, registration] of [...state.toolsByName.entries()]) {
      if (desired.has(name)) continue;
      registration.handle.remove();
      state.toolsByName.delete(name);
      summary.removed.push({ tool: name, path: registration.templatePath });
      removedSearchKeys.push(name);
    }

    for (const tool of registry.templateTools) {
      const fingerprint = fingerprintTemplateTool(tool);
      const existing = state.toolsByName.get(tool.name);
      if (existing?.fingerprint === fingerprint) {
        summary.unchanged += 1;
        continue;
      }

      if (existing !== undefined) {
        existing.handle.remove();
      }

      const handle = registerHostTemplateTool(server, config, tool);
      state.toolsByName.set(tool.name, {
        templatePath: tool.templatePath,
        fingerprint,
        handle,
      });
      changedSearchTools.push(tool);
      if (existing === undefined) {
        summary.added.push({ tool: tool.name, path: tool.templatePath });
      } else {
        summary.updated.push({ tool: tool.name, path: tool.templatePath });
      }
    }

    for (const removed of summary.removed) {
      const added = summary.added.find((candidate) => candidate.path === removed.path);
      if (added !== undefined && added.tool !== removed.tool) {
        summary.renames = [
          ...(summary.renames ?? []),
          { from: removed.tool, to: added.tool, path: added.path },
        ];
      }
    }

    const searchService = toolSearchServicesByServer.get(server);
    searchService?.removeTemplateTools(removedSearchKeys);
    searchService?.addTemplateTools(changedSearchTools.map((tool) => ({
      name: tool.name,
      templatePath: tool.templatePath,
      description: tool.description,
      parameters: tool.parameters,
    })));

    if (options.notify !== false && (summary.added.length > 0 || summary.removed.length > 0 || summary.updated.length > 0)) {
      try {
        // McpServer types this as void, but the underlying Server.sendToolListChanged
        // returns a rejectable Promise — wrap so the await is type-valid and async
        // notification failures are still caught.
        await Promise.resolve(server.sendToolListChanged());
      } catch (err: unknown) {
        logger.warn(`host template tool refresh notification failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return summary;
  }
}

const managersByCatalog = new WeakMap<readonly NativeToolDefinition[], HostTemplateRegistryManager>();
const knownManagers = new Set<HostTemplateRegistryManager>();
const toolSearchServicesByServer = new WeakMap<McpServer, ToolSearchService>();

function managerForCatalog(nativeToolCatalog: readonly NativeToolDefinition[]): HostTemplateRegistryManager {
  const existing = managersByCatalog.get(nativeToolCatalog);
  if (existing !== undefined) return existing;
  const manager = new HostTemplateRegistryManager({ nativeToolCatalog });
  managersByCatalog.set(nativeToolCatalog, manager);
  knownManagers.add(manager);
  return manager;
}

export function releaseHostTemplateToolsForServer(server: McpServer): void {
  for (const manager of knownManagers) {
    manager.releaseServer(server);
  }
  toolSearchServicesByServer.delete(server);
}

export function bindHostTemplateToolSearchService(server: McpServer, service: ToolSearchService): void {
  toolSearchServicesByServer.set(server, service);
}

export async function registerHostTemplateTools(
  server: McpServer,
  config: FlashQueryConfig,
  options: RegisterHostTemplateToolsOptions
): Promise<void> {
  await managerForCatalog(options.nativeToolCatalog).refreshServer(server, config, { notify: false });
}

export async function refreshHostTemplateToolsForAllSessions(
  config: FlashQueryConfig
): Promise<HostTemplateRefreshSummary> {
  const servers = getRegisteredMcpServers();
  const aggregate = emptySummary(servers.length);
  for (const [index, server] of servers.entries()) {
    try {
      const manager = managerForCatalog(getNativeToolCatalog(server));
      const summary = await manager.refreshServer(server, config);
      mergeSummary(aggregate, summary);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`host template tool refresh failed for session ${index + 1}: ${message}`);
      aggregate.session_failures = [
        ...(aggregate.session_failures ?? []),
        { session: `session-${index + 1}`, message },
      ];
    }
  }
  for (const added of aggregate.added) {
    logger.info(`host template tool enabled: ${added.tool} (${added.path})`);
  }
  for (const updated of aggregate.updated) {
    logger.info(`host template tool updated: ${updated.tool} (${updated.path})`);
  }
  for (const removed of aggregate.removed) {
    logger.info(`host template tool removed: ${removed.tool} (${removed.path})`);
  }
  for (const rename of aggregate.renames ?? []) {
    logger.info(`host template tool renamed: ${rename.from} -> ${rename.to} (${rename.path})`);
  }
  logger.info(
    `host_template_refresh: sessions=${aggregate.sessions} added=${aggregate.added.length} updated=${aggregate.updated.length} removed=${aggregate.removed.length} unchanged=${aggregate.unchanged} skipped=${aggregate.skipped.length} warnings=${aggregate.warnings.length} conflicts=${aggregate.conflicts.length}`
  );
  return aggregate;
}
