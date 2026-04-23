import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider, NullEmbeddingProvider } from '../../embedding/provider.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { validateAllTags } from '../../utils/tag-validator.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  formatKeyValueEntry,
  shouldShowProgress,
  progressMessage,
  formatEmptyResults,
  formatMissingIds,
  joinBatchEntries,
} from '../utils/response-formats.js';

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) return `${err.message} — cause: ${cause.message}`;
  if (cause !== undefined) return `${err.message} — cause: ${JSON.stringify(cause)}`;
  return err.message;
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
  }
): Promise<Array<{ id: string; content: string; tags: string[]; similarity: number; created_at: string }>> {
  const { tags, tagMatch = 'any', threshold = 0.4, limit = 10 } = opts;
  const queryEmbedding = await embeddingProvider.embed(query);
  const supabase = supabaseManager.getClient();
  const rpcResult = await supabase.rpc('match_memories', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: threshold,
    match_count: limit,
    filter_tags: tags ?? null,
    filter_tag_match: tagMatch,
    filter_instance_id: config.instance.id,
  });
  const { data, error } = rpcResult as { data: unknown; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string; content: string; tags: string[]; similarity: number; created_at: string;
  }>;
}

export function registerMemoryTools(server: McpServer, config: FlashQueryConfig): void {
  // save_memory: Store a persistent fact, preference, or observation
  server.registerTool(
    'save_memory',
    {
      description:
        'Store a persistent fact, preference, or observation that should be recalled in future conversations. Memories survive across sessions — use this for information the user wants remembered long-term, not for temporary notes. Tag memories for easy retrieval later. Examples: user preferences, relationship context, project decisions, things the user explicitly asks to be remembered.' +
        'Scoped by instance and tags. Tags are normalized and validated.',
      inputSchema: {
        content: z.string().describe('The memory text to store'),
        tags: z.array(z.string()).optional().describe('Tags for categorization (replaces project scoping)'),
        plugin_scope: z.string().optional().describe('Plugin scope for this memory (e.g., "crm"). Auto-corrected via fuzzy match against registered plugins. Default: "global"'),
      },
    },
    async ({ content, tags, plugin_scope }) => {
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
        if (config.locking.enabled) {
          const locked = await acquireLock(
            supabaseManager.getClient(),
            config.instance.id,
            'memory',
            { ttlSeconds: config.locking.ttlSeconds }
          );
          if (!locked) {
            return {
              content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is writing to memory. Retry in a few seconds.' }],
              isError: true,
            };
          }
        }
        // Tag validation: normalize and validate before insert (D-01, D-03, TAGS-02, TAGS-03)
        const validation = validateAllTags(tags ?? []);
        if (!validation.valid) {
          const messages = [
            ...validation.errors,
            ...(validation.conflicts.length > 1
              ? [`Memory has conflicting statuses: ${validation.conflicts.join(', ')}. Choose one to keep.`]
              : []),
          ];
          return {
            content: [{ type: 'text' as const, text: `Tag validation failed: ${messages.join('; ')}` }],
            isError: true,
          };
        }

        // Resolve plugin_scope via fuzzy matching (D-07, D-08)
        let resolvedScope = 'global';
        let scopeCorrected = false;
        if (plugin_scope && plugin_scope !== 'global') {
          try {
            const { data: matchedScope, error: rpcError } = await (supabaseManager.getClient()
              .rpc('find_plugin_scope', {
                search_name: plugin_scope,
                p_instance_id: config.instance.id,
                threshold: 0.8,
              }) as Promise<{ data: string; error: { message: string } | null }>);
            if (rpcError) {
              logger.warn(`save_memory: plugin_scope lookup failed: ${rpcError.message} — defaulting to 'global'`);
            } else {
              resolvedScope = matchedScope;
              if (resolvedScope !== plugin_scope && resolvedScope !== 'global') {
                scopeCorrected = true;
              }
            }
          } catch (err) {
            logger.warn(`save_memory: plugin_scope lookup error: ${err instanceof Error ? err.message : String(err)} — defaulting to 'global'`);
          }
        }

        const supabase = supabaseManager.getClient();
        const { data, error } = await supabase
          .from('fqc_memory')
          .insert({
            instance_id: config.instance.id,
            content,
            tags: validation.normalized,
            plugin_scope: resolvedScope,
            status: 'active',
            embedding: null, // Will be populated by fire-and-forget embed below
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);
        logger.info(`save_memory: stored (id=${data.id}, tags=${validation.normalized.join(', ') || 'none'})`);

        const scopeDisplay = scopeCorrected
          ? ` Scope: ${resolvedScope} (auto-corrected from "${plugin_scope}").`
          : (plugin_scope && plugin_scope !== 'global' && resolvedScope === 'global')
            ? ` Warning: plugin "${plugin_scope}" not found — saved to global scope.`
            : ' Scope: Global.';

        // Fire-and-forget: embed after MCP response is returned (matches update_memory pattern)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const newId: string = data.id;
        void embeddingProvider
          .embed(content)
          .then((vector) =>
            supabaseManager
              .getClient()
              .from('fqc_memory')
              .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
              .eq('id', newId)
          )
          .catch((err) =>
            logger.warn(
              `save_memory: background embed failed for ${newId}: ${err instanceof Error ? err.message : String(err)}`
            )
          );

        return {
          content: [
            {
              type: 'text' as const,
              text: `Memory saved (id: ${data.id}). Tags: ${validation.normalized.join(', ') || 'none'}.${scopeDisplay}`,
            },
          ],
        };
      } catch (err) {
        const msg = formatError(err);
        logger.error(`save_memory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'memory');
        }
      }
    }
  );

  // search_memory: Retrieve memories by semantic similarity
  server.registerTool(
    'search_memory',
    {
      description:
        'Search memories by semantic similarity, optionally filtered by tags. Returns ranked results with match scores. Use this when the user asks "do I have a memory about X", "what did I note about Y", or when you need to recall context from previous conversations. For listing all memories with optional tag filtering (no search query), use list_memories instead.' +
        'Scoped by instance_id; filter further via optional tags.',
      inputSchema: {
        query: z.string().describe('The search query'),
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        tag_match: z
          .enum(['any', 'all'])
          .optional()
          .describe(
            'How to combine multiple tags. "any" (default): items with at least one of the tags. ' +
            '"all": only items with every tag.'
          ),
        threshold: z.number().optional().describe('Minimum similarity score (0-1). Default: 0.4'),
        limit: z.number().optional().describe('Maximum number of results. Default: 10'),
      },
    },
    async ({ query, tags, threshold, limit, tag_match }) => {
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
        // EMBED-03: Proactive check for disabled embedding
        if (embeddingProvider instanceof NullEmbeddingProvider) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Semantic search unavailable (no API key configured). Use tag-based search with list_memories instead.',
            }],
            isError: true,
          };
        }

        // Delegate to shared helper (also used by search_all)
        const results = await searchMemoriesSemantic(config, query, {
          tags,
          tagMatch: tag_match ?? 'any',
          threshold,
          limit,
        });
        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: formatEmptyResults('memories') }],
            isError: false,  // Explicit: success with empty results (not an error)
          };
        }

        // Format results using key-value pairs with --- separators
        const blocks = results.map((r) => [
          formatKeyValueEntry('Memory ID', r.id),
          formatKeyValueEntry('Content', r.content),
          formatKeyValueEntry('Match Score', `${Math.round(r.similarity * 100)}%`),
          formatKeyValueEntry('Tags', r.tags),
          formatKeyValueEntry('Created', r.created_at),
        ].join('\n'));

        const responseText = joinBatchEntries(blocks);
        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
        };
      } catch (err) {
        const msg = formatError(err);
        logger.error(`search_memory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // update_memory: Update an existing memory by creating a new versioned row
  server.registerTool(
    'update_memory',
    {
      description:
        'Update an existing memory\'s content by ID. Creates a new version — the previous version is preserved for history. Use search_memory or list_memories to find the memory_id first. Use this when the user says "update the memory about X" or when a previously saved fact has changed.',
      inputSchema: {
        memory_id: z
          .string()
          .uuid()
          .describe('UUID of the memory to update. Retrieve via search_memory or list_memories.'),
        content: z.string().describe('New content to replace the existing memory text'),
        tags: z
          .array(z.string())
          .optional()
          .describe('New tags. If omitted, existing tags are preserved.'),
      },
    },
    async ({ memory_id, content, tags }) => {
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
        if (config.locking.enabled) {
          const locked = await acquireLock(
            supabaseManager.getClient(),
            config.instance.id,
            'memory',
            { ttlSeconds: config.locking.ttlSeconds }
          );
          if (!locked) {
            return {
              content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is updating memory. Retry in a few seconds.' }],
              isError: true,
            };
          }
        }
        // Step 1: Fetch existing row
        const supabase = supabaseManager.getClient();
        const { data: existing, error: fetchError } = await supabase
          .from('fqc_memory')
          .select('version, tags, plugin_scope')
          .eq('id', memory_id)
          .eq('instance_id', config.instance.id)
          .single();
        if (fetchError || !existing) {
          throw new Error(fetchError?.message ?? `Memory not found: ${memory_id}`);
        }

        // Step 2: Insert new version row (embedding applied fire-and-forget after response)
        const newTags = tags ?? (existing.tags as string[]);
        const { data, error } = await supabase
          .from('fqc_memory')
          .insert({
            instance_id: config.instance.id,
            content,
            tags: newTags,
            plugin_scope: existing.plugin_scope as string,
            status: 'active',
            version: (existing.version as number) + 1,
            previous_version_id: memory_id,
            embedding: null,
          })
          .select('id')
          .single();
        if (error) throw new Error(error.message);

        logger.info(
          `update_memory: created version ${(existing.version as number) + 1} (id=${data.id}, previous=${memory_id})`
        );

        // Fire-and-forget: embed after MCP response is returned (matches create_document pattern)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const newId: string = data.id;
        void embeddingProvider
          .embed(content)
          .then((vector) =>
            supabaseManager
              .getClient()
              .from('fqc_memory')
              .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
              .eq('id', newId)
          )
          .catch((err) =>
            logger.warn(
              `update_memory: background embed failed for ${newId}: ${err instanceof Error ? err.message : String(err)}`
            )
          );

        return {
          content: [
            {
              type: 'text' as const,
              text: `Memory updated. New version id: ${data.id}. Previous version id: ${memory_id}. Version: ${(existing.version as number) + 1}.`,
            },
          ],
        };
      } catch (err) {
        const msg = formatError(err);
        logger.error(`update_memory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'memory');
        }
      }
    }
  );

  // list_memories: List recent memories with optional filters
  server.registerTool(
    'list_memories',
    {
      description:
        'List memories filtered by tags, without requiring a search query. Returns all matching memories with truncated content previews and memory IDs. Use this when the user wants to browse or review memories by category — e.g. "show me my CRM memories" or "list everything tagged \'preference\'". For finding a specific memory by content, use search_memory instead.' +
        'Scoped by instance_id; filter further via optional tags.',
      inputSchema: {
        tags: z.array(z.string()).optional().describe('Filter by tags'),
        tag_match: z
          .enum(['any', 'all'])
          .optional()
          .describe(
            'How to combine multiple tags. "any" (default): items with at least one of the tags. ' +
            '"all": only items with every tag.'
          ),
        limit: z.number().optional().describe('Maximum number of results. Default: 50'),
      },
    },
    async ({ tags, limit, tag_match }) => {
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
        let query = supabase
          .from('fqc_memory')
          .select('id, content, tags, plugin_scope, created_at')
          .eq('instance_id', config.instance.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(limit ?? 50);

        if (tags && tags.length > 0) {
          const matchMode = tag_match ?? 'any';
          if (matchMode === 'any') {
            query = query.overlaps('tags', tags);
          } else {
            query = query.contains('tags', tags);
          }
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const memories = (data ?? []) as Array<{
          id: string;
          content: string;
          tags: string[];
          plugin_scope: string;
          created_at: string;
        }>;
        if (memories.length === 0) {
          return { content: [{ type: 'text' as const, text: formatEmptyResults('memories') }] };
        }

        // Format results using key-value pairs with --- separators
        // Content is truncated to 200 chars for list view
        const blocks = memories.map((m) => {
          const contentPreview = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
          return [
            formatKeyValueEntry('Memory ID', m.id),
            formatKeyValueEntry('Content', contentPreview),
            formatKeyValueEntry('Tags', m.tags),
            formatKeyValueEntry('Created', m.created_at),
          ].join('\n');
        });

        const responseText = joinBatchEntries(blocks);
        return {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
        };
      } catch (err) {
        const msg = formatError(err);
        logger.error(`list_memories failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // get_memory: Retrieve one or more memories by ID
  server.registerTool(
    'get_memory',
    {
      description:
        'Retrieve one or more memories by their memory_id. Returns full content and all metadata. Pass a single ID for one memory, or an array of IDs for batch retrieval. Use this after finding memory IDs through search_memory or list_memories when you need the complete, untruncated content.' +
        'or an array of memory_id strings for batch format.',
      inputSchema: {
        memory_ids: z
          .union([z.string(), z.array(z.string())])
          .describe('Single memory ID (UUID) or array of memory IDs to retrieve'),
      },
    },
    async ({ memory_ids }) => {
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

        const supabase = supabaseManager.getClient();
        const { data, error } = await supabase
          .from('fqc_memory')
          .select('id, content, tags, created_at, updated_at')
          .in('id', ids) // 'id' NOT 'memory_id'
          .eq('instance_id', config.instance.id)
          .eq('status', 'active');

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error retrieving memories: ${(error as { message: string }).message}`,
              },
            ],
            isError: true,
          };
        }

        const results = (data ?? []) as Array<{
          id: string;
          content: string;
          tags: string[];
          created_at: string;
          updated_at: string;
        }>;

        const foundIds = new Set(results.map((m) => m.id));
        const missingIds = ids.filter((id) => !foundIds.has(id));

        // All missing
        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: formatMissingIds(ids) }],
            isError: true,
          };
        }

        // Format single memory (non-batch input) — content first, blank line, then metadata
        if (!isBatch) {
          const m = results[0];
          const lines = [
            m.content, // Content first, unlabeled
            '', // Blank line separator
            formatKeyValueEntry('Memory ID', m.id),
            formatKeyValueEntry('Tags', m.tags),
            formatKeyValueEntry('Created', m.created_at),
            formatKeyValueEntry('Updated', m.updated_at),
          ];
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }

        // Format batch — show progress if >100 IDs
        let responseText = '';
        if (shouldShowProgress(ids.length)) {
          responseText += progressMessage(ids.length) + '\n\n';
        }

        const blocks = results.map((m) => {
          return [
            formatKeyValueEntry('Memory ID', m.id),
            formatKeyValueEntry('Content', m.content),
            formatKeyValueEntry('Tags', m.tags),
            formatKeyValueEntry('Created', m.created_at),
            formatKeyValueEntry('Updated', m.updated_at),
          ].join('\n');
        });

        responseText += joinBatchEntries(blocks);

        // Partial results — append not-found note
        if (missingIds.length > 0) {
          responseText += '\n\n' + formatMissingIds(missingIds);
        }

        return { content: [{ type: 'text' as const, text: responseText }] };
      } catch (err) {
        const msg = formatError(err);
        logger.error(`get_memory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // archive_memory: Archive a memory by setting status=archived and updating tags (ARC-01)
  server.registerTool(
    'archive_memory',
    {
      description:
        'Archive a memory by marking it inactive. Archived memories no longer appear in search_memory or list_memories results. Use this when a memory is outdated, wrong, or the user asks to forget something.',
      inputSchema: {
        memory_id: z.string().uuid().describe('UUID of the memory to archive'),
      },
    },
    async ({ memory_id }) => {
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

        // Step 1: Fetch current tags
        const { data: existing, error: fetchError } = await supabase
          .from('fqc_memory')
          .select('tags, status')
          .eq('id', memory_id)
          .eq('instance_id', config.instance.id)
          .single();
        if (fetchError || !existing) {
          throw new Error(fetchError?.message ?? `Memory not found: ${memory_id}`);
        }

        // Step 2: Build new tags — remove #status/active, add #status/archived
        const existingTags: string[] = Array.isArray(existing.tags)
          ? (existing.tags as string[])
          : [];
        const newTags = [
          ...existingTags.filter((t) => t !== '#status/active'),
          ...(existingTags.includes('#status/archived') ? [] : ['#status/archived']),
        ];

        // Step 3: Update status and tags in fqc_memory
        const { error } = await supabase
          .from('fqc_memory')
          .update({ status: 'archived', tags: newTags, updated_at: new Date().toISOString() })
          .eq('id', memory_id)
          .eq('instance_id', config.instance.id);
        if (error) throw new Error(`Failed to archive memory: ${memory_id}`);

        logger.info(`archive_memory: archived memory ${memory_id}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Memory archived (id: ${memory_id}). Tags updated to include #status/archived.`,
            },
          ],
        };
      } catch (err) {
        const msg = formatError(err);
        logger.error(`archive_memory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );
}
