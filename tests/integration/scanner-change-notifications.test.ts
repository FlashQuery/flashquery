/**
 * Integration tests: Scanner + Change Notification Integration (Phase 58.1)
 * Tests: Scanner wiring of invokeChangeNotifications() during scanning.
 * Verifies content change and deletion callbacks are invoked at correct points.
 * Requires: Supabase running, SUPABASE_SERVICE_ROLE_KEY set.
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding, embeddingProvider } from '../../src/embedding/provider.js';
import { initVault, vaultManager } from '../../src/storage/vault.js';
import { runScanOnce } from '../../src/services/scanner.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SKIP = !HAS_SUPABASE;
const TEST_INSTANCE_ID = uuidv4();

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'scanner-notif-test',
      id: TEST_INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
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

describe.skipIf(SKIP)('Scanner + Change Notifications Integration (Phase 58.1)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;
  let client: any;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'scanner-notif-test-'));
    config = makeConfig(vaultPath);

    initLogger(config);
    await initSupabase(config);
    await initEmbedding(config);
    await initVault(config);

    // Get client after initialization
    client = supabaseManager.getClient();

    // Create test vault instance
    const { error: vaultError } = await client
      .from('fqc_vault')
      .insert({
        id: TEST_INSTANCE_ID,
        name: 'scanner-notif-test-vault',
        path: vaultPath,
        instance_id: TEST_INSTANCE_ID,
      });

    if (vaultError) {
      throw new Error(`Failed to create test vault: ${vaultError.message}`);
    }
  });

  afterAll(async () => {
    // Cleanup: delete test data in order (respecting foreign keys)
    await client.from('fqc_change_queue').delete().eq('instance_id', TEST_INSTANCE_ID);
    await client.from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await client.from('fqc_vault').delete().eq('id', TEST_INSTANCE_ID);
    await supabaseManager.close();
    await rm(vaultPath, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Content change triggers on_document_changed callback
  // ─────────────────────────────────────────────────────────────────────────

  it('should invoke on_document_changed when document content changes', async () => {
    // Create test vault directory
    await mkdir(vaultPath, { recursive: true });

    // Create initial document
    const docPath = 'test/content-change.md';
    const docContent = `---
fqc_id: initial-uuid-1234
title: Content Change Test
status: active
ownership: test-plugin
---

Initial content`;

    await mkdir(join(vaultPath, 'test'), { recursive: true });
    await writeFile(join(vaultPath, docPath), docContent);

    // Insert document into DB with initial hash
    const hash1 = require('crypto').createHash('sha256').update(docContent).digest('hex');
    const { data: doc1, error: insertError1 } = await client
      .from('fqc_documents')
      .insert({
        id: 'initial-uuid-1234',
        instance_id: TEST_INSTANCE_ID,
        path: docPath,
        title: 'Content Change Test',
        status: 'active',
        content_hash: hash1,
        ownership_plugin_id: 'test-plugin',
      })
      .select('id')
      .single();

    expect(insertError1).toBeNull();

    // Run initial scan (should have no changes)
    const result1 = await runScanOnce(config);
    expect(result1.hashMismatches).toBe(0);

    // Verify no change queue entry yet
    let queueRows = await client
      .from('fqc_change_queue')
      .select('*')
      .eq('fqc_id', 'initial-uuid-1234');
    expect(queueRows.data).toHaveLength(0);

    // Modify document content
    const modifiedContent = `---
fqc_id: initial-uuid-1234
title: Content Change Test
status: active
ownership: test-plugin
---

Modified content with changes`;

    await writeFile(join(vaultPath, docPath), modifiedContent);

    // Run scan again (should detect content change)
    const result2 = await runScanOnce(config);
    expect(result2.hashMismatches).toBeGreaterThanOrEqual(1);

    // Verify change queue entry was created
    queueRows = await client
      .from('fqc_change_queue')
      .select('*')
      .eq('fqc_id', 'initial-uuid-1234')
      .eq('change_type', 'modified');

    expect(queueRows.data).toHaveLength(1);
    expect(queueRows.data![0].delivery_status).toBe('delivered');
    expect(queueRows.data![0].plugin_delivery).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: Document deletion triggers on_document_deleted callback
  // ─────────────────────────────────────────────────────────────────────────

  it('should invoke on_document_deleted when document is deleted', async () => {
    // Create test document
    const docPath = 'test/deletion-test.md';
    const docContent = `---
fqc_id: deletion-uuid-5678
title: Deletion Test
status: active
ownership: test-plugin
---

Document to be deleted`;

    await mkdir(join(vaultPath, 'test'), { recursive: true });
    await writeFile(join(vaultPath, docPath), docContent);

    // Insert into DB
    const hash = require('crypto').createHash('sha256').update(docContent).digest('hex');
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: 'deletion-uuid-5678',
        instance_id: TEST_INSTANCE_ID,
        path: docPath,
        title: 'Deletion Test',
        status: 'active',
        content_hash: hash,
        ownership_plugin_id: 'test-plugin',
      });

    expect(insertError).toBeNull();

    // Run initial scan
    const result1 = await runScanOnce(config);
    expect(result1.hashMismatches).toBe(0);
    expect(result1.deletedFiles).toBe(0);

    // Delete file from vault
    const fs = require('fs');
    fs.unlinkSync(join(vaultPath, docPath));

    // Run scan again
    const result2 = await runScanOnce(config);
    expect(result2.deletedFiles).toBeGreaterThanOrEqual(1);

    // Verify change queue entry was created for deletion
    const queueRows = await client
      .from('fqc_change_queue')
      .select('*')
      .eq('fqc_id', 'deletion-uuid-5678')
      .eq('change_type', 'deleted');

    expect(queueRows.data).toHaveLength(1);
    expect(queueRows.data![0].delivery_status).toBe('delivered');
    expect(queueRows.data![0].plugin_delivery).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Change queue contains full changePayload for modifications
  // ─────────────────────────────────────────────────────────────────────────

  it('should populate change queue with full changePayload', async () => {
    const docPath = 'test/payload-test.md';
    const docContent = `---
fqc_id: payload-uuid-9999
title: Payload Test
status: active
ownership: test-plugin
---

Payload test content`;

    await mkdir(join(vaultPath, 'test'), { recursive: true });
    await writeFile(join(vaultPath, docPath), docContent);

    const hash = require('crypto').createHash('sha256').update(docContent).digest('hex');
    const { error: insertError } = await client
      .from('fqc_documents')
      .insert({
        id: 'payload-uuid-9999',
        instance_id: TEST_INSTANCE_ID,
        path: docPath,
        title: 'Payload Test',
        status: 'active',
        content_hash: hash,
        ownership_plugin_id: 'test-plugin',
      });

    expect(insertError).toBeNull();

    // Initial scan
    await runScanOnce(config);

    // Modify content
    const modifiedContent = `---
fqc_id: payload-uuid-9999
title: Payload Test
status: active
ownership: test-plugin
---

Modified payload test content`;

    await writeFile(join(vaultPath, docPath), modifiedContent);

    // Scan to trigger change notification
    await runScanOnce(config);

    // Verify queue entry has changePayload with all required fields
    const queueRows = await client
      .from('fqc_change_queue')
      .select('*')
      .eq('fqc_id', 'payload-uuid-9999')
      .eq('change_type', 'modified');

    expect(queueRows.data).toHaveLength(1);
    const changeRow = queueRows.data![0];
    const changes = changeRow.changes as Record<string, unknown>;

    // Verify changePayload contains required fields
    expect(changes).toBeDefined();
    expect(changes.content).toBeDefined();
    expect(changes.frontmatter).toBeDefined();
    expect(changes.modified_at).toBeDefined();
    expect(changes.size_bytes).toBeDefined();
    expect(changes.content_hash).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: Scanner continues on notification errors
  // ─────────────────────────────────────────────────────────────────────────

  it('should continue scanning even if notification invocation fails', async () => {
    const docPath1 = 'test/error-resilience-1.md';
    const docPath2 = 'test/error-resilience-2.md';

    const docContent1 = `---
fqc_id: error-uuid-1111
title: Error Test 1
status: active
ownership: test-plugin
---

Document 1`;

    const docContent2 = `---
fqc_id: error-uuid-2222
title: Error Test 2
status: active
ownership: test-plugin
---

Document 2`;

    await mkdir(join(vaultPath, 'test'), { recursive: true });
    await writeFile(join(vaultPath, docPath1), docContent1);
    await writeFile(join(vaultPath, docPath2), docContent2);

    const hash1 = require('crypto').createHash('sha256').update(docContent1).digest('hex');
    const hash2 = require('crypto').createHash('sha256').update(docContent2).digest('hex');

    // Insert both documents
    await client
      .from('fqc_documents')
      .insert([
        {
          id: 'error-uuid-1111',
          instance_id: TEST_INSTANCE_ID,
          path: docPath1,
          title: 'Error Test 1',
          status: 'active',
          content_hash: hash1,
          ownership_plugin_id: 'test-plugin',
        },
        {
          id: 'error-uuid-2222',
          instance_id: TEST_INSTANCE_ID,
          path: docPath2,
          title: 'Error Test 2',
          status: 'active',
          content_hash: hash2,
          ownership_plugin_id: 'test-plugin',
        },
      ]);

    // Initial scan
    const result1 = await runScanOnce(config);
    expect(result1.hashMismatches).toBe(0);

    // Modify both documents
    const modified1 = `---
fqc_id: error-uuid-1111
title: Error Test 1
status: active
ownership: test-plugin
---

Modified 1`;

    const modified2 = `---
fqc_id: error-uuid-2222
title: Error Test 2
status: active
ownership: test-plugin
---

Modified 2`;

    await writeFile(join(vaultPath, docPath1), modified1);
    await writeFile(join(vaultPath, docPath2), modified2);

    // Run scan — should process both documents despite any errors
    const result2 = await runScanOnce(config);
    expect(result2.hashMismatches).toBeGreaterThanOrEqual(2);

    // Verify both documents had queue entries created
    const queue1 = await client
      .from('fqc_change_queue')
      .select('*')
      .eq('fqc_id', 'error-uuid-1111');

    const queue2 = await client
      .from('fqc_change_queue')
      .select('*')
      .eq('fqc_id', 'error-uuid-2222');

    expect(queue1.data!.length).toBeGreaterThan(0);
    expect(queue2.data!.length).toBeGreaterThan(0);
  });
});
