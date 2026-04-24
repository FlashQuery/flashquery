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

        // Step 4: Normalize each input path and join with root
        // Silently skip paths that become empty after normalization (SPEC-20 — Pitfall 1)
        const resolvedPaths: Array<{ resolved: string; original: string }> = rawPaths
          .map((p, _i) => ({ resolved: normalizedRoot ? joinWithRoot(normalizedRoot, normalizePath(p)) : normalizePath(p), original: p }))
          .filter(({ resolved }) => resolved !== '');

        // Per-path result tracking
        type SegmentMeta = {
          rel: string;
          preExisted: boolean;
          sanitizedFrom?: string;
          replacedChars?: string;
        };
        type PathResult =
          | { kind: 'success'; original: string; segments: SegmentMeta[] }
          | { kind: 'failed'; original: string; error: string };
        const results: PathResult[] = [];

        for (const { resolved: resolvedPath, original: originalInput } of resolvedPaths) {
          // Validate the full resolved path (traversal, symlink, vault-root target)
          const validation = await validateVaultPath(vaultRoot, resolvedPath);
          if (!validation.valid) {
            results.push({ kind: 'failed', original: originalInput, error: validation.error ?? 'Invalid path.' });
            continue;
          }

          // Total-path byte-length check (4096-byte limit — Pitfall 4 / T-92-07)
          const totalBytes = Buffer.byteLength(resolvedPath, 'utf8');
          if (totalBytes > 4096) {
            results.push({ kind: 'failed', original: originalInput, error: `Resolved path exceeds the 4,096-byte filesystem limit (${totalBytes} bytes).` });
            continue;
          }

          // Per-segment sanitize + validate (T-92-05)
          const rawSegments = resolvedPath.split('/');
          const sanitizedSegmentsMeta: Array<{ name: string; original: string; replacedChars: string }> = [];
          let segmentError: string | null = null;
          for (let si = 0; si < rawSegments.length; si++) {
            const { sanitized, replacedChars } = sanitizeDirectorySegment(rawSegments[si]);
            const segErr = validateSegment(sanitized, si);
            if (segErr) { segmentError = segErr; break; }
            sanitizedSegmentsMeta.push({ name: sanitized, original: rawSegments[si], replacedChars: replacedChars.join('') });
          }
          if (segmentError) {
            results.push({ kind: 'failed', original: originalInput, error: segmentError });
            continue;
          }

          const sanitizedPath = sanitizedSegmentsMeta.map(m => m.name).join('/');

          // Pre-walk stat to detect pre-existing segments and file conflicts (Pitfall 6 / T-92-04)
          const segmentStatus: SegmentMeta[] = [];
          let fileConflictError: string | null = null;
          let cumulative = '';
          for (let si = 0; si < sanitizedSegmentsMeta.length; si++) {
            const segMeta = sanitizedSegmentsMeta[si];
            cumulative = cumulative ? `${cumulative}/${segMeta.name}` : segMeta.name;
            let preExisted = false;
            try {
              const s = await stat(join(vaultRoot, cumulative));
              if (!s.isDirectory()) {
                fileConflictError = `"${segMeta.name}" already exists as a file at ${cumulative}. Cannot create a directory at this location.`;
                break;
              }
              preExisted = true;
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                fileConflictError = `Could not stat "${cumulative}": ${(e as Error).message}.`;
                break;
              }
              // ENOENT — segment doesn't exist yet, will be created
            }
            segmentStatus.push({
              rel: cumulative,
              preExisted,
              sanitizedFrom: segMeta.replacedChars ? segMeta.original : undefined,
              replacedChars: segMeta.replacedChars || undefined,
            });
          }
          if (fileConflictError) {
            results.push({ kind: 'failed', original: originalInput, error: fileConflictError });
            continue;
          }

          // mkdir with recursive:true — map OS errors to human-readable messages (SPEC-20)
          try {
            await mkdir(join(vaultRoot, sanitizedPath), { recursive: true });
          } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            let msg: string;
            if (code === 'EACCES') msg = `Permission denied: could not create "${originalInput}".`;
            else if (code === 'ENOSPC') msg = `Disk full: could not create "${originalInput}". Free space on the volume containing the vault.`;
            else if (code === 'EROFS') msg = `Read-only filesystem: could not create "${originalInput}". The vault volume is mounted read-only.`;
            else msg = `Could not create "${originalInput}": ${(e as Error).message}.`;
            results.push({ kind: 'failed', original: originalInput, error: msg });
            continue;
          }

          results.push({ kind: 'success', original: originalInput, segments: segmentStatus });
          if (segmentStatus.every(s => s.preExisted)) {
            logger.warn(`create_directory: path already exists: ${sanitizedPath}`);
          }
        }

        // Response assembly
        const successes = results.filter((r): r is Extract<PathResult, { kind: 'success' }> => r.kind === 'success');
        const failures = results.filter((r): r is Extract<PathResult, { kind: 'failed' }> => r.kind === 'failed');

        // Deduplicate segments across batch paths by relative path (intermediate dirs may appear multiple times)
        const seen = new Set<string>();
        const uniqueSegments = successes.flatMap(r => r.segments).filter(s => {
          if (seen.has(s.rel)) return false;
          seen.add(s.rel);
          return true;
        });

        // Count only newly created segments (not pre-existing) — Pitfall 2
        const createdCount = uniqueSegments.filter(s => !s.preExisted).length;

        const lines: string[] = [];
        if (normalizedRoot) lines.push(`Root: ${normalizedRoot}/`);

        if (uniqueSegments.length === 0 && failures.length > 0) {
          lines.push('All paths failed:');
        } else {
          lines.push(`Created ${createdCount} director${createdCount === 1 ? 'y' : 'ies'}:`);
          for (const s of uniqueSegments) {
            const statusWord = s.preExisted ? 'already exists' : 'created';
            const sanitizedNote = s.sanitizedFrom
              ? `, sanitized from "${s.sanitizedFrom}" — replaced "${s.replacedChars}"`
              : '';
            lines.push(`- ${s.rel}/ (${statusWord}${sanitizedNote})`);
          }
        }

        if (failures.length > 0) {
          if (uniqueSegments.length > 0) lines.push('');
          lines.push(`Failed (${failures.length} path${failures.length === 1 ? '' : 's'}):`);
          for (const f of failures) {
            lines.push(`- "${f.original}": ${f.error}`);
          }
        }

        // isError = true only when ALL paths failed (Pitfall 3 / D-04)
        const successCount = successes.length;
        const isError = successCount === 0 && failures.length > 0;

        if (!isError && createdCount > 0) {
          logger.info(`create_directory: created ${createdCount} director${createdCount === 1 ? 'y' : 'ies'}`);
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }], isError };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`create_directory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );
}
