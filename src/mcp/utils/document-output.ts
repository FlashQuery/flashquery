/**
 * Document output envelope builders for the consolidated get_document MCP tool.
 * Reusable from non-MCP code paths (Phase 109 reference resolver).
 *
 * Pattern (Phase 107):
 * - Always-present metadata envelope (identifier, title, path, fq_id, modified, size)
 * - Optional fields per `include` parameter (body, frontmatter, headings, extracted_sections)
 * - resolveTitle uses fq_title with filename-basename fallback (GDOC-03)
 * - validateParameterCombinations runs before any I/O (Error 9)
 *
 * Phase 109: DocumentRequestError and resolveAndBuildDocument added (I/O functions extracted
 * from documents.ts so reference-resolver.ts can import the document-fetching pipeline
 * without going through the MCP tool handler. Per dev plan §6.3.1.)
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import type { FlashQueryConfig } from '../../config/loader.js';
import { FM } from '../../constants/frontmatter-fields.js';
import { resolveDocumentIdentifier, targetedScan } from './resolve-document.js';
import type { supabaseManager } from '../../storage/supabase.js';
import type { embeddingProvider } from '../../embedding/provider.js';
import type { logger } from '../../logging/logger.js';
import { extractHeadings } from './markdown-utils.js';
import { computeSectionChars, extractSection, extractMultipleSections, findHeadingOccurrence } from './markdown-sections.js';

export interface DocumentEnvelope {
  identifier: string;
  title: string;
  path: string;
  fq_id: string;
  modified: string;
  size: { chars: number };
  body?: string;
  extracted_sections?: Array<{ heading: string; chars: number }>;
  frontmatter?: Record<string, unknown>;
  headings?: Array<{ level: number; text: string; chars: number }>;
}

/** Shape of the followed_ref object nested in source envelope on follow_ref success. */
export interface FollowedRefResult {
  reference: string;
  resolved_to: string;
  resolved_fq_id: string | null;
  modified: string;
  size: { chars: number };
  // Conditional per include:
  body?: string;
  extracted_sections?: Array<{ heading: string; chars: number }>;
  frontmatter?: Record<string, unknown>;
  headings?: Array<{ level: number; text: string; chars: number }>;
}

/**
 * Resolve the display title for a document (GDOC-03).
 * Returns trimmed fq_title when present and non-empty; falls back to filename basename
 * without extension. Non-string fq_title values are coerced via String().
 */
export function resolveTitle(
  frontmatter: Record<string, unknown>,
  filePath: string
): string {
  const raw = frontmatter[FM.TITLE];
  if (raw !== null && raw !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const coerced = typeof raw === 'string' ? raw : String(raw);
    const trimmed = coerced.trim();
    if (trimmed.length > 0) return trimmed;
  }
  const ext = path.extname(filePath);
  return path.basename(filePath, ext);
}

/**
 * Build the always-present metadata envelope (GDOC-02, GDOC-07).
 * size.chars is computed from the FULL body content — never from any extracted subset.
 */
export function buildMetadataEnvelope(
  identifier: string,
  resolved: { relativePath: string; capturedFrontmatter: { fqcId: string } },
  frontmatter: Record<string, unknown>,
  bodyContent: string
): {
  identifier: string;
  title: string;
  path: string;
  fq_id: string;
  modified: string;
  size: { chars: number };
} {
  const title = resolveTitle(frontmatter, resolved.relativePath);
  const updatedRaw = frontmatter[FM.UPDATED];
  const modified =
    typeof updatedRaw === 'string' ? updatedRaw : new Date().toISOString();
  return {
    identifier,
    title,
    path: resolved.relativePath,
    fq_id: resolved.capturedFrontmatter.fqcId,
    modified,
    size: { chars: bodyContent.length },
  };
}

/**
 * Build heading entries with per-heading character counts (GDOC-05).
 * Each `chars` value is the size of the section under that heading
 * (heading line through next same-or-higher heading, include_nested-style).
 * For duplicate heading names, each occurrence reports its own section size.
 */
export function buildHeadingEntries(
  content: string,
  maxDepth: number
): Array<{ level: number; text: string; chars: number }> {
  const allHeadings = extractHeadings(content);
  // Track occurrence-by-name across the FULL heading list so chars are accurate
  // even when deep headings are dropped by the maxDepth filter.
  const occurrenceByName = new Map<string, number>();
  const result: Array<{ level: number; text: string; chars: number }> = [];
  for (const heading of allHeadings) {
    const normKey = heading.text.toLowerCase();
    const occ = (occurrenceByName.get(normKey) ?? 0) + 1;
    occurrenceByName.set(normKey, occ);
    if (heading.level > maxDepth) continue;
    const chars = computeSectionChars(content, heading.text, true, occ);
    result.push({ level: heading.level, text: heading.text, chars });
  }
  return result;
}

/**
 * Strip the `content` field from multi-section matches, keeping only heading and chars.
 * Used to build the `extracted_sections` field in the response envelope.
 */
export function buildExtractedSections(
  matches: Array<{ heading: string; content: string; chars: number }>
): Array<{ heading: string; chars: number }> {
  return matches.map((m) => ({ heading: m.heading, chars: m.chars }));
}

/**
 * Join multiple section content strings with a single blank line separator (GDOC-08).
 */
export function assembleMultiSectionBody(
  matches: Array<{ heading: string; content: string; chars: number }>
): string {
  return matches.map((m) => m.content).join('\n\n');
}

/**
 * Assemble the final DocumentEnvelope response object (GDOC-01).
 * Only requested fields are included; absent fields are omitted (no null placeholders).
 * Empty include array defaults to ['body'].
 */
export function buildConsolidatedResponse(
  envelope: {
    identifier: string;
    title: string;
    path: string;
    fq_id: string;
    modified: string;
    size: { chars: number };
  },
  include: Array<'body' | 'frontmatter' | 'headings'>,
  options: {
    body?: string;
    extractedSections?: Array<{ heading: string; chars: number }>;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{ level: number; text: string; chars: number }>;
  }
): DocumentEnvelope {
  const effectiveInclude = include && include.length > 0 ? include : ['body' as const];
  const result: DocumentEnvelope = { ...envelope };
  if (effectiveInclude.includes('body') && options.body !== undefined) {
    result.body = options.body;
    if (options.extractedSections !== undefined) {
      result.extracted_sections = options.extractedSections;
    }
  }
  if (effectiveInclude.includes('frontmatter') && options.frontmatter !== undefined) {
    result.frontmatter = options.frontmatter;
  }
  if (effectiveInclude.includes('headings') && options.headings !== undefined) {
    result.headings = options.headings;
  }
  return result;
}

/**
 * Pre-execution parameter validator. Runs BEFORE any document I/O so the
 * returned error envelope carries no `identifier` field.
 * Returns null when the combination is valid.
 *
 * Sub-case A: sections has elements but 'body' is not in include (Error 9a)
 * Sub-case B: sections has > 1 element AND occurrence !== 1 (Error 9b)
 */
export function validateParameterCombinations(input: {
  include?: string[];
  sections?: string[];
  occurrence?: number;
}): {
  error: 'invalid_parameter_combination';
  message: string;
  details: {
    conflict: 'sections_without_body' | 'occurrence_with_multi_section';
    [k: string]: unknown;
  };
} | null {
  const include = input.include ?? ['body'];
  const sections = input.sections ?? [];
  const occurrence = input.occurrence ?? 1;

  if (sections.length > 0 && !include.includes('body')) {
    return {
      error: 'invalid_parameter_combination',
      message: 'sections requires "body" in include',
      details: {
        conflict: 'sections_without_body',
        include,
        sections,
      },
    };
  }

  if (sections.length > 1 && occurrence !== 1) {
    return {
      error: 'invalid_parameter_combination',
      message: 'occurrence is only valid when sections has exactly one element',
      details: {
        conflict: 'occurrence_with_multi_section',
        sections_count: sections.length,
        occurrence,
      },
    };
  }

  return null;
}

/** Result of walking a dot-separated path through a frontmatter object (FREF-01, FREF-03). */
export type TraversalResult =
  | { kind: 'value'; value: string }
  | { kind: 'path_not_found'; resolved: string[]; failed_at: string; available_keys: string[] }
  | { kind: 'invalid_type'; found_type: string; found_value_preview: string };

/**
 * Walk a dot-separated path through a frontmatter object.
 *
 * - Returns { kind: 'value' } when the path resolves to a string value.
 * - Returns { kind: 'path_not_found' } when any segment is missing or a non-object is encountered mid-path.
 * - Returns { kind: 'invalid_type' } when the resolved value is not a string.
 *
 * Arrays are distinguished from objects in `found_type` ('array' vs 'object').
 * Per CONTEXT.md (FREF-01): segments are object keys only — never file-system paths.
 *
 * Security note (T-108-01): segments produced by refPath.split('.') are used EXCLUSIVELY
 * as object keys (`seg in obj`, `obj[seg]`). They are NEVER passed to path.resolve(),
 * fs.readFile(), or any file-system primitive.
 */
export function traverseFollowRef(
  frontmatter: Record<string, unknown>,
  refPath: string
): TraversalResult {
  const segments = refPath.split('.');
  let current: unknown = frontmatter;
  const resolved: string[] = [];

  for (const seg of segments) {
    if (
      typeof current !== 'object' ||
      current === null ||
      !Object.prototype.hasOwnProperty.call(current, seg)
    ) {
      return {
        kind: 'path_not_found',
        resolved,
        failed_at: seg,
        available_keys:
          typeof current === 'object' && current !== null
            ? Object.keys(current)  // Object.keys already excludes inherited props
            : [],
      };
    }
    resolved.push(seg);
    current = (current as Record<string, unknown>)[seg];
  }

  if (typeof current !== 'string') {
    const t = Array.isArray(current) ? 'array' : typeof current;
    let preview: string;
    try {
      preview = JSON.stringify(current)?.slice(0, 100) ?? String(current);
    } catch {
      preview = String(current);
    }
    return {
      kind: 'invalid_type',
      found_type: t,
      found_value_preview: preview,
    };
  }
  return { kind: 'value', value: current };
}

// ─────────────────────────────────────────────────────────────────────────────
// DocumentRequestError + resolveAndBuildDocument — shared resolution pipeline
// (Phase 109: extracted from documents.ts so reference-resolver.ts can import
// without going through the MCP tool handler. Per dev plan §6.3.1.)
// ─────────────────────────────────────────────────────────────────────────────

/** Errors thrown from the document resolution pipeline mapping to MCP isError:true responses. */
export class DocumentRequestError extends Error {
  constructor(public envelope: Record<string, unknown>) {
    super(typeof envelope.message === 'string' ? envelope.message : 'document request failed');
    this.name = 'DocumentRequestError';
  }
}

/**
 * Resolve one document identifier through the full Phase 107 pipeline and return
 * a JSON-stringifiable result object. Used by both single-string and batch paths.
 * When followRef is provided, the source document's frontmatter is traversed and
 * the target document is read and returned nested under followed_ref.
 * Throws DocumentRequestError for custom error envelopes (section_not_found, follow_ref_*).
 * Throws generic Error for identifier resolution / read failures (document_not_found / read_error).
 */
export async function resolveAndBuildDocument(
  identifier: string,
  options: {
    effectiveInclude: Array<'body' | 'frontmatter' | 'headings'>;
    sectionsList: string[];
    effectiveIncludeNested: boolean;
    occurrence: number;
    effectiveMaxDepth: number;
    followRef: string | undefined;
  },
  deps: {
    config: FlashQueryConfig;
    supabaseManager: typeof supabaseManager;
    embeddingProvider: typeof embeddingProvider;
    logger: typeof logger;
  }
): Promise<Record<string, unknown>> {
  const { effectiveInclude, sectionsList, effectiveIncludeNested, occurrence, effectiveMaxDepth, followRef } = options;
  const { config: cfg, supabaseManager: sm, embeddingProvider: ep, logger: log } = deps;

  const resolved = await resolveDocumentIdentifier(cfg, sm.getClient(), identifier, log);
  const rawContent = await readFile(resolved.absPath, 'utf-8');
  const parsed = matter(rawContent);
  const contentHash = createHash('sha256').update(rawContent).digest('hex');

  // CR-02: Only call targetedScan when hash has changed or no existing DB row
  let preScan: Awaited<ReturnType<typeof targetedScan>>;
  const { data: hashRow } = await sm
    .getClient()
    .from('fqc_documents')
    .select('content_hash, id')
    .eq('id', resolved.fqcId ?? '')
    .maybeSingle();
  if (!hashRow || hashRow.content_hash !== contentHash) {
    preScan = await targetedScan(cfg, sm.getClient(), resolved, contentHash, log);
  } else {
    preScan = {
      ...resolved,
      fqcId: hashRow.id as string,
      capturedFrontmatter: {
        fqcId: hashRow.id as string,
        created: (parsed.data[FM.CREATED] as string) || new Date().toISOString(),
        status: (parsed.data[FM.STATUS] as string) || 'active',
        contentHash,
      },
    };
  }

  const relativePath = preScan.relativePath;
  const fqcId = preScan.capturedFrontmatter.fqcId;
  const { data, content } = parsed;

  log.info(`get_document: read ${relativePath}`);

  // Background re-embed when hash is stale
  if (fqcId && (!hashRow || hashRow.content_hash !== contentHash)) {
    const docTitle = typeof data[FM.TITLE] === 'string' ? (data[FM.TITLE] as string) : relativePath;
    const now = new Date().toISOString();
    log.debug(`get_document: stale hash detected for ${relativePath} — queuing background re-embed`);
    void (async () => {
      try {
        const { error: hashErr } = await sm.getClient()
          .from('fqc_documents')
          .update({ content_hash: contentHash, updated_at: now })
          .eq('id', fqcId);
        if (hashErr) {
          log.warn(`get_document: hash update failed for ${relativePath}: ${hashErr.message}`);
          return;
        }
        const vector = await ep.embed(`${docTitle}\n\n${content}`);
        await sm.getClient()
          .from('fqc_documents')
          .update({ embedding: JSON.stringify(vector), updated_at: new Date().toISOString() })
          .eq('id', fqcId);
      } catch (err) {
        log.warn(`get_document: background re-embed failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }

  const envelope = buildMetadataEnvelope(identifier, preScan, data, content);

  // ── follow_ref branch (FREF-01, FREF-02, FREF-03) ──────────────────────────
  if (followRef) {
    // ── Pre-resolution: traverse the source frontmatter ──────────────────────
    const traversal = traverseFollowRef(data, followRef);
    if (traversal.kind === 'path_not_found') {
      throw new DocumentRequestError({
        error: 'follow_ref_path_not_found',
        message: `Reference path '${followRef}' not found in frontmatter of '${identifier}' (failed at segment '${traversal.failed_at}')`,
        identifier,
        reference: followRef,
        traversal: {
          resolved: traversal.resolved,
          failed_at: traversal.failed_at,
          available_keys: traversal.available_keys,
        },
      });
    }
    if (traversal.kind === 'invalid_type') {
      throw new DocumentRequestError({
        error: 'follow_ref_invalid_type',
        message: `Reference path '${followRef}' resolved to a ${traversal.found_type}, expected a string identifier`,
        identifier,
        reference: followRef,
        found_type: traversal.found_type,
        found_value_preview: traversal.found_value_preview,
      });
    }
    // traversal.kind === 'value' — resolve the target identifier
    const targetIdentifier: string = traversal.value;
    let targetResolved: Awaited<ReturnType<typeof resolveDocumentIdentifier>>;
    try {
      targetResolved = await resolveDocumentIdentifier(cfg, sm.getClient(), targetIdentifier, log);
    } catch (resolveErr) {
      const m = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
      throw new DocumentRequestError({
        error: 'follow_ref_target_not_found',
        message: `follow_ref target '${targetIdentifier}' (from ${followRef} in '${identifier}') not found in vault: ${m}`,
        identifier,
        reference: followRef,
        resolved_value: targetIdentifier,
        resolution_method: 'unknown', // Per CONTEXT.md Deferred Ideas: hardcoded acceptable in v1
      });
    }

    // ── Read target (READ-ONLY: do NOT call targetedScan — see Pitfall 1) ────
    let targetRaw: string;
    try {
      targetRaw = await readFile(targetResolved.absPath, 'utf-8');
    } catch (readErr) {
      const m = readErr instanceof Error ? readErr.message : String(readErr);
      throw new DocumentRequestError({
        error: 'follow_ref_target_not_found',
        message: `follow_ref target '${targetIdentifier}' resolved but could not be read: ${m}`,
        identifier,
        reference: followRef,
        resolved_value: targetIdentifier,
        resolution_method: 'unknown',
      });
    }
    const targetParsed = matter(targetRaw);
    const targetData = targetParsed.data;
    const targetContent = targetParsed.content;
    const targetFqId = typeof targetData[FM.ID] === 'string' ? (targetData[FM.ID] as string) : null;
    const targetModified = typeof targetData[FM.UPDATED] === 'string'
      ? (targetData[FM.UPDATED] as string)
      : new Date().toISOString();

    // ── Build followed_ref base envelope ─────────────────────────────────────
    const followedRef: Record<string, unknown> = {
      reference: followRef,
      resolved_to: targetResolved.relativePath,
      resolved_fq_id: targetFqId, // explicitly null when missing — never omit (CONTEXT.md)
      modified: targetModified,
      size: { chars: targetContent.length },
    };

    // ── Apply include to TARGET (FREF-02) ────────────────────────────────────
    if (effectiveInclude.includes('body')) {
      if (sectionsList.length === 1) {
        try {
          const extracted = extractSection(targetContent, sectionsList[0], effectiveIncludeNested, occurrence);
          const allHeadings = extractHeadings(targetContent);
          const matchedHeading = findHeadingOccurrence(allHeadings, sectionsList[0], occurrence);
          const matchedText = matchedHeading ? matchedHeading.text : sectionsList[0];
          followedRef.body = extracted.section;
          followedRef.extracted_sections = [{ heading: matchedText, chars: extracted.section.length }];
        } catch (extractErr) {
          const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
          const allHeadings = extractHeadings(targetContent);
          const availableHeadings = allHeadings.map((h) => h.text);
          const isOccurrenceErr = msg.toLowerCase().includes('appears') || msg.toLowerCase().includes('occurrence');
          const reason: 'no_match' | 'insufficient_occurrences' = isOccurrenceErr ? 'insufficient_occurrences' : 'no_match';
          let foundCount: number | undefined;
          if (reason === 'insufficient_occurrences') {
            const m = /appears (\d+) times/.exec(msg);
            if (m) foundCount = parseInt(m[1], 10);
          }
          // POST-RESOLUTION error: nest under followed_ref (FREF-03)
          throw new DocumentRequestError({
            error: 'section_not_found',
            message: reason === 'no_match'
              ? `No heading matching '${sectionsList[0]}' found in follow_ref target '${targetResolved.relativePath}'`
              : `Heading '${sectionsList[0]}' has fewer occurrences than requested in follow_ref target '${targetResolved.relativePath}'`,
            identifier, // SOURCE identifier at top level
            followed_ref: {
              reference: followRef,
              resolved_to: targetResolved.relativePath,
              resolved_fq_id: targetFqId,
              missing_sections: [
                reason === 'insufficient_occurrences'
                  ? { query: sectionsList[0], reason, requested_count: occurrence, ...(foundCount !== undefined ? { found_count: foundCount } : {}) }
                  : { query: sectionsList[0], reason },
              ],
              available_headings: availableHeadings,
            },
          });
        }
      } else if (sectionsList.length > 1) {
        const result = extractMultipleSections(targetContent, sectionsList, { includeNested: effectiveIncludeNested });
        if (result.errors.length > 0) {
          const allHeadings = extractHeadings(targetContent);
          throw new DocumentRequestError({
            error: 'section_not_found',
            message: `Requested sections could not be fully resolved in follow_ref target '${targetResolved.relativePath}': ${result.errors.length} ${result.errors.length === 1 ? 'failure' : 'failures'}`,
            identifier,
            followed_ref: {
              reference: followRef,
              resolved_to: targetResolved.relativePath,
              resolved_fq_id: targetFqId,
              missing_sections: result.errors,
              available_headings: allHeadings.map((h) => h.text),
            },
          });
        }
        followedRef.body = assembleMultiSectionBody(result.matches);
        followedRef.extracted_sections = buildExtractedSections(result.matches);
      } else {
        followedRef.body = targetContent;
      }
    }
    if (effectiveInclude.includes('frontmatter')) {
      followedRef.frontmatter = targetData;
    }
    if (effectiveInclude.includes('headings')) {
      followedRef.headings = buildHeadingEntries(targetContent, effectiveMaxDepth);
    }

    // ── Return source envelope + followed_ref nested; NO top-level body ───────
    return { ...envelope, followed_ref: followedRef };
  }

  // ── No follow_ref: source-content branch ─────────────────────────────────────
  let responseBody: string | undefined;
  let extractedSections: Array<{ heading: string; chars: number }> | undefined;
  let frontmatterField: Record<string, unknown> | undefined;
  let headingsField: Array<{ level: number; text: string; chars: number }> | undefined;

  if (effectiveInclude.includes('body')) {
    if (sectionsList.length === 1) {
      try {
        const extracted = extractSection(content, sectionsList[0], effectiveIncludeNested, occurrence);
        responseBody = extracted.section;
        const allHeadings = extractHeadings(content);
        const matchedHeading = findHeadingOccurrence(allHeadings, sectionsList[0], occurrence);
        const matchedText = matchedHeading ? matchedHeading.text : sectionsList[0];
        extractedSections = [{ heading: matchedText, chars: extracted.section.length }];
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
        const allHeadings = extractHeadings(content);
        const availableHeadings = allHeadings.map((h) => h.text);
        const isOccurrenceErr = msg.toLowerCase().includes('appears') || msg.toLowerCase().includes('occurrence');
        const reason: 'no_match' | 'insufficient_occurrences' = isOccurrenceErr ? 'insufficient_occurrences' : 'no_match';
        let foundCount: number | undefined;
        if (reason === 'insufficient_occurrences') {
          const m = /appears (\d+) times/.exec(msg);
          if (m) foundCount = parseInt(m[1], 10);
        }
        throw new DocumentRequestError({
          error: 'section_not_found',
          message: reason === 'no_match'
            ? `No heading matching '${sectionsList[0]}' found in document`
            : `Heading '${sectionsList[0]}' has fewer occurrences than requested`,
          identifier,
          missing_sections: [
            reason === 'insufficient_occurrences'
              ? { query: sectionsList[0], reason, requested_count: occurrence, ...(foundCount !== undefined ? { found_count: foundCount } : {}) }
              : { query: sectionsList[0], reason },
          ],
          available_headings: availableHeadings,
        });
      }
    } else if (sectionsList.length > 1) {
      const result = extractMultipleSections(content, sectionsList, { includeNested: effectiveIncludeNested });
      if (result.errors.length > 0) {
        const allHeadings = extractHeadings(content);
        throw new DocumentRequestError({
          error: 'section_not_found',
          message: `Requested sections could not be fully resolved: ${result.errors.length} ${result.errors.length === 1 ? 'failure' : 'failures'}`,
          identifier,
          missing_sections: result.errors,
          available_headings: allHeadings.map((h) => h.text),
        });
      }
      responseBody = assembleMultiSectionBody(result.matches);
      extractedSections = buildExtractedSections(result.matches);
    } else {
      responseBody = content;
    }
  }

  if (effectiveInclude.includes('frontmatter')) {
    frontmatterField = data;
  }

  if (effectiveInclude.includes('headings')) {
    headingsField = buildHeadingEntries(content, effectiveMaxDepth);
  }

  return buildConsolidatedResponse(envelope, [...effectiveInclude], {
    body: responseBody,
    extractedSections,
    frontmatter: frontmatterField,
    headings: headingsField,
  }) as unknown as Record<string, unknown>;
}
