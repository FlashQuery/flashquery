import {
  batchResult,
  jsonExpectedError,
  memoryIdentification,
  type ErrorEnvelope,
  type MemoryIdentificationInput,
  type ToolResult,
} from './response-formats.js';

export type MemoryInclude = 'content' | 'tags_full';

export interface MemoryRow {
  id: string;
  content: string;
  tags: string[] | null;
  plugin_scope: string | null;
  created_at: string;
  updated_at: string;
  version?: number | null;
  previous_version_id?: string | null;
  is_latest?: boolean | null;
  archived_at?: string | null;
}

export type MemoryResult = MemoryIdentificationInput & {
  version?: number | null;
  previous_version_id?: string | null;
  is_latest?: boolean | null;
  archived_at?: string | null;
  content?: string;
  tags_full?: string[];
};

export function buildContentPreview(content: string, maxLength = 120): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function normalizeMemoryInclude(include: MemoryInclude[] | undefined): MemoryInclude[] {
  return include ?? [];
}

export function buildMemoryResult(row: MemoryRow, include?: MemoryInclude[]): MemoryResult {
  const tags = row.tags ?? [];
  const result: MemoryResult = {
    ...memoryIdentification({
      memory_id: row.id,
      content_preview: buildContentPreview(row.content),
      tags,
      plugin_scope: row.plugin_scope ?? 'global',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
    version: row.version ?? null,
    previous_version_id: row.previous_version_id ?? null,
    is_latest: row.is_latest ?? null,
    archived_at: row.archived_at ?? null,
  };

  const effectiveInclude = normalizeMemoryInclude(include);
  if (effectiveInclude.includes('content')) {
    result.content = row.content;
  }
  if (effectiveInclude.includes('tags_full')) {
    result.tags_full = tags;
  }

  return result;
}

export function buildOrderedMemoryResults(
  requestedIds: string[],
  rows: MemoryRow[],
  include?: MemoryInclude[]
): Array<MemoryResult | ErrorEnvelope> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return batchResult(
    requestedIds.map((id) => {
      const row = byId.get(id);
      if (!row) {
        return {
          error: 'not_found',
          message: `Memory not found: ${id}`,
          identifier: id,
        } satisfies ErrorEnvelope;
      }
      return buildMemoryResult(row, include);
    })
  ) as Array<MemoryResult | ErrorEnvelope>;
}

export function memoryNotFoundError(memoryId: string): ToolResult {
  return jsonExpectedError({
    error: 'not_found',
    message: `Memory not found: ${memoryId}`,
    identifier: memoryId,
  });
}
