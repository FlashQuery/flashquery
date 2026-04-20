import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';

export function registerPendingReviewTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'clear_pending_reviews',
    {
      description:
        'Query or clear pending review items for a plugin. ' +
        'In query mode (fqc_ids: []), returns all pending items without deleting any. ' +
        'In clear mode (fqc_ids non-empty), deletes the specified items and returns remaining. ' +
        'Idempotent — non-existent IDs are silently ignored.',
      inputSchema: {
        plugin_id: z.string().describe('Plugin identifier'),
        plugin_instance: z
          .string()
          .optional()
          .default('default')
          .describe('Plugin instance identifier (default: "default")'),
        fqc_ids: z
          .array(z.string().uuid())
          .default([])
          .describe('Document IDs to clear. Empty array = query mode.'),
      },
    },
    async ({ plugin_id, plugin_instance, fqc_ids }) => {
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
          isError: true,
        };
      }
      try {
        void plugin_instance; // plugin_instance is accepted for API compatibility but not used for DB filtering
        // Use the FQC server instance ID (config.instance.id) for DB scoping, not the plugin instance name
        const fqcInstanceId = config.instance.id;
        const supabase = supabaseManager.getClient();

        if (fqc_ids.length > 0) {
          // Clear mode: delete specified rows (idempotent — missing IDs silently ignored by Postgres IN())
          const { error: delError } = await supabase
            .from('fqc_pending_plugin_review')
            .delete()
            .eq('plugin_id', plugin_id)
            .eq('instance_id', fqcInstanceId)
            .in('fqc_id', fqc_ids);
          if (delError) {
            logger.error(`clear_pending_reviews delete failed: ${delError.message}`);
            return {
              content: [{ type: 'text' as const, text: `Error: ${delError.message}` }],
              isError: true,
            };
          }
        }

        // Always return current state (query mode or remaining after clear)
        const { data, error } = await supabase
          .from('fqc_pending_plugin_review')
          .select('fqc_id, table_name, review_type, context')
          .eq('plugin_id', plugin_id)
          .eq('instance_id', fqcInstanceId);

        if (error) {
          logger.error(`clear_pending_reviews query failed: ${error.message}`);
          return {
            content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        const items = data ?? [];
        const text =
          items.length > 0
            ? `Pending reviews for ${plugin_id}: ${items.length} item(s)\n${JSON.stringify(items, null, 2)}`
            : `No pending reviews for ${plugin_id}.`;
        logger.info(
          `clear_pending_reviews: ${fqc_ids.length > 0 ? `cleared ${fqc_ids.length} item(s), ` : ''}${items.length} remaining for ${plugin_id}`
        );
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`clear_pending_reviews failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );
}
