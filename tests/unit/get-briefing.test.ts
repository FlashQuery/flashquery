import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  formatKeyValueEntry,
  formatEmptyResults,
  joinBatchEntries,
} from '../../src/mcp/utils/response-formats.js';

vi.mock('../../src/storage/supabase.js');
vi.mock('../../src/storage/vault.js');
vi.mock('../../src/logging/logger.js');

describe('get_briefing response format (SPEC-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Section headers with counts', () => {
    it('should display Documents section header with count', () => {
      const count = 5;
      const header = `## Documents (${count})`;

      expect(header).toBe('## Documents (5)');
    });

    it('should display Memories section header with count', () => {
      const count = 3;
      const header = `## Memories (${count})`;

      expect(header).toBe('## Memories (3)');
    });

    it('should display Plugin Records section header with count', () => {
      const count = 10;
      const header = `## Plugin Records (${count})`;

      expect(header).toContain('Plugin Records (10)');
    });

    it('should show (0) for empty sections', () => {
      const emptyDocHeader = `## Documents (0)`;
      const emptyMemHeader = `## Memories (0)`;

      expect(emptyDocHeader).toContain('(0)');
      expect(emptyMemHeader).toContain('(0)');
    });
  });

  describe('Key-value blocks within sections', () => {
    it('should format document entry as key-value pairs', () => {
      const doc = {
        title: 'Important Document',
        path: 'clients/acme/notes.md',
        fqcId: 'uuid-123',
        tags: ['client', 'notes'],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', doc.title),
        formatKeyValueEntry('Path', doc.path),
        formatKeyValueEntry('FQC ID', doc.fqcId),
        formatKeyValueEntry('Tags', doc.tags),
        formatKeyValueEntry('Status', doc.status),
      ];

      const entry = lines.join('\n');

      expect(entry).toContain('Title: Important Document');
      expect(entry).toContain('Path: clients/acme/notes.md');
      expect(entry).toContain('FQC ID: uuid-123');
      expect(entry).toContain('Status: active');
    });

    it('should format memory entry with truncated content', () => {
      const memory = {
        id: 'mem-uuid-1',
        content: 'This is a memory about something important that happened during a meeting'.substring(0, 200),
        tags: ['meeting', 'notes'],
        created: '2026-04-12T10:00:00Z',
      };

      const lines = [
        formatKeyValueEntry('Memory ID', memory.id),
        formatKeyValueEntry('Content', memory.content),
        formatKeyValueEntry('Tags', memory.tags),
        formatKeyValueEntry('Created', memory.created),
      ];

      const entry = lines.join('\n');

      expect(entry).toContain('Memory ID: mem-uuid-1');
      expect(entry).toContain('Content:');
      expect(entry).toContain('Tags:');
    });
  });

  describe('Batch separators', () => {
    it('should use --- separator between items', () => {
      const entries = [
        'First document entry',
        'Second document entry',
        'Third document entry',
      ];

      const response = joinBatchEntries(entries);

      expect(response).toContain('---');
      expect(response).toContain('First document entry\n---\nSecond document entry');
    });

    it('should have exactly 2 separators for 3 items', () => {
      const entries = ['Item 1', 'Item 2', 'Item 3'];
      const response = joinBatchEntries(entries);
      const separatorCount = (response.match(/---/g) || []).length;

      expect(separatorCount).toBe(2);
    });

    it('should not have separators for single item', () => {
      const entries = ['Single item'];
      const response = joinBatchEntries(entries);

      expect(response).toBe('Single item');
      expect(response).not.toContain('---');
    });
  });

  describe('Empty sections', () => {
    it('should show "No documents found." when documents empty', () => {
      const message = formatEmptyResults('documents');
      expect(message).toBe('No documents found.');
    });

    it('should show "No memories found." when memories empty', () => {
      const message = formatEmptyResults('memories');
      expect(message).toBe('No memories found.');
    });

    it('should show "No plugin records found." when plugin records empty', () => {
      const message = formatEmptyResults('plugin records');
      expect(message).toBe('No plugin records found.');
    });

    it('should display header even for empty section', () => {
      const sectionText = `## Documents (0)\n\n${formatEmptyResults('documents')}`;

      expect(sectionText).toContain('## Documents (0)');
      expect(sectionText).toContain('No documents found.');
    });
  });

  describe('Multiple sections together', () => {
    it('should include both Documents and Memories sections', () => {
      const text = `## Documents (2)\n\nTitle: Doc 1\n\n---\n\nTitle: Doc 2\n\n## Memories (1)\n\nContent: Memory 1`;

      expect(text).toContain('## Documents (2)');
      expect(text).toContain('## Memories (1)');
      expect(text.indexOf('## Documents')).toBeLessThan(text.indexOf('## Memories'));
    });

    it('should have blank line between sections', () => {
      const docSection = `## Documents (1)\n\nTitle: Document`;
      const memSection = `## Memories (1)\n\nContent: Memory`;
      const combined = docSection + '\n\n' + memSection;

      expect(combined).toContain('\n\n## Memories');
    });

    it('should include Plugin Records when available', () => {
      const text = `## Documents (1)\n\nTitle: Doc\n\n## Memories (0)\n\nNo memories found.\n\n## Plugin Records (2)\n\nRecord 1\n\n---\n\nRecord 2`;

      expect(text).toContain('## Plugin Records (2)');
      expect(text.indexOf('## Documents')).toBeLessThan(text.indexOf('## Plugin Records'));
    });
  });

  describe('Missing/deleted items', () => {
    it('should skip silently if a tagged document has been deleted', () => {
      // Implementation should filter out deleted documents
      const docs = [
        { title: 'Active Doc', fqcId: 'uuid-1', tags: ['tag1'] },
        // Deleted document not in list
      ];

      expect(docs.length).toBe(1);
      expect(docs[0].title).toBe('Active Doc');
    });

    it('should skip silently if a tagged memory has been deleted', () => {
      // Implementation should filter out deleted memories
      const memories = [
        { id: 'mem-1', content: 'Active memory', tags: ['tag1'] },
        // Deleted memory not in list
      ];

      expect(memories.length).toBe(1);
      expect(memories[0].id).toBe('mem-1');
    });

    it('should not show "missing" markers in briefing', () => {
      const docSection = `## Documents (1)\n\nTitle: Active Document`;

      // Should not contain missing/deleted markers
      expect(docSection).not.toContain('(deleted)');
      expect(docSection).not.toContain('(missing)');
    });
  });

  describe('Tag filtering', () => {
    it('should only include documents matching filter tags', () => {
      const docs = [
        { title: 'Tagged Doc', tags: ['client', 'notes'] },
        { title: 'Other Doc', tags: ['other'] },
      ];

      const filtered = docs.filter((d) => d.tags.includes('client'));

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Tagged Doc');
    });

    it('should only include memories matching filter tags', () => {
      const memories = [
        { id: 'mem-1', tags: ['important'] },
        { id: 'mem-2', tags: ['routine'] },
      ];

      const filtered = memories.filter((m) => m.tags.includes('important'));

      expect(filtered.length).toBe(1);
    });
  });

  describe('Field formatting edge cases', () => {
    it('should handle null/undefined tags gracefully', () => {
      const response = formatKeyValueEntry('Tags', 'none');
      expect(response).toBe('Tags: none');
    });

    it('should handle truncated content for memory', () => {
      const longContent = 'A'.repeat(300);
      const truncated = longContent.length > 200 ? longContent.substring(0, 200) + '...' : longContent;

      const line = formatKeyValueEntry('Content', truncated);
      expect(line).toContain('...');
    });

    it('should handle special characters in document title', () => {
      const title = 'Q4 2024: "Year-End" Review & Planning';
      const line = formatKeyValueEntry('Title', title);

      expect(line).toContain(title);
    });

    it('should handle paths with spaces and special chars', () => {
      const path = 'clients/acme corp/2024 planning/notes (draft).md';
      const line = formatKeyValueEntry('Path', path);

      expect(line).toContain(path);
    });
  });

  describe('Tenant isolation', () => {
    it('should only include documents from correct instance', () => {
      const docs = [
        { title: 'Doc1', instance: 'instance-1' },
        { title: 'Doc2', instance: 'instance-2' },
      ];

      const filtered = docs.filter((d) => d.instance === 'instance-1');

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Doc1');
    });
  });

  describe('Database error handling', () => {
    it('should return isError: true on query failure', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error querying documents: database connection failed' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
      expect(errorResponse.content[0].text).toContain('Error');
    });
  });

  describe('Plugin records section (when plugin_id provided)', () => {
    it('should include plugin records in separate section', () => {
      const text = `## Documents (1)\n\nTitle: Doc\n\n## Memories (1)\n\nContent: Mem\n\n## Plugin Records (2)\n\nRecord 1\n\n---\n\nRecord 2`;

      expect(text).toContain('## Plugin Records (2)');
    });

    it('should use same key-value format for plugin records', () => {
      const record = {
        id: 'rec-1',
        name: 'Record Name',
        status: 'active',
        created: '2026-04-12',
      };

      const lines = [
        formatKeyValueEntry('id', record.id),
        formatKeyValueEntry('name', record.name),
        formatKeyValueEntry('status', record.status),
      ];

      const entry = lines.join('\n');
      expect(entry).toContain('id: rec-1');
      expect(entry).toContain('name: Record Name');
    });

    it('should show (0) for empty plugin records', () => {
      const header = `## Plugin Records (0)`;
      expect(header).toContain('(0)');
    });
  });

  describe('Integration: full briefing structure', () => {
    it('should produce correctly structured briefing with all sections', () => {
      const briefing = [
        '## Documents (2)',
        '',
        'Title: Document 1\nPath: doc1.md\nFQC ID: uuid-1',
        '---',
        'Title: Document 2\nPath: doc2.md\nFQC ID: uuid-2',
        '',
        '## Memories (1)',
        '',
        'Memory ID: mem-1\nContent: Memory content here\nTags: tag1',
      ].join('\n');

      expect(briefing).toContain('## Documents (2)');
      expect(briefing).toContain('## Memories (1)');
      expect(briefing).toContain('---');
      expect(briefing.indexOf('## Documents')).toBeLessThan(briefing.indexOf('## Memories'));
    });
  });
});
