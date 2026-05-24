import { z } from 'zod';
import { readFile, stat, rename, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname, normalize, dirname, basename, resolve, isAbsolute } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vaultManager } from '../../storage/vault.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider } from '../../embedding/provider.js';
import {
  documentEmbeddingTarget,
  scheduleBackgroundEmbedding,
} from '../../embedding/background-embed.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { validateAllTags, deduplicateTags } from '../../utils/tag-validator.js';
import {
  resolveDocumentIdentifier,
  targetedScan,
} from '../utils/resolve-document.js';
import { serializeOrderedFrontmatter } from '../utils/frontmatter-sanitizer.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  documentArchiveResult,
  documentRemovalResult,
  documentIdentification,
  withWarnings,
  type ErrorEnvelope,
} from '../utils/response-formats.js';
import {
  validateParameterCombinations,
  resolveAndBuildDocument,
  DocumentRequestError,
} from '../utils/document-output.js';
import {
  buildDocumentWriteResult,
  mergeWriteDocumentFrontmatter,
  resolveTagsFrontmatterConflict,
  resolveTitleFrontmatterConflict,
  validateReservedFrontmatter,
  validateWriteDocumentInput,
} from '../utils/document-write.js';
import { validateVaultPath } from '../utils/path-validation.js';
import { pluginManager, getFolderClaimsMap } from '../../plugins/manager.js';
import { FM } from '../../constants/frontmatter-fields.js';
import { extractTemplateMeta } from '../../llm/template-meta.js';
import {
  computeHash,
  reconcileMissingRow,
} from '../../storage/document-primitives.js';

export {
  computeHash,
  listMarkdownFiles,
  parseDocMeta,
  reconcileMissingRow,
  type DocMeta,
} from '../../storage/document-primitives.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

function isDocumentNotFoundError(err: unknown): err is Error {
  return err instanceof Error && err.name === 'DocumentNotFoundError';
}

function isAmbiguousDocumentIdentifierError(err: unknown): err is Error & { matches?: unknown } {
  return err instanceof Error && err.name === 'AmbiguousDocumentIdentifierError';
}

function stringField(record: object, key: string, fallback: string): string {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

interface TrashDestination {
  absPath: string;
  responsePath: string;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !isAbsolute(rel));
}

function toVaultRelative(vaultRoot: string, absPath: string): string | null {
  if (!isPathInside(vaultRoot, absPath)) return null;
  return relative(resolve(vaultRoot), resolve(absPath)).replace(/\\/g, '/');
}

function compactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function resolveTrashRoot(vaultRoot: string, trashPath: string): { absPath: string } | ErrorEnvelope {
  const trimmed = trashPath.trim();
  if (trimmed === '') {
    return {
      error: 'invalid_input',
      message: 'trash_folder.path must not be empty.',
      details: { reason: 'unsafe_trash' },
    };
  }

  if (!isAbsolute(trimmed)) {
    const normalized = normalize(trimmed).replace(/\\/g, '/');
    if (normalized === '..' || normalized.startsWith('../')) {
      return {
        error: 'invalid_input',
        message: 'trash_folder.path escapes the vault root.',
        details: { reason: 'path_traversal' },
      };
    }
    return { absPath: resolve(vaultRoot, normalized) };
  }

  return { absPath: resolve(trimmed) };
}

function buildTrashDestination(
  vaultRoot: string,
  sourceRelativePath: string,
  trashRootAbsPath: string,
  collisionStrategy: 'suffix' | 'timestamp'
): TrashDestination {
  const sourceBase = basename(sourceRelativePath);
  const ext = extname(sourceBase);
  const stem = ext ? sourceBase.slice(0, -ext.length) : sourceBase;
  let candidate = join(trashRootAbsPath, sourceBase);

  if (existsSync(candidate)) {
    if (collisionStrategy === 'timestamp') {
      const timestamp = compactTimestamp();
      let index = 0;
      do {
        const suffix = index === 0 ? timestamp : `${timestamp}-${index}`;
        candidate = join(trashRootAbsPath, `${stem}-${suffix}${ext}`);
        index += 1;
      } while (existsSync(candidate));
    } else {
      let index = 1;
      do {
        candidate = join(trashRootAbsPath, `${stem}-${index}${ext}`);
        index += 1;
      } while (existsSync(candidate));
    }
  }

  const vaultRelative = toVaultRelative(vaultRoot, candidate);
  return {
    absPath: candidate,
    responsePath: vaultRelative ?? candidate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute SHA-256 hash of raw file content
// ─────────────────────────────────────────────────────────────────────────────

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
	    includeArchived?: boolean;
	  }
	): Promise<Array<{ id: string; path: string; title: string; tags: string[]; similarity: number; created_at: string }>> {
	  const { tags, tagMatch = 'any', limit = 20, includeArchived = false } = opts;
  const queryEmbedding = await embeddingProvider.embed(query);
  const supabase = supabaseManager.getClient();
  const rpcResult = (await supabase.rpc('match_documents', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: 0.4,
    match_count: limit,
	    filter_instance_id: config.instance.id,
	    filter_tags: tags ?? null,
	    filter_tag_match: tagMatch,
	    include_archived: includeArchived,
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
  server.registerTool(
    'write_document',
    {
      description:
        'Create a new markdown document or update one existing document. Use this when you need to write a whole document body, create a note at a vault path, change title/frontmatter, or replace a document\'s tag list.\n\n' +
        'Use mode: "create" with path and title to create a new document. Use mode: "update" with identifier to update an existing document by fq_id, path, or filename. In update mode, provide at least one of content, title, frontmatter, or tags. Tags replace the full tag list; they are not additive.\n\n' +
        'Do not use this for heading-anchored insertions or section replacement; use insert_in_doc or replace_doc_section. Do not use this for additive/removal tag edits; use apply_tags. Do not pass FQ-managed frontmatter fields such as fq_id directly.\n\n' +
        'Example: write_document({ "mode": "update", "identifier": "Notes/project.md", "title": "Project Plan", "frontmatter": { "status": "review" }, "tags": ["planning"] })',
      inputSchema: {
        mode: z.enum(['create', 'update']).optional().describe('Required explicit mode: "create" or "update".'),
        identifier: z.string().optional().describe('Existing document identifier for update mode.'),
        path: z.string().optional().describe('Vault-relative path for create mode.'),
        title: z.string().optional().describe(`Document title; maps to ${FM.TITLE}.`),
        content: z.string().optional().describe('Document body. Omitted create content becomes an empty body.'),
        frontmatter: z.record(z.string(), z.unknown()).optional().describe('Custom frontmatter fields. FQ-managed fields are rejected.'),
        tags: z.array(z.string()).optional().describe('Replacement tag list.'),
      },
    },
    async ({ mode, identifier, path, title, content, frontmatter, tags }) => {
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
          isError: true,
        };
      }

      const inputError = validateWriteDocumentInput({ mode, identifier, path, title, content, frontmatter, tags });
      if (inputError) return jsonExpectedError(inputError);
      const reservedError = validateReservedFrontmatter(frontmatter);
      if (reservedError) return jsonExpectedError(reservedError);
      const titleError = resolveTitleFrontmatterConflict(title, frontmatter);
      if (titleError) return jsonExpectedError(titleError);
      const tagsError = resolveTagsFrontmatterConflict(tags, frontmatter);
      if (tagsError) return jsonExpectedError(tagsError);

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'documents',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return jsonExpectedError({
            error: 'conflict',
            message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
            details: { reason: 'lock_contention' },
          });
        }
      }

      try {
        const supabase = supabaseManager.getClient();
        const vaultRoot = config.instance.vault.path;

        if (mode === 'create') {
          const validation = await validateVaultPath(vaultRoot, path as string);
          if (!validation.valid) {
            return jsonExpectedError({
              error: 'invalid_input',
              message: validation.error ?? 'Invalid path.',
              details: { field: 'path' },
            });
          }
          const relativePath = validation.relativePath;
          const absolutePath = validation.absPath;
          if (existsSync(absolutePath)) {
            try {
              const statResult = await stat(absolutePath);
              if (statResult.isDirectory()) {
                return jsonExpectedError({
                  error: 'invalid_input',
                  message: `Path "${relativePath}" is a directory, not a file. Provide a complete file path with .md extension.`,
                  details: { field: 'path', reason: 'path_is_directory' },
                });
              }
            } catch {
              // Fall through to the existing path conflict if stat cannot inspect it.
            }
            return jsonExpectedError({
              error: 'conflict',
              message: `Document already exists at "${relativePath}"`,
              details: { reason: 'path_exists' },
            });
          }

          const tagValidation = validateAllTags(tags ?? []);
          if (!tagValidation.valid) {
            return jsonExpectedError({
              error: 'invalid_input',
              message: `Tag validation failed: ${tagValidation.errors.join('; ')}`,
              details: { field: 'tags' },
            });
          }

          const fqcId = uuidv4();
          const now = new Date().toISOString();
          const deduplicated = deduplicateTags(tagValidation.normalized);
          const effectiveTitle = title as string;
          const body = content ?? '';
          const warnings: string[] = [];
          const folderClaimsMap = getFolderClaimsMap(config);
          for (const [folder, claim] of folderClaimsMap.entries()) {
            const normalizedTarget = relativePath.toLowerCase();
            if (normalizedTarget === folder || normalizedTarget.startsWith(folder + '/')) {
              const claimEntry = pluginManager.getEntry(claim.pluginId, 'default');
              const docType = claimEntry?.schema.documents?.types.find((type) => type.id === claim.typeId);
              if (docType?.access === 'read-only') {
                warnings.push('plugin_readonly_folder');
                break;
              }
            }
          }
          const fm = serializeOrderedFrontmatter({
            ...mergeWriteDocumentFrontmatter(frontmatter, effectiveTitle),
            [FM.ID]: fqcId,
            [FM.INSTANCE]: config.instance.id,
            [FM.STATUS]: 'active',
            [FM.TAGS]: deduplicated,
            [FM.CREATED]: now,
          });

          await vaultManager.writeMarkdown(relativePath, fm, body, {
            gitAction: 'create',
            gitTitle: effectiveTitle,
          });

          const rawContent = await readFile(join(vaultRoot, relativePath), 'utf-8');
          const contentHash = computeHash(rawContent);
          const insertPayload = {
            id: fqcId,
            instance_id: config.instance.id,
            path: relativePath,
            title: effectiveTitle,
            tags: deduplicated,
            content_hash: contentHash,
            status: 'active',
            template_meta: extractTemplateMeta(fm),
            embedding: null,
          };
          const { error: insertError } = await supabase.from('fqc_documents').insert(insertPayload);
          if (insertError) {
            if (insertError.code === '23505' || insertError.message.includes('duplicate key')) {
              logger.warn(
                `write_document(create): duplicate path conflict for ${relativePath} — replacing stale DB row`
              );
              await supabase
                .from('fqc_documents')
                .delete()
                .eq('instance_id', config.instance.id)
                .eq('path', relativePath);
              const { error: reinsertError } = await supabase.from('fqc_documents').insert(insertPayload);
              if (reinsertError) {
                logger.warn(
                  `write_document(create): re-insert failed after stale-row cleanup for ${relativePath}: ${reinsertError.message}`
                );
              }
            } else {
              logger.warn(`write_document(create): fqc_documents insert failed for ${relativePath}: ${insertError.message}`);
            }
          }

          const embedResult = await scheduleBackgroundEmbedding({
            target: documentEmbeddingTarget({
              instanceId: config.instance.id,
              id: fqcId,
              label: relativePath,
            }),
            embedText: `${effectiveTitle}\n\n${body}`,
            provider: embeddingProvider,
            supabase,
          });

          return jsonToolResult(withWarnings(buildDocumentWriteResult({
            mode: 'create',
            identifier: relativePath,
            title: effectiveTitle,
            path: relativePath,
            fq_id: fqcId,
            modified: now,
            chars: body.length,
          }), [...warnings, ...embedResult.warnings]));
        }

        const resolved = await resolveDocumentIdentifier(config, supabase, identifier as string, logger);
        const rawContent = await readFile(resolved.absPath, 'utf-8');
        const parsed = matter(rawContent);
        const existingData = parsed.data;
        const existingBody = parsed.content;
        const effectiveTitle =
          title ?? (typeof existingData[FM.TITLE] === 'string' ? existingData[FM.TITLE] as string : resolved.relativePath);
        const validation = validateAllTags(tags ?? (Array.isArray(existingData[FM.TAGS]) ? existingData[FM.TAGS] as string[] : []));
        if (!validation.valid) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: `Tag validation failed: ${validation.errors.join('; ')}`,
            details: { field: 'tags' },
          });
        }
        const effectiveTags = deduplicateTags(validation.normalized);
        const effectiveBody = content ?? existingBody;
        const fm: Record<string, unknown> = {
          ...existingData,
          ...mergeWriteDocumentFrontmatter(frontmatter, effectiveTitle),
          [FM.TAGS]: effectiveTags,
          [FM.INSTANCE]: (existingData[FM.INSTANCE] as string | undefined) ?? config.instance.id,
          [FM.CREATED]: existingData[FM.CREATED] as string | undefined,
          [FM.STATUS]: (existingData[FM.STATUS] as string | undefined) ?? 'active',
        };
        for (const [key, value] of Object.entries(frontmatter ?? {})) {
          if (value === null) {
            delete fm[key];
          }
        }
        const serialized = matter.stringify(effectiveBody, fm);
        const preWriteHash = computeHash(serialized);
        const preScan = await targetedScan(config, supabase, resolved, preWriteHash, logger);
        const fqcId = preScan.capturedFrontmatter.fqcId;
        fm[FM.ID] = fqcId;
        const sanitizedFm = serializeOrderedFrontmatter(fm);
        await vaultManager.writeMarkdown(resolved.relativePath, sanitizedFm, effectiveBody, {
          gitAction: 'update',
          gitTitle: effectiveTitle,
        });
        const postWriteRaw = await readFile(resolved.absPath, 'utf-8');
        const postWriteHash = computeHash(postWriteRaw);

        const { error: updateError } = await supabase
          .from('fqc_documents')
          .update({
            title: effectiveTitle,
            tags: effectiveTags,
            content_hash: postWriteHash,
            path: resolved.relativePath,
            template_meta: extractTemplateMeta(fm),
            updated_at: new Date().toISOString(),
          })
          .eq('id', fqcId);
        if (updateError) {
          logger.warn(`write_document(update): fqc_documents update failed for ${resolved.relativePath}: ${updateError.message}`);
        }

        const embedResult = await scheduleBackgroundEmbedding({
          target: documentEmbeddingTarget({
            instanceId: config.instance.id,
            id: fqcId,
            label: resolved.relativePath,
          }),
          embedText: `${effectiveTitle}\n\n${effectiveBody}`,
          provider: embeddingProvider,
          supabase,
        });

        return jsonToolResult(withWarnings(buildDocumentWriteResult({
          mode: 'update',
          identifier: identifier as string,
          title: effectiveTitle,
          path: resolved.relativePath,
          fq_id: fqcId,
          modified: new Date().toISOString(),
          chars: effectiveBody.length,
        }), embedResult.warnings));
      } catch (err) {
        if (isDocumentNotFoundError(err)) {
          return jsonExpectedError({
            error: 'not_found',
            message: `No document found for identifier: ${identifier}`,
            identifier,
          });
        }
        if (isAmbiguousDocumentIdentifierError(err)) {
          return jsonExpectedError({
            error: 'ambiguous_identifier',
            message: err.message,
            identifier,
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`write_document failed - ${msg}`);
        return jsonRuntimeError({ message: `Error writing document: ${msg}`, identifier });
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
        max_depth: z.number().optional().default(6).describe(
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

      if (!Number.isInteger(occurrence) || occurrence < 1) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'occurrence must be a positive integer.',
          details: { field: 'occurrence', value: occurrence },
        });
      }

      if (!Number.isInteger(effectiveMaxDepth) || effectiveMaxDepth < 1 || effectiveMaxDepth > 6) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'max_depth must be an integer between 1 and 6.',
          details: { field: 'max_depth', value: effectiveMaxDepth, min: 1, max: 6 },
        });
      }

      const paramError = validateParameterCombinations({
        include: [...effectiveInclude],
        sections: sectionsList,
        occurrence,
      });
      if (paramError !== null) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: paramError.message,
          details: paramError.details,
        });
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
                // section_not_found / follow_ref_*_error etc. — embed the helper-normalized envelope at this position
                return JSON.parse(jsonExpectedError(err.envelope).content[0]?.text ?? '{}') as ErrorEnvelope;
              }
              const msg = err instanceof Error ? err.message : String(err);
              const isNotFound =
                msg.toLowerCase().includes('not found') ||
                msg.toLowerCase().includes('missing') ||
                msg.toLowerCase().includes('enoent');
              return {
                error: isNotFound ? 'not_found' : 'runtime_error',
                message: isNotFound
                  ? `No document found for identifier: ${id}`
                  : `Error reading document: ${msg}`,
                identifier: id,
              };
            }
          })
        );
        return jsonToolResult(results);
      }

      // Single-string path — backward-compatible flat object response
      try {
        const result = await resolveAndBuildDocument(identifiers, elementOptions, deps);
        return jsonToolResult(result);
      } catch (err) {
        if (err instanceof DocumentRequestError) {
          return jsonExpectedError(err.envelope);
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_document failed - ${msg}`);
        const isNotFound =
          msg.toLowerCase().includes('not found') ||
          msg.toLowerCase().includes('missing') ||
          msg.toLowerCase().includes('enoent');
        if (isNotFound) {
          return jsonExpectedError({
            error: 'not_found',
            message: `No document found for identifier: ${identifiers}`,
            identifier: identifiers,
          });
        }
        return jsonRuntimeError({ message: `Error reading document: ${msg}`, identifier: identifiers });
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

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'documents',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return jsonExpectedError({
            error: 'conflict',
            message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
            details: { reason: 'lock_contention' },
          });
        }
      }

      try {
        const supabase = supabaseManager.getClient();
        const isBatch = Array.isArray(identifiers);
        const ids = isBatch ? identifiers : [identifiers];
        const results: Array<Record<string, unknown>> = [];

        for (const id of ids) {
          try {
            if (typeof id !== 'string' || id.trim() === '') {
              results.push({
                error: 'invalid_input',
                message: 'Document identifier must be a non-empty string.',
                identifier: String(id),
              });
              continue;
            }

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

            const archivedAtValue = parsed.data[FM.ARCHIVED_AT];
            const existingArchivedAt = typeof archivedAtValue === 'string' && archivedAtValue.length > 0
              ? archivedAtValue
              : null;
            const archivedAt = existingArchivedAt ?? new Date().toISOString();

            // Step 2: Call targetedScan to update frontmatter with archived status
            // Compute hash of the file with archived status
            const archivedFm: Record<string, unknown> = {
              ...parsed.data,
              [FM.STATUS]: 'archived',
              [FM.ARCHIVED_AT]: archivedAt,
            };
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
            const fqcId = resolved.fqcId ?? stringField(preScan.capturedFrontmatter, 'fqcId', '');
            const updatedAt = new Date().toISOString();
            let archivedFileWritten = false;
            try {
              await vaultManager.writeMarkdown(
                relativePath,
                archivedFm,
                parsed.content,
                { gitAction: 'update', gitTitle: typeof archivedTitle === 'string' ? archivedTitle : relativePath }
              );
              archivedFileWritten = true;

              // Step 3: Update Supabase fqc_documents
              if (fqcId) {
                const { data, error } = await supabase
                  .from('fqc_documents')
                  .update({ status: 'archived', archived_at: archivedAt, updated_at: updatedAt })
                  .eq('id', fqcId)
                  .eq('instance_id', config.instance.id)
                  .select('id')
                  .maybeSingle();
                if (error) {
                  throw new Error(`Supabase archive update failed for ${relativePath}: ${error.message}`);
                }
                if (!data) {
                  throw new Error(`Supabase archive update affected no document row for ${relativePath}`);
                }
              } else {
                // Fallback: update by path if no fqcId available
                const { data, error } = await supabase
                  .from('fqc_documents')
                  .update({ status: 'archived', archived_at: archivedAt, updated_at: updatedAt })
                  .eq('path', relativePath)
                  .eq('instance_id', config.instance.id)
                  .select('id')
                  .maybeSingle();
                if (error) {
                  throw new Error(`Supabase archive update failed for ${relativePath}: ${error.message}`);
                }
                if (!data) {
                  throw new Error(`Supabase archive update affected no document row for ${relativePath}`);
                }
              }
            } catch (archiveErr) {
              if (archivedFileWritten) {
                try {
                  await vaultManager.writeMarkdown(relativePath, parsed.data, parsed.content);
                } catch (rollbackErr) {
                  const rollbackMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
                  logger.error(`archive_document rollback failed for ${relativePath}: ${rollbackMsg}`);
                }
              }
              throw archiveErr;
            }

            const archivedStats = await stat(join(config.instance.vault.path, relativePath));
            const title = stringField(archivedFm, FM.TITLE, relativePath);

            logger.info(`archive_document: archived ${relativePath}`);
            results.push(documentArchiveResult({
              identifier: id,
              title,
              path: relativePath,
              fq_id: fqcId,
              modified: archivedStats.mtime.toISOString(),
              chars: parsed.content.length,
              archived_at: archivedAt,
            }));
          } catch (itemErr) {
            if (isDocumentNotFoundError(itemErr)) {
              results.push({
                error: 'not_found',
                message: `No document matches identifier '${id}'`,
                identifier: id,
              });
              continue;
            }

            if (isAmbiguousDocumentIdentifierError(itemErr)) {
              results.push({
                error: 'ambiguous_identifier',
                message: itemErr.message,
                identifier: id,
                details: { matches: itemErr.matches },
              });
              continue;
            }

            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
            if (!isBatch) {
              throw itemErr;
            }
            results.push({
              error: 'runtime_error',
              message: msg,
              identifier: id,
            });
          }
        }

        if (isBatch) {
          return jsonToolResult(results);
        }
        if (results[0] && typeof results[0].error === 'string') {
          return jsonExpectedError(results[0] as ErrorEnvelope);
        }
        return jsonToolResult(results[0]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`archive_document failed - ${msg}`);
        return jsonRuntimeError(msg);
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );

  // ─── Tool: remove_document (DOC-09) ───────────────────────────────────────

  server.registerTool(
    'remove_document',
    {
      description:
        'Remove documents from their current vault path, archiving their FlashQuery lifecycle state first. Use this when a document should no longer appear in normal vault workflows and should either be hard-deleted or moved to the configured trash folder.\n\n' +
        'Pass identifiers as a single document identifier or an array. If trash_folder is enabled, files move to the configured trash folder using basename-only destinations and collision handling. If trash_folder is disabled, files are physically deleted. Batch responses preserve input order and report per-document errors.\n\n' +
        'Do not use this for reversible archive-only workflows; use archive_document. Do not expect a restore or trash lifecycle API from this tool. Do not use it for directories; use manage_directory for empty directory removal.\n\n' +
        'Example: remove_document({ "identifiers": ["Notes/old-plan.md", "Scratch/temp.md"] })',
      inputSchema: {
        identifiers: z
          .union([z.string(), z.array(z.string())])
          .describe('One or more document identifiers: path, fq_id, or filename.'),
      },
    },
    async ({ identifiers }) => {
      if (getIsShuttingDown()) {
        return {
          content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
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
          return jsonExpectedError({
            error: 'conflict',
            message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
            details: { reason: 'lock_contention' },
          });
        }
      }

      try {
        const supabase = supabaseManager.getClient();
        const vaultRoot = config.instance.vault.path;
        const isBatch = Array.isArray(identifiers);
        const ids = isBatch ? identifiers : [identifiers];
        const results: Array<Record<string, unknown>> = [];
        const warnings = ids.length > 5 ? [`bulk_removal: ${ids.length} items`] : [];
        const trashRoot = config.trashFolder.enabled
          ? resolveTrashRoot(vaultRoot, config.trashFolder.path)
          : null;

        for (const id of ids) {
          try {
            if (typeof id !== 'string' || id.trim() === '') {
              results.push({
                error: 'invalid_input',
                message: 'Document identifier must be a non-empty string.',
                identifier: String(id),
              });
              continue;
            }

            if (trashRoot && 'error' in trashRoot) {
              results.push({
                ...trashRoot,
                identifier: id,
              });
              continue;
            }

            const resolved = await resolveDocumentIdentifier(config, supabase, id, logger);
            const relativePath = resolved.relativePath;
            const parsed = await vaultManager.readMarkdown(relativePath);
            const archivedAtValue = parsed.data[FM.ARCHIVED_AT];
            const existingArchivedAt = typeof archivedAtValue === 'string' && archivedAtValue.length > 0
              ? archivedAtValue
              : null;
            const archivedAt = existingArchivedAt ?? new Date().toISOString();
            const title = stringField(parsed.data, FM.TITLE, relativePath);

            const archivedFm: Record<string, unknown> = {
              ...parsed.data,
              [FM.STATUS]: 'archived',
              [FM.ARCHIVED_AT]: archivedAt,
            };
            if (config.trashFolder.enabled) {
              archivedFm[FM.ORIGINAL_PATH] = relativePath;
            }

            const serialized = matter.stringify(parsed.content, archivedFm);
            const newContentHash = computeHash(serialized);
            const preScan = await targetedScan(config, supabase, resolved, newContentHash, logger);
            const fqcId = resolved.fqcId ?? stringField(preScan.capturedFrontmatter, 'fqcId', '');
            archivedFm[FM.ID] = fqcId;

            let archivedFileWritten = false;
            let archivedRowWritten = false;

            try {
              await vaultManager.writeMarkdown(relativePath, archivedFm, parsed.content);
              archivedFileWritten = true;

              const updatedAt = new Date().toISOString();
              const { data: updatedRow, error: updateError } = await supabase
                .from('fqc_documents')
                .update({ status: 'archived', archived_at: archivedAt, updated_at: updatedAt })
                .eq('id', fqcId)
                .eq('instance_id', config.instance.id)
                .select('id')
                .maybeSingle();
              if (updateError) {
                throw new Error(`Supabase removal archive update failed for ${relativePath}: ${updateError.message}`);
              }
              if (!updatedRow) {
                throw new Error(`Supabase removal archive update affected no document row for ${relativePath}`);
              }
              archivedRowWritten = true;

              const archivedStats = await stat(join(vaultRoot, relativePath));
              const baseResult = {
                identifier: id,
                title,
                path: relativePath,
                fq_id: fqcId,
                modified: archivedStats.mtime.toISOString(),
                chars: parsed.content.length,
                archived_at: archivedAt,
              };

              if (config.trashFolder.enabled) {
                const activeTrashRoot = trashRoot as { absPath: string };
                const trashDestination = buildTrashDestination(
                  vaultRoot,
                  relativePath,
                  activeTrashRoot.absPath,
                  config.trashFolder.collisionStrategy
                );
                await vaultManager.moveMarkdownToTrash(relativePath, trashDestination.absPath, {
                  gitTitle: title,
                });
                results.push(documentRemovalResult({
                  ...baseResult,
                  moved_to: trashDestination.responsePath,
                }));
              } else {
                await vaultManager.removeMarkdown(relativePath, { gitTitle: title });
                results.push(documentRemovalResult({ ...baseResult, moved_to: null }));
              }
            } catch (removalErr) {
              if (archivedFileWritten && existsSync(join(vaultRoot, relativePath))) {
                await vaultManager.writeMarkdown(relativePath, parsed.data, parsed.content);
              }
              if (archivedRowWritten) {
                const originalStatus = stringField(parsed.data, FM.STATUS, 'active');
                const originalArchivedAtValue = parsed.data[FM.ARCHIVED_AT];
                const originalArchivedAt =
                  typeof originalArchivedAtValue === 'string' && originalArchivedAtValue.length > 0
                    ? originalArchivedAtValue
                    : null;
                const { error: restoreError } = await supabase
                  .from('fqc_documents')
                  .update({
                    status: originalStatus,
                    archived_at: originalArchivedAt,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', fqcId)
                  .eq('instance_id', config.instance.id);
                if (restoreError) {
                  logger.error(
                    `remove_document rollback failed for ${relativePath}: ${restoreError.message}`
                  );
                }
              }
              throw removalErr;
            }
          } catch (itemErr) {
            if (isDocumentNotFoundError(itemErr)) {
              results.push({
                error: 'not_found',
                message: `No document matches identifier '${id}'`,
                identifier: id,
              });
              continue;
            }

            if (isAmbiguousDocumentIdentifierError(itemErr)) {
              results.push({
                error: 'ambiguous_identifier',
                message: itemErr.message,
                identifier: id,
                details: { matches: itemErr.matches },
              });
              continue;
            }

            const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
            if (!isBatch) {
              throw itemErr;
            }
            results.push({
              error: 'runtime_error',
              message: msg,
              identifier: id,
            });
          }
        }

        if (isBatch) {
          return jsonToolResult(withWarnings({ results }, warnings));
        }
        if (results[0] && typeof results[0].error === 'string') {
          return jsonExpectedError(results[0] as ErrorEnvelope);
        }
        return jsonToolResult(results[0]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`remove_document failed - ${msg}`);
        return jsonRuntimeError(msg);
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
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

      if (Array.isArray(identifier)) {
        return jsonExpectedError({
          error: 'invalid_input',
          message: 'copy_document accepts one source identifier; array input is not supported.',
          details: { reason: 'single_target_only' },
        });
      }

      if (config.locking.enabled) {
        const locked = await acquireLock(
          supabaseManager.getClient(),
          config.instance.id,
          'documents',
          { ttlSeconds: config.locking.ttlSeconds }
        );
        if (!locked) {
          return jsonExpectedError({
            error: 'conflict',
            message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
            identifier,
            details: { reason: 'lock_contention' },
          });
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
          return jsonExpectedError({
            error: 'invalid_input',
            message: `Tag validation failed - ${[...validation.errors].join('; ')}`,
            identifier,
            details: { field: 'tags', errors: [...validation.errors] },
          });
        }

        // Generate new fqc_id for the copy
        const newFqcId = uuidv4();
        const now = new Date().toISOString();

        // Build copy path, then validate with the shared symlink-aware vault guard.
        const requestedCopyPath = destination ?? `${sanitizeFilename(copyTitle)}.md`;
        const copyValidation = await validateVaultPath(config.instance.vault.path, requestedCopyPath);
        if (!copyValidation.valid) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: `Invalid destination path: ${copyValidation.error}`,
            identifier: requestedCopyPath,
            details: { reason: 'path_traversal' },
          });
        }
        const copyRelativePath = copyValidation.relativePath;

        const absPath = join(config.instance.vault.path, copyRelativePath);
        if (existsSync(absPath)) {
          return jsonExpectedError({
            error: 'conflict',
            message: `A file already exists at '${copyRelativePath}'. Choose a different destination or remove the existing file first.`,
            identifier: copyRelativePath,
            details: { reason: 'path_exists' },
          });
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
        const sanitizedFm = serializeOrderedFrontmatter(copyFm);
        await vaultManager.writeMarkdown(copyRelativePath, sanitizedFm, parsed.content, { gitAction: 'create', gitTitle: copyTitle });
        logger.info(`copy_document: wrote copy to ${copyRelativePath} (new fqc_id=${newFqcId})`);

        // Sync: read raw file to compute content_hash, then insert fqc_documents row
        let contentHash: string | null = null;
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
          template_meta: extractTemplateMeta(copyFm),
          embedding: null,
        });
        if (insertError) {
          throw new Error(`Supabase copy insert failed for ${copyRelativePath}: ${insertError.message}`);
        }

        const embedResult = await scheduleBackgroundEmbedding({
          target: documentEmbeddingTarget({
            instanceId: config.instance.id,
            id: newFqcId,
            label: copyRelativePath,
          }),
          embedText: `${copyTitle}\n\n${parsed.content}`,
          provider: embeddingProvider,
          supabase,
        });

        const written = await vaultManager.readMarkdown(copyRelativePath);
        const modified = stringField(written.data, FM.UPDATED, now);

        return jsonToolResult(withWarnings(documentIdentification({
          identifier: copyRelativePath,
          title: copyTitle,
          path: copyRelativePath,
          fq_id: newFqcId,
          modified,
          chars: written.content.length,
        }), embedResult.warnings));
      } catch (err) {
        if (isDocumentNotFoundError(err)) {
          return jsonExpectedError({
            error: 'not_found',
            message: `No document found for identifier: ${identifier}`,
            identifier,
          });
        }

        if (isAmbiguousDocumentIdentifierError(err)) {
          return jsonExpectedError({
            error: 'ambiguous_identifier',
            message: err.message,
            identifier,
          });
        }

        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`copy_document failed - ${msg}`);
        return jsonRuntimeError({ message: `Error copying document: ${msg}`, identifier });
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
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
        'Existing links in other files are NOT automatically updated. ' +
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
          return jsonExpectedError({
            error: 'conflict',
            message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
            identifier,
            details: { reason: 'lock_contention' },
          });
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
        const warnings: string[] = [];
        if (sourceFqcId) {
          const { data: docData } = await supabase
            .from('fqc_documents')
            .select('ownership_plugin_id')
            .eq('id', sourceFqcId)
            .eq('instance_id', config.instance.id)
            .maybeSingle();

          if (docData?.ownership_plugin_id) {
            warnings.push('plugin_ownership_path_expectation');
          }
        }

        // Step 2: Validate source file exists
        if (!existsSync(sourceAbsPath)) {
          return jsonExpectedError({
            error: 'not_found',
            message: `Source document not found at "${resolved.relativePath}".`,
            identifier,
          });
        }

        // Step 3: Validate and normalize destination path
        let destPath = destination.trim();

        // If no extension provided, use source extension
        if (!extname(destPath)) {
          const sourceExt = extname(resolved.relativePath);
          destPath += sourceExt;
        }

        // Path traversal and symlink protection for the destination parent.
        const destDirRel = dirname(destPath);
        const destBase = basename(destPath);
        let destAbsPath: string;
        if (destDirRel === '.' || destDirRel === '') {
          destAbsPath = join(resolve(vaultRoot), destBase);
        } else {
          const parentValidation = await validateVaultPath(vaultRoot, destDirRel);
          if (!parentValidation.valid) {
            return jsonExpectedError({
              error: 'invalid_input',
              message: 'Destination path escapes vault root.',
              identifier: destPath,
              details: { reason: 'path_traversal' },
            });
          }
          destAbsPath = join(parentValidation.absPath, destBase);
        }
        const normalizedDest = normalize(destAbsPath);

        // Step 4: Check if destination already exists
        if (existsSync(destAbsPath)) {
          return jsonExpectedError({
            error: 'conflict',
            message: `A file already exists at '${destPath}'. Choose a different destination or remove the existing file first.`,
            identifier: destPath,
            details: { reason: 'path_exists' },
          });
        }

        // Step 5: Check if source and destination are identical
        const normalizedSource = normalize(sourceAbsPath);
        if (normalizedDest === normalizedSource) {
          return jsonExpectedError({
            error: 'conflict',
            message: 'Source and destination are identical. No move needed.',
            identifier: destPath,
            details: { reason: 'identical_path' },
          });
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

        let responseTitle = basename(destPath).replace(/\.md$/, '');

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
            responseTitle = newFilename;
          } else if (currentTitle) {
            responseTitle = currentTitle;
          }

          const { data: updatedRow, error: updateError } = await supabase
            .from('fqc_documents')
            .update(updateData)
            .eq('id', sourceFqcId)
            .eq('instance_id', config.instance.id)
            .select('id')
            .maybeSingle();
          if (updateError) {
            throw new Error(`Supabase path update failed for ${destPath}: ${updateError.message}`);
          }
          if (!updatedRow) {
            throw new Error(`Supabase path update affected no document row for ${destPath}`);
          }
        }

        const moved = await vaultManager.readMarkdown(destPath);
        const movedTitle = stringField(moved.data, FM.TITLE, responseTitle);
        const modified = stringField(moved.data, FM.UPDATED, new Date().toISOString());
        const movedFqcIdValue = moved.data[FM.ID];
        const movedFqcId = typeof movedFqcIdValue === 'string' ? movedFqcIdValue : null;
        if (!sourceFqcId && !movedFqcId) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'move_document requires a tracked document with an fq_id.',
            identifier,
            details: { reason: 'untracked_document' },
          });
        }
        const responseFqcId = sourceFqcId ?? movedFqcId ?? '';
        const payload = documentIdentification({
          identifier: destPath,
          title: movedTitle,
          path: destPath,
          fq_id: responseFqcId,
          modified,
          chars: moved.content.length,
        });

        return jsonToolResult(withWarnings(payload, warnings));
      } catch (err) {
        if (isDocumentNotFoundError(err)) {
          return jsonExpectedError({
            error: 'not_found',
            message: `No document found for identifier: ${identifier}`,
            identifier,
          });
        }

        if (isAmbiguousDocumentIdentifierError(err)) {
          return jsonExpectedError({
            error: 'ambiguous_identifier',
            message: err.message,
            identifier,
          });
        }

        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`move_document failed - ${msg}`);
        return jsonRuntimeError({ message: `Error moving document: ${msg}`, identifier });
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );
}
