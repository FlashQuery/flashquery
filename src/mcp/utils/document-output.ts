/**
 * Document output envelope builders for the consolidated get_document MCP tool.
 * Pure-logic module — no I/O, no DB, no MCP types — safe for unit testing
 * without mocks and reusable from non-MCP code paths (Phase 109 reference resolver).
 *
 * Pattern (Phase 107):
 * - Always-present metadata envelope (identifier, title, path, fq_id, modified, size)
 * - Optional fields per `include` parameter (body, frontmatter, headings, extracted_sections)
 * - resolveTitle uses fq_title with filename-basename fallback (GDOC-03)
 * - validateParameterCombinations runs before any I/O (Error 9)
 */

import path from 'node:path';
import { FM } from '../../constants/frontmatter-fields.js';
import { extractHeadings, filterHeadingsByDepth } from './markdown-utils.js';
import { computeSectionChars } from './markdown-sections.js';

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
  const filtered = filterHeadingsByDepth(allHeadings, maxDepth);
  // Track occurrence-by-name across the FULL heading list so chars are accurate
  // even when filterHeadingsByDepth drops some entries.
  const occurrenceByName = new Map<string, number>();
  const result: Array<{ level: number; text: string; chars: number }> = [];
  for (const heading of allHeadings) {
    const occ = (occurrenceByName.get(heading.text) ?? 0) + 1;
    occurrenceByName.set(heading.text, occ);
    if (heading.level > maxDepth) continue;
    const chars = computeSectionChars(content, heading.text, true, occ);
    result.push({ level: heading.level, text: heading.text, chars });
  }
  // filtered length should equal result length — defensive parity check.
  if (result.length !== filtered.length) {
    // Should not happen — both filter on h.level <= maxDepth.
    // Return result anyway; chars are always populated.
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
