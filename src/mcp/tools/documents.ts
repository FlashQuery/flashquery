import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { embeddingProvider } from '../../embedding/provider.js';
import { supabaseManager } from '../../storage/supabase.js';
import { reconcileMissingRow } from '../../storage/document-primitives.js';
import { logger } from '../../logging/logger.js';
import { createDocumentToolDeps } from './documents/deps.js';
import { registerWriteDocumentTool } from './documents/write.js';
import { registerGetDocumentTool } from './documents/get.js';
import { registerArchiveDocumentTool } from './documents/archive.js';
import { registerRemoveDocumentTool } from './documents/remove.js';
import { registerCopyDocumentTool } from './documents/copy.js';
import { registerMoveDocumentTool } from './documents/move.js';

export {
  computeHash,
  listMarkdownFiles,
  parseDocMeta,
  reconcileMissingRow,
  type DocMeta,
} from '../../storage/document-primitives.js';

/**
 * Shared semantic document search helper. Used by search_documents and search_all.
 * Returns raw RPC results with reconciliation applied.
 */
export async function searchDocumentsSemantic(
  config: FlashQueryConfig,
  query: string,
  opts: {
    tags?: string[];
    tagMatch?: 'any' | 'all';
    limit?: number;
    includeArchived?: boolean;
  }
): Promise<Array<{ id: string; path: string; title: string; tags: string[]; similarity: number; created_at: string }>> {
  const { tags, tagMatch = 'any', limit = 20, includeArchived = false } = opts;
  const queryEmbedding = await embeddingProvider.embed(query);
  const supabase = supabaseManager.getClient();
  const rpcResult = (await supabase.rpc('match_documents', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.4,
    match_count: limit,
    filter_instance_id: config.instance.id,
    filter_tags: tags ?? null,
    filter_tag_match: tagMatch,
    include_archived: includeArchived,
  })) as { data: unknown; error: { message: string } | null };
  const { data, error } = rpcResult;
  if (error) throw new Error(error.message);
  const rawResults = (data ?? []) as Array<{
    id: string; path: string; title: string; tags: string[]; similarity: number; created_at: string;
  }>;

  const vaultRoot = config.instance.vault.path;
  for (const r of rawResults) {
    if (!r.path) continue;
    if (!existsSync(join(vaultRoot, r.path))) {
      try {
        const newPath = await reconcileMissingRow(vaultRoot, r.id, r.path, supabase, config.instance.vault.markdownExtensions);
        if (newPath) r.path = newPath;
      } catch (err) {
        logger.warn(
          `searchDocumentsSemantic: reconciliation failed for fqc_id=${r.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  return rawResults.filter((r) => existsSync(join(vaultRoot, r.path)));
}

export function registerDocumentTools(server: McpServer, config: FlashQueryConfig): void {
  const deps = createDocumentToolDeps(config);
  registerWriteDocumentTool(server, deps);
  registerGetDocumentTool(server, deps);
  registerArchiveDocumentTool(server, deps);
  registerRemoveDocumentTool(server, deps);
  registerCopyDocumentTool(server, deps);
  registerMoveDocumentTool(server, deps);
}
