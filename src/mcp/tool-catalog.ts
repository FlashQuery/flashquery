import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { NativeToolDefinition, NativeToolHandler } from '../llm/tool-registry.js';
import type { ToolMeta } from '../services/tool-search/tool-meta.js';
import { getToolMetadata } from './tool-metadata.js';

type ToolRegistrationConfig = {
  description?: string;
  inputSchema?: unknown;
};

export type RegisterToolFunction = McpServer['registerTool'];
type ToolCatalogOptions = {
  hostEnabledToolNames?: ReadonlySet<string>;
  toolMeta?: ReadonlyMap<string, ToolMeta>;
  wrapCatalogHandler?: (handler: NativeToolHandler) => NativeToolHandler;
};

const toolCatalogs = new WeakMap<McpServer, NativeToolDefinition[]>();
const wrappedServers = new WeakSet<McpServer>();
const uncatalogedRegisterTool = new WeakMap<McpServer, RegisterToolFunction>();

function injectNativeHelpSchema(inputSchema: unknown): unknown {
  if (inputSchema instanceof z.ZodObject) {
    return inputSchema.extend({ help: z.boolean().optional() });
  }
  if (inputSchema instanceof z.ZodType) {
    return inputSchema;
  }
  if (typeof inputSchema === 'object' && inputSchema !== null && !Array.isArray(inputSchema)) {
    return { ...inputSchema, help: z.boolean().optional() };
  }
  return { help: z.boolean().optional() };
}

function createNativeToolCatalog(): NativeToolDefinition[] {
  return [];
}

export function getNativeToolCatalog(server: McpServer): NativeToolDefinition[] {
  const catalog = toolCatalogs.get(server);
  if (catalog) return catalog;
  const newCatalog = createNativeToolCatalog();
  toolCatalogs.set(server, newCatalog);
  return newCatalog;
}

export function wrapServerWithToolCatalog(server: McpServer, options: ToolCatalogOptions = {}): McpServer {
  if (wrappedServers.has(server)) return server;

  const catalog = getNativeToolCatalog(server);
  const originalRegisterTool = server.registerTool.bind(server);
  uncatalogedRegisterTool.set(server, originalRegisterTool);

  // Preserve the SDK call surface exactly while recording the full native
  // catalog. Host exposure filters SDK registration, not macro/agent dispatch
  // catalog membership.
  server.registerTool = ((name: string, config: ToolRegistrationConfig, cb: unknown) => {
    const metadataDescription = options.toolMeta?.get(name)?.description ?? getToolMetadata(name)?.description;
    const registeredConfig = metadataDescription === undefined
      ? config
      : { ...config, description: metadataDescription };
    const nativeConfig = {
      ...registeredConfig,
      inputSchema: injectNativeHelpSchema(registeredConfig.inputSchema),
    };
    const baseHandler: NativeToolHandler = async (args, context) => {
      return await (cb as NativeToolHandler)(args, context);
    };
    const handler = options.wrapCatalogHandler?.(baseHandler) ?? baseHandler;
    catalog.push({
      name,
      description: nativeConfig.description ?? '',
      inputSchema: nativeConfig.inputSchema ?? {},
      handler,
    });
    if (options.hostEnabledToolNames && !options.hostEnabledToolNames.has(name)) {
      return undefined;
    }
    return originalRegisterTool(name, nativeConfig as never, cb as never);
  }) as RegisterToolFunction;

  wrappedServers.add(server);
  return server;
}

export function registerUncatalogedTool(
  server: McpServer,
  name: string,
  config: ToolRegistrationConfig,
  cb: unknown
): unknown {
  const registerTool = uncatalogedRegisterTool.get(server) ?? server.registerTool.bind(server);
  return registerTool(name, config as never, cb as never);
}
