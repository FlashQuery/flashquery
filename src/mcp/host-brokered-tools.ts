import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { FlashQueryConfig } from '../config/loader.js';
import { registerUncatalogedTool } from './tool-catalog.js';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveSessionId(extra: unknown): string | undefined {
  if (!isRecord(extra)) return undefined;
  for (const key of ['sessionId', 'session_id', 'transportSessionId']) {
    const value = extra[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const key of ['session', 'transport', 'requestInfo']) {
    const nested = extra[key];
    if (!isRecord(nested)) continue;
    const value = nested['id'] ?? nested['sessionId'] ?? nested['session_id'];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
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
    const objectSchema = z.object(shape);
    if (schema['additionalProperties'] === false) {
      return objectSchema;
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

export async function registerHostBrokeredTools(
  server: McpServer,
  options: RegisterHostBrokeredToolsOptions
): Promise<void> {
  if (options.hostConfig.mcpServers.length === 0) return;

  const initialContext = hostContext(options.traceIdProvider?.(undefined));
  const tools = await options.broker.listToolsForConsumer(initialContext);

  for (const tool of tools) {
    registerUncatalogedTool(
      server,
      tool.registryKey,
      {
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: zodSchemaForJsonSchema(tool.inputSchema),
      },
      async (args: unknown, extra: unknown) => {
        const ctx = hostContext(options.traceIdProvider?.(extra) ?? resolveSessionId(extra));
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
            consumerContext: ctx,
          });
          return result;
        } catch (error: unknown) {
          const normalized = stripRawFromToolError(
            formatToolError(error, { serverId: tool.serverId, toolName: tool.toolName })
          );
          return textResult(normalized.message, true);
        }
      }
    );
  }
}
