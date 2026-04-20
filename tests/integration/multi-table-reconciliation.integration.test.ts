/**
 * Integration tests for Phase 86 Plan 05 — Multi-table reconciliation correctness.
 * Exercises: all plugin tables scanned in a single pass, cross-table OQ-7 resurrection
 * guard (prevents duplicate tracking), and correct table routing based on document folder.
 *
 * Requires: local Supabase running (supabase start)
 * Run: npm run test:integration -- multi-table-reconciliation.integration
 *
 * Note on reconciliation model: reconcilePluginDocuments cross-references fqc_documents
 * with plugin tables. Documents must exist in fqc_documents (via create_document) before
 * they can be auto-tracked into plugin tables.
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

const INSTANCE_ID = 'multi-table-reconciliation-test';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'multi-table-reconciliation-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    server: { host: 'localhost', port: 3106 },
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

// Helper: create a document via the create_document handler (registers in fqc_documents)
async function createDoc(
  createDocumentHandler: (params: Record<string, unknown>) => Promise<unknown>,
  folder: string,
  title: string,
  uniqueId: string
): Promise<string> {
  const filename = `${title.toLowerCase().replace(/\s+/g, '-')}-${uniqueId}.md`;
  const path = `${folder}/${filename}`;
  const result = await createDocumentHandler({
    title,
    content: `Content for ${title}.`,
    path,
  }) as { content: Array<{ text: string }>; isError?: boolean };
  if (result.isError) throw new Error(`create_document failed: ${result.content[0].text}`);
  return path;
}

// ── Plugin YAML ───────────────────────────────────────────────────────────────

const MULTI_TABLE_PLUGIN_SCHEMA = `
plugin:
  id: multi_table_test
  name: Multi-Table Reconciliation Plugin
  version: 1
watched_folders:
  - contacts
  - notes
documents:
  types:
    - id: contact
      folder: contacts
      table: contacts
      on_added: auto-track
      track_as: contacts
    - id: note
      folder: notes
      table: notes
      on_added: auto-track
      track_as: notes
tables:
  - name: contacts
    columns:
      - name: name
        type: text
  - name: notes
    columns:
      - name: title
        type: text
`.trim();

// ── Suite ────────────────────────────────────────────────────────────────────

describe('Multi-Table Reconciliation Integration', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;
  let pgClient: pg.Client;
  let docHandler: (params: Record<string, unknown>) => Promise<unknown>;

  const createdTables: string[] = [
    'fqcp_multi_table_test_default_contacts',
    'fqcp_multi_table_test_default_notes',
  ];

  beforeAll(async () => {
    if (SKIP_DB) return;

    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-multi-table-'));
    config = makeConfig(vaultPath);
    initLogger(config);

    pgClient = new pg.Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    await initSupabase(config);
    await initVault(config);
    initEmbedding(config); // gracefully degrades to NullEmbeddingProvider when apiKey is empty
    await initPlugins(config);

    // Create vault subdirectories
    await mkdir(join(vaultPath, 'contacts'), { recursive: true });
    await mkdir(join(vaultPath, 'notes'), { recursive: true });

    // Set up shared document handler for use across tests
    const { server: docServer, getHandler: dh } = createMockServer();
    registerDocumentTools(docServer, config);
    docHandler = dh('create_document');

    // Register plugin
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const result = await getHandler('register_plugin')({ schema_yaml: MULTI_TABLE_PLUGIN_SCHEMA }) as { content: Array<{ text: string }>; isError?: boolean };
    if (result.isError) throw new Error(`register_plugin failed: ${result.content[0].text}`);
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

  // ── Test 1: all plugin tables scanned in a single reconciliation pass ─────

  it.skipIf(SKIP_DB)('all plugin tables scanned in a single reconciliation pass', async () => {
    const { server: docServer, getHandler: dh } = createMockServer();
    registerDocumentTools(docServer, config);
    const createDocument = dh('create_document');

    // Create 2 contact docs and 3 note docs via create_document (registers in fqc_documents)
    for (let i = 0; i < 2; i++) {
      await createDoc(createDocument, 'contacts', `Contact ${uuidv4().slice(0, 8)}`, `t1-${i}`);
    }
    for (let i = 0; i < 3; i++) {
      await createDoc(createDocument, 'notes', `Note ${uuidv4().slice(0, 8)}`, `t1-${i}`);
    }

    // Single reconciliation call via search_records — scans all document types in one pass
    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    const result = await getHandler('search_records')({
      plugin_id: 'multi_table_test',
      plugin_instance: 'default',
      table: 'contacts',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const responseText = result.content[0].text;

    // Should report 5 total auto-tracked (2 contacts + 3 notes) in a single pass
    expect(responseText).toContain('Auto-tracked 5 new document(s)');

    // Verify 2 rows in contacts table
    const { rows: contactRows } = await pgClient.query(
      `SELECT COUNT(*) as count FROM fqcp_multi_table_test_default_contacts WHERE instance_id = $1 AND status = 'active'`,
      [INSTANCE_ID]
    );
    expect(Number(contactRows[0].count)).toBe(2);

    // Verify 3 rows in notes table
    const { rows: noteRows } = await pgClient.query(
      `SELECT COUNT(*) as count FROM fqcp_multi_table_test_default_notes WHERE instance_id = $1 AND status = 'active'`,
      [INSTANCE_ID]
    );
    expect(Number(noteRows[0].count)).toBe(3);
  }, 60_000);

  // ── Test 2: cross-table check prevents duplicate tracking (OQ-7 resurrection guard) ──

  it.skipIf(SKIP_DB)('cross-table check prevents duplicate tracking — OQ-7 resurrection guard', async () => {
    const { server: docServer, getHandler: dh } = createMockServer();
    registerDocumentTools(docServer, config);
    const createDocument = dh('create_document');

    // Create a document in contacts folder (registers in fqc_documents with contacts/ path)
    const contactPath = await createDoc(createDocument, 'contacts', `XTable Contact ${uuidv4().slice(0, 8)}`, 't2');

    // First reconciliation: auto-tracks the contact
    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    await getHandler('search_records')({
      plugin_id: 'multi_table_test',
      plugin_instance: 'default',
      table: 'contacts',
    });

    // Verify it was tracked in contacts table — get its fqc_id
    const { rows: beforeRows } = await pgClient.query(
      `SELECT id, fqc_id FROM fqcp_multi_table_test_default_contacts WHERE instance_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [INSTANCE_ID]
    );
    expect(beforeRows.length).toBeGreaterThanOrEqual(1);
    const trackedFqcId = beforeRows[0].fqc_id as string;

    // Simulate cross-folder move: update fqc_documents path to notes/ folder
    // (in production this would happen via move_document; here we simulate the DB state)
    await supabaseManager.getClient()
      .from('fqc_documents')
      .update({ path: contactPath.replace('contacts/', 'notes/') })
      .eq('id', trackedFqcId)
      .eq('instance_id', INSTANCE_ID);

    // Trigger reconciliation — should detect disassociation (path moved out of contacts),
    // not re-add as a new entry in both tables
    invalidateReconciliationCache();
    const result = await getHandler('search_records')({
      plugin_id: 'multi_table_test',
      plugin_instance: 'default',
      table: 'notes',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();

    // Count total rows for this fqc_id across BOTH plugin tables
    const { rows: contactCount } = await pgClient.query(
      `SELECT COUNT(*) as count FROM fqcp_multi_table_test_default_contacts WHERE fqc_id = $1 AND instance_id = $2`,
      [trackedFqcId, INSTANCE_ID]
    );
    const { rows: noteCount } = await pgClient.query(
      `SELECT COUNT(*) as count FROM fqcp_multi_table_test_default_notes WHERE fqc_id = $1 AND instance_id = $2`,
      [trackedFqcId, INSTANCE_ID]
    );

    const totalRows = Number(contactCount[0].count) + Number(noteCount[0].count);
    // Only 1 row total for this fqc_id across both tables (no duplicate insertion)
    expect(totalRows).toBe(1);
  }, 60_000);

  // ── Test 3: auto-track routes to correct table based on document folder ──

  it.skipIf(SKIP_DB)('auto-track routes to correct table based on document folder', async () => {
    const { server: docServer, getHandler: dh } = createMockServer();
    registerDocumentTools(docServer, config);
    const createDocument = dh('create_document');

    // Create one doc in each folder with distinct unique IDs
    const uniqueId = uuidv4().slice(0, 8);
    const personPath = await createDoc(createDocument, 'contacts', `Person A ${uniqueId}`, `t3-person`);
    const notePath = await createDoc(createDocument, 'notes', `Note B ${uniqueId}`, `t3-note`);

    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    const result = await getHandler('search_records')({
      plugin_id: 'multi_table_test',
      plugin_instance: 'default',
      table: 'contacts',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();

    // person doc must be in contacts table (path matches contacts/)
    const { rows: contactRows } = await pgClient.query(
      `SELECT path FROM fqcp_multi_table_test_default_contacts WHERE instance_id = $1 AND path = $2 AND status = 'active'`,
      [INSTANCE_ID, personPath]
    );
    expect(contactRows.length).toBe(1);

    // person doc must NOT appear in notes table
    const { rows: wrongContactRows } = await pgClient.query(
      `SELECT path FROM fqcp_multi_table_test_default_notes WHERE instance_id = $1 AND path = $2`,
      [INSTANCE_ID, personPath]
    );
    expect(wrongContactRows.length).toBe(0);

    // note doc must be in notes table (path matches notes/)
    const { rows: noteRows } = await pgClient.query(
      `SELECT path FROM fqcp_multi_table_test_default_notes WHERE instance_id = $1 AND path = $2 AND status = 'active'`,
      [INSTANCE_ID, notePath]
    );
    expect(noteRows.length).toBe(1);

    // note doc must NOT appear in contacts table
    const { rows: wrongNoteRows } = await pgClient.query(
      `SELECT path FROM fqcp_multi_table_test_default_contacts WHERE instance_id = $1 AND path = $2`,
      [INSTANCE_ID, notePath]
    );
    expect(wrongNoteRows.length).toBe(0);
  }, 60_000);
});
