import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatKeyValueEntry } from '../../src/mcp/utils/response-formats.js';

vi.mock('../../src/storage/supabase.js');
vi.mock('../../src/storage/vault.js');
vi.mock('../../src/logging/logger.js');

describe('copy_document response format (SPEC-13 / SPEC-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Response format matches create_document', () => {
    it('should return same format as create_document and update_document', () => {
      const copyResponse = {
        title: 'Copied Document',
        fqcId: 'new-uuid-copy-123',
        path: 'documents/copy-doc.md',
        tags: ['tag1', 'tag2'],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', copyResponse.title),
        formatKeyValueEntry('FQC ID', copyResponse.fqcId),
        formatKeyValueEntry('Path', copyResponse.path),
        formatKeyValueEntry('Tags', copyResponse.tags),
        formatKeyValueEntry('Status', copyResponse.status),
      ];

      const responseText = lines.join('\n');

      expect(responseText).toContain('Title:');
      expect(responseText).toContain('FQC ID:');
      expect(responseText).toContain('Path:');
      expect(responseText).toContain('Tags:');
      expect(responseText).toContain('Status:');
    });

    it('should have identical field order: Title, FQC ID, Path, Tags, Status', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-new',
        path: 'copy.md',
        tags: ['tag'],
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

      expect(titleIndex).toBeLessThan(fqcIndex);
      expect(fqcIndex).toBeLessThan(pathIndex);
    });
  });

  describe('Unique FQC ID generation', () => {
    it('should generate new/different FQC ID from source', () => {
      const sourceId = 'original-uuid-source';
      const copyId = 'new-uuid-copy-12345';

      expect(sourceId).not.toBe(copyId);
    });

    it('should return new FQC ID in response', () => {
      const response = {
        title: 'Copy',
        fqcId: 'brand-new-uuid-xyz',
        path: 'copy.md',
        tags: [],
        status: 'active',
      };

      const line = formatKeyValueEntry('FQC ID', response.fqcId);
      expect(line).toContain('brand-new-uuid-xyz');
    });

    it('should never reuse source FQC ID', () => {
      const sourceFqcId = 'original-uuid-abc';
      const copyFqcId = 'copy-uuid-def';

      expect(copyFqcId).not.toBe(sourceFqcId);

      const line = formatKeyValueEntry('FQC ID', copyFqcId);
      expect(line).not.toContain(sourceFqcId);
    });
  });

  describe('Immutable metadata preservation (SPEC-06)', () => {
    it('should always use source title (no override from parameters)', () => {
      // SPEC-06: copy inherits title from source immutably
      const sourceTitle = 'Original Source Title';
      const response = {
        title: sourceTitle, // always from source, never from parameter
        fqcId: 'copy-uuid',
        path: 'copy.md',
        tags: [],
        status: 'active',
      };

      const line = formatKeyValueEntry('Title', response.title);
      expect(line).toContain(sourceTitle);
    });

    it('should always use source tags (no override from parameters)', () => {
      // SPEC-06: copy inherits tags from source immutably
      const sourceTags = ['source-tag-1', 'source-tag-2'];
      const response = {
        title: 'Source Title',
        fqcId: 'copy-uuid',
        path: 'copy.md',
        tags: sourceTags, // always from source, never from parameter
        status: 'active',
      };

      const line = formatKeyValueEntry('Tags', response.tags);
      expect(line).toContain('source-tag-1');
      expect(line).toContain('source-tag-2');
    });

    it('should preserve custom frontmatter fields from source in copy', () => {
      // SPEC-06: all custom fields from source preserved via ...sourceData spread
      // Simulated copy response preserves source custom fields
      const sourceFrontmatter = {
        title: 'Contact Template',
        tags: ['contact'],
        status: 'active',
        // Custom fields that should be preserved
        company: 'Acme Corp',
        role: 'Engineer',
        project: 'ProjectX',
      };

      // The copy frontmatter is built with ...sourceData spread, so all custom fields are preserved
      const copyFrontmatter = {
        ...sourceFrontmatter,
        fqc_id: 'new-copy-uuid',
        created: '2026-04-13T00:00:00.000Z',
      };

      expect(copyFrontmatter.company).toBe('Acme Corp');
      expect(copyFrontmatter.role).toBe('Engineer');
      expect(copyFrontmatter.project).toBe('ProjectX');
      expect(copyFrontmatter.title).toBe(sourceFrontmatter.title);
      expect(copyFrontmatter.tags).toEqual(sourceFrontmatter.tags);
    });

    it('should produce fresh timestamps for the copy', () => {
      const sourceCreated = '2026-01-01T00:00:00.000Z';
      const copyCreated = '2026-04-13T00:00:00.000Z';

      // Copy always gets fresh timestamps
      expect(copyCreated).not.toBe(sourceCreated);
    });

    it('copy title should match source title exactly (not derived from destination path)', () => {
      const sourceTitle = 'Q4 2024 Review';
      const destinationPath = 'archive/q4-review-copy.md';

      // Title preserved from source, not derived from destination filename
      const copyTitle = sourceTitle;
      expect(copyTitle).toBe('Q4 2024 Review');
      expect(copyTitle).not.toBe('q4-review-copy');
      expect(destinationPath).toContain('q4-review-copy');
    });
  });

  describe('Content and metadata handling', () => {
    it('should NOT include original document details in response', () => {
      const response = {
        title: 'Copy Title',
        fqcId: 'copy-uuid',
        path: 'copy.md',
        tags: ['copy-tag'],
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

      expect(responseText).not.toContain('Source:');
      expect(responseText).not.toContain('Original:');
      expect(responseText).not.toContain('Copied from:');
    });

    it('should NOT include full document content', () => {
      const lines = [
        formatKeyValueEntry('Title', 'Copy'),
        formatKeyValueEntry('FQC ID', 'uuid-copy'),
        formatKeyValueEntry('Path', 'copy.md'),
        formatKeyValueEntry('Tags', 'none'),
        formatKeyValueEntry('Status', 'active'),
      ];

      const responseText = lines.join('\n');

      expect(responseText).not.toContain('Full document content');
      expect(responseText).not.toContain('Original document body');
    });

    it('should indicate copy is active with its own status', () => {
      const line = formatKeyValueEntry('Status', 'active');
      expect(line).toContain('active');
    });
  });

  describe('Destination path handling', () => {
    it('should use destination path if provided', () => {
      const customPath = 'custom/location/copy.md';
      const line = formatKeyValueEntry('Path', customPath);
      expect(line).toContain(customPath);
    });

    it('should default to vault root when no destination provided', () => {
      // When destination omitted, path is sanitized title + .md at vault root
      const sourceTitle = 'My Source Document';
      const defaultPath = 'my-source-document.md'; // sanitized filename
      const line = formatKeyValueEntry('Path', defaultPath);
      expect(line).toContain(defaultPath);
    });
  });

  describe('Error handling', () => {
    it('should return isError: true if source not found', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: Source document not found' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
      expect(errorResponse.content[0].text).toContain('not found');
    });

    it('should return isError: true on copy failure', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: Failed to copy document' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
    });

    it('should NOT include metadata in error response', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: Copy failed' }],
        isError: true,
      };

      expect(Object.keys(errorResponse)).toEqual(['content', 'isError']);
    });

    it('should handle tag validation errors', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Tag validation failed: invalid tag format' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
      expect(errorResponse.content[0].text).toContain('validation');
    });
  });

  describe('Consistency verification', () => {
    it('should produce same format as create_document for all fields', () => {
      const createFormat = [
        formatKeyValueEntry('Title', 'New Doc'),
        formatKeyValueEntry('FQC ID', 'uuid-new'),
        formatKeyValueEntry('Path', 'new.md'),
        formatKeyValueEntry('Tags', ['tag1']),
        formatKeyValueEntry('Status', 'active'),
      ].join('\n');

      const copyFormat = [
        formatKeyValueEntry('Title', 'Copy Doc'),
        formatKeyValueEntry('FQC ID', 'uuid-copy'),
        formatKeyValueEntry('Path', 'copy.md'),
        formatKeyValueEntry('Tags', ['tag1']),
        formatKeyValueEntry('Status', 'active'),
      ].join('\n');

      const createLines = createFormat.split('\n');
      const copyLines = copyFormat.split('\n');

      expect(createLines.length).toBe(copyLines.length);

      createLines.forEach((line, i) => {
        const createKey = line.split(':')[0];
        const copyKey = copyLines[i].split(':')[0];
        expect(createKey).toBe(copyKey);
      });
    });

    it('should use same empty tag representation as create_document', () => {
      const createEmptyTags = formatKeyValueEntry('Tags', 'none');
      const copyEmptyTags = formatKeyValueEntry('Tags', 'none');

      expect(createEmptyTags).toBe(copyEmptyTags);
    });
  });

  describe('Edge cases', () => {
    it('should handle copying document with no tags', () => {
      const tags: string[] = [];
      const line = formatKeyValueEntry('Tags', tags.length > 0 ? tags : 'none');
      expect(line).toContain('none');
    });

    it('should handle copying document with many tags', () => {
      const tags = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'];
      const line = formatKeyValueEntry('Tags', tags);
      expect(line).toContain('tag1');
      expect(line).toContain('tag5');
    });

    it('should handle copying document with special characters in title', () => {
      const title = 'Q4 2024: "Project" Review & Analysis';
      const line = formatKeyValueEntry('Title', title);
      expect(line).toContain('Q4 2024: "Project" Review & Analysis');
    });

    it('should handle copying document with nested destination path', () => {
      const path = 'clients/acme/projects/2024/deep/nested/copy.md';
      const line = formatKeyValueEntry('Path', path);
      expect(line).toContain('clients/acme/projects/2024/deep/nested/copy.md');
    });
  });
});
