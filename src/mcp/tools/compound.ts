import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { supabaseManager } from '../../storage/supabase.js';
import { embeddingProvider, NullEmbeddingProvider } from '../../embedding/provider.js';
import { logger } from '../../logging/logger.js';
import { pluginManager } from '../../plugins/manager.js';
import { acquireLock, releaseLock } from '../../services/write-lock.js';
import { validateAllTags, normalizeTags, deduplicateTags } from '../../utils/tag-validator.js';
import { resolveDocumentIdentifier, targetedScan } from '../utils/resolve-document.js';
import { searchDocumentsSemantic, listMarkdownFiles, parseDocMeta } from './documents.js';
import type { DocMeta } from './documents.js';
import { searchMemoriesSemantic } from './memory.js';
import { vaultManager } from '../../storage/vault.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';
import {
  formatKeyValueEntry,
  shouldShowProgress,
  progressMessage,
  joinBatchEntries,
  formatEmptyResults,
} from '../utils/response-formats.js';
import { insertAtPosition, findHeadingOccurrence, getSectionBoundaries } from '../utils/markdown-sections.js';
import { FM } from '../../constants/frontmatter-fields.js';
import { serializeOrderedFrontmatter } from '../utils/frontmatter-sanitizer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: apply tag set operations (idempotent add, graceful remove)
// ─────────────────────────────────────────────────────────────────────────────

function applyTagChanges(existing: string[], addTags: string[], removeTags: string[]): string[] {
  const tagSet = new Set(existing);
  for (const tag of addTags) tagSet.add(tag);
  for (const tag of removeTags) tagSet.delete(tag);
  return Array.from(tagSet);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: heading extraction for replace_doc_section (local copy; markdown-utils.ts
// has an identical export but compound.ts retains its own to avoid an import cycle)
// ─────────────────────────────────────────────────────────────────────────────

interface HeadingEntry {
  level: number;
  text: string;
  line: number;
}

function extractHeadings(bodyContent: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const lines = bodyContent.split('\n');
  const HEADING_REGEX_LINE = /^(#{1,6})\s+(.+)$/;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const match = HEADING_REGEX_LINE.exec(lines[lineNum]);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim(), line: lineNum + 1 });
    }
  }
  return headings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: compute SHA-256 hash of raw file content
// ─────────────────────────────────────────────────────────────────────────────

function computeHash(rawContent: string): string {
  return createHash('sha256').update(rawContent).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration entry point
// ─────────────────────────────────────────────────────────────────────────────

export function registerCompoundTools(server: McpServer, config: FlashQueryConfig): void {
  // ─── Tool 1: append_to_doc (T2-01) ──────────────────────────────────────

  server.registerTool(
    'append_to_doc',
    {
      description:
        'Append markdown content to the end of a document. Use for adding new entries, log lines, or notes at the bottom of a file. For inserting content at a specific location (after a heading, before a section, at the top), use insert_in_doc instead. For replacing an existing section\'s content, use replace_doc_section.',
      inputSchema: {
        identifier: z
          .string()
          .describe('Document identifier — accepts any of: (1) vault-relative path (e.g., "clients/acme/notes.md"), (2) fqc_id UUID, or (3) filename (e.g., "notes.md")'),
        content: z.string().describe('Content to append (include any markdown structure such as headings)'),
      },
    },
    async ({ identifier, content }) => {
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

        // Resolve identifier to a canonical path
        const resolved = await resolveDocumentIdentifier(config, supabase, identifier, logger);

        // LOGIC-03: Validate document has valid fqcId before modifying
        if (!resolved.fqcId) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Unable to provision document. Document must have an fq_id to be modified.' }],
            isError: true,
          };
        }

        const absPath = resolved.absPath;
        const relativePath = resolved.relativePath;
        const fqcId = resolved.fqcId;

        const raw = await readFile(absPath, 'utf-8');
        const parsed = matter(raw);

        const title = (parsed.data[FM.TITLE] as string | undefined) ?? relativePath;

        // Append content — two newlines before content for clean markdown spacing
        const newBody = parsed.content + '\n\n' + content;

        // Compute hash of the new content about to be written
        const serialized = matter.stringify(newBody, parsed.data);
        const newHash = computeHash(serialized);

        // Call targetedScan to update frontmatter
        await targetedScan(config, supabase, resolved, newHash, logger);

        // Update fm with fq_id from targetedScan
        parsed.data[FM.ID] = fqcId;

        // Write back atomically via vaultManager (DCP-05)
        await vaultManager.writeMarkdown(relativePath, parsed.data, newBody);

        // LOGIC-02 (DCP-05): Read file after write to verify actual hash matches expected
        const postWriteRaw = await readFile(absPath, 'utf-8');
        const postWriteParsed = matter(postWriteRaw);
        const actualSerializedAfterWrite = matter.stringify(postWriteParsed.content, postWriteParsed.data);
        const actualHashAfterWrite = computeHash(actualSerializedAfterWrite);

        logger.info(`append_to_doc: appended content to ${relativePath}`);
        // Use actualHashAfterWrite (computed from file on disk) not newHash (pre-write computed)
        const { error: updateError } = await supabase
          .from('fqc_documents')
          .update({ content_hash: actualHashAfterWrite, updated_at: new Date().toISOString() })
          .eq('id', fqcId);

        if (updateError) {
          logger.warn(
            `append_to_doc: fqc_documents hash update failed for ${relativePath}: ${updateError.message}`
          );
        }

        // Fire-and-forget re-embedding (vault write is already synchronous)
        void embeddingProvider
          .embed(`${title}\n\n${newBody}`)
          .then((vector) =>
            supabaseManager
              .getClient()
              .from('fqc_documents')
              .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
              .eq('id', fqcId)
          )
          .catch((err) =>
            logger.warn(
              `append_to_doc: background embed failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
            )
          );

        return {
          content: [
            { type: 'text' as const, text: `Appended content to ${relativePath}` },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`append_to_doc failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 2: update_doc_header (T2-02) ──────────────────────────────────

  server.registerTool(
    'update_doc_header',
    {
      description:
        'Update frontmatter fields on a document without touching the body content. Pass a map of field names to new values. Pass null as a value to remove a field. Syncs tags to the database automatically when the tags key is included. Use this for changing metadata like title, status, or custom frontmatter fields.',
      inputSchema: {
        identifier: z
          .string()
          .describe('Document identifier — accepts any of: (1) vault-relative path (e.g., "clients/acme/notes.md"), (2) fqc_id UUID, or (3) filename (e.g., "notes.md")'),
        updates: z
          .record(z.string(), z.unknown())
          .describe('Map of frontmatter fields to update. Pass null to remove a field.'),
      },
    },
    async ({ identifier, updates }) => {
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
        const supabase = supabaseManager.getClient();

        // Resolve identifier to a canonical path
        const resolved = await resolveDocumentIdentifier(config, supabase, identifier, logger);

        const absPath = resolved.absPath;
        const relativePath = resolved.relativePath;

        const raw = await readFile(absPath, 'utf-8');
        const parsed = matter(raw);

        // Detect existing document conflicts before applying any updates (TAGS-06)
        const existingTags = Array.isArray(parsed.data[FM.TAGS]) ? parsed.data[FM.TAGS] as string[] : [];
        const existingValidation = validateAllTags(existingTags);
        if (existingValidation.conflicts.length > 1) {
          return {
            content: [{ type: 'text' as const, text:
              `Document has conflicting statuses: ${existingValidation.conflicts.join(', ')}. ` +
              `Choose one to keep by calling apply_tags with remove_tags to drop unwanted statuses.`
            }],
            isError: true,
          };
        }

        // Tag validation: if fq_tags key is in updates, validate and normalize new tags
        if (FM.TAGS in updates && Array.isArray(updates[FM.TAGS])) {
          const tagValidation = validateAllTags(updates[FM.TAGS] as string[]);
          if (!tagValidation.valid) {
            const messages = [
              ...tagValidation.errors,
              ...(tagValidation.conflicts.length > 1
                ? [`Document has conflicting statuses: ${tagValidation.conflicts.join(', ')}. Choose one to keep.`]
                : []),
            ];
            return {
              content: [{ type: 'text' as const, text: `Tag validation failed: ${messages.join('; ')}` }],
              isError: true,
            };
          }
          // Replace raw tags with deduplicated version in updates before applying (D-05a)
          updates[FM.TAGS] = deduplicateTags(tagValidation.normalized);
        }

        // Catch-all frontmatter editor — act on whatever keys are passed
        // null value = delete the key (NOT write as YAML null)
        for (const [key, value] of Object.entries(updates)) {
          if (value === null) {
            delete parsed.data[key];
          } else {
            parsed.data[key] = value;
          }
        }

        // Track whether caller explicitly requested status deletion (fq_status: null)
        // Used below to skip the D-02c guard when deletion is intentional
        const statusExplicitlyDeleted = FM.STATUS in updates && updates[FM.STATUS] === null;

        // Compute hash of the new content about to be written
        const serialized = matter.stringify(parsed.content, parsed.data);
        const newHash = computeHash(serialized);

        // Call targetedScan to update frontmatter and get fqcId
        const preScan = await targetedScan(config, supabase, resolved, newHash, logger);
        const fqcId = preScan.capturedFrontmatter.fqcId;

        // Update fm with fq_id from targetedScan
        parsed.data[FM.ID] = fqcId;

        // D-02c: If status is null/missing, make implicit 'active' explicit on write
        // Skip if caller explicitly passed { fq_status: null } to delete the key
        if (!parsed.data[FM.STATUS] && !statusExplicitlyDeleted) {
          parsed.data[FM.STATUS] = 'active';
          logger.info(`update_doc_header: document ${relativePath}: status was null, explicitly set to 'active' (D-02c)`);
        }

        // Write back atomically via vaultManager (DCP-05)
        // Apply ordering sanitizer so user fields remain first (SPEC-18)
        const sanitizedFm = serializeOrderedFrontmatter(parsed.data);
        await vaultManager.writeMarkdown(relativePath, sanitizedFm, parsed.content);

        const changedFields = Object.keys(updates).join(', ');
        logger.info(`update_doc_header: updated fields [${changedFields}] in ${relativePath}`);

        // Sync tags to Supabase fqc_documents when fq_tags key is in updates
        const updatesMap = updates;
        if (FM.TAGS in updatesMap && updatesMap[FM.TAGS] !== null && fqcId) {
          // Tags in updatesMap are already deduplicated from earlier deduplication step
          const { error: tagError } = await supabase
            .from('fqc_documents')
            .update({ tags: updatesMap[FM.TAGS] as string[], updated_at: new Date().toISOString() })
            .eq('id', fqcId);

          if (tagError) {
            logger.warn(
              `update_doc_header: fqc_documents tags sync failed for ${relativePath}: ${tagError.message}`
            );
          }
        }

        // Do NOT call embeddingProvider.embed — frontmatter-only change

        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated frontmatter fields [${changedFields}] in ${relativePath}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`update_doc_header failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );

  // ─── Tool 3: insert_doc_link (T2-03) ────────────────────────────────────

  server.registerTool(
    'insert_doc_link',
    {
      description:
        'Add a wiki-style document link ([[Target Doc]]) to a document\'s frontmatter links array. Deduplicates automatically — adding the same link twice is a no-op. Both source and target documents are resolved by path, fqc_id, or filename. Optionally specify which frontmatter property to use (default: "links"; alternatives: "related", "parent", etc.).',
      inputSchema: {
        identifier: z
          .string()
          .describe('Source document identifier — accepts UUID, vault-relative path, or filename'),
        target: z
          .string()
          .describe('Target document identifier — accepts UUID, vault-relative path, or filename. The display text for the link is derived from the resolved document title.'),
        property: z
          .string()
          .optional()
          .describe(
            'Frontmatter property to add the link to (default: "links"). Use "related", "parent", etc. for other organizational constructs.'
          ),
      },
    },
    async ({ identifier, target, property }) => {
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

        // Resolve source document
        const sourceResolved = await resolveDocumentIdentifier(config, supabase, identifier, logger);

        // Resolve target document to get its title
        const targetResolved = await resolveDocumentIdentifier(config, supabase, target, logger);

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

        // Read source document
        const raw = await readFile(sourceResolved.absPath, 'utf-8');
        const parsed = matter(raw);

        // Merge without duplication
        const existing: string[] = Array.isArray(parsed.data[targetProperty])
          ? (parsed.data[targetProperty] as string[])
          : [];
        const merged = [...new Set([...existing, wikilink])];

        parsed.data[targetProperty] = merged;

        // Compute hash of the new content about to be written
        const serialized = matter.stringify(parsed.content, parsed.data);
        const newHash = computeHash(serialized);

        // Call targetedScan to update frontmatter and get fqcId
        const preScan = await targetedScan(config, supabase, sourceResolved, newHash, logger);
        const fqcId = preScan.capturedFrontmatter.fqcId;

        // Update fm with fq_id from targetedScan
        parsed.data[FM.ID] = fqcId;

        // Write back atomically via vaultManager (DCP-05)
        await vaultManager.writeMarkdown(sourceResolved.relativePath, parsed.data, parsed.content);

        logger.info(`insert_doc_link: added ${wikilink} to ${targetProperty} in ${sourceResolved.relativePath}`);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Added document link [[${targetTitle}]] to ${targetProperty} in ${sourceResolved.relativePath}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`insert_doc_link failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 4: apply_tags (T2-04) ─────────────────────────────────────────

  server.registerTool(
    'apply_tags',
    {
      description:
        'Add or remove tags on one or more vault documents or a memory in a single call. Supports batch operations — pass multiple identifiers to tag several documents at once. Add is idempotent; removing a tag that doesn\'t exist is a silent no-op. Use this when the user wants to tag, untag, categorize, or label documents or memories.',
      inputSchema: {
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
      },
    },
    async ({ identifiers, memory_id, add_tags, remove_tags }) => {
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

        // Validate: at least one target must be provided
        if (!identifiers && !memory_id) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: At least one of identifiers or memory_id must be provided.',
              },
            ],
            isError: true,
          };
        }

        const supabase = supabaseManager.getClient();

        if (identifiers) {
          // ── Document tag update (batch-capable) ─────────────────────────
          const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
          const results: string[] = [];

          for (const id of ids) {
            try {
              // Resolve identifier
              const resolved = await resolveDocumentIdentifier(config, supabase, id, logger);

              const absPath = resolved.absPath;
              const relativePath = resolved.relativePath;

              const raw = await readFile(absPath, 'utf-8');
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
                results.push(`"${relativePath}" failed: Tag validation failed: ${messages.join('; ')}`);
                continue;
              }

              // Write back frontmatter atomically with deduplicated tags (vault-authoritative, DCP-05, D-05a)
              parsed.data[FM.TAGS] = deduplicateTags(docTagValidation.normalized);

              // Compute hash of the new content about to be written
              const serialized = matter.stringify(parsed.content, parsed.data);
              const newHash = computeHash(serialized);

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
              const postWriteParsed = matter(postWriteRaw);
              const actualSerializedAfterWrite = matter.stringify(postWriteParsed.content, postWriteParsed.data);
              const actualHashAfterWrite = computeHash(actualSerializedAfterWrite);

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

              results.push(`"${relativePath}": ${docTagValidation.normalized.join(', ') || '(none)'}`);
            } catch (itemErr) {
              const msg = itemErr instanceof Error ? itemErr.message : String(itemErr);
              results.push(`"${id}" failed: ${msg}`);
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `Updated tags:\n${results.join('\n')}`,
              },
            ],
          };
        } else {
          // ── Memory tag update ────────────────────────────────────────────
          const memoryId = memory_id as string;

          // Fetch current tags from fqc_memory
          const { data: memRow, error: fetchError } = await supabase
            .from('fqc_memory')
            .select('tags')
            .eq('id', memoryId)
            .eq('instance_id', config.instance.id)
            .single();

          if (fetchError) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Failed to fetch memory "${memoryId}": ${fetchError.message}`,
                },
              ],
              isError: true,
            };
          }

          const memData = memRow as { tags?: string[] } | null;
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
            return {
              content: [{ type: 'text' as const, text: `Tag validation failed: ${messages.join('; ')}` }],
              isError: true,
            };
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

          return {
            content: [
              {
                type: 'text' as const,
                text: `Updated tags on memory "${memoryId}": ${memTagValidation.normalized.join(', ') || '(none)'}`,
              },
            ],
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`apply_tags failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 5: get_briefing (MOD-07) ──────────────────────────────────────

  server.registerTool(
    'get_briefing',
    {
      description:
        'Get a summary of documents and memories matching specified tags. Returns document metadata (title, path, tags, fqc_id) and memory content, grouped by type. Use this when the user wants an overview of everything related to a topic — e.g. "brief me on the CRM" or "what do we have tagged \'project-alpha\'". Optionally pass a plugin_id to include plugin record counts. For full-text search, use search_all instead.' +
        'Returns document metadata and memory content scoped by tag filters. ' +
        'Optionally includes plugin records when plugin_id is provided.',
      inputSchema: {
        tags: z.array(z.string()).describe('Tags to filter by (required). Documents and memories with any/all of these tags are included.'),
        tag_match: z.enum(['any', 'all']).optional().describe('Tag matching mode: "any" = at least one tag matches, "all" = every tag must be present. Default: "any"'),
        limit: z.number().optional().describe('Maximum results per section. Default: 20'),
        plugin_id: z.string().optional().describe('Include records from this plugin. Omit to exclude plugin records.'),
      },
    },
    async ({ tags, tag_match, limit, plugin_id }) => {
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

        // ── Documents section (SPEC-14: section headers with counts, key-value blocks) ───────────
        let docQuery = supabase
          .from('fqc_documents')
          .select('id, title, tags, status, path')
          .eq('instance_id', config.instance.id)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(maxResults);

        if (matchMode === 'any') {
          docQuery = docQuery.overlaps('tags', tags);
        } else {
          docQuery = docQuery.contains('tags', tags);
        }

        const { data: docs, error: docError } = await docQuery;
        if (docError) {
          return { content: [{ type: 'text' as const, text: `Error querying documents: ${docError.message}` }], isError: true };
        }
        const docRows = (docs ?? []) as Array<{ id: string; title: string; tags: string[]; status: string; path: string }>;

        let docSectionText = `## Documents (${docRows.length})`;
        if (docRows.length > 0) {
          const docEntries = docRows.map((row) => {
            const lines = [
              formatKeyValueEntry('Title', row.title),
              formatKeyValueEntry('Path', row.path),
              formatKeyValueEntry('FQC ID', row.id),
              formatKeyValueEntry('Tags', row.tags && row.tags.length > 0 ? row.tags : 'none'),
              formatKeyValueEntry('Status', row.status),
            ];
            return lines.join('\n');
          });
          docSectionText += '\n\n' + joinBatchEntries(docEntries);
        } else {
          docSectionText += '\n\n' + formatEmptyResults('documents');
        }

        // ── Memories section (SPEC-14: section headers with counts, key-value blocks) ──────────────────────────────
        let memQuery = supabase
          .from('fqc_memory')
          .select('id, content, tags, created_at')
          .eq('instance_id', config.instance.id)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(maxResults);

        if (matchMode === 'any') {
          memQuery = memQuery.overlaps('tags', tags);
        } else {
          memQuery = memQuery.contains('tags', tags);
        }

        const { data: mems, error: memError } = await memQuery;
        if (memError) {
          return { content: [{ type: 'text' as const, text: `Error querying memories: ${memError.message}` }], isError: true };
        }
        const memRows = (mems ?? []) as Array<{ id: string; content: string; tags: string[]; created_at: string }>;

        let memSectionText = `## Memories (${memRows.length})`;
        if (memRows.length > 0) {
          const memEntries = memRows.map((m) => {
            // Truncate content to 200 chars for briefing
            const truncatedContent = m.content.length > 200 ? m.content.substring(0, 200) + '...' : m.content;
            const lines = [
              formatKeyValueEntry('Memory ID', m.id),
              formatKeyValueEntry('Content', truncatedContent),
              formatKeyValueEntry('Tags', m.tags && m.tags.length > 0 ? m.tags : 'none'),
              formatKeyValueEntry('Created', m.created_at),
            ];
            return lines.join('\n');
          });
          memSectionText += '\n\n' + joinBatchEntries(memEntries);
        } else {
          memSectionText += '\n\n' + formatEmptyResults('memories');
        }

        // ── Plugin records section (BRIEF-04) ────────────────────────────
        let pluginSectionText = '';
        if (plugin_id) {
          const allEntries = pluginManager.getAllEntries();
          const pluginEntries = allEntries.filter(e => e.plugin_id === plugin_id);

          let pluginRecordCount = 0;
          const pluginEntryTexts: string[] = [];
          if (pluginEntries.length > 0) {
            for (const entry of pluginEntries) {
              for (const tableSpec of entry.schema.tables) {
                const fullTableName = `${entry.table_prefix}${tableSpec.name}`;
                const { data: records, error: recError } = await supabase
                  .from(fullTableName)
                  .select('*')
                  .eq('instance_id', config.instance.id)
                  .order('created_at', { ascending: false })
                  .limit(maxResults);

                if (!recError && records && records.length > 0) {
                  for (const rec of records as Array<Record<string, unknown>>) {
                    pluginRecordCount++;
                    const recLines: string[] = [];
                    for (const [key, value] of Object.entries(rec)) {
                      recLines.push(formatKeyValueEntry(key, value));
                    }
                    pluginEntryTexts.push(recLines.join('\n'));
                  }
                }
              }
            }
          }

          pluginSectionText = `\n\n## Plugin Records (${pluginRecordCount})`;
          if (pluginEntryTexts.length > 0) {
            pluginSectionText += '\n\n' + joinBatchEntries(pluginEntryTexts);
          } else {
            pluginSectionText += '\n\n' + formatEmptyResults('plugin records');
          }
        }

        const text = docSectionText + '\n\n' + memSectionText + pluginSectionText;
        logger.info(`get_briefing: tags=[${tags.join(',')}] match=${matchMode} docs=${docRows.length} memories=${memRows.length}`);
        return { content: [{ type: 'text' as const, text }] };

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`get_briefing failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 7: search_all (MOD-13) ──────────────────────────────────────────

  server.registerTool(
    'search_all',
    {
      description:
        'Search across both documents and memories in a single semantic query. Returns unified, ranked results from both types with match scores. Use this when the user\'s search could match either documents or memories — e.g. "what do I know about Acme" or "find anything related to the Q2 launch". For searching only documents, use search_documents. For searching only memories, use search_memory.' +
        'Returns unified results from both entity types. Falls back to filesystem search for documents when semantic search is unavailable.',
      inputSchema: {
        query: z.string().describe('The search query'),
        tags: z.array(z.string()).optional().describe('Filter results to items with these tags.'),
        tag_match: z.enum(['any', 'all']).optional().describe(
          'How to combine multiple tags. "any" (default): items with at least one of the tags. "all": only items with every tag.'
        ),
        limit: z.number().optional().describe('Maximum results per entity type. Default: 10'),
        entity_types: z.array(z.enum(['documents', 'memories'])).optional().describe(
          'Which entity types to search. Default: both. Pass ["documents"] or ["memories"] to search only one type.'
        ),
      },
    },
    async ({ query, tags, tag_match, limit, entity_types }) => {
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
        const effectiveTypes = entity_types ?? ['documents', 'memories'];
        const useEmbedding = !(embeddingProvider instanceof NullEmbeddingProvider);
        const matchMode = tag_match ?? 'any';
        const perLimit = limit ?? 10;

        // ── Documents section (SPEC-14: section headers with counts, key-value blocks, Match%) ──────────────────────────────
        let embeddingAvailable = useEmbedding;
        let docSectionText = '';
        if (effectiveTypes.includes('documents')) {
          if (useEmbedding) {
            // Semantic search via extracted helper; fall back to filesystem on API failure
            let semanticDocs: Array<{ id: string; path: string; title: string; tags: string[]; similarity: number; created_at: string }> = [];
            try {
              semanticDocs = await searchDocumentsSemantic(config, query, {
                tags,
                tagMatch: matchMode,
                limit: perLimit,
              });
            } catch (embedErr) {
              logger.warn(`search_all: embedding unavailable, falling back to filesystem search: ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`);
              embeddingAvailable = false;
            }

            if (embeddingAvailable) {
              const semanticPaths = new Set(semanticDocs.map((d) => d.path));

              // Supplement with filesystem title/path search for newly-created documents
              // that may not yet have embeddings (fire-and-forget embed still in progress).
              const vaultRoot = config.instance.vault.path;
              const fsFiles = await listMarkdownFiles(vaultRoot, ['.md']);
              const fsMeta = (await Promise.all(fsFiles.map((f) => parseDocMeta(vaultRoot, f))))
                .filter((m): m is DocMeta => m !== null)
                .filter((m) => m.status !== 'archived' && !semanticPaths.has(m.relativePath));
              let fsFiltered = fsMeta;
              if (tags && tags.length > 0) {
                if (matchMode === 'any') {
                  fsFiltered = fsFiltered.filter((m) => m.tags.some((t) => tags.includes(t)));
                } else {
                  fsFiltered = fsFiltered.filter((m) => tags.every((t) => m.tags.includes(t)));
                }
              }
              const lq = query.toLowerCase();
              fsFiltered = fsFiltered.filter(
                (m) => m.title.toLowerCase().includes(lq) || m.relativePath.toLowerCase().includes(lq)
              );

              const semanticEntries = semanticDocs.slice(0, perLimit).map((doc) =>
                [
                  formatKeyValueEntry('Title', doc.title),
                  formatKeyValueEntry('Path', doc.path),
                  formatKeyValueEntry('Tags', doc.tags && doc.tags.length > 0 ? doc.tags : 'none'),
                  formatKeyValueEntry('FQC ID', doc.id),
                  formatKeyValueEntry('Match', `${Math.round(doc.similarity * 100)}%`),
                ].join('\n')
              );
              const remainingSlots = perLimit - semanticEntries.length;
              const fsEntries = fsFiltered.slice(0, Math.max(0, remainingSlots)).map((meta) =>
                [
                  formatKeyValueEntry('Title', meta.title),
                  formatKeyValueEntry('Path', meta.relativePath),
                  formatKeyValueEntry('Tags', meta.tags.length > 0 ? meta.tags : 'none'),
                  formatKeyValueEntry('FQC ID', meta.fqcId ?? 'unknown'),
                ].join('\n')
              );

              const allDocEntries = [...semanticEntries, ...fsEntries];
              docSectionText = `## Documents (${allDocEntries.length})`;
              if (allDocEntries.length > 0) {
                docSectionText += '\n\n' + joinBatchEntries(allDocEntries);
              } else {
                docSectionText += '\n\n' + formatEmptyResults('documents');
              }
            }
          }
          if (!embeddingAvailable) {
            // Filesystem fallback (D-04)
            const vaultRoot = config.instance.vault.path;
            const files = await listMarkdownFiles(vaultRoot, ['.md']);
            const metaResults = await Promise.all(files.map((f) => parseDocMeta(vaultRoot, f)));
            const allMeta = metaResults.filter((m): m is DocMeta => m !== null);
            let filtered = allMeta.filter((meta) => meta.status !== 'archived');

            // Tag filtering
            if (tags && tags.length > 0) {
              if (matchMode === 'any') {
                filtered = filtered.filter((meta) => meta.tags.some((t) => tags.includes(t)));
              } else {
                filtered = filtered.filter((meta) => tags.every((t) => meta.tags.includes(t)));
              }
            }

            // Query substring match on title or path
            if (query) {
              const lq = query.toLowerCase();
              filtered = filtered.filter(
                (meta) =>
                  meta.title.toLowerCase().includes(lq) ||
                  meta.relativePath.toLowerCase().includes(lq)
              );
            }

            filtered.sort((a, b) => {
              if (!a.modified && !b.modified) return 0;
              if (!a.modified) return 1;
              if (!b.modified) return -1;
              return b.modified.localeCompare(a.modified);
            });

            const results = filtered.slice(0, perLimit);
            docSectionText = `## Documents (${results.length})`;
            if (results.length > 0) {
              const docEntries = results.map((meta) => {
                const lines = [
                  formatKeyValueEntry('Title', meta.title),
                  formatKeyValueEntry('Path', meta.relativePath),
                  formatKeyValueEntry('Tags', meta.tags.length > 0 ? meta.tags : 'none'),
                  formatKeyValueEntry('FQC ID', meta.fqcId ?? 'unknown'),
                ];
                return lines.join('\n');
              });
              docSectionText += '\n\n' + joinBatchEntries(docEntries);
            } else {
              docSectionText += '\n\n' + formatEmptyResults('documents');
            }
          }
        }

        // ── Memories section (SPEC-14: section headers with counts, key-value blocks, Match%) ───────────────────────────────
        let memSectionText = '';
        if (effectiveTypes.includes('memories')) {
          if (!embeddingAvailable) {
            // D-05: memories-only with no embedding (or API unreachable) = isError: true
            if (!effectiveTypes.includes('documents')) {
              return {
                content: [{
                  type: 'text' as const,
                  text: 'Memory search requires semantic embeddings (no API key configured). Configure an embedding provider to search memories.',
                }],
                isError: true,
              };
            }
            // Mixed with no embedding = omit memories section with note (isError: false)
            memSectionText = '\n\n## Memories (0)\n\nMemory search requires embedding configuration. Use list_memories for tag-based memory browsing.';
          } else {
            let mems: Array<{ id: string; content: string; tags: string[]; similarity: number; created_at: string }> = [];
            try {
              mems = await searchMemoriesSemantic(config, query, {
                tags,
                tagMatch: matchMode,
                limit: perLimit,
              });
            } catch (embedErr) {
              logger.warn(`search_all: memory embedding unavailable: ${embedErr instanceof Error ? embedErr.message : String(embedErr)}`);
              memSectionText = '\n\n## Memories (0)\n\nMemory search requires embedding configuration. Use list_memories for tag-based memory browsing.';
            }
            if (memSectionText === '') {
              memSectionText = `\n\n## Memories (${mems.length})`;
              if (mems.length > 0) {
                const memEntries = mems.map((mem) => {
                  const truncatedContent = mem.content.length > 200 ? mem.content.substring(0, 200) + '...' : mem.content;
                  const lines = [
                    formatKeyValueEntry('Content', truncatedContent),
                    formatKeyValueEntry('Memory ID', mem.id),
                    formatKeyValueEntry('Tags', mem.tags && mem.tags.length > 0 ? mem.tags : 'none'),
                    formatKeyValueEntry('Match', `${Math.round(mem.similarity * 100)}%`),
                    formatKeyValueEntry('Created', mem.created_at),
                  ];
                  return lines.join('\n');
                });
                memSectionText += '\n\n' + joinBatchEntries(memEntries);
              } else {
                memSectionText += '\n\n' + formatEmptyResults('memories');
              }
            }
          }
        }

        const text = docSectionText + memSectionText;
        logger.info(`search_all: query="${query}" types=[${effectiveTypes.join(',')}] match=${matchMode}`);
        return { content: [{ type: 'text' as const, text }] };

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`search_all failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool 9: insert_in_doc (SPEC-03) ───────────────────────────────────────

  server.registerTool(
    'insert_in_doc',
    {
      description:
        'Insert markdown content at a specific position in a document: after a heading, at the end of a section, before a heading, at the top, or at the bottom. Use this for adding entries to a specific section (e.g. logging a new CRM interaction under "## Interactions"), prepending content to a document, or inserting between sections. For appending to the very end of a file, this replaces append_to_doc with more precise placement control.',
      inputSchema: {
        identifier: z
          .string()
          .describe('Document identifier (vault-relative path, fqc_id UUID, or filename)'),
        heading: z
          .string()
          .optional()
          .describe('Anchor heading name (required for after_heading, before_heading, end_of_section modes)'),
        position: z
          .enum(['top', 'bottom', 'after_heading', 'before_heading', 'end_of_section'])
          .describe('Where to insert content'),
        content: z
          .string()
          .describe('Markdown content to insert (not including the heading itself)'),
        occurrence: z
          .number()
          .optional()
          .default(1)
          .describe('Which occurrence of heading if multiple match same name (1-indexed, default: 1)'),
      },
    },
    async ({ identifier, heading, position, content: insertContent, occurrence }) => {
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
        const validPositions = ['top', 'bottom', 'after_heading', 'before_heading', 'end_of_section'];
        if (!validPositions.includes(position)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Invalid position "${position}"; must be one of: ${validPositions.join(', ')}`,
              },
            ],
            isError: true,
          };
        }

        // Resolve document identifier
        const resolved = await resolveDocumentIdentifier(
          config,
          supabaseManager.getClient(),
          identifier,
          logger
        );

        // Read file
        const rawContent = await readFile(resolved.absPath, 'utf-8');
        const parsed = matter(rawContent);
        const { data: frontmatter, content: body } = parsed;

        // Insert content at specified position
        let modifiedBody: string;
        try {
          modifiedBody = insertAtPosition(body, position, insertContent, heading, occurrence);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Insertion failed: ${msg}` }],
            isError: true,
          };
        }

        // Write back to file (atomic via vaultManager)
        const relativePath = resolved.relativePath;
        await vaultManager.writeMarkdown(relativePath, frontmatter, modifiedBody, {
          gitAction: 'update',
          gitTitle: `Insert in document at ${position}`,
        });

        // Trigger fire-and-forget embedding
        const docTitle = typeof frontmatter[FM.TITLE] === 'string' ? frontmatter[FM.TITLE] as string : relativePath;
        void (async () => {
          try {
            const vector = await embeddingProvider.embed(`${docTitle}\n\n${modifiedBody}`);
            const fqcId = typeof frontmatter[FM.ID] === 'string' ? frontmatter[FM.ID] as string : undefined;
            if (fqcId) {
              await supabaseManager
                .getClient()
                .from('fqc_documents')
                .update({
                  embedding: JSON.stringify(vector),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', fqcId);
            }
          } catch (err) {
            logger.warn(
              `insert_in_doc: embedding failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })();

        // Return confirmation
        const preview = insertContent.split('\n').slice(0, 3).join('\n');
        const lines = [
          formatKeyValueEntry('Inserted at', `${position} heading "${heading || 'N/A'}"`),
          formatKeyValueEntry('Location', `Line ${heading ? 'near heading' : 'at document'}`),
          formatKeyValueEntry('Content preview', preview),
          formatKeyValueEntry('Embedding', 'queued'),
        ];

        logger.info(`insert_in_doc: path="${relativePath}" position="${position}" heading="${heading || 'N/A'}"`);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`insert_in_doc failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ─── Tool: replace_doc_section (SPEC-02) ────────────────────────────────────

  server.registerTool(
    'replace_doc_section',
    {
      description:
        'Replace the content of a specific heading section in a document, leaving all other sections untouched. Identify the section by heading name and optionally by occurrence number if the heading appears more than once. Use include_subheadings to control whether child sections are included in the replacement. Use this when the user wants to rewrite, update, or overwrite a specific part of a document without touching the rest.' +
        'The heading line is preserved; only the section body is replaced. ' +
        'Use include_subheadings to control whether nested content is included.',
      inputSchema: {
        identifier: z.string().describe('Document path, fqc_id, or filename'),
        heading: z.string().describe('Heading text to match (case-sensitive)'),
        content: z.string().describe('New markdown content for section body (does not include heading line)'),
        include_subheadings: z.boolean().optional().describe('When true, replace full section including nested headings; when false, preserve child headings (default: true)'),
        occurrence: z.number().optional().describe('Which occurrence if heading appears multiple times (1-indexed, default: 1)'),
      },
    },
    async ({ identifier, heading, content, include_subheadings = true, occurrence = 1 }) => {
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
        const supabase = supabaseManager.getClient();

        // Step 1: Resolve document identifier
        const resolved = await resolveDocumentIdentifier(config, supabase, identifier, logger);

        // Step 2: Read document
        const document = await vaultManager.readMarkdown(resolved.relativePath);
        const bodyContent = document.content;
        const lines = bodyContent.split('\n');

        // Step 3: Extract headings
        const headings = extractHeadings(bodyContent);

        // Step 4: Validate heading exists
        if (headings.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Document has no headings. Use update_document to replace entire content, or add a heading first.`,
              },
            ],
            isError: true,
          };
        }

        // Step 5: Find target heading by name and occurrence
        // Uses markdown-sections.ts utilities (consistent with SPEC-01 get_document sections, SPEC-03 insert_in_doc)
        const targetHeading = findHeadingOccurrence(headings, heading, occurrence);

        if (!targetHeading) {
          const matches = headings.filter((h) => h.text === heading);
          if (matches.length > 0) {
            const matchList = matches.map((m, idx) => `  - Occurrence ${idx + 1} at line ${m.line}`).join('\n');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Heading "${heading}" appears ${matches.length} time(s). Specify occurrence parameter (1-${matches.length}):\n${matchList}`,
                },
              ],
              isError: true,
            };
          }

          const availableHeadings = headings.map((h) => `  - "${h.text}" at line ${h.line}`).join('\n');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Heading "${heading}" not found. Available headings:\n${availableHeadings}`,
              },
            ],
            isError: true,
          };
        }

        // Step 6: Calculate section boundaries using shared utility
        const boundaries = getSectionBoundaries(bodyContent, heading, include_subheadings, occurrence);
        const startLine = boundaries.startLine;
        const endLine = boundaries.endLine;

        // Step 7: Extract old section content (for undo)
        const oldSectionLines = lines.slice(startLine - 1, endLine); // startLine is 1-indexed; convert for slice
        const oldContent = oldSectionLines.join('\n');

        // Step 8: Build new content
        const newLines = [
          ...lines.slice(0, startLine - 1),        // Everything before heading
          ...lines.slice(startLine - 1, startLine), // The heading line itself
          ...content.split('\n'),                    // New section body
          ...lines.slice(endLine),                   // Everything after old section
        ];

        const newContent = newLines.join('\n');

        // Step 10: Write atomically
        await vaultManager.writeMarkdown(resolved.relativePath, document.data, newContent);

        // Step 9 (post-write): Read actual written file bytes to compute accurate hash
        // Hash MUST match raw file bytes (consistent with seedDocument and append_to_doc patterns).
        // Do NOT re-serialize via matter.stringify — that can produce different byte sequences.
        const postWriteRaw = await readFile(resolved.absPath, 'utf-8');
        const newHash = computeHash(postWriteRaw);

        // Step 11: Update database
        if (resolved.fqcId) {
          await supabase
            .from('fqc_documents')
            .update({
              content_hash: newHash,
              updated_at: new Date().toISOString(),
            })
            .eq('id', resolved.fqcId)
            .eq('instance_id', config.instance.id);

          // Step 12: Fire-and-forget re-embedding
          const docTitle = typeof document.data[FM.TITLE] === 'string' ? document.data[FM.TITLE] as string : resolved.relativePath;
          void embeddingProvider
            .embed(`${docTitle}\n\n${newContent}`)
            .then((vector) =>
              supabaseManager
                .getClient()
                .from('fqc_documents')
                .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
                .eq('id', resolved.fqcId!)
            )
            .catch((err) =>
              logger.warn(
                `replace_doc_section: background embed failed for ${resolved.relativePath}: ${err instanceof Error ? err.message : String(err)}`
              )
            );
        }

        // Step 13: Build response
        const responseLines: string[] = [
          `Section "${heading}" replaced successfully.`,
          '',
          formatKeyValueEntry('Line range', `${startLine}-${endLine}`),
          formatKeyValueEntry('New hash', newHash),
        ];

        if (resolved.fqcId) {
          responseLines.push(formatKeyValueEntry('Document ID', resolved.fqcId));
        }

        responseLines.push('', 'Old section content (for undo if needed):', oldContent);

        return { content: [{ type: 'text' as const, text: responseLines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`replace_doc_section failed: ${msg}`);
        return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
      } finally {
        if (config.locking.enabled) {
          await releaseLock(supabaseManager.getClient(), config.instance.id, 'documents');
        }
      }
    }
  );
}

