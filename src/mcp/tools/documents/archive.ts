import { z } from 'zod';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vaultManager } from '../../../storage/vault.js';
import { supabaseManager } from '../../../storage/supabase.js';
import { logger } from '../../../logging/logger.js';
import { acquireLock, releaseLock } from '../../../services/write-lock.js';
import { resolveDocumentIdentifier, targetedScan } from '../../utils/resolve-document.js';
import { getIsShuttingDown } from '../../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult, documentArchiveResult, type ErrorEnvelope } from '../../utils/response-formats.js';
import { FM } from '../../../constants/frontmatter-fields.js';
import { computeHash } from '../../../storage/document-primitives.js';
import type { DocumentToolDeps } from './deps.js';
import { isAmbiguousDocumentIdentifierError, isDocumentNotFoundError, stringField } from './helpers.js';

export function registerArchiveDocumentTool(server: McpServer, deps: DocumentToolDeps): void {
  const { config } = deps;
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
}
