/**
 * Markdown parsing utilities for MCP tools
 * Used by get_doc_outline for wikilink extraction and resolution
 */

/**
 * Regex pattern for wikilinks: [[target]] or [[target|display alias]]
 * Captures only the target (before first pipe), not the display alias
 *
 * @example
 * [[Simple]] → matches, target = 'Simple'
 * [[With Spaces]] → matches, target = 'With Spaces'
 * [[Target|Display]] → matches, target = 'Target'
 * [[Path/To/File.md]] → matches, target = 'Path/To/File.md'
 */
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Extract all wikilinks from markdown content
 * Returns deduplicated list of link targets (not display aliases)
 *
 * Handles:
 * - Simple targets: [[Note]]
 * - Targets with spaces: [[Multi Word Target]]
 * - Display aliases: [[Target|Display]] extracts "Target"
 * - Paths with extensions: [[folder/file.png]]
 * - Parentheses in aliases: [[Target|Display(with parens)]]
 *
 * @param content Full markdown content (body, not frontmatter)
 * @returns Array of unique wikilink targets in order of appearance
 *
 * @example
 * const content = `
 * Text [[First Link]] more text
 * [[Second Link|With Alias]]
 * Another [[First Link]] (duplicate)
 * `;
 * extractWikilinks(content) → ['First Link', 'Second Link']
 */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  // Reset regex state
  WIKILINK_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    // match[1] is the captured target (before the pipe, if present)
    const target = match[1].trim();

    // Skip empty targets and duplicates
    if (target && !seen.has(target)) {
      seen.add(target);
      links.push(target);
    }
  }

  return links;
}

/**
 * Extract headings from markdown body content
 * Returns array with level, text, and line number for each heading
 *
 * Handles:
 * - H1–H6 levels
 * - ATX-style headings: ## Heading Text
 * - Line numbers (1-indexed)
 * - Trailing whitespace in heading text
 *
 * @param content Markdown body (not frontmatter)
 * @returns Array of headings with level, text, and line number
 *
 * @example
 * const content = `# Top Level
 * Some body
 * ## Subheading`;
 * extractHeadings(content) →
 * [
 *   { level: 1, text: 'Top Level', line: 1 },
 *   { level: 2, text: 'Subheading', line: 3 }
 * ]
 */
export function extractHeadings(content: string): Array<{ level: number; text: string; line: number }> {
  const headings: Array<{ level: number; text: string; line: number }> = [];
  const lines = content.split('\n');

  const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const match = HEADING_REGEX.exec(line);

    if (match) {
      const level = match[1].length; // Count # symbols
      const text = match[2].trim();

      headings.push({
        level,
        text,
        line: lineNum + 1, // 1-indexed
      });
    }
  }

  return headings;
}

/**
 * Filter headings by maximum depth
 * Used by get_doc_outline max_depth parameter
 *
 * @param headings Array of heading objects
 * @param maxDepth Maximum heading level to include (1-6)
 * @returns Filtered array
 *
 * @example
 * filterHeadingsByDepth([
 *   { level: 1, text: 'Title', line: 1 },
 *   { level: 2, text: 'Section', line: 5 },
 *   { level: 3, text: 'Subsection', line: 10 }
 * ], 2)
 * → [
 *   { level: 1, text: 'Title', line: 1 },
 *   { level: 2, text: 'Section', line: 5 }
 * ]
 */
export function filterHeadingsByDepth(
  headings: Array<{ level: number; text: string; line: number }>,
  maxDepth: number
): Array<{ level: number; text: string; line: number }> {
  return headings.filter((h) => h.level <= maxDepth);
}

/**
 * Convert heading list to simple string format
 * For backward compatibility or quick display
 *
 * @param headings Array of heading objects
 * @returns String representation (markdown-like format)
 *
 * @example
 * headingsToString([
 *   { level: 2, text: 'Section', line: 5 },
 *   { level: 3, text: 'Subsection', line: 10 }
 * ])
 * → '## Section\n### Subsection'
 */
export function headingsToString(headings: Array<{ level: number; text: string; line: number }>): string {
  return headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
}
