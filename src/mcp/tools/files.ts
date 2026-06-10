/**
 * Filesystem primitive tools for vault operations.
 *
 * Provides manage_directory and list_vault — directory management and vault
 * browsing primitives, co-located in this module. (The legacy create_directory
 * and remove_directory tools were merged into manage_directory(action) in
 * Phase 127 and are no longer registered.)
 *
 * Design:
 * - manage_directory: directory-scoped write lock per path (DAQ-9); ordered per-path JSON results
 * - Idempotent create: already-existing directories report status:"unchanged", not errored
 * - Empty-only remove: non-empty directories return a conflict envelope
 * - Partial-success semantics: outer isError=false; per-path errors are returned in input order
 * - list_vault: read-only; DB enrichment via supabaseManager.getClient() inside handler
 */

import { z } from 'zod';
import type { Dirent } from 'node:fs';
import { mkdir, stat, readdir, rmdir, readFile, rename, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  normalizePath,
  sanitizeDirectorySegment,
  validateSegment,
  validateVaultPath,
} from '../utils/path-validation.js';
import { supabaseManager } from '../../storage/supabase.js';
import { parseDateFilter } from '../utils/date-filter.js';
import {
  directoryResult,
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
} from '../utils/response-formats.js';
import {
  LockTimeoutError,
  withDirectoryLockExclusive,
  withDirectoryLocksExclusive,
} from '../../services/document-lock.js';

const DEFAULT_MARKDOWN_EXTENSIONS: string[] = ['.md'];
const REMOVABLE_EMPTY_DIRECTORY_METADATA = new Set(['.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini']);

let manageDirectoryLockHookForTesting:
  | ((context: {
      action: 'remove' | 'rename' | 'move';
      sourcePath: string;
      destinationPath?: string;
    }) => Promise<void> | void)
  | null = null;
let manageDirectoryCreateHookForTesting:
  | ((context: { action: 'create'; path: string }) => Promise<void> | void)
  | null = null;

export function __setManageDirectoryLockHookForTesting(
  hook: typeof manageDirectoryLockHookForTesting
): void {
  manageDirectoryLockHookForTesting = hook;
}

export function __setManageDirectoryCreateHookForTesting(
  hook: typeof manageDirectoryCreateHookForTesting
): void {
  manageDirectoryCreateHookForTesting = hook;
}

function isRemovableEmptyDirectoryMetadata(entryName: string): boolean {
  return REMOVABLE_EMPTY_DIRECTORY_METADATA.has(entryName);
}

/**
 * Register filesystem primitive tools on the MCP server.
 * Registers manage_directory and list_vault.
 */
export function registerFileTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool: manage_directory ─────────────────────────────────────────────────
  server.registerTool(
    'manage_directory',
    {
      description:
        'Create, remove, rename, or move vault directories with ordered JSON results. Use when preparing document folders, moving folders, or cleaning up empty staging directories. Do not use for files; use write_document/remove_document. Example: manage_directory({ "action": "rename", "paths": ["Notes/Ideas"], "destinations": ["Archive/Ideas"] })',
      inputSchema: {
        action: z
          .enum(['create', 'remove', 'rename', 'move'])
          .describe('Directory operation to perform. "create" creates directories recursively; "remove" removes only empty directories; "rename"/"move" moves source directories to destinations.'),
        paths: z
          .array(z.string())
          .describe('Vault-relative directory paths to process in order. Duplicate paths execute sequentially.'),
        destinations: z
          .array(z.string())
          .optional()
          .describe('Vault-relative destination directory paths for rename/move actions. Must align positionally with paths.'),
      },
    },
    async ({ action, paths, destinations }) => {
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed.');
      }

      if (action !== 'create' && action !== 'remove' && action !== 'rename' && action !== 'move') {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'Invalid action. Expected one of: create, remove, rename, move.',
          details: { field: 'action', allowed: ['create', 'remove', 'rename', 'move'] },
        });
      }

      if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'Invalid paths. Expected an array of strings.',
          details: { field: 'paths' },
        });
      }

      if ((action === 'rename' || action === 'move') && (!Array.isArray(destinations) || destinations.length !== paths.length || !destinations.every((path) => typeof path === 'string'))) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'Invalid destinations. Expected a string array matching paths for rename/move.',
          details: { field: 'destinations' },
        });
      }

      const vaultRoot = config.instance.vault.path;
      const results: unknown[] = [];

      for (const inputPath of paths) {
        const normalizedPath = normalizePath(inputPath);
        if (normalizedPath === '') {
          results.push({
            error: 'invalid_input',
            message: action === 'remove'
              ? 'Cannot remove the vault root directory.'
              : 'Path cannot target the vault root directory.',
            identifier: inputPath,
            details: { field: 'paths', reason: 'vault_root' },
          });
          continue;
        }

        const sanitizedSegments: string[] = [];
        let segmentError: string | null = null;
        for (const [index, segment] of normalizedPath.split('/').entries()) {
          const { sanitized } = sanitizeDirectorySegment(segment);
          const error = validateSegment(sanitized, index);
          if (error) {
            segmentError = error;
            break;
          }
          sanitizedSegments.push(sanitized);
        }

        if (segmentError) {
          results.push({
            error: 'invalid_input',
            message: 'Invalid directory path',
            identifier: inputPath,
            details: { reason: 'invalid_directory_path', message: segmentError },
          });
          continue;
        }

        const safePath = sanitizedSegments.join('/');
        let destinationPath: string | null = null;
        let destinationValidation: Awaited<ReturnType<typeof validateVaultPath>> | null = null;

        if (action === 'rename' || action === 'move') {
          const inputDestination = (destinations as string[])[results.length];
          const normalizedDestination = normalizePath(inputDestination);
          if (normalizedDestination === '') {
            results.push({
              error: 'invalid_input',
              message: 'Destination path cannot target the vault root directory.',
              identifier: inputPath,
              details: { field: 'destinations', reason: 'vault_root' },
            });
            continue;
          }
          const destinationSegments: string[] = [];
          let destinationError: string | null = null;
          for (const [index, segment] of normalizedDestination.split('/').entries()) {
            const { sanitized } = sanitizeDirectorySegment(segment);
            const error = validateSegment(sanitized, index);
            if (error) {
              destinationError = error;
              break;
            }
            destinationSegments.push(sanitized);
          }
          if (destinationError) {
            results.push({
              error: 'invalid_input',
              message: 'Invalid destination directory path',
              identifier: inputPath,
              details: { reason: 'invalid_directory_path', message: destinationError },
            });
            continue;
          }
          destinationPath = destinationSegments.join('/');
          destinationValidation = await validateVaultPath(vaultRoot, destinationPath);
          if (!destinationValidation.valid) {
            const isTraversal = (destinationValidation.error ?? '').toLowerCase().includes('traversal');
            results.push({
              error: 'invalid_input',
              message: isTraversal ? 'Destination path must stay inside the vault' : 'Invalid destination directory path',
              identifier: inputPath,
              details: { reason: isTraversal ? 'path_traversal' : 'invalid_directory_path' },
            });
            continue;
          }
        }

        let validation: Awaited<ReturnType<typeof validateVaultPath>>;
        try {
          validation = await validateVaultPath(vaultRoot, safePath);
        } catch {
          results.push({
            error: 'invalid_input',
            message: 'Invalid directory path',
            identifier: inputPath,
            details: { reason: 'invalid_directory_path' },
          });
          continue;
        }
        if (!validation.valid) {
          const isTraversal = (validation.error ?? '').toLowerCase().includes('traversal');
          results.push({
            error: 'invalid_input',
            message: isTraversal ? 'Path must stay inside the vault' : 'Invalid directory path',
            identifier: inputPath,
            details: { reason: isTraversal ? 'path_traversal' : 'invalid_directory_path' },
          });
          continue;
        }

        try {
          const absPath = validation.absPath;
          const timestamp = new Date().toISOString();

          if (action === 'create') {
            try {
              const existingStat = await stat(absPath);
              if (!existingStat.isDirectory()) {
                results.push({
                  error: 'conflict',
                  message: 'Path exists as a file, not a directory.',
                  identifier: inputPath,
                  details: { reason: 'not_directory' },
                });
                continue;
              }

              results.push(directoryResult({
                path: safePath,
                action,
                status: 'unchanged',
                timestamp,
              }));
              continue;
            } catch (statErr) {
              const code = (statErr as NodeJS.ErrnoException).code;
              if (code !== 'ENOENT' && code !== 'ENOTDIR') {
                if (code === 'EACCES') {
                  results.push({
                    error: 'permission_denied',
                    message: 'Permission denied while checking directory.',
                    identifier: inputPath,
                    details: { operation: 'stat' },
                  });
                  continue;
                }
                throw statErr;
              }
            }

            try {
              await manageDirectoryCreateHookForTesting?.({ action, path: absPath });
              await mkdir(absPath, { recursive: true });
              results.push(directoryResult({
                path: safePath,
                action,
                status: 'created',
                timestamp,
              }));
            } catch (mkdirErr) {
              const code = (mkdirErr as NodeJS.ErrnoException).code;
              if (code === 'EEXIST' || code === 'ENOTDIR') {
                results.push({
                  error: 'conflict',
                  message: 'Path conflicts with an existing file.',
                  identifier: inputPath,
                  details: { reason: 'not_directory' },
                });
                continue;
              }
              if (code === 'EACCES') {
                results.push({
                  error: 'permission_denied',
                  message: 'Permission denied while creating directory.',
                  identifier: inputPath,
                  details: { operation: 'mkdir' },
                });
                continue;
              }
              throw mkdirErr;
            }
            continue;
          }

          const lockedPaths =
            action === 'rename' || action === 'move'
              ? [absPath, (destinationValidation as NonNullable<typeof destinationValidation>).absPath]
              : [absPath];
          const runLocked = <T>(fn: () => Promise<T>) =>
            lockedPaths.length === 1
              ? withDirectoryLockExclusive(config, lockedPaths[0], fn)
              : withDirectoryLocksExclusive(config, lockedPaths, fn);

          await runLocked(async () => {
            await manageDirectoryLockHookForTesting?.({
              action,
              sourcePath: absPath,
              destinationPath:
                action === 'rename' || action === 'move'
                  ? (destinationValidation as NonNullable<typeof destinationValidation>).absPath
                  : undefined,
            });

            let dirStat: Awaited<ReturnType<typeof stat>>;
            try {
              dirStat = await stat(absPath);
            } catch (statErr) {
              const code = (statErr as NodeJS.ErrnoException).code;
              if (code === 'ENOENT') {
                results.push({
                  error: 'not_found',
                  message: 'Directory does not exist.',
                  identifier: inputPath,
                  details: { kind: 'directory' },
                });
                return;
              }
              if (code === 'EACCES') {
                results.push({
                  error: 'permission_denied',
                  message: 'Permission denied while checking directory.',
                  identifier: inputPath,
                  details: { operation: 'stat' },
                });
                return;
              }
              throw statErr;
            }

            if (!dirStat.isDirectory()) {
              results.push({
                error: 'conflict',
                message: 'Path is a file, not a directory.',
                identifier: inputPath,
                details: { reason: 'not_directory' },
              });
              return;
            }

            if (action === 'rename' || action === 'move') {
              const dest = destinationValidation as NonNullable<typeof destinationValidation>;
              try {
                await stat(dest.absPath);
                results.push({
                  error: 'conflict',
                  message: 'Destination already exists.',
                  identifier: inputPath,
                  details: { reason: 'path_exists', destination: destinationPath },
                });
                return;
              } catch (statErr) {
                const code = (statErr as NodeJS.ErrnoException).code;
                if (code !== 'ENOENT' && code !== 'ENOTDIR') throw statErr;
              }

              await rename(absPath, dest.absPath);
              results.push({
                path: destinationPath as string,
                action,
                status: action === 'rename' ? 'renamed' : 'moved',
                timestamp,
              });
              return;
            }

            let entries: string[];
            try {
              entries = await readdir(absPath);
            } catch (readdirErr) {
              if ((readdirErr as NodeJS.ErrnoException).code === 'EACCES') {
                results.push({
                  error: 'permission_denied',
                  message: 'Permission denied while reading directory.',
                  identifier: inputPath,
                  details: { operation: 'readdir' },
                });
                return;
              }
              throw readdirErr;
            }

            const blockingEntries = entries.filter((entry) => !isRemovableEmptyDirectoryMetadata(entry));
            if (blockingEntries.length > 0) {
              results.push({
                error: 'conflict',
                message: 'Directory is not empty',
                identifier: inputPath,
                details: { reason: 'directory_not_empty', count: blockingEntries.length },
              });
              return;
            }

            try {
              for (const entry of entries) {
                try {
                  await unlink(join(absPath, entry));
                } catch (unlinkErr) {
                  if ((unlinkErr as NodeJS.ErrnoException).code === 'ENOENT') continue;
                  throw unlinkErr;
                }
              }
              await rmdir(absPath);
              results.push(directoryResult({
                path: safePath,
                action,
                status: 'removed',
                timestamp,
              }));
            } catch (rmdirErr) {
              if ((rmdirErr as NodeJS.ErrnoException).code === 'EACCES') {
                results.push({
                  error: 'permission_denied',
                  message: 'Permission denied while removing directory.',
                  identifier: inputPath,
                  details: { operation: 'rmdir' },
                });
                return;
              }
              throw rmdirErr;
            }
          });
        } catch (err) {
          if (err instanceof LockTimeoutError) {
            results.push({
              error: 'conflict',
              message: err.message,
              identifier: inputPath,
              details: { reason: 'lock_timeout', timeout_seconds: err.timeoutSeconds },
            });
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`manage_directory ${action} failed for ${safePath}: ${msg}`);
          results.push({
            error: 'runtime_error',
            message: msg,
            identifier: inputPath,
          });
        }
      }

      return { ...jsonToolResult({ results }), isError: false };
    }
  );

  // ─── Tool: list_vault ────────────────────────────────────────────────────────
  server.registerTool(
    'list_vault',
    {
      description:
        'Browse vault contents at any path. Returns a structured JSON envelope with entries, counts, and optional include-gated metadata/tracking fields. Replaces list_files.',
      inputSchema: {
        path: z.string().optional().default('/')
          .describe('Vault-relative directory path to list. Default "/" lists the vault root.'),
        show: z.enum(['files', 'directories', 'all']).optional().default('all')
          .describe('Which entry types to include: "files", "directories", or "all" (default).'),
        include: z.array(z.enum(['metadata', 'tracking'])).optional().default([])
          .describe('Optional payload sections to include. "metadata" adds directory created/children fields. "tracking" adds tracked file title, tags, status, and fq_id.'),
        recursive: z.boolean().optional().default(false)
          .describe('Walk subdirectories recursively. Default false.'),
        extensions: z.array(z.string()).optional()
          .describe('Filter files by extension (e.g. [".md", ".txt"]). Case-insensitive. Ignored when show="directories".'),
        after: z.string().optional()
          .describe('Date filter: entries after this time. Relative (7d, 24h, 1w) or ISO (YYYY-MM-DD).'),
        before: z.string().optional()
          .describe('Date filter: entries before this time. Relative or ISO.'),
        date_field: z.enum(['updated', 'created']).optional().default('updated')
          .describe('Which timestamp to filter on and to sort files by. Default "updated".'),
        limit: z.number().int().positive().optional().default(200)
          .describe('Maximum number of results to return. Default 200.'),
      },
    },
    async ({ path, show, include, recursive, extensions, after, before, date_field, limit }) => {
      // ── Step 0: Shutdown check ──────────────────────────────────────────────
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed.' }],
          isError: true,
        };
      }

      try {
        const vaultRoot = config.instance.vault.path;
        const includeValues: unknown[] = Array.isArray(include) ? include : [];
        const invalidInclude = includeValues.find((value) => value !== 'metadata' && value !== 'tracking');
        if (invalidInclude !== undefined) {
          const invalidIncludeText = typeof invalidInclude === 'string'
            ? invalidInclude
            : JSON.stringify(invalidInclude);
          return jsonExpectedError({
            error: 'invalid_input',
            message: `Invalid include value "${invalidIncludeText}". Expected one of: metadata, tracking.`,
            details: { field: 'include', allowed: ['metadata', 'tracking'] },
          });
        }
        const includeMetadata = includeValues.includes('metadata');
        const includeTracking = includeValues.includes('tracking');

        // ── Step 1: Path validation — vault root bypass (Pitfall 1) ────────────
        // normalizePath('/') → '' (empty); validateVaultPath rejects empty paths
        // (correct for directory writes), but list_vault MUST accept the vault root. Short-circuit here.
        const normalizedInput = normalizePath(path ?? '/');
        let absTargetPath: string;
        if (normalizedInput === '') {
          // path is '/', '', or '.' → vault root; valid for list_vault
          absTargetPath = vaultRoot;
        } else {
          const validation = await validateVaultPath(vaultRoot, normalizedInput);
          if (!validation.valid) {
            return jsonExpectedError({
              error: 'invalid_input',
              message: `Invalid path: ${validation.error}`,
              identifier: normalizedInput,
              details: { field: 'path' },
            });
          }
          absTargetPath = validation.absPath;
        }

        // ── Step 2: Date filter validation (D-10) ──────────────────────────────
        // Validate BEFORE the walk so invalid dates fail fast
        let afterTs: number | undefined;
        let beforeTs: number | undefined;
        if (after) {
          const ts = parseDateFilter(after);
          if (ts === null) {
            return jsonExpectedError({
              error: 'invalid_input',
              message: `Invalid date format: "${after}". Use ISO format (YYYY-MM-DD) or relative format (7d, 24h, 1w).`,
              details: { field: 'after' },
            });
          }
          afterTs = ts;
        }
        if (before) {
          const ts = parseDateFilter(before);
          if (ts === null) {
            return jsonExpectedError({
              error: 'invalid_input',
              message: `Invalid date format: "${before}". Use ISO format (YYYY-MM-DD) or relative format (7d, 24h, 1w).`,
              details: { field: 'before' },
            });
          }
          beforeTs = ts;
        }

        // ── Step 3: Stat check — path must exist and be a directory (D-05) ────
        let targetStat: Awaited<ReturnType<typeof stat>>;
        try {
          targetStat = await stat(absTargetPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            return jsonExpectedError({
              error: 'not_found',
              message: `Path not found: "${normalizedInput || '/'}". Use list_vault with an existing directory path.`,
              identifier: normalizedInput || '/',
              details: { kind: 'directory' },
            });
          }
          throw e;
        }
        if (!targetStat.isDirectory()) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: `"${normalizedInput}" is a file, not a directory. list_vault requires a directory path.`,
            identifier: normalizedInput,
            details: { field: 'path', reason: 'not_directory' },
          });
        }

        // ── Step 4: D-09 — extensions with show="directories" is a debug log ──
        if (show === 'directories' && extensions && extensions.length > 0) {
          logger.debug('list_vault: extensions parameter ignored because show is "directories"');
        }

        // ── Step 5: Filesystem walk ─────────────────────────────────────────────
        type WalkEntry =
          | { kind: 'file'; name: string; relativePath: string; absPath: string }
          | { kind: 'dir'; name: string; relativePath: string; absPath: string };

        async function walkDirectory(
          absDir: string,
          relBase: string,
          isRecursive: boolean,
        ): Promise<WalkEntry[]> {
          let dirents: Array<Dirent<string>>;
          try {
            dirents = await readdir(absDir, { withFileTypes: true });
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'EACCES') {
              logger.warn(`list_vault: skipped inaccessible directory "${absDir}"`);
              return [];
            }
            throw e;
          }

          const results: WalkEntry[] = [];
          for (const entry of dirents) {
            const name = String(entry.name);
            // Dotfile filter (LIST-13) — applies to BOTH files and directories
            if (name.startsWith('.')) continue;

            const entryRel = relBase ? `${relBase}/${name}` : name;
            const entryAbs = join(absDir, name);

            if (entry.isDirectory()) {
              results.push({ kind: 'dir', name: entry.name, relativePath: entryRel, absPath: entryAbs });
              if (isRecursive) {
                try {
                  const children = await walkDirectory(entryAbs, entryRel, isRecursive);
                  results.push(...children);
                } catch (e) {
                  if ((e as NodeJS.ErrnoException).code === 'EACCES') {
                    logger.warn(`list_vault: skipped inaccessible directory "${entryRel}"`);
                  }
                }
              }
            } else if (entry.isFile()) {
              results.push({ kind: 'file', name: entry.name, relativePath: entryRel, absPath: entryAbs });
            }
            // Symlinks: isSymbolicLink() from Dirent — skip silently (SPEC-21)
          }
          return results;
        }

        const allEntries = await walkDirectory(absTargetPath, normalizedInput, recursive ?? false);

        // ── Step 6: Filter by show mode ─────────────────────────────────────────
        let filtered = allEntries;
        if (show === 'files') {
          filtered = allEntries.filter(e => e.kind === 'file');
        } else if (show === 'directories') {
          filtered = allEntries.filter(e => e.kind === 'dir');
        }
        // show === 'all': keep both

        // ── Step 7: Extension filter (case-insensitive, files only) ─────────────
        if (extensions && extensions.length > 0 && show !== 'directories') {
          const normalizedExts = extensions.map(ext => ext.toLowerCase());
          filtered = filtered.filter(
            e => e.kind === 'dir' || normalizedExts.includes(extname(e.name).toLowerCase()),
          );
        }

        // ── Step 8: Stat all entries for size + timestamps ──────────────────────
        type EnrichedEntry = WalkEntry & {
          size: number;
          mtimeMs: number;
          birthtimeMs: number;
          childCount?: number; // directories only
        };

        const enrichedEntries: EnrichedEntry[] = [];
        for (const entry of filtered) {
          try {
            const s = await stat(entry.absPath);
            if (entry.kind === 'dir') {
              // Count direct children for "N items" display (Pitfall 2)
              let childCount = 0;
              try {
                const children = await readdir(entry.absPath);
                childCount = children.length;
              } catch {
                childCount = 0;
              }
              enrichedEntries.push({ ...entry, size: 0, mtimeMs: s.mtime.getTime(), birthtimeMs: s.birthtime.getTime(), childCount });
            } else {
              enrichedEntries.push({ ...entry, size: s.size, mtimeMs: s.mtime.getTime(), birthtimeMs: s.birthtime.getTime() });
            }
          } catch (e) {
            logger.warn(`list_vault: skipped entry "${entry.relativePath}" — stat failed: ${(e as Error).message}`);
          }
        }

        // ── Step 9: Date filter ─────────────────────────────────────────────────
        let dateFiltered = enrichedEntries;
        if (afterTs !== undefined || beforeTs !== undefined) {
          dateFiltered = enrichedEntries.filter(entry => {
            const ts = date_field === 'created' ? entry.birthtimeMs : entry.mtimeMs;
            if (afterTs !== undefined && ts < afterTs) return false;
            if (beforeTs !== undefined && ts > beforeTs) return false;
            return true;
          });
        }

        // ── Step 10: DB enrichment for tracked files (D-08) ─────────────────────
        type DbRow = {
          id: string;
          path: string;
          title: string | null;
          status: string | null;
          tags: string[] | null;
          updated_at: string | null;
          created_at: string | null;
        };
        const dbRecordMap = new Map<string, DbRow>();

        const fileEntries = dateFiltered.filter(e => e.kind === 'file');
        if ((includeTracking || afterTs !== undefined || beforeTs !== undefined) && fileEntries.length > 0) {
          const supabase = supabaseManager.getClient();
          const filePaths = fileEntries.map(e => e.relativePath);
          for (let i = 0; i < filePaths.length; i += 100) {
            const batch = filePaths.slice(i, i + 100);
            const { data: rows, error } = await supabase
              .from('fqc_documents')
              .select('id, path, title, status, tags, updated_at, created_at')
              .eq('instance_id', config.instance.id)
              .in('path', batch);
            if (error) {
              if (!includeTracking) {
                logger.warn(`list_vault: tracking timestamp enrichment failed: ${error.message}`);
                continue;
              }
              return jsonRuntimeError({
                error: 'tracking_unavailable',
                message: `Unable to load tracking metadata for list_vault: ${error.message}`,
                details: { include: 'tracking' },
              });
            }
            for (const row of rows ?? []) {
              dbRecordMap.set(row.path as string, row);
            }
          }
        }

        // Re-apply date filter for tracked files using DB timestamps (override filesystem)
        if (afterTs !== undefined || beforeTs !== undefined) {
          dateFiltered = dateFiltered.filter(entry => {
            if (entry.kind === 'file') {
              const row = dbRecordMap.get(entry.relativePath);
              if (row) {
                const dbTs = date_field === 'created'
                  ? (row.created_at ? new Date(row.created_at).getTime() : entry.birthtimeMs)
                  : (row.updated_at ? new Date(row.updated_at).getTime() : entry.mtimeMs);
                if (afterTs !== undefined && dbTs < afterTs) return false;
                if (beforeTs !== undefined && dbTs > beforeTs) return false;
                return true;
              }
            }
            // directories and untracked files already filtered above
            return true;
          });
        }

        // ── Step 11: Sort (D-07, LIST-12) ──────────────────────────────────────
        // Directories: depth ascending, then alphabetically
        // Files: date_field timestamp descending (newest first)
        // When show='all': directories first, then files
        const dirs = dateFiltered.filter(e => e.kind === 'dir');
        const files = dateFiltered.filter(e => e.kind === 'file');

        dirs.sort((a, b) => {
          const depthA = a.relativePath.split('/').length;
          const depthB = b.relativePath.split('/').length;
          if (depthA !== depthB) return depthA - depthB;
          return a.relativePath.localeCompare(b.relativePath);
        });

        files.sort((a, b) => {
          const rowA = dbRecordMap.get(a.relativePath);
          const rowB = dbRecordMap.get(b.relativePath);
          const tsA = date_field === 'created'
            ? (rowA?.created_at ? new Date(rowA.created_at).getTime() : a.birthtimeMs)
            : (rowA?.updated_at ? new Date(rowA.updated_at).getTime() : a.mtimeMs);
          const tsB = date_field === 'created'
            ? (rowB?.created_at ? new Date(rowB.created_at).getTime() : b.birthtimeMs)
            : (rowB?.updated_at ? new Date(rowB.updated_at).getTime() : b.mtimeMs);
          return tsB - tsA; // newest first
        });

        const sortedEntries: EnrichedEntry[] =
          show === 'files' ? files :
          show === 'directories' ? dirs :
          [...dirs, ...files]; // 'all': dirs first

        // ── Step 12: Limit / truncate (D-07, LIST-09) ──────────────────────────
        const total = sortedEntries.length;
        const actualLimit = limit ?? 200;
        const truncated = total > actualLimit;
        const displayedEntries = truncated ? sortedEntries.slice(0, actualLimit) : sortedEntries;
        const displayed = displayedEntries.length;

        const displayPath = normalizedInput; // '' for vault root
        // ── Step 13: Structured JSON envelope ─────────────────────────────────
        const markdownExtensions = config.instance.vault.markdownExtensions ?? DEFAULT_MARKDOWN_EXTENSIONS;
        const entries = await Promise.all(displayedEntries.map(async (entry) => {
          if (entry.kind === 'dir') {
            const childCount = entry.childCount ?? 0;
            const output: Record<string, unknown> = {
              name: entry.name,
              path: entry.relativePath,
              type: 'directory',
              modified: new Date(entry.mtimeMs).toISOString(),
              size: { entries: childCount },
            };
            if (includeMetadata) {
              output.created = new Date(entry.birthtimeMs).toISOString();
              output.children = childCount;
            }
            return output;
          }

          const row = dbRecordMap.get(entry.relativePath);
          let chars = entry.size;
          if (markdownExtensions.some(ext => entry.relativePath.toLowerCase().endsWith(ext.toLowerCase()))) {
            try {
              const raw = await readFile(entry.absPath, 'utf8');
              chars = matter(raw).content.length;
            } catch (e) {
              logger.warn(`list_vault: fell back to filesystem size for "${entry.relativePath}" — read failed: ${(e as Error).message}`);
            }
          }
          const output: Record<string, unknown> = {
            name: entry.name,
            path: entry.relativePath,
            type: 'file',
            modified: row?.updated_at ?? new Date(entry.mtimeMs).toISOString(),
            size: { chars },
          };
          if (includeMetadata) {
            output.created = row?.created_at ?? new Date(entry.birthtimeMs).toISOString();
          }
          if (includeTracking && row) {
            output.title = row.title ?? '';
            output.tags = row.tags ?? [];
            output.status = row.status ?? '';
            output.fq_id = row.id;
          }
          return output;
        }));

        const payload = {
          path: displayPath || '/',
          total,
          displayed,
          truncated,
          entries,
        };

        logger.info(`list_vault: listed ${displayed} entries in "${displayPath || '/'}"`);
        return { ...jsonToolResult(payload), isError: false };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`list_vault failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

}
