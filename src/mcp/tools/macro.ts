import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { evaluateProgram, type MacroValue } from '../../macro/evaluator.js';
import { parseMacroSource } from '../../macro/parser.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError } from '../utils/response-formats.js';

export function registerMacroTools(server: McpServer, config: FlashQueryConfig): void {
  server.registerTool(
    'call_macro',
    {
      description:
        'Run a FlashQuery macro as one structured orchestration request. Supports inline macro source execution through the production parser and evaluator.',
      inputSchema: {
        source: z.string().optional(),
        source_ref: z.string().optional(),
        input_vars: z.record(z.string(), z.unknown()).optional(),
        budget: z.record(z.string(), z.unknown()).optional(), // inputSchema only; runtime budgets are later-phase work.
        dry_run: z.boolean().optional(), // inputSchema only; dry-run execution is later-phase work.
        trace: z.enum(['full', 'summary', 'none']).optional(),
        progress: z.enum(['full', 'milestones', 'silent']).optional(), // inputSchema only.
      },
    },
    async (params) => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed.');
      }

      if (typeof params.source_ref === 'string' && params.source_ref.trim().length > 0) {
        return jsonExpectedError({
          error: 'unsupported',
          message: 'call_macro source_ref execution is not implemented yet.',
          details: { reason: 'source_ref_not_implemented' },
        });
      }

      if (typeof params.source === 'string' && params.source.length > 0) {
        const parseResult = parseMacroSource(params.source, 'inline');
        if (!parseResult.ok) {
          return jsonExpectedError(parseResult.error);
        }
        return evaluateProgram(parseResult.program, {
          input_vars: params.input_vars as Record<string, MacroValue> | undefined,
          vaultRoot: config.instance.vault.path,
        });
      }

      return jsonExpectedError({
        error: 'invalid_input',
        message: 'Exactly one of source or source_ref is required.',
        details: { reason: 'exactly_one_required' },
      });
    }
  );
}
