import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError } from '../utils/response-formats.js';

export function registerMacroTools(server: McpServer, config: FlashQueryConfig): void {
  void config;

  server.registerTool(
    'call_macro',
    {
      description:
        'Run a FlashQuery macro as one structured orchestration request. Phase 130 registers this scaffold only; macro execution is implemented in later phases.',
      inputSchema: {
        source: z.string().optional(),
        source_ref: z.string().optional(),
        input_vars: z.record(z.string(), z.unknown()).optional(),
        budget: z.record(z.string(), z.unknown()).optional(),
        dry_run: z.boolean().optional(),
        trace: z.enum(['full', 'summary', 'none']).optional(),
        progress: z.enum(['full', 'milestones', 'silent']).optional(),
      },
    },
    async () => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed.');
      }

      return jsonExpectedError({
        error: 'unsupported',
        message: 'call_macro is registered but macro execution is not implemented in Phase 130.',
        details: { reason: 'phase_130_scaffold' },
      });
    }
  );
}
