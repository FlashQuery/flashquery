import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile, rename, mkdir, unlink } from 'node:fs/promises';
import { join, extname, normalize, dirname, basename, resolve } from 'node:path';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vaultManager } from '../../../storage/vault.js';
import { writeVaultFile } from '../../../storage/vault-write.js';
import { supabaseManager } from '../../../storage/supabase.js';
import { logger } from '../../../logging/logger.js';
import { LockTimeoutError, withDocumentLocks } from '../../../services/document-lock.js';
import { resolveDocumentIdentifier } from '../../utils/resolve-document.js';
import { getIsShuttingDown } from '../../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult, documentIdentification, withWarnings } from '../../utils/response-formats.js';
import { validateVaultPath } from '../../utils/path-validation.js';
import { FM } from '../../../constants/frontmatter-fields.js';
import type { DocumentToolDeps } from './deps.js';
import { isAmbiguousDocumentIdentifierError, isDocumentNotFoundError, stringField } from './helpers.js';

export function registerMoveDocumentTool(server: McpServer, deps: DocumentToolDeps): void {
  const { config } = deps;
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
          return await withDocumentLocks(config, [sourceAbsPath, normalizedDest], async () => {

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
              // Fallback: durably write dest, then delete source.
              const content = await readFile(sourceAbsPath, 'utf-8');
              await writeVaultFile(destAbsPath, content, { lockConfig: config });
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
          });
        } catch (err) {
          if (err instanceof LockTimeoutError) {
            return jsonExpectedError({
              error: 'conflict',
              message: err.message,
              identifier,
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
          logger.error(`move_document failed - ${msg}`);
          return jsonRuntimeError({ message: `Error moving document: ${msg}`, identifier });
        }
      }
    );
}
