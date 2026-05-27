import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getResolvedHostToolExposure } from '../../config/loader.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider, NullEmbeddingProvider } from '../../embedding/provider.js';
import {
  documentEmbeddingTarget,
  scheduleBackgroundEmbedding,
} from '../../embedding/background-embed.js';
import { logger } from '../../logging/logger.js';
import { pluginManager } from '../../plugins/manager.js';
import {
  LockTimeoutError,
  withAncestorDirectoryLocksShared,
  withDocumentLock,
} from '../../services/document-lock.js';
import { validateAllTags, normalizeTags, deduplicateTags } from '../../utils/tag-validator.js';
import { resolveDocumentIdentifier, targetedScan } from '../utils/resolve-document.js';
import { AmbiguousDocumentIdentifierError, DocumentNotFoundError } from '../utils/resolve-document.js';
import { searchDocumentsSemantic, listMarkdownFiles, parseDocMeta } from './documents.js';
import type { DocMeta } from './documents.js';
import { searchMemoriesSemantic } from './memory.js';
import { vaultManager } from '../../storage/vault.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  jsonToolResult,
  documentIdentification,
  type ErrorEnvelope,
  memoryIdentification,
  recordIdentification,
  withWarnings,
} from '../utils/response-formats.js';
import {
  insertAtPosition,
  findMatchingHeadings,
  getSectionBoundaries,
  resolveHeadingTarget,
} from '../utils/markdown-sections.js';
import { extractHeadings } from '../utils/markdown-utils.js';
import { getToolMetadata } from '../tool-metadata.js';
import { FM } from '../../constants/frontmatter-fields.js';
import {
  mergeSearchResults,
  resolveSearchIntent,
  type SearchResultItem,
} from '../utils/search-results.js';
import {
  buildVersionMismatchEnvelope,
  computeVersionToken,
  pickExpectedVersion,
} from '../utils/document-version.js';

type HeadingMatchInput = {
  heading?: string;
  heading_match?: 'contains' | 'exact';
  heading_level?: number;
  occurrence?: number;
  include_nested?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: apply tag set operations (idempotent add, graceful remove)
// ─────────────────────────────────────────────────────────────────────────────

function applyTagChanges(existing: string[], addTags: string[], removeTags: string[]): string[] {
  const tagSet = new Set(existing);
  for (const tag of addTags) tagSet.add(tag);
  for (const tag of removeTags) tagSet.delete(tag);
  return Array.from(tagSet);
}

function memoryCategoryEnabled(config: FlashQueryConfig): boolean {
  const selectors = config.hostMcpTools?.tools;
  const excludedSelectors = new Set(config.hostMcpTools?.excludedTools ?? []);
  if (selectors === undefined) {
    return true;
  }
  if (selectors.some((selector) => selector === 'tier:read-only' || selector === 'tier:read-write' || selector === 'category:memory')) {
    return true;
  }
  if (selectors.some((selector) => getToolMetadata(selector)?.categories.includes('memory') === true)) {
    return true;
  }

  const enabledToolNames = new Set(getResolvedHostToolExposure(config).hostEnabledToolNames);
  const memoryOnlyTools = ['write_memory', 'get_memory', 'archive_memory'];
  return memoryOnlyTools.some((toolName) => enabledToolNames.has(toolName) && !excludedSelectors.has(toolName));
}

function documentCategoryEnabled(config: FlashQueryConfig): boolean {
  const selectors = config.hostMcpTools?.tools;
  if (selectors === undefined) return true;
  if (selectors.some((selector) => selector === 'tier:read-only' || selector === 'tier:read-write' || selector === 'category:doc-read' || selector === 'category:doc-write')) {
    return true;
  }
  if (selectors.some((selector) => getToolMetadata(selector)?.categories.some((category) => category === 'doc-read' || category === 'doc-write') === true)) {
    return true;
  }
  return getResolvedHostToolExposure(config).hostEnabledToolNames.includes('get_document');
}

function pluginCategoryEnabled(config: FlashQueryConfig): boolean {
  const selectors = config.hostMcpTools?.tools;
  if (selectors === undefined) return true;
  if (selectors.some((selector) => selector === 'category:plugin')) return true;
  if (selectors.some((selector) => getToolMetadata(selector)?.categories.includes('plugin') === true)) return true;
  return getResolvedHostToolExposure(config).hostEnabledToolNames.some((toolName) =>
    getToolMetadata(toolName)?.categories.includes('plugin') === true
  );
}

function documentResolutionError(err: unknown, identifier: string): Record<string, unknown> {
  if (err instanceof AmbiguousDocumentIdentifierError) {
    return {
      error: 'ambiguous_identifier',
      message: err.message,
      identifier,
      details: { matches: err.matches },
    };
  }
  if (err instanceof DocumentNotFoundError) {
    return {
      error: 'not_found',
      message: `No document matches identifier '${identifier}'`,
      identifier,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    error: 'runtime_error',
    message,
    identifier,
  };
}

function lockTimeoutError(err: LockTimeoutError, identifier?: string): ErrorEnvelope {
  return {
    error: 'conflict',
    message: err.message,
    ...(identifier ? { identifier } : {}),
    details: { reason: 'lock_timeout' },
  };
}

function headingErrorMatches(matches: Array<{ text: string; level: number; line: number; occurrence: number }>): Array<{
  heading: string;
  level: number;
  line: number;
  occurrence: number;
}> {
  return matches.map((match) => ({
    heading: match.text,
    level: match.level,
    line: match.line,
    occurrence: match.occurrence,
  }));
}

function frontmatterTargetedRegion(rawContent: string): Record<string, unknown> {
  return {
    kind: 'frontmatter',
    frontmatter: matter(rawContent).data,
  };
}

function sectionTargetedRegion(
  body: string,
  input: Required<Pick<HeadingMatchInput, 'heading'>> & HeadingMatchInput
): Record<string, unknown> {
  const heading = input.heading;
  const options = {
    headingMatch: input.heading_match ?? 'contains',
    headingLevel: input.heading_level,
  };
  const matches = findMatchingHeadings(body, heading, options);
  const resolved = resolveHeadingTarget(matches, input.occurrence);
  if (resolved.status !== 'matched') {
    return { not_found: true };
  }
  const occurrence = input.occurrence ?? resolved.heading.occurrence;
  const boundaries = getSectionBoundaries(
    body,
    heading,
    input.include_nested ?? true,
    occurrence,
    options
  );
  return {
    kind: 'section',
    heading: resolved.heading.text,
    level: resolved.heading.level,
    body: boundaries.content,
    extracted_sections: [{ heading: resolved.heading.text, chars: boundaries.content.length }],
  };
}

function insertTargetedRegion(rawContent: string, input: HeadingMatchInput): Record<string, unknown> {
  const parsed = matter(rawContent);
  if (!input.heading) {
    return {
      kind: 'document_end',
      body: '',
    };
  }
  return sectionTargetedRegion(parsed.content, {
    heading: input.heading,
    heading_match: input.heading_match,
    heading_level: input.heading_level,
    occurrence: input.occurrence,
    include_nested: input.include_nested,
  });
}

function versionMismatchResult(input: {
  identifier: string;
  currentRaw: string;
  targetedRegion: Record<string, unknown>;
}) {
  return jsonExpectedError(
    buildVersionMismatchEnvelope({
      identifier: input.identifier,
      versionToken: computeVersionToken(input.currentRaw),
      targetedRegion: input.targetedRegion,
    })
  );
}

function versionMismatchPayload(input: {
  identifier: string;
  currentRaw: string;
  targetedRegion: Record<string, unknown>;
}): ErrorEnvelope {
  return buildVersionMismatchEnvelope({
    identifier: input.identifier,
    versionToken: computeVersionToken(input.currentRaw),
    targetedRegion: input.targetedRegion,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration entry point
// ─────────────────────────────────────────────────────────────────────────────

export function registerCompoundTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool 3: insert_doc_link (T2-03) ────────────────────────────────────

  server.registerTool(
    'insert_doc_link',
    {
      description:
        'Transitional macro-dependent helper retained until call_macro parity: add a wiki-style document link ([[Target Doc]]) to one or more source documents and return ordered JSON document identification results. Deduplicates automatically and returns status:"unchanged" per source when the link already exists. Resolve the single target by target_identifier and sources by identifiers. Optionally specify which frontmatter property to use (default: "links"; alternatives: "related", "parent", etc.). Removal gate: call_macro must cover this workflow before this transitional tool is removed.',
      inputSchema: {
        identifiers: z
          .union([z.string(), z.array(z.string())])
          .describe('Source document identifier or identifiers — each accepts UUID, vault-relative path, or filename'),
        target_identifier: z
          .string()
          .describe('Target document identifier — accepts UUID, vault-relative path, or filename. The display text for the link is derived from the resolved document title.'),
        property: z
          .string()
          .optional()
          .describe(
            'Frontmatter property to add the link to (default: "links"). Use "related", "parent", etc. for other organizational constructs.'
          ),
        expected_version: z.string().optional().describe('Optional version_token expected for the source document bytes before writing.'),
        if_match: z.string().optional().describe('Alias for expected_version.'),
      },
    },
    async ({ identifiers, target_identifier, property, expected_version, if_match }) => {
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
        const targetProperty = property ?? 'links';
        const sourceIdentifiers = Array.isArray(identifiers) ? identifiers : [identifiers];

        let targetResolved: Awaited<ReturnType<typeof resolveDocumentIdentifier>>;
        try {
          targetResolved = await resolveDocumentIdentifier(config, supabase, target_identifier, logger);
        } catch (targetErr) {
          const envelope = documentResolutionError(targetErr, target_identifier);
          return jsonExpectedError({
            error: envelope.error === 'ambiguous_identifier' ? 'ambiguous_identifier' : 'not_found',
            message: String(envelope.message),
            identifier: target_identifier,
            details: envelope.details as Record<string, unknown> | undefined,
          });
        }

        // Get target title from frontmatter
        let targetTitle: string;
        try {
          const targetRaw = await readFile(targetResolved.absPath, 'utf-8');
          const targetParsed = matter(targetRaw);
          targetTitle = (targetParsed.data[FM.TITLE] as string | undefined) ?? targetResolved.relativePath;
        } catch {
          // Fall back to relative path as display text
          targetTitle = targetResolved.relativePath;
        }

        // Build wikilink string using resolved title
        const wikilink = `[[${targetTitle}]]`;
        const results: Array<Record<string, unknown>> = [];
        const expectedVersion = pickExpectedVersion({ expected_version, if_match });

        for (const sourceIdentifier of sourceIdentifiers) {
          try {
            const sourceResolved = await resolveDocumentIdentifier(config, supabase, sourceIdentifier, logger);
            const conflict = await withAncestorDirectoryLocksShared(config, sourceResolved.absPath, async () =>
              withDocumentLock(config, sourceResolved.absPath, async () => {
            const raw = await readFile(sourceResolved.absPath, 'utf-8');
            if (expectedVersion && expectedVersion !== computeVersionToken(raw)) {
              return versionMismatchPayload({
                identifier: sourceIdentifier,
                currentRaw: raw,
                targetedRegion: frontmatterTargetedRegion(raw),
              });
            }
            const parsed = matter(raw);

            const existing: string[] = Array.isArray(parsed.data[targetProperty])
              ? (parsed.data[targetProperty] as string[])
              : [];
            const alreadyLinked = existing.includes(wikilink);
            parsed.data[targetProperty] = [...new Set([...existing, wikilink])];

            const serialized = matter.stringify(parsed.content, parsed.data);
            const newHash = computeVersionToken(serialized);
            const preScan = await targetedScan(config, supabase, sourceResolved, newHash, logger);
            const fqcId = preScan.capturedFrontmatter.fqcId;
            parsed.data[FM.ID] = fqcId;

            await vaultManager.writeMarkdown(sourceResolved.relativePath, parsed.data, parsed.content);
            const postWriteRaw = await readFile(sourceResolved.absPath, 'utf-8');
            const versionToken = computeVersionToken(postWriteRaw);
            if (fqcId) {
              const { error: hashUpdateError } = await supabase
                .from('fqc_documents')
                .update({ content_hash: versionToken, updated_at: new Date().toISOString() })
                .eq('id', fqcId)
                .eq('instance_id', config.instance.id);
              if (hashUpdateError) {
                throw new Error(`Supabase link update failed for ${sourceResolved.relativePath}: ${hashUpdateError.message}`);
              }
            }

            logger.info(`insert_doc_link: ${alreadyLinked ? 'unchanged' : 'added'} ${wikilink} in ${sourceResolved.relativePath}`);
            results.push({
              ...documentIdentification({
                identifier: sourceIdentifier,
                title: typeof parsed.data[FM.TITLE] === 'string' ? parsed.data[FM.TITLE] as string : sourceResolved.relativePath,
                path: sourceResolved.relativePath,
                fq_id: fqcId,
                modified: typeof parsed.data[FM.UPDATED] === 'string' ? parsed.data[FM.UPDATED] as string : new Date().toISOString(),
                chars: parsed.content.length,
                version_token: versionToken,
              }),
              status: alreadyLinked ? 'unchanged' : 'updated',
              property: targetProperty,
              link: wikilink,
              target: {
                identifier: target_identifier,
                fq_id: targetResolved.fqcId,
                path: targetResolved.relativePath,
                title: targetTitle,
              },
            });
            return null;
              })
            );
            if (conflict) {
              if (sourceIdentifiers.length === 1) return jsonExpectedError(conflict);
              results.push(conflict);
            }
          } catch (sourceErr) {
            if (sourceErr instanceof LockTimeoutError) {
              results.push(lockTimeoutError(sourceErr, sourceIdentifier));
              continue;
            }
            results.push(documentResolutionError(sourceErr, sourceIdentifier));
          }
        }

        return jsonToolResult({
          results,
          removal_gate: 'call_macro parity',
        });
      } catch (err) {
        if (err instanceof LockTimeoutError) {
          return jsonExpectedError(lockTimeoutError(err));
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`insert_doc_link failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // ─── Tool 4: apply_tags (T2-04) ─────────────────────────────────────────

  server.registerTool(
    'apply_tags',
    {
      description:
        'Add or remove tags on ordered document and memory targets in a single call. Pass targets: [{ entity_type, identifier }] to tag explicit documents or memories. Add is idempotent; removing a tag that does not exist is a silent no-op.',
      inputSchema: {
        targets: z
          .array(z.object({
            entity_type: z.enum(['document', 'memory']),
            identifier: z.string(),
            expected_version: z.string().optional(),
            if_match: z.string().optional(),
          }))
          .optional()
          .describe('Ordered targets to tag. Each target declares document or memory explicitly.'),
        identifiers: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'One or more document identifiers — each can be a vault-relative path, fqc_id UUID, or filename. Use this OR memory_id.'
          ),
        memory_id: z
          .string()
          .optional()
          .describe('UUID of the memory to tag. Use this OR identifiers.'),
        add_tags: z.array(z.string()).optional().describe('Tags to add (idempotent)'),
        remove_tags: z
          .array(z.string())
          .optional()
          .describe('Tags to remove (silent no-op if not present)'),
        expected_version: z.string().optional().describe('Optional version_token expected for document targets before writing.'),
        if_match: z.string().optional().describe('Alias for expected_version.'),
      },
    },
    async ({ targets, identifiers, memory_id, add_tags, remove_tags, expected_version, if_match }) => {
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
        // Normalize inputs so remove_tags matches existing normalized tags (e.g., " Status " matches "status")
        const addTags: string[] = normalizeTags(Array.isArray(add_tags) ? add_tags : []);
        const removeTags: string[] = normalizeTags(Array.isArray(remove_tags) ? remove_tags : []);

        const normalizedTargets = targets ??
          (identifiers
            ? (Array.isArray(identifiers) ? identifiers : [identifiers]).map((id) => ({ entity_type: 'document' as const, identifier: id }))
            : memory_id
              ? [{ entity_type: 'memory' as const, identifier: memory_id }]
              : []);

        if (normalizedTargets.length === 0) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'targets is required',
            details: { field: 'targets' },
          });
        }
        if (addTags.length === 0 && removeTags.length === 0) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'At least one of add_tags or remove_tags is required',
            details: { requires: ['add_tags', 'remove_tags'] },
          });
        }

        const supabase = supabaseManager.getClient();
        const canUseMemoryTargets = memoryCategoryEnabled(config);
        const results: Array<Record<string, unknown>> = [];

        for (const target of normalizedTargets) {
          if (target.entity_type === 'document') {
            const id = target.identifier;
            const expectedVersion = pickExpectedVersion({
              expected_version: ('expected_version' in target ? target.expected_version : undefined) ?? expected_version,
              if_match: ('if_match' in target ? target.if_match : undefined) ?? if_match,
            });
            try {
              // Resolve identifier
              const resolved = await resolveDocumentIdentifier(config, supabase, id, logger);
              const conflict = await withAncestorDirectoryLocksShared(config, resolved.absPath, async () =>
                withDocumentLock(config, resolved.absPath, async () => {

              const absPath = resolved.absPath;
              const relativePath = resolved.relativePath;

              const raw = await readFile(absPath, 'utf-8');
              if (expectedVersion && expectedVersion !== computeVersionToken(raw)) {
                return versionMismatchPayload({
                  identifier: id,
                  currentRaw: raw,
                  targetedRegion: frontmatterTargetedRegion(raw),
                });
              }
              const parsed = matter(raw);

              // Get existing tags (idempotent add, graceful remove)
              const existing: string[] = Array.isArray(parsed.data[FM.TAGS])
                ? (parsed.data[FM.TAGS] as string[])
                : [];
              const newTags = applyTagChanges(existing, addTags, removeTags);

              // Validate final tag set after applying changes (TAGS-02, TAGS-03)
              const docTagValidation = validateAllTags(newTags);
              if (!docTagValidation.valid) {
                const messages = [
                  ...docTagValidation.errors,
                  ...(docTagValidation.conflicts.length > 1
                    ? [`Document has conflicting statuses: ${docTagValidation.conflicts.join(', ')}. Choose one to keep.`]
                    : []),
                ];
                results.push({
                  error: 'invalid_input',
                  message: `Tag validation failed: ${messages.join('; ')}`,
                  identifier: id,
                  details: { field: 'tags' },
                });
                return;
              }

              // Write back frontmatter atomically with deduplicated tags (vault-authoritative, DCP-05, D-05a)
              parsed.data[FM.TAGS] = deduplicateTags(docTagValidation.normalized);

              // Compute hash of the new content about to be written
              const serialized = matter.stringify(parsed.content, parsed.data);
              const newHash = computeVersionToken(serialized);

              // Call targetedScan to update frontmatter and get fqcId
              const preScan = await targetedScan(config, supabase, resolved, newHash, logger);
              const fqcId = preScan.capturedFrontmatter.fqcId;

              // Update fm with fq_id from targetedScan
              parsed.data[FM.ID] = fqcId;

              // D-02c: If status is null/missing, make implicit 'active' explicit on write
              if (!parsed.data[FM.STATUS]) {
                parsed.data[FM.STATUS] = 'active';
                logger.info(`apply_tags: document ${relativePath}: status was null, explicitly set to 'active' (D-02c)`);
              }

              await vaultManager.writeMarkdown(relativePath, parsed.data, parsed.content);

              // LOGIC-02 (DCP-05): Read file after write to verify actual hash
              const postWriteRaw = await readFile(absPath, 'utf-8');
              const actualHashAfterWrite = computeVersionToken(postWriteRaw);

              logger.info(`apply_tags: updated tags on document ${relativePath} (${docTagValidation.normalized.length} tags)`);

              // Sync to Supabase fqc_documents with deduplicated tags
              const dedupTagsForSync = deduplicateTags(docTagValidation.normalized);
              if (fqcId) {
                const { error: updateError } = await supabase
                  .from('fqc_documents')
                  .update({ tags: dedupTagsForSync, content_hash: actualHashAfterWrite, updated_at: new Date().toISOString() })
                  .eq('id', fqcId)
                  .eq('instance_id', config.instance.id);

                if (updateError) {
                  logger.warn(
                    `apply_tags: fqc_documents tags sync failed for ${relativePath}: ${updateError.message}`
                  );
                }
              }

              results.push({
                ...documentIdentification({
                  identifier: id,
                  title: typeof parsed.data[FM.TITLE] === 'string' ? parsed.data[FM.TITLE] as string : relativePath,
                  path: relativePath,
                  fq_id: fqcId,
                  modified: typeof parsed.data[FM.UPDATED] === 'string' ? parsed.data[FM.UPDATED] as string : new Date().toISOString(),
                  chars: parsed.content.length,
                  version_token: actualHashAfterWrite,
                }),
                tags: dedupTagsForSync,
                entity_type: 'document',
              });
              return null;
                })
              );
              if (conflict) {
                if (normalizedTargets.length === 1) return jsonExpectedError(conflict);
                results.push(conflict);
              }
            } catch (itemErr) {
              if (itemErr instanceof LockTimeoutError) {
                results.push(lockTimeoutError(itemErr, id));
                continue;
              }
              const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
              results.push({
                error: msg.toLowerCase().includes('not found') ? 'not_found' : 'runtime_error',
                message: msg,
                identifier: id,
              });
            }
            continue;
          }

          const memoryId = target.identifier;
          if (!canUseMemoryTargets) {
            results.push({
              error: 'unsupported',
              message: 'Memory category is disabled by config',
              identifier: memoryId,
              details: { disabled_category: 'memory' },
            });
            continue;
          }

          // Fetch current tags from fqc_memory
          const { data: memRow, error: fetchError } = await supabase
            .from('fqc_memory')
            .select('content,tags,plugin_scope,created_at,updated_at')
            .eq('id', memoryId)
            .eq('instance_id', config.instance.id)
            .single();

          if (fetchError) {
            results.push({
              error: 'not_found',
              message: `Failed to fetch memory "${memoryId}": ${fetchError.message}`,
              identifier: memoryId,
            });
            continue;
          }

          const memData = memRow as {
            content?: string | null;
            tags?: string[];
            plugin_scope?: string | null;
            created_at?: string | null;
            updated_at?: string | null;
          } | null;
          const existing: string[] = Array.isArray(memData?.tags) ? memData.tags : [];
          const newTags = applyTagChanges(existing, addTags, removeTags);

          // Validate final tag set after applying changes (TAGS-02, TAGS-03)
          const memTagValidation = validateAllTags(newTags);
          if (!memTagValidation.valid) {
            const messages = [
              ...memTagValidation.errors,
              ...(memTagValidation.conflicts.length > 1
                ? [`Memory has conflicting statuses: ${memTagValidation.conflicts.join(', ')}. Choose one to keep.`]
                : []),
            ];
            results.push({
              error: 'invalid_input',
              message: `Tag validation failed: ${messages.join('; ')}`,
              identifier: memoryId,
              details: { field: 'tags' },
            });
            continue;
          }

          // Update fqc_memory.tags with deduplicated tags (memories have no vault file — D-13, D-05a)
          const dedupMemTags = deduplicateTags(memTagValidation.normalized);
          const { error: updateError } = await supabase
            .from('fqc_memory')
            .update({ tags: dedupMemTags, updated_at: new Date().toISOString() })
            .eq('id', memoryId)
            .eq('instance_id', config.instance.id);

          if (updateError) {
            logger.warn(
              `apply_tags: fqc_memory tags update failed for ${memoryId}: ${updateError.message}`
            );
          }

          logger.info(`apply_tags: updated tags on memory ${memoryId} (${memTagValidation.normalized.length} tags)`);

          results.push({
            ...memoryIdentification({
              memory_id: memoryId,
              content_preview: typeof memData?.content === 'string' ? memData.content.slice(0, 120) : '',
              tags: dedupMemTags,
              plugin_scope: memData?.plugin_scope ?? 'global',
              created_at: memData?.created_at ?? '',
              updated_at: new Date().toISOString(),
            }),
            entity_type: 'memory',
          });
        }

        return jsonToolResult(results);
      } catch (err) {
        if (err instanceof LockTimeoutError) {
          return jsonExpectedError(lockTimeoutError(err));
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`apply_tags failed: ${msg}`);
        return jsonRuntimeError({ message: `Error applying tags: ${msg}` });
      }
    }
  );

  // ─── Tool 5: get_briefing (MOD-07) ──────────────────────────────────────

  server.registerTool(
    'get_briefing',
    {
      description:
        'Transitional macro-dependent helper retained until call_macro parity: get structured JSON groups of documents and memories matching specified tags. Use this when the user wants an overview of everything related to a topic. Optionally pass plugin_id to include plugin record counts. For full-text search, use search instead. Removal gate: call_macro must cover this workflow before this transitional tool is removed.',
      inputSchema: {
        tags: z.array(z.string()).describe('Tags to filter by (required). Documents and memories with any/all of these tags are included.'),
        tag_match: z.enum(['any', 'all']).optional().describe('Tag matching mode: "any" = at least one tag matches, "all" = every tag must be present. Default: "any"'),
        limit: z.number().optional().describe('Maximum results per section. Default: 20'),
        entity_types: z.array(z.enum(['documents', 'memories', 'records'])).optional().describe('Entity domains to include. Default: enabled documents and memories, plus records when plugin_id is provided.'),
        plugin_id: z.string().optional().describe('Include records from this plugin. Omit to exclude plugin records.'),
      },
    },
    async ({ tags, tag_match, limit, entity_types, plugin_id }) => {
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
        const matchMode = tag_match ?? 'any';
        const maxResults = limit ?? 20;
        const supabase = supabaseManager.getClient();
        const enabled = {
          documents: documentCategoryEnabled(config),
          memories: memoryCategoryEnabled(config),
          records: pluginCategoryEnabled(config),
        };
        const explicitEntityTypes = Array.isArray(entity_types) && entity_types.length > 0;
        const requestedEntityTypes = explicitEntityTypes
          ? entity_types
          : ([
              ...(enabled.documents ? ['documents' as const] : []),
              ...(enabled.memories ? ['memories' as const] : []),
              ...(plugin_id && enabled.records ? ['records' as const] : []),
            ]);
        const warnings: string[] = [];
        const activeEntityTypes = requestedEntityTypes.filter((entityType) => {
          if (enabled[entityType]) return true;
          if (explicitEntityTypes) {
            const disabledCategory = entityType === 'records'
              ? 'plugin'
              : entityType === 'memories'
                ? 'memory'
                : 'document';
            warnings.push(`${disabledCategory}_category_disabled`);
          }
          return false;
        });

        if (requestedEntityTypes.length > 0 && activeEntityTypes.length === 0) {
          return jsonExpectedError({
            error: 'unsupported',
            message: 'All requested briefing entity types are disabled by config',
            identifier: requestedEntityTypes.join(','),
            details: { disabled_entity_types: requestedEntityTypes },
          });
        }

        const docItemsByTag = new Map<string, Array<Record<string, unknown>>>(tags.map((tag) => [tag, []]));
        if (activeEntityTypes.includes('documents')) {
          let docQuery = supabase
            .from('fqc_documents')
            .select('id, title, tags, status, path, updated_at')
            .eq('instance_id', config.instance.id)
            .eq('status', 'active')
            .order('updated_at', { ascending: false })
            .limit(maxResults);

          docQuery = matchMode === 'any' ? docQuery.overlaps('tags', tags) : docQuery.contains('tags', tags);
          const { data: docs, error: docError } = await docQuery;
          if (docError) return jsonRuntimeError(`Error querying documents: ${docError.message}`);

          for (const row of (docs ?? []) as Array<{ id: string; title: string; tags: string[]; status: string; path: string; updated_at?: string }>) {
            const meta = await parseDocMeta(config.instance.vault.path, row.path);
            const item = {
              entity_type: 'document',
              ...documentIdentification({
                identifier: row.path,
                title: row.title,
                path: row.path,
                fq_id: row.id,
                modified: meta?.modified ?? row.updated_at ?? new Date().toISOString(),
                chars: meta?.size.chars ?? 0,
              }),
            };
            for (const tag of tags) {
              if (row.tags?.includes(tag)) docItemsByTag.get(tag)?.push(item);
            }
          }
        }

        const memoryItemsByTag = new Map<string, Array<Record<string, unknown>>>(tags.map((tag) => [tag, []]));
        if (activeEntityTypes.includes('memories')) {
          let memQuery = supabase
            .from('fqc_memory')
            .select('id, content, tags, plugin_scope, created_at, updated_at')
            .eq('instance_id', config.instance.id)
            .eq('status', 'active')
            .eq('is_latest', true)
            .order('updated_at', { ascending: false })
            .limit(maxResults);

          memQuery = matchMode === 'any' ? memQuery.overlaps('tags', tags) : memQuery.contains('tags', tags);
          const { data: mems, error: memError } = await memQuery;
          if (memError) return jsonRuntimeError(`Error querying memories: ${memError.message}`);

          for (const row of (mems ?? []) as Array<{ id: string; content: string; tags: string[]; plugin_scope?: string | null; created_at: string; updated_at: string }>) {
            const item = {
              entity_type: 'memory',
              ...memoryIdentification({
                memory_id: row.id,
                content_preview: row.content.length > 120 ? `${row.content.slice(0, 117)}...` : row.content,
                tags: row.tags ?? [],
                plugin_scope: row.plugin_scope ?? 'global',
                created_at: row.created_at,
                updated_at: row.updated_at,
              }),
            };
            for (const tag of tags) {
              if (row.tags?.includes(tag)) memoryItemsByTag.get(tag)?.push(item);
            }
          }
        }

        const recordItemsByTag = new Map<string, Array<Record<string, unknown>>>(tags.map((tag) => [tag, []]));
        if (activeEntityTypes.includes('records')) {
          const allEntries = pluginManager.getAllEntries();
          const pluginEntries = plugin_id ? allEntries.filter((entry) => entry.plugin_id === plugin_id) : allEntries;
          let sawTaggableTable = false;
          for (const entry of pluginEntries) {
            for (const tableSpec of entry.schema.tables) {
              const tagColumn = tableSpec.columns.some((column) => column.name === 'tags')
                ? 'tags'
                : tableSpec.columns.some((column) => column.name === 'tag')
                  ? 'tag'
                  : null;
              if (!tagColumn) continue;
              sawTaggableTable = true;
              const fullTableName = `${entry.table_prefix}${tableSpec.name}`;
              let recordQuery = supabase
                .from(fullTableName)
                .select('*')
                .eq('instance_id', config.instance.id)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(maxResults);
              recordQuery = tagColumn === 'tags'
                ? (matchMode === 'any' ? recordQuery.overlaps(tagColumn, tags) : recordQuery.contains(tagColumn, tags))
                : recordQuery.in(tagColumn, tags);
              const { data: records, error: recError } = await recordQuery;
              if (recError) {
                logger.warn(`get_briefing taggable query failed for ${fullTableName}: ${recError.message}`);
                continue;
              }
              for (const rec of (records ?? []) as Array<Record<string, unknown>>) {
                const recTags = Array.isArray(rec[tagColumn]) ? rec[tagColumn] as string[] : [rec[tagColumn]].filter((tag): tag is string => typeof tag === 'string');
                const item = {
                  entity_type: 'record',
                  ...recordIdentification({
                    id: typeof rec.id === 'string' ? rec.id : '',
                    plugin_id: entry.plugin_id,
                    table: tableSpec.name,
                    created_at: typeof rec.created_at === 'string' ? rec.created_at : '',
                    updated_at: typeof rec.updated_at === 'string' ? rec.updated_at : '',
                  }),
                };
                for (const tag of tags) {
                  if (recTags.includes(tag)) {
                    recordItemsByTag.get(tag)?.push(item);
                  }
                }
              }
            }
          }
          if (explicitEntityTypes && requestedEntityTypes.includes('records') && !sawTaggableTable) {
            warnings.push('plugin_no_taggable_tables');
          }
        }

        const groups = tags.map((tag) => ({
          type: 'tag',
          tag,
          items: [
            ...(docItemsByTag.get(tag) ?? []),
            ...(memoryItemsByTag.get(tag) ?? []),
            ...(recordItemsByTag.get(tag) ?? []),
          ].slice(0, maxResults),
        }));

        logger.info(`get_briefing: tags=[${tags.join(',')}] match=${matchMode} entity_types=${activeEntityTypes.join(',')}`);
        return jsonToolResult({
          generated_at: new Date().toISOString(),
          entity_types: activeEntityTypes,
          tags,
          tag_match: matchMode,
          limit: maxResults,
          removal_gate: 'call_macro parity',
          ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
          groups,
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_briefing failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  server.registerTool(
    'search',
    {
      description:
        'Search documents and memories through one unified result list. Use this when you need to find notes or memories by title/path/tags, semantic meaning, or a mixed search that combines both.\n\nUse entity_types to narrow to documents, memories, or both. Use mode: "filesystem" for title/path/tag matching, mode: "semantic" for embedding search, and mode: "mixed" when you want both; mixed is the default. Use an empty query with tags or path_filter for list-mode, or list_all: true when you intentionally want an unfiltered listing.\n\nDo not use this for literal body grep, regex, or line-range search; those belong in macro/string operations. Do not use domain-specific legacy search surfaces; use this tool with entity_types instead.\n\nExample: search({ "query": "planning", "entity_types": ["documents", "memories"], "mode": "mixed", "limit": 10 })',
      inputSchema: {
        query: z.string().optional().describe('Search query. Empty query requires filters or list_all:true.'),
        mode: z.enum(['filesystem', 'semantic', 'mixed']).optional().describe('Search mode. Default: mixed.'),
        tags: z.array(z.string()).optional().describe('Filter by tags.'),
        tag_match: z.enum(['any', 'all']).optional().describe('Tag matching mode. Default: any.'),
        limit: z.number().optional().describe('Global result limit after merge/dedupe/sort. Default: 10.'),
        entity_types: z.array(z.enum(['documents', 'memories'])).optional().describe('Search domains. Default: enabled searchable domains.'),
        list_all: z.boolean().optional().describe('Allow empty unfiltered list-mode search.'),
        path_filter: z.string().optional().describe('Document path substring filter for filesystem/list searches.'),
        include_archived: z.boolean().optional().describe('Include archived documents and memories. Default: false.'),
        body_contains: z.unknown().optional().describe('Unsupported deferred literal body-search parameter; use macro/string operations instead.'),
        body_regex: z.unknown().optional().describe('Unsupported deferred literal body-search parameter; use macro/string operations instead.'),
        regex: z.unknown().optional().describe('Unsupported deferred literal body-search parameter; use macro/string operations instead.'),
        line_range: z.unknown().optional().describe('Unsupported deferred literal body-search parameter; use macro/string operations instead.'),
        lines: z.unknown().optional().describe('Unsupported deferred literal body-search parameter; use macro/string operations instead.'),
        byte_range: z.unknown().optional().describe('Unsupported deferred literal body-search parameter; use macro/string operations instead.'),
      },
    },
    async (params) => {
      const { tags, tag_match, path_filter, include_archived } = params;
      if (getIsShuttingDown()) {
        return jsonRuntimeError('Server is shutting down; new requests cannot be processed');
      }

      const enabled = {
        documents: documentCategoryEnabled(config),
        memories: memoryCategoryEnabled(config),
      };
      const intentResult = resolveSearchIntent(
        params,
        enabled
      );
      if (intentResult.error) {
        return jsonExpectedError(intentResult.error);
      }
      const intent = intentResult.intent!;
      const warnings = [...intentResult.warnings];
      const matchMode = tag_match ?? 'any';
      const allResults: SearchResultItem[] = [];

      try {
        if (intent.entity_types.includes('documents')) {
          const vaultRoot = config.instance.vault.path;
          const canSemantic = !(embeddingProvider instanceof NullEmbeddingProvider);
          if ((intent.requested_mode === 'semantic' || intent.requested_mode === 'mixed') && intent.query && canSemantic) {
            try {
	              const docs = await searchDocumentsSemantic(config, intent.query, {
	                tags,
	                tagMatch: matchMode,
	                limit: intent.limit,
	                includeArchived: include_archived === true,
	              });
	              const semanticResults = await Promise.all(docs.map(async (doc) => {
	                const meta = await parseDocMeta(config.instance.vault.path, doc.path);
	                return {
	                  entity_type: 'document' as const,
	                  identifier: doc.path,
	                  title: doc.title,
	                  path: doc.path,
	                  fq_id: doc.id,
	                  tags: doc.tags,
	                  modified: meta?.modified ?? doc.created_at,
	                  size: meta?.size ?? { chars: 0 },
	                  score: doc.similarity,
	                  match_source: ['semantic' as const],
	                };
	              }));
	              allResults.push(...semanticResults);
            } catch (err) {
              warnings.push('embedding_unavailable');
              if (intent.requested_mode === 'semantic') {
                return jsonExpectedError({
                  error: 'unsupported',
                  message: 'Semantic document search is unavailable',
                  identifier: 'documents',
                  details: { reason: err instanceof Error ? err.message : String(err) },
                });
              }
            }
          } else if (intent.requested_mode === 'semantic' && !canSemantic) {
            return jsonExpectedError({
              error: 'unsupported',
              message: 'Semantic document search is unavailable',
              identifier: 'documents',
              details: { reason: 'embedding_unavailable' },
            });
          }

          if (intent.requested_mode === 'filesystem' || intent.requested_mode === 'mixed' || intent.list_mode) {
            const files = await listMarkdownFiles(vaultRoot, config.instance.vault.markdownExtensions);
            const metaResults = await Promise.all(files.map((file) => parseDocMeta(vaultRoot, file)));
            let docs = metaResults
              .filter((meta): meta is DocMeta => meta !== null)
              .filter((meta) => include_archived === true || meta.status !== 'archived');
            if (path_filter) {
              docs = docs.filter((meta) => meta.relativePath.toLowerCase().includes(String(path_filter).toLowerCase()));
            }
            if (tags && tags.length > 0) {
              docs = matchMode === 'all'
                ? docs.filter((meta) => tags.every((tag) => meta.tags.includes(tag)))
                : docs.filter((meta) => meta.tags.some((tag) => tags.includes(tag)));
            }
            if (intent.query) {
              const lowerQuery = intent.query.toLowerCase();
              docs = docs.filter((meta) => meta.title.toLowerCase().includes(lowerQuery) || meta.relativePath.toLowerCase().includes(lowerQuery));
            }
            allResults.push(...docs.map((doc) => ({
              entity_type: 'document' as const,
              identifier: doc.relativePath,
              title: doc.title,
              path: doc.relativePath,
              fq_id: doc.fqcId ?? doc.relativePath,
              tags: doc.tags,
              modified: doc.modified,
              size: doc.size,
              match_source: [intent.list_mode ? 'list' as const : 'filesystem' as const],
            })));
          }
        }

        if (intent.entity_types.includes('memories')) {
          const canSemantic = !(embeddingProvider instanceof NullEmbeddingProvider);
          if ((intent.requested_mode === 'semantic' || intent.requested_mode === 'mixed') && intent.query && canSemantic) {
            try {
	              const memories = await searchMemoriesSemantic(config, intent.query, {
	                tags,
	                tagMatch: matchMode,
	                limit: intent.limit,
	                includeArchived: include_archived === true,
	              });
              allResults.push(...memories.map((memory) => ({
                entity_type: 'memory' as const,
                identifier: memory.id,
                memory_id: memory.id,
                content_preview: memory.content.length > 120 ? `${memory.content.slice(0, 117)}...` : memory.content,
                tags: memory.tags,
                plugin_scope: memory.plugin_scope ?? 'global',
                created_at: memory.created_at,
                updated_at: memory.updated_at,
                score: memory.similarity,
                match_source: ['semantic' as const],
              })));
            } catch (err) {
              warnings.push('embedding_unavailable');
              if (intent.requested_mode === 'semantic') {
                return jsonExpectedError({
                  error: 'unsupported',
                  message: 'Semantic memory search is unavailable',
                  identifier: 'memories',
                  details: { reason: err instanceof Error ? err.message : String(err) },
                });
              }
            }
          } else if (intent.requested_mode === 'semantic' && !canSemantic) {
            return jsonExpectedError({
              error: 'unsupported',
              message: 'Semantic memory search is unavailable',
              identifier: 'memories',
              details: { reason: 'embedding_unavailable' },
            });
          }

          if (intent.requested_mode === 'filesystem' || intent.requested_mode === 'mixed' || intent.list_mode) {
            let dbQuery = supabaseManager.getClient()
              .from('fqc_memory')
              .select('id, content, tags, plugin_scope, created_at, updated_at, is_latest, archived_at')
              .eq('instance_id', config.instance.id)
              .eq('is_latest', true);
            if (include_archived !== true) {
              dbQuery = dbQuery.eq('status', 'active');
            }
            if (tags && tags.length > 0) {
              dbQuery = matchMode === 'all' ? dbQuery.contains('tags', tags) : dbQuery.overlaps('tags', tags);
            }
            const { data, error } = await dbQuery;
            if (error) throw new Error(error.message);
            let memories = (data ?? []) as Array<{ id: string; content: string; tags: string[]; plugin_scope: string | null; created_at: string; updated_at: string; is_latest: boolean; archived_at: string | null }>;
            if (intent.query) {
              const lowerQuery = intent.query.toLowerCase();
              memories = memories.filter((memory) => memory.content.toLowerCase().includes(lowerQuery));
            }
            allResults.push(...memories.map((memory) => ({
              entity_type: 'memory' as const,
              identifier: memory.id,
              memory_id: memory.id,
              content_preview: memory.content.length > 120 ? `${memory.content.slice(0, 117)}...` : memory.content,
              tags: memory.tags,
              plugin_scope: memory.plugin_scope ?? 'global',
              created_at: memory.created_at,
              updated_at: memory.updated_at,
              ...(intent.list_mode ? {} : { match_source: ['filesystem' as const] }),
              is_latest: memory.is_latest,
              archived_at: memory.archived_at,
            })));
          }
        }

        const results = mergeSearchResults(allResults, intent.limit);
        return jsonToolResult({
          query: intent.query,
          entity_types: intent.entity_types,
          mode: intent.mode,
          total: results.length,
          ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
          results,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`search failed: ${msg}`);
        return jsonRuntimeError(msg);
      }
    }
  );

  // ─── Tool 9: insert_in_doc (SPEC-03) ───────────────────────────────────────

  server.registerTool(
    'insert_in_doc',
    {
      description:
        'Insert markdown content at top, bottom, before a heading, after a heading, or at the end of a section. Anchor matching supports heading_match, heading_level, occurrence, and include_nested for markdown-aware placement.',
      inputSchema: {
        identifier: z
          .string()
          .describe('Document identifier (vault-relative path, fqc_id UUID, or filename)'),
        heading: z
          .string()
          .optional()
          .describe('Anchor heading name (required for after_heading, before_heading, end_of_section modes)'),
        position: z
          .enum(['top', 'bottom', 'end', 'after_heading', 'before_heading', 'end_of_section'])
          .describe('Where to insert content'),
        content: z
          .string()
          .describe('Markdown content to insert (not including the heading itself)'),
        occurrence: z
          .number()
          .optional()
          .describe('Which occurrence of heading if multiple match same name (1-indexed). Omit only when the heading query resolves to one match.'),
        include_nested: z
          .boolean()
          .optional()
          .describe('For end_of_section only: true includes child sections, false inserts before the first child heading.'),
        heading_match: z.enum(['contains', 'exact']).optional(),
        heading_level: z.number().optional().describe('Optional markdown heading level filter (1-6).'),
        expected_version: z.string().optional().describe('Optional version_token expected for the document before writing.'),
        if_match: z.string().optional().describe('Alias for expected_version.'),
      },
    },
    async ({ identifier, heading, position, content: insertContent, occurrence, include_nested, heading_match, heading_level, expected_version, if_match }) => {
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
        // Validate position
        const validPositions = ['top', 'bottom', 'end', 'after_heading', 'before_heading', 'end_of_section'];
        if (!validPositions.includes(position)) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: `Invalid position "${position}"; must be one of: ${validPositions.join(', ')}`,
            details: { field: 'position' },
          });
        }
        if (
          (position === 'top' || position === 'bottom' || position === 'end') &&
          (heading || heading_level !== undefined || include_nested !== undefined || heading_match !== undefined || occurrence !== undefined)
        ) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: `${position} does not accept heading, occurrence, heading_match, heading_level, or include_nested`,
            details: { field: 'position' },
          });
        }

         // Resolve document identifier
         const resolved = await resolveDocumentIdentifier(
           config,
           supabaseManager.getClient(),
           identifier,
           logger
         );
         return await withAncestorDirectoryLocksShared(config, resolved.absPath, async () =>
           withDocumentLock(config, resolved.absPath, async () => {

        // Read file
        const rawContent = await readFile(resolved.absPath, 'utf-8');
        const expectedVersion = pickExpectedVersion({ expected_version, if_match });
        if (expectedVersion && expectedVersion !== computeVersionToken(rawContent)) {
          return versionMismatchResult({
            identifier,
            currentRaw: rawContent,
            targetedRegion: insertTargetedRegion(rawContent, {
              heading,
              heading_match,
              heading_level,
              occurrence,
              include_nested,
            }),
          });
        }
        const parsed = matter(rawContent);
        const { data: frontmatter, content: body } = parsed;
        const effectivePosition = position === 'end' ? 'bottom' : position;

        // Insert content at specified position
        let modifiedBody: string;
        if (heading && effectivePosition !== 'top' && effectivePosition !== 'bottom') {
          const matches = findMatchingHeadings(body, heading, {
            headingMatch: heading_match ?? 'contains',
            headingLevel: heading_level,
          });
          const resolution = resolveHeadingTarget(matches, occurrence);
          if (resolution.status === 'ambiguous') {
            return jsonExpectedError({
              error: 'ambiguous_identifier',
              message: `Heading query "${heading}" matched multiple headings; provide occurrence to choose one.`,
              identifier,
              details: { heading, matches: resolution.matches },
            });
          }
          if (resolution.status === 'not_found') {
            return jsonExpectedError({
              error: 'not_found',
              message: `Heading "${heading}" not found`,
              identifier,
              details: { heading, matches: headingErrorMatches(matches) },
            });
          }
        }
        try {
          modifiedBody = insertAtPosition(body, effectivePosition, insertContent, heading, occurrence ?? 1, include_nested ?? true, {
            headingMatch: heading_match ?? 'contains',
            headingLevel: heading_level,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return jsonExpectedError({
            error: msg.toLowerCase().includes('not found') ? 'not_found' : 'invalid_input',
            message: `Insertion failed: ${msg}`,
            identifier,
            details: { heading },
          });
        }

        // Write back to file (atomic via vaultManager)
        const relativePath = resolved.relativePath;
        await vaultManager.writeMarkdown(relativePath, frontmatter, modifiedBody, {
          gitAction: 'update',
          gitTitle: `Insert in document at ${position}`,
        });
        const postWriteRaw = await readFile(resolved.absPath, 'utf-8');
        const postWriteHash = computeVersionToken(postWriteRaw);
        const fqcId = typeof frontmatter[FM.ID] === 'string' ? frontmatter[FM.ID] as string : resolved.fqcId;
        if (fqcId) {
          const { error: hashUpdateError } = await supabaseManager
            .getClient()
            .from('fqc_documents')
            .update({
              content_hash: postWriteHash,
              updated_at: new Date().toISOString(),
            })
            .eq('id', fqcId)
            .eq('instance_id', config.instance.id);
          if (hashUpdateError) {
            throw new Error(`Supabase insert update failed for ${relativePath}: ${hashUpdateError.message}`);
          }
        }

        const docTitle = typeof frontmatter[FM.TITLE] === 'string' ? frontmatter[FM.TITLE] as string : relativePath;
        const embedResult = fqcId
          ? await scheduleBackgroundEmbedding({
              target: documentEmbeddingTarget({
                instanceId: config.instance.id,
                id: fqcId,
                label: relativePath,
              }),
              embedText: `${docTitle}\n\n${modifiedBody}`,
              provider: embeddingProvider,
              supabase: supabaseManager.getClient(),
            })
          : { warnings: [] };

        logger.info(`insert_in_doc: path="${relativePath}" position="${position}" heading="${heading || 'N/A'}"`);

         return jsonToolResult(withWarnings({
          ...documentIdentification({
            identifier,
            title: docTitle,
            path: relativePath,
            fq_id: typeof frontmatter[FM.ID] === 'string' ? frontmatter[FM.ID] as string : resolved.fqcId ?? '',
            modified: typeof frontmatter[FM.UPDATED] === 'string' ? frontmatter[FM.UPDATED] as string : new Date().toISOString(),
            chars: modifiedBody.length,
            version_token: postWriteHash,
          }),
          ...(effectivePosition === 'top' || effectivePosition === 'bottom'
            ? {}
            : {
                inserted_at: {
                  position: effectivePosition,
                  ...(heading ? { heading } : {}),
                  heading_match: heading_match ?? 'contains',
                  ...(heading_level !== undefined ? { heading_level } : {}),
                  occurrence: occurrence ?? 1,
                  include_nested: include_nested ?? true,
                },
              }),
         }, embedResult.warnings));
           })
         );
       } catch (err) {
        if (err instanceof LockTimeoutError) {
          return jsonExpectedError(lockTimeoutError(err, identifier));
        }
        const msg = err instanceof Error ? err.message : String(err);
         logger.error(`insert_in_doc failed: ${msg}`);
         return jsonRuntimeError({ message: `Error inserting in document: ${msg}`, identifier });
       }
     }
   );

  // ─── Tool: replace_doc_section (SPEC-02) ────────────────────────────────────

  server.registerTool(
    'replace_doc_section',
    {
      description:
        'Replace or delete a specific markdown heading section in a document. Identify the section by heading plus optional heading_match, heading_level, occurrence, and include_nested. Non-empty content preserves the heading line and replaces the section body; empty content deletes the heading and section.',
      inputSchema: {
        identifier: z.string().describe('Document path, fqc_id, or filename'),
        heading: z.string().describe('Heading text to match, case-insensitive by default'),
        content: z.string().describe('New markdown content for section body (does not include heading line)'),
        include_nested: z.boolean().optional().default(true).describe('When true, replace full section including nested headings; when false, preserve child headings (default: true)'),
        heading_match: z.enum(['contains', 'exact']).optional(),
        heading_level: z.number().optional().describe('Optional markdown heading level filter (1-6).'),
        occurrence: z.number().optional().describe('Which occurrence if heading appears multiple times (1-indexed). Omit only when the heading query resolves to one match.'),
        expected_version: z.string().optional().describe('Optional version_token expected for the document before writing.'),
        if_match: z.string().optional().describe('Alias for expected_version.'),
      },
    },
    async ({ identifier, heading, content, include_nested = true, heading_match, heading_level, occurrence, expected_version, if_match }) => {
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

        // Step 1: Resolve document identifier
        const resolved = await resolveDocumentIdentifier(config, supabase, identifier, logger);
        return await withAncestorDirectoryLocksShared(config, resolved.absPath, async () =>
          withDocumentLock(config, resolved.absPath, async () => {

        // Step 2: Read document bytes inside the lock, then parse from that fresh snapshot.
        const rawContent = await readFile(resolved.absPath, 'utf-8');
        const parsedDocument = matter(rawContent);
        const document = { data: parsedDocument.data, content: parsedDocument.content };
        const expectedVersion = pickExpectedVersion({ expected_version, if_match });
        const bodyContent = document.content;
        if (expectedVersion && expectedVersion !== computeVersionToken(rawContent)) {
          return versionMismatchResult({
            identifier,
            currentRaw: rawContent,
            targetedRegion: sectionTargetedRegion(bodyContent, {
              heading,
              heading_match,
              heading_level,
              occurrence,
              include_nested,
            }),
          });
        }
        const lines = bodyContent.split('\n');

        // Step 3: Extract headings
        const headings = extractHeadings(bodyContent);

        // Step 4: Validate heading exists
        if (headings.length === 0) {
          return jsonExpectedError({
            error: 'not_found',
            message: 'Document has no headings',
            identifier,
            details: { heading },
          });
        }

        // Step 5: Find target heading by name and occurrence
        // Uses markdown-sections.ts utilities (consistent with SPEC-01 get_document sections, SPEC-03 insert_in_doc)
        const matchOptions = {
          headingMatch: heading_match ?? 'contains',
          headingLevel: heading_level,
        };
        const matches = findMatchingHeadings(headings, heading, matchOptions);
        const resolvedHeading = resolveHeadingTarget(matches, occurrence);

        if (resolvedHeading.status === 'ambiguous') {
          return jsonExpectedError({
            error: 'ambiguous_identifier',
            message: `Heading query "${heading}" matched multiple headings; provide occurrence to choose one.`,
            identifier,
            details: { heading, matches: resolvedHeading.matches },
          });
        }

        if (resolvedHeading.status === 'not_found') {
          return jsonExpectedError({
            error: 'not_found',
            message: `Heading "${heading}" not found`,
            identifier,
            details: {
              heading,
              matches: headingErrorMatches(matches),
              available_headings: headings.map((h) => ({ heading: h.text, level: h.level, line: h.line })),
            },
          });
        }
        const targetHeading = resolvedHeading.heading;
        const targetOccurrence = occurrence ?? 1;

        // Step 6: Calculate section boundaries using shared utility
        const boundaries = getSectionBoundaries(bodyContent, heading, include_nested, targetOccurrence, matchOptions);
        const startLine = boundaries.startLine;
        const endLine = boundaries.endLine;

        // Step 7: Extract old section content (for undo)
        const oldSectionLines = lines.slice(startLine, endLine); // Exclude heading line; startLine is 1-indexed.
        const oldContent = oldSectionLines.join('\n');

        const headingRemoved = content === '';
        const newLines = headingRemoved
          ? [
              ...lines.slice(0, startLine - 1),
              ...lines.slice(endLine),
            ]
          : [
              ...lines.slice(0, startLine - 1),
              ...lines.slice(startLine - 1, startLine),
              ...content.split('\n'),
              ...lines.slice(endLine),
            ];

        const newContent = newLines.join('\n');

        // Step 10: Write atomically
        await vaultManager.writeMarkdown(resolved.relativePath, document.data, newContent);

        // Step 9 (post-write): Read actual written file bytes to compute accurate hash
        // Hash MUST match raw file bytes (consistent with seedDocument and append_to_doc patterns).
        // Do NOT re-serialize via matter.stringify — that can produce different byte sequences.
        const postWriteRaw = await readFile(resolved.absPath, 'utf-8');
        const newHash = computeVersionToken(postWriteRaw);

        // Step 11: Update database
        let embeddingWarnings: string[] = [];
        if (resolved.fqcId) {
          const { data: updatedRow, error: sectionUpdateError } = await supabase
            .from('fqc_documents')
            .update({
              content_hash: newHash,
              updated_at: new Date().toISOString(),
            })
            .eq('id', resolved.fqcId)
            .eq('instance_id', config.instance.id)
            .select('id')
            .maybeSingle();
          if (sectionUpdateError) {
            throw new Error(`Supabase section update failed for ${resolved.relativePath}: ${sectionUpdateError.message}`);
          }
          if (!updatedRow) {
            throw new Error(`Supabase section update affected no document row for ${resolved.relativePath}`);
          }

          const docTitle = typeof document.data[FM.TITLE] === 'string' ? document.data[FM.TITLE] as string : resolved.relativePath;
          const embedResult = await scheduleBackgroundEmbedding({
            target: documentEmbeddingTarget({
              instanceId: config.instance.id,
              id: resolved.fqcId,
              label: resolved.relativePath,
            }),
            embedText: `${docTitle}\n\n${newContent}`,
            provider: embeddingProvider,
            supabase: supabaseManager.getClient(),
          });
          embeddingWarnings = embedResult.warnings;
        }

        const docTitle = typeof document.data[FM.TITLE] === 'string' ? document.data[FM.TITLE] as string : resolved.relativePath;
        return jsonToolResult(withWarnings({
          ...documentIdentification({
            identifier,
            title: docTitle,
            path: resolved.relativePath,
            fq_id: resolved.fqcId ?? '',
            modified: typeof document.data[FM.UPDATED] === 'string' ? document.data[FM.UPDATED] as string : new Date().toISOString(),
            chars: newContent.length,
            version_token: newHash,
          }),
          extracted_section: {
            heading: targetHeading.text,
            level: targetHeading.level,
            old_content_length: oldContent.length,
            new_content_length: content.length,
            include_nested,
            heading_removed: headingRemoved,
          },
          heading_match: heading_match ?? 'contains',
          ...(heading_level !== undefined ? { heading_level } : {}),
        }, embeddingWarnings));
          })
        );
      } catch (err) {
        if (err instanceof LockTimeoutError) {
          return jsonExpectedError({
            error: 'conflict',
            message: err.message,
            identifier,
            details: { reason: 'lock_timeout' },
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`replace_doc_section failed: ${msg}`);
        return jsonRuntimeError({ message: `Error replacing document section: ${msg}`, identifier });
      }
    }
  );
}
