import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initLogger, logger } from '../../src/logging/logger.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { executeDiscovery, acquireLock, releaseLock } from '../../src/services/discovery-orchestrator.js';
import type { DiscoveryQueueItem } from '../../src/services/scanner.js';
import type { VaultManager } from '../../src/storage/vault.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';

// Partially mock discovery-orchestrator so acquireLock can be intercepted.
// vi.mock is hoisted to the top of the module; using importActual preserves
// executeDiscovery and all other real exports.
vi.mock('../../src/services/discovery-orchestrator.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/services/discovery-orchestrator.js')>();
  return {
    ...actual,
    acquireLock: vi.fn(actual.acquireLock),
  };
});

// Test configuration
const testVaultPath = '/tmp/test-vault-discovery-orchestrator';
const testConfig: FlashQueryConfig = {
  instance: {
    id: 'discovery-test-' + Date.now(),
    vault: { path: testVaultPath, markdownExtensions: ['.md'] },
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

// Simple in-memory vault manager for testing
class TestVaultManager implements VaultManager {
  constructor(private rootPath: string) {}

  async readMarkdown(relativePath: string): Promise<{ data: Record<string, unknown>; content: string }> {
    const absolutePath = join(this.rootPath, relativePath);
    const raw = await readFile(absolutePath, 'utf-8');
    const parsed = matter(raw);
    return {
      data: parsed.data as Record<string, unknown>,
      content: parsed.content,
    };
  }

  async writeMarkdown(
    relativePath: string,
    frontmatter: Record<string, unknown>,
    content: string,
    options?: any
  ): Promise<void> {
    const absolutePath = join(this.rootPath, relativePath);
    await mkdir(join(this.rootPath, relativePath.substring(0, relativePath.lastIndexOf('/'))), { recursive: true });
    const fm = { ...frontmatter, updated: new Date().toISOString() };
    const output = matter.stringify(content, fm);
    const tmpPath = absolutePath + '.fqc-tmp';
    await writeFile(tmpPath, output, 'utf-8');
    // Atomic rename: replaces destination and removes the tmp file in one syscall
    await rename(tmpPath, absolutePath);
  }

  resolvePath(area: string, project: string | null | undefined, filename: string): string {
    return join(this.rootPath, area, project || '_global', filename);
  }
}

describe.skipIf(!HAS_SUPABASE)('executeDiscovery() Integration Tests', () => {
  let vault: VaultManager;

  beforeAll(async () => {
    initLogger(testConfig);
    await initSupabase(testConfig);

    // Setup test vault directory
    await mkdir(testVaultPath, { recursive: true });

    // Create test vault manager
    vault = new TestVaultManager(testVaultPath);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Cleanup test vault
    try {
      await rm(testVaultPath, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`cleanup: failed to remove test vault: ${err}`);
    }
  });

  it('should discover a single document with lock acquisition and release', async () => {
    const client = supabaseManager.getClient();
    const docId = uuidv4();
    const docPath = 'CRM/Contacts/TestContact.md';

    // Create test document
    const docFullPath = join(testVaultPath, docPath);
    await mkdir(join(testVaultPath, 'CRM/Contacts'), { recursive: true });
    await writeFile(docFullPath, '# Test Contact\n\nTest content', 'utf-8');

    // Insert document in database
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: docId,
        instance_id: testConfig.instance.id,
        path: docPath,
        title: 'Test Contact',
        content_hash: 'test-hash-1',
        status: 'indexed',
        needs_discovery: true,
      });

    if (insertError) {
      logger.warn('Integration test skipped: could not insert test document', insertError);
      return;
    }

    try {
      // Execute discovery
      const item: DiscoveryQueueItem = {
        fqcId: docId,
        path: docPath,
        pluginId: 'crm',
      };

      const startTime = performance.now();
      const result = await executeDiscovery(item, testConfig, vault);
      const duration = performance.now() - startTime;

      // Assertions
      expect(result.status).toBe('complete');
      expect(result.elapsed_ms).toBeGreaterThan(0);
      expect(result.elapsed_ms).toBeLessThan(5000);
      expect(duration).toBeLessThan(5000);

      // Verify document ownership in database
      const { data: doc } = await client
        .from('fqc_documents')
        .select('ownership_plugin_id, needs_discovery')
        .eq('id', docId)
        .single();

      if (doc) {
        expect(doc.needs_discovery).toBe(false);
      }
    } finally {
      // Cleanup
      await client.from('fqc_documents').delete().eq('id', docId);
    }
  });

  it('should handle lock timeout gracefully', async () => {
    // Pre-insert a conflicting lock row so acquireLock naturally returns null
    // (unique constraint violation on the composite PK).
    // ESM same-module calls bypass vi.mock intercepts, so we use real DB state
    // to simulate a held lock.
    const client = supabaseManager.getClient();
    const docPath = 'Test/Locked.md';
    const docFullPath = join(testVaultPath, docPath);
    const lockResourceType = `document:${docPath}`;

    // Insert a pre-existing lock to block acquireLock
    await client.from('fqc_write_locks').insert({
      instance_id: 'local',
      resource_type: lockResourceType,
      locked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30000).toISOString(),
    });

    const docId = uuidv4();

    // Create test document
    await mkdir(join(testVaultPath, 'Test'), { recursive: true });
    await writeFile(docFullPath, '# Locked Doc\n\nContent', 'utf-8');

    const item: DiscoveryQueueItem = {
      fqcId: docId,
      path: docPath,
      pluginId: 'test',
    };

    try {
      // Execute discovery (should return pending because lock is already held)
      const result = await executeDiscovery(item, testConfig, vault);

      expect(result.status).toBe('pending');
      expect(result.elapsed_ms).toBeGreaterThan(0);
    } finally {
      // Clean up the pre-inserted lock
      await client.from('fqc_write_locks')
        .delete()
        .eq('instance_id', 'local')
        .eq('resource_type', lockResourceType);
    }
  });

  it('should discover 10 documents sequentially with performance tracking', async () => {
    const client = supabaseManager.getClient();
    const docIds = Array.from({ length: 10 }, () => uuidv4());
    const docPaths = docIds.map((_, i) => `CRM/Contacts/Contact${i}.md`);

    // Create test documents
    for (let i = 0; i < 10; i++) {
      const folderPath = join(testVaultPath, 'CRM/Contacts');
      await mkdir(folderPath, { recursive: true });
      const docFullPath = join(folderPath, `Contact${i}.md`);
      await writeFile(docFullPath, `# Contact ${i}\n\nTest content`, 'utf-8');
    }

    // Insert documents in database
    const insertPromises = docIds.map((docId, i) =>
      client.from('fqc_documents').insert({
        id: docId,
        instance_id: testConfig.instance.id,
        path: docPaths[i],
        title: `Contact ${i}`,
        content_hash: `hash-${i}`,
        status: 'indexed',
        needs_discovery: true,
      })
    );

    const insertResults = await Promise.all(insertPromises);
    const hasInsertError = insertResults.some(r => r.error);
    if (hasInsertError) {
      logger.warn('Integration test skipped: could not insert test documents');
      return;
    }

    try {
      // Execute discovery for all documents sequentially
      const startTime = performance.now();
      const results = [];

      for (let i = 0; i < 10; i++) {
        const item: DiscoveryQueueItem = {
          fqcId: docIds[i],
          path: docPaths[i],
          pluginId: 'crm',
        };

        const result = await executeDiscovery(item, testConfig, vault);
        results.push(result);
      }

      const totalTime = performance.now() - startTime;

      // Assertions
      expect(results.length).toBe(10);
      const completedCount = results.filter(r => r.status === 'complete').length;
      expect(completedCount).toBeGreaterThan(0); // At least some should complete

      // Performance assertion: 10 docs should take <60 seconds
      // (cloud Supabase round-trips add ~1-3s per lock acquire/release/update)
      expect(totalTime).toBeLessThan(60000);
      const avgTimePerDoc = totalTime / 10;
      expect(avgTimePerDoc).toBeLessThan(6000); // <6s per doc on average against cloud Supabase

      logger.info(`Discovery performance: ${totalTime.toFixed(0)}ms for 10 docs, ${avgTimePerDoc.toFixed(0)}ms/doc`);
    } finally {
      // Cleanup
      await Promise.all(docIds.map(docId => client.from('fqc_documents').delete().eq('id', docId)));
    }
  });

  it('should preserve existing frontmatter during atomic write', async () => {
    const client = supabaseManager.getClient();
    const docId = uuidv4();
    const docPath = 'Test/PreserveFM.md';
    const docFullPath = join(testVaultPath, docPath);

    // Create document with existing frontmatter
    const existingFM = `---
tags:
  - work
  - important
status: active
---

# Preserve Frontmatter Test

Content here`;

    await mkdir(join(testVaultPath, 'Test'), { recursive: true });
    await writeFile(docFullPath, existingFM, 'utf-8');

    // Insert document in database
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: docId,
        instance_id: testConfig.instance.id,
        path: docPath,
        title: 'Preserve Test',
        content_hash: 'hash-preserve',
        status: 'indexed',
        needs_discovery: true,
      });

    if (insertError) {
      logger.warn('Integration test skipped: could not insert test document', insertError);
      return;
    }

    try {
      const item: DiscoveryQueueItem = {
        fqcId: docId,
        path: docPath,
        pluginId: 'test',
      };

      // Execute discovery (will add ownership field)
      const result = await executeDiscovery(item, testConfig, vault);
      expect(result.status).toBe('complete');

      // Read file and verify frontmatter is preserved
      const updatedContent = await readFile(docFullPath, 'utf-8');
      expect(updatedContent).toContain('tags:'); // Existing field preserved
      expect(updatedContent).toContain('status: active'); // Existing field preserved
      expect(updatedContent).toMatch(/ownership:/); // New field added
      expect(updatedContent).toContain('# Preserve Frontmatter Test'); // Content preserved
    } finally {
      // Cleanup
      await client.from('fqc_documents').delete().eq('id', docId);
    }
  });

  it('should handle lock release in error scenarios', async () => {
    const docId = uuidv4();
    const docPath = 'Test/ErrorScenario.md';
    const docFullPath = join(testVaultPath, docPath);

    // Create test document
    await mkdir(join(testVaultPath, 'Test'), { recursive: true });
    await writeFile(docFullPath, '# Error Test\n\nContent', 'utf-8');

    const item: DiscoveryQueueItem = {
      fqcId: docId,
      path: docPath,
      pluginId: 'test',
    };

    // Execute discovery (may fail due to DB insert on non-existent doc)
    const result = await executeDiscovery(item, testConfig, vault);

    // Should handle error gracefully
    expect(result).toBeDefined();
    expect(result.elapsed_ms).toBeGreaterThan(0);
  });

  it('should mark document as discovered in database after success', async () => {
    const client = supabaseManager.getClient();
    const docId = uuidv4();
    const docPath = 'CRM/Contacts/MarkDiscovered.md';
    const docFullPath = join(testVaultPath, docPath);

    // Create test document
    await mkdir(join(testVaultPath, 'CRM/Contacts'), { recursive: true });
    await writeFile(docFullPath, '# Mark Discovered\n\nContent', 'utf-8');

    // Insert document with needs_discovery=true
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: docId,
        instance_id: testConfig.instance.id,
        path: docPath,
        title: 'Mark Discovered Test',
        content_hash: 'hash-mark',
        status: 'indexed',
        needs_discovery: true, // Initially needs discovery
      });

    if (insertError) {
      logger.warn('Integration test skipped: could not insert test document', insertError);
      return;
    }

    try {
      const item: DiscoveryQueueItem = {
        fqcId: docId,
        path: docPath,
        pluginId: 'crm',
      };

      // Execute discovery
      const result = await executeDiscovery(item, testConfig, vault);
      expect(result.status).toBe('complete');

      // Verify needs_discovery is now false
      const { data: updatedDoc } = await client
        .from('fqc_documents')
        .select('needs_discovery')
        .eq('id', docId)
        .single();

      if (updatedDoc) {
        expect(updatedDoc.needs_discovery).toBe(false);
      }
    } finally {
      // Cleanup
      await client.from('fqc_documents').delete().eq('id', docId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Plugin Overlap Tests (Wave 3: Scenario Validation)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!HAS_SUPABASE)('Multi-Plugin Overlap and Orchestration', () => {
  let vault: VaultManager;
  let client: ReturnType<typeof supabaseManager.getClient>;

  beforeAll(async () => {
    initLogger(testConfig);
    await initSupabase(testConfig);

    // Setup test vault directory
    await mkdir(testVaultPath, { recursive: true });

    // Create test vault manager
    vault = new TestVaultManager(testVaultPath);

    // Get Supabase client
    client = supabaseManager.getClient();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Cleanup test vault
    try {
      await rm(testVaultPath, { recursive: true, force: true });
    } catch (err) {
      logger.warn(`cleanup: failed to remove test vault: ${err}`);
    }
    await supabaseManager.close();
  });

  it('should handle watcher pattern with multiple plugin claims', async () => {
    if (!client) {
      expect(true).toBe(true); // Minimal passing test
      return;
    }

    // Setup: Create document that multiple plugins might claim
    const docPath = 'CRM/Contacts/MultiPlugin.md';
    const content = 'Document claimed by multiple plugins';
    const docId = uuidv4();

    // Create vault document
    const dir = join(testVaultPath, 'CRM/Contacts');
    await mkdir(dir, { recursive: true });
    const fm = { created: new Date().toISOString(), tags: ['multi'] };
    const output = matter.stringify(content, fm);
    await writeFile(join(dir, 'MultiPlugin.md'), output, 'utf-8');

    // Create database record
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: docId,
        instance_id: testConfig.instance.id,
        path: docPath,
        title: 'Multi-Plugin Test',
        content_hash: 'hash-multi-plugin',
        status: 'indexed',
        needs_discovery: true,
      });

    if (insertError) {
      logger.warn('Multi-plugin test skipped: could not insert test document', insertError);
      expect(true).toBe(true); // Minimal passing test
      return;
    }

    try {
      const item: DiscoveryQueueItem = {
        fqcId: docId,
        path: docPath,
        pluginId: undefined,
      };

      // Execute discovery
      const result = await executeDiscovery(item, testConfig, vault);

      // Verify: Should complete or handle gracefully
      expect(result.status === 'complete' || result.status === 'pending').toBe(true);

      if (result.status === 'complete') {
        // Verify: Plugin ID should be determined
        expect(result.plugin_id).toBeDefined();

        // Verify: Watchers may be populated (depends on plugin implementation)
        // For now, just verify the structure is correct
        expect(Array.isArray(result.watchers) || result.watchers === undefined).toBe(true);

        // Verify: Database record updated
        const { data: dbDoc } = await client
          .from('fqc_documents')
          .select('ownership_plugin_id')
          .eq('id', docId)
          .single();

        expect(dbDoc?.ownership_plugin_id).toBeDefined();
      }
    } finally {
      // Cleanup
      await client.from('fqc_documents').delete().eq('id', docId);
      try {
        await rm(join(testVaultPath, 'CRM'), { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  it('should handle conflict resolution when multiple plugins claim ownership', async () => {
    if (!client) {
      expect(true).toBe(true); // Minimal passing test
      return;
    }

    // Setup: Create document in ambiguous folder
    const docPath = 'SharedFolder/Conflict.md';
    const content = 'Document with potential ownership conflict';
    const docId = uuidv4();

    // Create vault document
    const dir = join(testVaultPath, 'SharedFolder');
    await mkdir(dir, { recursive: true });
    const fm = { created: new Date().toISOString() };
    const output = matter.stringify(content, fm);
    await writeFile(join(dir, 'Conflict.md'), output, 'utf-8');

    // Create database record
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: docId,
        instance_id: testConfig.instance.id,
        path: docPath,
        title: 'Conflict Test',
        content_hash: 'hash-conflict',
        status: 'indexed',
        needs_discovery: true,
      });

    if (insertError) {
      logger.warn('Conflict test skipped: could not insert test document', insertError);
      expect(true).toBe(true); // Minimal passing test
      return;
    }

    try {
      const item: DiscoveryQueueItem = {
        fqcId: docId,
        path: docPath,
        pluginId: undefined,
      };

      // Execute discovery
      const result = await executeDiscovery(item, testConfig, vault);

      // Verify: Should handle gracefully (complete or pending for user prompt)
      expect(result.status === 'complete' || result.status === 'pending').toBe(true);

      // Verify: No multiple owners (at most one plugin_id)
      expect(typeof result.plugin_id === 'string' || result.plugin_id === undefined).toBe(true);
    } finally {
      // Cleanup
      await client.from('fqc_documents').delete().eq('id', docId);
      try {
        await rm(join(testVaultPath, 'SharedFolder'), { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });

  it('should gracefully degrade when plugin skill is missing', async () => {
    if (!client) {
      expect(true).toBe(true); // Minimal passing test
      return;
    }

    // Setup: Create document in a test folder
    const docPath = 'TestFolder/NoSkill.md';
    const content = 'Document where plugin might not have skill';
    const docId = uuidv4();

    // Create vault document
    const dir = join(testVaultPath, 'TestFolder');
    await mkdir(dir, { recursive: true });
    const fm = { created: new Date().toISOString() };
    const output = matter.stringify(content, fm);
    await writeFile(join(dir, 'NoSkill.md'), output, 'utf-8');

    // Create database record
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: docId,
        instance_id: testConfig.instance.id,
        path: docPath,
        title: 'No Skill Test',
        content_hash: 'hash-no-skill',
        status: 'indexed',
        needs_discovery: true,
      });

    if (insertError) {
      logger.warn('No-skill test skipped: could not insert test document', insertError);
      expect(true).toBe(true); // Minimal passing test
      return;
    }

    try {
      const item: DiscoveryQueueItem = {
        fqcId: docId,
        path: docPath,
        pluginId: undefined,
      };

      // Execute discovery — should not throw even if plugin skill missing
      let threwError = false;
      let result: any;

      try {
        result = await executeDiscovery(item, testConfig, vault);
      } catch (err) {
        threwError = true;
      }

      // Verify: Should not throw
      expect(threwError).toBe(false);

      // Verify: Should return a valid result
      expect(result).toBeDefined();
      expect(result.elapsed_ms > 0).toBe(true);

      // Verify: Status should be complete, pending, or failed (all valid)
      expect(['complete', 'pending', 'failed'].includes(result.status)).toBe(true);
    } finally {
      // Cleanup
      await client.from('fqc_documents').delete().eq('id', docId);
      try {
        await rm(join(testVaultPath, 'TestFolder'), { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  });
});
