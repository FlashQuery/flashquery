import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { FlashQueryConfig } from '../config/loader.js';
import {
  assembleTemplateToolRegistry,
  dispatchTemplateToolCall,
  type TemplateToolDefinition,
} from '../llm/template-tools.js';
import type { NativeToolDefinition } from '../llm/tool-registry.js';
import { logger } from '../logging/logger.js';
import { registerUncatalogedTool } from './tool-catalog.js';

export interface RegisterHostTemplateToolsOptions {
  nativeToolCatalog: readonly NativeToolDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
      return objectSchema.strict();
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

function parseTemplateToolPayload(text: string): { payload: Record<string, unknown> | undefined; isError: boolean } {
  try {
    const payload = JSON.parse(text) as unknown;
    if (!isRecord(payload)) return { payload: undefined, isError: false };
    return { payload, isError: payload['ok'] === false };
  } catch {
    return { payload: undefined, isError: false };
  }
}

function callResultFromTemplateText(text: string): CallToolResult {
  const { payload, isError } = parseTemplateToolPayload(text);
  return {
    content: [{ type: 'text', text }],
    ...(payload === undefined ? {} : { structuredContent: payload }),
    ...(isError ? { isError: true } : {}),
  };
}

function registerHostTemplateTool(
  server: McpServer,
  config: FlashQueryConfig,
  tool: TemplateToolDefinition
): RegisteredTool {
  return registerUncatalogedTool(
    server,
    tool.name,
    {
      description: tool.description,
      inputSchema: zodSchemaForJsonSchema(tool.parameters),
    },
    async (args: unknown) => {
      const result = await dispatchTemplateToolCall({
        config,
        toolCall: {
          id: `host_template_${tool.name}`,
          type: 'function',
          function: {
            name: tool.name,
            arguments: args,
          },
        },
        templateReverseMap: new Map([[tool.name, tool.templatePath]]),
      });
      return callResultFromTemplateText(result.message.content);
    }
  ) as RegisteredTool;
}

export async function registerHostTemplateTools(
  server: McpServer,
  config: FlashQueryConfig,
  options: RegisterHostTemplateToolsOptions
): Promise<void> {
  const fileBackedConfig = { ...config };
  delete (fileBackedConfig as Partial<FlashQueryConfig>).supabase;
  const registry = await assembleTemplateToolRegistry({
    config: fileBackedConfig,
    purposeName: '__host__',
    nativeToolNames: options.nativeToolCatalog.map((tool) => tool.name),
  });

  for (const conflict of registry.diagnostics.template_tool_conflicts) {
    logger.warn(`host template tool conflict '${conflict.name}' suppressed`);
  }
  for (const warning of registry.diagnostics.template_tool_warnings) {
    logger.warn(`host template tool warning for '${warning.template_path}': ${warning.message}`);
  }

  for (const tool of registry.templateTools) {
    registerHostTemplateTool(server, config, tool);
  }
}
