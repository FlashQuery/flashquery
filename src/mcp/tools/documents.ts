import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, rename, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname, normalize, sep, dirname, basename, resolve } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vaultManager } from '../../storage/vault.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { validateAllTags, deduplicateTags } from '../../utils/tag-validator.js';
import { resolveDocumentIdentifier, targetedScan } from '../utils/resolve-document.js';
import { serializeOrderedFrontmatter } from '../utils/frontmatter-sanitizer.js';
import { scanMutex } from '../../services/scanner.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  formatKeyValueEntry,
  formatEmptyResults,
  joinBatchEntries,
  shouldShowProgress,
  progressMessage,
} from '../utils/response-formats.js';
import {
  validateParameterCombinations,
  resolveAndBuildDocument,
  DocumentRequestError,
} from '../utils/document-output.js';
import { pluginManager, getFolderClaimsMap } from '../../plugins/manager.js';
import { FM } from '../../constants/frontmatter-fields.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

export interface DocMeta {
  relativePath: string;
  title: string;
  tags: string[];
  project: string;
  status: string;
  fqcId: string;
  modified: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute SHA-256 hash of raw file content
// ─────────────────────────────────────────────────────────────────────────────

export function computeHash(rawContent: string): string {
  const startTime = performance.now();
  const hash = createHash('sha256').update(rawContent).digest('hex');
  const duration = Math.round(performance.now() - startTime);
  logger.debug(`Hash: computed SHA256 (${duration}ms) — external edit detection enabled`);
  return hash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: sanitize filename (removes chars; different from sanitizeFolderName)
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeFilename(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build document path with collision handling
// ─────────────────────────────────────────────────────────────────────────────

function _buildDocPath(
  vaultRoot: string,
  project: string,
  title: string
): { relativePath: string; absPath: string } {
  const filename = sanitizeFilename(title) + '.md';
  let relativePath = `${project}/${filename}`;
  let absPath = join(vaultRoot, relativePath);

  if (existsSync(absPath)) {
    const suffix = uuidv4().slice(0, 4);
    const collidedFilename = sanitizeFilename(title) + `-${suffix}.md`;
    relativePath = `${project}/${collidedFilename}`;
    absPath = join(vaultRoot, relativePath);
  }

  return { relativePath, absPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: list all markdown files recursively in vault (or subfolder)
// ─────────────────────────────────────────────────────────────────────────────

export async function listMarkdownFiles(
  vaultRoot: string,
  extensions: string[] = ['.md'],
  projectPrefix?: string
): Promise<string[]> {
  const searchRoot = projectPrefix ? join(vaultRoot, projectPrefix) : vaultRoot;

  // Guard against non-existent directories (Pitfall 4)
  if (!existsSync(searchRoot)) return [];

  const extsLower = extensions.map((e) => e.toLowerCase());
  const entries = await readdir(searchRoot, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => {
      // Skip dotfiles and files in dotfile directories (Unix convention)
      // Excludes: `.filename`, `._filename`, `/.obsidian/`, etc.
      if (e.name.startsWith('.')) return false;

      // Also check if the entry's path contains a dotfile directory component
      // Node 20.12+ uses e.parentPath; earlier Node 20 uses e.path
      const entryPath =
        (e as { parentPath?: string }).parentPath ?? (e as { path?: string }).path ?? '';
      if (entryPath && entryPath.split(/[\\/]/).some((component) => component.startsWith('.'))) {
        return false;
      }

      return e.isFile() && extsLower.includes(extname(e.name).toLowerCase());
    })
    .map((e) => {
      // Node 20.12+ uses e.parentPath; earlier Node 20 uses e.path (Pitfall 1)
      const dir =
        (e as { parentPath?: string }).parentPath ?? (e as { path?: string }).path ?? searchRoot;
      return relative(vaultRoot, join(dir, e.name));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: parse document metadata from a vault file
// ─────────────────────────────────────────────────────────────────────────────

export async function parseDocMeta(vaultRoot: string, relativePath: string): Promise<DocMeta | null> {
  try {
    const raw = await readFile(join(vaultRoot, relativePath), 'utf-8');
    const { data } = matter(raw);
    return {
      relativePath,
      title: String(data[FM.TITLE] ?? relativePath),
      tags: Array.isArray(data[FM.TAGS]) ? (data[FM.TAGS] as string[]) : [],
      project: String(data.project ?? ''),
      status: String(data[FM.STATUS] ?? 'active'),
      fqcId: String(data[FM.ID] ?? ''),
      modified: String(data[FM.UPDATED] ?? data[FM.CREATED] ?? ''),
    };
  } catch {
    logger.warn(`search_documents: skipping malformed file ${relativePath}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: reconcile a DB row whose vault file is missing.
// Scans vault for frontmatter fqc_id match.
//   - If found → updates path in DB, returns new relative path
//   - If not found → marks row missing in DB, returns null
// ─────────────────────────────────────────────────────────────────────────────

export async function reconcileMissingRow(
  vaultRoot: string,
  fqcId: string,
  oldPath: string,
  supabase: ReturnType<typeof supabaseManager.getClient>,
  extensions: string[] = ['.md']
): Promise<string | null> {
  const allFiles = await listMarkdownFiles(vaultRoot, extensions);
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
    logger.info(
      `search_documents: file moved — updating path from "${oldPath}" to "${newPath}" for fqc_id=${fqcId}`
    );
    await supabase
      .from('fqc_documents')
      .update({ path: newPath, updated_at: new Date().toISOString() })
      .eq('id', fqcId);
    return newPath;
  } else {
    logger.info(
      `search_documents: vault file missing and not found in vault scan — marking fqc_id=${fqcId} as missing`
    );
    await supabase
      .from('fqc_documents')
      .update({ status: 'missing', updated_at: new Date().toISOString() })
      .eq('id', fqcId);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared semantic document search helper — used by search_documents and search_all
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared semantic document search helper. Used by search_documents and search_all.
 * Returns raw RPC results with reconciliation applied.
 */
export async function searchDocumentsSemantic(
  config: FlashQueryConfig,
  query: string,
  opts: {
    tags?: string[];
    tagMatch?: 'any' | 'all';
    limit?: number;
  }
): Promise<Array<{ id: string; path: string; title: string; tags: string[]; similarity: number; created_at: string }>> {
  const { tags, tagMatch = 'any', limit = 20 } = opts;
  const queryEmbedding = await embeddingProvider.embed(query);
  const supabase = supabaseManager.getClient();
  const rpcResult = (await supabase.rpc('match_documents', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.4,
    match_count: limit,
    filter_instance_id: config.instance.id,
    filter_tags: tags ?? null,
    filter_tag_match: tagMatch,
  })) as { data: unknown; error: { message: string } | null };
  const { data, error } = rpcResult;
  if (error) throw new Error(error.message);
  const rawResults = (data ?? []) as Array<{
    id: string; path: string; title: string; tags: string[]; similarity: number; created_at: string;
  }>;

  // Reconcile DB rows whose vault file no longer exists at the stored path
  const vaultRoot = config.instance.vault.path;
  for (const r of rawResults) {
    if (!existsSync(join(vaultRoot, r.path))) {
      try {
        const newPath = await reconcileMissingRow(vaultRoot, r.id, r.path, supabase, config.instance.vault.markdownExtensions);
        if (newPath) r.path = newPath;
      } catch (err) {
        logger.warn(
          `searchDocumentsSemantic: reconciliation failed for fqc_id=${r.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  return rawResults.filter((r) => existsSync(join(vaultRoot, r.path)));
}

// ─────────────────────────────────────────────────────────────────────────────
// registerDocumentTools — registers create_document, get_document, search_documents
// ─────────────────────────────────────────────────────────────────────────────

export function registerDocumentTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool 1: create_document (DOC-01, DOC-02) ──────────────────────────────

  server.registerTool(
    'create_document',
    {
      description:
        'Create a new markdown document in the vault. Provide a title (required), optional tags for categorization, optional body content, and an optional vault-relative path to control where it\'s saved (e.g. "clients/acme/notes.md"). Defaults to vault root if no path is given. Returns the new document\'s fqc_id, path, and metadata. Use this when the user wants to start a new document, note, record, or page.' +
        'Provide a vault-relative path to control document location (e.g., "clients/acme/notes.md"). ' +
        'Defaults to vault root if no path is given. Use tags for categorization.',
      inputSchema: {
        title: z.string().describe('Document title'),
        content: z.string().describe('Document body (markdown)'),
        path: z
          .string()
          .optional()
          .describe(
            'Vault-relative path (e.g., "clients/acme/notes.md"). Defaults to vault root.'
          ),
        tags: z.array(z.string()).optional().describe('Tags for categorization'),
        frontmatter: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Additional frontmatter fields (cannot override fq_id, fq_status, fq_created, fq_instance)'
          ),
      },
    },
    async ({ title, content, path, tags, frontmatter }) => {
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
        const fqcId = uuidv4();
        const now = new Date().toISOString();

        // Determine relative path — use provided path or default to sanitized filename in root
        let relativePath: string;
        if (path) {
          relativePath = path;

          // Guard: reject path traversal attempts (../../etc/passwd patterns)
          // Uses resolve+relative pattern (same as copy_document) which is robust to
          // trailing slashes on vaultRoot and avoids normalize+startsWith+sep pitfall (WR-01).
          const absolutePath = join(vaultRoot, relativePath);
          const resolvedAbs = resolve(absolutePath);
          const resolvedVault = resolve(vaultRoot);
          const relToVault = relative(resolvedVault, resolvedAbs);
          if (relToVault.startsWith('..') || relToVault === '..') {
            return {
              content: [{ type: 'text' as const, text: `Error: path escapes vault root.` }],
              isError: true,
            };
          }

          // Guard: reject paths that are directories (e.g., "CRM/Contacts" without ".md")
          // create_document creates a FILE, not a directory. Caller should provide filename
          const guardAbsPath = join(vaultRoot, relativePath);
          if (existsSync(guardAbsPath)) {
            try {
              const statResult = await stat(guardAbsPath);
              if (statResult.isDirectory()) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Error: Path "${relativePath}" is a directory, not a file. Provide a complete file path with .md extension (e.g., "${relativePath}/${sanitizeFilename(title)}.md").`,
                    },
                  ],
                  isError: true,
                };
              }
            } catch {
              // If we can't stat the path, assume it doesn't exist and proceed
            }
          }

          // Guard: if the file already exists with an fqc_id, refuse to overwrite.
          // create_document must not silently regenerate fqc_id on existing files.
          // The caller should use update_document instead.
          if (existsSync(guardAbsPath)) {
            try {
              const existing = await readFile(guardAbsPath, 'utf-8');
              const existingParsed = matter(existing);
              const existingFqcId = existingParsed.data[FM.ID] as unknown;
              if (typeof existingFqcId === 'string' && existingFqcId.length > 0) {
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: `Error: Document already exists at "${relativePath}" with fq_id "${existingFqcId}". Use update_document to modify an existing document.`,
                    },
                  ],
                  isError: true,
                };
              }
            } catch {
              // If we can't read/parse the file, fall through and let the write proceed
            }
          }
        } else {
          // Default: sanitized filename placed at vault root (D-09)
          relativePath = `${sanitizeFilename(title)}.md`;
        }

        // D-12: read-only guardrail (warning only — write still proceeds per RO-60, OQ-2)
        const folderClaimsMap = getFolderClaimsMap(config);
        let readOnlyWarning = '';
        for (const [folder, claim] of folderClaimsMap.entries()) {
          const normalizedTarget = relativePath.toLowerCase();
          if (normalizedTarget === folder || normalizedTarget.startsWith(folder + '/')) {
            const claimEntry = pluginManager.getEntry(claim.pluginId, 'default');
            const docType = claimEntry?.schema.documents?.types.find((t) => t.id === claim.typeId);
            if (docType?.access === 'read-only') {
              readOnlyWarning = `\nWarning: Plugin ${claim.pluginId} declared read-only access for folder ${folder}. Write proceeding but may be unintended.`;
              break;
            }
          }
        }

        // Tag validation: normalize and validate before building frontmatter (D-01, D-03, TAGS-02)
        // Note: TAGS-03 status mutual exclusivity removed (D-06); #status/* tags treated like any other tag
        const validation = validateAllTags(tags ?? []);
        if (!validation.valid) {
          const messages = [...validation.errors];
          return {
            content: [{ type: 'text' as const, text: `Tag validation failed: ${messages.join('; ')}` }],
            isError: true,
          };
        }

        // Build frontmatter: caller fields first so required fields cannot be overridden
        // tags field uses deduplicated tags for defensive uniqueness guarantee (D-05a)
        // tags field uses validation.normalized directly — no #status/active prefix (D-02c, STAT-01)
        const deduplicated = deduplicateTags(validation.normalized);
        const fm: Record<string, unknown> = {
          ...(frontmatter ?? {}),
          [FM.TITLE]: title,
          [FM.ID]: fqcId,
          [FM.INSTANCE]: config.instance.id,
          [FM.STATUS]: 'active',
          [FM.TAGS]: deduplicated,
          [FM.CREATED]: now,
          // NOTE: do NOT set `updated` here — vaultManager.writeMarkdown() sets it automatically
        };

        const absolutePath = join(vaultRoot, relativePath);
        const gitAction = existsSync(absolutePath) ? 'update' : 'create';
        const sanitizedFm = serializeOrderedFrontmatter(fm);
        await vaultManager.writeMarkdown(relativePath, sanitizedFm, content, { gitAction, gitTitle: title });
        logger.info(`create_document: wrote ${relativePath} (fqc_id=${fqcId})`);

        // Sync: read raw file to compute content_hash, then insert fqc_documents row
        let contentHash: string | null = null;
        try {
          const rawContent = await readFile(join(vaultRoot, relativePath), 'utf-8');
          contentHash = computeHash(rawContent);
          const supabase = supabaseManager.getClient();
          const insertPayload = {
            id: fqcId,
            instance_id: config.instance.id,
            path: relativePath,
            title,
            tags: deduplicated,
            content_hash: contentHash,
            status: 'active',
            embedding: null,
          };
          const { error: insertError } = await supabase.from('fqc_documents').insert(insertPayload);
          if (insertError) {
            if (insertError.code === '23505' || insertError.message.includes('duplicate key')) {
              // A stale row exists for this path (e.g., vault file was deleted but DB row was not
              // cleaned up). Replace it so the new fqc_id stays in sync with the vault file.
              logger.warn(
                `create_document: duplicate path conflict for ${relativePath} — replacing stale DB row`
              );
              await supabase
                .from('fqc_documents')
                .delete()
                .eq('instance_id', config.instance.id)
                .eq('path', relativePath);
              const { error: reinsertError } = await supabase.from('fqc_documents').insert(insertPayload);
              if (reinsertError) {
                logger.warn(
                  `create_document: re-insert failed after stale-row cleanup for ${relativePath}: ${reinsertError.message}`
                );
              }
            } else {
              logger.warn(
                `create_document: fqc_documents insert failed for ${relativePath}: ${insertError.message}`
              );
            }
          }
        } catch (dbErr) {
          logger.warn(
            `create_document: fqc_documents insert error for ${relativePath}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
          );
        }

        // Fire-and-forget: embed after MCP response is returned
        if (contentHash !== null) {
          void embeddingProvider
            .embed(`${title}\n\n${content}`)
            .then((vector) =>
              supabaseManager
                .getClient()
                .from('fqc_documents')
                .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                .eq('id', fqcId)
            )
            .catch((err) =>
              logger.warn(
                `create_document: background embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
              )
            );
        }

        // Format response using Phase 62 utilities (SPEC-13: metadata-only)
        const responseLines = [
          formatKeyValueEntry('Title', title),
          formatKeyValueEntry('FQC ID', fqcId),
          formatKeyValueEntry('Path', relativePath),
          formatKeyValueEntry('Tags', validation.normalized.length > 0 ? validation.normalized : 'none'),
          formatKeyValueEntry('Status', 'active'),
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: `${responseLines.join('\n')}${readOnlyWarning}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`create_document failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );

  // (DocumentRequestError moved to document-output.ts in Phase 109 — imported above)

  // (resolveOneElement body moved to document-output.ts as resolveAndBuildDocument in Phase 109)

  // ─── Tool 2: get_document (consolidated — Phase 107) ─────────────────────

  server.registerTool(
    'get_document',
    {
      description:
        'Read one or more documents and return a structured JSON envelope. The envelope always contains identifier, title, path, fq_id, modified, and size.chars. Identifiers may be a single string or an array (string[]) for batch retrieval; array input returns an array response with per-element success or error objects (the call itself never fails for partial errors). Use the include parameter to also receive: "body" (full markdown body or extracted sections), "frontmatter" (complete YAML block as JSON object — every field, including user-defined custom fields), or "headings" (heading list with per-heading character counts). Default include is ["body"]. Use sections to extract specific sections by heading name (case-insensitive substring; queries starting with a digit are anchored to the heading start, so "3" matches "3. Scope" but not "13. Conversations"). Multi-element sections returns sections in input order separated by a blank line; repeating a name N times returns the 1st through Nth matches. Use max_depth (1-6) to limit heading levels in the headings list. Use follow_ref (a dot-separated path into the source document\'s frontmatter, e.g. "supersedes" or "projections.summary") to dereference a frontmatter pointer; the target document\'s content is returned nested under "followed_ref" and all body/frontmatter/headings/sections options apply to the target. The output is a JSON string in content[0].text.',
      inputSchema: {
        identifiers: z.union([z.string(), z.array(z.string())]).describe(
          'Document identifier(s). Single string or array for batch retrieval. ' +
          'Each element may be a vault-relative path, fq_id UUID, or filename. ' +
          'Array input always returns an array response with per-element success or error objects (the MCP call never fails on partial errors). ' +
          'String input returns a flat object response (backward compatible with Phase 107).'
        ),
        include: z.array(z.enum(['body', 'frontmatter', 'headings']))
          .optional()
          .default(['body'])
          .describe('Which fields to include in the response. Any combination of "body", "frontmatter", "headings". Default: ["body"].'),
        sections: z.array(z.string()).optional().describe(
          'Optional: heading names to extract (case-insensitive substring). Requires "body" in include. Multi-element returns sections in input order separated by blank lines; repeating a name N times returns the 1st through Nth matches.'
        ),
        include_nested: z.boolean().optional().default(true).describe(
          'When extracting sections, include nested subsection content (default: true). When false, stop at the first subheading.'
        ),
        occurrence: z.number().optional().default(1).describe(
          'Which occurrence of a heading when name appears multiple times (1-indexed, default: 1). Valid only when sections has exactly one element.'
        ),
        max_depth: z.number().min(1).max(6).optional().default(6).describe(
          'Maximum heading depth to include when include contains "headings" (1-6, default: 6 — all levels).'
        ),
        follow_ref: z.string().min(1).optional().describe(
          'Optional dot-separated path into the source document\'s frontmatter (e.g., "supersedes" or "projections.summary"). ' +
          'The string value at that path is resolved as a document identifier; the target document\'s content is returned ' +
          'nested under "followed_ref" in the response. When used, body/frontmatter/headings/sections/occurrence/max_depth/include_nested ' +
          'apply to the TARGET document. Pre-resolution errors (path missing, wrong type, target not found) are returned at the top level. ' +
          'Post-resolution errors (section not found, occurrence out of range) are nested under "followed_ref".'
        ),
      },
    },
    async ({ identifiers, include, sections, include_nested, occurrence: occurrenceParam, max_depth, follow_ref: followRef }) => {
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
          isError: true,
        };
      }
      const occurrence = occurrenceParam ?? 1;
      const effectiveInclude: Array<'body' | 'frontmatter' | 'headings'> = include && include.length > 0 ? include : ['body'];
      const sectionsList = sections ?? [];
      const effectiveMaxDepth = max_depth ?? 6;
      // WR-02: explicit fallback in case MCP SDK strips the Zod .default(true)
      const effectiveIncludeNested = include_nested ?? true;

      const paramError = validateParameterCombinations({
        include: [...effectiveInclude],
        sections: sectionsList,
        occurrence,
      });
      if (paramError !== null) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(paramError) }],
          isError: true,
        };
      }

      // Build the per-element options bundle once
      const elementOptions = {
        effectiveInclude: [...effectiveInclude] as Array<'body' | 'frontmatter' | 'headings'>,
        sectionsList,
        effectiveIncludeNested,
        occurrence,
        effectiveMaxDepth,
        followRef,
      };
      const deps = { config, supabaseManager, embeddingProvider, logger };

      if (Array.isArray(identifiers)) {
        // FREF-04 / FREF-05: batch — per-element partial failure; outer call never isError
        const results = await Promise.all(
          identifiers.map(async (id) => {
            try {
              return await resolveAndBuildDocument(id, elementOptions, deps);
            } catch (err) {
              if (err instanceof DocumentRequestError) {
                // section_not_found / follow_ref_*_error etc. — embed envelope at this position
                return err.envelope;
              }
              const msg = err instanceof Error ? err.message : String(err);
              const isNotFound =
                msg.toLowerCase().includes('not found') ||
                msg.toLowerCase().includes('missing') ||
                msg.toLowerCase().includes('enoent');
              return {
                error: isNotFound ? 'document_not_found' : 'read_error',
                message: isNotFound
                  ? `No document found for identifier: ${id}`
                  : `Error reading document: ${msg}`,
                identifier: id,
              };
            }
          })
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results) }],
          // NOTE: NO isError — array output embeds per-element errors
        };
      }

      // Single-string path — backward-compatible flat object response
      try {
        const result = await resolveAndBuildDocument(identifiers, elementOptions, deps);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof DocumentRequestError) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(err.envelope) }],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_document failed: ${msg}`);
        const isNotFound =
          msg.toLowerCase().includes('not found') ||
          msg.toLowerCase().includes('missing') ||
          msg.toLowerCase().includes('enoent');
        const errorEnvelope = isNotFound
          ? { error: 'document_not_found', message: `No document found for identifier: ${identifiers}`, identifier: identifiers }
          : { error: 'read_error', message: `Error reading document: ${msg}`, identifier: identifiers };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(errorEnvelope) }],
          isError: true,
        };
      }
    }
  );

  // ─── Tool 3: update_document (DOC-05) ──────────────────────────────────────

  server.registerTool(
    'update_document',
    {
      description:
        'Overwrite an existing document\'s body content and/or frontmatter fields. Replaces the entire body — use replace_doc_section or insert_in_doc for targeted section edits instead. Accepts the document by path, fqc_id, or filename. Does not create a new document — use create_document for that.',
      inputSchema: {
        identifier: z
          .string()
          .describe(
            'Document identifier — accepts any of: (1) vault-relative path (e.g., "clients/acme/notes.md"), (2) fqc_id UUID, or (3) filename (e.g., "notes.md")'
          ),
        content: z
          .string()
          .optional()
          .describe('New document body (markdown). If omitted, body is preserved unchanged.'),
        title: z
          .string()
          .optional()
          .describe('New title. If omitted, existing title is preserved.'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Replacement tag list. If omitted, existing tags are preserved.'),
        frontmatter: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Additional frontmatter fields to merge in (cannot override fq_id, fq_instance, fq_created, fq_status)'
          ),
      },
    },
    async ({ identifier, content, title, tags, frontmatter }) => {
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
        // Resolve identifier to a canonical path
        // Note: resolveDocumentIdentifier already performs path traversal validation
        // (T-32-01 security check with resolve + relative + startsWith('..') detection)
        const resolved = await resolveDocumentIdentifier(
          config,
          supabaseManager.getClient(),
          identifier,
          logger
        );

        const relativePath = resolved.relativePath;
        const absPath = resolved.absPath;

        // D-12: read-only guardrail (warning only — write still proceeds per RO-60, OQ-2)
        const folderClaimsMapUpdate = getFolderClaimsMap(config);
        let readOnlyWarning = '';
        for (const [folder, claim] of folderClaimsMapUpdate.entries()) {
          const normalizedTarget = relativePath.toLowerCase();
          if (normalizedTarget === folder || normalizedTarget.startsWith(folder + '/')) {
            const claimEntry = pluginManager.getEntry(claim.pluginId, 'default');
            const docType = claimEntry?.schema.documents?.types.find((t) => t.id === claim.typeId);
            if (docType?.access === 'read-only') {
              readOnlyWarning = `\nWarning: Plugin ${claim.pluginId} declared read-only access for folder ${folder}. Write proceeding but may be unintended.`;
              break;
            }
          }
        }

        // Read existing file — extract current frontmatter and body
        const rawContent = await readFile(absPath, 'utf-8');
        const parsed = matter(rawContent);
        const existingData = parsed.data;
        const existingBody = parsed.content;

        // Merge frontmatter: existing first, then caller overrides, then protected fields last
        const effectiveTitle =
          title ?? (typeof existingData[FM.TITLE] === 'string' ? existingData[FM.TITLE] as string : relativePath);
        const effectiveTags =
          tags ?? (Array.isArray(existingData[FM.TAGS]) ? (existingData[FM.TAGS] as string[]) : []);
        const effectiveBody = content ?? existingBody;

        const fm: Record<string, unknown> = {
          ...existingData,
          ...(frontmatter ?? {}),
          // Protected fields — caller cannot override these
          [FM.TITLE]: effectiveTitle,
          [FM.TAGS]: effectiveTags,
          [FM.INSTANCE]: (existingData[FM.INSTANCE] as string | undefined) ?? config.instance.id,
          [FM.CREATED]: existingData[FM.CREATED] as string | undefined,
          [FM.STATUS]: (existingData[FM.STATUS] as string | undefined) ?? 'active',
          // NOTE: vaultManager.writeMarkdown() sets `updated` automatically
        };

        // Compute hash of the new content about to be written (D-09)
        const serialized = matter.stringify(effectiveBody, fm);
        const newContentHash = computeHash(serialized);

        // Call targetedScan to update frontmatter and get fqcId
        const preScan = await targetedScan(
          config,
          supabaseManager.getClient(),
          resolved,
          newContentHash,
          logger
        );

        const fqcId = preScan.capturedFrontmatter.fqcId;

        // Update fm with fq_id from targetedScan
        fm[FM.ID] = fqcId;

        const sanitizedFm = serializeOrderedFrontmatter(fm);
        await vaultManager.writeMarkdown(relativePath, sanitizedFm, effectiveBody, {
          gitAction: 'update',
          gitTitle: effectiveTitle,
        });
        logger.info(`update_document: wrote ${relativePath} (fqc_id=${fqcId})`);

        // UPDATE the existing fqc_documents row — never insert
        const supabase = supabaseManager.getClient();
        const { error: updateError } = await supabase
          .from('fqc_documents')
          .update({
            title: effectiveTitle,
            tags: effectiveTags,
            content_hash: newContentHash,
            path: relativePath,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fqcId);

        if (updateError) {
          logger.warn(
            `update_document: fqc_documents update failed for ${relativePath}: ${updateError.message}`
          );
        }

        // Fire-and-forget re-embed
        void embeddingProvider
          .embed(`${effectiveTitle}\n\n${effectiveBody}`)
          .then((vector) =>
            supabaseManager
              .getClient()
              .from('fqc_documents')
              .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
              .eq('id', fqcId)
          )
          .catch((err) =>
            logger.warn(
              `update_document: background re-embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
            )
          );

        // Format response using Phase 62 utilities (SPEC-13: metadata-only, same as create_document)
        const responseLines = [
          formatKeyValueEntry('Title', effectiveTitle),
          formatKeyValueEntry('FQC ID', fqcId),
          formatKeyValueEntry('Path', relativePath),
          formatKeyValueEntry('Tags', effectiveTags.length > 0 ? effectiveTags : 'none'),
          formatKeyValueEntry('Status', 'active'),
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: `${responseLines.join('\n')}${readOnlyWarning}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`update_document failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );

  // ─── Tool 4: archive_document (ARC-02) ─────────────────────────────────────

  server.registerTool(
    'archive_document',
    {
      description:
        'Archive one or more documents by setting their status to \'archived\'. The file remains in the vault and its fqc_id is preserved — nothing is deleted. Accepts identifiers by path, fqc_id, or filename. Archived documents are excluded from search results. Use this when the user is done with a document but may want to reference it later.',
      inputSchema: {
        identifiers: z
          .union([z.string(), z.array(z.string())])
          .describe(
            'One or more document identifiers — each can be a vault-relative path, fqc_id UUID, or filename. See identifier resolution rules.'
          ),
      },
    },
    async ({ identifiers }) => {
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

      try {
        const supabase = supabaseManager.getClient();
        const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
        const results: string[] = [];

        for (const id of ids) {
          try {
            // Resolve identifier to a canonical path
            const resolved = await resolveDocumentIdentifier(config, supabase, id, logger);
            const relativePath = resolved.relativePath;

            // Step 1: Read current frontmatter (vault-first requires reading before writing)
            let parsed: { data: Record<string, unknown>; content: string };
            try {
              parsed = await vaultManager.readMarkdown(relativePath);
            } catch (err) {
              throw new Error(
                `Document not found at path "${relativePath}": ${err instanceof Error ? err.message : String(err)}`,
                { cause: err }
              );
            }

            // Step 2: Call targetedScan to update frontmatter with archived status
            // Compute hash of the file with archived status
            const archivedFm: Record<string, unknown> = { ...parsed.data, [FM.STATUS]: 'archived' };
            const serialized = matter.stringify(parsed.content, archivedFm);
            const newContentHash = computeHash(serialized);

            const preScan = await targetedScan(
              config,
              supabase,
              resolved,
              newContentHash,
              logger
            );

            // Update fm with fq_id from targetedScan
            archivedFm[FM.ID] = preScan.capturedFrontmatter.fqcId;

            // Write archived status to vault (VAULT-FIRST)
            const archivedTitle = archivedFm[FM.TITLE];
            await vaultManager.writeMarkdown(
              relativePath,
              archivedFm,
              parsed.content,
              { gitAction: 'update', gitTitle: typeof archivedTitle === 'string' ? archivedTitle : relativePath }
            );

            // Step 3: Update Supabase fqc_documents
            const fqcId = preScan.capturedFrontmatter.fqcId;
            if (fqcId) {
              const { error } = await supabase
                .from('fqc_documents')
                .update({ status: 'archived', updated_at: new Date().toISOString() })
                .eq('id', fqcId)
                .eq('instance_id', config.instance.id);
              if (error) {
                logger.warn(`archive_document: Supabase update failed for ${relativePath}: ${error.message}`);
              }
            } else {
              // Fallback: update by path if no fqcId available
              const { error } = await supabase
                .from('fqc_documents')
                .update({ status: 'archived', updated_at: new Date().toISOString() })
                .eq('path', relativePath)
                .eq('instance_id', config.instance.id);
              if (error) {
                logger.warn(`archive_document: Supabase update failed for ${relativePath}: ${error.message}`);
              }
            }

            logger.info(`archive_document: archived ${relativePath}`);
            results.push(`"${relativePath}" archived`);
          } catch (itemErr) {
            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
            results.push(`"${id}" failed: ${msg}`);
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: results.join('\n'),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`archive_document failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 5: search_documents (DOC-04) ─────────────────────────────────────

  server.registerTool(
    'search_documents',
    {
      description:
        'Search vault documents by semantic query, tags, or text substring. Returns ranked results with title, path, fqc_id, tags, and match score. Excludes archived documents. Use this when the user asks to find, search for, or look up documents — e.g. "find my notes about Acme" or "which documents are tagged crm". For browsing by folder structure instead of searching, use list_files.',
      inputSchema: {
        tags: z
          .array(z.string())
          .optional()
          .describe('Filter by tags (ANY match — docs with at least one matching tag)'),
        tag_match: z
          .enum(['any', 'all'])
          .optional()
          .describe(
            'How to combine multiple tags. "any" (default): items with at least one of the tags. ' +
            '"all": only items with every tag.'
          ),
        query: z
          .string()
          .optional()
          .describe('Substring search on title or path (case-insensitive)'),
        limit: z.number().optional().describe('Maximum results. Default: 20'),
        mode: z
          .enum(['filesystem', 'semantic', 'mixed'])
          .optional()
          .describe(
            "Search mode: 'filesystem' (default) = frontmatter scan, 'semantic' = vector similarity via pgvector, 'mixed' = both combined (semantic-ranked first, unindexed appended)"
          ),
      },
    },
    async ({ tags, query, limit, mode, tag_match }) => {
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

      try {
        const effectiveMode = mode ?? 'filesystem';
        const matchMode = tag_match ?? 'any';

        // Guard: semantic/mixed require a query
        if ((effectiveMode === 'semantic' || effectiveMode === 'mixed') && !query) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: query is required for semantic and mixed modes',
              },
            ],
            isError: true,
          };
        }

        if (effectiveMode === 'semantic') {
          // Delegate to shared helper (also used by search_all)
          const results = await searchDocumentsSemantic(config, query!, { tags, tagMatch: matchMode, limit });
          if (results.length === 0) {
            return {
              content: [
                { type: 'text' as const, text: formatEmptyResults('documents') },
              ],
            };
          }

          // Format each result as key-value entry with Match percentage (SPEC-12 semantic mode)
          const entries = results.map((r) => {
            const lines = [
              formatKeyValueEntry('Title', r.title),
              formatKeyValueEntry('Path', r.path),
              formatKeyValueEntry('Tags', r.tags && r.tags.length > 0 ? r.tags : 'none'),
              formatKeyValueEntry('FQC ID', r.id ?? 'unknown'),
              formatKeyValueEntry('Match', `${Math.round(r.similarity * 100)}%`),
            ];
            return lines.join('\n');
          });

          let responseText = '';
          if (shouldShowProgress(results.length)) {
            responseText = progressMessage(results.length) + '\n\n';
          }
          responseText += joinBatchEntries(entries);

          logger.info(`search_documents: semantic found ${results.length} document(s)`);
          return { content: [{ type: 'text' as const, text: responseText }] };
        }

        if (effectiveMode === 'mixed') {
          // Run semantic search via shared helper (also used by search_all)
          const semanticResults = await searchDocumentsSemantic(config, query!, { tags, tagMatch: matchMode, limit });
          const semanticPaths = new Set(semanticResults.map((r) => r.path));

          // Run filesystem scan
          const vaultRoot = config.instance.vault.path;
          const files = await listMarkdownFiles(vaultRoot, config.instance.vault.markdownExtensions);
          const metaResults = await Promise.all(files.map((f) => parseDocMeta(vaultRoot, f)));
          const allMeta = metaResults.filter((m): m is DocMeta => m !== null);
          let fsFiltered = allMeta.filter(
            (meta) => meta.status?.toLowerCase() !== 'archived' && !semanticPaths.has(meta.relativePath)
          );
          if (tags && tags.length > 0) {
            if (matchMode === 'any') {
              fsFiltered = fsFiltered.filter((meta) => meta.tags.some((t) => tags.includes(t)));
            } else {
              fsFiltered = fsFiltered.filter((meta) => tags.every((t) => meta.tags.includes(t)));
            }
          }
          if (query) {
            const lq = query.toLowerCase();
            fsFiltered = fsFiltered.filter(
              (meta) =>
                meta.title.toLowerCase().includes(lq) ||
                meta.relativePath.toLowerCase().includes(lq)
            );
          }

          // Semantic results first (with Match %), then filesystem results (with Source field)
          const totalLimit = limit ?? 20;
          const semanticEntries = semanticResults.slice(0, totalLimit).map((r) => {
            const lines = [
              formatKeyValueEntry('Title', r.title),
              formatKeyValueEntry('Path', r.path),
              formatKeyValueEntry('Tags', r.tags && r.tags.length > 0 ? r.tags : 'none'),
              formatKeyValueEntry('FQC ID', r.id ?? 'unknown'),
              formatKeyValueEntry('Match', `${Math.round(r.similarity * 100)}%`),
            ];
            return lines.join('\n');
          });

          const remainingSlots = totalLimit - semanticEntries.length;
          const fsEntries = fsFiltered.slice(0, remainingSlots).map((meta) => {
            const lines = [
              formatKeyValueEntry('Title', meta.title),
              formatKeyValueEntry('Path', meta.relativePath),
              formatKeyValueEntry('Tags', meta.tags.length > 0 ? meta.tags : 'none'),
              formatKeyValueEntry('FQC ID', meta.fqcId ?? 'unknown'),
              formatKeyValueEntry('Source', 'filesystem'),
            ];
            return lines.join('\n');
          });

          const allEntries = [...semanticEntries, ...fsEntries];
          logger.info(
            `search_documents: mixed found ${semanticEntries.length} semantic + ${fsEntries.length} filesystem document(s)`
          );
          if (allEntries.length === 0) {
            return {
              content: [{ type: 'text' as const, text: formatEmptyResults('documents') }],
            };
          }

          let responseText = '';
          if (shouldShowProgress(allEntries.length)) {
            responseText = progressMessage(allEntries.length) + '\n\n';
          }
          responseText += joinBatchEntries(allEntries);

          return { content: [{ type: 'text' as const, text: responseText }] };
        }

        // effectiveMode === 'filesystem': fall through to existing code below
        const vaultRoot = config.instance.vault.path;

        // Scan entire vault (filter on frontmatter project field, not directory prefix)
        const files = await listMarkdownFiles(vaultRoot, config.instance.vault.markdownExtensions);

        // Parse frontmatter for each file, skip malformed files
        const metaResults = await Promise.all(files.map((f) => parseDocMeta(vaultRoot, f)));
        const allMeta = metaResults.filter((m): m is DocMeta => m !== null);

        // Background: sync path in DB for any fqc_id files that have moved.
        // Build fqcId→currentPath map, query DB once, update any mismatches.
        void (async () => {
          try {
            const idToPath = new Map<string, string>();
            for (const meta of allMeta) {
              if (meta.fqcId) idToPath.set(meta.fqcId, meta.relativePath);
            }
            if (idToPath.size === 0) return;
            const supabase = supabaseManager.getClient();
            const { data: rows } = await supabase
              .from('fqc_documents')
              .select('id, path')
              .in('id', [...idToPath.keys()])
              .eq('instance_id', config.instance.id)
              .neq('status', 'archived');
            if (!rows) return;
            for (const row of rows) {
              const currentPath = idToPath.get(row.id as string);
              if (currentPath && currentPath !== (row.path as string)) {
                logger.info(
                  `search_documents: filesystem sync — updating path from "${row.path}" to "${currentPath}" for fqc_id=${row.id}`
                );
                await supabase
                  .from('fqc_documents')
                  .update({ path: currentPath, updated_at: new Date().toISOString() })
                  .eq('id', row.id as string);
              }
            }
          } catch (err) {
            logger.warn(
              `search_documents: filesystem path-sync failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();

        // Filter chain
        let filtered = allMeta
          // Skip archived documents
          .filter((meta) => meta.status?.toLowerCase() !== 'archived');

        if (tags && tags.length > 0) {
          if (matchMode === 'any') {
            filtered = filtered.filter((meta) => meta.tags.some((t) => tags.includes(t)));
          } else {
            filtered = filtered.filter((meta) => tags.every((t) => meta.tags.includes(t)));
          }
        }

        if (query) {
          // Case-insensitive substring match on title or relative path
          const lq = query.toLowerCase();
          filtered = filtered.filter(
            (meta) =>
              meta.title.toLowerCase().includes(lq) || meta.relativePath.toLowerCase().includes(lq)
          );
        }

        // Sort by modified descending (empty string sorts last)
        filtered.sort((a, b) => {
          if (!a.modified && !b.modified) return 0;
          if (!a.modified) return 1;
          if (!b.modified) return -1;
          return b.modified.localeCompare(a.modified);
        });

        // Apply limit
        const results = filtered.slice(0, limit ?? 20);

        logger.info(`search_documents: filesystem found ${results.length} document(s)`);

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: formatEmptyResults('documents') }],
          };
        }

        // Format each result as key-value entry (SPEC-12 filesystem mode, no Match/Source fields)
        const entries = results.map((meta) => {
          const lines = [
            formatKeyValueEntry('Title', meta.title),
            formatKeyValueEntry('Path', meta.relativePath),
            formatKeyValueEntry('Tags', meta.tags.length > 0 ? meta.tags : 'none'),
            formatKeyValueEntry('FQC ID', meta.fqcId ?? 'unknown'),
          ];
          return lines.join('\n');
        });

        let responseText = '';
        if (shouldShowProgress(results.length)) {
          responseText = progressMessage(results.length) + '\n\n';
        }
        responseText += joinBatchEntries(entries);

        return {
          content: [{ type: 'text' as const, text: responseText }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`search_documents failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 5: copy_document (DOC-06) ────────────────────────────────────────

  server.registerTool(
    'copy_document',
    {
      description:
        'Copy a vault document to a new location, creating a new document with its own fqc_id and fresh timestamps. The copy preserves the source title, tags, and all custom frontmatter fields immutably — no customization is supported. Use this when the user wants to duplicate a document as a starting point — e.g. creating a new contact from a template. The original document is not modified.',
      inputSchema: {
        identifier: z
          .string()
          .describe(
            'Source document identifier — accepts any of: (1) vault-relative path, (2) fqc_id UUID, or (3) filename'
          ),
        destination: z
          .string()
          .optional()
          .describe('Vault-relative path for the copy. If omitted, defaults to vault root using source title as filename.'),
      },
    },
    async ({ identifier, destination }) => {
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
        // Resolve source document
        const sourceResolved = await resolveDocumentIdentifier(
          config,
          supabaseManager.getClient(),
          identifier,
          logger
        );

        // Read source document
        const rawContent = await readFile(sourceResolved.absPath, 'utf-8');
        const parsed = matter(rawContent);
        const sourceData = parsed.data;

        // Preserve source metadata immutably (SPEC-06: no parameter overrides)
        const copyTitle = typeof sourceData[FM.TITLE] === 'string' ? sourceData[FM.TITLE] as string : sourceResolved.relativePath;
        const copyTags = Array.isArray(sourceData[FM.TAGS]) ? (sourceData[FM.TAGS] as string[]) : [];

        // Validate tags (from source)
        const validation = validateAllTags(copyTags);
        if (!validation.valid) {
          const messages = [...validation.errors];
          return {
            content: [{ type: 'text' as const, text: `Tag validation failed: ${messages.join('; ')}` }],
            isError: true,
          };
        }

        // Generate new fqc_id for the copy
        const newFqcId = uuidv4();
        const now = new Date().toISOString();

        // Build copy path
        let copyRelativePath: string;
        if (destination) {
          copyRelativePath = destination;

          // Guard: reject path traversal attempts (proven pattern from resolveDocumentIdentifier)
          const absolutePath = join(config.instance.vault.path, copyRelativePath);
          const resolvedAbs = resolve(absolutePath);
          const resolvedVault = resolve(config.instance.vault.path);
          const rel = relative(resolvedVault, resolvedAbs);
          if (rel.startsWith('..') || rel === '..') {
            return {
              content: [{ type: 'text' as const, text: `Error: path escapes vault root.` }],
              isError: true,
            };
          }
        } else {
          // Default: sanitized filename placed at vault root
          copyRelativePath = `${sanitizeFilename(copyTitle)}.md`;
        }

        // Build frontmatter for the copy — spread all source fields, override identity/timestamps
        const deduplicated = deduplicateTags(validation.normalized);
        const copyFm: Record<string, unknown> = {
          ...sourceData,
          [FM.TITLE]: copyTitle,
          [FM.ID]: newFqcId,
          [FM.INSTANCE]: config.instance.id,
          [FM.STATUS]: 'active',
          [FM.TAGS]: deduplicated,
          [FM.CREATED]: now,
          // NOTE: vaultManager.writeMarkdown() sets `updated` automatically
        };

        // Write copy to vault
        const absPath = join(config.instance.vault.path, copyRelativePath);
        const gitAction = existsSync(absPath) ? 'update' : 'create';
        const sanitizedFm = serializeOrderedFrontmatter(copyFm);
        await vaultManager.writeMarkdown(copyRelativePath, sanitizedFm, parsed.content, { gitAction, gitTitle: copyTitle });
        logger.info(`copy_document: wrote copy to ${copyRelativePath} (new fqc_id=${newFqcId})`);

        // Sync: read raw file to compute content_hash, then insert fqc_documents row
        let contentHash: string | null = null;
        try {
          const rawCopyContent = await readFile(join(config.instance.vault.path, copyRelativePath), 'utf-8');
          contentHash = computeHash(rawCopyContent);
          const supabase = supabaseManager.getClient();
          const { error: insertError } = await supabase.from('fqc_documents').insert({
            id: newFqcId,
            instance_id: config.instance.id,
            path: copyRelativePath,
            title: copyTitle,
            tags: deduplicated,
            content_hash: contentHash,
            status: 'active',
            embedding: null,
          });
          if (insertError) {
            logger.warn(
              `copy_document: fqc_documents insert failed for ${copyRelativePath}: ${insertError.message}`
            );
          }
        } catch (dbErr) {
          logger.warn(
            `copy_document: fqc_documents insert error for ${copyRelativePath}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
          );
        }

        // Fire-and-forget: embed after MCP response is returned
        if (contentHash !== null) {
          void embeddingProvider
            .embed(`${copyTitle}\n\n${parsed.content}`)
            .then((vector) =>
              supabaseManager
                .getClient()
                .from('fqc_documents')
                .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                .eq('id', newFqcId)
            )
            .catch((err) =>
              logger.warn(
                `copy_document: background embed failed for ${copyRelativePath}: ${err instanceof Error ? err.message : String(err)}`
              )
            );
        }

        // Format response using Phase 62 utilities (SPEC-13: metadata-only, same as create_document)
        const responseLines = [
          formatKeyValueEntry('Title', copyTitle),
          formatKeyValueEntry('FQC ID', newFqcId),
          formatKeyValueEntry('Path', copyRelativePath),
          formatKeyValueEntry('Tags', deduplicated.length > 0 ? deduplicated : 'none'),
          formatKeyValueEntry('Status', 'active'),
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: responseLines.join('\n'),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`copy_document failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );

  // ─── Tool 6: reconcile_documents (DOC-08) ──────────────────────────────────

  server.registerTool(
    'reconcile_documents',
    {
      description:
        'Scan the database for documents whose vault file is missing. Detects files that were moved (by matching fqc_id in frontmatter at the new location) and updates their path. Files that are permanently gone are marked archived. Use this after bulk file moves, vault reorganization, or when documents show stale path warnings.',
      inputSchema: {
        dry_run: z
          .boolean()
          .optional()
          .describe(
            'If true, report what would change without making any DB updates. Default: false'
          ),
      },
    },
    async ({ dry_run }) => {
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

      // TSA-07: Acquire scanMutex to prevent races with background scan during vault walk
      const release = await scanMutex.acquire();
      try {
        const isDryRun = dry_run ?? false;
        const supabase = supabaseManager.getClient();
        const vaultRoot = config.instance.vault.path;

        // Fetch all non-archived rows for this instance
        const { data: rows, error: fetchError } = await supabase
          .from('fqc_documents')
          .select('id, path, title, status')
          .eq('instance_id', config.instance.id)
          .neq('status', 'archived');

        if (fetchError) throw new Error(fetchError.message);
        if (!rows || rows.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No active documents in DB to reconcile.' }],
          };
        }

        // Identify rows whose vault file is missing
        const missingRows = (
          rows as Array<{ id: string; path: string; title: string; status: string }>
        ).filter((r) => !existsSync(join(vaultRoot, r.path)));

        if (missingRows.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `reconcile_documents: all ${rows.length} DB rows have valid vault files. Nothing to do.`,
              },
            ],
          };
        }

        logger.info(
          `reconcile_documents: found ${missingRows.length} missing vault file(s) out of ${rows.length} DB rows`
        );

        // Build a vault-wide fqc_id index once (expensive but necessary for bulk reconcile)
        const allFiles = await listMarkdownFiles(vaultRoot, config.instance.vault.markdownExtensions);
        const fqcIdIndex = new Map<string, string>(); // fqc_id → relativePath
        for (const file of allFiles) {
          try {
            const raw = await readFile(join(vaultRoot, file), 'utf-8');
            const { data: fm } = matter(raw);
            if (typeof fm[FM.ID] === 'string' && fm[FM.ID]) {
              fqcIdIndex.set(fm[FM.ID] as string, file);
            }
          } catch {
            // skip unreadable files
          }
        }

        const moved: Array<{ fqcId: string; oldPath: string; newPath: string; title: string }> = [];
        const archived: Array<{ fqcId: string; path: string; title: string }> = [];

        for (const row of missingRows) {
          const newPath = fqcIdIndex.get(row.id) ?? null;
          if (newPath) {
            moved.push({ fqcId: row.id, oldPath: row.path, newPath, title: row.title });
            if (!isDryRun) {
              await supabase
                .from('fqc_documents')
                .update({ path: newPath, updated_at: new Date().toISOString() })
                .eq('id', row.id);
              logger.info(
                `reconcile_documents: updated path for fqc_id=${row.id} from "${row.path}" to "${newPath}"`
              );
            }
          } else {
            archived.push({ fqcId: row.id, path: row.path, title: row.title });
            if (!isDryRun) {
              await supabase
                .from('fqc_documents')
                .update({ status: 'archived', updated_at: new Date().toISOString() })
                .eq('id', row.id);
              logger.info(
                `reconcile_documents: archived fqc_id=${row.id} (file not found: "${row.path}")`
              );
            }
          }
        }

        const prefix = isDryRun ? '[DRY RUN] ' : '';
        const lines: string[] = [
          `${prefix}reconcile_documents: scanned ${rows.length} DB rows, found ${missingRows.length} missing file(s).`,
        ];
        if (moved.length > 0) {
          lines.push(`\n${prefix}Moved (path updated):`);
          for (const m of moved) {
            lines.push(`  - "${m.title}" (fqc_id=${m.fqcId})\n    ${m.oldPath} → ${m.newPath}`);
          }
        }
        if (archived.length > 0) {
          lines.push(`\n${prefix}Archived (file permanently missing):`);
          for (const a of archived) {
            lines.push(`  - "${a.title}" (fqc_id=${a.fqcId})\n    ${a.path}`);
          }
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`reconcile_documents failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        release();
      }
    }
  );

  // ─── Tool: move_document (SPEC-05) ────────────────────────────────────────

  server.registerTool(
    'move_document',
    {
      description:
        'Move or rename a document in the vault while preserving its fqc_id, history, and all plugin associations. Creates intermediate directories automatically. Renaming is a special case — move to the same directory with a different filename. Use this when the user wants to reorganize files, rename a document, or move files between folders. The document\'s identity is preserved — no data is lost.' +
        'The document file is moved atomically on the filesystem, and its path is updated in the database. ' +
        'References to this document in other files are NOT automatically updated. ' +
        'If destination extension is omitted, the source extension is used.',
      inputSchema: {
        identifier: z.string().describe('Source document path, fqc_id, or filename'),
        destination: z.string().describe('Vault-relative destination path including filename (extension optional)'),
      },
    },
    async ({ identifier, destination }) => {
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
        const supabase = supabaseManager.getClient();

        // Step 1: Resolve source identifier
        const resolved = await resolveDocumentIdentifier(config, supabase, identifier, logger);
        const sourceAbsPath = resolved.absPath;
        const sourceFqcId = resolved.fqcId;

        // Step 1.5: Check for plugin ownership
        let pluginOwnershipWarning = '';
        if (sourceFqcId) {
          const { data: docData } = await supabase
            .from('fqc_documents')
            .select('ownership_plugin_id')
            .eq('id', sourceFqcId)
            .eq('instance_id', config.instance.id)
            .maybeSingle();

          if (docData?.ownership_plugin_id) {
            pluginOwnershipWarning = `Warning: This document is owned by plugin '${docData.ownership_plugin_id}'. The plugin may expect the original path and may not find it at the new location.`;
          }
        }

        // Step 2: Validate source file exists
        if (!existsSync(sourceAbsPath)) {
          return {
            content: [{ type: 'text' as const, text: `Error: Source document not found at "${resolved.relativePath}".` }],
            isError: true,
          };
        }

        // Step 3: Validate and normalize destination path
        let destPath = destination.trim();

        // If no extension provided, use source extension
        if (!extname(destPath)) {
          const sourceExt = extname(resolved.relativePath);
          destPath += sourceExt;
        }

        // Path traversal protection
        const destAbsPath = join(vaultRoot, destPath);
        const normalizedDest = normalize(destAbsPath);
        if (!normalizedDest.startsWith(vaultRoot + sep) && normalizedDest !== vaultRoot) {
          return {
            content: [{ type: 'text' as const, text: `Error: Destination path escapes vault root.` }],
            isError: true,
          };
        }

        // Step 4: Check if destination already exists
        if (existsSync(destAbsPath)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: A file already exists at '${destPath}'. Choose a different destination or remove the existing file first.`,
              },
            ],
            isError: true,
          };
        }

        // Step 5: Check if source and destination are identical
        const normalizedSource = normalize(sourceAbsPath);
        if (normalizedDest === normalizedSource) {
          return {
            content: [{ type: 'text' as const, text: `Error: Source and destination are identical. No move needed.` }],
            isError: true,
          };
        }

        // Step 6: Create intermediate directories
        const destDir = dirname(destAbsPath);
        await mkdir(destDir, { recursive: true });

        // Step 7: Perform atomic move
        try {
          await rename(sourceAbsPath, destAbsPath);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // Check if it's EXDEV (cross-device) error
          if (errMsg.includes('EXDEV') || errMsg.includes('Invalid cross-device')) {
            // Fallback: read, write to dest, verify dest, then delete source
            const content = await readFile(sourceAbsPath, 'utf-8');
            await writeFile(destAbsPath, content, 'utf-8');
            await stat(destAbsPath); // Verify dest was written before deleting source
            await unlink(sourceAbsPath);
            logger.info(`move_document: cross-device fallback used for ${identifier} → ${destPath}`);
          } else {
            throw err;
          }
        }

        // Step 8: Update database path
        // Check if document is tracked (has fqc_id)
        if (sourceFqcId) {
          // Read the file to check if title was derived from filename
          const fileContent = await readFile(destAbsPath, 'utf-8');
          const { data: fm } = matter(fileContent);
          const currentTitle = fm[FM.TITLE] as string | undefined;

          // Extract filename without extension
          const sourceFilenameWithExt = basename(resolved.relativePath);
          const sourceFilename = sourceFilenameWithExt.replace(/\.md$/, '');
          const newFilenameWithExt = basename(destPath);
          const newFilename = newFilenameWithExt.replace(/\.md$/, '');

          // Update title only if it matches the old filename (derived)
          const updateData: Record<string, unknown> = {
            path: destPath,
          };

          if (currentTitle && sourceFilename && currentTitle === sourceFilename && newFilename) {
            updateData.title = newFilename;
          }

          await supabase
            .from('fqc_documents')
            .update(updateData)
            .eq('id', sourceFqcId)
            .eq('instance_id', config.instance.id);
        }

        // Step 9: Build response
        const responseLines: string[] = [
          `Document moved successfully.`,
          '',
          formatKeyValueEntry('Old path', resolved.relativePath),
          formatKeyValueEntry('New path', destPath),
        ];

        if (sourceFqcId) {
          responseLines.push(formatKeyValueEntry('Document ID', sourceFqcId));
        } else {
          responseLines.push(formatKeyValueEntry('Tracked', 'false'));
        }

        if (pluginOwnershipWarning) {
          responseLines.push('', pluginOwnershipWarning);
        }

        responseLines.push('', 'Note: References to this document in other files have not been updated. Update wikilinks manually if needed.');

        return { content: [{ type: 'text' as const, text: responseLines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`move_document failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );
}
