/**
 * pending-review.ts — MCP tool for querying and clearing pending plugin review items.
 *
 * Registers: clear_pending_reviews
 *
 * Query mode (fqc_ids: []):  returns all pending review rows for plugin/instance
 * Clear mode (fqc_ids: [...]): deletes specified rows, then returns remaining
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { supabaseManager } from '../../storage/supabase.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { logger } from '../../logging/logger.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PendingReviewRow {
  fqc_id: string;
  table_name: string;
  review_type: string;
  context: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerPendingReviewTools(
  server: McpServer,
  _config: FlashQueryConfig,
): void {
  server.registerTool(
    'clear_pending_reviews',
    {
      description:
        'Query or clear pending plugin review items. ' +
        'Call with fqc_ids: [] to list all pending reviews for a plugin/instance (query mode). ' +
        'Call with fqc_ids: ["uuid1", "uuid2"] to delete those review items, then return remaining (clear mode).',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z.string().optional().default('default').describe('Plugin instance (default: "default")'),
        fqc_ids: z.array(z.string()).describe('UUIDs to clear. Empty array = query mode (no delete).'),
      },
    },
    async ({ plugin_id, plugin_instance = 'default', fqc_ids }) => {
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
          isError: true,
        };
      }

      try {
        const supabase = supabaseManager.getClient();

        // Clear mode: delete specified rows first
        if (fqc_ids.length > 0) {
          const { error: deleteError } = await supabase
            .from('fqc_pending_plugin_review')
            .delete()
            .eq('plugin_id', plugin_id)
            .eq('instance_id', plugin_instance)
            .in('fqc_id', fqc_ids);

          if (deleteError) {
            logger.error(`clear_pending_reviews delete failed: ${deleteError.message}`);
            return {
              content: [{ type: 'text' as const, text: `Error clearing reviews: ${deleteError.message}` }],
              isError: true,
            };
          }
        }

        // Query remaining items
        const { data, error: selectError } = await supabase
          .from('fqc_pending_plugin_review')
          .select('fqc_id, table_name, review_type, context')
          .eq('plugin_id', plugin_id)
          .eq('instance_id', plugin_instance);

        if (selectError) {
          logger.error(`clear_pending_reviews select failed: ${selectError.message}`);
          return {
            content: [{ type: 'text' as const, text: `Error querying reviews: ${selectError.message}` }],
            isError: true,
          };
        }

        const rows = (data ?? []) as PendingReviewRow[];

        if (rows.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No pending reviews' }],
          };
        }

        const lines = rows.map((r) =>
          `fqc_id: ${r.fqc_id} | table_name: ${r.table_name} | review_type: ${r.review_type} | context: ${JSON.stringify(r.context)}`,
        );

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`clear_pending_reviews unexpected error: ${msg}`);
        return {
          content: [{ type: 'text' as const, text: `Unexpected error: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
