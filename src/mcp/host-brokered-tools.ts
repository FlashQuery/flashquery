import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../config/loader.js';
import {
  formatToolError,
  recordBrokeredToolCall,
  stripRawFromToolError,
  type Broker,
  type BrokeredTool,
  type ConsumerContext,
  type TofuDriftPayload,
} from '../services/mcp-broker.js';

type HostConfig = NonNullable<FlashQueryConfig['host']>;

export interface RegisterHostBrokeredToolsOptions {
  broker: Broker;
  hostConfig: HostConfig;
  traceIdProvider?: (extra: unknown) => string | undefined;
}

function textResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

function hostContext(traceId: string | undefined): ConsumerContext {
  return {
    kind: 'host',
    traceId: traceId ?? '',
    interactive: true,
  };
}

function sameServerDrifts(drifts: TofuDriftPayload[], serverId: string): TofuDriftPayload[] {
  return drifts.filter((drift) => drift.server === serverId);
}

function driftResponse(drifts: TofuDriftPayload[], serverId: string, toolName: string): CallToolResult | undefined {
  const serverDrifts = sameServerDrifts(drifts, serverId);
  const requestedDrift = serverDrifts.find((drift) => drift.tool === toolName);
  if (requestedDrift === undefined) return undefined;
  const payload =
    serverDrifts.length > 1
      ? { event: 'schema_drift_detected' as const, server: serverId, changes: serverDrifts }
      : requestedDrift;
  return textResult(JSON.stringify(payload), true);
}

function findVisibleTool(tools: BrokeredTool[], registryKey: string): BrokeredTool | undefined {
  return tools.find((tool) => tool.registryKey === registryKey);
}

export async function registerHostBrokeredTools(
  server: McpServer,
  options: RegisterHostBrokeredToolsOptions
): Promise<void> {
  if (options.hostConfig.mcpServers.length === 0) return;

  const initialContext = hostContext(options.traceIdProvider?.(undefined));
  const tools = await options.broker.listToolsForConsumer(initialContext);

  for (const tool of tools) {
    server.registerTool(
      tool.registryKey,
      {
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
      } as never,
      (async (args: unknown, extra: unknown) => {
        const ctx = hostContext(options.traceIdProvider?.(extra));
        const visibleTools = await options.broker.listToolsForConsumer(ctx);
        const visibleTool = findVisibleTool(visibleTools, tool.registryKey);
        if (visibleTool === undefined) {
          const drift = driftResponse(
            options.broker.getPendingSchemaDrift(ctx),
            tool.serverId,
            tool.toolName
          );
          if (drift !== undefined) return drift;
          return textResult(`Tool '${tool.registryKey}' is not available.`, true);
        }

        try {
          const result = await options.broker.callTool(
            { serverId: tool.serverId, toolName: tool.toolName },
            args,
            ctx
          );
          recordBrokeredToolCall({
            traceId: ctx.traceId,
            serverId: tool.serverId,
            toolName: tool.toolName,
            costPerCall: visibleTool.costPerCall,
          });
          return result;
        } catch (error: unknown) {
          const normalized = stripRawFromToolError(
            formatToolError(error, { serverId: tool.serverId, toolName: tool.toolName })
          );
          return textResult(normalized.message, true);
        }
      }) as never
    );
  }
}
