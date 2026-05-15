import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../storage/supabase.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult, withWarnings } from '../utils/response-formats.js';

interface PendingReviewRow {
  id: string;
  fqc_id?: string | null;
  plugin_id: string;
  table_name: string;
  review_type: string;
  context?: Record<string, unknown> | null;
}

function publicItem(row: PendingReviewRow): Record<string, unknown> {
  return {
    id: row.id,
    fqc_id: row.fqc_id ?? null,
    type: row.review_type,
    plugin_id: row.plugin_id,
    table: row.table_name,
    path: typeof row.context?.path === 'string' ? row.context.path : null,
    context: row.context ?? {},
  };
}

export function registerPendingReviewTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'clear_pending_reviews',
    {
      description:
        'List or clear pending plugin review items. Use action:"list" to inspect pending row IDs, or action:"clear" with optional plugin_id and/or ids filters to clear rows.',
      inputSchema: {
        action: z.enum(['list', 'clear']).describe('Action to perform: list pending rows or clear rows.'),
        plugin_id: z.string().optional().describe('Optional plugin identifier filter'),
        ids: z.array(z.string()).optional().describe('Pending review row IDs returned by action:"list"'),
      },
    },
    async ({ action, plugin_id, ids }) => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }
      try {
        if (action !== 'list' && action !== 'clear') {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'action is required; use action: "list" or action: "clear"',
            details: { field: 'action' },
          });
        }

        // Use the FQC server instance ID (config.instance.id) for DB scoping, not the plugin instance name
        const fqcInstanceId = config.instance?.id ?? 'default';
        const supabase = supabaseManager.getClient();

        let query = supabase
          .from('fqc_pending_plugin_review')
          .select('id, fqc_id, plugin_id, table_name, review_type, context')
          .eq('instance_id', fqcInstanceId);
        if (plugin_id) query = query.eq('plugin_id', plugin_id);
        if (ids && ids.length > 0) query = query.in('id', ids);

        const { data: matchingRows, error: queryError } = await query as {
          data: PendingReviewRow[] | null;
          error: { message: string } | null;
        };
        if (queryError) {
          logger.error(`clear_pending_reviews query failed: ${queryError.message}`);
          return jsonRuntimeError(queryError.message);
        }

        const items = matchingRows ?? [];
        if (action === 'list') {
          return jsonToolResult({ pending: items.length, items: items.map(publicItem) });
        }

        if (items.length > 0 || (!plugin_id && (!ids || ids.length === 0))) {
          let deleteQuery = supabase
            .from('fqc_pending_plugin_review')
            .delete()
            .eq('instance_id', fqcInstanceId);
          if (plugin_id) deleteQuery = deleteQuery.eq('plugin_id', plugin_id);
          if (ids && ids.length > 0) deleteQuery = deleteQuery.in('id', ids);
          const { error: delError } = await deleteQuery as { error: { message: string } | null };
          if (delError) {
            logger.error(`clear_pending_reviews delete failed: ${delError.message}`);
            return jsonRuntimeError(delError.message);
          }
        }

        logger.info(
          `clear_pending_reviews: cleared ${items.length} item(s)${plugin_id ? ` for ${plugin_id}` : ''}`
        );
        return jsonToolResult(withWarnings(
          { cleared: items.length, items: items.map(publicItem) },
          ids && ids.length > 0 && items.length === 0 ? ['no_matching_items'] : []
        ));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`clear_pending_reviews failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );
}
