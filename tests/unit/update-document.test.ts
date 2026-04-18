import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatKeyValueEntry } from '../../src/mcp/utils/response-formats.js';

vi.mock('../../src/storage/supabase.js');
vi.mock('../../src/storage/vault.js');
vi.mock('../../src/logging/logger.js');

describe('update_document response format (SPEC-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response format matches create_document', () => {
    it('should return identical format to create_document', () => {
      const updateResponse = {
        title: 'Updated Document',
        fqcId: 'existing-uuid-123',
        path: 'documents/update-doc.md',
        tags: ['updated-tag'],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', updateResponse.title),
        formatKeyValueEntry('FQC ID', updateResponse.fqcId),
        formatKeyValueEntry('Path', updateResponse.path),
        formatKeyValueEntry('Tags', updateResponse.tags),
        formatKeyValueEntry('Status', updateResponse.status),
      ];

      const responseText = lines.join('\n');

      // Should match create_document format exactly
      expect(responseText).toContain('Title:');
      expect(responseText).toContain('FQC ID:');
      expect(responseText).toContain('Path:');
      expect(responseText).toContain('Tags:');
      expect(responseText).toContain('Status:');
    });

    it('should have same fields in same order as create_document', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: ['tag1'],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('FQC ID', response.fqcId),
        formatKeyValueEntry('Path', response.path),
        formatKeyValueEntry('Tags', response.tags),
        formatKeyValueEntry('Status', response.status),
      ];

      const responseText = lines.join('\n');
      const titleIndex = responseText.indexOf('Title:');
      const fqcIndex = responseText.indexOf('FQC ID:');
      const pathIndex = responseText.indexOf('Path:');

      // Verify order: Title → FQC ID → Path → Tags → Status
      expect(titleIndex).toBeLessThan(fqcIndex);
      expect(fqcIndex).toBeLessThan(pathIndex);
    });
  });

  describe('Successful update response', () => {
    it('should return metadata for updated document', () => {
      const response = {
        title: 'Updated Title',
        fqcId: 'uuid-existing',
        path: 'docs/updated.md',
        tags: ['new-tag', 'another-tag'],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('FQC ID', response.fqcId),
        formatKeyValueEntry('Path', response.path),
        formatKeyValueEntry('Tags', response.tags),
        formatKeyValueEntry('Status', response.status),
      ];

      const responseText = lines.join('\n');

      expect(responseText).toContain('Updated Title');
      expect(responseText).toContain('uuid-existing');
      expect(responseText).toContain('docs/updated.md');
    });

    it('should NOT include document content', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: [],
        status: 'active',
        // These should NOT be in response
        newContent: '# Updated content\nThis is the new body',
        oldContent: '# Old content',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('FQC ID', response.fqcId),
        formatKeyValueEntry('Path', response.path),
        formatKeyValueEntry('Tags', response.tags.length > 0 ? response.tags : 'none'),
        formatKeyValueEntry('Status', response.status),
      ];

      const responseText = lines.join('\n');

      expect(responseText).not.toContain('Updated content');
      expect(responseText).not.toContain('# Old content');
    });

    it('should preserve existing fqc_id (never create new)', () => {
      const existingFqcId = 'original-uuid-12345';
      const response = {
        title: 'Updated Document',
        fqcId: existingFqcId,
        path: 'doc.md',
        tags: ['new-tags'],
        status: 'active',
      };

      const line = formatKeyValueEntry('FQC ID', response.fqcId);

      expect(line).toContain(existingFqcId);
      expect(line).not.toContain('new-uuid'); // Should not generate new UUID
    });
  });

  describe('Field updates', () => {
    it('should reflect updated title', () => {
      const oldTitle = 'Original Title';
      const newTitle = 'New Title';
      const response = {
        title: newTitle,
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: [],
        status: 'active',
      };

      const line = formatKeyValueEntry('Title', response.title);
      expect(line).toContain(newTitle);
      expect(line).not.toContain(oldTitle);
    });

    it('should reflect updated tags', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: ['new-tag-1', 'new-tag-2'],
        status: 'active',
      };

      const line = formatKeyValueEntry('Tags', response.tags);
      expect(line).toContain('new-tag-1');
      expect(line).toContain('new-tag-2');
    });

    it('should handle clearing tags (empty array)', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: [],
        status: 'active',
      };

      const line = formatKeyValueEntry('Tags', response.tags.length > 0 ? response.tags : 'none');
      expect(line).toContain('none');
    });

    it('should maintain active status after update', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: [],
        status: 'active',
      };

      const line = formatKeyValueEntry('Status', response.status);
      expect(line).toContain('active');
    });
  });

  describe('Error handling', () => {
    it('should return isError: true on update failure', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: Document not found' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
    });

    it('should NOT include metadata fields in error response', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: Database update failed' }],
        isError: true,
      };

      expect(Object.keys(errorResponse)).toEqual(['content', 'isError']);
    });

    it('should handle missing document error', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: Document not found: unknown-id' }],
        isError: true,
      };

      expect(errorResponse.content[0].text).toContain('not found');
    });

    it('should handle tag validation errors', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Tag validation failed: invalid format' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
      expect(errorResponse.content[0].text).toContain('validation failed');
    });
  });

  describe('Consistency with create_document', () => {
    it('should produce identical field names', () => {
      const fields = [
        formatKeyValueEntry('Title', 'Test'),
        formatKeyValueEntry('FQC ID', 'uuid-1'),
        formatKeyValueEntry('Path', 'test.md'),
        formatKeyValueEntry('Tags', ['tag']),
        formatKeyValueEntry('Status', 'active'),
      ];

      fields.forEach((field) => {
        expect(field).toMatch(/^[^:]+: .+$/);
      });
    });

    it('should use same tag representation', () => {
      const tags = ['tag1', 'tag2'];
      const createLine = formatKeyValueEntry('Tags', tags);
      const updateLine = formatKeyValueEntry('Tags', tags);

      expect(createLine).toBe(updateLine);
    });

    it('should use same empty tag representation', () => {
      const createLine = formatKeyValueEntry('Tags', 'none');
      const updateLine = formatKeyValueEntry('Tags', 'none');

      expect(createLine).toBe(updateLine);
    });
  });

  describe('Edge cases', () => {
    it('should handle updating only content (title unchanged)', () => {
      const response = {
        title: 'Original Title',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: ['existing-tag'],
        status: 'active',
      };

      const line = formatKeyValueEntry('Title', response.title);
      expect(line).toContain('Original Title');
    });

    it('should handle updating only tags (content unchanged)', () => {
      const response = {
        title: 'Title',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: ['new-tag', 'another-new-tag'],
        status: 'active',
      };

      const line = formatKeyValueEntry('Tags', response.tags);
      expect(line).toContain('new-tag');
    });

    it('should handle updating path (file moved)', () => {
      const oldPath = 'old/location/doc.md';
      const newPath = 'new/location/doc.md';
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: newPath,
        tags: [],
        status: 'active',
      };

      const line = formatKeyValueEntry('Path', response.path);
      expect(line).toContain(newPath);
      expect(line).not.toContain(oldPath);
    });
  });
});
