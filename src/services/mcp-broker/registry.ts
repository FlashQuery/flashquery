import type { BrokeredTool, ConsumerContext, RegistryKey } from './types.js';

const REGISTRY_DELIMITER = '__';
const MACRO_DELIMITER = '.';
const FQ_NATIVE_SERVER_ID = 'fq';

interface ToolOverrideShape {
  costPerCall?: number;
  descriptionOverride?: string;
}

interface ServerConfigShape {
  costPerCall?: number;
  toolOverrides?: Record<string, ToolOverrideShape>;
}

interface PurposeConfigShape {
  name: string;
  mcpServers?: string[];
}

export interface ToolRegistryConfig {
  mcpServers?: Record<string, ServerConfigShape>;
  host?: { mcpServers?: string[] };
  llm?: { purposes?: PurposeConfigShape[] };
}

export interface RegisterBrokeredToolInput {
  serverId: string;
  toolName: string;
  description?: string;
  inputSchema: unknown;
  tofuHash: string;
}

export function makeRegistryKey(serverId: string, toolName: string): RegistryKey {
  validateRegistryPart(serverId, 'serverId');
  validateRegistryPart(toolName, 'toolName');
  if (serverId === FQ_NATIVE_SERVER_ID) {
    throw new Error('FQ-native tools are not broker registry keys; use the bare tool name.');
  }
  return `${serverId}${REGISTRY_DELIMITER}${toolName}`;
}

export function parseRegistryKey(key: string): { serverId: string; toolName: string } {
  const delimiterIndex = key.indexOf(REGISTRY_DELIMITER);
  if (
    delimiterIndex <= 0 ||
    delimiterIndex !== key.lastIndexOf(REGISTRY_DELIMITER) ||
    delimiterIndex === key.length - REGISTRY_DELIMITER.length
  ) {
    throw new Error(`Invalid broker registry key '${key}'. Expected '<serverId>__<toolName>'.`);
  }

  return {
    serverId: key.slice(0, delimiterIndex),
    toolName: key.slice(delimiterIndex + REGISTRY_DELIMITER.length),
  };
}

export function isRegistryKey(value: string): boolean {
  try {
    parseRegistryKey(value);
    return true;
  } catch {
    return false;
  }
}

export function parseMacroRef(ref: string): { serverId: string; toolName: string } {
  const dotIndex = ref.indexOf(MACRO_DELIMITER);
  if (dotIndex <= 0 || dotIndex === ref.length - 1) {
    throw new Error(`Invalid broker tool ref '${ref}'. Expected '<serverId>.<toolName>'.`);
  }
  return {
    serverId: ref.slice(0, dotIndex),
    toolName: ref.slice(dotIndex + 1),
  };
}

export class ToolRegistry {
  readonly #tools = new Map<RegistryKey, BrokeredTool>();
  readonly #serverConfigs: Record<string, ServerConfigShape>;
  readonly #hostServerIds: Set<string>;
  readonly #purposeServerIds: Map<string, Set<string>>;

  constructor(config: ToolRegistryConfig = {}) {
    this.#serverConfigs = config.mcpServers ?? {};
    this.#hostServerIds = new Set(config.host?.mcpServers ?? []);
    this.#purposeServerIds = new Map(
      (config.llm?.purposes ?? []).map((purpose) => [purpose.name, new Set(purpose.mcpServers ?? [])])
    );
  }

  static nativeToolName(toolName: string): string {
    validateRegistryPart(toolName, 'toolName');
    return toolName;
  }

  registerTool(input: RegisterBrokeredToolInput): BrokeredTool {
    const registryKey = makeRegistryKey(input.serverId, input.toolName);
    const serverConfig = this.#serverConfigs[input.serverId];
    const override = serverConfig?.toolOverrides?.[input.toolName];
    const upstreamDescription = input.description;
    const tool: BrokeredTool = {
      serverId: input.serverId,
      toolName: input.toolName,
      registryKey,
      ...(override?.descriptionOverride ?? input.description === undefined
        ? {}
        : { upstreamDescription }),
      ...(override?.descriptionOverride === undefined
        ? input.description === undefined
          ? {}
          : { description: input.description }
        : {
            description: override.descriptionOverride,
            ...(upstreamDescription === undefined ? {} : { upstreamDescription }),
          }),
      inputSchema: input.inputSchema,
      tofuHash: input.tofuHash,
      costPerCall: override?.costPerCall ?? serverConfig?.costPerCall ?? 0,
    };
    this.#tools.set(registryKey, tool);
    return cloneTool(tool);
  }

  registerTools(tools: RegisterBrokeredToolInput[]): BrokeredTool[] {
    return tools.map((tool) => this.registerTool(tool));
  }

  get(serverId: string, toolName: string): BrokeredTool | undefined {
    const tool = this.#tools.get(makeRegistryKey(serverId, toolName));
    return tool === undefined ? undefined : cloneTool(tool);
  }

  getByRegistryKey(key: RegistryKey): BrokeredTool | undefined {
    const tool = this.#tools.get(key);
    return tool === undefined ? undefined : cloneTool(tool);
  }

  listAll(): BrokeredTool[] {
    return [...this.#tools.values()].map(cloneTool);
  }

  listToolsForConsumer(ctx: ConsumerContext): BrokeredTool[] {
    const visibleServerIds = this.#visibleServerIds(ctx);
    return [...this.#tools.values()]
      .filter((tool) => visibleServerIds.has(tool.serverId))
      .map(cloneTool);
  }

  listVisibleServerIds(ctx: ConsumerContext): string[] {
    return [...this.#visibleServerIds(ctx)];
  }

  #visibleServerIds(ctx: ConsumerContext): Set<string> {
    if (ctx.kind === 'host') return this.#hostServerIds;
    return this.#purposeServerIds.get(ctx.purposeId) ?? new Set();
  }
}

function validateRegistryPart(value: string, label: string): void {
  if (value.trim() === '') {
    throw new Error(`Invalid ${label}: value must not be empty.`);
  }
  if (value.includes(REGISTRY_DELIMITER)) {
    throw new Error(`Invalid ${label}: value must not contain '${REGISTRY_DELIMITER}'.`);
  }
}

function cloneTool(tool: BrokeredTool): BrokeredTool {
  return { ...tool };
}
