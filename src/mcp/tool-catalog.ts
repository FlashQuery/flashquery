import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NativeToolDefinition } from '../llm/tool-registry.js';

type ToolRegistrationConfig = {
  description?: string;
  inputSchema?: unknown;
};

type RegisterToolFunction = McpServer['registerTool'];

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

export function wrapServerWithToolCatalog(server: McpServer): McpServer {
  if (wrappedServers.has(server)) return server;

  const catalog = getNativeToolCatalog(server);
  const originalRegisterTool = server.registerTool.bind(server);

  // Preserve the SDK call surface exactly while recording model-visible metadata.
  server.registerTool = ((name: string, config: ToolRegistrationConfig, cb: unknown) => {
    catalog.push({
      name,
      description: config.description ?? '',
      inputSchema: config.inputSchema ?? {},
    });
    return originalRegisterTool(name, config, cb as never);
  }) as RegisterToolFunction;

  wrappedServers.add(server);
  return server;
}
