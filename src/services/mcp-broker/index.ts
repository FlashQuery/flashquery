import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BrokerClient } from './client.js';
import { formatToolError } from './errors.js';
import { ToolRegistry, type ToolRegistryConfig } from './registry.js';
import type { Broker, BrokerClientConfig, BrokerConnectionOptions, BrokeredTool, BrokerToolRef, ConsumerContext } from './types.js';

export { BrokerClient } from './client.js';
export { formatToolError, stripRawFromToolError } from './errors.js';
export { ToolRegistry, isRegistryKey, makeRegistryKey, parseMacroRef, parseRegistryKey } from './registry.js';
export { canonicalJson, hashToolSchema } from './tofu.js';
export type * from './types.js';

export interface BrokerConfig extends ToolRegistryConfig {
  mcpServers?: Record<string, BrokerClientConfig>;
}

export class McpBroker implements Broker {
  readonly #clients: Map<string, BrokerClient>;
  readonly #registry: ToolRegistry;

  constructor(config: BrokerConfig) {
    this.#clients = new Map(
      Object.entries(config.mcpServers ?? {}).map(([serverId, serverConfig]) => [
        serverId,
        new BrokerClient({ ...serverConfig, serverId }),
      ])
    );
    this.#registry = new ToolRegistry(config);
  }

  async ensureConnected(serverId: string): Promise<void> {
    const client = this.#client(serverId);
    await client.ensureConnected();
    this.#registry.registerTools(await client.listTools());
  }

  async callTool(ref: BrokerToolRef, args: unknown, ctx: ConsumerContext): Promise<CallToolResult> {
    await this.ensureConnected(ref.serverId);
    return this.#client(ref.serverId).callTool(ref.toolName, args, ctx);
  }

  async isConnected(serverId: string, opts?: BrokerConnectionOptions): Promise<boolean> {
    const client = this.#clients.get(serverId);
    if (client === undefined) return false;
    return client.isConnected(opts);
  }

  async listToolsForConsumer(ctx: ConsumerContext): Promise<BrokeredTool[]> {
    return this.#registry.listToolsForConsumer(ctx);
  }

  async shutdown(graceMs?: number): Promise<void> {
    await Promise.all([...this.#clients.values()].map((client) => client.shutdown(graceMs)));
  }

  #client(serverId: string): BrokerClient {
    const client = this.#clients.get(serverId);
    if (client === undefined) throw formatToolError(new Error(`Unknown MCP broker server '${serverId}'.`), { serverId });
    return client;
  }
}

export class NullBroker implements Broker {
  ensureConnected(serverId: string): Promise<void> {
    return Promise.reject(formatToolError(new Error('No MCP broker is configured.'), { serverId }));
  }

  isConnected(_serverId: string, _opts?: BrokerConnectionOptions): Promise<boolean> {
    return Promise.resolve(false);
  }

  callTool(ref: BrokerToolRef, _args: unknown, _ctx: ConsumerContext): Promise<CallToolResult> {
    return Promise.reject(formatToolError(new Error('No MCP broker is configured.'), ref));
  }

  listToolsForConsumer(_ctx: ConsumerContext): Promise<BrokeredTool[]> {
    return Promise.resolve([]);
  }

  shutdown(_graceMs?: number): Promise<void> {
    return Promise.resolve();
  }
}

export function createBroker(config: BrokerConfig): McpBroker {
  return new McpBroker(config);
}
