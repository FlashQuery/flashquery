import {
  getToolMetadata,
  listToolMetadata,
  type ToolMetadata,
} from './tool-metadata.js';

const VALID_TIER_SELECTORS = new Set(['tier:read-only', 'tier:read-write']);
const VALID_CATEGORY_SELECTORS = new Set([
  'category:doc-read',
  'category:doc-write',
  'category:memory',
  'category:plugin',
  'category:llm',
  'category:system',
]);

const PHASE_127_LOCALLY_REPLACED_TOOLS = new Set([
  'create_directory',
  'remove_directory',
  'force_file_scan',
  'reconcile_documents',
]);

export interface HostMcpToolsConfig {
  tools?: string[];
  excludedTools?: string[];
}

export interface ResolvedHostToolExposure {
  hostEnabledToolNames: string[];
  warnings: string[];
}

export function validateToolSelectors(selectors: readonly string[] = []): string[] {
  const errors: string[] = [];

  for (const selector of selectors) {
    const metadata = getToolMetadata(selector);
    if (VALID_TIER_SELECTORS.has(selector) || VALID_CATEGORY_SELECTORS.has(selector)) continue;

    if (selector.startsWith('tier:') || selector.startsWith('category:')) {
      errors.push(`unknown tool selector '${selector}'`);
      continue;
    }

    if (!metadata) {
      errors.push(`unknown tool selector '${selector}'`);
      continue;
    }

    if (!isCurrentHostSelectable(metadata)) {
      errors.push(`tool '${selector}' is not available for host MCP exposure`);
    }
  }

  return errors;
}

export function resolveHostToolExposure(config?: HostMcpToolsConfig): ResolvedHostToolExposure {
  const selectors = config?.tools;
  const excludedSelectors = config?.excludedTools ?? [];

  if (config !== undefined && selectors !== undefined && selectors.length === 0) {
    throw new Error("tools is empty; omit host_mcp_tools.tools to keep the default host surface or list at least one selector");
  }

  const errors = [
    ...validateToolSelectors(selectors ?? []),
    ...validateToolSelectors(excludedSelectors),
  ];

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  const enabled = selectors === undefined
    ? listToolMetadata({ hostEligible: true })
        .filter(isCurrentHostSelectable)
        .map((entry) => entry.name)
    : expandHostSelectors(selectors);
  const excluded = new Set(expandHostSelectors(excludedSelectors));
  const hostEnabledToolNames = enabled.filter((name) => !excluded.has(name));

  return {
    hostEnabledToolNames,
    warnings: buildToolExposureWarnings(hostEnabledToolNames),
  };
}

export function buildToolExposureWarnings(hostEnabledToolNames: readonly string[]): string[] {
  const categories = new Set(
    hostEnabledToolNames.flatMap((name) => getToolMetadata(name)?.categories ?? [])
  );
  const warnings: string[] = [];

  if (!categories.has('system')) {
    warnings.push('host_mcp_tools: system category disabled; maintenance tools will not be visible to the host.');
  }
  if (categories.has('llm') && !categories.has('doc-read')) {
    warnings.push('host_mcp_tools: doc-read disabled while llm enabled; model calls may lose document context helpers.');
  }
  if (categories.has('llm') && !categories.has('doc-read') && !categories.has('memory') && !categories.has('plugin')) {
    warnings.push('host_mcp_tools: data categories disabled while llm enabled; delegated model workflows may have no data access tools.');
  }
  if (categories.size === 1 && categories.has('system')) {
    warnings.push('host_mcp_tools: only system category enabled; user-facing data tools will be hidden from the host.');
  }

  return warnings;
}

function expandHostSelectors(selectors: readonly string[]): string[] {
  if (selectors.length === 0) return [];
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    for (const name of expandHostSelector(selector)) {
      if (seen.has(name)) continue;
      seen.add(name);
      expanded.push(name);
    }
  }

  return expanded;
}

function expandHostSelector(selector: string): string[] {
  if (selector === 'tier:read-only' || selector === 'tier:read-write') {
    const includeWrite = selector === 'tier:read-write';
    return listToolMetadata({ hostEligible: true })
      .filter(isCurrentHostSelectable)
      .filter((entry) => entry.tier === 'read-only' || (includeWrite && entry.tier === 'read-write'))
      .map((entry) => entry.name);
  }

  if (selector.startsWith('category:')) {
    const category = selector.slice('category:'.length);
    const categories = category === 'doc-write' ? new Set(['doc-read', 'doc-write']) : new Set([category]);
    return listToolMetadata({ hostEligible: true })
      .filter(isCurrentHostSelectable)
      .filter((entry) => entry.categories.some((entryCategory) => categories.has(entryCategory)))
      .map((entry) => entry.name);
  }

  const metadata = getToolMetadata(selector);
  return metadata && isCurrentHostSelectable(metadata) ? [metadata.name] : [];
}

function isCurrentHostSelectable(metadata: ToolMetadata): boolean {
  if (PHASE_127_LOCALLY_REPLACED_TOOLS.has(metadata.name)) return false;
  return metadata.hostEligible && metadata.status !== 'dead';
}
