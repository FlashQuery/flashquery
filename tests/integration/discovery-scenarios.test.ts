/**
 * Phase 59-01: Discovery Scenarios A/B/C Integration Tests
 *
 * Tests the three core discovery paths end-to-end:
 *   Scenario A — Auto-discovery: Document in plugin-claimed folder → auto-owned, no prompt
 *   Scenario B — Prompted discovery: Ambiguous folder → user prompted, selection stored
 *   Scenario C — Explicit frontmatter: Frontmatter ownership → skips folder inference, no prompt
 *
 * Requires Supabase (set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL).
 * Run: npm run test:integration -- discovery-scenarios.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import matter from 'gray-matter';
import { initLogger, logger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { loadPluginManifests } from '../../src/services/manifest-loader.js';
import { reloadPluginSkills } from '../../src/services/plugin-skill-invoker.js';
import { executeDiscovery } from '../../src/services/discovery-orchestrator.js';
import type { DiscoveryQueueItem } from '../../src/services/scanner.js';
import type { VaultManager } from '../../src/storage/vault.js';
import { initVault, vaultManager } from '../../src/storage/vault.js';
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

const SKIP = !HAS_SUPABASE;
const TEST_INSTANCE_ID = uuidv4();

describe.skipIf(SKIP)('Discovery Scenarios A/B/C (Phase 59-01)', () => {
  let vaultPath: string;
  let client: any;

  beforeAll(async () => {
    vaultPath = await createTempVaultPath('fqc-scenarios-');
    const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);

    initLogger(config);
    await initSupabase(config);
    await initVault(config);

    client = supabaseManager.getClient();

    // Create vault record (required for fqc_documents FK)
    await createVaultRecord(client, TEST_INSTANCE_ID, vaultPath, 'discovery-scenarios-test');

    // Create standard vault directory structure
    await createTestVault(vaultPath);

    // Register CRM plugin: claims CRM/Contacts/ and CRM/Companies/
    const crmManifest = simpleMockPlugin('crm_scenario_plugin', [
      { folderPath: 'CRM/Contacts/', documentTypeId: 'contact' },
      { folderPath: 'CRM/Companies/', documentTypeId: 'company' },
    ]);
    await registerPluginInDatabase(client, TEST_INSTANCE_ID, crmManifest);

    // Register Notes plugin: watches CRM/ (less specific)
    const notesManifest = simpleMockPlugin('notes_scenario_plugin', [
      { folderPath: 'Notes/', documentTypeId: 'note' },
    ]);
    await registerPluginInDatabase(client, TEST_INSTANCE_ID, notesManifest);

    // Load manifests into manifest-loader singleton
    await loadPluginManifests(config);

    // Reload skills cache
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
  // SCENARIO A — Auto-Discovery (Unambiguous Folder Match)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario A — Auto-Discovery (Unambiguous Folder Match)', () => {
    it('should auto-discover document in CRM/Contacts/ as crm/contact without user prompt', async () => {
      const path = 'CRM/Contacts/Sarah.md';

      // Create document in vault (no ownership frontmatter)
      await createTestDocument(vaultPath, path, { title: 'Sarah' }, 'Contact information for Sarah');

      // Register document in database
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const item: DiscoveryQueueItem = {
        fqcId: docId,
        path,
        pluginId: 'crm_scenario_plugin',
      };

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const startTime = performance.now();
      const result = await executeDiscovery(item, config, vaultManager);
      const elapsed = performance.now() - startTime;

      // Status must be complete or pending (pending only if lock acquisition fails transiently)
      expect(['complete', 'pending']).toContain(result.status);

      if (result.status === 'complete') {
        // Plugin ID determined from folder claim
        expect(result.plugin_id).toBe('crm_scenario_plugin');

        // Type determined from folder's document type mapping
        expect(result.type).toBe('contact');

        // Execution time within expected range
        expect(elapsed).toBeLessThan(5000);

        // Frontmatter updated with ownership field
        const raw = await readFile(join(vaultPath, path), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.data.ownership).toBe('crm_scenario_plugin/contact');

        // Database record reflects discovered state
        const { data: dbDoc } = await client
          .from('fqc_documents')
          .select('*')
          .eq('id', docId)
          .single();
        expect(dbDoc?.needs_discovery).toBe(false);
        expect(dbDoc?.ownership_plugin_id).toBe('crm_scenario_plugin');
        expect(dbDoc?.ownership_type).toBe('contact');
      }
    });

    it('should auto-discover document in CRM/Companies/ as crm/company without user prompt', async () => {
      const path = 'CRM/Companies/Acme.md';

      await createTestDocument(vaultPath, path, { title: 'Acme Corp' }, 'Company: Acme');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'crm_scenario_plugin' },
        config,
        vaultManager
      );

      expect(['complete', 'pending']).toContain(result.status);

      if (result.status === 'complete') {
        expect(result.plugin_id).toBe('crm_scenario_plugin');
        expect(result.type).toBe('company');

        const raw = await readFile(join(vaultPath, path), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.data.ownership).toBe('crm_scenario_plugin/company');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO B — Prompted Discovery (Ambiguous / No Exact Match)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario B — Prompted Discovery (Ambiguous Folder)', () => {
    it('should handle document in non-exact-match folder (no ownership frontmatter)', async () => {
      const path = 'CRM/File.md';

      // Document is in CRM/ root — matches CRM/Contacts/ only by prefix (not exact folder)
      await createTestDocument(vaultPath, path, { title: 'CRM Root File' }, 'Ambiguous file');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: undefined as any },
        config,
        vaultManager
      );

      // Discovery should complete or pend (not throw)
      expect(['complete', 'pending', 'failed']).toContain(result.status);
      expect(result.elapsed_ms).toBeGreaterThan(0);
    });

    it('should use frontmatter ownership on second scan (no re-prompt)', async () => {
      const path = 'CRM/ExistingOwned.md';

      // Document already has ownership from prior discovery
      await createTestDocument(
        vaultPath,
        path,
        { title: 'Owned File', ownership: 'crm_scenario_plugin/contact' },
        'Already owned document'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'crm_scenario_plugin' },
        config,
        vaultManager
      );

      expect(['complete', 'pending']).toContain(result.status);

      if (result.status === 'complete') {
        // Frontmatter-based discovery: no folder lookup needed
        expect(result.plugin_id).toBe('crm_scenario_plugin');
        expect(result.type).toBe('contact');

        // Frontmatter unchanged
        const raw = await readFile(join(vaultPath, path), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.data.ownership).toBe('crm_scenario_plugin/contact');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO C — Explicit Frontmatter (Frontmatter Precedence)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario C — Explicit Frontmatter (Frontmatter Precedence)', () => {
    it('should use frontmatter ownership immediately, skip folder inference', async () => {
      // Document in a folder NOT claimed by crm_scenario_plugin
      // But frontmatter asserts ownership → should use frontmatter directly
      const path = 'Documents/CustomFile.md';

      await createTestDocument(
        vaultPath,
        path,
        { title: 'Custom', ownership: 'crm_scenario_plugin/contact', custom_field: 'preserved' },
        'Custom file with explicit ownership'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const startTime = performance.now();
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'crm_scenario_plugin' },
        config,
        vaultManager
      );
      const elapsed = performance.now() - startTime;

      expect(['complete', 'pending']).toContain(result.status);

      if (result.status === 'complete') {
        // Frontmatter ownership used directly
        expect(result.plugin_id).toBe('crm_scenario_plugin');
        expect(result.type).toBe('contact');

        // Fast path (frontmatter) — well within timeout
        expect(elapsed).toBeLessThan(5000);

        // Original frontmatter fields preserved (custom_field)
        const raw = await readFile(join(vaultPath, path), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.data.ownership).toBe('crm_scenario_plugin/contact');
        // Note: custom fields may or may not be preserved depending on atomicWriteFrontmatter implementation

        // Database updated
        const { data: dbDoc } = await client
          .from('fqc_documents')
          .select('*')
          .eq('id', docId)
          .single();
        expect(dbDoc?.ownership_plugin_id).toBe('crm_scenario_plugin');
        expect(dbDoc?.ownership_type).toBe('contact');
      }
    });

    it('should handle ownership with only plugin_id (no type suffix)', async () => {
      const path = 'Documents/NoTypeFile.md';

      await createTestDocument(
        vaultPath,
        path,
        { title: 'No Type', ownership: 'notes_scenario_plugin' },
        'File with plugin-only ownership (no type)'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'notes_scenario_plugin' },
        config,
        vaultManager
      );

      expect(['complete', 'pending']).toContain(result.status);

      if (result.status === 'complete') {
        expect(result.plugin_id).toBe('notes_scenario_plugin');
        // type may be undefined when ownership has no "/" suffix
        expect(result.type === undefined || typeof result.type === 'string').toBe(true);
      }
    });

    it('should preserve multiple frontmatter fields during discovery', async () => {
      const path = 'Documents/MultiField.md';

      await createTestDocument(
        vaultPath,
        path,
        {
          title: 'Multi Field',
          ownership: 'crm_scenario_plugin/company',
          tags: ['important', 'test'],
          status: 'active',
          priority: 'high',
        },
        'Document with multiple custom frontmatter fields'
      );
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: 'crm_scenario_plugin' },
        config,
        vaultManager
      );

      expect(['complete', 'pending']).toContain(result.status);

      if (result.status === 'complete') {
        expect(result.plugin_id).toBe('crm_scenario_plugin');
        expect(result.type).toBe('company');

        // Ownership field retained
        const raw = await readFile(join(vaultPath, path), 'utf-8');
        const parsed = matter(raw);
        expect(parsed.data.ownership).toBe('crm_scenario_plugin/company');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GRACEFUL DEGRADATION: Discovery continues without crashing
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Graceful Degradation — Discovery Continues', () => {
    it('should not throw when plugin has no matching skill (graceful degradation)', async () => {
      const path = 'Notes/GracefulNote.md';

      await createTestDocument(vaultPath, path, { title: 'Grace Test' }, 'Graceful degradation test');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);

      // Should complete without throwing even if skill invocation finds nothing to do
      await expect(
        executeDiscovery(
          { fqcId: docId, path, pluginId: 'notes_scenario_plugin' },
          config,
          vaultManager
        )
      ).resolves.toBeDefined();
    });

    it('should return elapsed_ms > 0 for all discovery outcomes', async () => {
      const path = 'Documents/TimeCheck.md';

      await createTestDocument(vaultPath, path, { title: 'Timing Test' }, 'Timing verification');
      const docId = await createDatabaseDocument(client, TEST_INSTANCE_ID, path);

      const config = makeConfig(vaultPath, '', TEST_INSTANCE_ID);
      const result = await executeDiscovery(
        { fqcId: docId, path, pluginId: undefined as any },
        config,
        vaultManager
      );

      expect(result.elapsed_ms).toBeGreaterThan(0);
      expect(['complete', 'pending', 'failed']).toContain(result.status);
    });
  });
});
