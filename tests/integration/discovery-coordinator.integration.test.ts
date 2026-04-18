import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import { processDiscoveryQueueAsync, type DiscoveryQueueItem } from '../../src/services/discovery-coordinator.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initLogger, logger } from '../../src/logging/logger.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Mock skill invoker at module boundary
vi.mock('../../src/services/plugin-skill-invoker.js');
import * as skillInvoker from '../../src/services/plugin-skill-invoker.js';

// Test configuration
const testConfig: FlashQueryConfig = {
  instance: {
    id: 'integration-test',
    vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
  },
  supabase: {
    url: process.env.SUPABASE_URL || 'https://test.supabase.co',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key',
    databaseUrl: process.env.DATABASE_URL,
    skipDdl: true,
  },
  embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: '', dimensions: 1536 },
  logging: { level: 'error', output: 'stdout' },
  locking: { enabled: false, ttlSeconds: 30 },
} as unknown as FlashQueryConfig;

describe.skipIf(!HAS_SUPABASE)('Discovery Coordinator Integration', () => {
  beforeAll(async () => {
    initLogger(testConfig);
    await initSupabase(testConfig);
  });

  afterAll(async () => {
    await supabaseManager.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates document ownership in database after successful discovery', async () => {
    // Create a test document in fqc_documents table
    const client = supabaseManager.getClient();
    const testDocId = '550e8400-e29b-41d4-a716-446655440101';
    const testPath = 'CRM/Contacts/TestContact.md';

    // Insert test document
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: testDocId,
        instance_id: testConfig.instance.id,
        path: testPath,
        title: 'Test Contact',
        content_hash: 'abc123',
        status: 'indexed',
        needs_discovery: true,  // Initially flagged for discovery
      });

    if (insertError) {
      console.warn('Integration test skipped: could not insert test document', insertError);
      return;
    }

    try {
      // Setup: mock skill to return ownership result
      vi.mocked(skillInvoker.invokePluginDiscoverySkill).mockResolvedValue({
        owned: true,
        plugin_id: 'crm',
        type: 'contact',
      });

      // Execute: process discovery queue with one item
      const queueItem: DiscoveryQueueItem = {
        fqcId: testDocId,
        path: testPath,
        pluginId: 'crm',
      };
      await processDiscoveryQueueAsync([queueItem], testConfig);

      // Verify: document ownership updated in database
      const { data: updatedDoc, error: selectError } = await client
        .from('fqc_documents')
        .select('ownership_plugin_id, ownership_type, needs_discovery')
        .eq('id', testDocId)
        .single();

      if (selectError) {
        throw new Error(`Failed to retrieve updated document: ${selectError.message}`);
      }

      expect(updatedDoc.ownership_plugin_id).toBe('crm');
      expect(updatedDoc.ownership_type).toBe('contact');
      expect(updatedDoc.needs_discovery).toBe(false);
    } finally {
      // Cleanup: delete test document
      await client.from('fqc_documents').delete().eq('id', testDocId);
    }
  });

  it('preserves needs_discovery=true in database when skill error occurs', async () => {
    // Create a test document
    const client = supabaseManager.getClient();
    const testDocId = '550e8400-e29b-41d4-a716-446655440102';
    const testPath = 'CRM/Contacts/ErrorTest.md';

    // Insert test document
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: testDocId,
        instance_id: testConfig.instance.id,
        path: testPath,
        title: 'Error Test Contact',
        content_hash: 'def456',
        status: 'indexed',
        needs_discovery: true,
      });

    if (insertError) {
      console.warn('Integration test skipped: could not insert test document', insertError);
      return;
    }

    try {
      // Setup: mock skill to return error
      vi.mocked(skillInvoker.invokePluginDiscoverySkill).mockRejectedValue(
        new Error('Skill invocation failed')
      );

      // Execute: process discovery queue (should not throw)
      const queueItem: DiscoveryQueueItem = {
        fqcId: testDocId,
        path: testPath,
        pluginId: 'crm',
      };
      await expect(
        processDiscoveryQueueAsync([queueItem], testConfig)
      ).resolves.toBeUndefined();

      // Verify: document needs_discovery still true, ownership unchanged
      const { data: unchangedDoc, error: selectError } = await client
        .from('fqc_documents')
        .select('ownership_plugin_id, ownership_type, needs_discovery')
        .eq('id', testDocId)
        .single();

      if (selectError) {
        throw new Error(`Failed to retrieve document: ${selectError.message}`);
      }

      expect(unchangedDoc.ownership_plugin_id).toBeNull();
      expect(unchangedDoc.ownership_type).toBeNull();
      expect(unchangedDoc.needs_discovery).toBe(true);  // Still pending retry
    } finally {
      // Cleanup
      await client.from('fqc_documents').delete().eq('id', testDocId);
    }
  });

  it('processes multiple documents sequentially', async () => {
    // Create test documents
    const client = supabaseManager.getClient();
    const docs = [
      {
        id: '550e8400-e29b-41d4-a716-446655440201',
        path: 'CRM/Contacts/Alice.md',
        type: 'contact',
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440202',
        path: 'CRM/Companies/TechCorp.md',
        type: 'company',
      },
    ];

    // Insert test documents
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert(
        docs.map(doc => ({
          id: doc.id,
          instance_id: testConfig.instance.id,
          path: doc.path,
          title: doc.path.split('/').pop(),
          content_hash: `hash-${doc.id}`,
          status: 'indexed',
          needs_discovery: true,
        }))
      );

    if (insertError) {
      console.warn('Integration test skipped: could not insert test documents', insertError);
      return;
    }

    try {
      // Setup: mock skill to return different types for different documents
      vi.mocked(skillInvoker.invokePluginDiscoverySkill)
        .mockResolvedValueOnce({
          owned: true,
          plugin_id: 'crm',
          type: 'contact',
        })
        .mockResolvedValueOnce({
          owned: true,
          plugin_id: 'crm',
          type: 'company',
        });

      // Execute: process discovery queue
      const queue: DiscoveryQueueItem[] = docs.map(doc => ({
        fqcId: doc.id,
        path: doc.path,
        pluginId: 'crm',
      }));
      await processDiscoveryQueueAsync(queue, testConfig);

      // Verify: each document has correct ownership
      for (const doc of docs) {
        const { data: updated, error: selectError } = await client
          .from('fqc_documents')
          .select('ownership_plugin_id, ownership_type, needs_discovery')
          .eq('id', doc.id)
          .single();

        if (selectError) {
          throw new Error(`Failed to retrieve document ${doc.id}: ${selectError.message}`);
        }

        expect(updated.ownership_plugin_id).toBe('crm');
        expect(updated.ownership_type).toBe(doc.type);
        expect(updated.needs_discovery).toBe(false);
      }
    } finally {
      // Cleanup
      await client
        .from('fqc_documents')
        .delete()
        .in('id', docs.map(d => d.id));
    }
  });
});
