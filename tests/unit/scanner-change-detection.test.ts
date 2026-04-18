import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be before imports)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/mcp/tools/documents.js', async () => {
  const actual = await vi.importActual('../../src/mcp/tools/documents.js');
  const crypto = require('crypto');
  return {
    ...actual,
    computeHash: (content: string) => {
      return crypto.createHash('sha256').update(content).digest('hex');
    },
  };
});

import { detectChanges } from '../../src/services/scanner.js';

// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests for Change Detection
// ─────────────────────────────────────────────────────────────────────────────

describe('Scanner Change Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: No change — matching hash
  describe('detectChanges with matching hash', () => {
    it('should return changed=false when content hash matches', () => {
      const fileContent = '---\ntitle: Test\n---\n\nContent here';

      // Create a hash that matches by computing it the same way
      const crypto = require('crypto');
      const expectedHash = crypto.createHash('sha256').update(fileContent).digest('hex');

      const dbRow = {
        id: 'doc-uuid-123',
        path: 'test.md',
        content_hash: expectedHash,
        title: 'Test',
        status: 'active',
        updated_at: '2026-04-12T10:00:00Z',
      };

      const result = detectChanges(dbRow, fileContent);

      expect(result.changed).toBe(false);
      expect(result.newHash).toBe(expectedHash);
      expect(result.changes).toBeUndefined();
    });
  });

  // Test 2: Change detected — differing hash
  describe('detectChanges with differing hash', () => {
    it('should return changed=true with full ChangePayload when hash differs', () => {
      const oldContent = '---\ntitle: Test\n---\n\nOld content';
      const newContent = '---\ntitle: Test\n---\n\nNew content';

      const crypto = require('crypto');
      const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex');

      const dbRow = {
        id: 'doc-uuid-123',
        path: 'test.md',
        content_hash: oldHash,
        title: 'Test',
        status: 'active',
        updated_at: '2026-04-12T10:00:00Z',
      };

      const result = detectChanges(dbRow, newContent);

      expect(result.changed).toBe(true);
      expect(result.changes).toBeDefined();
      expect(result.changes!.content).toBe(newContent);
      expect(result.changes!.frontmatter.title).toBe('Test');
      expect(result.changes!.modified_at).toBeDefined();
      expect(result.changes!.size_bytes).toBeGreaterThan(0);
      expect(result.changes!.content_hash).toBeDefined();
    });

    it('should parse frontmatter in changes payload', () => {
      const oldContent = '---\ntitle: Old Title\ntags:\n  - tag1\n---\nContent';
      const newContent = '---\ntitle: New Title\ntags:\n  - tag1\n  - tag2\n---\nNew content';

      const crypto = require('crypto');
      const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex');

      const dbRow = {
        id: 'doc-uuid-123',
        path: 'test.md',
        content_hash: oldHash,
        title: 'Old Title',
        status: 'active',
        updated_at: '2026-04-12T10:00:00Z',
      };

      const result = detectChanges(dbRow, newContent);

      expect(result.changed).toBe(true);
      expect(result.changes!.frontmatter.title).toBe('New Title');
      expect(Array.isArray(result.changes!.frontmatter.tags)).toBe(true);
      expect((result.changes!.frontmatter.tags as string[]).length).toBe(2);
    });

    it('should compute correct size_bytes in UTF-8', () => {
      const oldContent = 'old';
      const newContent = '---\ntitle: Test\n---\n\nContent with émojis 🎉';

      const crypto = require('crypto');
      const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex');

      const dbRow = {
        id: 'doc-uuid-123',
        path: 'test.md',
        content_hash: oldHash,
        title: 'Test',
        status: 'active',
        updated_at: '2026-04-12T10:00:00Z',
      };

      const result = detectChanges(dbRow, newContent);

      expect(result.changed).toBe(true);
      expect(result.changes!.size_bytes).toBe(Buffer.byteLength(newContent, 'utf8'));
    });
  });

  // Test 3: Empty file change
  describe('detectChanges with empty content', () => {
    it('should detect change to empty content', () => {
      const oldContent = '---\ntitle: Test\n---\n\nContent';
      const newContent = '';

      const crypto = require('crypto');
      const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex');

      const dbRow = {
        id: 'doc-uuid-123',
        path: 'test.md',
        content_hash: oldHash,
        title: 'Test',
        status: 'active',
        updated_at: '2026-04-12T10:00:00Z',
      };

      const result = detectChanges(dbRow, newContent);

      expect(result.changed).toBe(true);
      expect(result.changes!.content).toBe('');
      expect(result.changes!.size_bytes).toBe(0);
    });
  });

  // Test 4: Whitespace-only change
  describe('detectChanges with whitespace changes', () => {
    it('should detect change when only whitespace differs', () => {
      const oldContent = 'content';
      const newContent = 'content  \n';

      const crypto = require('crypto');
      const oldHash = crypto.createHash('sha256').update(oldContent).digest('hex');

      const dbRow = {
        id: 'doc-uuid-123',
        path: 'test.md',
        content_hash: oldHash,
        title: 'Test',
        status: 'active',
        updated_at: '2026-04-12T10:00:00Z',
      };

      const result = detectChanges(dbRow, newContent);

      expect(result.changed).toBe(true);
      expect(result.newHash).not.toBe(oldHash);
    });
  });
});
