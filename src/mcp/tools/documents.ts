import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
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
  type DocMeta,
} from '../../storage/document-primitives.js';

/**
 * Shared semantic document search helper. Used by search_documents and search_all.
 * Returns raw RPC results with reconciliation applied.
 */
export function searchDocumentsSemantic(
  config: FlashQueryConfig,
  query: string,
  opts: {
    tags?: string[];
    tagMatch?: 'any' | 'all';
    limit?: number;
    includeArchived?: boolean;
  }
): Promise<Array<{ id: string; path: string; title: string; tags: string[]; similarity: number; created_at: string }>> {
  void config;
  void query;
  void opts;
  return Promise.reject(new Error('Legacy whole-document semantic search is retired; use chunk catalog search instead.'));
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
