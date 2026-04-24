/**
 * Filesystem primitive tools for vault operations.
 *
 * Provides create_directory and (future) list_vault, with remove_directory
 * migration planned for Phase 94.
 *
 * Design:
 * - No write lock: directory creation is OS-atomic (mkdir -p), not a document op (D-02)
 * - No DB writes: pure filesystem operation (D-06)
 * - Partial-success semantics: isError=false when at least one path succeeded (D-04)
 * - Idempotent: already-existing directories are reported, not errored (D-05)
 */

import { z } from 'zod';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  validateVaultPath,
  normalizePath,
  joinWithRoot,
  sanitizeDirectorySegment,
  validateSegment,
} from '../utils/path-validation.js';

/**
 * Register filesystem primitive tools on the MCP server.
 * Phase 93 will add list_vault here; Phase 94 will migrate remove_directory here.
 */
export function registerFileTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool: create_directory ──────────────────────────────────────────────────
  server.registerTool(
    'create_directory',
    {
      description:
        'Create one or more directories in the vault. Supports single path or batch array (max 50). Creates intermediate directories automatically (mkdir -p). Idempotent: already-existing directories are reported, not errored. Pure filesystem operation — no database writes, no write lock.',
      inputSchema: {
        paths: z
          .union([z.string(), z.array(z.string())])
          .describe('One or more directory paths to create relative to root_path.'),
        root_path: z
          .string()
          .optional()
          .default('/')
          .describe('Vault-relative base path. Paths are created relative to this.'),
      },
    },
    async ({ paths, root_path }) => {
      // Step 0: Shutdown check (D-03) — must be first
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed.',
            },
          ],
          isError: true,
        };
      }

      try {
        const vaultRoot = config.instance.vault.path;

        // Step 1: Wrap string input as array
        const rawPaths = typeof paths === 'string' ? [paths] : paths;

        // Step 2: Normalize root_path and validate it (pre-loop guard, D-04 Pitfall 4)
        const normalizedRoot = normalizePath(root_path ?? '/');
        if (normalizedRoot) {
          const rootCheck = await validateVaultPath(vaultRoot, normalizedRoot);
          if (!rootCheck.valid) {
            return {
              content: [
                { type: 'text' as const, text: `Invalid root_path: ${rootCheck.error}` },
              ],
              isError: true,
            };
          }
        }

        // Step 3: Array-level guards
        if (rawPaths.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No paths provided.' }],
            isError: true,
          };
        }
        if (rawPaths.length > 50) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Too many paths: ${rawPaths.length} provided, maximum is 50.`,
              },
            ],
            isError: true,
          };
        }

        // TODO(Task 2): per-path loop — validate, sanitize, pre-walk stat, mkdir, partial-success response assembly
        return {
          content: [{ type: 'text' as const, text: 'Not yet implemented — Task 2' }],
          isError: true,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`create_directory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );
}
