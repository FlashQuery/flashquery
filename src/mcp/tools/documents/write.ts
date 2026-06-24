import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vaultManager } from '../../../storage/vault.js';
import { supabaseManager } from '../../../storage/supabase.js';
import { scheduleChangedDocumentChunks } from '../../../embedding/chunks/scheduler.js';
import { logger } from '../../../logging/logger.js';
import {
  LockTimeoutError,
  withAncestorDirectoryLocksShared,
  withDocumentLock,
} from '../../../services/document-lock.js';
import { validateAllTags, deduplicateTags } from '../../../utils/tag-validator.js';
import { resolveDocumentIdentifier, targetedScan } from '../../utils/resolve-document.js';
import { serializeOrderedFrontmatter } from '../../utils/frontmatter-sanitizer.js';
import { getIsShuttingDown } from '../../../server/shutdown-state.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  withWarnings,
} from '../../utils/response-formats.js';
import type { ToolResult } from '../../utils/response-formats.js';
import {
  buildDocumentWriteResult,
  buildWholeDocumentTargetedRegion,
  mergeWriteDocumentFrontmatter,
  resolveTagsFrontmatterConflict,
  resolveTitleFrontmatterConflict,
  validateReservedFrontmatter,
  validateWriteDocumentInput,
} from '../../utils/document-write.js';
import {
  buildVersionMismatchEnvelope,
  computeVersionToken,
  pickExpectedVersion,
} from '../../utils/document-version.js';
import { validateVaultPath } from '../../utils/path-validation.js';
import { pluginManager, getFolderClaimsMap } from '../../../plugins/manager.js';
import { FM } from '../../../constants/frontmatter-fields.js';
import { extractTemplateMeta } from '../../../llm/template-meta.js';
import { computeHash } from '../../../storage/document-primitives.js';
import type { DocumentToolDeps } from './deps.js';
import { isAmbiguousDocumentIdentifierError, isDocumentNotFoundError } from './helpers.js';

export function registerWriteDocumentTool(server: McpServer, deps: DocumentToolDeps): void {
  const { config } = deps;
  server.registerTool(
    'write_document',
    {
      description:
        "Create a new markdown document or update one existing document. Use this when you need to write a whole document body, create a note at a vault path, change title/frontmatter, or replace a document's tag list.\n\n" +
        'Use mode: "create" with path and title to create a new document. Use mode: "update" with identifier to update an existing document by fq_id, path, or filename. In update mode, provide at least one of content, title, frontmatter, or tags. Tags replace the full tag list; they are not additive.\n\n' +
        'Do not use this for heading-anchored insertions or section replacement; use insert_in_doc or replace_doc_section. Do not use this for additive/removal tag edits; use apply_tags. Do not pass FQ-managed frontmatter fields such as fq_id directly.\n\n' +
        'Example: write_document({ "mode": "update", "identifier": "Notes/project.md", "title": "Project Plan", "frontmatter": { "status": "review" }, "tags": ["planning"] })',
      inputSchema: {
        mode: z
          .enum(['create', 'update'])
          .optional()
          .describe('Required explicit mode: "create" or "update".'),
        identifier: z.string().optional().describe('Existing document identifier for update mode.'),
        path: z.string().optional().describe('Vault-relative path for create mode.'),
        title: z.string().optional().describe(`Document title; maps to ${FM.TITLE}.`),
        content: z
          .string()
          .optional()
          .describe('Document body. Omitted create content becomes an empty body.'),
        frontmatter: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Custom frontmatter fields. FQ-managed fields are rejected.'),
        tags: z.array(z.string()).optional().describe('Replacement tag list.'),
        expected_version: z.string().optional()
          .describe('Optional whole-file version_token precondition for opt-in conflict detection.'),
        if_match: z.string().optional()
          .describe('Alias for expected_version.'),
      },
    },
    async ({ mode, identifier, path, title, content, frontmatter, tags, expected_version, if_match }) => {
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

      const inputError = validateWriteDocumentInput({
        mode,
        identifier,
        path,
        title,
        content,
        frontmatter,
        tags,
        expected_version,
        if_match,
      });
      if (inputError) return jsonExpectedError(inputError);
      const reservedError = validateReservedFrontmatter(frontmatter);
      if (reservedError) return jsonExpectedError(reservedError);
      const titleError = resolveTitleFrontmatterConflict(title, frontmatter);
      if (titleError) return jsonExpectedError(titleError);
      const tagsError = resolveTagsFrontmatterConflict(tags, frontmatter);
      if (tagsError) return jsonExpectedError(tagsError);

      try {
        const supabase = supabaseManager.getClient();
        const vaultRoot = config.instance.vault.path;
        const expectedVersion = pickExpectedVersion({ expected_version, if_match });

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
          // REQ-008 lock table: write_document(create) locks destination absolutePath.
          // INV-09 order: shared destination ancestor directory locks wrap the file lock;
          // the authoritative destination existence check stays inside withDocumentLock.
          return await withAncestorDirectoryLocksShared(config, absolutePath, async () =>
            withDocumentLock(config, absolutePath, async () => {
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
                  const docType = claimEntry?.schema.documents?.types.find(
                    (type) => type.id === claim.typeId
                  );
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
              } as Record<string, unknown>;
              const { error: insertError } = await supabase
                .from('fqc_documents')
                .insert(insertPayload);
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
                  const { error: reinsertError } = await supabase
                    .from('fqc_documents')
                    .insert(insertPayload);
                  if (reinsertError) {
                    logger.warn(
                      `write_document(create): re-insert failed after stale-row cleanup for ${relativePath}: ${reinsertError.message}`
                    );
                  }
                } else {
                  logger.warn(
                    `write_document(create): fqc_documents insert failed for ${relativePath}: ${insertError.message}`
                  );
                }
              }

              const embedResult = await scheduleChangedDocumentChunks({
                config,
                supabase,
                documentId: fqcId,
                documentPath: relativePath,
                title: effectiveTitle,
                body,
                frontmatter: fm,
                logger,
              });

              return jsonToolResult(
                withWarnings(
                  buildDocumentWriteResult({
                    mode: 'create',
                    identifier: relativePath,
                    title: effectiveTitle,
                    path: relativePath,
                    fq_id: fqcId,
                    modified: now,
                    chars: body.length,
                    version_token: contentHash,
                  }),
                  [...warnings, ...embedResult.warnings]
                )
              );
            })
          );
        }

        while (true) {
          const lockCandidate = await resolveDocumentIdentifier(
            config,
            supabase,
            identifier as string,
            logger
          );
          const attempt = await withAncestorDirectoryLocksShared(
            config,
            lockCandidate.absPath,
            async () =>
              withDocumentLock(
                config,
                lockCandidate.absPath,
                async (): Promise<{ retry: true } | { retry: false; result: ToolResult }> => {
                  const resolved = await resolveDocumentIdentifier(
                    config,
                    supabase,
                    identifier as string,
                    logger
                  );
                  if (resolved.absPath !== lockCandidate.absPath) {
                    return { retry: true };
                  }
                  const rawContent = await readFile(resolved.absPath, 'utf-8');
                  const currentVersionToken = computeVersionToken(rawContent);
                  if (expectedVersion && expectedVersion !== currentVersionToken) {
                    return {
                      retry: false,
                      result: jsonExpectedError(
                        buildVersionMismatchEnvelope({
                          identifier: identifier as string,
                          versionToken: currentVersionToken,
                          targetedRegion: buildWholeDocumentTargetedRegion({
                            path: resolved.relativePath,
                            rawContent,
                          }),
                        })
                      ),
                    };
                  }
                  const parsed = matter(rawContent);
                  const existingData = parsed.data;
                  const existingBody = parsed.content;
                  const hasMutableFields =
                    content !== undefined ||
                    title !== undefined ||
                    frontmatter !== undefined ||
                    tags !== undefined;
                  const effectiveTitle =
                    title ??
                    (typeof existingData[FM.TITLE] === 'string'
                      ? (existingData[FM.TITLE] as string)
                      : resolved.relativePath);
                  if (!hasMutableFields) {
                    const fqcId =
                      typeof existingData[FM.ID] === 'string'
                        ? (existingData[FM.ID] as string)
                        : resolved.fqcId ?? '';
                    return {
                      retry: false,
                      result: jsonToolResult(
                        buildDocumentWriteResult({
                          mode: 'update',
                          identifier: identifier as string,
                          title: effectiveTitle,
                          path: resolved.relativePath,
                          fq_id: fqcId,
                          modified:
                            typeof existingData[FM.UPDATED] === 'string'
                              ? (existingData[FM.UPDATED] as string)
                              : new Date().toISOString(),
                          chars: existingBody.length,
                          version_token: currentVersionToken,
                        })
                      ),
                    };
                  }
                  const validation = validateAllTags(
                    tags ??
                      (Array.isArray(existingData[FM.TAGS])
                        ? (existingData[FM.TAGS] as string[])
                        : [])
                  );
                  if (!validation.valid) {
                    return {
                      retry: false,
                      result: jsonExpectedError({
                        error: 'invalid_input',
                        message: `Tag validation failed: ${validation.errors.join('; ')}`,
                        details: { field: 'tags' },
                      }),
                    };
                  }
                  const effectiveTags = deduplicateTags(validation.normalized);
                  const effectiveBody = content ?? existingBody;
                  const fm: Record<string, unknown> = {
                    ...existingData,
                    ...mergeWriteDocumentFrontmatter(frontmatter, effectiveTitle),
                    [FM.TAGS]: effectiveTags,
                    [FM.INSTANCE]:
                      (existingData[FM.INSTANCE] as string | undefined) ?? config.instance.id,
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
                  const preScan = await targetedScan(
                    config,
                    supabase,
                    resolved,
                    preWriteHash,
                    logger
                  );
                  const fqcId = preScan.capturedFrontmatter.fqcId;
                  fm[FM.ID] = fqcId;
                  const sanitizedFm = serializeOrderedFrontmatter(fm);
                  await vaultManager.writeMarkdown(
                    resolved.relativePath,
                    sanitizedFm,
                    effectiveBody,
                    {
                      gitAction: 'update',
                      gitTitle: effectiveTitle,
                    }
                  );
                  const postWriteRaw = await readFile(resolved.absPath, 'utf-8');
                  const postWriteHash = computeHash(postWriteRaw);

                  // Upsert rather than plain update so that write_document(mode="update") on
                  // a file that exists on disk but hasn't been scanned yet still creates the
                  // fqc_documents row. Without this, scheduleChangedDocumentChunks would receive
                  // a documentId that has no parent row and fail with an FK violation.
                  const { error: upsertError } = await supabase
                    .from('fqc_documents')
                    .upsert({
                      id: fqcId,
                      instance_id: config.instance.id,
                      path: resolved.relativePath,
                      title: effectiveTitle,
                      tags: effectiveTags,
                      content_hash: postWriteHash,
                      status: (fm[FM.STATUS] as string | undefined) ?? 'active',
                      template_meta: extractTemplateMeta(fm),
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'id' });
                  if (upsertError) {
                    logger.warn(
                      `write_document(update): fqc_documents upsert failed for ${resolved.relativePath}: ${upsertError.message}`
                    );
                  }

                  const embedResult = await scheduleChangedDocumentChunks({
                    config,
                    supabase,
                    documentId: fqcId,
                    documentPath: resolved.relativePath,
                    title: effectiveTitle,
                    body: effectiveBody,
                    frontmatter: sanitizedFm,
                    logger,
                  });

                  return {
                    retry: false,
                    result: jsonToolResult(
                      withWarnings(
                        buildDocumentWriteResult({
                          mode: 'update',
                          identifier: identifier as string,
                          title: effectiveTitle,
                          path: resolved.relativePath,
                          fq_id: fqcId,
                          modified: new Date().toISOString(),
                          chars: effectiveBody.length,
                          version_token: postWriteHash,
                        }),
                        embedResult.warnings
                      )
                    ),
                  };
                }
              )
          );
          if (!attempt.retry) return attempt.result;
        }
      } catch (err) {
        if (err instanceof LockTimeoutError) {
          return jsonExpectedError({
            error: 'conflict',
            message: err.message,
            identifier: identifier ?? path,
            details: { reason: 'lock_timeout' },
          });
        }
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
      }
    }
  );
}
