import type { FlashQueryConfig } from '../config/loader.js';

export interface NativeToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
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
  providerTools: undefined;
  diagnostics: ToolRegistryDiagnostics;
}

export interface ToolRegistryAssemblyOptions {
  includeUnknownTierTools?: boolean;
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

export function assembleNativeToolRegistry(
  config: FlashQueryConfig,
  purposeName: string,
  catalog: NativeToolDefinition[],
  _options?: ToolRegistryAssemblyOptions
): ToolRegistryAssembly {
  const catalogNames = new Set(catalog.map((tool) => tool.name));
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

  return {
    nativeToolNames,
    providerTools: undefined,
    diagnostics,
  };
}
