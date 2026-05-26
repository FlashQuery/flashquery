import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpRequestLifecycle } from './request-lifecycle.js';

const mcpRequestLifecycles = new WeakMap<McpServer, McpRequestLifecycle>();
const shutdownMcpServers = new Set<McpServer>();

export function registerMcpRequestLifecycle(
  server: McpServer,
  lifecycle: McpRequestLifecycle
): void {
  mcpRequestLifecycles.set(server, lifecycle);
  shutdownMcpServers.add(server);
}

export function unregisterMcpServerForShutdown(server: McpServer): void {
  shutdownMcpServers.delete(server);
  mcpRequestLifecycles.delete(server);
}

export function getRegisteredMcpServers(): McpServer[] {
  return [...shutdownMcpServers];
}

export function getMcpRequestLifecycleForServer(server: McpServer): McpRequestLifecycle {
  const lifecycle = mcpRequestLifecycles.get(server);
  if (!lifecycle) {
    throw new Error('MCP request lifecycle has not been initialized for this server');
  }
  return lifecycle;
}
