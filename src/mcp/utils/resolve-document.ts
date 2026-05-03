import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import { Mutex } from 'async-mutex';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { logger } from '../../logging/logger.js';
import { listMarkdownFiles } from '../tools/documents.js';
import { vaultManager } from '../../storage/vault.js';
import { isValidUuid } from '../../utils/uuid.js';
import { propagateFqcIdChange } from '../../services/plugin-propagation.js';
import { FM } from '../../constants/frontmatter-fields.js';

// ─────────────────────────────────────────────────────────────────────────────
// ResolvedDocument — result of resolveDocumentIdentifier
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedDocument {
  absPath: string;
  relativePath: string;
  fqcId: string | null;
  resolvedVia: 'path' | typeof FM.ID | 'filename' | 'reconciliation';
  stalePathNote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-file mutex map — prevents concurrent pre-scan + background scan on same file
// ─────────────────────────────────────────────────────────────────────────────

const fileMutexMap = new Map<string, Mutex>();

export function getFileMutex(relativePath: string): Mutex {
  let m = fileMutexMap.get(relativePath);
  if (!m) {
    m = new Mutex();
    fileMutexMap.set(relativePath, m);
  }
  return m;
}

// ─────────────────────────────────────────────────────────────────────────────
// FrontmatterSnapshot — captured frontmatter state after targetedScan
// ─────────────────────────────────────────────────────────────────────────────

export interface FrontmatterSnapshot {
  fqcId: string;
  created: string; // ISO timestamp
  status: string; // 'active' or preserved value
  contentHash: string; // pre-computed hash of content about to be written
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveDocumentIdentifier — resolve UUID, path, or filename to ResolvedDocument
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveDocumentIdentifier(
  config: FlashQueryConfig,
  supabase: SupabaseClient,
  identifier: string,
  log: typeof logger
): Promise<ResolvedDocument> {
  const vaultRoot = config.instance.vault.path;

  // ── 1. UUID check ──────────────────────────────────────────────────────────
  if (isValidUuid(identifier)) {
    const queryResult = await supabase
      .from('fqc_documents')
      .select('id, path, title')
      .eq('id', identifier)
      .eq('instance_id', config.instance.id)
      .single() as { data: { id: string; path: string; title: string } | null; error: unknown };

    const { data: row, error } = queryResult;

    if (error || !row) {
      throw new Error(`Document not found: no document with id "${identifier}"`);
    }

    const absPath = join(vaultRoot, row.path);

    // Security: ensure resolved path is within vault root (T-32-01)
    const resolvedAbs = resolve(absPath);
    const resolvedVault = resolve(vaultRoot);
    const rel = relative(resolvedVault, resolvedAbs);
    if (rel.startsWith('..') || rel === '..') {
      throw new Error(`Document not found: no document with id "${identifier}"`);
    }

    return {
      absPath,
      relativePath: row.path,
      fqcId: row.id,
      resolvedVia: FM.ID,
    };
  }

  // ── 2. Path check (contains "/" or ends with a configured markdown extension) ─
  // Aligns with classifyResolutionMethod in document-output.ts so the resolver
  // and error-envelope classifier agree on what counts as a path-shaped identifier.
  // Extensions come from config (no hardcoded ".md").
  const lowerId = identifier.toLowerCase();
  const hasMarkdownExt = config.instance.vault.markdownExtensions.some((ext) =>
    lowerId.endsWith(ext.toLowerCase())
  );
  if (identifier.includes('/') || hasMarkdownExt) {
    const absPath = join(vaultRoot, identifier);

    // Security: ensure resolved path is within vault root (T-32-01)
    const resolvedAbs = resolve(absPath);
    const resolvedVault = resolve(vaultRoot);
    const rel = relative(resolvedVault, resolvedAbs);
    if (rel.startsWith('..') || rel === '..') {
      throw new Error(`Document not found: "${identifier}"`);
    }

    if (existsSync(absPath)) {
      // Look up fqc_id from DB if document is already provisioned
      const { data: dbRow } = await supabase
        .from('fqc_documents')
        .select('id')
        .eq('path', identifier)
        .eq('instance_id', config.instance.id)
        .single() as { data: { id: string } | null };

      return {
        absPath,
        relativePath: identifier,
        fqcId: dbRow?.id ?? null, // get from DB if provisioned, else null
        resolvedVia: 'path',
      };
    }

    // File missing — attempt reconciliation via DB row + vault scan
    log.debug(`resolveDocumentIdentifier: path not found on disk, attempting reconciliation for "${identifier}"`);

    const { data: dbRow } = await supabase
      .from('fqc_documents')
      .select('id, path')
      .eq('path', identifier)
      .eq('instance_id', config.instance.id)
      .single() as { data: { id: string; path: string } | null };

    if (dbRow) {
      const fqcId = dbRow.id;

      // Scan vault for file with matching fqc_id frontmatter
      const allFiles = await listMarkdownFiles(vaultRoot, config.instance.vault.markdownExtensions);
      let newPath: string | null = null;
      for (const candidate of allFiles) {
        try {
          const raw = await readFile(join(vaultRoot, candidate), 'utf-8');
          const { data: fm } = matter(raw);
          if (fm[FM.ID] === fqcId) {
            newPath = candidate;
            break;
          }
        } catch {
          // skip unreadable files
        }
      }

      if (newPath) {
        // Update DB path
        const { error: updateErr } = await supabase
          .from('fqc_documents')
          .update({ path: newPath, updated_at: new Date().toISOString() })
          .eq('id', fqcId);

        if (updateErr) {
          log.warn(`resolveDocumentIdentifier: failed to update DB path for fqc_id=${fqcId}: ${updateErr.message}`);
          // Continue operation with stale path in DB (will be fixed on next scan)
        }

        const newAbsPath = join(vaultRoot, newPath);
        return {
          absPath: newAbsPath,
          relativePath: newPath,
          fqcId,
          resolvedVia: 'reconciliation',
          stalePathNote: `Note: document moved from "${identifier}" to "${newPath}"`,
        };
      }
    }

    throw new Error(`Document not found: "${identifier}"`);
  }

  // ── 3. Filename check (no "/", not UUID, and no configured markdown extension) ─
  // The path branch above already covers identifiers that carry a configured
  // markdown extension (e.g. "foo.md"). Here we handle bare basenames like
  // "standup" by appending each configured extension and matching against
  // the vault scan. We try exact match at vault root first, then scan.
  const exts = config.instance.vault.markdownExtensions;
  const allFiles = await listMarkdownFiles(vaultRoot, exts);

  // Try each configured extension as a candidate filename (e.g. "standup.md")
  for (const ext of exts) {
    const candidate = `${identifier}${ext}`;

    // Exact match at vault root
    const rootAbsPath = join(vaultRoot, candidate);
    if (existsSync(rootAbsPath)) {
      return {
        absPath: rootAbsPath,
        relativePath: candidate,
        fqcId: null,
        resolvedVia: 'filename',
      };
    }
  }

  // Scan vault for files whose basename matches identifier + any configured extension
  // (case-insensitive on the extension, exact on the basename per filesystem).
  const matches = allFiles.filter((f) => {
    return exts.some((ext) => {
      const target = `${identifier}${ext}`;
      return f === target || f.endsWith(`/${target}`);
    });
  });

  if (matches.length === 0) {
    throw new Error(`Document not found: "${identifier}"`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous filename "${identifier}" matches ${matches.length} files:\n${matches.map((m) => `  - ${m}`).join('\n')}\nUse a vault-relative path or fq_id instead.`
    );
  }

  const match = matches[0];
  const matchAbsPath = join(vaultRoot, match);
  return {
    absPath: matchAbsPath,
    relativePath: match,
    fqcId: null,
    resolvedVia: 'filename',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// targetedScan — pre-scan with full identity resolution, scan+file mutex coordination
// ─────────────────────────────────────────────────────────────────────────────

export async function targetedScan(
  config: FlashQueryConfig,
  supabase: SupabaseClient,
  resolved: ResolvedDocument,
  newContentHash: string,
  log: typeof logger
): Promise<ResolvedDocument & { capturedFrontmatter: FrontmatterSnapshot }> {
  // DCP-04: Acquire per-file mutex only (not global scanMutex)
  // Global scanMutex blocks ALL archive/update/create operations during ANY background scan.
  // Per-file mutex provides sufficient synchronization: prevents concurrent pre-scan + background
  // scan on the SAME file, while allowing independent operations on different files.
  // This fixes archive operation timeouts when background scan is running on other files.
  const fileM = getFileMutex(resolved.relativePath);
  const releaseFile = await fileM.acquire();

  try {
    // Try to read file
    let raw: string;
    try {
      raw = await readFile(resolved.absPath, 'utf-8');
    } catch (err) {
      // ENOENT or other file not found — generate new fqc_id without writing
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const newId = uuidv4();
        const now = new Date().toISOString();
        const snapshot: FrontmatterSnapshot = {
          fqcId: newId,
          created: now,
          status: 'active',
          contentHash: newContentHash,
        };
        return {
          ...resolved,
          fqcId: newId,
          capturedFrontmatter: snapshot,
        };
      }
      // Other errors: attempt retry after brief delay
      throw err;
    }

    // Parse frontmatter
    const parsed = matter(raw);
    const existingFqcId = parsed.data[FM.ID] as string | undefined;
    const oldFqcId = existingFqcId; // Track original ID to detect changes

    // Step 1: Validate UUID format
    let validatedFqcId: string | undefined;
    if (existingFqcId) {
      if (isValidUuid(existingFqcId)) {
        validatedFqcId = existingFqcId;
      } else {
        log.warn(
          `targetedScan: malformed fqc_id="${existingFqcId}" in "${resolved.relativePath}" — attempting path fallback`
        );
      }
    }

    // Step 2: DB ownership check
    if (validatedFqcId) {
      const { data: ownerRow } = await supabase
        .from('fqc_documents')
        .select('id, path')
        .eq('id', validatedFqcId)
        .eq('instance_id', config.instance.id)
        .single();

      if (ownerRow && (ownerRow as { path: string }).path === resolved.relativePath) {
        // Ownership confirmed — use existing fqc_id
        parsed.data[FM.ID] = validatedFqcId;
      } else if (!ownerRow) {
        // Foreign UUID — adopt as-is
        log.info(
          `targetedScan: adopted foreign UUID=${validatedFqcId} for "${resolved.relativePath}"`
        );
        parsed.data[FM.ID] = validatedFqcId;
      } else {
        // UUID owned by different file — fall through to path-based fallback
        log.warn(
          `targetedScan: fqc_id=${validatedFqcId} is not owned by "${resolved.relativePath}" — falling back`
        );
        validatedFqcId = undefined;
      }
    }

    // Step 3: Path-based fallback
    if (!validatedFqcId) {
      const { data: pathRow } = await supabase
        .from('fqc_documents')
        .select('id, path')
        .eq('path', resolved.relativePath)
        .eq('instance_id', config.instance.id)
        .single();

      if (pathRow) {
        const reconnectedId = (pathRow as { id: string }).id;
        log.info(`targetedScan: path-based reconnect for "${resolved.relativePath}" → fqc_id=${reconnectedId}`);
        parsed.data[FM.ID] = reconnectedId;
        validatedFqcId = reconnectedId;
      }
    }

    // Step 4: Generate new fqc_id if needed
    if (!validatedFqcId) {
      validatedFqcId = uuidv4();
      parsed.data[FM.ID] = validatedFqcId;
    }

    // Step 4a: Call propagateFqcIdChange if identity changed (PLG-03)
    const newFqcId = validatedFqcId;
    if (oldFqcId && newFqcId && oldFqcId !== newFqcId) {
      try {
        await propagateFqcIdChange(
          supabase,
          oldFqcId,
          newFqcId,
          resolved.relativePath,
          new Map(), // pathToRow not available in MCP tool context, empty map for fallback
          log,
          process.env.DATABASE_URL
        );
      } catch (propError) {
        log.warn(
          `Failed to propagate during targeted pre-scan: ${propError instanceof Error ? propError.message : String(propError)}`
        );
        // Continue — propagation failure should not block MCP tool execution
      }
    }

    // Apply frontmatter field rules (D-06 through D-10)
    // Track whether frontmatter needs updating to avoid spurious rewrites (which change
    // the `updated` timestamp and invalidate content_hash comparisons).
    let frontmatterChanged = false;

    // fqc_id: already set above — detect if it changed
    if (parsed.data[FM.ID] !== existingFqcId) {
      frontmatterChanged = true;
    }

    // created: set to now if missing
    if (!parsed.data[FM.CREATED]) {
      parsed.data[FM.CREATED] = new Date().toISOString();
      frontmatterChanged = true;
    }
    // status: preserve if present, set to 'active' if missing
    if (!parsed.data[FM.STATUS]) {
      parsed.data[FM.STATUS] = 'active';
      frontmatterChanged = true;
    }

    // SPEC-08: content_hash is DB-only — must NOT appear in vault frontmatter.
    // If it was written to the file by an older code path, remove it defensively.
    if ('content_hash' in parsed.data) {
      delete parsed.data.content_hash;
      frontmatterChanged = true;
    }

    // Do NOT touch: updated, title, tags, project, author, or other fields

    // Write updated frontmatter to vault only if something actually changed
    if (frontmatterChanged) {
      await vaultManager.writeMarkdown(resolved.relativePath, parsed.data, parsed.content);
    }

    // Build and return snapshot
    const snapshot: FrontmatterSnapshot = {
      fqcId: validatedFqcId,
      created: parsed.data[FM.CREATED] as string,
      status: parsed.data[FM.STATUS] as string,
      contentHash: newContentHash,
    };

    return {
      ...resolved,
      fqcId: validatedFqcId,
      capturedFrontmatter: snapshot,
    };
  } catch (fileErr) {
    // Transient error handling (D-11): retry once
    const err = fileErr as NodeJS.ErrnoException;
    const isTransient = ['EACCES', 'EPERM', 'EIO'].includes(err.code || '');

    if (isTransient) {
      // Wait 50-100ms and retry once
      await new Promise((r) => setTimeout(r, 75));
      try {
        const raw = await readFile(resolved.absPath, 'utf-8');
        const parsed = matter(raw);
        const existingFqcId = parsed.data[FM.ID] as string | undefined;

        // Minimal identity resolution on retry: use existing fqc_id if valid, otherwise generate new
        let resolvedFqcId: string;
        if (existingFqcId && isValidUuid(existingFqcId)) {
          resolvedFqcId = existingFqcId;
        } else {
          resolvedFqcId = uuidv4();
        }

        // Return best-effort snapshot without writing
        const snapshot: FrontmatterSnapshot = {
          fqcId: resolvedFqcId,
          created: (parsed.data[FM.CREATED] as string) || new Date().toISOString(),
          status: (parsed.data[FM.STATUS] as string) || 'active',
          contentHash: newContentHash,
        };

        return {
          ...resolved,
          fqcId: resolvedFqcId,
          capturedFrontmatter: snapshot,
        };
      } catch (retryErr) {
        // Second failure — log warning and return best-effort snapshot
        log.warn(
          `targetedScan: retry failed for "${resolved.relativePath}" — degrading gracefully: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
        );

        // Generate new UUID as final fallback
        const fallbackId = uuidv4();
        const now = new Date().toISOString();
        const snapshot: FrontmatterSnapshot = {
          fqcId: fallbackId,
          created: now,
          status: 'active',
          contentHash: newContentHash,
        };

        return {
          ...resolved,
          fqcId: fallbackId,
          capturedFrontmatter: snapshot,
        };
      }
    } else {
      // Non-transient error — log and return best-effort snapshot
      log.warn(
        `targetedScan: non-transient error for "${resolved.relativePath}" — degrading gracefully: ${err instanceof Error ? err.message : String(err)}`
      );

      const fallbackId = uuidv4();
      const now = new Date().toISOString();
      const snapshot: FrontmatterSnapshot = {
        fqcId: fallbackId,
        created: now,
        status: 'active',
        contentHash: newContentHash,
      };

      return {
        ...resolved,
        fqcId: fallbackId,
        capturedFrontmatter: snapshot,
      };
    }
  } finally {
    releaseFile();
  }
}
