/**
 * Shared response formatting utilities for MCP tools
 * Establishes consistent key-value pair format and batch separators across all tools
 *
 * Pattern (Phase 62):
 * - Single-entry tools: Content first, blank line, then key-value metadata
 * - Multi-entry tools: Key-value pairs separated by `---` (three dashes)
 * - All key-value pairs: `Label: value` format on single lines
 */

/**
 * Format a key-value pair for response output
 * Handles null/undefined values, objects (JSON), and primitives
 *
 * @example
 * formatKeyValueEntry('Memory ID', '12345-abcde') → 'Memory ID: 12345-abcde'
 * formatKeyValueEntry('Tags', ['#tag1', '#tag2']) → 'Tags: ["#tag1","#tag2"]'
 * formatKeyValueEntry('Created', null) → 'Created: '
 */
export function formatKeyValueEntry(label: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `${label}: `;
  }

  if (typeof value === 'object') {
    return `${label}: ${JSON.stringify(value)}`;
  }

  if (typeof value === 'boolean') {
    return `${label}: ${value ? 'true' : 'false'}`;
  }

  if (typeof value === 'number') {
    return `${label}: ${value}`;
  }

  // At this point value is a primitive (string/symbol/bigint/function) — safe to stringify
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return `${label}: ${String(value)}`;
}

/**
 * Get the batch separator string (exactly three dashes)
 * Used to separate records in multi-entry responses
 */
export function formatBatchSeparator(): string {
  return '---';
}

/**
 * Check if output should include progress message for large batches
 * Threshold: 100 identifiers
 *
 * @example
 * shouldShowProgress(50) → false
 * shouldShowProgress(150) → true
 */
export function shouldShowProgress(count: number): boolean {
  return count > 100;
}

/**
 * Format progress message for large batch operations
 * Displayed at the top of the response for transparency
 *
 * @example
 * progressMessage(247) → 'Processing 247 documents — this may take a moment.'
 */
export function progressMessage(count: number): string {
  return `Processing ${count} documents — this may take a moment.`;
}

/**
 * Format empty results message
 * Consistent message across all tools when no records found
 *
 * @example
 * formatEmptyResults('memories') → 'No memories found.'
 * formatEmptyResults('documents') → 'No documents found.'
 */
export function formatEmptyResults(entityType: string): string {
  return `No ${entityType} found.`;
}

/**
 * Format a list of missing IDs for batch responses
 * Displays at end of response to inform user of partial failures
 *
 * @example
 * formatMissingIds(['id1', 'id2']) → 'Not found: id1, id2'
 */
export function formatMissingIds(ids: string[]): string {
  if (ids.length === 0) return '';
  return `Not found: ${ids.join(', ')}`;
}

/**
 * Join batch entries with separator
 * Convenience function for building multi-entry responses
 *
 * @example
 * joinBatchEntries(['entry1', 'entry2', 'entry3'])
 * → 'entry1\n---\nentry2\n---\nentry3'
 */
export function joinBatchEntries(entries: string[]): string {
  return entries.join(`\n${formatBatchSeparator()}\n`);
}

/**
 * Validate that text follows key-value pair format ("Label: value" per line)
 * Each non-empty line must contain "Label: value" where Label starts with uppercase.
 *
 * @example
 * validateKeyValueFormat("Title: My Doc\nStatus: active") → true
 * validateKeyValueFormat("not a label") → false
 * validateKeyValueFormat("Key:value") → false  (no space after colon)
 */
export function validateKeyValueFormat(text: string): boolean {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue; // blank lines are OK
    // Must contain ": " with uppercase-starting label
    const colonIdx = line.indexOf(': ');
    if (colonIdx === -1) return false;
    const label = line.substring(0, colonIdx);
    // Label must start with uppercase letter or digit (e.g. "FQC ID: ...")
    if (!/^[A-Z0-9]/.test(label)) return false;
  }
  return true;
}

/**
 * Validate multi-entry batch response format.
 * Single entry: validates as key-value format.
 * Multiple entries: must be separated by '\n---\n', each entry must be valid key-value.
 *
 * @example
 * validateBatchFormat("Title: Doc1\n---\nTitle: Doc2") → true
 * validateBatchFormat("Title: Doc1\n---Title: Doc2") → false  (missing newlines around ---)
 */
export function validateBatchFormat(text: string): boolean {
  if (!text.includes('\n---\n')) {
    // Single entry — validate as key-value format
    return validateKeyValueFormat(text);
  }
  const entries = text.split('\n---\n');
  return entries.every((entry) => validateKeyValueFormat(entry.trim()));
}

/**
 * Validate section response structure.
 * Section content must start with a markdown heading (#) and must not contain
 * injected wrapper lines like "[section content here]".
 *
 * @example
 * validateSectionFormat("## Status\nUpdated status here") → true
 * validateSectionFormat("[section content here]") → false
 */
export function validateSectionFormat(text: string): boolean {
  if (!text || text.trim() === '') return false;
  const lines = text.split('\n');
  const firstNonBlank = lines.find((l) => l.trim() !== '');
  if (!firstNonBlank) return false;
  // Must start with a markdown heading
  if (!firstNonBlank.startsWith('#')) return false;
  // Must not contain injected wrappers
  const injectedPatterns = ['[section content here]', '[From line', 'Section content:'];
  for (const pattern of injectedPatterns) {
    if (text.includes(pattern)) return false;
  }
  return true;
}

/**
 * Comprehensive validation of MCP tool response structure.
 * Checks content array, type fields, and optional isError field.
 *
 * @example
 * validateToolResponse({ content: [{ type: "text", text: "Hello" }] }) → { valid: true, errors: [] }
 * validateToolResponse({ content: "string" }) → { valid: false, errors: ["content must be an array"] }
 */
export function validateToolResponse(response: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof response !== 'object' || response === null) {
    errors.push('response must be an object');
    return { valid: false, errors };
  }
  const r = response as Record<string, unknown>;
  if (!('content' in r)) {
    errors.push('missing "content" field');
  } else if (!Array.isArray(r.content)) {
    errors.push('content must be an array');
  } else {
    const contentArr = r.content as unknown[];
    for (let i = 0; i < contentArr.length; i++) {
      const item = contentArr[i] as Record<string, unknown>;
      if (typeof item !== 'object' || item === null) {
        errors.push(`content[${i}] must be an object`);
        continue;
      }
      if (!('type' in item)) errors.push(`content[${i}] missing "type" field`);
      else if (item.type !== 'text') errors.push(`content[${i}].type must be "text"`);
      if (!('text' in item)) errors.push(`content[${i}] missing "text" field`);
      else if (typeof item.text !== 'string') errors.push(`content[${i}].text must be a string`);
    }
  }
  if ('isError' in r && typeof r.isError !== 'boolean') {
    errors.push('isError must be a boolean if present');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Format a heading entry for get_doc_outline output
 * Each heading as a structured block with level, text, and line number
 *
 * @example
 * formatHeadingEntry({ level: 2, text: 'Introduction', line: 42 })
 * → returns lines for that heading in key-value format
 */
export function formatHeadingEntry(heading: { level: number; text: string; line: number }): string {
  return [
    formatKeyValueEntry('Level', heading.level),
    formatKeyValueEntry('Text', heading.text),
    formatKeyValueEntry('Line', heading.line),
  ].join('\n');
}

/**
 * Format linked document entry for get_doc_outline
 * Shows title and resolution status (resolved or unresolved)
 *
 * @example
 * formatLinkedDocEntry({ title: 'Other Doc', resolved: true })
 * → 'Title: Other Doc\nStatus: resolved'
 *
 * formatLinkedDocEntry({ title: 'Missing Doc', resolved: false })
 * → 'Title: Missing Doc\nStatus: unresolved'
 */
export function formatLinkedDocEntry(doc: { title: string; resolved: boolean }): string {
  const status = doc.resolved ? 'resolved' : 'unresolved';
  return [formatKeyValueEntry('Title', doc.title), formatKeyValueEntry('Status', status)].join('\n');
}

/**
 * Format markdown table header for vault directory listing
 * Returns header row and separator row as a single newline-joined string
 *
 * Pattern (Phase 91):
 * - Used by list_vault format: "table" output mode
 *
 * @example
 * formatTableHeader()
 * → '| Name | Type | Size | Created | Updated |\n|------|------|------|---------|---------|'
 */
export function formatTableHeader(): string {
  return '| Name | Type | Size | Created | Updated |\n|------|------|------|---------|---------|';
}

/**
 * Format a single markdown table row for vault directory listing
 * The caller is responsible for assembling the Name value (filename or relative path)
 *
 * @example
 * formatTableRow('notes.md', 'file', '2.3 KB', '2026-01-01', '2026-04-01')
 * → '| notes.md | file | 2.3 KB | 2026-01-01 | 2026-04-01 |'
 */
export function formatTableRow(
  name: string,
  type: string,
  size: string,
  created: string,
  updated: string
): string {
  return `| ${name} | ${type} | ${size} | ${created} | ${updated} |`;
}
