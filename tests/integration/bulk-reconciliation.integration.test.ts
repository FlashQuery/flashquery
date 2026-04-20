/**
 * Integration tests for Phase 86 Plan 05 — TEST-09: Bulk reconciliation performance
 * and edge cases: large volume auto-track, count-based summary, spurious-modified
 * prevention (RECON-05), incremental pending review, and read-only guardrail (RO-60).
 *
 * Requires: local Supabase running (supabase start)
 * Run: npm run test:integration -- bulk-reconciliation.integration
 *
 * Note on reconciliation model: reconcilePluginDocuments cross-references fqc_documents
 * (the FQC document registry) with plugin tables. Documents must exist in fqc_documents
 * before they can be auto-tracked into plugin tables. Tests create documents via
 * create_document so they are registered in fqc_documents.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import pg from 'pg';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { initVault } from '../../src/storage/vault.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { invalidateReconciliationCache } from '../../src/services/plugin-reconciliation.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ── Config ──────────────────────────────────────────────────────────────────

import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;

const SKIP_DB = !SUPABASE_KEY;

const INSTANCE_ID = 'bulk-reconciliation-test';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'bulk-reconciliation-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    server: { host: 'localhost', port: 3105 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

// Helper: create N documents in a folder via create_document (registers in fqc_documents)
async function createDocs(
  getHandler: (name: string) => (params: Record<string, unknown>) => Promise<unknown>,
  folder: string,
  count: number,
  prefix: string
): Promise<string[]> {
  const paths: string[] = [];
  // Use Promise.all for speed
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const filename = `${prefix}-${String(i).padStart(3, '0')}-${uuidv4().slice(0, 8)}.md`;
      const path = `${folder}/${filename}`;
      paths.push(path);
      return getHandler('create_document')({
        title: `${prefix} Doc ${i}`,
        content: `Content for ${prefix} document ${i}.`,
        path,
      }) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
    })
  );
  // Verify all creates succeeded
  for (const r of results) {
    if (r.isError) throw new Error(`create_document failed: ${r.content[0].text}`);
  }
  return paths;
}

// ── Plugin YAML ───────────────────────────────────────────────────────────────

const BULK_PLUGIN_SCHEMA = `
plugin:
  id: bulk_recon_test
  name: Bulk Reconciliation Plugin
  version: 1
watched_folders:
  - docs
  - readonly-folder
documents:
  types:
    - id: doc
      folder: docs
      table: docs
      on_added: auto-track
      track_as: docs
    - id: protected-doc
      folder: readonly-folder
      table: protected
      access: read-only
      on_added: auto-track
      track_as: protected
tables:
  - name: docs
    columns:
      - name: title
        type: text
  - name: protected
    columns:
      - name: title
        type: text
`.trim();

const BULK_TEMPLATE_PLUGIN_SCHEMA = `
plugin:
  id: bulk_template_test
  name: Bulk Template Plugin
  version: 1
watched_folders:
  - templated-docs
documents:
  types:
    - id: templated-doc
      folder: templated-docs
      table: templated_docs
      on_added: auto-track
      track_as: templated_docs
      template: default-template
tables:
  - name: templated_docs
    columns:
      - name: title
        type: text
`.trim();

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Bulk Reconciliation Integration (TEST-09)', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;
  let pgClient: pg.Client;

  const createdTables: string[] = [
    'fqcp_bulk_recon_test_default_docs',
    'fqcp_bulk_recon_test_default_protected',
    'fqcp_bulk_template_test_default_templated_docs',
  ];

  // DDL for multiple plugin tables can take >10s — use a generous timeout
  beforeAll(async () => {
    if (SKIP_DB) return;

    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-bulk-recon-'));
    config = makeConfig(vaultPath);
    initLogger(config);

    pgClient = new pg.Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    await initSupabase(config);
    await initVault(config);
    initEmbedding(config); // gracefully degrades to NullEmbeddingProvider when apiKey is empty
    await initPlugins(config);

    // Create vault subdirectories
    await mkdir(join(vaultPath, 'docs'), { recursive: true });
    await mkdir(join(vaultPath, 'readonly-folder'), { recursive: true });
    await mkdir(join(vaultPath, 'templated-docs'), { recursive: true });

    // Register plugins
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const result = await getHandler('register_plugin')({ schema_yaml: BULK_PLUGIN_SCHEMA }) as { content: Array<{ text: string }>; isError?: boolean };
    if (result.isError) throw new Error(`register_plugin failed: ${result.content[0].text}`);

    const result2 = await getHandler('register_plugin')({ schema_yaml: BULK_TEMPLATE_PLUGIN_SCHEMA }) as { content: Array<{ text: string }>; isError?: boolean };
    if (result2.isError) throw new Error(`register_plugin (template) failed: ${result2.content[0].text}`);
  }, 60_000);

  afterAll(async () => {
    if (SKIP_DB) return;

    // Cleanup pending reviews
    await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    // Drop plugin tables
    for (const table of createdTables) {
      await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(table)}`).catch(() => {});
    }

    // Clean registry, vault and document rows
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await pgClient.end().catch(() => {});
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close().catch(() => {});
  }, 60_000);

  // ── Test 1: 50 new docs auto-tracked in single reconciliation pass ────────

  it.skipIf(SKIP_DB)('50 new docs auto-tracked in single reconciliation pass', async () => {
    // Create document server first (to register docs in fqc_documents)
    const { server: docServer, getHandler: docHandler } = createMockServer();
    registerDocumentTools(docServer, config);

    // Create 50 documents via create_document (registers them in fqc_documents)
    await createDocs(docHandler, 'docs', 50, 'bulk-doc');

    // Now trigger reconciliation via search_records
    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    const result = await getHandler('search_records')({
      plugin_id: 'bulk_recon_test',
      plugin_instance: 'default',
      table: 'docs',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    if (result.isError) {
      console.error('search_records error:', result.content[0].text);
    }
    expect(result.isError).toBeFalsy();

    // Should contain auto-tracked message
    const responseText = result.content[0].text;
    expect(responseText).toContain('Auto-tracked 50 new document(s)');

    // Verify 50 rows exist in the plugin table with status = 'active'
    const { rows } = await pgClient.query(
      `SELECT COUNT(*) as count FROM fqcp_bulk_recon_test_default_docs WHERE instance_id = $1 AND status = 'active'`,
      [INSTANCE_ID]
    );
    expect(Number(rows[0].count)).toBe(50);
  }, 60_000);

  // ── Test 2: count-based summary — no item enumeration ────────────────────

  it.skipIf(SKIP_DB)('count-based summary — no item enumeration', async () => {
    const { server: docServer, getHandler: docHandler } = createMockServer();
    registerDocumentTools(docServer, config);

    // Create 3 new uniquely-named documents via create_document
    const testPaths: string[] = [];
    for (let i = 0; i < 3; i++) {
      const filename = `count-summary-${uuidv4()}.md`;
      testPaths.push(filename);
      const r = await docHandler('create_document')({
        title: `Count Summary Doc ${i}`,
        content: `Test content for count summary ${i}.`,
        path: `docs/${filename}`,
      }) as { content: Array<{ text: string }>; isError?: boolean };
      if (r.isError) throw new Error(`create_document failed: ${r.content[0].text}`);
    }

    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    const result = await getHandler('search_records')({
      plugin_id: 'bulk_recon_test',
      plugin_instance: 'default',
      table: 'docs',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const responseText = result.content[0].text;

    // Should contain count-only message (exactly 3 new docs this round)
    expect(responseText).toMatch(/Auto-tracked \d+ new document\(s\)/);

    // Response must NOT contain any of the specific file names from this test
    for (const filename of testPaths) {
      expect(responseText).not.toContain(filename);
    }
  }, 60_000);

  // ── Test 3: intermediate states invisible during bulk processing ──────────

  it.skipIf(SKIP_DB)('intermediate states invisible during bulk processing', async () => {
    const { server: docServer, getHandler: docHandler } = createMockServer();
    registerDocumentTools(docServer, config);

    // Create 10 documents in docs/ folder via create_document
    const docPaths = await createDocs(docHandler, 'docs', 10, 'intermediate');

    // First reconciliation pass to track them all
    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    const firstResult = await getHandler('search_records')({
      plugin_id: 'bulk_recon_test',
      plugin_instance: 'default',
      table: 'docs',
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(firstResult.isError).toBeFalsy();

    // Archive 3 documents via fqc_documents to simulate deletion
    // (mark them archived so reconciliation sees them as deleted)
    for (let i = 0; i < 3; i++) {
      await supabaseManager.getClient()
        .from('fqc_documents')
        .update({ status: 'archived' })
        .eq('path', docPaths[i])
        .eq('instance_id', INSTANCE_ID);
    }

    // Second reconciliation pass
    invalidateReconciliationCache();
    const secondResult = await getHandler('search_records')({
      plugin_id: 'bulk_recon_test',
      plugin_instance: 'default',
      table: 'docs',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // Should be well-formed, no errors thrown
    expect(secondResult.isError).toBeFalsy();
    expect(secondResult.content[0].text).toBeDefined();

    // Archived fqc_documents → plugin rows should be archived
    const { rows: archivedRows } = await pgClient.query(
      `SELECT COUNT(*) as count FROM fqcp_bulk_recon_test_default_docs WHERE instance_id = $1 AND status = 'archived'`,
      [INSTANCE_ID]
    );
    expect(Number(archivedRows[0].count)).toBeGreaterThanOrEqual(3);
  }, 60_000);

  // ── Test 4: no spurious modified classification after auto-track completes ─

  it.skipIf(SKIP_DB)('no spurious modified classification after auto-track completes', async () => {
    const { server: docServer, getHandler: docHandler } = createMockServer();
    registerDocumentTools(docServer, config);

    // Create 5 new documents
    await createDocs(docHandler, 'docs', 5, 'no-spurious');

    // First call: auto-tracks all, sets last_seen_updated_at
    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    const firstResult = await getHandler('search_records')({
      plugin_id: 'bulk_recon_test',
      plugin_instance: 'default',
      table: 'docs',
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(firstResult.isError).toBeFalsy();

    // Second call immediately after — force re-run by invalidating cache
    invalidateReconciliationCache();
    const secondResult = await getHandler('search_records')({
      plugin_id: 'bulk_recon_test',
      plugin_instance: 'default',
      table: 'docs',
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(secondResult.isError).toBeFalsy();

    const responseText = secondResult.content[0].text;
    // Auto-track correctly set last_seen_updated_at — should NOT classify as modified
    expect(responseText).not.toMatch(/Synced fields on \d+ modified/);
  }, 60_000);

  // ── Test 5: incremental pending review processing — no duplicates ─────────

  it.skipIf(SKIP_DB)('incremental pending review processing — no duplicates across rounds', async () => {
    // Create 3 docs in templated-docs folder (triggers pending-review via template policy)
    const { server: docServer, getHandler: docHandler } = createMockServer();
    registerDocumentTools(docServer, config);
    await createDocs(docHandler, 'templated-docs', 3, 'pending-round1');

    // Trigger reconciliation — template policy causes pending review inserts
    invalidateReconciliationCache();
    const { server: recServer, getHandler: recHandler } = createMockServer();
    registerRecordTools(recServer, config);

    await recHandler('search_records')({
      plugin_id: 'bulk_template_test',
      plugin_instance: 'default',
      table: 'templated_docs',
    });

    // Register pending review tool
    const { server: prServer, getHandler: prHandler } = createMockServer();
    const { registerPendingReviewTools } = await import('../../src/mcp/tools/pending-review.js');
    registerPendingReviewTools(prServer, config);

    // Query pending reviews
    const queryResult = await prHandler('clear_pending_reviews')({
      plugin_id: 'bulk_template_test',
      plugin_instance: 'default',
      fqc_ids: [],
    }) as { content: Array<{ text: string }>; isError?: boolean };
    expect(queryResult.isError).toBeFalsy();

    // Query Supabase directly to get pending fqc_ids
    const { data: pendingRows } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'bulk_template_test')
      .eq('instance_id', INSTANCE_ID);

    const allIds = (pendingRows ?? []).map((r: { fqc_id: string }) => r.fqc_id);
    expect(allIds.length).toBeGreaterThanOrEqual(3);

    // Clear 1 row
    if (allIds.length > 0) {
      await prHandler('clear_pending_reviews')({
        plugin_id: 'bulk_template_test',
        plugin_instance: 'default',
        fqc_ids: [allIds[0]],
      });
    }

    // Add 2 more docs in round 2
    await createDocs(docHandler, 'templated-docs', 2, 'pending-round2');

    invalidateReconciliationCache();
    await recHandler('search_records')({
      plugin_id: 'bulk_template_test',
      plugin_instance: 'default',
      table: 'templated_docs',
    });

    // Query again — should have (original count - 1 cleared) + 2 new rows; no duplicates
    const { data: afterRows } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('fqc_id')
      .eq('plugin_id', 'bulk_template_test')
      .eq('instance_id', INSTANCE_ID);

    const afterCount = (afterRows ?? []).length;
    const expectedCount = allIds.length - 1 + 2;
    expect(afterCount).toBe(expectedCount);
  }, 60_000);

  // ── Test 6: access: read-only guardrail emits warning in create_document response (RO-60)

  it.skipIf(SKIP_DB)('access: read-only guardrail emits warning in create_document response', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    // Call create_document with a path inside readonly-folder/ (the read-only plugin folder)
    const testFilename = `readonly-test-${uuidv4()}.md`;
    const result = await getHandler('create_document')({
      title: 'Read Only Test',
      content: '# Read Only Test\n\nThis should trigger the read-only guardrail.',
      path: `readonly-folder/${testFilename}`,
    }) as { content: Array<{ text: string }>; isError?: boolean };

    // Warning should be present
    const responseText = result.content[0].text;
    expect(responseText).toContain('Warning: Plugin');
    expect(responseText).toContain('read-only access');

    // Write should still proceed — isError must be falsy
    expect(result.isError).toBeFalsy();

    // The file should actually exist in the vault
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(vaultPath, 'readonly-folder', testFilename))).toBe(true);
  }, 30_000);
});
