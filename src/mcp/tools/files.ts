/**
 * Filesystem primitive tools for vault operations.
 *
 * Provides create_directory, list_vault, and remove_directory — all filesystem
 * primitives for vault operations, co-located in this module.
 *
 * Design:
 * - No write lock: directory creation is OS-atomic (mkdir -p), not a document op (D-02)
 * - No DB writes for create_directory: pure filesystem operation (D-06)
 * - Partial-success semantics: isError=false when at least one path succeeded (D-04)
 * - Idempotent: already-existing directories are reported, not errored (D-05)
 * - list_vault: read-only; DB enrichment via supabaseManager.getClient() inside handler
 * - remove_directory: migrated from documents.ts in Phase 94; uses validateVaultPath()
 */

import { z } from 'zod';
import { mkdir, stat, readdir, rmdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
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
import { supabaseManager } from '../../storage/supabase.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { formatFileSize } from '../utils/format-file-size.js';
import { parseDateFilter } from '../utils/date-filter.js';
import {
  formatTableHeader,
  formatTableRow,
  formatKeyValueEntry,
  joinBatchEntries,
} from '../utils/response-formats.js';

/**
 * Register filesystem primitive tools on the MCP server.
 * Registers create_directory, list_vault, and remove_directory (migrated from documents.ts in Phase 94).
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

        // Step 4: Normalize each input path and join with root.
        // - Absolute paths (starting with '/') are collected as failures immediately — they
        //   would silently become vault-relative after normalizePath strips the leading slash,
        //   giving a misleading success. Reject them before normalization (Rule 1 fix, F-38).
        // - Silently skip paths that become empty AFTER normalization (SPEC-20 — Pitfall 1).
        const resolvedPaths: Array<{ resolved: string; original: string }> = [];
        const absolutePathFailures: Array<{ kind: 'failed'; original: string; error: string }> = [];
        for (const p of rawPaths) {
          // Detect raw absolute paths before normalization strips the leading '/'
          if (p.startsWith('/')) {
            absolutePathFailures.push({ kind: 'failed', original: p, error: 'Path traversal detected — path must be within the vault root.' });
            continue;
          }
          const normalized = normalizePath(p);
          if (normalized === '') continue; // silently skip (SPEC-20: empty-string in array)
          const resolved = normalizedRoot ? joinWithRoot(normalizedRoot, normalized) : normalized;
          if (resolved !== '') resolvedPaths.push({ resolved, original: p });
        }

        // If the entire input collapses to nothing (e.g. paths=['.', '']) treat as no valid input
        if (resolvedPaths.length === 0 && absolutePathFailures.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No paths provided.' }],
            isError: true,
          };
        }

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
          // Step A: Per-segment sanitize + validate FIRST (T-92-05)
          // Must happen before validateVaultPath to strip NUL/control chars that would
          // crash lstat/path operations (Rule 1 fix).
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

          // Step B: Total-path byte-length check (4096-byte limit — T-92-07)
          // Run before validateVaultPath so the informative "(N bytes)" message fires instead
          // of the generic traversal error that validateVaultPath would produce for long paths.
          const totalBytes = Buffer.byteLength(sanitizedPath, 'utf8');
          if (totalBytes > 4096) {
            results.push({ kind: 'failed', original: originalInput, error: `Resolved path exceeds the 4,096-byte filesystem limit (${totalBytes} bytes).` });
            continue;
          }

          // Step C: Validate the sanitized path (traversal, symlink, vault-root target)
          // Use sanitizedPath so NUL/control chars don't reach lstat calls
          const validation = await validateVaultPath(vaultRoot, sanitizedPath);
          if (!validation.valid) {
            results.push({ kind: 'failed', original: originalInput, error: validation.error ?? 'Invalid path.' });
            continue;
          }

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

        // Merge absolute-path failures (collected before the per-path loop) into results
        for (const f of absolutePathFailures) {
          results.push(f);
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

  // ─── Tool: list_vault ────────────────────────────────────────────────────────
  server.registerTool(
    'list_vault',
    {
      description:
        'Browse vault contents at any path. Returns files, directories, or both (show parameter). Supports two output formats (table/detailed), recursive listing, extension and date filtering, DB-enriched metadata for tracked files, and real file sizes. Replaces list_files.',
      inputSchema: {
        path: z.string().optional().default('/')
          .describe('Vault-relative directory path to list. Default "/" lists the vault root.'),
        show: z.enum(['files', 'directories', 'all']).optional().default('all')
          .describe('Which entry types to include: "files", "directories", or "all" (default).'),
        format: z.enum(['table', 'detailed']).optional().default('table')
          .describe('Response format: "table" (compact markdown) or "detailed" (key-value blocks).'),
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
    async ({ path, show, format, recursive, extensions, after, before, date_field, limit }) => {
      // ── Step 0: Shutdown check ──────────────────────────────────────────────
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed.' }],
          isError: true,
        };
      }

      try {
        const vaultRoot = config.instance.vault.path;

        // ── Step 1: Path validation — vault root bypass (Pitfall 1) ────────────
        // normalizePath('/') → '' (empty); validateVaultPath rejects empty paths (correct for
        // create_directory), but list_vault MUST accept vault root. Short-circuit here.
        const normalizedInput = normalizePath(path ?? '/');
        let absTargetPath: string;
        if (normalizedInput === '') {
          // path is '/', '', or '.' → vault root; valid for list_vault
          absTargetPath = vaultRoot;
        } else {
          const validation = await validateVaultPath(vaultRoot, normalizedInput);
          if (!validation.valid) {
            return {
              content: [{ type: 'text' as const, text: `Invalid path: ${validation.error}` }],
              isError: true,
            };
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
            return {
              content: [{ type: 'text' as const, text: `Invalid date format: "${after}". Use ISO format (YYYY-MM-DD) or relative format (7d, 24h, 1w).` }],
              isError: true,
            };
          }
          afterTs = ts;
        }
        if (before) {
          const ts = parseDateFilter(before);
          if (ts === null) {
            return {
              content: [{ type: 'text' as const, text: `Invalid date format: "${before}". Use ISO format (YYYY-MM-DD) or relative format (7d, 24h, 1w).` }],
              isError: true,
            };
          }
          beforeTs = ts;
        }

        // ── Step 3: Stat check — path must exist and be a directory (D-05) ────
        let targetStat: Awaited<ReturnType<typeof stat>>;
        try {
          targetStat = await stat(absTargetPath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            return {
              content: [{ type: 'text' as const, text: `Path not found: "${normalizedInput || '/'}". Use list_vault with an existing directory path.` }],
              isError: true,
            };
          }
          throw e;
        }
        if (!targetStat.isDirectory()) {
          return {
            content: [{ type: 'text' as const, text: `"${normalizedInput}" is a file, not a directory. list_vault requires a directory path.` }],
            isError: true,
          };
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
          let dirents: Awaited<ReturnType<typeof readdir>>;
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
        if (fileEntries.length > 0) {
          const supabase = supabaseManager.getClient();
          const filePaths = fileEntries.map(e => e.relativePath);
          for (let i = 0; i < filePaths.length; i += 100) {
            const batch = filePaths.slice(i, i + 100);
            const { data: rows } = await supabase
              .from('fqc_documents')
              .select('id, path, title, status, tags, updated_at, created_at')
              .eq('instance_id', config.instance.id)
              .in('path', batch);
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

        // ── Step 13: Handle empty results ────────────────────────────────────────
        const displayPath = normalizedInput; // '' for vault root
        if (displayed === 0) {
          const emptyMsg =
            show === 'files' ? `No files found in "${displayPath || '/'}".\n` :
            show === 'directories' ? `No directories found in "${displayPath || '/'}".\n` :
            `No entries found in "${displayPath || '/'}".\n`;
          const summaryLine = `Showing 0 of 0 entries in ${displayPath || '/'}.`;
          return {
            content: [{ type: 'text' as const, text: `${emptyMsg}${summaryLine}` }],
            isError: false,
          };
        }

        // ── Step 14: Serialize (format: "table" or "detailed") ──────────────────
        let bodyText: string;

        if (format === 'detailed') {
          const entryStrings: string[] = [];
          for (const entry of displayedEntries) {
            if (entry.kind === 'dir') {
              const childCount = entry.childCount ?? 0;
              const mtimeStr = new Date(entry.mtimeMs).toISOString();
              const btimeStr = new Date(entry.birthtimeMs).toISOString();
              const dirStr = [
                formatKeyValueEntry('Path', `${entry.relativePath}/`),
                formatKeyValueEntry('Type', 'directory'),
                formatKeyValueEntry('Size', `${childCount} items`),
                formatKeyValueEntry('Children', String(childCount)),
                formatKeyValueEntry('Updated', mtimeStr),
                formatKeyValueEntry('Created', btimeStr),
              ].join('\n');
              entryStrings.push(dirStr);
            } else {
              const row = dbRecordMap.get(entry.relativePath);
              if (row) {
                // Tracked file: Title → Path → Type → Size → Status → Tags → Updated → Created → fqc_id
                const trackedStr = [
                  formatKeyValueEntry('Title', row.title ?? ''),
                  formatKeyValueEntry('Path', entry.relativePath),
                  formatKeyValueEntry('Type', 'file'),
                  formatKeyValueEntry('Size', formatFileSize(entry.size)),
                  formatKeyValueEntry('Status', row.status ?? ''),
                  formatKeyValueEntry('Tags', row.tags?.join(', ') ?? ''),
                  formatKeyValueEntry('Updated', row.updated_at ?? ''),
                  formatKeyValueEntry('Created', row.created_at ?? ''),
                  formatKeyValueEntry('fqc_id', row.id),
                ].join('\n');
                entryStrings.push(trackedStr);
              } else {
                // Untracked file: Path → Type → Size → Tracked → Updated → Created
                const untrackedStr = [
                  formatKeyValueEntry('Path', entry.relativePath),
                  formatKeyValueEntry('Type', 'file'),
                  formatKeyValueEntry('Size', formatFileSize(entry.size)),
                  formatKeyValueEntry('Tracked', 'false'),
                  formatKeyValueEntry('Updated', new Date(entry.mtimeMs).toISOString()),
                  formatKeyValueEntry('Created', new Date(entry.birthtimeMs).toISOString()),
                ].join('\n');
                entryStrings.push(untrackedStr);
              }
            }
          }
          bodyText = joinBatchEntries(entryStrings);
        } else {
          // format === 'table' (default)
          const rows: string[] = [formatTableHeader()];
          for (const entry of displayedEntries) {
            if (entry.kind === 'dir') {
              const childCount = entry.childCount ?? 0;
              const nameCol = recursive ? `${entry.relativePath}/` : `${entry.name}/`;
              const createdCol = new Date(entry.birthtimeMs).toISOString().slice(0, 10);
              const updatedCol = new Date(entry.mtimeMs).toISOString().slice(0, 10);
              rows.push(formatTableRow(nameCol, 'directory', `${childCount} items`, createdCol, updatedCol));
            } else {
              const row = dbRecordMap.get(entry.relativePath);
              const nameCol = recursive ? entry.relativePath : entry.name;
              if (row) {
                const createdCol = row.created_at ? row.created_at.slice(0, 10) : new Date(entry.birthtimeMs).toISOString().slice(0, 10);
                const updatedCol = row.updated_at ? row.updated_at.slice(0, 10) : new Date(entry.mtimeMs).toISOString().slice(0, 10);
                rows.push(formatTableRow(nameCol, 'file', formatFileSize(entry.size), createdCol, updatedCol));
              } else {
                const createdCol = new Date(entry.birthtimeMs).toISOString().slice(0, 10);
                const updatedCol = new Date(entry.mtimeMs).toISOString().slice(0, 10);
                rows.push(formatTableRow(nameCol, 'file', formatFileSize(entry.size), createdCol, updatedCol));
              }
            }
          }
          bodyText = rows.join('\n');
        }

        // ── Step 15: Trailing notes (LIST-11) ──────────────────────────────────
        const summaryLine = truncated
          ? `Showing ${actualLimit} of ${total} entries (truncated). Use a narrower path, date filter, or higher limit to see more.`
          : `Showing ${displayed} of ${total} entries in ${displayPath}/.`;

        const untrackedCount = displayedEntries.filter(
          e => e.kind === 'file' && !dbRecordMap.has(e.relativePath)
        ).length;
        const untrackedNote = untrackedCount > 0
          ? `\n${untrackedCount} untracked file(s) included — dates are filesystem-reported and may be less reliable than DB timestamps for tracked files.`
          : '';

        const fullText = `${bodyText}\n${summaryLine}${untrackedNote}`;

        logger.info(`list_vault: listed ${displayed} entries in "${displayPath || '/'}"`);
        return {
          content: [{ type: 'text' as const, text: fullText }],
          isError: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`list_vault failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool: remove_directory ──────────────────────────────────────────────────
  server.registerTool(
    'remove_directory',
    {
      description:
        'Safely remove an empty directory from the vault. Returns an error listing contents if the directory is not empty. No recursive deletion, no force parameter — only empty directories can be removed. Use when cleaning up temporary or staging folders.',
      inputSchema: {
        path: z
          .string()
          .describe('Vault-relative path of the directory to remove.'),
      },
    },
    async ({ path: dirPath }) => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed',
            },
          ],
          isError: true,
        };
      }

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'documents',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return {
            content: [{ type: 'text' as const, text: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.' }],
            isError: true,
          };
        }
      }

      try {
        const vaultRoot = config.instance.vault.path;

        // Path validation using validateVaultPath() (migrated in Phase 94 — replaces inline traversal block)
        const validation = await validateVaultPath(vaultRoot, dirPath);
        if (!validation.valid) {
          return { content: [{ type: 'text' as const, text: validation.error ?? 'Invalid path.' }], isError: true };
        }
        const absPath = validation.absPath;

        // Stat the path — must exist and be a directory
        let dirStat;
        try {
          dirStat = await stat(absPath);
        } catch (statErr) {
          const code = (statErr as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            return {
              content: [{ type: 'text' as const, text: `Directory '${dirPath}' does not exist.` }],
              isError: true,
            };
          }
          if (code === 'EACCES') {
            return {
              content: [{ type: 'text' as const, text: `Permission denied for directory '${dirPath}'.` }],
              isError: true,
            };
          }
          throw statErr;
        }

        if (!dirStat.isDirectory()) {
          return {
            content: [{ type: 'text' as const, text: `'${dirPath}' is a file, not a directory.` }],
            isError: true,
          };
        }

        // Read directory contents (no filtering — includes hidden files)
        let entries: string[];
        try {
          entries = await readdir(absPath);
        } catch (readdirErr) {
          const code = (readdirErr as NodeJS.ErrnoException).code;
          if (code === 'EACCES') {
            return {
              content: [{ type: 'text' as const, text: `Permission denied for directory '${dirPath}'.` }],
              isError: true,
            };
          }
          throw readdirErr;
        }

        // Non-empty check — return formatted listing
        if (entries.length > 0) {
          // Classify each entry as file or dir
          const listing: string[] = [];
          for (const entry of entries) {
            let entryType = 'file';
            try {
              const entryStat = await stat(join(absPath, entry));
              entryType = entryStat.isDirectory() ? 'dir' : 'file';
            } catch {
              // If stat fails, treat as file
            }
            listing.push(entryType === 'dir' ? `- [dir] ${entry}/` : `- [file] ${entry}`);
          }

          const errorText = [
            `Directory "${dirPath}" is not empty.`,
            '',
            `Contents (${entries.length} item${entries.length === 1 ? '' : 's'}):`,
            ...listing,
            '',
            'Remove or move these items first.',
          ].join('\n');

          return {
            content: [{ type: 'text' as const, text: errorText }],
            isError: true,
          };
        }

        // Remove confirmed empty directory
        try {
          await rmdir(absPath);
        } catch (rmdirErr) {
          const code = (rmdirErr as NodeJS.ErrnoException).code;
          if (code === 'EACCES') {
            return {
              content: [{ type: 'text' as const, text: `Permission denied for directory '${dirPath}'.` }],
              isError: true,
            };
          }
          throw rmdirErr;
        }

        logger.info(`remove_directory: removed empty directory ${dirPath}`);

        return {
          content: [{ type: 'text' as const, text: `Removed directory: ${dirPath}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`remove_directory failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );
}
