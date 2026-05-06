import type { FlashQueryConfig } from '../config/loader.js';
import type { logger } from '../logging/logger.js';
import { z } from 'zod';

export interface NativeToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface NativeToolDispatchContext {
  signal: AbortSignal;
  traceId?: string | null;
  instanceId: string;
  logger?: Pick<typeof logger, 'debug' | 'warn' | 'error'>;
  logContext?: Record<string, unknown>;
}

export type NativeToolHandler = (
  args: Record<string, unknown>,
  context: NativeToolDispatchContext
) => Promise<NativeToolResponse>;

export interface NativeToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: NativeToolHandler;
  openAiStrict?: OpenAiToolDefinition;
  openAiNonStrict?: OpenAiToolDefinition;
}

export interface OpenAiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: true;
  };
}

export interface ToolRegistryDiagnostics {
  expandedTiers: Array<{ tier: ToolTierName; tools: string[] }>;
  explicitTools: string[];
  excluded: string[];
  hardExcluded: Array<{ tool: string; reason: string }>;
  unknown: string[];
}

export interface ToolRegistryAssembly {
  nativeToolNames: string[];
  providerTools?: OpenAiToolDefinition[];
  diagnostics: ToolRegistryDiagnostics;
}

export interface ToolRegistryAssemblyOptions {
  includeUnknownTierTools?: boolean;
  strictTools?: boolean;
}

export interface ToolSchemaNormalizationOptions {
  strict: boolean;
}

export interface OpenAiToolDefinitionOptions {
  strict: boolean;
}

const READ_ONLY_TOOL_NAMES = [
  'search_documents',
  'get_document',
  'search_memory',
  'get_memory',
  'list_memories',
  'search_records',
  'get_record',
  'search_all',
  'get_briefing',
] as const;

const READ_WRITE_EXTRA_TOOL_NAMES = [
  'create_document',
  'update_document',
  'append_to_doc',
  'move_document',
  'save_memory',
  'update_memory',
  'create_record',
  'update_record',
  'apply_tags',
  'archive_document',
  'archive_memory',
  'archive_record',
  'create_directory',
  'remove_directory',
] as const;

export const TOOL_TIERS = {
  'tier:read-only': [...READ_ONLY_TOOL_NAMES],
  'tier:read-write': [...READ_ONLY_TOOL_NAMES, ...READ_WRITE_EXTRA_TOOL_NAMES],
} as const satisfies Record<string, readonly string[]>;

export type ToolTierName = keyof typeof TOOL_TIERS;

export const HARD_EXCLUDED_NATIVE_TOOLS = [
  'call_model',
  'register_plugin',
  'unregister_plugin',
  'get_plugin_info',
] as const;

const HARD_EXCLUDED_REASON = 'Tool is not safe for delegated model-visible native access.';

function isToolTierName(tool: string): tool is ToolTierName {
  return Object.prototype.hasOwnProperty.call(TOOL_TIERS, tool);
}

function addUnique(target: string[], seen: Set<string>, tool: string): void {
  if (seen.has(tool)) return;
  seen.add(tool);
  target.push(tool);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isZodSchema(value: unknown): value is z.ZodType {
  return value instanceof z.ZodType;
}

function toZodObjectSchema(inputSchema: unknown): z.ZodObject<z.ZodRawShape> {
  if (isZodSchema(inputSchema)) {
    if (inputSchema instanceof z.ZodObject) return inputSchema;
    throw new Error('Tool inputSchema must be a Zod object schema.');
  }

  if (isRecord(inputSchema)) {
    return z.object(inputSchema as z.ZodRawShape);
  }

  throw new Error('Tool inputSchema must be a raw Zod shape object or Zod object schema.');
}

function normalizeJsonSchemaNode(schema: unknown, options: ToolSchemaNormalizationOptions): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeJsonSchemaNode(item, options));
  }
  if (!isRecord(schema)) return schema;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    normalized[key] = normalizeJsonSchemaNode(value, options);
  }

  if (normalized['type'] === 'object') {
    const properties = isRecord(normalized['properties']) ? normalized['properties'] : {};
    normalized['properties'] = properties;
    normalized['additionalProperties'] = false;
    if (options.strict) {
      normalized['required'] = Object.keys(properties);
    }
  }

  return normalized;
}

export function normalizeToolJsonSchema(
  schema: unknown,
  options: ToolSchemaNormalizationOptions
): Record<string, unknown> {
  const normalized = normalizeJsonSchemaNode(schema, options);
  if (!isRecord(normalized) || normalized['type'] !== 'object') {
    throw new Error('Tool JSON Schema root must be an object schema.');
  }
  return normalized;
}

export function toOpenAiToolDefinition(
  tool: NativeToolDefinition,
  options: OpenAiToolDefinitionOptions
): OpenAiToolDefinition {
  const zodSchema = toZodObjectSchema(tool.inputSchema);
  const parameters = normalizeToolJsonSchema(z.toJSONSchema(zodSchema), options);
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
      ...(options.strict ? { strict: true as const } : {}),
    },
  };
}

export function validateAndCacheNativeToolSchemas(catalog: NativeToolDefinition[]): void {
  for (const tool of catalog) {
    try {
      tool.openAiNonStrict = toOpenAiToolDefinition(tool, { strict: false });
      tool.openAiStrict = toOpenAiToolDefinition(tool, { strict: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Config error: [native-tool] tool '${tool.name}' schema translation failed: ${message}`, {
        cause: error,
      });
    }
  }
}

function getCachedOpenAiToolDefinition(
  tool: NativeToolDefinition,
  options: OpenAiToolDefinitionOptions
): OpenAiToolDefinition {
  if (options.strict && tool.openAiStrict) return tool.openAiStrict;
  if (!options.strict && tool.openAiNonStrict) return tool.openAiNonStrict;
  return toOpenAiToolDefinition(tool, options);
}

export function assembleNativeToolRegistry(
  config: FlashQueryConfig,
  purposeName: string,
  catalog: NativeToolDefinition[],
  options?: ToolRegistryAssemblyOptions
): ToolRegistryAssembly {
  const catalogNames = new Set(catalog.map((tool) => tool.name));
  const catalogByName = new Map(catalog.map((tool) => [tool.name, tool]));
  const hardExcludedNames = new Set<string>(HARD_EXCLUDED_NATIVE_TOOLS);
  const purpose = config.llm?.purposes.find((candidate) => candidate.name.toLowerCase() === purposeName.toLowerCase());
  const requestedTools = purpose?.tools ?? [];
  const requestedExclusions = purpose?.excludedTools ?? [];
  const expanded: string[] = [];
  const seenExpanded = new Set<string>();
  const diagnostics: ToolRegistryDiagnostics = {
    expandedTiers: [],
    explicitTools: [],
    excluded: [],
    hardExcluded: [],
    unknown: [],
  };

  for (const requested of requestedTools) {
    if (isToolTierName(requested)) {
      const tierTools = [...TOOL_TIERS[requested]];
      diagnostics.expandedTiers.push({ tier: requested, tools: tierTools });
      for (const tierTool of tierTools) {
        if (!catalogNames.has(tierTool)) {
          addUnique(diagnostics.unknown, new Set(diagnostics.unknown), tierTool);
          continue;
        }
        addUnique(expanded, seenExpanded, tierTool);
      }
      continue;
    }

    if (!catalogNames.has(requested)) {
      addUnique(diagnostics.unknown, new Set(diagnostics.unknown), requested);
      continue;
    }

    addUnique(diagnostics.explicitTools, new Set(diagnostics.explicitTools), requested);
    addUnique(expanded, seenExpanded, requested);
  }

  const excludedNames = new Set(requestedExclusions);
  const afterExclusions = expanded.filter((tool) => {
    if (!excludedNames.has(tool)) return true;
    addUnique(diagnostics.excluded, new Set(diagnostics.excluded), tool);
    return false;
  });

  const nativeToolNames = afterExclusions.filter((tool) => {
    if (!hardExcludedNames.has(tool)) return true;
    diagnostics.hardExcluded.push({ tool, reason: HARD_EXCLUDED_REASON });
    return false;
  });
  const providerTools = nativeToolNames.map((toolName) => {
    const tool = catalogByName.get(toolName);
    if (!tool) {
      throw new Error(`Catalog entry for native tool '${toolName}' was not found.`);
    }
    return getCachedOpenAiToolDefinition(tool, { strict: options?.strictTools === true });
  });

  return {
    nativeToolNames,
    ...(providerTools.length > 0 ? { providerTools } : {}),
    diagnostics,
  };
}
