import { z } from 'zod';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vaultManager } from '../../../storage/vault.js';
import { supabaseManager } from '../../../storage/supabase.js';
import { logger } from '../../../logging/logger.js';
import {
  LockTimeoutError,
  withAncestorDirectoryLocksShared,
  withDocumentLock,
} from '../../../services/document-lock.js';
import { resolveDocumentIdentifier, targetedScan } from '../../utils/resolve-document.js';
import { getIsShuttingDown } from '../../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult, documentRemovalResult, withWarnings, type ErrorEnvelope } from '../../utils/response-formats.js';
import { FM } from '../../../constants/frontmatter-fields.js';
import { computeHash } from '../../../storage/document-primitives.js';
import type { DocumentToolDeps } from './deps.js';
import { buildTrashDestination, isAmbiguousDocumentIdentifierError, isDocumentNotFoundError, resolveTrashRoot, stringField } from './helpers.js';

export function registerRemoveDocumentTool(server: McpServer, deps: DocumentToolDeps): void {
  const { config } = deps;
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
          expected_version: z.string().optional()
            .describe('Optional source file version_token precondition for opt-in conflict detection.'),
          if_match: z.string().optional()
            .describe('Alias for expected_version.'),
        },
      },
      async ({ identifiers, expected_version, if_match }) => {
        if (getIsShuttingDown()) {
          return {
            content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
            isError: true,
          };
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
              await withAncestorDirectoryLocksShared(config, resolved.absPath, async () =>
                withDocumentLock(config, resolved.absPath, async () => {
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
                })
              );
            } catch (itemErr) {
              if (itemErr instanceof LockTimeoutError) {
                results.push({
                  error: 'conflict',
                  message: itemErr.message,
                  identifier: id,
                  details: { reason: 'lock_timeout' },
                });
                continue;
              }

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
          if (err instanceof LockTimeoutError) {
            return jsonExpectedError({
              error: 'conflict',
              message: err.message,
              details: { reason: 'lock_timeout' },
            });
          }
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`remove_document failed - ${msg}`);
          return jsonRuntimeError(msg);
        }
      }
    );
}
