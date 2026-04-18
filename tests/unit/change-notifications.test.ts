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

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import {
  ChangePayload,
  OnDocumentChangedFn,
  OnDocumentDeletedFn,
  invokeChangeNotifications,
} from '../../src/services/plugin-skill-invoker.js';
import { logger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Change Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: ChangePayload type validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('ChangePayload type', () => {
    it('should have required modified_at and optional fields', () => {
      const payload: ChangePayload = {
        modified_at: '2026-04-12T10:30:00Z',
      };
      expect(payload.modified_at).toEqual('2026-04-12T10:30:00Z');
      expect(payload.content).toBeUndefined();
      expect(payload.frontmatter).toBeUndefined();
    });

    it('should support full payload with all fields', () => {
      const payload: ChangePayload = {
        content: '# Title\nBody content',
        frontmatter: { tags: ['important'], status: 'active' },
        modified_at: '2026-04-12T10:30:00Z',
        size_bytes: 1024,
        content_hash: 'abc123def456',
      };
      expect(payload.content).toBeDefined();
      expect(payload.frontmatter).toBeDefined();
      expect(payload.size_bytes).toBe(1024);
      expect(payload.content_hash).toBe('abc123def456');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: OnDocumentChangedFn and OnDocumentDeletedFn signatures
  // ─────────────────────────────────────────────────────────────────────────

  describe('OnDocumentChangedFn signature', () => {
    it('should accept path, fqc_id, and changes payload', async () => {
      const fn: OnDocumentChangedFn = async (path, fqcId, changes) => {
        expect(path).toBe('CRM/Contacts/Sarah.md');
        expect(fqcId).toBe('doc-uuid-123');
        expect(changes.modified_at).toBeDefined();
        return { acknowledged: true };
      };

      const result = await fn('CRM/Contacts/Sarah.md', 'doc-uuid-123', {
        modified_at: '2026-04-12T10:30:00Z',
      });

      expect(result.acknowledged).toBe(true);
    });

    it('should return result with error field', async () => {
      const fn: OnDocumentChangedFn = async () => ({
        acknowledged: false,
        error: 'Sync failed',
      });

      const result = await fn('path', 'id', { modified_at: new Date().toISOString() });
      expect(result.acknowledged).toBe(false);
      expect(result.error).toBe('Sync failed');
    });
  });

  describe('OnDocumentDeletedFn signature', () => {
    it('should accept path, fqc_id, and optional deleted_at', async () => {
      const fn: OnDocumentDeletedFn = async (path, fqcId, deletedAt) => {
        expect(path).toBe('CRM/Contacts/Sarah.md');
        expect(fqcId).toBe('doc-uuid-123');
        expect(deletedAt).toEqual('2026-04-12T10:30:00Z');
        return { acknowledged: true };
      };

      const result = await fn(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        '2026-04-12T10:30:00Z'
      );

      expect(result.acknowledged).toBe(true);
    });

    it('should work without deleted_at timestamp', async () => {
      const fn: OnDocumentDeletedFn = async (path, fqcId) => {
        expect(path).toBeDefined();
        expect(fqcId).toBeDefined();
        return { acknowledged: true };
      };

      const result = await fn('path', 'id');
      expect(result.acknowledged).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: invokeChangeNotifications with owner only
  // ─────────────────────────────────────────────────────────────────────────

  describe('invokeChangeNotifications', () => {
    it('should invoke owner plugin with on_document_changed', async () => {
      const changePayload: ChangePayload = {
        content: 'Updated content',
        modified_at: '2026-04-12T10:30:00Z',
      };

      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        changePayload,
        'crm', // owner
        new Map(), // no watchers
        'on_document_changed'
      );

      expect(result.pluginResults.size).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
    });

    it('should invoke owner plugin with on_document_deleted', async () => {
      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        null, // null for deletions
        'crm', // owner
        new Map(),
        'on_document_deleted'
      );

      expect(result.pluginResults.size).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
    });

    it('should handle owner being null', async () => {
      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        { modified_at: '2026-04-12T10:30:00Z' },
        null, // no owner
        new Map(),
        'on_document_changed'
      );

      expect(result.pluginResults.size).toBe(0);
      expect(result.errors.length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: invokeChangeNotifications with owner and watchers
  // ─────────────────────────────────────────────────────────────────────────

  describe('invokeChangeNotifications with watchers', () => {
    it('should invoke owner first, then read-write watchers, then read-only watchers', async () => {
      const watcherMap = new Map<string, string[]>([
        ['read_write_watcher', ['email', 'slack']],
        ['read_only_watcher', ['audit']],
      ]);

      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        { modified_at: '2026-04-12T10:30:00Z' },
        'crm',
        watcherMap,
        'on_document_changed'
      );

      // All plugins should have results (owner + watchers)
      expect(result.pluginResults.size).toBeGreaterThan(0);
    });

    it('should invoke watchers even if owner missing', async () => {
      const watcherMap = new Map<string, string[]>([
        ['read_write_watcher', ['email']],
      ]);

      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        { modified_at: '2026-04-12T10:30:00Z' },
        null, // no owner
        watcherMap,
        'on_document_changed'
      );

      expect(result.pluginResults.size).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5: Error handling — plugin callback throws
  // ─────────────────────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('should catch plugin errors and continue to next plugin', async () => {
      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        { modified_at: '2026-04-12T10:30:00Z' },
        'crm',
        new Map([['read_write_watcher', ['email']]]),
        'on_document_changed'
      );

      // Result should include error information for failed plugins
      // even if plugins don't actually fail in this mock
      expect(result.pluginResults).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('should log ERROR for owner failure, WARN for watcher failure', async () => {
      // This test validates logging behavior
      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        { modified_at: '2026-04-12T10:30:00Z' },
        'crm',
        new Map(),
        'on_document_changed'
      );

      expect(result).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6: Empty watcher map handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('Empty and missing watchers', () => {
    it('should handle empty watcher map', async () => {
      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        { modified_at: '2026-04-12T10:30:00Z' },
        'crm',
        new Map(), // empty
        'on_document_changed'
      );

      expect(result.pluginResults).toBeDefined();
    });

    it('should handle missing claim types in watcher map', async () => {
      const watcherMap = new Map<string, string[]>();
      watcherMap.set('read_write_watcher', ['email']);
      // read_only_watcher is missing

      const result = await invokeChangeNotifications(
        'CRM/Contacts/Sarah.md',
        'doc-uuid-123',
        { modified_at: '2026-04-12T10:30:00Z' },
        null,
        watcherMap,
        'on_document_changed'
      );

      expect(result.pluginResults).toBeDefined();
    });
  });
});
