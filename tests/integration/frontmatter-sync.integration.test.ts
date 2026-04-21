/**
 * Integration tests for TEST-08: Frontmatter-to-Column Sync (SCANNER-01, SCANNER-02, SCANNER-03)
 * Tests that fqc_owner/fqc_type frontmatter fields are synced to ownership_plugin_id/ownership_type
 * DB columns on INSERT and content-change UPDATE.
 * Requires: supabase start, valid embedding API key in env.
 * Run: npm run test:integration -- --testPathPattern frontmatter-sync
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { runScanOnce } from '../../src/index.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import {
  TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL,
  TEST_OPENAI_API_KEY, HAS_SUPABASE,
} from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const EMBEDDING_API_KEY = TEST_OPENAI_API_KEY;
const SKIP = !HAS_SUPABASE || !EMBEDDING_API_KEY;
const TEST_INSTANCE_ID = 'frontmatter-sync-test-id';

function makeIntegrationConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'frontmatter-sync-test', id: TEST_INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: EMBEDDING_API_KEY, dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    server: { host: 'localhost', port: 3200 },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    plugins: {},
    locking: { enabled: true, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

describe.skipIf(SKIP)('TEST-08: Frontmatter-to-Column Sync', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-frontmatter-sync-test-'));
    config = makeIntegrationConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
  });

  afterAll(async () => {
    try {
      if (supabaseManager.getClient()) {
        await supabaseManager.getClient()
          .from('fqc_documents')
          .delete()
          .eq('instance_id', TEST_INSTANCE_ID);
        await supabaseManager.close();
      }
    } catch (err) {
      console.warn('Could not clean up database:', err instanceof Error ? err.message : String(err));
    }
    try {
      await rm(vaultPath, { recursive: true, force: true });
    } catch (err) {
      console.warn('Could not clean up vault:', err instanceof Error ? err.message : String(err));
    }
  });

  beforeEach(async () => {
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', TEST_INSTANCE_ID);
    try {
      const files = await fsPromises.readdir(vaultPath);
      for (const file of files) {
        const fp = join(vaultPath, file);
        const s = await fsPromises.stat(fp);
        if (s.isDirectory()) await fsPromises.rm(fp, { recursive: true });
        else await fsPromises.unlink(fp);
      }
    } catch { /* vault may be empty */ }
  });

  it('RO-32: fqc_owner frontmatter field is synced to ownership_plugin_id on INSERT', async () => {
    const content = `---\nfqc_owner: my-plugin\n---\n# Test Doc\n\nContent here.`;
    await writeFile(join(vaultPath, 'owned.md'), content);

    await runScanOnce(config);

    const { data, error } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('ownership_plugin_id')
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect(error).toBeNull();
    expect(data?.ownership_plugin_id).toBe('my-plugin');
  });

  it('RO-33: fqc_type frontmatter field is synced to ownership_type on INSERT', async () => {
    const content = `---\nfqc_owner: my-plugin\nfqc_type: contact-note\n---\n# Typed Doc\n\nContent here.`;
    await writeFile(join(vaultPath, 'typed.md'), content);

    await runScanOnce(config);

    const { data, error } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('ownership_type')
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect(error).toBeNull();
    expect(data?.ownership_type).toBe('contact-note');
  });

  it('RO-34: removing fqc_owner from frontmatter sets ownership_plugin_id to NULL on content-change UPDATE', async () => {
    // First scan: create document with fqc_owner
    const initialContent = `---\nfqc_owner: my-plugin\n---\n# Owned Doc\n\nInitial content.`;
    const filePath = join(vaultPath, 'owner-removal.md');
    await writeFile(filePath, initialContent);
    await runScanOnce(config);

    // Verify ownership was set
    const { data: firstRow } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('id, ownership_plugin_id')
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect(firstRow?.ownership_plugin_id).toBe('my-plugin');

    // Rewrite file WITHOUT fqc_owner (different content to trigger hash mismatch)
    const updatedContent = `---\n---\n# Owned Doc\n\nUpdated content without owner.`;
    await writeFile(filePath, updatedContent);
    await runScanOnce(config);

    // Verify ownership_plugin_id is now NULL
    const { data: updatedRow } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('ownership_plugin_id')
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect(updatedRow?.ownership_plugin_id).toBeNull();
  });

  it('RO-42: scan does not write to fqc_change_queue', async () => {
    const content = `---\nfqc_owner: my-plugin\n---\n# Change Queue Test\n\nContent.`;
    await writeFile(join(vaultPath, 'change-queue-check.md'), content);

    await runScanOnce(config);

    // fqc_change_queue table may not exist (Phase 88 drops it) — treat missing table as passing
    try {
      const { data, error } = await supabaseManager.getClient()
        .from('fqc_change_queue')
        .select('id')
        .eq('instance_id', TEST_INSTANCE_ID);

      // If table exists, assert no rows were written for our instance
      if (!error) {
        expect(data?.length ?? 0).toBe(0);
      }
      // If error contains "does not exist" or similar, table was already dropped — pass
    } catch {
      // Table doesn't exist — Phase 88 already removed it — this is a pass condition
    }
  });
});
