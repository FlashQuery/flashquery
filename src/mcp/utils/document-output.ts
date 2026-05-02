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
import { extractHeadings } from './markdown-utils.js';
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
    if (typeof current !== 'object' || current === null || !(seg in (current as object))) {
      return {
        kind: 'path_not_found',
        resolved,
        failed_at: seg,
        available_keys:
          typeof current === 'object' && current !== null
            ? Object.keys(current as object)
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
