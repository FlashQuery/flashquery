/**
 * Markdown section utilities for document section extraction and manipulation
 * Used by SPEC-01 (get_document sections), SPEC-03 (insert_in_doc), and SPEC-04 (list_files)
 */

import { extractHeadings } from './markdown-utils.js';
import { formatKeyValueEntry } from './response-formats.js';

/**
 * Heading object with metadata
 */
export interface Heading {
  level: number;
  text: string;
  line: number;
}

/**
 * Extract a section from markdown content by heading name
 * Includes the heading line in the response
 *
 * @param content Full markdown content (body only, no frontmatter)
 * @param headingName Name of heading to extract (case-sensitive)
 * @param includeSubheadings If true, include all nested content; if false, stop at first subheading
 * @param occurrence Which occurrence if heading appears multiple times (1-indexed, default: 1)
 * @returns Object with section content (including heading line) and metadata
 * @throws Error if heading not found or multiple matches without occurrence
 */
export function extractSection(
  content: string,
  headingName: string,
  includeSubheadings: boolean = true,
  occurrence: number = 1
): { section: string; lineNumber: number; occurrence: number; totalOccurrences: number } {
  const headings = extractHeadings(content);
  const lines = content.split('\n');

  // Find the target heading
  const targetHeading = findHeadingOccurrence(headings, headingName, occurrence);
  if (!targetHeading) {
    const total = headings.filter((h) => h.text === headingName).length;
    if (total > 1) {
      throw new Error(
        `Heading "${headingName}" appears ${total} times; specify occurrence parameter (1-${total}) to select which one`
      );
    }
    throw new Error(`Heading "${headingName}" not found in document`);
  }

  // Calculate section boundaries
  const boundaries = getSectionBoundaries(content, headingName, includeSubheadings, occurrence);

  // Extract section content (from startLine to endLine, inclusive, lines are 0-indexed in array)
  const sectionLines = lines.slice(boundaries.startLine - 1, boundaries.endLine);
  const section = sectionLines.join('\n');

  // Count total occurrences of this heading name
  const totalOccurrences = headings.filter((h) => h.text === headingName).length;

  return {
    section,
    lineNumber: targetHeading.line,
    occurrence,
    totalOccurrences,
  };
}

/**
 * Find the Nth occurrence of a heading in the headings array
 *
 * @param headings Array of headings from extractHeadings()
 * @param name Heading text to search for (case-sensitive)
 * @param occurrence Which occurrence (1-indexed)
 * @returns The heading object if found, null if occurrence is beyond total count
 * @throws Error if occurrence < 1
 */
export function findHeadingOccurrence(
  headings: Heading[],
  name: string,
  occurrence: number = 1
): Heading | null {
  if (occurrence < 1) {
    throw new Error('occurrence must be >= 1');
  }

  let count = 0;
  for (const heading of headings) {
    if (heading.text === name) {
      count++;
      if (count === occurrence) {
        return heading;
      }
    }
  }

  // No match at this occurrence
  return null;
}

/**
 * Find the next heading at same-or-higher level (for determining section end)
 *
 * @param headings Array of headings from extractHeadings()
 * @param fromIndex Current heading index
 * @param targetLevel Optional: search for specific level (default: same or higher than current)
 * @returns Index of next heading, or -1 if none found
 */
export function getNextHeadingIndex(
  headings: Heading[],
  fromIndex: number,
  targetLevel?: number
): number {
  const currentLevel = headings[fromIndex]?.level ?? 0;
  const searchLevel = targetLevel ?? currentLevel;

  for (let i = fromIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= searchLevel) {
      return i;
    }
  }

  return -1;
}

/**
 * Calculate start and end line numbers for a section
 *
 * @param content Full markdown content (body only)
 * @param headingName Name of heading to find
 * @param includeSubheadings If true, include nested content; if false, stop at first subheading
 * @param occurrence Which occurrence if heading appears multiple times (default: 1)
 * @returns Object with startLine, endLine (both 1-indexed), and section content
 * @throws Error if heading not found
 */
export function getSectionBoundaries(
  content: string,
  headingName: string,
  includeSubheadings: boolean = true,
  occurrence: number = 1
): { startLine: number; endLine: number; content: string } {
  const headings = extractHeadings(content);
  const lines = content.split('\n');

  // Find the target heading
  const targetHeading = findHeadingOccurrence(headings, headingName, occurrence);
  if (!targetHeading) {
    throw new Error(`Heading "${headingName}" not found`);
  }

  // Find the index of the target heading in the headings array
  let headingIndex = -1;
  let count = 0;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].text === headingName) {
      count++;
      if (count === occurrence) {
        headingIndex = i;
        break;
      }
    }
  }

  if (headingIndex === -1) {
    throw new Error(`Could not find occurrence ${occurrence} of heading "${headingName}"`);
  }

  // Start line is the heading line (1-indexed)
  const startLine = targetHeading.line;

  // Determine end line
  let endLine = lines.length; // Default to last line

  if (includeSubheadings) {
    // Include all nested content until next same-or-higher-level heading
    const nextHeadingIndex = getNextHeadingIndex(headings, headingIndex, targetHeading.level);
    if (nextHeadingIndex !== -1) {
      // End before the next same-or-higher heading
      endLine = headings[nextHeadingIndex].line - 1;
    }
  } else {
    // Stop at first subheading (find any heading after current position at deeper level)
    // For a level 2 heading, stop at the first level 3+ heading
    for (let i = headingIndex + 1; i < headings.length; i++) {
      if (headings[i].level > targetHeading.level) {
        // Found first subheading, stop before it
        endLine = headings[i].line - 1;
        break;
      }
      // If we hit a same-or-higher level heading before finding a subheading, stop before it
      if (headings[i].level <= targetHeading.level) {
        endLine = headings[i].line - 1;
        break;
      }
    }
  }

  // Extract section content
  const sectionLines = lines.slice(startLine - 1, endLine);
  const sectionContent = sectionLines.join('\n');

  return {
    startLine,
    endLine,
    content: sectionContent,
  };
}

/**
 * Insert content at one of five positions in a document
 *
 * @param content Full markdown content (body only, no frontmatter)
 * @param position One of: 'top', 'bottom', 'after_heading', 'before_heading', 'end_of_section'
 * @param anchorHeading Required for positions that need a heading anchor (after/before/end_of_section)
 * @param insertContent Content to insert (not including the heading itself)
 * @param occurrence Which occurrence of anchor heading if multiple match (default: 1)
 * @returns Modified document content
 * @throws Error if position invalid, heading not found (for anchor-based modes), or multiple matches without occurrence
 */
export function insertAtPosition(
  content: string,
  position: 'top' | 'bottom' | 'after_heading' | 'before_heading' | 'end_of_section',
  insertContent: string,
  anchorHeading?: string,
  occurrence: number = 1
): string {
  // Validate position
  const validPositions = ['top', 'bottom', 'after_heading', 'before_heading', 'end_of_section'];
  if (!validPositions.includes(position)) {
    throw new Error(
      `Invalid position "${position}"; must be one of: after_heading, before_heading, top, bottom, end_of_section`
    );
  }

  const lines = content.split('\n');

  // Handle position modes
  if (position === 'top') {
    // Insert at very beginning
    const result = insertContent + (insertContent.endsWith('\n') ? '' : '\n') + content;
    return result;
  }

  if (position === 'bottom') {
    // Insert at very end
    const result = content + (content.endsWith('\n') ? '' : '\n') + insertContent;
    return result;
  }

  // For other modes, we need an anchor heading
  if (!anchorHeading) {
    throw new Error(`position "${position}" requires anchorHeading parameter`);
  }

  const headings = extractHeadings(content);
  const targetHeading = findHeadingOccurrence(headings, anchorHeading, occurrence);

  if (!targetHeading) {
    const total = headings.filter((h) => h.text === anchorHeading).length;
    if (total > 1) {
      throw new Error(
        `Heading "${anchorHeading}" appears ${total} times; specify occurrence parameter (1-${total}) to select which one`
      );
    }
    throw new Error(`Heading "${anchorHeading}" not found in document`);
  }

  // Find index of target heading in headings array
  let headingIndex = -1;
  let count = 0;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].text === anchorHeading) {
      count++;
      if (count === occurrence) {
        headingIndex = i;
        break;
      }
    }
  }

  const headingLineNum = targetHeading.line - 1; // Convert to 0-indexed

  if (position === 'before_heading') {
    // Insert before the heading line
    lines.splice(headingLineNum, 0, insertContent);
    return lines.join('\n');
  }

  if (position === 'after_heading') {
    // Insert after the heading line
    lines.splice(headingLineNum + 1, 0, insertContent);
    return lines.join('\n');
  }

  if (position === 'end_of_section') {
    // Find next heading at same-or-higher level
    const nextHeadingIndex = getNextHeadingIndex(headings, headingIndex, targetHeading.level);
    let insertLineNum: number;

    if (nextHeadingIndex !== -1) {
      // Insert before the next heading
      insertLineNum = headings[nextHeadingIndex].line - 1;
    } else {
      // Insert at end of document
      insertLineNum = lines.length;
    }

    lines.splice(insertLineNum, 0, insertContent);
    return lines.join('\n');
  }

  // Exhaustiveness check — all position modes handled above
  const _exhaustive: never = position;
  throw new Error(`Unreachable: unhandled position "${String(_exhaustive)}"`);
}

/**
 * Format section response with metadata using key-value format
 *
 * @param heading The heading object from extractHeadings
 * @param content The section content (including heading line)
 * @param lineNumber Starting line number of the heading
 * @param occurrence Which occurrence (if multiple headings with same name)
 * @param totalOccurrences Total count of headings with same name
 * @returns Formatted response string ready for MCP response
 */
export function buildSectionResponse(
  heading: Heading,
  content: string,
  lineNumber: number,
  occurrence: number,
  totalOccurrences: number
): string {
  // Build response with content first, then metadata
  let response = content;

  // Add metadata as key-value pairs
  response += '\n\n';
  response += formatKeyValueEntry('section_name', heading.text) + '\n';
  response += formatKeyValueEntry('line_number', lineNumber) + '\n';
  response += formatKeyValueEntry('occurrence', occurrence) + '\n';
  response += formatKeyValueEntry('total_occurrences', totalOccurrences);

  return response;
}
