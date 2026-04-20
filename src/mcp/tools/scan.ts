import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runScanOnce } from '../../services/scanner.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { invalidateReconciliationCache } from '../../services/plugin-reconciliation.js';

export function registerScanTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'force_file_scan',
    {
      description:
        'Trigger an immediate vault scan to discover new files, detect moves, and track deletions. Updates the database index with current vault state. Use this before semantic search if you suspect files have been added or changed outside the AI chat, or after bulk file operations. Returns counts of new, moved, deleted, and hash-changed files.' +
        'Use before semantic search to ensure the index is up-to-date. ' +
        'Returns counts of new, moved, deleted, and hash-mismatched files.',
      inputSchema: {
        background: z
          .boolean()
          .optional()
          .describe(
            'If true, scan runs in background and returns immediately. Default: false (synchronous, waits for results).'
          ),
      },
    },
    async ({ background }) => {
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
        if (background) {
          invalidateReconciliationCache();
          void runScanOnce(config).catch((err: unknown) => {
            logger.warn(
              `force_file_scan background error: ${err instanceof Error ? err.message : String(err)}`
            );
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  status: 'started',
                  message: 'Vault scan started in background. Results will be available in logs.',
                }),
              },
            ],
          };
        }

        invalidateReconciliationCache();
        const result = await runScanOnce(config);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'complete',
                new_files: result.newFiles,
                updated_files: result.hashMismatches,
                moved_files: result.movedFiles,
                deleted_files: result.deletedFiles,
                status_mismatches: result.statusMismatches,
                embedding_status: result.embeddingStatus,
                embeds_awaited: result.embedsAwaited,
              }),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`force_file_scan failed: ${message}`);
        return {
          content: [{ type: 'text' as const, text: `Scan failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
