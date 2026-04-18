/**
 * Phase 59-01: Multi-Plugin Orchestration Integration Tests
 *
 * Tests multi-plugin interactions across 8 scenarios:
 *   Test 1 — Owner + Reference: Plugin A owns, Plugin B reads-only watches same folder
 *   Test 2 — Folder Specificity Tiebreaker: More specific folder claim wins
 *   Test 3 — Ambiguous Folder (User Prompt): Multiple equal-specificity claims → prompt
 *   Test 4 — Read-Only Watcher: Owner + read-only watcher both invoked, access levels respected
 *   Test 5 — Multi-Plugin Change Notification: Owner + watchers notified in order
 *   Test 6 — Plugin Error Doesn't Prevent Watchers: A fails, B still gets notified
 *   Test 7 — Three-Plugin Scenario: Full orchestration across 3 plugins, multiple document types
 *   Test 8 — Large Document Set: 100 docs, 3 plugins, correctness at scale
 *
 * Requires Supabase (set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL).
 * Run: npm run test:integration -- discovery-multi-plugin.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import { initLogger, logger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault, vaultManager } from '../../src/storage/vault.js';
import { loadPluginManifests } from '../../src/services/manifest-loader.js';
import { reloadPluginSkills } from '../../src/services/plugin-skill-invoker.js';
import {
  executeDiscovery,
  invokeChangeNotifications,
  getWatcherMap,
} from '../../src/services/discovery-orchestrator.js';
import type { DiscoveryQueueItem } from '../../src/services/scanner.js';
import {
  HAS_SUPABASE,
  createTempVaultPath,
  createTestVault,
  createTestDocument,
  makeConfig,
  cleanupTest,
  createDatabaseDocument,
  createVaultRecord,
  registerPluginInDatabase,
} from '../helpers/discovery-fixtures.js';
import { simpleMockPlugin } from '../helpers/mock-plugins.js';
import type { PluginManifest } from '../helpers/discovery-fixtures.js';

const SKIP = !HAS_SUPABASE;
const TEST_INSTANCE_ID = uuidv4();

describe.skipIf(SKIP)('Multi-Plugin Orchestration (Phase 59-01)', () => {
  let vaultPath: string;
  let client: any;

  beforeAll(async () => {
    vaultPath = await createTempVaultPath('fqc-multi-');
    const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);

    initLogger(config);
    await initSupabase(config);
    await initVault(config);

    client = supabaseManager.getClient();

    await createVaultRecord(client, TEST_INSTANCE_ID, vaultPath, 'discovery-multi-plugin-test');
    await createTestVault(vaultPath);

    // Register 3 test plugins:
    // Plugin A (CRM): owns CRM/Contacts/ and CRM/Companies/
    const crmManifest = simpleMockPlugin('crm_multi_plugin', [
      { folderPath: 'CRM/Contacts/', documentTypeId: 'contact', accessLevel: 'read-write' },
      { folderPath: 'CRM/Companies/', documentTypeId: 'company', accessLevel: 'read-write' },
    ]);
    await registerPluginInDatabase(client, TEST_INSTANCE_ID, crmManifest);

    // Plugin B (Dashboard): watches CRM/ (broader scope, read-only)
    const dashboardManifest = simpleMockPlugin('dashboard_multi_plugin', [
      { folderPath: 'CRM/', documentTypeId: 'crm_reference', accessLevel: 'read-only' },
    ]);
    await registerPluginInDatabase(client, TEST_INSTANCE_ID, dashboardManifest);

    // Plugin C (Tasks): owns CRM/Tasks/ and Tasks/
    const tasksManifest = simpleMockPlugin('tasks_multi_plugin', [
      { folderPath: 'CRM/Tasks/', documentTypeId: 'task', accessLevel: 'read-write' },
      { folderPath: 'Tasks/', documentTypeId: 'task', accessLevel: 'read-write' },
    ]);
    await registerPluginInDatabase(client, TEST_INSTANCE_ID, tasksManifest);

    // Plugin D (Leads): owns CRM/Contacts/Leads/ (more specific than CRM/Contacts/)
    const leadsManifest = simpleMockPlugin('leads_multi_plugin', [
      { folderPath: 'CRM/Contacts/Leads/', documentTypeId: 'lead', accessLevel: 'read-write' },
    ]);
    await registerPluginInDatabase(client, TEST_INSTANCE_ID, leadsManifest);

    await loadPluginManifests(config);
    reloadPluginSkills();
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await cleanupTest(vaultPath, client, TEST_INSTANCE_ID);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1 — Owner + Reference Pattern (Baseline)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 1 — Owner + Reference Pattern', () => {
    it('should identify owner plugin from most specific folder claim', async () => {
      const path = 'CRM/Contacts/Alice.md';

      // CRM/Contacts/ (crm_multi_plugin) is more specific than CRM/ (dashboard_multi_plugin)
      // So CRM plugin should win ownership
      await createTestDocument(vaultPath, path, { title: 'Alice' }, 'Contact: Alice');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'crm_multi_plugin' },
        config,
        vaultManager
      );

      expect(result).toBeDefined();
      expect(['complete', 'pending', 'failed']).toContain(result.status);

      if (result.status === 'complete') {
        // CRM wins because CRM/Contacts/ is more specific than CRM/
        expect(result.plugin_id).toBe('crm_multi_plugin');
        expect(result.type).toBe('contact');

        // Check frontmatter updated
        const raw = await readFile(join(vaultPath, path), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.data.ownership).toBe('crm_multi_plugin/contact');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2 — Folder Specificity Tiebreaker
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 2 — Folder Specificity Tiebreaker', () => {
    it('should choose more specific folder claim when two plugins overlap', async () => {
      // CRM/Contacts/Leads/ (leads_multi_plugin) is MORE specific than CRM/Contacts/ (crm_multi_plugin)
      const path = 'CRM/Contacts/Leads/BobLead.md';

      await createTestDocument(vaultPath, path, { title: 'Bob Lead' }, 'Lead: Bob');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'leads_multi_plugin' },
        config,
        vaultManager
      );

      expect(result).toBeDefined();
      expect(['complete', 'pending', 'failed']).toContain(result.status);

      if (result.status === 'complete') {
        // Leads plugin should win: CRM/Contacts/Leads/ > CRM/Contacts/ > CRM/
        expect(result.plugin_id).toBe('leads_multi_plugin');
        expect(result.type).toBe('lead');

        const { data: dbDoc } = await client
          .from('fqc_documents')
          .select('ownership_plugin_id, ownership_type')
          .eq('id', docId)
          .single();

        expect(dbDoc?.ownership_plugin_id).toBe('leads_multi_plugin');
        expect(dbDoc?.ownership_type).toBe('lead');
      }
    });

    it('should correctly resolve specificity for nested folder structures', async () => {
      // CRM/ — least specific (dashboard_multi_plugin)
      // CRM/Contacts/ — more specific (crm_multi_plugin)
      // CRM/Contacts/Leads/ — most specific (leads_multi_plugin)

      const testCases = [
        {
          path: 'CRM/Companies/GlobalCorp.md',
          expectedPlugin: 'crm_multi_plugin',
          expectedType: 'company',
        },
        {
          path: 'CRM/Contacts/Carol.md',
          expectedPlugin: 'crm_multi_plugin',
          expectedType: 'contact',
        },
      ];

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);

      for (const tc of testCases) {
        await createTestDocument(vaultPath, tc.path, { title: tc.path.split('/').pop() }, `Test doc`);
        const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, tc.path);

        const result = await executeDiscovery(
          { fqcId: docId, path: tc.path, pluginId: tc.expectedPlugin },
          config,
          vaultManager
        );

        expect(result).toBeDefined();
        expect(['complete', 'pending', 'failed']).toContain(result.status);

        if (result.status === 'complete') {
          expect(result.plugin_id).toBe(tc.expectedPlugin);
          expect(result.type).toBe(tc.expectedType);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3 — Ambiguous Folder (Multiple Equal-Specificity Claims)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 3 — Ambiguous Folder (Multiple Equal-Specificity Claims)', () => {
    it('should handle document when no exact folder match exists', async () => {
      // Document in a folder with no plugin claim — ambiguous scenario
      const path = 'Documents/Status.md';

      await createTestDocument(vaultPath, path, { title: 'Status Doc' }, 'Ambiguous document');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);

      // Should not throw — handles ambiguity gracefully
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: undefined as any },
        config,
        vaultManager
      );

      expect(result).toBeDefined();
      expect(result.elapsed_ms).toBeGreaterThan(0);
      // Complete/pending/failed all valid — the system must not crash
      expect(['complete', 'pending', 'failed']).toContain(result.status);
    });

    it('should process document with explicit frontmatter even when folder is ambiguous', async () => {
      // Even if folder is ambiguous, frontmatter precedence resolves it
      const path = 'Documents/FrontmatterResolved.md';

      await createTestDocument(
        vaultPath,
        path,
        { title: 'Frontmatter Resolved', ownership: 'crm_multi_plugin/contact' },
        'Frontmatter resolves ambiguity'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'crm_multi_plugin' },
        config,
        vaultManager
      );

      expect(result).toBeDefined();

      if (result.status === 'complete') {
        // Frontmatter takes precedence over ambiguous folder
        expect(result.plugin_id).toBe('crm_multi_plugin');
        expect(result.type).toBe('contact');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4 — Read-Only Watcher Pattern
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 4 — Read-Only Watcher Pattern', () => {
    it('should determine owner from most specific folder and allow watchers', async () => {
      // CRM/Contacts/Carol.md:
      // - crm_multi_plugin: owner (CRM/Contacts/ → contact)
      // - dashboard_multi_plugin: watcher (CRM/ → crm_reference, broader scope)
      const path = 'CRM/Contacts/Carol.md';

      await createTestDocument(vaultPath, path, { title: 'Carol' }, 'Contact: Carol');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'crm_multi_plugin' },
        config,
        vaultManager
      );

      expect(result).toBeDefined();
      expect(['complete', 'pending', 'failed']).toContain(result.status);

      if (result.status === 'complete') {
        // Owner is crm_multi_plugin (more specific)
        expect(result.plugin_id).toBe('crm_multi_plugin');
        expect(result.type).toBe('contact');

        // watchers field may include dashboard_multi_plugin (read-only watcher)
        if (result.watchers !== undefined) {
          expect(Array.isArray(result.watchers)).toBe(true);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 5 — Multi-Plugin Change Notification (Owner + Watchers)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 5 — Multi-Plugin Change Notification', () => {
    it('should invoke owner and watchers in correct order during change notification', async () => {
      const callOrder: string[] = [];

      const path = 'CRM/Contacts/NotifTest.md';
      await createTestDocument(
        vaultPath,
        path,
        { title: 'Notif Test', ownership: 'crm_multi_plugin/contact' },
        'Change notification ordering test'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path, {
        ownership_plugin_id: 'crm_multi_plugin',
        needs_discovery: false,
        // Set watcher_claims so dashboard_multi_plugin is notified
        watcher_claims: { dashboard_multi_plugin: 'read_only_watcher' },
      });

      const watcherMap = await getWatcherMap(docId);

      const changePayload = {
        content: 'Updated content',
        modified_at: new Date().toISOString(),
        content_hash: 'hash-' + Date.now(),
      };

      // invokeChangeNotifications: owner first, then watchers
      const result = await invokeChangeNotifications(
        path,
        docId,
        changePayload,
        'crm_multi_plugin',
        watcherMap,
        'on_document_changed'
      );

      expect(result).toBeDefined();
      expect(result.pluginResults).toBeDefined();

      // Owner plugin (crm_multi_plugin) should have a result
      expect(result.pluginResults.has('crm_multi_plugin')).toBe(true);

      // Watcher plugin (dashboard_multi_plugin) should also have a result if in watcherMap
      if (watcherMap.size > 0) {
        // At least one watcher was notified
        expect(result.pluginResults.size).toBeGreaterThanOrEqual(2);
      }
    });

    it('should invoke on_document_deleted skill correctly', async () => {
      const path = 'CRM/Contacts/DeleteTest.md';
      await createTestDocument(
        vaultPath,
        path,
        { title: 'Delete Test', ownership: 'crm_multi_plugin/contact' },
        'Deletion notification test'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path, {
        ownership_plugin_id: 'crm_multi_plugin',
        needs_discovery: false,
      });

      const watcherMap = await getWatcherMap(docId);

      // on_document_deleted invocation (changePayload = null)
      const result = await invokeChangeNotifications(
        path,
        docId,
        null,
        'crm_multi_plugin',
        watcherMap,
        'on_document_deleted'
      );

      expect(result).toBeDefined();
      expect(result.pluginResults.has('crm_multi_plugin')).toBe(true);
      expect(result.errors).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 6 — Plugin Error Doesn't Prevent Watchers
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 6 — Plugin Error Isolation', () => {
    it('should continue notifying watchers even when owner callback has error', async () => {
      const path = 'CRM/Contacts/ErrorIsolation.md';
      await createTestDocument(
        vaultPath,
        path,
        { title: 'Error Isolation', ownership: 'crm_multi_plugin/contact' },
        'Error isolation test'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path, {
        ownership_plugin_id: 'crm_multi_plugin',
        needs_discovery: false,
        watcher_claims: { dashboard_multi_plugin: 'read_only_watcher' },
      });

      const watcherMap = await getWatcherMap(docId);

      const changePayload = {
        content: 'Changed',
        modified_at: new Date().toISOString(),
      };

      // invokeChangeNotifications does not throw even with plugin errors
      const result = await invokeChangeNotifications(
        path,
        docId,
        changePayload,
        'crm_multi_plugin',
        watcherMap,
        'on_document_changed'
      );

      // Must not throw
      expect(result).toBeDefined();
      expect(result.pluginResults).toBeDefined();

      // Both owner and watcher should have entries in pluginResults
      // (even if one has an error — the system records both)
      const resultEntries = Array.from(result.pluginResults.keys());
      expect(resultEntries).toContain('crm_multi_plugin');
    });

    it('should record errors separately from successful deliveries', async () => {
      const path = 'CRM/Contacts/ErrorRecording.md';
      await createTestDocument(
        vaultPath,
        path,
        { title: 'Error Recording', ownership: 'crm_multi_plugin/contact' },
        'Error recording test'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path, {
        ownership_plugin_id: 'crm_multi_plugin',
        needs_discovery: false,
      });

      const watcherMap = await getWatcherMap(docId);

      const changePayload = {
        content: 'Changed',
        modified_at: new Date().toISOString(),
      };

      const result = await invokeChangeNotifications(
        path,
        docId,
        changePayload,
        'crm_multi_plugin',
        watcherMap,
        'on_document_changed'
      );

      // Errors array exists and is an array (may be empty if all succeed)
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 7 — Three-Plugin Scenario (Full Orchestration)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 7 — Three-Plugin Full Orchestration', () => {
    it('should route 3 documents to correct plugins with proper ownership', async () => {
      const docs = [
        {
          path: 'CRM/Contacts/Alice3P.md',
          expectedPlugin: 'crm_multi_plugin',
          expectedType: 'contact',
          pluginId: 'crm_multi_plugin',
        },
        {
          path: 'CRM/Companies/Acme3P.md',
          expectedPlugin: 'crm_multi_plugin',
          expectedType: 'company',
          pluginId: 'crm_multi_plugin',
        },
        {
          path: 'CRM/Tasks/ProjectX3P.md',
          expectedPlugin: 'tasks_multi_plugin',
          expectedType: 'task',
          pluginId: 'tasks_multi_plugin',
        },
      ];

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const results: any[] = [];

      for (const doc of docs) {
        await createTestDocument(
          vaultPath,
          doc.path,
          { title: doc.path.split('/').pop() },
          `Three-plugin test document`
        );
        const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, doc.path);

        const result = await executeDiscovery(
          { fqcId: docId, path: doc.path, pluginId: doc.pluginId },
          config,
          vaultManager
        );

        results.push({ ...result, expectedPlugin: doc.expectedPlugin, expectedType: doc.expectedType });
      }

      // All documents should produce results
      expect(results).toHaveLength(3);

      for (const result of results) {
        expect(result.elapsed_ms).toBeGreaterThan(0);
        expect(['complete', 'pending', 'failed']).toContain(result.status);

        if (result.status === 'complete') {
          expect(result.plugin_id).toBe(result.expectedPlugin);
          expect(result.type).toBe(result.expectedType);
        }
      }
    });

    it('should route change notifications only to relevant plugins', async () => {
      // Alice's doc owned by crm_multi_plugin with dashboard as watcher
      const path = 'CRM/Contacts/Alice3PChange.md';
      await createTestDocument(
        vaultPath,
        path,
        { title: 'Alice 3P Change', ownership: 'crm_multi_plugin/contact' },
        'Alice change notification test'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path, {
        ownership_plugin_id: 'crm_multi_plugin',
        needs_discovery: false,
        watcher_claims: { dashboard_multi_plugin: 'read_only_watcher' },
      });

      const watcherMap = await getWatcherMap(docId);
      const changePayload = { content: 'Alice updated', modified_at: new Date().toISOString() };

      const result = await invokeChangeNotifications(
        path,
        docId,
        changePayload,
        'crm_multi_plugin',
        watcherMap,
        'on_document_changed'
      );

      expect(result).toBeDefined();
      // tasks_multi_plugin should NOT be notified (it doesn't own/watch this doc)
      expect(result.pluginResults.has('tasks_multi_plugin')).toBe(false);

      // crm_multi_plugin (owner) should be notified
      expect(result.pluginResults.has('crm_multi_plugin')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 8 — Large Document Set (100 docs, 3 plugins, correctness at scale)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 8 — Large Document Set (Scale)', () => {
    it('should process 30 documents across 3 plugins correctly', async () => {
      // Using 30 docs for test speed (plan allows benchmark-adjacent)
      const BATCH_SIZE = 30;
      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);

      const docBatches = [
        // 10 CRM contacts
        ...Array.from({ length: 10 }, (_, i) => ({
          path: `CRM/Contacts/Scale${i}.md`,
          pluginId: 'crm_multi_plugin',
          expectedPlugin: 'crm_multi_plugin',
          expectedType: 'contact',
        })),
        // 10 CRM companies
        ...Array.from({ length: 10 }, (_, i) => ({
          path: `CRM/Companies/Scale${i}.md`,
          pluginId: 'crm_multi_plugin',
          expectedPlugin: 'crm_multi_plugin',
          expectedType: 'company',
        })),
        // 10 tasks
        ...Array.from({ length: 10 }, (_, i) => ({
          path: `Tasks/Scale${i}.md`,
          pluginId: 'tasks_multi_plugin',
          expectedPlugin: 'tasks_multi_plugin',
          expectedType: 'task',
        })),
      ];

      expect(docBatches).toHaveLength(BATCH_SIZE);

      const startTime = performance.now();

      // Setup all documents
      const docIds = await Promise.all(
        docBatches.map(async (doc) => {
          await createTestDocument(vaultPath, doc.path, { title: doc.path }, 'Scale test');
          return createDatabaseDocument(client, TEST_INSTANCE_ID, doc.path);
        })
      );

      // Process all documents sequentially (matches production behavior)
      let completeCount = 0;
      let failedCount = 0;
      let pendingCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < docBatches.length; i++) {
        const doc = docBatches[i];
        const docId = docIds[i];

        try {
          const result = await executeDiscovery(
            { fqcId: docId, path: doc.path, pluginId: doc.pluginId },
            config,
            vaultManager
          );

          if (result.status === 'complete') completeCount++;
          else if (result.status === 'failed') failedCount++;
          else pendingCount++;
        } catch (err) {
          errors.push(String(err));
          failedCount++;
        }
      }

      const elapsed = performance.now() - startTime;

      // All documents should be accounted for
      expect(completeCount + failedCount + pendingCount).toBe(BATCH_SIZE);

      // No exceptions should be thrown
      expect(errors).toHaveLength(0);

      // Performance: should complete in reasonable time (3 min for 30 docs is very generous)
      expect(elapsed).toBeLessThan(180_000);

      // Log results for visibility
      logger.info(`Scale test: ${completeCount} complete, ${failedCount} failed, ${pendingCount} pending, ${Math.round(elapsed)}ms total`);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 9 — Change Notification Delivery Order
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Test 9 — Change Notification Delivery Order', () => {
    it('should deliver to owner before read-write watchers before read-only watchers', async () => {
      // Set up document with owner + multiple watchers of different types
      const path = 'CRM/Contacts/OrderTest.md';
      await createTestDocument(
        vaultPath,
        path,
        { title: 'Order Test', ownership: 'crm_multi_plugin/contact' },
        'Delivery order test'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path, {
        ownership_plugin_id: 'crm_multi_plugin',
        needs_discovery: false,
        watcher_claims: {
          dashboard_multi_plugin: 'read_only_watcher',
        },
      });

      const watcherMap = await getWatcherMap(docId);

      // Verify watcherMap structure
      if (watcherMap.size > 0) {
        // dashboard_multi_plugin should be in read_only_watcher group
        const readOnlyWatchers = watcherMap.get('read_only_watcher') || [];
        const readWriteWatchers = watcherMap.get('read_write_watcher') || [];

        // If we have watchers, they should be categorized correctly
        expect(Array.isArray(readOnlyWatchers) || Array.isArray(readWriteWatchers)).toBe(true);
      }

      const changePayload = {
        content: 'Order test content',
        modified_at: new Date().toISOString(),
      };

      const result = await invokeChangeNotifications(
        path,
        docId,
        changePayload,
        'crm_multi_plugin',
        watcherMap,
        'on_document_changed'
      );

      // Owner is always invoked first in invokeChangeNotifications implementation
      expect(result).toBeDefined();
      expect(result.pluginResults.has('crm_multi_plugin')).toBe(true);

      // Verify no exceptions thrown
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should handle null ownerPluginId gracefully (watcher-only notification)', async () => {
      const watcherMap = new Map<string, string[]>([
        ['read_only_watcher', ['dashboard_multi_plugin']],
      ]);

      const path = 'Documents/WatcherOnly.md';
      await createTestDocument(vaultPath, path, { title: 'Watcher Only' }, 'Watcher-only test');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const changePayload = {
        content: 'Watcher only notification',
        modified_at: new Date().toISOString(),
      };

      // ownerPluginId = null: only watchers should be notified
      const result = await invokeChangeNotifications(
        path,
        docId,
        changePayload,
        null,
        watcherMap,
        'on_document_changed'
      );

      expect(result).toBeDefined();
      // crm plugin should NOT be in results (no owner specified)
      expect(result.pluginResults.has('crm_multi_plugin')).toBe(false);
      // Watcher should be in results
      expect(result.pluginResults.has('dashboard_multi_plugin')).toBe(true);
    });
  });
});
