import { describe, it, expect } from 'vitest';
import {
  formatKeyValueEntry,
  formatBatchSeparator,
  shouldShowProgress,
  progressMessage,
  formatEmptyResults,
  formatMissingIds,
  joinBatchEntries,
  formatHeadingEntry,
  formatLinkedDocEntry,
  formatTableHeader,
  formatTableRow,
} from '../../src/mcp/utils/response-formats.js';

describe('response-formats utilities', () => {
  describe('formatKeyValueEntry', () => {
    it('formats string values', () => {
      expect(formatKeyValueEntry('Title', 'My Document')).toBe('Title: My Document');
    });

    it('formats number values', () => {
      expect(formatKeyValueEntry('Count', 42)).toBe('Count: 42');
    });

    it('formats boolean values', () => {
      expect(formatKeyValueEntry('Active', true)).toBe('Active: true');
      expect(formatKeyValueEntry('Active', false)).toBe('Active: false');
    });

    it('formats null as empty value', () => {
      expect(formatKeyValueEntry('Field', null)).toBe('Field: ');
    });

    it('formats undefined as empty value', () => {
      expect(formatKeyValueEntry('Field', undefined)).toBe('Field: ');
    });

    it('formats objects as JSON', () => {
      const obj = { a: 1, b: 'test' };
      expect(formatKeyValueEntry('Data', obj)).toBe(`Data: ${JSON.stringify(obj)}`);
    });

    it('formats arrays as JSON', () => {
      const arr = ['tag1', 'tag2'];
      expect(formatKeyValueEntry('Tags', arr)).toBe(`Tags: ${JSON.stringify(arr)}`);
    });

    it('handles edge case: empty string', () => {
      expect(formatKeyValueEntry('Empty', '')).toBe('Empty: ');
    });

    it('handles edge case: zero', () => {
      expect(formatKeyValueEntry('Zero', 0)).toBe('Zero: 0');
    });
  });

  describe('formatBatchSeparator', () => {
    it('returns exactly three dashes', () => {
      expect(formatBatchSeparator()).toBe('---');
    });

    it('returns same separator on multiple calls', () => {
      expect(formatBatchSeparator()).toBe(formatBatchSeparator());
    });
  });

  describe('shouldShowProgress', () => {
    it('returns false for count < 100', () => {
      expect(shouldShowProgress(50)).toBe(false);
      expect(shouldShowProgress(99)).toBe(false);
      expect(shouldShowProgress(1)).toBe(false);
    });

    it('returns false for count == 100', () => {
      expect(shouldShowProgress(100)).toBe(false);
    });

    it('returns true for count > 100', () => {
      expect(shouldShowProgress(101)).toBe(true);
      expect(shouldShowProgress(150)).toBe(true);
      expect(shouldShowProgress(1000)).toBe(true);
    });
  });

  describe('progressMessage', () => {
    it('formats message with document count', () => {
      expect(progressMessage(150)).toBe('Processing 150 documents — this may take a moment.');
    });

    it('works with different counts', () => {
      expect(progressMessage(247)).toBe('Processing 247 documents — this may take a moment.');
      expect(progressMessage(101)).toBe('Processing 101 documents — this may take a moment.');
    });

    it('includes exact count in message', () => {
      const msg = progressMessage(500);
      expect(msg).toContain('500');
      expect(msg).toContain('Processing');
      expect(msg).toContain('documents');
    });
  });

  describe('formatEmptyResults', () => {
    it('formats empty results for memories', () => {
      expect(formatEmptyResults('memories')).toBe('No memories found.');
    });

    it('formats empty results for documents', () => {
      expect(formatEmptyResults('documents')).toBe('No documents found.');
    });

    it('works with any entity type', () => {
      expect(formatEmptyResults('items')).toBe('No items found.');
    });
  });

  describe('formatMissingIds', () => {
    it('returns empty string for empty array', () => {
      expect(formatMissingIds([])).toBe('');
    });

    it('formats single missing ID', () => {
      expect(formatMissingIds(['id-123'])).toBe('Not found: id-123');
    });

    it('formats multiple missing IDs', () => {
      expect(formatMissingIds(['id-1', 'id-2', 'id-3'])).toBe('Not found: id-1, id-2, id-3');
    });

    it('joins IDs with comma and space', () => {
      const result = formatMissingIds(['a', 'b']);
      expect(result).toContain('a, b');
      expect(result).not.toContain('a,b'); // No space after comma
    });
  });

  describe('joinBatchEntries', () => {
    it('joins single entry without separator', () => {
      expect(joinBatchEntries(['entry1'])).toBe('entry1');
    });

    it('joins multiple entries with --- separator', () => {
      const result = joinBatchEntries(['entry1', 'entry2']);
      expect(result).toBe('entry1\n---\nentry2');
    });

    it('joins three entries with two separators', () => {
      const result = joinBatchEntries(['a', 'b', 'c']);
      expect(result).toBe('a\n---\nb\n---\nc');
    });

    it('preserves multiline entries', () => {
      const entries = ['line1\nline2', 'line3\nline4'];
      const result = joinBatchEntries(entries);
      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('line3');
      expect(result).toContain('line4');
      expect(result).toContain('---');
    });

    it('handles empty entry list', () => {
      expect(joinBatchEntries([])).toBe('');
    });
  });

  describe('formatHeadingEntry', () => {
    it('formats heading with all fields', () => {
      const result = formatHeadingEntry({ level: 2, text: 'Introduction', line: 42 });
      expect(result).toContain('Level: 2');
      expect(result).toContain('Text: Introduction');
      expect(result).toContain('Line: 42');
    });

    it('formats H1 heading', () => {
      const result = formatHeadingEntry({ level: 1, text: 'Title', line: 1 });
      expect(result).toContain('Level: 1');
      expect(result).toContain('Title');
    });

    it('formats H6 heading', () => {
      const result = formatHeadingEntry({ level: 6, text: 'Minor Point', line: 99 });
      expect(result).toContain('Level: 6');
      expect(result).toContain('Minor Point');
    });

    it('joins fields with newlines', () => {
      const result = formatHeadingEntry({ level: 3, text: 'Section', line: 25 });
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });

    it('handles headings with special characters', () => {
      const result = formatHeadingEntry({
        level: 2,
        text: 'Chapter 3: The (Beginning) & End',
        line: 50,
      });
      expect(result).toContain('Chapter 3: The (Beginning) & End');
    });
  });

  describe('formatLinkedDocEntry', () => {
    it('formats resolved linked document', () => {
      const result = formatLinkedDocEntry({ title: 'Other Doc', resolved: true });
      expect(result).toContain('Title: Other Doc');
      expect(result).toContain('Status: resolved');
    });

    it('formats unresolved linked document', () => {
      const result = formatLinkedDocEntry({ title: 'Missing Doc', resolved: false });
      expect(result).toContain('Title: Missing Doc');
      expect(result).toContain('Status: unresolved');
    });

    it('joins fields with newlines', () => {
      const result = formatLinkedDocEntry({ title: 'Some Title', resolved: true });
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    it('marks unresolved distinctly', () => {
      const resolved = formatLinkedDocEntry({ title: 'Doc A', resolved: true });
      const unresolved = formatLinkedDocEntry({ title: 'Doc A', resolved: false });
      expect(resolved).not.toEqual(unresolved);
      expect(resolved).toContain('resolved');
      expect(unresolved).toContain('unresolved');
    });

    it('handles document titles with special characters', () => {
      const result = formatLinkedDocEntry({
        title: 'File (v2.1) - Draft & Notes',
        resolved: true,
      });
      expect(result).toContain('File (v2.1) - Draft & Notes');
    });
  });

  describe('integration: typical response workflows', () => {
    it('builds a multi-entry memory response', () => {
      const entries = [
        [
          formatKeyValueEntry('Memory ID', 'mem-001'),
          formatKeyValueEntry('Content', 'User prefers dark mode'),
          formatKeyValueEntry('Tags', ['#preference']),
        ].join('\n'),
        [
          formatKeyValueEntry('Memory ID', 'mem-002'),
          formatKeyValueEntry('Content', 'Project deadline April 15'),
          formatKeyValueEntry('Tags', ['#project']),
        ].join('\n'),
      ];
      const response = joinBatchEntries(entries);
      expect(response).toContain('mem-001');
      expect(response).toContain('mem-002');
      expect(response).toContain('---');
    });

    it('builds a heading list response', () => {
      const headings = [
        { level: 1, text: 'Introduction', line: 1 },
        { level: 2, text: 'Background', line: 5 },
        { level: 2, text: 'Methods', line: 10 },
      ];
      const formatted = headings.map((h) => formatHeadingEntry(h)).join('\n---\n');
      expect(formatted).toContain('Introduction');
      expect(formatted).toContain('Background');
      expect(formatted).toContain('Methods');
      expect(formatted).toContain('---');
    });

    it('builds error response with missing IDs', () => {
      const responseText = 'Operation completed' + '\n\n' + formatMissingIds(['id-1', 'id-2']);
      expect(responseText).toContain('Operation completed');
      expect(responseText).toContain('Not found');
      expect(responseText).toContain('id-1');
    });
  });
});

describe('formatTableHeader', () => {
  it('returns header and separator rows joined by newline (U-59)', () => {
    const result = formatTableHeader();
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
  });

  it('header row contains all five column names (U-60)', () => {
    const result = formatTableHeader();
    expect(result).toContain('Name');
    expect(result).toContain('Type');
    expect(result).toContain('Size');
    expect(result).toContain('Created');
    expect(result).toContain('Updated');
  });
});

describe('formatTableRow', () => {
  it('formats pipe-delimited row with all five columns (U-63)', () => {
    const row = formatTableRow('notes.md', 'file', '2.3 KB', '2026-01-01', '2026-04-01');
    expect(row).toBe('| notes.md | file | 2.3 KB | 2026-01-01 | 2026-04-01 |');
  });

  it('passes directory name with trailing slash through unchanged (U-64)', () => {
    const row = formatTableRow('CRM/', 'directory', '5 items', '2026-01-01', '2026-01-01');
    expect(row).toContain('CRM/');
    expect(row).toContain('directory');
    expect(row).toContain('5 items');
  });

  it('all five values appear in the output (U-65)', () => {
    const row = formatTableRow('a', 'b', 'c', 'd', 'e');
    expect(row).toContain('a');
    expect(row).toContain('b');
    expect(row).toContain('c');
    expect(row).toContain('d');
    expect(row).toContain('e');
  });

  it('passes plain filename through unchanged (U-61)', () => {
    const row = formatTableRow('notes.md', 'file', '1.0 KB', '2026-01-01', '2026-01-01');
    expect(row).toContain('notes.md');
  });

  it('passes relative path through unchanged (U-62)', () => {
    const row = formatTableRow('CRM/Contacts/notes.md', 'file', '1.0 KB', '2026-01-01', '2026-01-01');
    expect(row).toContain('CRM/Contacts/notes.md');
  });
});
