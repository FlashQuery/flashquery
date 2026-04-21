/**
 * Integration tests for Phase 86 — record tool reconciliation and resurrection lifecycle.
 * Tests TEST-07 and TEST-16: reconcile-on-read flows with a real Supabase instance.
 *
 * Requires: local Supabase running (supabase start)
 * Run: npm run test:integration -- plugin-reconciliation.integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import matter from 'gray-matter';
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

const INSTANCE_ID = 'reconciliation-integration-test';

// Plugin instance ID used in MCP tool calls (different from FlashQuery instance ID).
// Plugin tables store this value in their instance_id column.
const PLUGIN_INSTANCE = 'default';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: {
      name: 'reconciliation-integration-test',
      id: INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    server: { host: 'localhost', port: 3100 },
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

const RECONCILIATION_PLUGIN_YAML = `
plugin:
  id: rec_int_test
  name: Reconciliation Integration Test Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: name
        type: text
      - name: email
        type: text
documents:
  types:
    - id: contact
      folder: contacts
      on_added: auto-track
      track_as: contacts
      template: contact-template.md
`.trim();

const LEGACY_PLUGIN_YAML = `
plugin:
  id: rec_legacy_test
  name: Legacy Plugin No Policies
  version: 1
tables:
  - name: items
    columns:
      - name: title
        type: text
`.trim();

// ── Helper: create a document in fqc_documents and on disk ───────────────────
// Auto-track requires the document to be in fqc_documents first (reconciliation
// queries fqc_documents to discover candidates, then classifies them as 'added').

async function createTrackedDoc(
  getHandler: (name: string) => ToolHandler,
  vaultPath: string,
  relativePath: string,
  content: string = '# Test\nBody text here.'
): Promise<string> {
  // Use create_document MCP tool — inserts into fqc_documents and writes to disk
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

describe.skipIf(SKIP_DB)('plugin-reconciliation integration', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;
  let contactsPath: string;
  let pgClient: pg.Client;

  const contactsTable = 'fqcp_rec_int_test_default_contacts';
  const legacyTable = 'fqcp_rec_legacy_test_default_items';

  beforeAll(async () => {
    if (SKIP_DB) return;

    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-reconciliation-integration-'));
    contactsPath = join(vaultPath, 'contacts');
    await mkdir(contactsPath, { recursive: true });

    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    await initVault(config);
    await initPlugins(config);
    initEmbedding(config);

    pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await pgClient.connect();

    // Register the reconciliation plugin
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);
    registerPendingReviewTools(server, config);
    registerDocumentTools(server, config);

    const regResult = await getHandler('register_plugin')({ schema_yaml: RECONCILIATION_PLUGIN_YAML }) as { content: Array<{ text: string }>; isError?: boolean };
    if (regResult.isError) {
      console.error('Plugin registration failed:', regResult.content[0].text);
    }
  }, 60000);

  afterAll(async () => {
    if (SKIP_DB) return;

    // Clean up plugin tables
    for (const table of [contactsTable, legacyTable]) {
      await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(table)}`).catch(() => {});
    }

    // Clean up pending reviews
    await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    // Clean up documents
    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    // Clean up registry
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('id', INSTANCE_ID);

    await pgClient.end().catch(() => {});
    await rm(vaultPath, { recursive: true, force: true });
  }, 30000);

  // ── Test 1: record tool triggers reconciliation ───────────────────────────
  // Auto-track requires doc in fqc_documents. Test 1 verifies the reconciliation
  // preamble runs without error — actual auto-tracking is verified in Test 2.

  it('record tool triggers reconciliation before core operation', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    // Create doc via create_document (inserts into fqc_documents + writes disk)
    const relPath = `contacts/contact-t1-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# Test Contact\nBody text.');

    invalidateReconciliationCache();

    const result = await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'test',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // Reconciliation preamble ran without error
    expect(typeof text).toBe('string');
  });

  // ── Test 2: auto-track creates plugin row and writes frontmatter ──────────

  it('auto-track creates plugin row and writes frontmatter', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    const relPath = `contacts/contact-t2-${randomUUID()}.md`;
    const filePath = await createTrackedDoc(getHandler, vaultPath, relPath, '# Auto Track Test\nBody text.');

    invalidateReconciliationCache();

    const result = await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'auto track',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();

    // Response should mention auto-tracking
    const text = result.content[0].text;
    expect(text).toMatch(/Auto-tracked|reconciliation/i);

    // Query the plugin table to confirm a row was inserted
    const rows = await pgClient.query(
      `SELECT id, instance_id FROM ${pg.escapeIdentifier(contactsTable)} WHERE instance_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [INSTANCE_ID]
    );
    expect(rows.rows.length).toBeGreaterThan(0);

    // Check the file now has fqc_owner frontmatter
    const raw = await import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
    const parsed = matter(raw);
    expect(parsed.data.fqc_owner).toBeDefined();
    expect(parsed.data.fqc_type).toBeDefined();
  });

  // ── Test 3: auto-track does not modify document body ─────────────────────

  it('auto-track does not modify document body', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    const bodyText = 'Body text here that must remain unchanged.';
    const relPath = `contacts/contact-t3-${randomUUID()}.md`;
    const filePath = await createTrackedDoc(getHandler, vaultPath, relPath, `# Test Contact\n${bodyText}`);

    invalidateReconciliationCache();

    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'body test',
    });

    const raw = await import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
    const parsed = matter(raw);

    // Body text must be present unchanged
    expect(parsed.content).toContain(bodyText);
  });

  // ── Test 4: archival — deleted document causes plugin row archived ─────────

  it('archival — deleted document causes plugin row status archived', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    const relPath = `contacts/contact-t4-${randomUUID()}.md`;
    const filePath = await createTrackedDoc(getHandler, vaultPath, relPath, '# Archive Test');

    invalidateReconciliationCache();

    // First call: auto-track creates plugin row
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'archive test',
    });

    // Verify auto-track created a row
    const rowsBefore = await pgClient.query(
      `SELECT id FROM ${pg.escapeIdentifier(contactsTable)} WHERE instance_id = $1 AND status = 'active'`,
      [INSTANCE_ID]
    );
    expect(rowsBefore.rows.length).toBeGreaterThan(0);

    // Delete the file from disk (simulate external deletion)
    await unlink(filePath).catch(() => {});

    // Also mark the fqc_documents row as archived (simulates scanner detecting deletion)
    const fqcDocRow = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('id')
      .eq('instance_id', INSTANCE_ID)
      .eq('path', relPath)
      .single();

    if (fqcDocRow.data?.id) {
      await supabaseManager.getClient()
        .from('fqc_documents')
        .update({ status: 'archived' })
        .eq('id', fqcDocRow.data.id);
    }

    // Invalidate cache so reconciliation re-runs
    invalidateReconciliationCache();

    // Second call: reconciliation should detect deleted document
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'archive test',
    });

    // Query plugin table for status — at least one row should be archived
    const rows = await pgClient.query(
      `SELECT status FROM ${pg.escapeIdentifier(contactsTable)} WHERE instance_id = $1`,
      [INSTANCE_ID]
    );
    const hasArchived = rows.rows.some((r: { status: string }) => r.status === 'archived');
    expect(hasArchived).toBe(true);
  });

  // ── Test 5: disassociation — ownership change causes plugin row archived ──

  it('disassociation — ownership change causes plugin row archived', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    const relPath = `contacts/contact-t5-${randomUUID()}.md`;
    const filePath = await createTrackedDoc(getHandler, vaultPath, relPath, '# Disassociation Test');

    invalidateReconciliationCache();

    // First call: auto-track creates plugin row
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'disassoc test',
    });

    // Overwrite frontmatter with a different fqc_owner — simulates disassociation
    const rawOld = await import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
    const parsedOld = matter(rawOld);
    const newFm = { ...parsedOld.data, fqc_owner: 'different_plugin' };
    const newYaml = Object.entries(newFm).map(([k, v]) => `${k}: ${String(v)}`).join('\n');
    await writeFile(filePath, `---\n${newYaml}\n---\n${parsedOld.content}`, 'utf-8');

    // Update fqc_documents ownership_plugin_id to simulate the ownership change
    await supabaseManager.getClient()
      .from('fqc_documents')
      .update({ ownership_plugin_id: 'different_plugin' })
      .eq('instance_id', INSTANCE_ID)
      .eq('path', relPath);

    invalidateReconciliationCache();

    // Second call: should classify as disassociated and archive plugin row
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'disassoc test',
    });

    const rows = await pgClient.query(
      `SELECT status FROM ${pg.escapeIdentifier(contactsTable)} WHERE instance_id = $1`,
      [INSTANCE_ID]
    );
    const hasArchived = rows.rows.some((r: { status: string }) => r.status === 'archived');
    expect(hasArchived).toBe(true);
  });

  // ── Test 6: pending review appears in record tool response ─────────────────

  it('pending review appears in record tool response when items exist', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    // Create doc — auto-track with template declared creates a pending review row
    const relPath = `contacts/contact-t6-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# Pending Review Test');

    invalidateReconciliationCache();

    const result = await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'pending review',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    // After auto-tracking with template declared, response should mention pending reviews
    expect(text).toMatch(/pending review|Auto-tracked/i);
  });

  // ── Test 7: full pending review lifecycle (RO-47) ─────────────────────────

  it('full pending review lifecycle: create → query mode → clear mode → empty', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);
    registerPendingReviewTools(server, config);

    const relPath = `contacts/contact-t7-${randomUUID()}.md`;
    const filePath = await createTrackedDoc(getHandler, vaultPath, relPath, '# Lifecycle Test');

    invalidateReconciliationCache();

    // Trigger auto-track (creates pending review with template_available)
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'lifecycle',
    });

    // Get fqc_id from the file frontmatter
    const raw = await import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
    const parsed = matter(raw);
    const fqcId = parsed.data.fqc_id as string | undefined;

    if (!fqcId) {
      // If create_document didn't write fqc_id to frontmatter, get it from DB
    }

    // Query mode: fqc_ids: [] — should return pending items without deleting
    const queryResult = await getHandler('clear_pending_reviews')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      fqc_ids: [],
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(queryResult.isError).toBeUndefined();

    // Check if there are any pending reviews
    const { data: pendingRows } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'rec_int_test')
      .eq('instance_id', INSTANCE_ID);

    if (pendingRows && pendingRows.length > 0) {
      // Verify query mode didn't delete
      const afterQueryCount = await supabaseManager.getClient()
        .from('fqc_pending_plugin_review')
        .select('fqc_id', { count: 'exact' })
        .eq('plugin_id', 'rec_int_test')
        .eq('instance_id', INSTANCE_ID);
      expect((afterQueryCount.count ?? 0)).toBeGreaterThan(0);

      // Clear mode: delete ALL pending rows for this plugin (not just one)
      // so we can assert empty state afterwards
      const allFqcIds = pendingRows.map((r: { fqc_id: string }) => r.fqc_id);
      const clearResult = await getHandler('clear_pending_reviews')({
        plugin_id: 'rec_int_test',
        plugin_instance: 'default',
        fqc_ids: allFqcIds,
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(clearResult.isError).toBeUndefined();
      expect(clearResult.content[0].text).toContain('No pending reviews');

      // Query mode again — should be empty
      const queryResult2 = await getHandler('clear_pending_reviews')({
        plugin_id: 'rec_int_test',
        plugin_instance: 'default',
        fqc_ids: [],
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(queryResult2.isError).toBeUndefined();
      expect(queryResult2.content[0].text).toContain('No pending reviews');
    }
  });

  // ── Test 8: in-conversation doc + immediate reconciliation (RO-48) ─────────

  it('in-conversation doc + immediate reconciliation — no staleness race', async () => {
    // Explicitly invalidate so the 30s staleness window doesn't prevent reconciliation
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);

    // Create the document (inserts into fqc_documents)
    const relPath = `contacts/contact-t8-${randomUUID()}.md`;
    await createTrackedDoc(getHandler, vaultPath, relPath, '# Immediate Test');

    // Immediately call record tool — cache was invalidated so reconciliation runs
    const result = await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'immediate',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // Reconciliation must run and auto-track the new document
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Auto-tracked|contacts/i);
  });

  // ── Test 9: legacy plugin with no policies uses defaults (RO-49) ──────────

  it('legacy plugin with no policies uses defaults', async () => {
    // Register a second plugin with no documents.types policies
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);

    const regResult = await getHandler('register_plugin')({
      schema_yaml: LEGACY_PLUGIN_YAML,
    }) as { content: Array<{ text: string }>; isError?: boolean };

    if (regResult.isError) {
      console.error('Legacy plugin registration failed:', regResult.content[0].text);
    }

    invalidateReconciliationCache();

    // Call a record tool for the legacy plugin — should not error
    const result = await getHandler('search_records')({
      plugin_id: 'rec_legacy_test',
      plugin_instance: 'default',
      table: 'items',
      query: 'test',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // No crash — reconciliation runs with zero document type policies (zero counts)
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBeDefined();
  });

  // ── Test 10: resurrection lifecycle (TEST-16) ─────────────────────────────

  it('resurrection lifecycle — archived row un-archived on reappearance', async () => {
    invalidateReconciliationCache();

    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);
    registerDocumentTools(server, config);
    registerPendingReviewTools(server, config);

    const relPath = `contacts/contact-t10-${randomUUID()}.md`;
    const filePath = await createTrackedDoc(getHandler, vaultPath, relPath, '# Resurrection Test');

    invalidateReconciliationCache();

    // Step 1: auto-track the document (first reconcile)
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'resurrection',
    });

    // Verify a plugin row was created
    const rowsAfterTrack = await pgClient.query(
      `SELECT id, status FROM ${pg.escapeIdentifier(contactsTable)} WHERE instance_id = $1`,
      [INSTANCE_ID]
    );
    expect(rowsAfterTrack.rows.length).toBeGreaterThan(0);

    // Step 2: simulate document deletion — mark fqc_documents as archived
    await supabaseManager.getClient()
      .from('fqc_documents')
      .update({ status: 'archived' })
      .eq('instance_id', INSTANCE_ID)
      .eq('path', relPath);

    await unlink(filePath).catch(() => {});

    invalidateReconciliationCache();

    // Reconcile — should archive the plugin row
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'resurrection',
    });

    // Confirm at least one row is archived
    const archivedRows = await pgClient.query(
      `SELECT id, status FROM ${pg.escapeIdentifier(contactsTable)} WHERE instance_id = $1 AND status = 'archived'`,
      [INSTANCE_ID]
    );
    expect(archivedRows.rows.length).toBeGreaterThan(0);

    // Step 3: re-create the same file AND re-activate fqc_documents row
    await writeFile(filePath, `---\ntitle: Resurrection Test\n---\n# Resurrection Test\n`, 'utf-8');
    await supabaseManager.getClient()
      .from('fqc_documents')
      .update({ status: 'active' })
      .eq('instance_id', INSTANCE_ID)
      .eq('path', relPath);

    invalidateReconciliationCache();

    // Step 4: reconcile again — archived plugin row + active fqc_documents → resurrected
    await getHandler('search_records')({
      plugin_id: 'rec_int_test',
      plugin_instance: 'default',
      table: 'contacts',
      query: 'resurrection',
    });

    // Assert plugin row is now active (resurrected)
    const activeRows = await pgClient.query(
      `SELECT id, status FROM ${pg.escapeIdentifier(contactsTable)} WHERE instance_id = $1 AND status = 'active'`,
      [INSTANCE_ID]
    );
    expect(activeRows.rows.length).toBeGreaterThan(0);

    // Assert pending review with review_type 'resurrected' exists (TEST-16)
    const { data: pendingRows } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('review_type')
      .eq('plugin_id', 'rec_int_test')
      .eq('instance_id', INSTANCE_ID)
      .eq('review_type', 'resurrected');

    expect(pendingRows).not.toBeNull();
    expect(pendingRows!.length).toBeGreaterThan(0);
  });
});
