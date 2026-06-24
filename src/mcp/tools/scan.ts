import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { maintainVault, type MaintainVaultInput } from '../../services/maintenance.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult } from '../utils/response-formats.js';

export const MAINTENANCE_ACTIONS = [
  'sync',
  'repair',
  'status',
  'backfill_embeddings',
  'rebuild_embeddings',
  'retire_embedding',
  'abort',
  'graph_worker',
  'graph_lint',
  'graph_lint_status',
  'graph_lint_prune',
] as const;

const MaintenanceActionSchema = z.enum(MAINTENANCE_ACTIONS);

const LifecycleScopeSchema = z
  .object({
    entity_types: z.array(z.enum(['documents', 'memory', 'records'])).optional(),
    project: z.string().optional(),
    path_prefix: z.string().optional(),
    records: z
      .object({
        plugin: z.union([z.string(), z.array(z.string())]).optional(),
        targets: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .passthrough();

export function registerScanTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'maintain_vault',
    {
      description:
        'Run administrative vault maintenance jobs. Use this when files changed outside FlashQuery and the vault index needs sync, repair, lifecycle embedding maintenance, or job-status inspection.\n\n' +
        'Use action: "sync" to scan external filesystem changes. Use action: "repair" to reconcile tracked document state. Use ["repair","sync"] when both are needed; repair runs before sync. Lifecycle actions backfill_embeddings, rebuild_embeddings, retire_embedding, and abort must be sent as single actions and cannot be combined in action arrays. Use background: true for sync or supported lifecycle actions, and use action: "status" with job_id to inspect a background job.\n\n' +
        'Do not use this as part of normal read/write workflows or for caller-side staleness checks; normal tools return current authoritative state. Do not expect scanner internals such as queue depth, hashes, or per-document sync versions in the response.\n\n' +
        'Example: maintain_vault({ "action": ["repair", "sync"], "dry_run": false })',
      inputSchema: {
        action: z
          .union([MaintenanceActionSchema, z.array(MaintenanceActionSchema)])
          .describe('Maintenance action: sync, repair, status, lifecycle action, or a sync/repair action array.'),
        dry_run: z.boolean().optional().describe('Valid for repair and lifecycle actions that support dry-run.'),
        background: z.boolean().optional().describe('Valid for sync and lifecycle actions that support background jobs.'),
        job_id: z.string().optional().describe('Required for action: status or abort.'),
        embedding_name: z.string().optional().describe('Embedding catalog entry name for core lifecycle actions.'),
        scope: LifecycleScopeSchema.optional().describe('Lifecycle entity scope for backfill_embeddings or rebuild_embeddings.'),
        max_rows: z.number().int().optional().describe('Lifecycle row ceiling; 0 means unlimited.'),
        max_documents_in_response: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Document lifecycle reporting cap for by_document; defaults to 1000.'),
        confirm: z.string().optional().describe('Confirmation string required by destructive lifecycle actions.'),
        stale_only: z.boolean().optional().describe('Narrow rebuild_embeddings to stale rows.'),
        mismatched_width_only: z.boolean().optional().describe('Narrow rebuild_embeddings to width-mismatched rows.'),
        drop_stamping_columns: z.boolean().optional().describe('Retire option; defaults true in lifecycle processors.'),
        rules: z.array(z.string()).optional().describe('Graph lint rule IDs to execute for action: graph_lint.'),
        run_id: z.string().optional().describe('Graph lint run id for action: graph_lint_status.'),
        limit: z.number().int().positive().optional().describe('Graph lint status list limit.'),
        keep_last: z.number().int().nonnegative().optional().describe('Graph lint prune retention count.'),
        older_than: z.string().optional().describe('Graph lint prune ISO-8601 timestamp cutoff.'),
        max_findings: z.number().int().nonnegative().optional().describe('Maximum graph lint findings returned in payloads.'),
      },
    },
    async ({
      action,
      dry_run,
      background,
      job_id,
      embedding_name,
      scope,
      max_rows,
      max_documents_in_response,
      confirm,
      stale_only,
      mismatched_width_only,
      drop_stamping_columns,
      rules,
      run_id,
      limit,
      keep_last,
      older_than,
      max_findings,
    }) => {
      const input: MaintainVaultInput = {
        action,
        ...(dry_run === undefined ? {} : { dry_run }),
        ...(background === undefined ? {} : { background }),
        ...(job_id === undefined ? {} : { job_id }),
        ...(embedding_name === undefined ? {} : { embedding_name }),
        ...(scope === undefined ? {} : { scope }),
        ...(max_rows === undefined ? {} : { max_rows }),
        ...(max_documents_in_response === undefined ? {} : { max_documents_in_response }),
        ...(confirm === undefined ? {} : { confirm }),
        ...(stale_only === undefined ? {} : { stale_only }),
        ...(mismatched_width_only === undefined ? {} : { mismatched_width_only }),
        ...(drop_stamping_columns === undefined ? {} : { drop_stamping_columns }),
        ...(rules === undefined ? {} : { rules }),
        ...(run_id === undefined ? {} : { run_id }),
        ...(limit === undefined ? {} : { limit }),
        ...(keep_last === undefined ? {} : { keep_last }),
        ...(older_than === undefined ? {} : { older_than }),
        ...(max_findings === undefined ? {} : { max_findings }),
      };

      const result = await maintainVault(config, input);

      if (result.ok) {
        return jsonToolResult(result.payload);
      }

      if (result.error.error === 'runtime_error') {
        return jsonRuntimeError(result.error);
      }

      return jsonExpectedError(result.error);
    }
  );
}
