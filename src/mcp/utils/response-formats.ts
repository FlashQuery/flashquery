/**
 * Shared response formatting utilities for MCP tools
 * Establishes JSON MCP response helpers plus legacy key-value helpers.
 *
 * Pattern (Phase 121):
 * - JSON helpers return MCP text content whose text parses as JSON
 * - Expected errors are structured JSON and do not set runtime isError semantics
 * - Runtime errors set isError: true
 *
 * Pattern (Phase 62):
 * - Single-entry tools: Content first, blank line, then key-value metadata
 * - Multi-entry tools: Key-value pairs separated by `---` (three dashes)
 * - All key-value pairs: `Label: value` format on single lines
 */

export const CANONICAL_ERROR_CODES = [
  'not_found',
  'ambiguous_identifier',
  'permission_denied',
  'invalid_input',
  'conflict',
  'unsupported',
  'not_supported_in_mode',
] as const;

export type CanonicalErrorCode = (typeof CANONICAL_ERROR_CODES)[number];
export type WarningCode = string;

export interface ErrorEnvelope {
  error: string;
  message: string;
  identifier?: string;
  details?: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface DocumentIdentificationInput {
  identifier: string;
  title: string;
  path: string;
  fq_id: string;
  modified: string;
  chars: number;
}

export interface DocumentArchiveResultInput extends DocumentIdentificationInput {
  archived_at: string | null;
}

export interface DocumentRemovalResultInput extends DocumentArchiveResultInput {
  removed: true;
  moved_to?: string;
  original_path?: string;
}

export interface DirectoryResult {
  path: string;
  action: 'create' | 'remove';
  status: 'created' | 'removed' | 'unchanged';
  timestamp: string;
}

export interface MaintenanceActionResult {
  action: 'sync' | 'repair';
  started_at: string;
  finished_at: string;
  dry_run: boolean;
  counts: {
    scanned: number;
    added: number;
    updated: number;
    repaired: number;
    archived: number;
  };
  warnings?: WarningCode[];
}

export interface MemoryIdentificationInput {
  memory_id: string;
  content_preview: string;
  tags: string[];
  plugin_scope: string;
  created_at: string;
  updated_at: string;
}

export interface RecordIdentificationInput {
  id: string;
  plugin_id: string;
  table: string;
  created_at: string;
  updated_at: string;
}

export interface PluginIdentificationInput {
  plugin_id: string;
  name: string;
  status: string;
  table_count: number;
}

export interface LlmCallIdentificationInput {
  resolver: string;
  name: string;
  resolved_model_name: string;
  provider_name: string;
}

export function jsonToolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function jsonExpectedError(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: false };
}

export function jsonRuntimeError(message: string, details?: Record<string, unknown>): ToolResult;
export function jsonRuntimeError(error: Omit<ErrorEnvelope, 'error'> & { error?: string }): ToolResult;
export function jsonRuntimeError(
  messageOrError: string | (Omit<ErrorEnvelope, 'error'> & { error?: string }),
  details?: Record<string, unknown>
): ToolResult {
  if (typeof messageOrError === 'string') {
    return jsonRuntimeErrorFromEnvelope({ error: 'runtime_error', message: messageOrError, details });
  }

  return jsonRuntimeErrorFromEnvelope({
    error: messageOrError.error ?? 'runtime_error',
    message: messageOrError.message,
    ...(messageOrError.identifier === undefined ? {} : { identifier: messageOrError.identifier }),
    ...(messageOrError.details === undefined ? {} : { details: messageOrError.details }),
  });
}

function jsonRuntimeErrorFromEnvelope(error: ErrorEnvelope): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(error) }], isError: true };
}

export function withWarnings<T extends Record<string, unknown>>(
  payload: T,
  warnings: WarningCode[]
): T & { warnings?: WarningCode[] } {
  if (warnings.length === 0) {
    return payload;
  }
  return { ...payload, warnings };
}

export function batchResult(results: unknown[]): unknown[] {
  return results;
}

export function documentIdentification(input: DocumentIdentificationInput): {
  identifier: string;
  title: string;
  path: string;
  fq_id: string;
  modified: string;
  size: { chars: number };
} {
  return {
    identifier: input.identifier,
    title: input.title,
    path: input.path,
    fq_id: input.fq_id,
    modified: input.modified,
    size: { chars: input.chars },
  };
}

export function documentArchiveResult(input: DocumentArchiveResultInput): ReturnType<typeof documentIdentification> & {
  status: 'archived';
  archived_at: string | null;
} {
  return {
    ...documentIdentification(input),
    status: 'archived',
    archived_at: input.archived_at,
  };
}

export function documentRemovalResult(input: DocumentRemovalResultInput): ReturnType<typeof documentArchiveResult> & {
  removed: true;
  moved_to?: string;
  original_path?: string;
} {
  return {
    ...documentArchiveResult(input),
    removed: input.removed,
    ...(input.moved_to === undefined ? {} : { moved_to: input.moved_to }),
    ...(input.original_path === undefined ? {} : { original_path: input.original_path }),
  };
}

export function directoryResult(input: DirectoryResult): DirectoryResult {
  return {
    path: input.path,
    action: input.action,
    status: input.status,
    timestamp: input.timestamp,
  };
}

export function maintenanceActionResult(input: MaintenanceActionResult): MaintenanceActionResult {
  return {
    action: input.action,
    started_at: input.started_at,
    finished_at: input.finished_at,
    dry_run: input.dry_run,
    counts: {
      scanned: input.counts.scanned,
      added: input.counts.added,
      updated: input.counts.updated,
      repaired: input.counts.repaired,
      archived: input.counts.archived,
    },
    ...(input.warnings === undefined ? {} : { warnings: input.warnings }),
  };
}

export function memoryIdentification(input: MemoryIdentificationInput): MemoryIdentificationInput {
  return {
    memory_id: input.memory_id,
    content_preview: input.content_preview,
    tags: input.tags,
    plugin_scope: input.plugin_scope,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

export function recordIdentification(input: RecordIdentificationInput): RecordIdentificationInput {
  return {
    id: input.id,
    plugin_id: input.plugin_id,
    table: input.table,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

export function pluginIdentification(input: PluginIdentificationInput): PluginIdentificationInput {
  return {
    plugin_id: input.plugin_id,
    name: input.name,
    status: input.status,
    table_count: input.table_count,
  };
}

export function llmCallIdentification(input: LlmCallIdentificationInput): LlmCallIdentificationInput {
  return {
    resolver: input.resolver,
    name: input.name,
    resolved_model_name: input.resolved_model_name,
    provider_name: input.provider_name,
  };
}

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
 * Format a heading entry for markdown outline-style output
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
 * Format linked document entry for markdown outline-style output
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
