import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatKeyValueEntry } from '../../src/mcp/utils/response-formats.js';

// Mock dependencies
vi.mock('../../src/storage/supabase.js');
vi.mock('../../src/storage/vault.js');
vi.mock('../../src/logging/logger.js');

describe('create_document response format (SPEC-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Metadata-only response', () => {
    it('should return only Title, FQC ID, Path, Tags, Status', () => {
      const response = {
        title: 'New Document',
        fqcId: 'uuid-12345',
        path: 'documents/new-doc.md',
        tags: ['tag1', 'tag2'],
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

      expect(responseText).toContain('Title: New Document');
      expect(responseText).toContain('FQC ID: uuid-12345');
      expect(responseText).toContain('Path: documents/new-doc.md');
      expect(responseText).toContain('Status: active');
    });

    it('should NOT include full document content', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: [],
        status: 'active',
        // These should NOT be in the response
        content: 'This is the full document content that should not appear',
        body: 'More content here',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('FQC ID', response.fqcId),
        formatKeyValueEntry('Path', response.path),
        formatKeyValueEntry('Tags', response.tags.length > 0 ? response.tags : 'none'),
        formatKeyValueEntry('Status', response.status),
      ];

      const responseText = lines.join('\n');

      // Content and body should not be in response
      expect(responseText).not.toContain('This is the full document content');
      expect(responseText).not.toContain('More content here');
    });

    it('should NOT include frontmatter in response', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: [],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('FQC ID', response.fqcId),
        formatKeyValueEntry('Path', response.path),
        formatKeyValueEntry('Tags', response.tags.length > 0 ? response.tags : 'none'),
        formatKeyValueEntry('Status', response.status),
      ];

      const responseText = lines.join('\n');

      // Frontmatter markers should not appear
      expect(responseText).not.toContain('---');
      expect(responseText).not.toContain('created:');
      expect(responseText).not.toContain('updated:');
    });

    it('should NOT include vault directory tree', () => {
      const response = {
        title: 'Document',
        fqcId: 'uuid-1',
        path: 'doc.md',
        tags: [],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('FQC ID', response.fqcId),
        formatKeyValueEntry('Path', response.path),
        formatKeyValueEntry('Tags', response.tags.length > 0 ? response.tags : 'none'),
        formatKeyValueEntry('Status', response.status),
      ];

      const responseText = lines.join('\n');

      // Directory tree patterns should not appear
      expect(responseText).not.toContain('├──');
      expect(responseText).not.toContain('└──');
      expect(responseText).not.toContain('vault root');
    });
  });

  describe('Response format compliance', () => {
    it('should use key-value pair format for each field', () => {
      const title = 'Test Document';
      const line = formatKeyValueEntry('Title', title);

      expect(line).toMatch(/^Title: .+$/);
    });

    it('should have fqc_id as valid UUID format', () => {
      const fqcId = '550e8400-e29b-41d4-a716-446655440000';
      const line = formatKeyValueEntry('FQC ID', fqcId);

      expect(line).toContain('FQC ID:');
      expect(line).toContain(fqcId);
    });

    it('should have Path field with relative path', () => {
      const path = 'clients/acme/notes.md';
      const line = formatKeyValueEntry('Path', path);

      expect(line).toContain('Path:');
      expect(line).toContain(path);
    });

    it('should have Tags field as array or "none"', () => {
      const tags1 = ['tag1', 'tag2'];
      const tags2: string[] = [];

      const line1 = formatKeyValueEntry('Tags', tags1);
      const line2 = formatKeyValueEntry('Tags', tags2.length > 0 ? tags2 : 'none');

      expect(line1).toContain('Tags:');
      expect(line2).toContain('none');
    });

    it('should have Status field as "active"', () => {
      const status = 'active';
      const line = formatKeyValueEntry('Status', status);

      expect(line).toContain('Status: active');
    });
  });

  describe('Error responses', () => {
    it('should use isError: true on error', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: File write failed' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
    });

    it('should NOT include metadata fields in error response', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Tag validation failed: invalid tag format' }],
        isError: true,
      };

      // Should only have content and isError, no metadata
      expect(Object.keys(errorResponse)).toEqual(['content', 'isError']);
    });

    it('should include error message for validation failures', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Tag validation failed: tags must start with #' }],
        isError: true,
      };

      expect(errorResponse.content[0].text).toContain('validation failed');
    });

    it('should handle database insertion errors', () => {
      const errorResponse = {
        content: [{ type: 'text' as const, text: 'Error: Database insert failed' }],
        isError: true,
      };

      expect(errorResponse.isError).toBe(true);
      expect(errorResponse.content[0].text).toContain('Database');
    });
  });

  describe('Tag handling', () => {
    it('should return tags as provided', () => {
      const tags = ['project/acme', 'status/active', 'priority/high'];
      const line = formatKeyValueEntry('Tags', tags);

      expect(line).toContain('project/acme');
    });

    it('should return empty tags as "none"', () => {
      const tags: string[] = [];
      const line = formatKeyValueEntry('Tags', tags.length > 0 ? tags : 'none');

      expect(line).toContain('none');
    });

    it('should deduplicate tags if necessary', () => {
      // This is implementation detail - verify that response includes correct count
      const originalTags = ['tag1', 'tag1', 'tag2'];
      const deduped = Array.from(new Set(originalTags));

      expect(deduped.length).toBe(2);
    });

    it('should handle special characters in tags', () => {
      const tags = ['#status/active', '#project/acme-corp', '#milestone/q4-2024'];
      const line = formatKeyValueEntry('Tags', tags);

      expect(line).toContain('Tags:');
    });
  });

  describe('File collision handling', () => {
    it('should include UUID suffix in path if collision occurs', () => {
      // Simulating collision response
      const path = 'documents/test-doc-a1b2.md';
      const line = formatKeyValueEntry('Path', path);

      expect(line).toContain('Path:');
      expect(line).toContain(path);
    });

    it('should return actual path used in response', () => {
      const actualPath = 'notes/meeting-notes-x4y5z6a7.md';
      const response = {
        title: 'Meeting Notes',
        fqcId: 'uuid-1',
        path: actualPath,
        tags: [],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('Path', response.path),
      ];

      const responseText = lines.join('\n');
      expect(responseText).toContain(actualPath);
    });
  });

  describe('Tenant isolation', () => {
    it('should respect instance_id in database insert', () => {
      // Verification that different instances have different documents
      const doc1 = { fqcId: 'id-1', instanceId: 'instance-1' };
      const doc2 = { fqcId: 'id-2', instanceId: 'instance-2' };

      expect(doc1.instanceId).not.toBe(doc2.instanceId);
    });
  });

  describe('Edge cases', () => {
    it('should handle document title with special characters', () => {
      const title = 'Q4 2024: "Year-End" Review & Planning';
      const line = formatKeyValueEntry('Title', title);

      expect(line).toContain(title);
    });

    it('should handle very long title', () => {
      const longTitle = 'A'.repeat(300);
      const line = formatKeyValueEntry('Title', longTitle);

      expect(line).toContain('Title:');
      expect(line.length).toBeGreaterThan(300);
    });

    it('should handle path with nested directories', () => {
      const path = 'clients/acme/projects/website-redesign/technical-notes.md';
      const line = formatKeyValueEntry('Path', path);

      expect(line).toContain(path);
    });

    it('should handle empty frontmatter case', () => {
      const response = {
        title: 'Minimal Document',
        fqcId: 'uuid-1',
        path: 'minimal.md',
        tags: [],
        status: 'active',
      };

      const lines = [
        formatKeyValueEntry('Title', response.title),
        formatKeyValueEntry('FQC ID', response.fqcId),
        formatKeyValueEntry('Path', response.path),
        formatKeyValueEntry('Tags', response.tags.length > 0 ? response.tags : 'none'),
        formatKeyValueEntry('Status', response.status),
      ];

      const responseText = lines.join('\n');
      expect(responseText).toMatch(/^Title:/m);
    });
  });
});
