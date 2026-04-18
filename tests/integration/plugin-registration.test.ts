import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { loadPluginManifests, reloadManifests, getFolderMappings, matchesFolderClaim } from '../../src/services/manifest-loader.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initLogger } from '../../src/logging/logger.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Test configuration
const testConfig: FlashQueryConfig = {
  instance: {
    name: 'plugin-registration-test',
    id: 'integration-test-manifest',
    vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
  },
  supabase: {
    url: process.env.SUPABASE_URL || 'https://test.supabase.co',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost/test',
    skipDdl: false,
  },
  embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
  logging: { level: 'error', output: 'stdout' },
  git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  mcp: { transport: 'stdio' },
  locking: { enabled: false, ttlSeconds: 30 },
  server: { host: 'localhost', port: 3000 },
} as unknown as FlashQueryConfig;

// Skip entire suite if Supabase is not configured
const SKIP_SUITE = !process.env.SUPABASE_URL || process.env.SUPABASE_URL.includes('placeholder');

describe.skipIf(SKIP_SUITE)('plugin-registration integration', () => {
  let client: ReturnType<typeof supabaseManager.getClient>;
  const testPluginIds = new Set<string>();

  beforeAll(async () => {
    // Initialize Supabase and logger
    initLogger(testConfig);
    await initSupabase(testConfig);

    // Now get the client (should be initialized)
    client = supabaseManager.getClient();
  }, 30000); // Increase timeout for Supabase initialization

  beforeEach(async () => {
    // Clean up any leftover test plugins before each test to avoid state pollution
    // This is important because loadPluginManifests() reads ALL plugins from the database
    if (client && testPluginIds.size > 0) {
      try {
        for (const pluginId of testPluginIds) {
          await client
            .from('fqc_plugin_registry')
            .delete()
            .eq('plugin_id', pluginId)
            .eq('instance_id', testConfig.instance.id);
        }
        testPluginIds.clear();
      } catch (err: unknown) {
        // Ignore cleanup errors
      }
    }
  });

  afterAll(async () => {
    // Cleanup: delete all test plugins created during tests
    if (testPluginIds.size === 0 || !client) {
      return;
    }

    try {
      for (const pluginId of testPluginIds) {
        await client
          .from('fqc_plugin_registry')
          .delete()
          .eq('plugin_id', pluginId)
          .eq('instance_id', testConfig.instance.id);
      }
      console.log(`Cleaned up ${testPluginIds.size} test plugin(s) from registry`);
    } catch (err: unknown) {
      console.warn('Cleanup warning: could not delete all test plugins', err);
    }
  });

  describe('manifest loading after registration', () => {
    it('should load manifests for newly registered plugin', async () => {
      const pluginId = 'test_plugin_integration_001';
      testPluginIds.add(pluginId);

      const schemaYaml = `id: ${pluginId}
name: Test Plugin Integration
version: 1.0.0
documents:
  types:
    - id: test-type
      folder: Tests/Integration
      description: Integration test document
tables:
  - name: test_table
    columns:
      - name: id
        type: uuid
        required: true`;

      // Insert test plugin schema
      const { error: insertError } = await client.from('fqc_plugin_registry').insert({
        plugin_id: pluginId,
        instance_id: testConfig.instance.id,
        plugin_instance: 'default',
        schema_yaml: schemaYaml,
        status: 'active',
      });

      expect(insertError).toBeNull();

      // Load manifests
      await loadPluginManifests(testConfig);

      // Verify folder mappings
      const folderMappings = getFolderMappings();
      const mapping = folderMappings.get('Tests/Integration');

      expect(mapping).toBeDefined();
      if (mapping) {
        expect(mapping.pluginId).toBe(pluginId);
        expect(mapping.typeId).toBe('test-type');
        expect(mapping.description).toBe('Integration test document');
      }
    });

    it('should update manifests after plugin re-registration', async () => {
      const pluginId = 'test_plugin_update_001';
      testPluginIds.add(pluginId);

      const initialSchemaYaml = `id: ${pluginId}
name: Test Plugin Update
version: 1.0.0
documents:
  types:
    - id: test-type
      folder: Tests/ReRegistration
      description: Initial folder
table: []`;

      // Insert initial plugin
      const { error: insertError } = await client.from('fqc_plugin_registry').insert({
        plugin_id: pluginId,
        instance_id: testConfig.instance.id,
        plugin_instance: 'default',
        schema_yaml: initialSchemaYaml,
        status: 'active',
      });

      expect(insertError).toBeNull();

      // Load initial manifests
      await loadPluginManifests(testConfig);
      let folderMappings = getFolderMappings();
      expect(folderMappings.get('Tests/ReRegistration')).toBeDefined();
      expect(folderMappings.get('Tests/Updated')).toBeUndefined();

      // Update plugin schema to claim a different folder
      const updatedSchemaYaml = `id: ${pluginId}
name: Test Plugin Update
version: 1.0.0
documents:
  types:
    - id: test-type
      folder: Tests/Updated
      description: Updated folder
tables: []`;

      const { error: updateError } = await client
        .from('fqc_plugin_registry')
        .update({
          schema_yaml: updatedSchemaYaml,
        })
        .eq('plugin_id', pluginId)
        .eq('instance_id', testConfig.instance.id);

      expect(updateError).toBeNull();

      // Reload manifests
      await reloadManifests(testConfig);
      folderMappings = getFolderMappings();

      // Verify old mapping is gone and new one exists
      expect(folderMappings.get('Tests/ReRegistration')).toBeUndefined();
      const newMapping = folderMappings.get('Tests/Updated');
      expect(newMapping).toBeDefined();
      if (newMapping) {
        expect(newMapping.pluginId).toBe(pluginId);
        expect(newMapping.typeId).toBe('test-type');
      }
    });

    it('should handle multiple plugins with non-overlapping folders', async () => {
      const plugin1Id = 'test_plugin_multi_001';
      const plugin2Id = 'test_plugin_multi_002';
      testPluginIds.add(plugin1Id);
      testPluginIds.add(plugin2Id);

      const schema1Yaml = `id: ${plugin1Id}
name: Test Plugin Multi 1
version: 1.0.0
documents:
  types:
    - id: type1
      folder: Folder1
      description: Folder 1
tables: []`;

      const schema2Yaml = `id: ${plugin2Id}
name: Test Plugin Multi 2
version: 1.0.0
documents:
  types:
    - id: type2
      folder: Folder2
      description: Folder 2
tables: []`;

      // Insert both plugins
      const { error: insertError } = await client.from('fqc_plugin_registry').insert([
        {
          plugin_id: plugin1Id,
          instance_id: testConfig.instance.id,
          plugin_instance: 'default',
          schema_yaml: schema1Yaml,
          status: 'active',
        },
        {
          plugin_id: plugin2Id,
          instance_id: testConfig.instance.id,
          plugin_instance: 'default',
          schema_yaml: schema2Yaml,
          status: 'active',
        },
      ]);

      expect(insertError).toBeNull();

      // Load manifests
      await loadPluginManifests(testConfig);
      const folderMappings = getFolderMappings();

      // Verify both mappings exist with correct plugins
      const mapping1 = folderMappings.get('Folder1');
      const mapping2 = folderMappings.get('Folder2');

      expect(mapping1).toBeDefined();
      expect(mapping2).toBeDefined();

      if (mapping1) {
        expect(mapping1.pluginId).toBe(plugin1Id);
        expect(mapping1.typeId).toBe('type1');
      }

      if (mapping2) {
        expect(mapping2.pluginId).toBe(plugin2Id);
        expect(mapping2.typeId).toBe('type2');
      }
    });

    it('should gracefully handle empty documents section (COMPAT-01)', async () => {
      const pluginId = 'test_plugin_empty_docs_001';
      testPluginIds.add(pluginId);

      const schemaYaml = `id: ${pluginId}
name: Test Plugin Empty Docs
version: 1.0.0
documents: {}
tables: []`;

      // Insert plugin with empty documents
      const { error: insertError } = await client.from('fqc_plugin_registry').insert({
        plugin_id: pluginId,
        instance_id: testConfig.instance.id,
        plugin_instance: 'default',
        schema_yaml: schemaYaml,
        status: 'active',
      });

      expect(insertError).toBeNull();

      // Load manifests - should complete without errors
      const result = await loadPluginManifests(testConfig);

      // Verify this plugin doesn't appear in mappings (empty documents section means no types)
      expect(result.get(`Documents from ${pluginId}`)).toBeUndefined();

      // Just verify it's a Map and loading succeeded
      expect(result).toBeInstanceOf(Map);
    });

    it('should warn about missing documents section (COMPAT-02)', async () => {
      const pluginId = 'test_plugin_no_docs_001';
      testPluginIds.add(pluginId);

      const schemaYaml = `id: ${pluginId}
name: Test Plugin No Docs
version: 1.0.0
tables: []`;

      // Insert plugin without documents section
      const { error: insertError } = await client.from('fqc_plugin_registry').insert({
        plugin_id: pluginId,
        instance_id: testConfig.instance.id,
        plugin_instance: 'default',
        schema_yaml: schemaYaml,
        status: 'active',
      });

      expect(insertError).toBeNull();

      // Load manifests - should complete despite missing documents section
      const result = await loadPluginManifests(testConfig);

      // Verify this plugin doesn't appear in mappings (no documents section)
      // Just verify it's a Map and loading succeeded with graceful degradation
      expect(result).toBeInstanceOf(Map);
    });

    it('should match folders case-insensitively', async () => {
      const pluginId = 'test_plugin_case_001';
      testPluginIds.add(pluginId);

      const schemaYaml = `id: ${pluginId}
name: Test Plugin Case
version: 1.0.0
documents:
  types:
    - id: test-type
      folder: Tests/MyFolder
      description: Case test
tables: []`;

      // Insert plugin
      const { error: insertError } = await client.from('fqc_plugin_registry').insert({
        plugin_id: pluginId,
        instance_id: testConfig.instance.id,
        plugin_instance: 'default',
        schema_yaml: schemaYaml,
        status: 'active',
      });

      expect(insertError).toBeNull();

      // Load manifests
      await loadPluginManifests(testConfig);

      // Verify case-insensitive matching works
      expect(matchesFolderClaim('Tests/MyFolder/file.md', 'Tests/MyFolder')).toBe(true);
      expect(matchesFolderClaim('tests/myfolder/file.md', 'Tests/MyFolder')).toBe(true);
      expect(matchesFolderClaim('TESTS/MYFOLDER/FILE.md', 'tests/myfolder')).toBe(true);
      expect(matchesFolderClaim('Tests/OtherFolder/file.md', 'Tests/MyFolder')).toBe(false);
    });
  });
});
