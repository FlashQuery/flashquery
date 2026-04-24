/**
 * Integration tests for Phase 12 — Plugin System and Record CRUD.
 * Covers the 4 UAT scenarios flagged as human-verification in 12-VERIFICATION.md.
 *
 * Requires: local Supabase running (supabase start)
 * Embedding tests (scenario 3) also require: OPENAI_API_KEY
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock reconcilePluginDocuments and executeReconciliationActions so that
// plugin-record CRUD tests do not trigger real reconciliation side effects
// (vault file-system scans, plugin table writes) that would interfere with
// test fixtures.  Approach (b) from D-11: backward-compatible empty result.
// .js extension required: Vitest ESM resolver maps import paths verbatim; the
// compiled module lives at plugin-reconciliation.js in the dist graph.
vi.mock('../../src/services/plugin-reconciliation.js', () => ({
  reconcilePluginDocuments: vi.fn().mockResolvedValue({
    added: [],
    resurrected: [],
    deleted: [],
    disassociated: [],
    moved: [],
    modified: [],
    unchanged: [],
  }),
  executeReconciliationActions: vi.fn().mockResolvedValue({
    autoTracked: 0,
    archived: 0,
    resurrected: 0,
    pathsUpdated: 0,
    fieldsSynced: 0,
    pendingReviewsCreated: 0,
    pendingReviewsCleared: 0,
  }),
  invalidateReconciliationCache: vi.fn(),
}));

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding, embeddingProvider } from '../../src/embedding/provider.js';
import { initPlugins, pluginManager } from '../../src/plugins/manager.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ── Config ──────────────────────────────────────────────────────────────────

import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, TEST_OPENAI_API_KEY } from '../helpers/test-env.js';

const SUPABASE_URL = TEST_SUPABASE_URL;
const SUPABASE_KEY = TEST_SUPABASE_KEY;
const DATABASE_URL = TEST_DATABASE_URL;
const EMBEDDING_API_KEY = TEST_OPENAI_API_KEY;

const SKIP_DB = !SUPABASE_KEY;
const SKIP_EMBED = !SUPABASE_KEY || !EMBEDDING_API_KEY;

const INSTANCE_ID = 'plugin-integration-test';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'plugin-integration-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY, databaseUrl: DATABASE_URL, skipDdl: false },
    server: { host: 'localhost', port: 3100 },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', apiKey: EMBEDDING_API_KEY, dimensions: 1536 },
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

// ── Schemas ──────────────────────────────────────────────────────────────────

const CRM_SCHEMA_V1 = `
plugin:
  id: crm_test
  name: CRM Test Plugin
  version: 1
tables:
  - name: contacts
    description: Test contacts table
    columns:
      - name: name
        type: text
        required: true
      - name: email
        type: text
      - name: company
        type: text
`.trim();

const CRM_SCHEMA_V2 = `
plugin:
  id: crm_test
  name: CRM Test Plugin
  version: 2
tables:
  - name: contacts
    description: Test contacts table
    columns:
      - name: name
        type: text
        required: true
      - name: email
        type: text
      - name: company
        type: text
      - name: phone
        type: text
`.trim();

const CRM_SCHEMA_EMBEDDABLE = `
plugin:
  id: crm_embed
  name: CRM Embeddable Plugin
  version: 1
tables:
  - name: contacts
    description: Contacts with embeddings
    embed_fields:
      - name
      - notes
    columns:
      - name: name
        type: text
        required: true
      - name: notes
        type: text
`.trim();

// ── Suite ────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_DB)('Plugin System Integration', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;
  let pgClient: pg.Client;

  // Tables created during tests — cleaned up in afterAll
  const createdTables: string[] = [
    'fqcp_crm_test_default_contacts',
    'fqcp_crm_test_acme_contacts',
    'fqcp_crm_test_beta_contacts',
  ];

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-plugin-integration-'));
    config = makeConfig(vaultPath);
    initLogger(config);

    pgClient = new pg.Client({ connectionString: DATABASE_URL });
    await pgClient.connect();

    await initSupabase(config);
    if (EMBEDDING_API_KEY) initEmbedding(config);
    await initPlugins(config);
  });

  afterAll(async () => {
    // Drop all dynamically created plugin tables
    for (const table of createdTables) {
      await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(table)}`).catch(() => {});
    }
    await pgClient.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier('fqcp_crm_embed_default_contacts')}`).catch(() => {});

    // Clean registry rows for this test instance
    await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await supabaseManager.getClient()
      .from('fqc_vault')
      .delete()
      .eq('instance_id', INSTANCE_ID);

    await pgClient.end();
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  // ── Scenario 1: End-to-End Plugin Registration ────────────────────────────

  it('PLUG-01: register_plugin creates tables in Postgres and inserts registry row', async () => {
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    const result = await getHandler('register_plugin')({
      schema_yaml: CRM_SCHEMA_V1,
    }) as { content: Array<{ text: string }>; isError?: boolean };

    if (result.isError) console.error('register_plugin error:', result.content[0].text);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('fqcp_crm_test_default_contacts');

    // Verify table was created in Postgres
    const tableResult = await pgClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'fqcp_crm_test_default_contacts'
    `);
    expect(tableResult.rows).toHaveLength(1);

    // Verify implicit columns are present
    const colResult = await pgClient.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqcp_crm_test_default_contacts'
        AND column_name = ANY(ARRAY['id', 'instance_id', 'status', 'created_at', 'updated_at', 'name', 'email', 'company'])
    `);
    expect(colResult.rows).toHaveLength(8);

    // Verify registry row was inserted
    const { data, error } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('plugin_id, plugin_instance, schema_version, status, table_prefix')
      .eq('plugin_id', 'crm_test')
      .eq('instance_id', INSTANCE_ID)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.plugin_id).toBe('crm_test');
    expect(data!.plugin_instance).toBe('default');
    expect(data!.schema_version).toBe('1');
    expect(data!.status).toBe('active');
    expect(data!.table_prefix).toBe('fqcp_crm_test_default_');
  });

  // ── Scenario 2: Version Mismatch Warning ─────────────────────────────────

  it('PLUG-03: re-registration with changed version applies safe DDL and updates schema_version', async () => {
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);

    // V1 is already registered from scenario 1. Re-register with V2 (adds phone column).
    const result = await getHandler('register_plugin')({
      schema_yaml: CRM_SCHEMA_V2,
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    // Implementation applies safe DDL migrations (not warn-and-skip)
    expect(result.content[0].text.toLowerCase()).toContain('schema updated');

    // Verify the 'phone' column WAS added (safe DDL applied)
    const colResult = await pgClient.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'fqcp_crm_test_default_contacts'
        AND column_name = 'phone'
    `);
    expect(colResult.rows).toHaveLength(1);

    // Verify registry row was updated to new version (schema_version is TEXT)
    const { data } = await supabaseManager.getClient()
      .from('fqc_plugin_registry')
      .select('schema_version')
      .eq('plugin_id', 'crm_test')
      .eq('instance_id', INSTANCE_ID)
      .single();

    expect(data!.schema_version).toBe('2');
  });

  // ── Scenario 4: Multi-instance Isolation ─────────────────────────────────

  it('PLUG-04 + REC-02: cross-instance get_record returns not found — instance_id isolation enforced', async () => {
    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    registerRecordTools(server, config);

    // Register plugin under two distinct instance names
    await getHandler('register_plugin')({
      schema_yaml: CRM_SCHEMA_V1.replace('version: 1', 'version: 1'),
      plugin_instance: 'acme',
    });
    await getHandler('register_plugin')({
      schema_yaml: CRM_SCHEMA_V1.replace('version: 1', 'version: 1'),
      plugin_instance: 'beta',
    });

    // Create a record in the 'acme' instance
    const createResult = await getHandler('create_record')({
      plugin_id: 'crm_test',
      plugin_instance: 'acme',
      table: 'contacts',
      fields: { name: 'Alice Acme', email: 'alice@acme.com' },
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(createResult.isError).toBeUndefined();
    const idMatch = createResult.content[0].text.match(/([a-f0-9-]{36})/);
    expect(idMatch).not.toBeNull();
    const acmeRecordId = idMatch![1];

    // Verify the record exists in the 'acme' table directly via pg
    const acmeRow = await pgClient.query(
      'SELECT id, instance_id FROM fqcp_crm_test_acme_contacts WHERE id = $1',
      [acmeRecordId]
    );
    expect(acmeRow.rows).toHaveLength(1);
    expect(acmeRow.rows[0].instance_id).toBe(INSTANCE_ID);

    // Attempt to retrieve the 'acme' record from the 'beta' instance — must fail
    const crossResult = await getHandler('get_record')({
      plugin_id: 'crm_test',
      plugin_instance: 'beta',
      table: 'contacts',
      id: acmeRecordId,
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(crossResult.isError).toBe(true);
    expect(crossResult.content[0].text).toContain('not found');
  });

  // ── Scenario 3: Semantic Search (requires embedding key) ─────────────────

  describe.skipIf(SKIP_EMBED)('Semantic search', () => {
    it('REC-05: search_records returns similarity-ranked results for embed_fields table', async () => {
      const { server, getHandler } = createMockServer();
      registerPluginTools(server, config);
      registerRecordTools(server, config);

      // Register the embeddable plugin
      await getHandler('register_plugin')({
        schema_yaml: CRM_SCHEMA_EMBEDDABLE,
      });

      // Create several records with distinct content
      const records = [
        { name: 'Alice Engineer', notes: 'Expert in TypeScript and distributed systems' },
        { name: 'Bob Designer', notes: 'Specializes in UI/UX and design systems' },
        { name: 'Carol PM', notes: 'Product manager focused on roadmaps and stakeholder communication' },
      ];

      const recordIds: string[] = [];
      for (const fields of records) {
        const r = await getHandler('create_record')({
          plugin_id: 'crm_embed',
          table: 'contacts',
          fields,
        }) as { content: Array<{ text: string }>; isError?: boolean };
        expect(r.isError).toBeUndefined();
        const m = r.content[0].text.match(/([a-f0-9-]{36})/);
        if (m) recordIds.push(m[1]);
      }
      expect(recordIds).toHaveLength(3);

      // Wait for fire-and-forget embeddings to complete (up to 15s)
      let embeddedCount = 0;
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const result = await pgClient.query(
          `SELECT COUNT(*) AS cnt FROM fqcp_crm_embed_default_contacts WHERE embedding IS NOT NULL AND instance_id = $1`,
          [INSTANCE_ID]
        );
        embeddedCount = parseInt(result.rows[0].cnt, 10);
        if (embeddedCount >= 3) break;
      }
      expect(embeddedCount).toBeGreaterThanOrEqual(3);

      // Semantic search — query about engineering
      const searchResult = await getHandler('search_records')({
        plugin_id: 'crm_embed',
        table: 'contacts',
        query: 'TypeScript engineer distributed systems',
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(searchResult.isError).toBeUndefined();
      const responseText = searchResult.content[0].text;

      // Results contain similarity values
      expect(responseText).toMatch(/similarity/i);

      // Alice (the TypeScript engineer) should appear in results
      expect(responseText).toContain('Alice Engineer');

      // Parse the JSON result to extract and validate similarity values
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      expect(jsonMatch).not.toBeNull();
      const rows = JSON.parse(jsonMatch![0]) as Array<{ similarity?: number }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(typeof row.similarity).toBe('number');
        expect(row.similarity!).toBeGreaterThanOrEqual(0);
        expect(row.similarity!).toBeLessThanOrEqual(1);
      }
    });
  });
});
