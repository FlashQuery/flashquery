import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { maintainVault, type MaintainVaultInput } from '../../services/maintenance.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult } from '../utils/response-formats.js';

const MaintenanceActionSchema = z.enum(['sync', 'repair', 'status']);
const MaintenanceRunActionSchema = z.enum(['sync', 'repair']);

export function registerScanTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'maintain_vault',
    {
      description:
        'Run administrative vault maintenance jobs. Use this when files changed outside FlashQuery and the vault index needs sync, repair, or job-status inspection.\n\n' +
        'Use action: "sync" to scan external filesystem changes. Use action: "repair" to reconcile tracked document state. Use ["repair","sync"] when both are needed; repair runs before sync. Use background: true only for sync, and use action: "status" with job_id to inspect a background job.\n\n' +
        'Do not use this as part of normal read/write workflows or for caller-side staleness checks; normal tools return current authoritative state. Do not expect scanner internals such as queue depth, hashes, or per-document sync versions in the response.\n\n' +
        'Example: maintain_vault({ "action": ["repair", "sync"], "dry_run": false })',
      inputSchema: {
        action: z
          .union([MaintenanceActionSchema, z.array(MaintenanceRunActionSchema)])
          .describe('Maintenance action: sync, repair, status, or a sync/repair action array.'),
        dry_run: z.boolean().optional().describe('Only valid for action: repair.'),
        background: z.boolean().optional().describe('Only valid for action: sync.'),
        job_id: z.string().optional().describe('Required for action: status.'),
      },
    },
    async ({ action, dry_run, background, job_id }) => {
      const input: MaintainVaultInput = {
        action,
        ...(dry_run === undefined ? {} : { dry_run }),
        ...(background === undefined ? {} : { background }),
        ...(job_id === undefined ? {} : { job_id }),
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
