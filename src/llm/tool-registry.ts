import type { FlashQueryConfig } from '../config/loader.js';
import type { logger } from '../logging/logger.js';
import { z } from 'zod';
import type {
  TemplateToolDiagnostics,
  TemplateToolRegistryAssembly,
  TemplateToolReverseMap,
} from './template-tools.js';
import {
  getDelegatedHardExcludedTools,
  getToolNamesByTier,
} from '../mcp/tool-metadata.js';

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
  templateToolNames?: string[];
  templateReverseMap?: TemplateToolReverseMap;
  providerTools?: OpenAiToolDefinition[];
  diagnostics: ToolRegistryDiagnostics & Partial<TemplateToolDiagnostics>;
  collisions?: Array<{
    name: string;
    template_paths: string[];
    sources: Array<{ kind: 'template' | 'native'; template_path?: string; name?: string }>;
  }>;
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

export const TOOL_TIERS = {
  'tier:read-only': getToolNamesByTier('tier:read-only'),
  'tier:read-write': getToolNamesByTier('tier:read-write'),
} as const satisfies Record<string, readonly string[]>;

export type ToolTierName = keyof typeof TOOL_TIERS;

const DELEGATED_HARD_EXCLUDED_TOOLS = getDelegatedHardExcludedTools();

export const HARD_EXCLUDED_NATIVE_TOOLS = DELEGATED_HARD_EXCLUDED_TOOLS.map((entry) => entry.tool);

const HARD_EXCLUDED_REASON_BY_TOOL = new Map(
  DELEGATED_HARD_EXCLUDED_TOOLS.map((entry) => [entry.tool, entry.reason])
);
const TEMPLATE_TOOL_NAME_PREFIX = 'flashquery_';

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
    const originallyRequired = Array.isArray(normalized['required'])
      ? new Set(normalized['required'].filter((key): key is string => typeof key === 'string'))
      : new Set<string>();
    normalized['properties'] = options.strict
      ? Object.fromEntries(
        Object.entries(properties).map(([key, property]) => [
          key,
          originallyRequired.has(key) ? property : { anyOf: [property, { type: 'null' }] },
        ])
      )
      : properties;
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
    if (tool.name.startsWith(TEMPLATE_TOOL_NAME_PREFIX)) {
      throw new Error(
        `Config error: [native-tool] tool '${tool.name}' uses the reserved '${TEMPLATE_TOOL_NAME_PREFIX}' prefix; ` +
        'this prefix is reserved for FlashQuery-generated template tools.'
      );
    }
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
    diagnostics.hardExcluded.push({
      tool,
      reason: HARD_EXCLUDED_REASON_BY_TOOL.get(tool) ?? 'Tool is not safe for delegated model-visible native access.',
    });
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

function templateToolPath(tool: unknown): string | undefined {
  if (!isRecord(tool)) return undefined;
  const path = tool['templatePath'] ?? tool['template_path'];
  return typeof path === 'string' ? path : undefined;
}

function templateToolName(tool: unknown): string | undefined {
  if (!isRecord(tool)) return undefined;
  const name = tool['name'];
  return typeof name === 'string' ? name : undefined;
}

export function mergeModelVisibleToolRegistries(input: {
  native?: ToolRegistryAssembly;
  template?: TemplateToolRegistryAssembly | {
    providerTools?: OpenAiToolDefinition[];
    templateTools?: unknown[];
    templateReverseMap?: TemplateToolReverseMap;
    diagnostics?: Partial<TemplateToolDiagnostics>;
  };
}): ToolRegistryAssembly {
  const native = input.native ?? {
    nativeToolNames: [],
    diagnostics: { expandedTiers: [], explicitTools: [], excluded: [], hardExcluded: [], unknown: [] },
  };
  const template = input.template;
  const providerTools = [
    ...(native.providerTools ?? []),
    ...(template?.providerTools ?? []),
  ];
  const templateTools = template?.templateTools ?? [];
  const templateToolNames = templateTools
    .map((tool) => templateToolName(tool))
    .filter((name): name is string => name !== undefined);
  const templateReverseMap = template?.templateReverseMap;
  const diagnostics = {
    ...native.diagnostics,
    ...(template?.diagnostics ?? {}),
  };
  const sourceGroups = new Map<string, Array<{ kind: 'template' | 'native'; template_path?: string; name?: string }>>();

  for (const name of native.nativeToolNames) {
    const sources = sourceGroups.get(name) ?? [];
    sources.push({ kind: 'native', name });
    sourceGroups.set(name, sources);
  }
  for (const tool of templateTools) {
    const name = templateToolName(tool);
    if (name === undefined) continue;
    const sources = sourceGroups.get(name) ?? [];
    const path = templateToolPath(tool);
    sources.push({ kind: 'template', ...(path === undefined ? {} : { template_path: path }) });
    sourceGroups.set(name, sources);
  }

  const collisions = [...sourceGroups.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([name, sources]) => ({
      name,
      template_paths: Array.from(new Set(sources
        .map((source) => source.template_path)
        .filter((path): path is string => path !== undefined))),
      sources,
    }));
  const templateDiagnosticsConflicts = diagnostics.template_tool_conflicts ?? [];
  const allCollisions = [
    ...templateDiagnosticsConflicts,
    ...collisions.filter((collision) =>
      !templateDiagnosticsConflicts.some((existing) => existing.name === collision.name)
    ),
  ];

  return {
    nativeToolNames: native.nativeToolNames,
    templateToolNames,
    ...(templateReverseMap === undefined ? {} : { templateReverseMap }),
    ...(providerTools.length > 0 ? { providerTools } : {}),
    diagnostics: {
      ...diagnostics,
      template_tool_conflicts: allCollisions,
    },
    collisions: allCollisions,
  };
}
