import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NativeToolDefinition, NativeToolHandler } from '../llm/tool-registry.js';
import { getToolMetadata } from './tool-metadata.js';

type ToolRegistrationConfig = {
  description?: string;
  inputSchema?: unknown;
};

type RegisterToolFunction = McpServer['registerTool'];
type ToolCatalogOptions = {
  hostEnabledToolNames?: ReadonlySet<string>;
};

const toolCatalogs = new WeakMap<McpServer, NativeToolDefinition[]>();
const wrappedServers = new WeakSet<McpServer>();

export function createNativeToolCatalog(): NativeToolDefinition[] {
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

  // Preserve the SDK call surface exactly while recording the full native
  // catalog. Host exposure filters SDK registration, not macro/agent dispatch
  // catalog membership.
  server.registerTool = ((name: string, config: ToolRegistrationConfig, cb: unknown) => {
    const metadataDescription = getToolMetadata(name)?.description;
    const registeredConfig = metadataDescription === undefined
      ? config
      : { ...config, description: metadataDescription };
    const handler: NativeToolHandler = async (args, context) => {
      return await (cb as NativeToolHandler)(args, context);
    };
    catalog.push({
      name,
      description: registeredConfig.description ?? '',
      inputSchema: registeredConfig.inputSchema ?? {},
      handler,
    });
    if (options.hostEnabledToolNames && !options.hostEnabledToolNames.has(name)) {
      return undefined;
    }
    return originalRegisterTool(name, registeredConfig, cb as never);
  }) as RegisterToolFunction;

  wrappedServers.add(server);
  return server;
}
