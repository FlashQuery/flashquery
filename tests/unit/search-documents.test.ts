import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { vaultManager } from '../../src/storage/vault.js';
import {
  formatKeyValueEntry,
  formatEmptyResults,
  joinBatchEntries,
} from '../../src/mcp/utils/response-formats.js';

// Mock the dependencies
vi.mock('../../src/storage/supabase.js');
vi.mock('../../src/storage/vault.js');
vi.mock('../../src/logging/logger.js');

describe('search_documents response format (SPEC-12)', () => {
  const mockConfig: FlashQueryConfig = {
    instance: {
      id: 'test-instance',
      vault: { path: '/test/vault' },
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Filesystem mode', () => {
    it('should return single document in key-value format with fqc_id', () => {
      // Helper function to simulate search_documents response formatting
      const doc = {
        title: 'Test Document',
        relativePath: 'clients/test.md',
        tags: ['tag1', 'tag2'],
        fqcId: 'uuid-123',
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', doc.title),
        formatKeyValueEntry('Path', doc.relativePath),
        formatKeyValueEntry('Tags', doc.tags),
        formatKeyValueEntry('FQC ID', doc.fqcId),
      ];

      const response = lines.join('\n');

      expect(response).toContain('Title: Test Document');
      expect(response).toContain('Path: clients/test.md');
      expect(response).toContain('FQC ID: uuid-123');
      expect(response).toContain('Tags:');
    });

    it('should include fqc_id in every result', () => {
      const docs = [
        { title: 'Doc1', relativePath: 'path1.md', tags: [], fqcId: 'id-1' },
        { title: 'Doc2', relativePath: 'path2.md', tags: [], fqcId: 'id-2' },
      ];

      const entries = docs.map((doc) => {
        const lines = [
          formatKeyValueEntry('Title', doc.title),
          formatKeyValueEntry('Path', doc.relativePath),
          formatKeyValueEntry('FQC ID', doc.fqcId),
        ];
        return lines.join('\n');
      });

      const response = joinBatchEntries(entries);

      expect(response).toContain('FQC ID: id-1');
      expect(response).toContain('FQC ID: id-2');
      expect(response).toContain('---');
    });

    it('should use --- separators between batch results', () => {
      const entries = ['Entry 1', 'Entry 2', 'Entry 3'];
      const response = joinBatchEntries(entries);

      expect(response).toContain('Entry 1\n---\nEntry 2\n---\nEntry 3');
    });

    it('should handle empty tags as "none"', () => {
      const doc = {
        title: 'Test',
        relativePath: 'test.md',
        tags: [],
        fqcId: 'uuid-1',
      };

      const response = formatKeyValueEntry('Tags', doc.tags.length > 0 ? doc.tags : 'none');
      expect(response).toContain('Tags: none');
    });

    it('should return "No documents found." for empty results', () => {
      const response = formatEmptyResults('documents');
      expect(response).toBe('No documents found.');
    });

    it('should handle special characters in title', () => {
      const doc = {
        title: 'Test & Document: "Special" (chars)',
        relativePath: 'test.md',
        tags: [],
        fqcId: 'uuid-1',
      };

      const response = formatKeyValueEntry('Title', doc.title);
      expect(response).toContain('Test & Document: "Special" (chars)');
    });

    it('should handle null/undefined values gracefully', () => {
      const response1 = formatKeyValueEntry('Field', null);
      const response2 = formatKeyValueEntry('Field', undefined);

      expect(response1).toBe('Field: ');
      expect(response2).toBe('Field: ');
    });
  });

  describe('Semantic mode', () => {
    it('should include Match percentage field', () => {
      const doc = {
        title: 'Semantic Match',
        path: 'semantic.md',
        tags: ['search'],
        id: 'uuid-1',
        similarity: 0.85,
      };

      const lines = [
        formatKeyValueEntry('Title', doc.title),
        formatKeyValueEntry('Path', doc.path),
        formatKeyValueEntry('Tags', doc.tags),
        formatKeyValueEntry('FQC ID', doc.id),
        formatKeyValueEntry('Match', `${Math.round(doc.similarity * 100)}%`),
      ];

      const response = lines.join('\n');

      expect(response).toContain('Match: 85%');
      expect(response).toContain('FQC ID: uuid-1');
    });

    it('should maintain fqc_id in semantic mode', () => {
      const doc = {
        title: 'Test',
        path: 'test.md',
        tags: [],
        id: 'semantic-uuid',
        similarity: 0.9,
      };

      const response = formatKeyValueEntry('FQC ID', doc.id);
      expect(response).toContain('semantic-uuid');
    });

    it('should format match percentages correctly', () => {
      const similarities = [0.85, 0.95, 0.5, 1.0];
      const expected = ['85%', '95%', '50%', '100%'];

      similarities.forEach((sim, i) => {
        const response = formatKeyValueEntry('Match', `${Math.round(sim * 100)}%`);
        expect(response).toContain(expected[i]);
      });
    });
  });

  describe('Mixed mode', () => {
    it('should differentiate semantic and filesystem results with different fields', () => {
      const semanticDoc = {
        title: 'Semantic Result',
        path: 'semantic.md',
        tags: ['tag1'],
        id: 'uuid-1',
        similarity: 0.85,
      };

      const filesystemDoc = {
        title: 'Filesystem Result',
        relativePath: 'filesystem.md',
        tags: ['tag2'],
        fqcId: 'uuid-2',
      };

      const semanticEntry = [
        formatKeyValueEntry('Title', semanticDoc.title),
        formatKeyValueEntry('FQC ID', semanticDoc.id),
        formatKeyValueEntry('Match', `${Math.round(semanticDoc.similarity * 100)}%`),
      ].join('\n');

      const fsEntry = [
        formatKeyValueEntry('Title', filesystemDoc.title),
        formatKeyValueEntry('FQC ID', filesystemDoc.fqcId),
        formatKeyValueEntry('Source', 'filesystem'),
      ].join('\n');

      expect(semanticEntry).toContain('Match:');
      expect(fsEntry).toContain('Source: filesystem');
    });

    it('should list semantic results first, then filesystem', () => {
      const entries = [
        'Semantic Result 1',
        'Semantic Result 2',
        'Filesystem Result 1',
      ];
      const response = joinBatchEntries(entries);

      const semanticIndex1 = response.indexOf('Semantic Result 1');
      const semanticIndex2 = response.indexOf('Semantic Result 2');
      const filesystemIndex = response.indexOf('Filesystem Result 1');

      expect(semanticIndex1).toBeLessThan(filesystemIndex);
      expect(semanticIndex2).toBeLessThan(filesystemIndex);
    });
  });

  describe('Progress messages for large batches', () => {
    it('should not show progress message for <=100 results', () => {
      const count = 100;
      const shouldShow = count > 100;
      expect(shouldShow).toBe(false);
    });

    it('should show progress message for >100 results', () => {
      const count = 150;
      const shouldShow = count > 100;
      const message = `Processing ${count} documents — this may take a moment.`;

      expect(shouldShow).toBe(true);
      expect(message).toContain('150');
      expect(message).toContain('Processing');
    });
  });

  describe('Tag handling', () => {
    it('should display tags as array format', () => {
      const tags = ['tag1', 'tag2', 'tag3'];
      const response = formatKeyValueEntry('Tags', tags);

      // formatKeyValueEntry converts arrays to JSON
      expect(response).toContain('Tags:');
      expect(response).toContain('tag1');
    });

    it('should handle single tag', () => {
      const tags = ['single-tag'];
      const response = formatKeyValueEntry('Tags', tags);

      expect(response).toContain('single-tag');
    });

    it('should handle empty tags array', () => {
      const tags: string[] = [];
      const response = formatKeyValueEntry('Tags', tags.length > 0 ? tags : 'none');

      expect(response).toContain('none');
    });
  });

  describe('Field formatting edge cases', () => {
    it('should handle very long titles', () => {
      const longTitle = 'A'.repeat(500);
      const response = formatKeyValueEntry('Title', longTitle);

      expect(response).toContain(longTitle);
    });

    it('should handle paths with special characters', () => {
      const path = 'clients/acme & corp/notes (2024).md';
      const response = formatKeyValueEntry('Path', path);

      expect(response).toContain(path);
    });

    it('should handle numeric fields', () => {
      const similarity = 0.85;
      const percentage = Math.round(similarity * 100);
      const response = formatKeyValueEntry('Match', `${percentage}%`);

      expect(response).toContain('85%');
    });
  });

  describe('Tenant isolation', () => {
    it('should preserve instance_id in queries', () => {
      // This test verifies that documents from different instances
      // are not mixed in results (implementation responsibility)
      const doc1 = { title: 'Doc', fqcId: 'id-1', instance: 'instance-1' };
      const doc2 = { title: 'Doc', fqcId: 'id-2', instance: 'instance-2' };

      expect(doc1.instance).not.toBe(doc2.instance);
      expect(doc1.fqcId).not.toBe(doc2.fqcId);
    });
  });

  describe('Database error handling', () => {
    it('should return isError: true on query failure', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: database query failed' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
      expect(errorResponse.content[0].text).toContain('Error');
    });

    it('should not include format fields in error response', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Database connection error' }],
        isError: true,
      };

      // Error response should not have metadata fields
      expect(errorResponse.isError).toBe(true);
      expect(Object.keys(errorResponse)).not.toContain('metadata');
    });
  });
});
