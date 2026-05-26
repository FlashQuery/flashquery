import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { invalidateReconciliationCache } from '../../src/services/plugin-reconciliation.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const INSTANCE_ID = 'phase-157-records-reconciliation';
const PLUGIN_ID = 'phase157_records_recon';
const TABLE_NAME = `fqcp_${PLUGIN_ID}_default_contacts`;

const SCHEMA = `
plugin:
  id: ${PLUGIN_ID}
  name: Phase 157 Records Reconciliation
  version: 1
watched_folders:
  - records-reconciliation
documents:
  types:
    - id: contact-doc
      folder: records-reconciliation
      table: contacts
      on_added: auto-track
      track_as: contacts
      template: contact-review
tables:
  - name: contacts
    columns:
      - name: name
        type: text
`.trim();

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: INSTANCE_ID, id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

describe.skipIf(!HAS_SUPABASE)('records-reconciliation T-I-044', () => {
  let config: FlashQueryConfig;
  let vaultPath: string;
  let pgClient: pg.Client;
  let supabaseReady = false;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-157-records-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    supabaseReady = true;
    await initVault(config);
    initEmbedding(config);
    pgClient = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await pgClient.connect();

    const { server, getHandler } = createMockServer();
    registerPluginTools(server, config);
    const result = await getHandler('register_plugin')({ schema_yaml: SCHEMA }) as { isError?: boolean; content: Array<{ text: string }> };
    if (result.isError) throw new Error(result.content[0].text);
  }, 120_000);

  afterAll(async () => {
    if (supabaseReady) {
      await supabaseManager.getClient().from('fqc_pending_plugin_review').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.getClient().from('fqc_plugin_registry').delete().eq('instance_id', INSTANCE_ID);
      await supabaseManager.close();
    }
    await pgClient?.query(`DROP TABLE IF EXISTS ${pg.escapeIdentifier(TABLE_NAME)}`).catch(() => undefined);
    await pgClient?.end().catch(() => undefined);
    if (vaultPath) await rm(vaultPath, { recursive: true, force: true });
  }, 60_000);

  it('T-I-044 concurrent write_record calls do not double-apply reconciliation', async () => {
    await mkdir(join(vaultPath, 'records-reconciliation'), { recursive: true });
    const fqcId = randomUUID();
    const relPath = `records-reconciliation/${fqcId}.md`;
    await writeFile(join(vaultPath, relPath), '---\ntitle: Phase 157 Contact\n---\n# Phase 157 Contact\n');
    const { error: docError } = await supabaseManager.getClient().from('fqc_documents').insert({
      id: fqcId,
      instance_id: INSTANCE_ID,
      path: relPath,
      title: 'Phase 157 Contact',
      tags: [],
      status: 'active',
    });
    expect(docError).toBeNull();

    invalidateReconciliationCache();
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, config);

    const results = await Promise.allSettled([
      getHandler('write_record')({ mode: 'create', plugin_id: PLUGIN_ID, table: 'contacts', data: { name: 'Ada' } }),
      getHandler('write_record')({ mode: 'create', plugin_id: PLUGIN_ID, table: 'contacts', data: { name: 'Grace' } }),
    ]);
    expect(results.every((entry) => entry.status === 'fulfilled')).toBe(true);

    const tracked = await pgClient.query(
      `SELECT COUNT(*)::int AS count FROM ${pg.escapeIdentifier(TABLE_NAME)} WHERE instance_id = $1 AND fqc_id = $2`,
      [INSTANCE_ID, fqcId]
    );
    expect(Number(tracked.rows[0].count)).toBe(1);

    const { data: pending, error: pendingError } = await supabaseManager.getClient()
      .from('fqc_pending_plugin_review')
      .select('id')
      .eq('instance_id', INSTANCE_ID)
      .eq('plugin_id', PLUGIN_ID)
      .eq('fqc_id', fqcId);
    expect(pendingError).toBeNull();
    expect(pending ?? []).toHaveLength(1);
  }, 60_000);
});
