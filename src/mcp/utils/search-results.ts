import type { ErrorEnvelope, WarningCode } from './response-formats.js';

export type SearchMode = 'filesystem' | 'semantic' | 'mixed';
export type SearchEntityType = 'documents' | 'memories';
export type SearchMatchSource = 'filesystem' | 'semantic' | 'list' | 'graph';

export interface SearchInput {
  query?: string;
  mode?: string;
  entity_types?: string[];
  tags?: string[];
  path_filter?: string;
  list_all?: boolean;
  limit?: number;
  limit_chunks_per_result?: number;
  [key: string]: unknown;
}

const deferredLiteralSearchParams = ['body_contains', 'body_regex', 'regex', 'line_range', 'lines', 'byte_range'];

export interface ResolvedSearchIntent {
  query: string;
  mode: SearchMode | 'list';
  requested_mode: SearchMode;
  entity_types: SearchEntityType[];
  limit: number;
  list_mode: boolean;
}

export interface SearchResultItem {
  entity_type: 'document' | 'memory';
  identifier: string;
  title?: string;
  path?: string;
  fq_id?: string;
  modified?: string;
  size?: { chars: number };
  memory_id?: string;
  content_preview?: string;
  plugin_scope?: string;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  score?: number;
  match_source?: SearchMatchSource[];
  archived_at?: string | null;
  is_latest?: boolean | null;
  matched_chunks?: SearchMatchedChunk[];
  graph_context?: SearchGraphContext;
}

export interface SearchGraphContext {
  seed_chunk_id?: string;
  edge_id?: string;
  relation?: string;
  stale?: boolean;
  confidence_score?: number;
  depth?: number;
  community?: {
    community_id: string;
    community_label?: string | null;
    community_summary?: string | null;
  };
  path_to?: {
    found: boolean;
    nodes?: string[];
    edges?: string[];
    max_depth?: number;
  };
  [key: string]: unknown;
}

export interface SearchMatchedChunk {
  chunk_id: string;
  heading_path: string;
  breadcrumb: string;
  content: string;
  span_start: number | null;
  span_end: number | null;
  score: number;
  per_embedding_ranks: Record<string, number>;
  indexed_at: Record<string, string | null>;
}

export function resolveSearchMode(mode: string | undefined): SearchMode {
  if (mode === undefined) return 'mixed';
  if (mode === 'filesystem' || mode === 'semantic' || mode === 'mixed') return mode;
  throw new Error(`unsupported search mode: ${mode}`);
}

export function validateSearchInput(input: SearchInput): ErrorEnvelope | null {
  const unsupportedParams = deferredLiteralSearchParams.filter((param) => input[param] !== undefined);
  if (unsupportedParams.length > 0) {
    return {
      error: 'invalid_input',
      message: 'Literal body grep, regex, line-range, and byte-range search belong in macro/string operations; search supports title/path/tag/filesystem and semantic matching only.',
      identifier: unsupportedParams[0],
      details: { unsupported_parameters: unsupportedParams },
    };
  }

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
      message: 'Empty query requires filters or list_all: true',
      identifier: '',
      details: { requires: ['tags', 'path_filter', 'list_all'] },
    };
  }
  if (query.length === 0 && hasFilters && input.entity_types === undefined) {
    return {
      error: 'invalid_input',
      message: 'list-mode searches with filters require explicit entity_types',
      details: { field: 'entity_types' },
    };
  }
  if (input.limit_chunks_per_result !== undefined) {
    if (
      !Number.isInteger(input.limit_chunks_per_result) ||
      input.limit_chunks_per_result < 1 ||
      input.limit_chunks_per_result > 25
    ) {
      return {
        error: 'invalid_input',
        message: 'limit_chunks_per_result must be an integer between 1 and 25',
        identifier: 'limit_chunks_per_result',
        details: { field: 'limit_chunks_per_result', value: input.limit_chunks_per_result },
      };
    }
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
  return result.entity_type === 'document'
    ? `documents:${result.fq_id ?? result.identifier}`
    : `memories:${result.memory_id ?? result.identifier}`;
}

function sortKey(result: SearchResultItem): string {
  return result.entity_type === 'document'
    ? (result.path ?? result.identifier)
    : (result.memory_id ?? result.identifier);
}

export function mergeSearchResults(results: SearchResultItem[], limit: number): SearchResultItem[] {
  const byKey = new Map<string, SearchResultItem>();
  for (const result of results) {
    const key = resultKey(result);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...result,
        ...(result.match_source ? { match_source: [...new Set(result.match_source)] } : {}),
      });
      continue;
    }
    const existingScore = existing.score ?? 0;
    const resultScore = result.score ?? 0;
    const next = resultScore > existingScore ? result : existing;
    const matchSource = [...new Set([...(existing.match_source ?? []), ...(result.match_source ?? [])])];
    byKey.set(key, {
      ...next,
      ...(matchSource.length > 0 ? { match_source: matchSource } : {}),
      ...(existing.score !== undefined || result.score !== undefined ? { score: Math.max(existingScore, resultScore) } : {}),
      ...mergeMatchedChunks(existing, result),
      ...mergeGraphContextProperty(existing, result),
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

export function mergeGraphContextProperty(
  left: Pick<SearchResultItem, 'graph_context'>,
  right: Pick<SearchResultItem, 'graph_context'>
): { graph_context?: SearchGraphContext } {
  if (!left.graph_context && !right.graph_context) return {};
  return {
    graph_context: {
      ...(left.graph_context ?? {}),
      ...(right.graph_context ?? {}),
      ...(left.graph_context?.community || right.graph_context?.community
        ? {
            community: {
              ...(left.graph_context?.community ?? {}),
              ...(right.graph_context?.community ?? {}),
            },
          }
        : {}),
      ...(left.graph_context?.path_to || right.graph_context?.path_to
        ? {
            path_to: {
              ...(left.graph_context?.path_to ?? {}),
              ...(right.graph_context?.path_to ?? {}),
            },
          }
        : {}),
    },
  };
}

function mergeMatchedChunks(
  left: SearchResultItem,
  right: SearchResultItem
): { matched_chunks?: SearchMatchedChunk[] } {
  const chunks = [...(left.matched_chunks ?? []), ...(right.matched_chunks ?? [])];
  if (chunks.length === 0) return {};
  const byId = new Map<string, SearchMatchedChunk>();
  for (const chunk of chunks) {
    const existing = byId.get(chunk.chunk_id);
    if (!existing) {
      byId.set(chunk.chunk_id, { ...chunk });
      continue;
    }
    byId.set(chunk.chunk_id, {
      ...existing,
      score: Math.max(existing.score, chunk.score),
      per_embedding_ranks: { ...existing.per_embedding_ranks, ...chunk.per_embedding_ranks },
      indexed_at: mergeIndexedAt(existing.indexed_at, chunk.indexed_at),
    });
  }
  return {
    matched_chunks: [...byId.values()].sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return a.heading_path.localeCompare(b.heading_path);
    }),
  };
}

function mergeIndexedAt(
  left: Record<string, string | null>,
  right: Record<string, string | null>
): Record<string, string | null> {
  const merged: Record<string, string | null> = { ...left };
  for (const [name, value] of Object.entries(right)) {
    merged[name] = value ?? merged[name] ?? null;
  }
  return merged;
}
