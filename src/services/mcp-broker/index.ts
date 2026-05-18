import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BrokerClient } from './client.js';
import { diffToolSnapshots } from './diff.js';
import { formatToolError, toThrowableToolError } from './errors.js';
import { ToolRegistry, type ToolRegistryConfig } from './registry.js';
import { InMemoryTofuStore } from './tofu.js';
import type {
  Broker,
  BrokerClientConfig,
  BrokerConnectionOptions,
  BrokeredTool,
  BrokerToolRef,
  ConsumerContext,
  RegistryKey,
  TofuDriftBundle,
  TofuDriftPayload,
  ToolIndexSink,
} from './types.js';

export { BrokerClient } from './client.js';
export { diffToolSnapshots } from './diff.js';
export { formatToolError, stripRawFromToolError, toThrowableToolError } from './errors.js';
export { ToolRegistry, isRegistryKey, makeRegistryKey, parseMacroRef, parseRegistryKey } from './registry.js';
export { clearBrokeredToolCallTrace, getBrokeredToolCallTraceSnapshot, recordBrokeredToolCall } from './trace.js';
export { InMemoryTofuStore, canonicalJson, hashToolSchema } from './tofu.js';
export type * from './types.js';

export interface BrokerConfig extends ToolRegistryConfig {
  mcpServers?: Record<string, BrokerClientConfig>;
  indexSink?: ToolIndexSink;
  onTofuDrift?: (bundle: TofuDriftBundle) => void | Promise<void>;
}

const NOOP_INDEX_SINK: ToolIndexSink = {
  addTools: () => undefined,
  removeTools: () => undefined,
};

export class McpBroker implements Broker {
  readonly #clients: Map<string, BrokerClient>;
  readonly #registry: ToolRegistry;
  readonly #tofuStore = new InMemoryTofuStore();
  readonly #indexSink: ToolIndexSink;
  readonly #onTofuDrift?: (bundle: TofuDriftBundle) => void | Promise<void>;

  constructor(config: BrokerConfig) {
    this.#indexSink = config.indexSink ?? NOOP_INDEX_SINK;
    this.#onTofuDrift = config.onTofuDrift;
    this.#clients = new Map(
      Object.entries(config.mcpServers ?? {}).map(([serverId, serverConfig]) => [
        serverId,
        new BrokerClient({
          ...serverConfig,
          serverId,
          onToolListChanged: async (changedServerId, tools) => {
            await this.applyToolListSnapshot(changedServerId, tools);
            await serverConfig.onToolListChanged?.(changedServerId, tools);
          },
        }),
      ])
    );
    this.#registry = new ToolRegistry(config);
  }

  async ensureConnected(serverId: string): Promise<void> {
    const client = this.#client(serverId);
    await client.ensureConnected();
    await this.applyToolListSnapshot(serverId, await client.listTools());
  }

  async applyToolListSnapshot(serverId: string, refreshedTools: BrokeredTool[]): Promise<void> {
    const previousTools = this.#registry.listAll().filter((tool) => tool.serverId === serverId);
    const diff = diffToolSnapshots(previousTools, refreshedTools);
    const removedKeys = this.#removeTools([...diff.removed, ...diff.changed]);
    if (removedKeys.length > 0) {
      this.#indexSink.removeTools(removedKeys);
    }

    const toolsToAdd: BrokeredTool[] = [];
    const drifts: TofuDriftPayload[] = [];
    for (const tool of [...diff.added, ...diff.changed]) {
      const observation = this.#tofuStore.observe({
        serverId,
        toolName: tool.toolName,
        description: tool.upstreamDescription ?? tool.description,
        inputSchema: tool.inputSchema,
      });
      if (observation.status === 'trusted') {
        toolsToAdd.push(this.#registry.registerTool(tool));
      } else if (observation.drift !== undefined) {
        drifts.push(observation.drift);
      }
    }

    for (const tool of diff.removed) {
      this.#tofuStore.markRemoved(serverId, tool.toolName);
    }

    if (toolsToAdd.length > 0) {
      this.#indexSink.addTools(toolsToAdd);
    }
    if (drifts.length > 0) {
      await this.#onTofuDrift?.({ event: 'schema_drift_detected', server: serverId, changes: drifts });
    }
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
    await Promise.all(
      this.#registry
        .listVisibleServerIds(ctx)
        .filter((serverId) => this.#clients.has(serverId))
        .map((serverId) => this.ensureConnected(serverId))
    );
    return this.#registry.listToolsForConsumer(ctx);
  }

  async shutdown(graceMs?: number): Promise<void> {
    await Promise.all([...this.#clients.values()].map((client) => client.shutdown(graceMs)));
  }

  #client(serverId: string): BrokerClient {
    const client = this.#clients.get(serverId);
    if (client === undefined) {
      throw toThrowableToolError(formatToolError(new Error(`Unknown MCP broker server '${serverId}'.`), { serverId }));
    }
    return client;
  }

  #removeTools(tools: BrokeredTool[]): RegistryKey[] {
    return this.#registry.unregisterTools(tools.map((tool) => tool.registryKey));
  }
}

export class NullBroker implements Broker {
  ensureConnected(serverId: string): Promise<void> {
    return Promise.reject(toThrowableToolError(formatToolError(new Error('No MCP broker is configured.'), { serverId })));
  }

  isConnected(_serverId: string, _opts?: BrokerConnectionOptions): Promise<boolean> {
    return Promise.resolve(false);
  }

  callTool(ref: BrokerToolRef, _args: unknown, _ctx: ConsumerContext): Promise<CallToolResult> {
    return Promise.reject(toThrowableToolError(formatToolError(new Error('No MCP broker is configured.'), ref)));
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
