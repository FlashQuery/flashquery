import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { validateAllTags } from '../../utils/tag-validator.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
} from '../utils/response-formats.js';
import {
  buildMemoryResult,
  buildOrderedMemoryResults,
  type MemoryInclude,
  type MemoryRow,
} from '../utils/memory-output.js';

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${err.message} — cause: ${cause.message}`;
  if (cause !== undefined) return `${err.message} — cause: ${JSON.stringify(cause)}`;
  return err.message;
}

type MemoryToolParams = Record<string, unknown>;

const generatedMemoryFields = new Set([
  'id',
  'memory_id',
  'version',
  'previous_version_id',
  'is_latest',
  'archived_at',
  'created_at',
  'updated_at',
  'status',
  'embedding',
]);

function expectedInvalidInput(message: string, details?: Record<string, unknown>, identifier?: string) {
  return jsonExpectedError({
    error: 'invalid_input',
    message,
    ...(identifier !== undefined ? { identifier } : {}),
    ...(details ? { details } : {}),
  });
}

function parseMemoryInclude(value: unknown): MemoryInclude[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MemoryInclude => item === 'content' || item === 'tags_full');
}

type PluginScopeLookupResult =
  | { ok: true; scope: string }
  | { ok: false; reason: 'lookup_failed'; message: string };

interface PluginScopeRpcResult {
  data: unknown;
  error: { message: string } | null;
}

function isPluginScopeRpcResult(value: unknown): value is PluginScopeRpcResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  if (!('data' in result) || !('error' in result)) return false;
  const error = result.error;
  return error === null || (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

async function resolvePluginScope(
  config: FlashQueryConfig,
  pluginScope: string | undefined
): Promise<PluginScopeLookupResult> {
  if (!pluginScope || pluginScope === 'global') return { ok: true, scope: 'global' };
  try {
    const rpcResult: unknown = await supabaseManager.getClient()
      .rpc('find_plugin_scope', {
        search_name: pluginScope,
        p_instance_id: config.instance.id,
        threshold: 0.8,
      });
    if (!isPluginScopeRpcResult(rpcResult)) {
      return {
        ok: false,
        reason: 'lookup_failed',
        message: `Plugin scope lookup failed for '${pluginScope}': unexpected RPC response shape`,
      };
    }
    const { data: matchedScope, error: rpcError } = rpcResult;
    if (rpcError) {
      logger.warn(`write_memory: plugin_scope lookup failed: ${rpcError.message}`);
      return {
        ok: false,
        reason: 'lookup_failed',
        message: `Plugin scope lookup failed for '${pluginScope}': ${rpcError.message}`,
      };
    }
    return { ok: true, scope: typeof matchedScope === 'string' && matchedScope.length > 0 ? matchedScope : 'global' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`write_memory: plugin_scope lookup error: ${message}`);
    return {
      ok: false,
      reason: 'lookup_failed',
      message: `Plugin scope lookup failed for '${pluginScope}': ${message}`,
    };
  }
}

function validateWriteMemoryInput(params: MemoryToolParams) {
  if (params.mode === undefined) {
    return expectedInvalidInput('mode is required; use mode: "create" or mode: "update"');
  }
  if (params.mode !== 'create' && params.mode !== 'update') {
    return expectedInvalidInput('mode must be "create" or "update"', { field: 'mode', value: params.mode });
  }
  if (Array.isArray(params.content) || Array.isArray(params.memory_id) || Array.isArray(params.plugin_scope)) {
    return expectedInvalidInput('write_memory does not support array-like rich mutation payloads');
  }

  if (params.mode === 'create') {
    if (typeof params.memory_id === 'string' && params.memory_id.length > 0) {
      return expectedInvalidInput('memory_id is not allowed when mode is create', undefined, params.memory_id);
    }
    for (const field of Object.keys(params)) {
      if (field !== 'mode' && field !== 'content' && field !== 'tags' && field !== 'plugin_scope' && field !== 'include' && generatedMemoryFields.has(field)) {
        return expectedInvalidInput(`field "${field}" is generated by FlashQuery and cannot be set directly`, { field });
      }
    }
    if (typeof params.content !== 'string' || params.content.length === 0) {
      return expectedInvalidInput('content is required when mode is "create"', { field: 'content' });
    }
  }

  if (params.mode === 'update') {
    if (typeof params.memory_id !== 'string' || params.memory_id.length === 0) {
      return expectedInvalidInput('memory_id is required when mode is "update"', { field: 'memory_id' });
    }
    if (params.content === undefined && params.tags === undefined) {
      return expectedInvalidInput('mode "update" requires at least one of content or tags', { reason: 'no_mutable_fields' });
    }
    if (params.content !== undefined && typeof params.content !== 'string') {
      return expectedInvalidInput('content must be a string when provided', { field: 'content' });
    }
  }

  if (params.tags !== undefined && !Array.isArray(params.tags)) {
    return expectedInvalidInput('tags must be an array of strings', { field: 'tags' });
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared semantic memory search helper — used by search_memory and search_all
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared semantic memory search helper. Used by search_memory and search_all.
 */
export async function searchMemoriesSemantic(
  config: FlashQueryConfig,
  query: string,
  opts: {
    tags?: string[];
    tagMatch?: 'any' | 'all';
    threshold?: number;
    limit?: number;
    includeArchived?: boolean;
  }
): Promise<Array<{ id: string; content: string; tags: string[]; plugin_scope: string | null; similarity: number; created_at: string; updated_at: string; is_latest: boolean }>> {
  const { tags, tagMatch = 'any', threshold = 0.4, limit = 10, includeArchived = false } = opts;
  const queryEmbedding = await embeddingProvider.embed(query);
  const supabase = supabaseManager.getClient();
  const rpcResult = await supabase.rpc('match_memories', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: threshold,
    match_count: limit,
    filter_tags: tags ?? null,
    filter_tag_match: tagMatch,
    filter_instance_id: config.instance.id,
    include_archived: includeArchived,
  });
  const { data, error } = rpcResult as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string; content: string; tags: string[]; plugin_scope: string | null; similarity: number; created_at: string; updated_at: string; is_latest: boolean;
  }>;
}

export function registerMemoryTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'write_memory',
    {
      description:
        'Create or update persistent memory using an explicit mode. Use mode:"create" to save a new memory, or mode:"update" to create a new latest version of an existing memory. Returns structured JSON memory identification and optional include payloads.',
      inputSchema: {
        mode: z.enum(['create', 'update']).describe('Memory write mode: create or update'),
        content: z.string().optional().describe('Memory content for create, or replacement content for update'),
        memory_id: z.string().optional().describe('Existing memory ID when mode is update'),
        tags: z.array(z.string()).optional().describe('Memory tags. In update mode this replaces the tag list.'),
        plugin_scope: z.string().optional().describe('Plugin scope for create mode. Default: global'),
        include: z.array(z.enum(['content', 'tags_full'])).optional().describe('Optional payload fields to include'),
      },
    },
    async (params: MemoryToolParams) => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }

      const validationError = validateWriteMemoryInput(params);
      if (validationError) return validationError;

      const include = parseMemoryInclude(params.include);
      const tagsValidation = validateAllTags((params.tags as string[] | undefined) ?? []);
      if (!tagsValidation.valid) {
        return expectedInvalidInput('Tag validation failed', {
          errors: tagsValidation.errors,
          conflicts: tagsValidation.conflicts,
        });
      }

      try {
        if (config.locking.enabled) {
          const locked = await acquireLock(
            supabaseManager.getClient(),
            config.instance.id,
            'memory',
            { ttlSeconds: config.locking.ttlSeconds }
          );
          if (!locked) {
            return jsonExpectedError({
              error: 'conflict',
              message: 'Write lock timeout: another instance is writing to memory.',
              details: { reason: 'lock_contention' },
            });
          }
        }

        const supabase = supabaseManager.getClient();
        if (params.mode === 'create') {
          const resolvedScope = await resolvePluginScope(config, params.plugin_scope as string | undefined);
          if (!resolvedScope.ok) {
            return jsonExpectedError({
              error: 'lookup_failed',
              message: resolvedScope.message,
              details: { reason: resolvedScope.reason },
            });
          }
          const memoryId = randomUUID();
          const insertRow = {
            id: memoryId,
            instance_id: config.instance.id,
            content: params.content as string,
            tags: tagsValidation.normalized,
            plugin_scope: resolvedScope.scope,
            status: 'active',
            version: 1,
            previous_version_id: null,
            chain_root_id: memoryId,
            is_latest: true,
            archived_at: null,
            embedding: null,
          };
          const { data, error } = await supabase
            .from('fqc_memory')
            .insert(insertRow)
            .select('id, content, tags, plugin_scope, created_at, updated_at, version, previous_version_id, is_latest, archived_at')
            .single();
          if (error) throw new Error(error.message);

          const row = data as MemoryRow;
          void embeddingProvider
            .embed(params.content as string)
            .then(async (vector) => {
              const { error } = await supabaseManager
                .getClient()
                .from('fqc_memory')
                .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                .eq('id', row.id);
              if (error) {
                logger.warn(`write_memory: background embedding update failed for ${row.id}: ${error.message}`);
              }
            })
            .catch((err) =>
              logger.warn(
                `write_memory: background embed failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`
              )
            );

          return jsonToolResult(buildMemoryResult(row, include));
        }

        const { data: existing, error: fetchError } = await supabase
          .from('fqc_memory')
          .select('id, content, tags, plugin_scope, version, previous_version_id, is_latest, archived_at')
          .eq('id', params.memory_id as string)
          .eq('instance_id', config.instance.id)
          .single();
        if (fetchError || !existing) {
          return jsonExpectedError({
            error: 'not_found',
            message: `Memory not found: ${String(params.memory_id)}`,
            identifier: String(params.memory_id),
          });
        }
        const existingRow = existing as MemoryRow;
        if (existingRow.is_latest === false) {
          return jsonExpectedError({
            error: 'conflict',
            message: 'Cannot update a non-latest memory version',
            identifier: existingRow.id,
            details: { reason: 'non_latest_memory_version' },
          });
        }

        const nextContent = (params.content as string | undefined) ?? existingRow.content;
        const nextTags = params.tags === undefined ? (existingRow.tags ?? []) : tagsValidation.normalized;
        const { data: insertedData, error: insertError } = await supabase.rpc('fqc_memory_create_version', {
          p_instance_id: config.instance.id,
          p_previous_id: existingRow.id,
          p_content: nextContent,
          p_tags: nextTags,
          p_plugin_scope: existingRow.plugin_scope ?? 'global',
        }) as { data: MemoryRow | MemoryRow[] | null; error: { message: string; code?: string } | null };
        if (insertError) {
          if (insertError.code === '23505' || insertError.message.includes('Cannot update a non-latest memory version')) {
            return jsonExpectedError({
              error: 'conflict',
              message: 'Cannot update a non-latest memory version',
              identifier: String(params.memory_id),
              details: { reason: 'non_latest_memory_version' },
            });
          }
          if (insertError.code === 'P0002') {
            return jsonExpectedError({
              error: 'not_found',
              message: `Memory not found: ${String(params.memory_id)}`,
              identifier: String(params.memory_id),
            });
          }
          throw new Error(insertError.message);
        }
        const inserted = Array.isArray(insertedData) ? insertedData[0] : insertedData;
        if (!inserted) throw new Error('fqc_memory_create_version returned no row');

        const insertedRow = inserted;
        void embeddingProvider
          .embed(nextContent)
          .then(async (vector) => {
            const { error } = await supabaseManager
              .getClient()
              .from('fqc_memory')
              .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
              .eq('id', insertedRow.id);
            if (error) {
              logger.warn(`write_memory: background embedding update failed for ${insertedRow.id}: ${error.message}`);
            }
          })
          .catch((err) =>
            logger.warn(
              `write_memory: background embed failed for ${insertedRow.id}: ${err instanceof Error ? err.message : String(err)}`
            )
          );

        return jsonToolResult(buildMemoryResult(insertedRow, include));
      } catch (err) {
        const msg = formatError(err);
        logger.error(`write_memory failed: ${msg}`);
        return jsonRuntimeError(msg);
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'memory');
        }
      }
    }
  );

  // get_memory: Retrieve one or more memories by ID
  server.registerTool(
    'get_memory',
    {
      description:
        'Retrieve one or more memories by their memory_id. Returns full content and all metadata. Pass a single ID for one memory, or an array of IDs for batch retrieval. Use this after finding memory IDs through search when you need the complete, untruncated content.' +
        'or an array of memory_id strings for batch format.',
      inputSchema: {
        memory_ids: z
          .union([z.string(), z.array(z.string())])
          .describe('Single memory ID (UUID) or array of memory IDs to retrieve'),
        include: z.array(z.enum(['content', 'tags_full'])).optional().describe('Optional memory payload fields'),
      },
    },
    async ({ memory_ids, include }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed',
            },
          ],
          isError: true,
        };
      }

      try {
        const isBatch = Array.isArray(memory_ids);
        const ids = isBatch ? memory_ids : [memory_ids];
        const includeFields = parseMemoryInclude(include);

        const supabase = supabaseManager.getClient();
        const { data, error } = await supabase
          .from('fqc_memory')
          .select('id, content, tags, plugin_scope, created_at, updated_at, version, previous_version_id, is_latest, archived_at')
          .in('id', ids) // 'id' NOT 'memory_id'
          .eq('instance_id', config.instance.id);

        if (error) {
          return jsonRuntimeError(`Error retrieving memories: ${(error as { message: string }).message}`);
        }

        const results = (data ?? []) as MemoryRow[];

        if (!isBatch) {
          const row = results.find((m) => m.id === ids[0]);
          if (!row) {
            return jsonExpectedError({
              error: 'not_found',
              message: `No memory matches identifier '${ids[0]}'`,
              identifier: ids[0],
            });
          }
          return jsonToolResult(buildMemoryResult(row, includeFields));
        }

        return jsonToolResult(buildOrderedMemoryResults(ids, results, includeFields));
      } catch (err) {
        const msg = formatError(err);
        logger.error(`get_memory failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // archive_memory: Archive a memory by setting status=archived and updating tags (ARC-01)
  server.registerTool(
    'archive_memory',
    {
      description:
        'Archive a memory by marking it inactive. Archived memories no longer appear in search results by default. Use this when a memory is outdated, wrong, or the user asks to forget something.',
      inputSchema: {
        memory_ids: z.union([z.string(), z.array(z.string())]).optional().describe('Single memory ID or array of memory IDs to archive'),
        memory_id: z.string().uuid().optional().describe('Legacy singular memory ID accepted during migration'),
      },
    },
    async ({ memory_ids, memory_id }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed',
            },
          ],
          isError: true,
        };
      }

      try {
        const supabase = supabaseManager.getClient();
        const idsInput = memory_ids ?? memory_id;
        if (idsInput === undefined) {
          return expectedInvalidInput('memory_ids is required', { field: 'memory_ids' });
        }
        const isBatch = Array.isArray(idsInput);
        const ids = isBatch ? idsInput : [idsInput];
        if (ids.length === 0) {
          logger.info('archive_memory: archived 0 memory request(s)');
          return jsonToolResult([]);
        }
        const archivedAtByRoot = new Map<string, string>();
        const results: unknown[] = [];
        const { data: chainRows, error: fetchError } = await supabase
          .from('fqc_memory')
          .select('id, content, tags, plugin_scope, status, created_at, updated_at, version, previous_version_id, is_latest, archived_at')
          .eq('instance_id', config.instance.id);
        if (fetchError) throw new Error(fetchError.message);

        const allRows = (chainRows ?? []) as Array<MemoryRow & { status?: string }>;
        const byId = new Map(allRows.map((row) => [row.id, row]));

        for (const id of ids) {
          const requested = byId.get(id);
          if (!requested) {
            results.push({ error: 'not_found', message: `No memory matches identifier '${id}'`, identifier: id });
            continue;
          }
          let root = requested;
          while (root.previous_version_id && byId.has(root.previous_version_id)) {
            root = byId.get(root.previous_version_id)!;
          }
          const rootId = root.id;
          const chain: Array<MemoryRow & { status?: string }> = [];
          const pending = [rootId];
          const seen = new Set<string>();
          while (pending.length > 0) {
            const currentId = pending.shift()!;
            if (seen.has(currentId)) continue;
            seen.add(currentId);
            const row = byId.get(currentId);
            if (!row) continue;
            chain.push(row);
            for (const child of allRows) {
              if (child.previous_version_id === currentId) pending.push(child.id);
            }
          }
          const existingArchivedAt = chain.find((row) => row.archived_at)?.archived_at;
          const archivedAt = existingArchivedAt ?? archivedAtByRoot.get(rootId) ?? new Date().toISOString();
          archivedAtByRoot.set(rootId, archivedAt);

          for (const row of chain.length > 0 ? chain : [requested]) {
            const existingTags: string[] = Array.isArray(row.tags) ? row.tags : [];
            const newTags = [
              ...existingTags.filter((t) => t !== '#status/active'),
              ...(existingTags.includes('#status/archived') ? [] : ['#status/archived']),
            ];
            const { error } = await supabase
              .from('fqc_memory')
              .update({ status: 'archived', tags: newTags, archived_at: archivedAt, updated_at: new Date().toISOString() })
              .eq('id', row.id)
              .eq('instance_id', config.instance.id);
            if (error) throw new Error(`Failed to archive memory: ${row.id}`);
          }

          const latest = chain
            .slice()
            .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? requested;
          results.push({
            ...buildMemoryResult({ ...latest, archived_at: archivedAt }, []),
            status: 'archived',
            archived_version_count: chain.length || 1,
          });
        }

        logger.info(`archive_memory: archived ${ids.length} memory request(s)`);
        return jsonToolResult(isBatch ? results : results[0]);
      } catch (err) {
        const msg = formatError(err);
        logger.error(`archive_memory failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );
}
