import { z } from 'zod';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { vaultManager } from '../../../storage/vault.js';
import { supabaseManager } from '../../../storage/supabase.js';
import { embeddingProvider } from '../../../embedding/provider.js';
import { documentEmbeddingTarget, scheduleBackgroundEmbedding } from '../../../embedding/background-embed.js';
import { logger } from '../../../logging/logger.js';
import { LockTimeoutError, withDocumentLock } from '../../../services/document-lock.js';
import { validateAllTags, deduplicateTags } from '../../../utils/tag-validator.js';
import { resolveDocumentIdentifier } from '../../utils/resolve-document.js';
import { serializeOrderedFrontmatter } from '../../utils/frontmatter-sanitizer.js';
import { getIsShuttingDown } from '../../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult, documentIdentification, withWarnings } from '../../utils/response-formats.js';
import { validateVaultPath } from '../../utils/path-validation.js';
import { FM } from '../../../constants/frontmatter-fields.js';
import { extractTemplateMeta } from '../../../llm/template-meta.js';
import { computeHash } from '../../../storage/document-primitives.js';
import type { DocumentToolDeps } from './deps.js';
import { isAmbiguousDocumentIdentifierError, isDocumentNotFoundError, sanitizeFilename, stringField } from './helpers.js';

export function registerCopyDocumentTool(server: McpServer, deps: DocumentToolDeps): void {
  const { config } = deps;
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
          return await withDocumentLock(config, absPath, async () => {
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
          });
        } catch (err) {
          if (err instanceof LockTimeoutError) {
            return jsonExpectedError({
              error: 'conflict',
              message: err.message,
              identifier,
              details: { reason: 'lock_contention' },
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
          logger.error(`copy_document failed - ${msg}`);
          return jsonRuntimeError({ message: `Error copying document: ${msg}`, identifier });
        }
      }
    );
}
