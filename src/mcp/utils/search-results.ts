import type { ErrorEnvelope, WarningCode } from './response-formats.js';

export type SearchMode = 'filesystem' | 'semantic' | 'mixed';
export type SearchEntityType = 'documents' | 'memories';
export type SearchMatchSource = 'filesystem' | 'semantic' | 'list';

export interface SearchInput {
  query?: string;
  mode?: string;
  entity_types?: string[];
  tags?: string[];
  path_filter?: string;
  list_all?: boolean;
  limit?: number;
}

export interface ResolvedSearchIntent {
  query: string;
  mode: SearchMode | 'list';
  requested_mode: SearchMode;
  entity_types: SearchEntityType[];
  limit: number;
  list_mode: boolean;
}

export interface SearchResultItem {
  entity_type: SearchEntityType;
  identifier: string;
  title?: string;
  path?: string;
  fq_id?: string;
  memory_id?: string;
  content_preview?: string;
  tags?: string[];
  score?: number;
  match_source: SearchMatchSource[];
  archived_at?: string | null;
  is_latest?: boolean | null;
}

export function resolveSearchMode(mode: string | undefined): SearchMode {
  if (mode === undefined) return 'mixed';
  if (mode === 'filesystem' || mode === 'semantic' || mode === 'mixed') return mode;
  throw new Error(`unsupported search mode: ${mode}`);
}

export function validateSearchInput(input: SearchInput): ErrorEnvelope | null {
  let resolvedMode: SearchMode;
  try {
    resolvedMode = resolveSearchMode(input.mode);
  } catch {
    return {
      error: 'invalid_input',
      message: 'mode must be "filesystem", "semantic", or "mixed"',
      details: { field: 'mode', value: input.mode },
    };
  }

  const query = input.query?.trim() ?? '';
  const hasFilters = (input.tags?.length ?? 0) > 0 || Boolean(input.path_filter);
  if (resolvedMode === 'semantic' && query.length === 0) {
    return {
      error: 'invalid_input',
      message: 'mode "semantic" requires a non-empty query',
      details: { field: 'query' },
    };
  }
  if (query.length === 0 && !hasFilters && input.list_all !== true) {
    return {
      error: 'invalid_input',
      message: 'empty search requires filters or list_all:true',
      details: { requires: ['query', 'tags', 'path_filter', 'list_all'] },
    };
  }
  if (query.length === 0 && hasFilters && input.entity_types === undefined) {
    return {
      error: 'invalid_input',
      message: 'list-mode searches with filters require explicit entity_types',
      details: { field: 'entity_types' },
    };
  }
  return null;
}

export function resolveEntityTypes(
  requested: string[] | undefined,
  enabled: { documents: boolean; memories: boolean }
): { entityTypes: SearchEntityType[]; warnings: WarningCode[]; error?: ErrorEnvelope } {
  const requestedTypes = requested ?? [
    ...(enabled.documents ? ['documents' as const] : []),
    ...(enabled.memories ? ['memories' as const] : []),
  ];
  const warnings: WarningCode[] = [];
  const normalized: SearchEntityType[] = [];

  for (const type of requestedTypes) {
    if (type !== 'documents' && type !== 'memories') {
      return {
        entityTypes: [],
        warnings,
        error: {
          error: 'invalid_input',
          message: 'entity_types may contain only "documents" and "memories"',
          details: { field: 'entity_types', value: type },
        },
      };
    }
    if (type === 'documents' && !enabled.documents) {
      warnings.push('document_category_disabled');
      continue;
    }
    if (type === 'memories' && !enabled.memories) {
      warnings.push('memory_category_disabled');
      continue;
    }
    if (!normalized.includes(type)) normalized.push(type);
  }

  if (normalized.length === 0) {
    const disabled = requestedTypes.includes('memories') ? 'memory' : 'doc-read';
    const identifier = requestedTypes.includes('memories') ? 'memories' : 'documents';
    return {
      entityTypes: [],
      warnings,
      error: {
        error: 'unsupported',
        message: `Requested ${identifier} search domain is disabled`,
        identifier,
        details: { disabled_category: disabled },
      },
    };
  }

  return { entityTypes: normalized, warnings };
}

export function resolveSearchIntent(
  input: SearchInput,
  enabled: { documents: boolean; memories: boolean }
): { intent?: ResolvedSearchIntent; warnings: WarningCode[]; error?: ErrorEnvelope } {
  const validation = validateSearchInput(input);
  if (validation) return { warnings: [], error: validation };
  const requestedMode = resolveSearchMode(input.mode);
  const entityResolution = resolveEntityTypes(input.entity_types, enabled);
  if (entityResolution.error) return { warnings: entityResolution.warnings, error: entityResolution.error };
  const query = input.query?.trim() ?? '';
  const listMode = query.length === 0;
  return {
    warnings: entityResolution.warnings,
    intent: {
      query,
      requested_mode: requestedMode,
      mode: listMode ? 'list' : requestedMode,
      entity_types: entityResolution.entityTypes,
      limit: input.limit ?? 10,
      list_mode: listMode,
    },
  };
}

function resultKey(result: SearchResultItem): string {
  return result.entity_type === 'documents'
    ? `documents:${result.fq_id ?? result.identifier}`
    : `memories:${result.memory_id ?? result.identifier}`;
}

function sortKey(result: SearchResultItem): string {
  return result.entity_type === 'documents'
    ? (result.path ?? result.identifier)
    : (result.memory_id ?? result.identifier);
}

export function mergeSearchResults(results: SearchResultItem[], limit: number): SearchResultItem[] {
  const byKey = new Map<string, SearchResultItem>();
  for (const result of results) {
    const key = resultKey(result);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...result, match_source: [...new Set(result.match_source)] });
      continue;
    }
    const existingScore = existing.score ?? 0;
    const resultScore = result.score ?? 0;
    byKey.set(key, {
      ...(resultScore > existingScore ? result : existing),
      match_source: [...new Set([...existing.match_source, ...result.match_source])],
      score: Math.max(existingScore, resultScore),
    });
  }

  return [...byKey.values()]
    .sort((a, b) => {
      const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      if (a.entity_type !== b.entity_type) return a.entity_type.localeCompare(b.entity_type);
      return sortKey(a).localeCompare(sortKey(b));
    })
    .slice(0, limit);
}
