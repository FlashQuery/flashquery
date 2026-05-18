import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../logging/logger.js';
import { BrokerClient } from './client.js';
import { diffToolSnapshots } from './diff.js';
import { formatToolError, toThrowableToolError } from './errors.js';
import { ToolRegistry, type ToolRegistryConfig } from './registry.js';
import { recordBrokerAuditEvent } from './trace.js';
import { InMemoryTofuStore } from './tofu.js';
import { SchemaDriftNeedsUserInputError } from './types.js';
import type {
  Broker,
  BrokerAuditEvent,
  BrokerAuditEventInput,
  BrokerClientConfig,
  BrokerConnectionOptions,
  BrokeredTool,
  BrokerToolRef,
  ConsumerContext,
  RegistryKey,
  SchemaDriftDecisionInput,
  SchemaDriftResolution,
  SchemaDriftResolutionContext,
  TofuDriftBundle,
  TofuDriftPayload,
  ToolSurfaceChange,
  ToolSurfaceChangeListener,
  ToolListSnapshotOptions,
  ToolIndexSink,
} from './types.js';

export { BrokerClient } from './client.js';
export { diffToolSnapshots } from './diff.js';
export { formatToolError, stripRawFromToolError, toThrowableToolError } from './errors.js';
export { ToolRegistry, isRegistryKey, makeRegistryKey, parseMacroRef, parseRegistryKey } from './registry.js';
export {
  clearBrokerAuditTrace,
  clearBrokeredToolCallTrace,
  getBrokerAuditTraceSnapshot,
  getBrokeredToolCallTraceSnapshot,
  recordBrokerAuditEvent,
  recordBrokeredToolCall,
} from './trace.js';
export { InMemoryTofuStore, canonicalJson, hashToolSchema } from './tofu.js';
export { SchemaDriftNeedsUserInputError } from './types.js';
export type * from './types.js';

export interface BrokerConfig extends ToolRegistryConfig {
  mcpServers?: Record<string, BrokerClientConfig>;
  indexSink?: ToolIndexSink;
  onTofuDrift?: (bundle: TofuDriftBundle) => void | Promise<void>;
  onAudit?: (event: BrokerAuditEvent) => void;
}

export interface BrokerClientDebugSnapshot {
  pid: number | null;
  spawnCount: number;
  restartCount: number;
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
  readonly #onAudit?: (event: BrokerAuditEvent) => void;
  readonly #pendingTools = new Map<RegistryKey, BrokeredTool>();
  readonly #pendingDrifts = new Map<RegistryKey, TofuDriftPayload>();
  readonly #toolSurfaceListeners = new Set<ToolSurfaceChangeListener>();

  constructor(config: BrokerConfig) {
    this.#indexSink = config.indexSink ?? NOOP_INDEX_SINK;
    this.#onTofuDrift = config.onTofuDrift;
    this.#onAudit = config.onAudit;
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

  async ensureConnected(serverId: string, options: ToolListSnapshotOptions = {}): Promise<void> {
    const client = this.#client(serverId);
    await client.ensureConnected();
    await this.applyToolListSnapshot(serverId, await client.listTools(), options);
  }

  async applyToolListSnapshot(
    serverId: string,
    refreshedTools: BrokeredTool[],
    options: ToolListSnapshotOptions = {}
  ): Promise<void> {
    const interactive = options.interactive ?? true;
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
        this.#pendingTools.delete(tool.registryKey);
        this.#pendingDrifts.delete(tool.registryKey);
        toolsToAdd.push(this.#registry.registerTool(tool));
      } else if (observation.drift !== undefined) {
        this.#pendingTools.set(tool.registryKey, tool);
        this.#pendingDrifts.set(tool.registryKey, observation.drift);
        drifts.push(observation.drift);
        if (!interactive) {
          this.#emitAudit({
            type: 'mcp_broker_tofu_blocked',
            server: serverId,
            tool: tool.toolName,
            status: 'blocked_on_user',
            old_hash: observation.entry.trustedHash,
            new_hash: observation.entry.pendingHash ?? tool.tofuHash,
            ...(options.traceId === undefined ? {} : { trace_id: options.traceId }),
            ...(options.purposeId === undefined ? {} : { purpose_id: options.purposeId }),
          });
        }
      }
    }

    for (const tool of diff.removed) {
      this.#tofuStore.markRemoved(serverId, tool.toolName);
      this.#pendingTools.delete(tool.registryKey);
      this.#pendingDrifts.delete(tool.registryKey);
    }

    if (toolsToAdd.length > 0) {
      this.#indexSink.addTools(toolsToAdd);
    }
    this.#emitToolSurfaceChange({ added: toolsToAdd, removed: removedKeys });
    if (interactive && drifts.length > 0) {
      await this.#onTofuDrift?.({ event: 'schema_drift_detected', server: serverId, changes: drifts });
    }
  }

  getPendingSchemaDrift(_ctx: SchemaDriftResolutionContext = {}): TofuDriftPayload[] {
    return [...this.#pendingDrifts.values()].map((payload) => structuredClone(payload));
  }

  resolveSchemaDrift(
    decisions: SchemaDriftDecisionInput[],
    ctx: SchemaDriftResolutionContext = {}
  ): SchemaDriftResolution[] {
    const resolved: SchemaDriftResolution[] = [];
    for (const decision of decisions) {
      const pendingKey = `${decision.server}__${decision.tool}`;
      const pendingTool = this.#pendingTools.get(pendingKey);
      const before = this.#tofuStore.get(decision.server, decision.tool);
      if (before?.pendingHash === undefined) {
        continue;
      }

      if (decision.decision === 'approve') {
        if (pendingTool === undefined) continue;
        const approved = this.#tofuStore.approve(decision.server, decision.tool);
        const registered = this.#registry.registerTool({
          ...pendingTool,
          tofuHash: approved.entry.trustedHash,
        });
        this.#indexSink.addTools([registered]);
        this.#emitToolSurfaceChange({ added: [registered], removed: [] });
        this.#pendingTools.delete(pendingKey);
        this.#pendingDrifts.delete(pendingKey);
        this.#emitDecisionAudit(decision, before.trustedHash, before.pendingHash, ctx);
        resolved.push({ server: decision.server, tool: decision.tool, decision: 'approve' });
        continue;
      }

      this.#tofuStore.reject(decision.server, decision.tool);
      this.#pendingTools.delete(pendingKey);
      this.#pendingDrifts.delete(pendingKey);
      this.#emitDecisionAudit(decision, before.trustedHash, before.pendingHash, ctx);
      resolved.push({ server: decision.server, tool: decision.tool, decision: 'reject' });
    }
    return resolved;
  }

  async callTool(ref: BrokerToolRef, args: unknown, ctx: ConsumerContext): Promise<CallToolResult> {
    await this.ensureConnected(ref.serverId, snapshotOptionsFromConsumerContext(ctx));
    const visible = this.#registry
      .listToolsForConsumer(ctx)
      .some((tool) => tool.serverId === ref.serverId && tool.toolName === ref.toolName);
    if (!visible) {
      const pendingDrift = this.getPendingSchemaDrift(schemaDriftContextFromConsumerContext(ctx))
        .find((drift) => drift.server === ref.serverId && drift.tool === ref.toolName);
      if (pendingDrift !== undefined) {
        throw new SchemaDriftNeedsUserInputError(pendingDrift);
      }
      throw toThrowableToolError(
        formatToolError(new Error(`Tool '${ref.serverId}.${ref.toolName}' is not available.`), ref)
      );
    }
    return this.#client(ref.serverId).callTool(ref.toolName, args, ctx);
  }

  async isConnected(serverId: string, opts?: BrokerConnectionOptions): Promise<boolean> {
    const client = this.#clients.get(serverId);
    if (client === undefined) return false;
    return client.isConnected(opts);
  }

  getClientDebugSnapshot(serverId: string): BrokerClientDebugSnapshot | null {
    const client = this.#clients.get(serverId);
    if (client === undefined) return null;
    return {
      pid: client.pid,
      spawnCount: client.spawnCount,
      restartCount: client.restartCount,
    };
  }

  async listToolsForConsumer(ctx: ConsumerContext): Promise<BrokeredTool[]> {
    await Promise.allSettled(
      this.#registry
        .listVisibleServerIds(ctx)
        .filter((serverId) => this.#clients.has(serverId))
        .map((serverId) => this.ensureConnected(serverId, snapshotOptionsFromConsumerContext(ctx)))
    );
    return this.#registry.listToolsForConsumer(ctx);
  }

  subscribeToolSurfaceChanges(listener: ToolSurfaceChangeListener): () => void {
    this.#toolSurfaceListeners.add(listener);
    return () => {
      this.#toolSurfaceListeners.delete(listener);
    };
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

  #emitDecisionAudit(
    decision: SchemaDriftDecisionInput,
    oldHash: string,
    newHash: string,
    ctx: SchemaDriftResolutionContext
  ): void {
    this.#emitAudit({
      type: 'mcp_broker_tofu_decision',
      server: decision.server,
      tool: decision.tool,
      decision: decision.decision,
      old_hash: oldHash,
      new_hash: newHash,
      ...(ctx.traceId === undefined ? {} : { trace_id: ctx.traceId }),
      ...(ctx.purposeId === undefined ? {} : { purpose_id: ctx.purposeId }),
    });
  }

  #emitToolSurfaceChange(change: ToolSurfaceChange): void {
    if (change.added.length === 0 && change.removed.length === 0) return;
    for (const listener of this.#toolSurfaceListeners) {
      void Promise.resolve(listener(change)).catch((error: unknown) => {
        logger?.warn(
          `mcp_broker_tool_surface_listener_failed message=${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }
  }

  #emitAudit(event: BrokerAuditEventInput): void {
    const timestamped = recordBrokerAuditEvent(event);
    this.#onAudit?.(timestamped);
    if (timestamped.type === 'mcp_broker_tofu_decision') {
      logger?.warn(
        `mcp_broker_tofu_decision ts=${timestamped.ts} server=${timestamped.server} tool=${timestamped.tool} decision=${timestamped.decision}${
          timestamped.trace_id === undefined ? '' : ` trace_id=${timestamped.trace_id}`
        }`
      );
    } else if (timestamped.type === 'mcp_broker_tofu_blocked') {
      logger?.warn(
        `mcp_broker_tofu_blocked ts=${timestamped.ts} server=${timestamped.server} tool=${timestamped.tool} status=${timestamped.status}${
          timestamped.trace_id === undefined ? '' : ` trace_id=${timestamped.trace_id}`
        }`
      );
    }
  }
}

export class NullBroker implements Broker {
  ensureConnected(serverId: string, _options: ToolListSnapshotOptions = {}): Promise<void> {
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

  subscribeToolSurfaceChanges(_listener: ToolSurfaceChangeListener): () => void {
    return () => undefined;
  }

  getPendingSchemaDrift(_ctx: SchemaDriftResolutionContext = {}): TofuDriftPayload[] {
    return [];
  }

  resolveSchemaDrift(
    _decisions: SchemaDriftDecisionInput[],
    _ctx: SchemaDriftResolutionContext = {}
  ): SchemaDriftResolution[] {
    return [];
  }

  shutdown(_graceMs?: number): Promise<void> {
    return Promise.resolve();
  }
}

export function createBroker(config: BrokerConfig): McpBroker {
  return new McpBroker(config);
}

function snapshotOptionsFromConsumerContext(ctx: ConsumerContext): ToolListSnapshotOptions {
  return {
    ...(ctx.interactive === undefined ? {} : { interactive: ctx.interactive }),
    traceId: ctx.traceId,
    ...(ctx.kind === 'purpose' ? { purposeId: ctx.purposeId } : {}),
  };
}

function schemaDriftContextFromConsumerContext(ctx: ConsumerContext): SchemaDriftResolutionContext {
  return {
    traceId: ctx.traceId,
    ...(ctx.kind === 'purpose' ? { purposeId: ctx.purposeId } : {}),
  };
}
