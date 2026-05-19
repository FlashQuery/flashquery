// FakeBroker — implements the production `McpBroker` (Broker) interface
// verbatim so the macro engine sees the same API in tests as in production.
//
// Per Macro Testing Framework Requirements §11.4 substitution-readiness:
//   - Single injection point: tests pass a `FakeBroker` instance to
//     `evaluateProgram({ broker })` via the runner.
//   - No extra methods exposed beyond the `Broker` interface (the
//     test-only observation members are documented as outside the
//     production-shape contract).
//   - `CallToolResult` output shape conforms (we delegate to the
//     archetypes which produce shapes consistent with
//     `@modelcontextprotocol/sdk`).
//   - Config shape mirrors `flashquery.yml` `mcp_servers` conceptually
//     (server -> tool -> handler); the YAML test schema maps `tools:`
//     to this shape.
//
// Justification (INV-MTF-06 (a) absent): real third-party MCP brokers cannot
// be steered to produce specific edge-case responses on demand; the macro
// engine's dispatch behavior against a controlled tool surface is what we're
// testing. See §5.7 for the full reasoning on why fakes remain primary
// permanently.

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  Broker,
  BrokerConnectionOptions,
  BrokerToolRef,
  BrokeredTool,
  ConsumerContext,
  RegistryKey,
  SchemaDriftDecisionInput,
  SchemaDriftResolution,
  SchemaDriftResolutionContext,
  TofuDriftPayload,
  ToolListSnapshotOptions,
} from '../../../../src/services/mcp-broker/types.js';
import type { ArchetypeContext, ArchetypeHandler, DriftMarkedHandler } from './archetypes.ts';

function isDriftMarkedHandler(
  h: ArchetypeHandler | DriftMarkedHandler,
): h is DriftMarkedHandler {
  return (h as DriftMarkedHandler).__tofuDriftPayload !== undefined;
}

export interface FakeServerConfig {
  /** Tool name -> archetype handler (factory output). */
  tools: Record<string, ArchetypeHandler>;
}

export interface FakeBrokerConfig {
  /** Server id -> server config. */
  servers: Record<string, FakeServerConfig>;
}

export interface ToolCallRecord {
  server: string;
  tool: string;
  args: unknown;
  ctx: ConsumerContext;
  result?: CallToolResult;
  error?: { message: string };
  callIndex: number;
}

export class FakeBroker implements Broker {
  private readonly servers: Map<string, FakeServerConfig>;
  // server::tool -> call count (drives ScriptedTool indexing).
  private readonly callCounts = new Map<string, number>();
  // Observable call log for assertions.
  public readonly callLog: ToolCallRecord[] = [];

  constructor(config: FakeBrokerConfig = { servers: {} }) {
    this.servers = new Map(Object.entries(config.servers));
  }

  // ------- Broker interface (production-shape) -------

  async ensureConnected(serverId: string, _options: ToolListSnapshotOptions = {}): Promise<void> {
    if (!this.servers.has(serverId)) {
      throw new Error(`FakeBroker: unknown server ${serverId}`);
    }
  }

  async isConnected(serverId: string, _opts?: BrokerConnectionOptions): Promise<boolean> {
    return this.servers.has(serverId);
  }

  async callTool(
    ref: BrokerToolRef,
    args: unknown,
    ctx: ConsumerContext,
  ): Promise<CallToolResult> {
    const server = this.servers.get(ref.serverId);
    if (!server) {
      throw new Error(`FakeBroker: unknown server ${ref.serverId}`);
    }
    const handler = server.tools[ref.toolName];
    if (!handler) {
      throw new Error(`FakeBroker: unknown tool ${ref.serverId}.${ref.toolName}`);
    }
    const key = `${ref.serverId}::${ref.toolName}`;
    const callIndex = this.callCounts.get(key) ?? 0;
    this.callCounts.set(key, callIndex + 1);

    const archCtx: ArchetypeContext = {
      server: ref.serverId,
      tool: ref.toolName,
      callIndex,
    };
    try {
      const result = await handler(args, archCtx);
      this.callLog.push({
        server: ref.serverId,
        tool: ref.toolName,
        args,
        ctx,
        result,
        callIndex,
      });
      return result;
    } catch (e) {
      const err = e as Error;
      this.callLog.push({
        server: ref.serverId,
        tool: ref.toolName,
        args,
        ctx,
        error: { message: err.message },
        callIndex,
      });
      throw e;
    }
  }

  async listToolsForConsumer(_ctx: ConsumerContext): Promise<BrokeredTool[]> {
    const out: BrokeredTool[] = [];
    for (const [serverId, cfg] of this.servers) {
      for (const [toolName, handler] of Object.entries(cfg.tools)) {
        // Drift-marked tools are hidden from the visible list so
        // production's pre-dispatch check at `registry.ts:156` sees
        // `visibleTool === undefined` and falls into the pending-drift
        // branch. See archetypes.ts NeedsInputViaTofuDrift comment.
        if (isDriftMarkedHandler(handler)) continue;
        const registryKey: RegistryKey = `${serverId}.${toolName}`;
        out.push({
          serverId,
          toolName,
          registryKey,
          inputSchema: { type: 'object' },
          tofuHash: 'fake',
          costPerCall: 0,
        });
      }
    }
    return out;
  }

  getPendingSchemaDrift(_ctx: SchemaDriftResolutionContext = {}): TofuDriftPayload[] {
    // Surface drift-marked tools as pending TOFU re-approvals so
    // production's pre-dispatch check at `registry.ts:156-174` finds
    // them and throws `MacroNeedsUserInputError` with the REQ-042
    // payload.
    const out: TofuDriftPayload[] = [];
    for (const [, cfg] of this.servers) {
      for (const handler of Object.values(cfg.tools)) {
        if (isDriftMarkedHandler(handler)) {
          out.push(handler.__tofuDriftPayload as TofuDriftPayload);
        }
      }
    }
    return out;
  }

  resolveSchemaDrift(
    _decisions: SchemaDriftDecisionInput[],
    _ctx: SchemaDriftResolutionContext = {},
  ): SchemaDriftResolution[] {
    return [];
  }

  async shutdown(_graceMs?: number): Promise<void> {
    // No external resources; nothing to release.
  }

  // ------- Test-only observation (NOT on the Broker interface) -------
  // Per §11.4 these stay strictly here; the macro engine sees only the
  // `Broker` interface above.

  callsFor(server: string, tool: string): ToolCallRecord[] {
    return this.callLog.filter((c) => c.server === server && c.tool === tool);
  }

  reset(): void {
    this.callCounts.clear();
    this.callLog.length = 0;
  }
}
