/**
 * Integration tests for Phase 86 — pending plugin review lifecycle.
 * Tests TEST-15: insert via auto-track → query mode → clear mode → verify empty.
 * Also covers FK CASCADE and unregister_plugin cleanup.
 *
 * Requires: local Supabase running (supabase start)
 * Run: npm run test:integration -- pending-plugin-review.integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { registerPendingReviewTools } from '../../src/mcp/tools/pending-review.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { invalidateReconciliationCache } from '../../src/services/plugin-reconciliation.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL } from '../helpers/test-env.js';

// ── Config ──────────────────────────────────────────────────────────────────

const SKIP_DB = !TEST_SUPABASE_KEY;

const INSTANCE_ID = 'pending-review-lifecycle-test';

// Plugin instance used in tool calls; stored in plugin table instance_id column
const PLUGIN_INSTANCE = 'default';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'pending-review-lifecycle-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    server: { host: 'localhost', port: 3101 },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createMockServer() {
  const handlers: Record<string, ToolHandler> = {};
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: ToolHandler) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

// ── Plugin YAML ──────────────────────────────────────────────────────────────

const PENDING_REVIEW_PLUGIN_YAML = `
plugin:
  id: pending_review_test
  name: Pending Review Lifecycle Test Plugin
  version: 1
tables:
  - name: items
    columns:
      - name: title
        type: text
documents:
  types:
    - id: item
      folder: items
      on_added: auto-track
      track_as: items
      template: item-template.md
`.trim();

// ── Helper: create a document via MCP tool ───────────────────────────────────

async function createTrackedDoc(
  getHandler: (name: string) => ToolHandler,
  vaultPath: string,
  relativePath: string,
  content: string = '# Test\nBody text here.'
): Promise<string> {
  const result = await getHandler('create_document')({
    path: relativePath,
    title: relativePath.split('/').pop()?.replace('.md', '') ?? 'Test Document',
    content,
    tags: ['test'],
  }) as { content: Array<{ text: string }>; isError?: boolean };

  if (result.isError) {
    throw new Error(`create_document failed: ${result.content[0].text}`);
  }

  return join(vaultPath, relativePath);
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_DB)('pending-plugin-review lifecycle integration', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;

  const itemsTable = 'fqcp_pending_review_test_default_items';

  beforeAll(async () => {
    if (SKIP_DB) return;

    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-pending-review-integration-'));
    await mkdir(join(vaultPath, 'items'), { recursive: true });

    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    await initPlugins(config);
    initEmbedding(config);

    // Register the test plugin
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);
    registerPendingReviewTools(server, config);
    registerDocumentTools(server, config);

    const regResult = await getHandler('register_plugin')({ schema_yaml: PENDING_REVIEW_PLUGIN_YAML }) as { content: Array<{ text: string }>; isError?: boolean };
    if (regResult.isError) {
      console.error('Plugin registration failed:', regResult.content[0].text);
    }
  }, 60000);

  afterAll(async () => {
    if (SKIP_DB) return;

    const supabase = supabaseManager.getClient();

    // Drop plugin tables
    try {
      const { createPgClientIPv4 } = await import('../../src/utils/pg-client.js');
      const pgClient = createPgClientIPv4(TEST_DATABASE_URL);
      await pgClient.connect();
      await pgClient.query(`DROP TABLE IF EXISTS "${itemsTable}"`).catch(() => {});
      await pgClient.end().catch(() => {});
    } catch (_) { /* ignore */ }

    // Clean up in FK order
    try { await supabase.from('fqc_pending_plugin_review').delete().eq('instance_id', INSTANCE_ID); } catch (_) { /* ignore */ }
    try { await supabase.from('fqc_documents').delete().eq('instance_id', INSTANCE_ID); } catch (_) { /* ignore */ }
    try { await supabase.from('fqc_plugin_registry').delete().eq('instance_id', INSTANCE_ID); } catch (_) { /* ignore */ }
    try { await supabase.from('fqc_vault').delete().eq('id', INSTANCE_ID); } catch (_) { /* ignore */ }

    await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
  }, 30000);

  // ── Test 1: register + auto-track creates pending review row ────────────────

  it('register plugin, create doc, call record tool — pending review row created', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    const relPath = `items/item-t1-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# Test Item\nBody text.');

    invalidateReconciliationCache();

    // Trigger reconciliation via record tool
    await getHandler('search_records')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'items',
      query: 'test item',
    });

    // Query fqc_pending_plugin_review directly
    const { data, error } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id, review_type')
      .eq('plugin_id', 'pending_review_test')
      .eq('instance_id', INSTANCE_ID);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    // Template declared → template_available review type
    const hasTemplateAvailable = data!.some((r: { review_type: string }) => r.review_type === 'template_available');
    expect(hasTemplateAvailable).toBe(true);
  });

  // ── Test 2: query mode returns pending items without deleting ──────────────

  it('query mode (fqc_ids: []) returns pending items without deleting', async () => {
    // Ensure at least one pending review exists from prior test or create one
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);
    registerPendingReviewTools(server, config);

    // Create a fresh doc to guarantee a pending review
    const relPath = `items/item-t2-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# Query Mode Test');

    invalidateReconciliationCache();

    await getHandler('search_records')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'items',
      query: 'query mode',
    });

    // Query mode: fqc_ids: []
    const queryResult = await getHandler('clear_pending_reviews')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      fqc_ids: [],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(queryResult.isError).toBeUndefined();
    // Response should list pending items
    expect(queryResult.content[0].text).toMatch(/pending review|item\(s\)/i);

    // DB still has the rows (query mode does not delete)
    const { data } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'pending_review_test')
      .eq('instance_id', INSTANCE_ID);

    expect((data ?? []).length).toBeGreaterThan(0);
  });

  // ── Test 3: clear mode deletes specified rows, returns remaining ────────────

  it('clear mode deletes specified rows, returns remaining', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);
    registerPendingReviewTools(server, config);

    // Create a fresh doc for an isolated pending review
    const relPath = `items/item-t3-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# Clear Mode Test');

    invalidateReconciliationCache();

    await getHandler('search_records')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'items',
      query: 'clear mode',
    });

    // Collect all current pending fqc_ids (snapshot before clear)
    const { data: pendingRows } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'pending_review_test')
      .eq('instance_id', INSTANCE_ID);

    expect((pendingRows ?? []).length).toBeGreaterThan(0);

    const snapshotIds = (pendingRows ?? []).map((r: { fqc_id: string }) => r.fqc_id);

    // Clear the snapshot IDs
    const clearResult = await getHandler('clear_pending_reviews')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      fqc_ids: snapshotIds,
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(clearResult.isError).toBeUndefined();

    // Verify none of the snapshotted rows remain
    const { data: afterClear } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'pending_review_test')
      .eq('instance_id', INSTANCE_ID)
      .in('fqc_id', snapshotIds);

    expect((afterClear ?? []).length).toBe(0);
  });

  // ── Test 4: idempotent — clearing non-existent IDs does not error ──────────

  it('idempotent: clearing non-existent IDs does not error', async () => {
    const { server, getHandler } = createMockServer();
    registerPendingReviewTools(server, config);

    const nonExistentId = randomUUID();

    const result = await getHandler('clear_pending_reviews')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      fqc_ids: [nonExistentId],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // Should not error — idempotent
    expect(result.isError).toBeUndefined();
    // Returns current state (either empty or whatever is there)
    expect(result.content[0].text).toBeDefined();
  });

  // ── Test 5: FK CASCADE — deleting fqc_documents row removes pending review ──

  it('FK CASCADE: deleting fqc_documents row removes pending review', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    // Create a document to get a pending review
    const relPath = `items/item-t5-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# FK Cascade Test');

    invalidateReconciliationCache();

    await getHandler('search_records')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'items',
      query: 'cascade test',
    });

    // Find the fqc_documents row for this document
    const { data: docRows } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('id')
      .eq('instance_id', INSTANCE_ID)
      .eq('path', relPath);

    expect((docRows ?? []).length).toBeGreaterThan(0);
    const fqcDocId = docRows![0].id as string;

    // Verify pending review exists for this document
    const { data: preBefore } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('fqc_id', fqcDocId);

    expect((preBefore ?? []).length).toBeGreaterThan(0);

    // Delete the plugin table row first (it has a FK to fqc_documents with no cascade)
    // then hard-delete the fqc_documents row — CASCADE to fqc_pending_plugin_review fires
    const { createPgClientIPv4 } = await import('../../src/utils/pg-client.js');
    const pgClient = createPgClientIPv4(TEST_DATABASE_URL);
    await pgClient.connect();
    try {
      await pgClient.query(`DELETE FROM "${itemsTable}" WHERE fqc_id = $1`, [fqcDocId]);
    } finally {
      await pgClient.end().catch(() => {});
    }

    const { error: delError } = await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('id', fqcDocId);

    expect(delError).toBeNull();

    // fqc_pending_plugin_review row should be gone via CASCADE
    const { data: afterDelete } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('fqc_id', fqcDocId);

    expect((afterDelete ?? []).length).toBe(0);
  });

  // ── Test 6: unregister_plugin deletes all pending reviews ──────────────────

  it('unregister_plugin deletes all pending reviews before removing registry entry', async () => {
    // First ensure there is at least one pending review by creating a fresh doc
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);
    registerDocumentTools(server, config);
    registerPendingReviewTools(server, config);

    // Re-register the plugin (may have been unregistered from a previous run)
    await getHandler('register_plugin')({ schema_yaml: PENDING_REVIEW_PLUGIN_YAML });

    const relPath = `items/item-t6-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# Unregister Test');

    invalidateReconciliationCache();

    await getHandler('search_records')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      table: 'items',
      query: 'unregister test',
    });

    // Confirm pending reviews exist — if not, the auto-track may not have fired
    // (e.g. doc was already tracked from a previous run). Create more docs until
    // at least one pending review exists.
    let { data: preUnreg } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'pending_review_test')
      .eq('instance_id', INSTANCE_ID);

    if ((preUnreg ?? []).length === 0) {
      // Create additional docs until at least one pending review is inserted
      for (let attempt = 0; attempt < 3; attempt++) {
        const extraPath = `items/item-t6-extra-${randomUUID()}.md`;
        await createTrackedDoc(getHandler, vaultPath, extraPath, `# Unregister Extra ${attempt}`);
        invalidateReconciliationCache();
        await getHandler('search_records')({
          plugin_id: 'pending_review_test',
          plugin_instance: PLUGIN_INSTANCE,
          table: 'items',
          query: 'unregister extra',
        });
        const { data: retry } = await supabaseManager.getClient()
          .from('fqc_pending_plugin_review')
          .select('fqc_id')
          .eq('plugin_id', 'pending_review_test')
          .eq('instance_id', INSTANCE_ID);
        if ((retry ?? []).length > 0) {
          preUnreg = retry;
          break;
        }
      }
    }

    expect((preUnreg ?? []).length).toBeGreaterThan(0);

    // Unregister the plugin (confirm_destroy: true required to drop tables)
    const unregResult = await getHandler('unregister_plugin')({
      plugin_id: 'pending_review_test',
      plugin_instance: PLUGIN_INSTANCE,
      confirm_destroy: true,
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(unregResult.isError).toBeUndefined();

    // Pending reviews should be deleted
    const { data: afterUnreg } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'pending_review_test')
      .eq('instance_id', INSTANCE_ID);

    expect((afterUnreg ?? []).length).toBe(0);

    // Plugin registry entry should be gone
    const { data: registry } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('plugin_id')
      .eq('plugin_id', 'pending_review_test')
      .eq('instance_id', INSTANCE_ID);

    expect((registry ?? []).length).toBe(0);
  });
});
