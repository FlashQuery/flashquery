export type ToolCategory = 'doc-read' | 'doc-write' | 'memory' | 'plugin' | 'llm' | 'system';
export type ToolTier = 'read-only' | 'read-write' | 'admin';
export type ToolStatus = 'final' | 'transitional' | 'removed' | 'dead';

export type ToolTierSelector = 'tier:read-only' | 'tier:read-write';
export type ToolCategorySelector = `category:${ToolCategory}`;
export type ToolSelector = ToolTierSelector | ToolCategorySelector | string;

export interface ToolMetadata {
  name: string;
  status: ToolStatus;
  categories: ToolCategory[];
  tier: ToolTier;
  hostEligible: boolean;
  delegatedEligible: boolean;
  delegatedHardExcludedReason?: string;
  legacyNames?: string[];
  replacement?: string;
  description: string;
}

export interface ExpandToolSelectorsOptions {
  hostEligible?: boolean;
  delegatedEligible?: boolean;
  includeUnavailable?: boolean;
}

const RECURSIVE_MODEL_REASON = 'Tool can recursively call models and is not safe for delegated native access.';
const PLUGIN_ADMIN_REASON = 'Tool mutates or exposes plugin administration and is not safe for delegated native access.';
const SYSTEM_ADMIN_REASON = 'Tool performs administrative maintenance and is not safe for delegated native access.';

const CURRENT_DELEGATED_TIER_ORDER = [
  'search_documents',
  'get_document',
  'search_memory',
  'get_memory',
  'list_memories',
  'search_records',
  'get_record',
  'search_all',
  'get_briefing',
  'write_document',
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
  'insert_doc_link',
] as const;

const CURRENT_DELEGATED_TIER_TOOLS = new Set<string>(CURRENT_DELEGATED_TIER_ORDER);

const TRANSITIONAL_CURRENT_TOOLS = new Set<string>([
  'get_briefing',
  'insert_doc_link',
]);

const REMOVED_CURRENT_TOOLS = new Set<string>([
  'append_to_doc',
  'create_directory',
  'create_document',
  'create_record',
  'force_file_scan',
  'list_memories',
  'reconcile_documents',
  'remove_directory',
  'save_memory',
  'search_all',
  'search_documents',
  'search_memory',
  'update_doc_header',
  'update_document',
  'update_memory',
  'update_record',
]);

function description(summary: string, useWhen: string, doNotUseWhen: string, example: string): string {
  return `Summary: ${summary}\nUse when: ${useWhen}\nDo not use when: ${doNotUseWhen}\nExample: ${example}`;
}

const D = {
  getDocument: description(
    'Read one or more vault documents and return structured document data with canonical expected-error envelopes using isError:false.',
    'Use when you need document body, frontmatter, headings, sections, reference-following behavior, or recoverable not_found/invalid_input results.',
    'Do not use when you need to create or modify documents; use write_document or the current write/edit tool instead.',
    'get_document({ "identifier": "Projects/Plan.md", "include": ["body", "frontmatter", "headings"] })'
  ),
  archiveDocument: description(
    'Archive one or more documents and return JSON document identification blocks with status:"archived" and archived_at.',
    'Use when you need a reversible archive transition for one document or an ordered batch; array input returns one JSON result per identifier, expected per-item failures stay in place, and re-archive is idempotent.',
    'Do not use when you need to move a document to trash or hard-delete it; use remove_document when that consolidated removal tool is available.',
    'archive_document({ "identifiers": ["Notes/old.md", "missing.md"] })'
  ),
  copyDocument: description(
    'Copy one vault document to a new path and return a JSON document identification block for the new copy.',
    'Use when you need a single-target duplicate with a fresh fq_id while preserving source title, tags, and custom frontmatter; destination conflicts return canonical JSON errors.',
    'Do not use when you need batch copy behavior; copy_document intentionally accepts one source identifier and one destination per call.',
    'copy_document({ "identifier": "Templates/Contact.md", "destination": "People/Ada.md" })'
  ),
  moveDocument: description(
    'Move or rename one vault document and return a JSON document identification block for the moved document.',
    'Use when you need a single-target path change that preserves fq_id identity; plugin-owned moves return warnings:["plugin_ownership_path_expectation"].',
    'Do not use when you need batch move behavior or automatic link rewriting; call move_document once per destination-sensitive move and update references separately.',
    'move_document({ "identifier": "Notes/Draft.md", "destination": "Archive/Draft.md" })'
  ),
  listVault: description(
    'List vault files and folders as structured JSON with { path, total, displayed, truncated, entries } and optional include-gated metadata/tracking payloads.',
    'Use when you need to browse vault structure, inspect matching files without reading full bodies, or request include:["metadata","tracking"] for directory counts and tracked document fields.',
    'Do not use when you need semantic or content search; use search instead.',
    'list_vault({ "path": "Projects", "recursive": true, "include": ["metadata", "tracking"] })'
  ),
  search: description(
    'Search documents and memories through the consolidated search surface.',
    'Use when you need filesystem, semantic, mixed, or list-mode search across enabled data domains.',
    'Do not use when you need a single known entity by ID or path; use get_document or get_memory instead.',
    'search({ "query": "launch notes", "entity_types": ["documents"], "mode": "mixed" })'
  ),
  writeDocument: description(
    'Create or update a document through one explicit mode-based document writer.',
    'Use when you need to create a new markdown document or update an existing document body, title, tags, or frontmatter.',
    'Do not use when you only need to read or search documents; use get_document, list_vault, or search instead.',
    'write_document({ "mode": "create", "path": "Notes/Idea.md", "title": "Idea" })'
  ),
  writeMemory: description(
    'Create or update persistent memory through one explicit mode-based memory writer.',
    'Use when you need to save a new memory or create a new latest version of an existing memory.',
    'Do not use when you only need to retrieve or search memories; use get_memory or search instead.',
    'write_memory({ "mode": "create", "content": "The user prefers concise updates." })'
  ),
  writeRecord: description(
    'Create or update plugin records through one explicit mode-based record writer.',
    'Use when you need to insert or change structured data owned by a registered plugin.',
    'Do not use when you need plugin metadata or record retrieval; use get_plugin_info or get_record instead.',
    'write_record({ "mode": "create", "plugin_id": "crm", "table": "contacts", "data": {} })'
  ),
  maintainVault: description(
    'Run vault maintenance actions such as sync, repair, or status checks.',
    'Use when an operator needs administrative vault maintenance through the dedicated system tool.',
    'Do not use when a normal document, memory, or record tool can answer the request directly.',
    'maintain_vault({ "action": "status" })'
  ),
  manageDirectory: description(
    'Create or remove vault directories through one explicit action-based directory tool.',
    'Use when you need to create folders or remove empty folders in the vault.',
    'Do not use when you need to create, move, or remove documents; use document tools instead.',
    'manage_directory({ "action": "create", "paths": ["Projects/Acme"] })'
  ),
  removeDocument: description(
    'Remove documents through the consolidated document removal lifecycle.',
    'Use when you need to archive then trash or delete one or more documents.',
    'Do not use when you only need to hide a document without removal; use archive_document instead.',
    'remove_document({ "identifiers": ["Projects/Old.md"] })'
  ),
};

export const TOOL_METADATA = [
  current('get_document', ['doc-read'], 'read-only', D.getDocument),
  current('list_vault', ['doc-read'], 'read-only', D.listVault),
  current('search_documents', ['doc-read'], 'read-only', legacyDescription('search_documents', 'search', 'Search vault documents by path, title, tags, or content.')),
  current('search_all', ['doc-read', 'memory'], 'read-only', legacyDescription('search_all', 'search', 'Search documents and memories through the current unified search helper.')),
  current('create_document', ['doc-write'], 'read-write', legacyDescription('create_document', 'write_document', 'Create a new markdown document in the vault.')),
  current('update_document', ['doc-write'], 'read-write', legacyDescription('update_document', 'write_document', 'Overwrite or update an existing document.')),
  current('append_to_doc', ['doc-write'], 'read-write', legacyDescription('append_to_doc', 'insert_in_doc', 'Append content to the end of a document.')),
  current('update_doc_header', ['doc-write'], 'read-write', legacyDescription('update_doc_header', 'write_document', 'Update document frontmatter fields.')),
  current('copy_document', ['doc-write'], 'read-write', D.copyDocument),
  current('move_document', ['doc-write'], 'read-write', D.moveDocument),
  current('archive_document', ['doc-write'], 'read-write', D.archiveDocument),
  current('insert_in_doc', ['doc-write'], 'read-write', legacyDescription('insert_in_doc', 'insert_in_doc', 'Insert content at a specific markdown-aware position.')),
  current('replace_doc_section', ['doc-write'], 'read-write', legacyDescription('replace_doc_section', 'replace_doc_section', 'Replace a named markdown section in a document.')),
  current('apply_tags', ['doc-write', 'memory'], 'read-write', legacyDescription('apply_tags', 'apply_tags', 'Apply or remove tags on documents and memories.')),
  current('get_briefing', ['doc-read', 'memory', 'plugin'], 'read-only', legacyDescription('get_briefing', 'call_macro', 'Build a briefing from tagged documents, memories, and records.')),
  current('insert_doc_link', ['doc-write'], 'read-write', legacyDescription('insert_doc_link', 'call_macro', 'Insert a relationship link between documents.')),
  current('write_document', ['doc-write'], 'read-write', D.writeDocument),

  current('save_memory', ['memory'], 'read-write', legacyDescription('save_memory', 'write_memory', 'Store a persistent memory fact.')),
  current('search_memory', ['memory'], 'read-only', legacyDescription('search_memory', 'search', 'Search memories by semantic similarity and tags.')),
  current('update_memory', ['memory'], 'read-write', legacyDescription('update_memory', 'write_memory', 'Update an existing memory by creating a new version.')),
  current('list_memories', ['memory'], 'read-only', legacyDescription('list_memories', 'search', 'List memories filtered by tags or project scope.')),
  current('get_memory', ['memory'], 'read-only', legacyDescription('get_memory', 'get_memory', 'Retrieve one or more memories by ID.')),
  current('archive_memory', ['memory'], 'read-write', legacyDescription('archive_memory', 'archive_memory', 'Archive one or more memories.')),

  current('register_plugin', ['plugin'], 'admin', legacyDescription('register_plugin', 'register_plugin', 'Register or update a plugin schema.'), PLUGIN_ADMIN_REASON),
  current('unregister_plugin', ['plugin'], 'admin', legacyDescription('unregister_plugin', 'unregister_plugin', 'Unregister a plugin and remove its owned tables.'), PLUGIN_ADMIN_REASON),
  current('get_plugin_info', ['plugin'], 'read-only', legacyDescription('get_plugin_info', 'get_plugin_info', 'Get plugin schema and registration information.'), PLUGIN_ADMIN_REASON),
  current('create_record', ['plugin'], 'read-write', legacyDescription('create_record', 'write_record', 'Create a plugin-owned structured record.')),
  current('get_record', ['plugin'], 'read-only', legacyDescription('get_record', 'get_record', 'Retrieve one plugin-owned structured record.')),
  current('update_record', ['plugin'], 'read-write', legacyDescription('update_record', 'write_record', 'Update plugin-owned structured record fields.')),
  current('archive_record', ['plugin'], 'read-write', legacyDescription('archive_record', 'archive_record', 'Archive a plugin-owned structured record.')),
  current('search_records', ['plugin'], 'read-only', legacyDescription('search_records', 'search_records', 'Search plugin-owned structured records.')),
  current('clear_pending_reviews', ['plugin'], 'admin', legacyDescription('clear_pending_reviews', 'clear_pending_reviews', 'List or clear pending plugin review items.'), SYSTEM_ADMIN_REASON),

  current('call_model', ['llm'], 'admin', legacyDescription('call_model', 'call_model', 'Call configured LLM models or purposes.'), RECURSIVE_MODEL_REASON),
  current('get_llm_usage', ['llm'], 'read-only', legacyDescription('get_llm_usage', 'get_llm_usage', 'Inspect recorded LLM usage and cost data.')),

  current('force_file_scan', ['system'], 'admin', legacyDescription('force_file_scan', 'maintain_vault', 'Force a vault file scan.'), SYSTEM_ADMIN_REASON),
  current('reconcile_documents', ['system'], 'admin', legacyDescription('reconcile_documents', 'maintain_vault', 'Reconcile database document rows with vault files.'), SYSTEM_ADMIN_REASON),
  current('create_directory', ['doc-write'], 'read-write', legacyDescription('create_directory', 'manage_directory', 'Create vault directories.')),
  current('remove_directory', ['doc-write'], 'read-write', legacyDescription('remove_directory', 'manage_directory', 'Remove empty vault directories.')),

  future('search', ['doc-read', 'memory'], 'read-only', D.search),
  future('write_memory', ['memory'], 'read-write', D.writeMemory),
  future('write_record', ['plugin'], 'read-write', D.writeRecord),
  future('remove_document', ['doc-write'], 'read-write', D.removeDocument),
  future('manage_directory', ['doc-write'], 'read-write', D.manageDirectory),
  future('maintain_vault', ['system'], 'admin', D.maintainVault, SYSTEM_ADMIN_REASON),

  dead('list_projects', ['system'], legacyDescription('list_projects', undefined, 'List configured legacy projects.')),
  dead('get_project_info', ['system'], legacyDescription('get_project_info', undefined, 'Get legacy project metadata.')),
] as const satisfies readonly ToolMetadata[];

const TOOL_METADATA_BY_NAME = new Map<string, ToolMetadata>(TOOL_METADATA.map((entry) => [entry.name, entry]));

export function getToolMetadata(name: string): ToolMetadata | undefined {
  return TOOL_METADATA_BY_NAME.get(name);
}

export function requireToolMetadata(name: string): ToolMetadata {
  const metadata = getToolMetadata(name);
  if (!metadata) {
    throw new Error(`Missing MCP tool metadata for '${name}'.`);
  }
  return metadata;
}

export function listToolMetadata(
  filter?: Partial<Pick<ToolMetadata, 'status' | 'hostEligible' | 'delegatedEligible'>>
): ToolMetadata[] {
  return TOOL_METADATA.filter((entry) => {
    if (filter?.status !== undefined && entry.status !== filter.status) return false;
    if (filter?.hostEligible !== undefined && entry.hostEligible !== filter.hostEligible) return false;
    if (filter?.delegatedEligible !== undefined && entry.delegatedEligible !== filter.delegatedEligible) return false;
    return true;
  });
}

export function getToolNamesByTier(tier: ToolTierSelector): string[] {
  const targetTier = tier === 'tier:read-only' ? 'read-only' : 'read-write';
  return CURRENT_DELEGATED_TIER_ORDER
    .map((name) => getToolMetadata(name))
    .filter((entry): entry is ToolMetadata => entry !== undefined)
    .filter((entry) => entry.delegatedEligible)
    .filter((entry) => entry.tier === 'read-only' || targetTier === 'read-write' && entry.tier === 'read-write')
    .map((entry) => entry.name);
}

export function getDelegatedHardExcludedTools(): Array<{ tool: string; reason: string }> {
  return TOOL_METADATA
    .filter((entry) => entry.delegatedHardExcludedReason !== undefined)
    .map((entry) => ({ tool: entry.name, reason: entry.delegatedHardExcludedReason ?? '' }));
}

export function getLegacyToolSuggestion(name: string): { replacement: string; message: string } | undefined {
  const entry = getToolMetadata(name);
  if (entry?.status !== 'removed' || !entry.replacement) return undefined;

  return {
    replacement: entry.replacement,
    message: `Tool '${name}' has been replaced by '${entry.replacement}'. Update configuration or calls to use the canonical tool name; FlashQuery does not alias legacy tool names.`,
  };
}

export function assertRegisteredToolsHaveMetadata(catalog: Array<{ name: string }>): void {
  const missing = catalog
    .map((tool) => tool.name)
    .filter((name) => getToolMetadata(name) === undefined);

  if (missing.length > 0) {
    throw new Error(`Missing MCP tool metadata for registered tools: ${missing.sort().join(', ')}`);
  }
}

export function expandToolSelectors(
  selectors: readonly ToolSelector[],
  options: ExpandToolSelectorsOptions = {}
): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const selector of selectors) {
    const names = expandToolSelector(selector, options);
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      expanded.push(name);
    }
  }

  return expanded;
}

function expandToolSelector(selector: ToolSelector, options: ExpandToolSelectorsOptions): string[] {
  if (selector === 'tier:read-only' || selector === 'tier:read-write') {
    return filterAvailable(getToolNamesByTier(selector), options);
  }

  if (selector.startsWith('category:')) {
    const category = selector.slice('category:'.length) as ToolCategory;
    const categories = category === 'doc-write' ? new Set<ToolCategory>(['doc-read', 'doc-write']) : new Set<ToolCategory>([category]);
    return TOOL_METADATA
      .filter((entry) => entry.categories.some((entryCategory) => categories.has(entryCategory)))
      .filter((entry) => isAvailable(entry, options))
      .map((entry) => entry.name);
  }

  const entry = getToolMetadata(selector);
  if (!entry || !isAvailable(entry, options)) return [];
  return [entry.name];
}

function filterAvailable(names: string[], options: ExpandToolSelectorsOptions): string[] {
  return names.filter((name) => {
    const entry = getToolMetadata(name);
    return entry !== undefined && isAvailable(entry, options);
  });
}

function isAvailable(entry: ToolMetadata, options: ExpandToolSelectorsOptions): boolean {
  if (options.includeUnavailable !== true && entry.status === 'dead') return false;
  if (options.hostEligible !== undefined && entry.hostEligible !== options.hostEligible) return false;
  if (options.delegatedEligible !== undefined && entry.delegatedEligible !== options.delegatedEligible) return false;
  return true;
}

function current(
  name: string,
  categories: ToolCategory[],
  tier: ToolTier,
  toolDescription: string,
  hardExcludedReason?: string
): ToolMetadata {
  return {
    name,
    status: currentToolStatus(name),
    categories,
    tier,
    hostEligible: true,
    delegatedEligible: hardExcludedReason === undefined && CURRENT_DELEGATED_TIER_TOOLS.has(name),
    ...(hardExcludedReason === undefined ? {} : { delegatedHardExcludedReason: hardExcludedReason }),
    ...(legacyReplacement(name) === undefined ? {} : { replacement: legacyReplacement(name) }),
    description: toolDescription,
  };
}

function future(
  name: string,
  categories: ToolCategory[],
  tier: ToolTier,
  toolDescription: string,
  hardExcludedReason?: string
): ToolMetadata {
  return {
    name,
    status: 'final',
    categories,
    tier,
    hostEligible: false,
    delegatedEligible: false,
    ...(hardExcludedReason === undefined ? {} : { delegatedHardExcludedReason: hardExcludedReason }),
    description: toolDescription,
  };
}

function dead(name: string, categories: ToolCategory[], toolDescription: string): ToolMetadata {
  return {
    name,
    status: 'dead',
    categories,
    tier: 'admin',
    hostEligible: false,
    delegatedEligible: false,
    description: toolDescription,
  };
}

function legacyDescription(name: string, replacement: string | undefined, summary: string): string {
  return description(
    summary,
    `Use when the current MCP surface still exposes ${name} for this operation during consolidation.`,
    replacement
      ? `Do not use when starting new workflows; use ${replacement} as the canonical replacement when available.`
      : 'Do not use in new workflows; this legacy surface is intentionally absent from the current server.',
    `${name}({})`
  );
}

function legacyReplacement(name: string): string | undefined {
  const replacements: Record<string, string> = {
    search_documents: 'search',
    search_all: 'search',
    create_document: 'write_document',
    update_document: 'write_document',
    append_to_doc: 'insert_in_doc',
    update_doc_header: 'write_document',
    save_memory: 'write_memory',
    search_memory: 'search',
    update_memory: 'write_memory',
    list_memories: 'search',
    create_record: 'write_record',
    update_record: 'write_record',
    force_file_scan: 'maintain_vault',
    reconcile_documents: 'maintain_vault',
    create_directory: 'manage_directory',
    remove_directory: 'manage_directory',
  };
  return replacements[name];
}

function currentToolStatus(name: string): ToolStatus {
  if (REMOVED_CURRENT_TOOLS.has(name)) return 'removed';
  if (TRANSITIONAL_CURRENT_TOOLS.has(name)) return 'transitional';
  return 'final';
}
