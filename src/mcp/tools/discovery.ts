import * as readline from 'node:readline';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { supabaseManager } from '../../storage/supabase.js';
import { vaultManager } from '../../storage/vault.js';
import { executeDiscovery } from '../../services/discovery-orchestrator.js';
import type { GetUserPrompt, PluginOption } from '../../services/discovery-orchestrator.js';
import type { DiscoveryQueueItem } from '../../services/scanner.js';

// ─────────────────────────────────────────────────────────────────────────────
// DiscoverDocumentResult — structured MCP response for discover_document
// ─────────────────────────────────────────────────────────────────────────────

interface DiscoverDocumentResult {
  documents: Array<{
    path: string;
    ownership: string | null;
    status: 'complete' | 'pending' | 'failed';
    error?: string;
  }>;
  summary: {
    total: number;
    completed: number;
    pending: number;
    errors: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// createMcpUserPrompt — interactive stdin prompt for MCP context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a getUserPrompt callback for MCP context.
 * Same numbered list + stdin mechanism as CLI (D-08).
 * Prompts appear in the MCP client's stdio (Claude Code / Claude Desktop).
 *
 * Security: T-57-01 — validate plugin_id against known plugins.
 *           T-57-03 — log all ownership selections for audit trail.
 */
function createMcpUserPrompt(): GetUserPrompt {
  return async (filePath: string, options: PluginOption[]): Promise<string> => {
    // T-57-02: Validate path length
    if (filePath.length > 1024) {
      logger.warn(`[T-57-05] path exceeds 1024 chars in MCP prompt`);
    }

    // Display numbered list on stderr (MCP stdout is reserved for protocol)
    process.stderr.write(`\nAmbiguous: ${filePath} — which plugin owns this?\n`);
    options.forEach((opt, i) => {
      process.stderr.write(`  ${i + 1}) ${opt.plugin_id} (${opt.folder})\n`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: false,
    });

    const selectedPluginId = await new Promise<string>((resolve) => {
      rl.question(`Enter selection (1-${options.length}): `, (answer) => {
        rl.close();
        const idx = parseInt(answer.trim(), 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < options.length) {
          resolve(options[idx].plugin_id);
        } else {
          // Default to first option on invalid/empty input (Risk 1 mitigation)
          logger.debug(`[OWN-04] MCP invalid selection "${answer}", defaulting to first option`);
          resolve(options[0].plugin_id);
        }
      });
    });

    // T-57-03: Log all ownership selections for audit trail
    logger.info(`[OWN-04] MCP ownership selection: path=${filePath}, selected=${selectedPluginId}`);
    return selectedPluginId;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// queryFlaggedDocuments — fetch all documents with needs_discovery=true
// ─────────────────────────────────────────────────────────────────────────────

async function queryFlaggedDocuments(): Promise<DiscoveryQueueItem[]> {
  const client = supabaseManager.getClient();
  const { data, error } = await client
    .from('fqc_documents')
    .select('id, path')
    .eq('needs_discovery', true);

  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    fqcId: row.id as string,
    path: row.path as string,
    pluginId: '',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// queryDocumentsByPaths — look up documents by vault-relative paths
// ─────────────────────────────────────────────────────────────────────────────

async function queryDocumentsByPaths(paths: string[]): Promise<DiscoveryQueueItem[]> {
  // T-57-02: Normalize all paths to prevent path traversal
  const normalizedPaths = paths.map((p) => path.normalize(p).replace(/^\/+/, ''));

  const client = supabaseManager.getClient();
  const { data, error } = await client
    .from('fqc_documents')
    .select('id, path')
    .in('path', normalizedPaths);

  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }

  // For paths not found in DB, construct items with empty fqcId (graceful degradation)
  const foundPaths = new Set((data ?? []).map((row) => row.path as string));
  const items: DiscoveryQueueItem[] = [];

  for (const normalizedPath of normalizedPaths) {
    const found = (data ?? []).find((row) => row.path === normalizedPath);
    if (found) {
      items.push({
        fqcId: found.id as string,
        path: found.path as string,
        pluginId: '',
      });
    } else {
      // Document not in DB — return as pending
      logger.warn(`[DISC] document not found in DB, skipping: ${normalizedPath}`);
      items.push({
        fqcId: '',
        path: normalizedPath,
        pluginId: '',
      });
    }
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// registerDiscoveryTools — registers discover_document MCP tool
// ─────────────────────────────────────────────────────────────────────────────

export function registerDiscoveryTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool: discover_document ──────────────────────────────────────────────

  server.registerTool(
    'discover_document',
    {
      description:
        'Run plugin ownership discovery on vault documents. mode="flagged" processes all documents pending discovery. mode="paths" discovers specific documents by vault-relative path. Use this after new files are added to a plugin\'s vault folder, or after unregistering/re-registering a plugin to reassign document ownership.' +
        'mode="flagged" discovers all documents with needs_discovery=true. ' +
        'mode="paths" discovers specific documents by vault-relative paths. ' +
        'Returns structured JSON with discovery results and summary.',
      inputSchema: {
        mode: z
          .enum(['flagged', 'paths'])
          .describe(
            'Discovery mode: "flagged" for all pending documents, "paths" for specific paths'
          ),
        paths: z
          .array(z.string())
          .optional()
          .describe(
            'Array of vault-relative paths to discover (required when mode="paths")'
          ),
      },
    },
    async (params) => {
      // Step 1: Shutdown check
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
        // Step 2: Validate params
        if (params.mode === 'paths') {
          if (!params.paths || params.paths.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: mode="paths" requires a non-empty "paths" array',
                },
              ],
              isError: true,
            };
          }
          // Validate individual path lengths (T-57-05)
          for (const p of params.paths) {
            if (p.length > 1024) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Error: path exceeds maximum length (1024 chars): ${p.slice(0, 50)}...`,
                  },
                ],
                isError: true,
              };
            }
          }
        }

        // Step 3: Determine discovery scope
        let items: DiscoveryQueueItem[];
        if (params.mode === 'flagged') {
          logger.info('[discover_document] querying flagged documents');
          items = await queryFlaggedDocuments();
        } else {
          logger.info(`[discover_document] discovering ${params.paths!.length} specific path(s)`);
          items = await queryDocumentsByPaths(params.paths!);
        }

        logger.info(`[discover_document] starting discovery of ${items.length} document(s)`);

        // Step 4: Set up getUserPrompt callback for ambiguous ownership
        const getUserPrompt: GetUserPrompt = createMcpUserPrompt();

        // Step 5: Process each document
        const result: DiscoverDocumentResult = {
          documents: [],
          summary: { total: items.length, completed: 0, pending: 0, errors: 0 },
        };

        for (const item of items) {
          // Handle documents not in DB (empty fqcId)
          if (item.fqcId === '') {
            logger.warn(`[DISC] skipping document not in DB: ${item.path}`);
            result.documents.push({
              path: item.path,
              ownership: null,
              status: 'pending',
              error: 'Document not found in database — run `flashquery scan` first',
            });
            result.summary.pending++;
            continue;
          }

          try {
            const execResult = await executeDiscovery(item, config, vaultManager);

            const ownership = execResult.plugin_id
              ? `${execResult.plugin_id}${execResult.type ? `/${execResult.type}` : ''}`
              : null;

            if (execResult.status === 'complete') {
              result.summary.completed++;
              result.documents.push({
                path: item.path,
                ownership,
                status: 'complete',
              });
              logger.debug(`[discover_document] complete: ${item.path} → ${ownership}`);
            } else if (execResult.status === 'pending') {
              result.summary.pending++;
              result.documents.push({
                path: item.path,
                ownership,
                status: 'pending',
                error: execResult.errors?.[0]?.error ?? 'ambiguous ownership or lock unavailable',
              });
              logger.debug(`[discover_document] pending: ${item.path}`);
            } else {
              // failed
              const errMsg = execResult.errors?.[0]?.error ?? 'Unknown error';
              result.summary.errors++;
              result.documents.push({
                path: item.path,
                ownership: null,
                status: 'failed',
                error: errMsg,
              });
              logger.warn(`[discover_document] failed: ${item.path} — ${errMsg}`);
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(`[discover_document] DB error for ${item.path}: ${errMsg}`);
            // DB errors return isError=true per D-08
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Fatal database error during discovery of ${item.path}: ${errMsg}`,
                },
              ],
              isError: true,
            };
          }
        }

        // Step 6: Return structured result
        logger.info(
          `[discover_document] complete: ${result.summary.completed} succeeded, ` +
          `${result.summary.pending} pending, ${result.summary.errors} errors`
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[discover_document] unexpected error: ${message}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Discovery failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
