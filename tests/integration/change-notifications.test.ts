/**
 * Integration tests: Change notification callbacks (Phase 58).
 * Tests: getWatcherMap(), invokeChangeNotifications(), fqc_change_queue operations.
 * Requires: Supabase running, SUPABASE_SERVICE_ROLE_KEY set.
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { getWatcherMap, invokeChangeNotifications } from '../../src/services/discovery-orchestrator.js';
import type { ChangePayload } from '../../src/services/plugin-skill-invoker.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SKIP = !HAS_SUPABASE;
const TEST_INSTANCE_ID = 'change-notification-test-' + Date.now();

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'change-notification-test',
      id: TEST_INSTANCE_ID,
      vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

describe.skipIf(SKIP)('Change Notifications Integration', () => {
  beforeAll(async () => {
    const config = makeConfig();
    initLogger(config);
    await initSupabase(config);

    // Create test vault instance
    const { error: vaultError } = await supabaseManager.getClient()
      .from('fqc_vault')
      .insert({
        id: TEST_INSTANCE_ID,
        name: 'test-change-notification-vault',
        vault_path: '/tmp/test-vault',
      });

    if (vaultError) {
      throw new Error(`Failed to create test vault: ${vaultError.message}`);
    }
  });

  afterAll(async () => {
    const client = supabaseManager.getClient();

    // Cleanup: delete test data in order (respecting foreign keys)
    await client.from('fqc_change_queue').delete().eq('instance_id', TEST_INSTANCE_ID);
    await client.from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await client.from('fqc_vault').delete().eq('id', TEST_INSTANCE_ID);
    await supabaseManager.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: getWatcherMap retrieves watcher claims
  // ─────────────────────────────────────────────────────────────────────────

  describe('getWatcherMap()', () => {
    it('should retrieve watcher_claims from database', async () => {
      const client = supabaseManager.getClient();

      // Create a test document with watchers
      const { data: doc, error: docError } = await client
        .from('fqc_documents')
        .insert({
          instance_id: TEST_INSTANCE_ID,
          path: 'test/document.md',
          title: 'Test Doc',
          status: 'active',
          content_hash: 'abc123',
          watcher_claims: {
            email: 'read_write_watcher',
            audit: 'read_only_watcher',
          },
        })
        .select('id')
        .single();

      expect(docError).toBeNull();

      // Retrieve watcher map
      const watcherMap = await getWatcherMap(doc!.id);

      // Verify structure
      expect(watcherMap.has('read_write_watcher')).toBe(true);
      expect(watcherMap.has('read_only_watcher')).toBe(true);
      expect(watcherMap.get('read_write_watcher')).toContain('email');
      expect(watcherMap.get('read_only_watcher')).toContain('audit');
    });

    it('should return empty map for document with no watchers', async () => {
      const client = supabaseManager.getClient();

      const { data: doc, error: docError } = await client
        .from('fqc_documents')
        .insert({
          instance_id: TEST_INSTANCE_ID,
          path: 'test/document2.md',
          title: 'Test Doc 2',
          status: 'active',
          content_hash: 'def456',
          watcher_claims: {},
        })
        .select('id')
        .single();

      expect(docError).toBeNull();

      const watcherMap = await getWatcherMap(doc!.id);

      expect(watcherMap.size).toBe(0);
    });

    it('should return empty map for non-existent document', async () => {
      const watcherMap = await getWatcherMap('non-existent-uuid-12345678');

      expect(watcherMap.size).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: invokeChangeNotifications basic functionality
  // ─────────────────────────────────────────────────────────────────────────

  describe('invokeChangeNotifications()', () => {
    it('should handle on_document_changed callback invocation', async () => {
      const changePayload: ChangePayload = {
        content: 'Updated content',
        modified_at: new Date().toISOString(),
        size_bytes: 1024,
        content_hash: 'newHash123',
      };

      const result = await invokeChangeNotifications(
        'test/document.md',
        'doc-uuid-123',
        changePayload,
        'crm', // owner
        new Map(), // no watchers
        'on_document_changed'
      );

      expect(result.pluginResults).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('should handle on_document_deleted callback invocation', async () => {
      const result = await invokeChangeNotifications(
        'test/document.md',
        'doc-uuid-123',
        null, // null for deletions
        'crm',
        new Map(),
        'on_document_deleted'
      );

      expect(result.pluginResults).toBeDefined();
      expect(result.errors).toBeDefined();
    });

    it('should invoke with owner and watchers', async () => {
      const watcherMap = new Map<string, string[]>([
        ['read_write_watcher', ['email']],
        ['read_only_watcher', ['audit']],
      ]);

      const result = await invokeChangeNotifications(
        'test/document.md',
        'doc-uuid-123',
        { modified_at: new Date().toISOString() },
        'crm',
        watcherMap,
        'on_document_changed'
      );

      expect(result.pluginResults).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Change queue table operations
  // ─────────────────────────────────────────────────────────────────────────

  describe('fqc_change_queue operations', () => {
    it('should insert and retrieve change queue rows', async () => {
      const client = supabaseManager.getClient();

      // Create a test document
      const { data: doc } = await client
        .from('fqc_documents')
        .insert({
          instance_id: TEST_INSTANCE_ID,
          path: 'test/queue-test.md',
          title: 'Queue Test',
          status: 'active',
          content_hash: 'qh123',
        })
        .select('id')
        .single();

      // Insert change queue row
      const { error: queueError } = await client
        .from('fqc_change_queue')
        .insert({
          instance_id: TEST_INSTANCE_ID,
          fqc_id: doc!.id,
          change_type: 'modified',
          detected_at: new Date().toISOString(),
          changes: {
            content: 'Updated content',
            modified_at: new Date().toISOString(),
          },
          delivery_status: 'pending',
        });

      expect(queueError).toBeNull();

      // Retrieve and verify
      const { data: queueRows } = await client
        .from('fqc_change_queue')
        .select('*')
        .eq('fqc_id', doc!.id);

      expect(queueRows).toHaveLength(1);
      expect(queueRows![0].delivery_status).toBe('pending');
    });

    it('should update change queue delivery status', async () => {
      const client = supabaseManager.getClient();

      // Create a test document
      const { data: doc } = await client
        .from('fqc_documents')
        .insert({
          instance_id: TEST_INSTANCE_ID,
          path: 'test/queue-update-test.md',
          title: 'Queue Update Test',
          status: 'active',
          content_hash: 'qut123',
        })
        .select('id')
        .single();

      // Insert change queue row
      const { data: queueData } = await client
        .from('fqc_change_queue')
        .insert({
          instance_id: TEST_INSTANCE_ID,
          fqc_id: doc!.id,
          change_type: 'modified',
          detected_at: new Date().toISOString(),
          delivery_status: 'pending',
        })
        .select('id')
        .single();

      // Update delivery status
      const { error: updateError } = await client
        .from('fqc_change_queue')
        .update({
          delivery_status: 'delivered',
          plugin_delivery: {
            crm: 'acknowledged',
            email: 'acknowledged',
          },
        })
        .eq('id', queueData!.id);

      expect(updateError).toBeNull();

      // Verify update
      const { data: updated } = await client
        .from('fqc_change_queue')
        .select('*')
        .eq('id', queueData!.id)
        .single();

      expect(updated!.delivery_status).toBe('delivered');
      expect(updated!.plugin_delivery.crm).toBe('acknowledged');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: Multiple watcher scenario
  // ─────────────────────────────────────────────────────────────────────────

  describe('Multiple watchers scenario', () => {
    it('should invoke multiple watchers of same type', async () => {
      const watcherMap = new Map<string, string[]>([
        ['read_write_watcher', ['email', 'slack', 'teams']],
      ]);

      const result = await invokeChangeNotifications(
        'test/multi-watcher.md',
        'doc-uuid-456',
        { modified_at: new Date().toISOString() },
        'crm',
        watcherMap,
        'on_document_changed'
      );

      // All watchers should be invoked
      expect(result.pluginResults.has('email')).toBe(true);
      expect(result.pluginResults.has('slack')).toBe(true);
      expect(result.pluginResults.has('teams')).toBe(true);
      expect(result.pluginResults.has('crm')).toBe(true);
    });
  });
});
